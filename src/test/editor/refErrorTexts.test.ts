import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_REF_ERROR_TEXTS, RefErrorTexts } from '@dita-viewer/core';

// dist-test/test/editor/refErrorTexts.test.js -> repo root is three levels up.
const repoRoot = join(__dirname, '..', '..', '..');
const read = (rel: string): string => readFileSync(join(repoRoot, rel), 'utf8');

/**
 * refErrorTexts() cannot be imported here: it calls vscode.l10n.t at
 * evaluation time, and the unit-test build deliberately excludes every
 * module that imports vscode (the webviewL10n.test.ts arrangement). So the
 * helper's source is read as text instead.
 *
 * What this pins is the three-way parity the feature rests on: the l10n
 * keys in the helper must equal the core's English defaults
 * (DEFAULT_REF_ERROR_TEXTS) -- the keys ARE the default strings -- and both
 * l10n bundles must carry every key. A drift here is invisible at runtime:
 * vscode.l10n.t falls back to the key itself, so a renamed default would
 * silently render English in a zh editor, and a missing bundle entry would
 * do the same with no diagnostic.
 */

const source = read('src/editor/refErrorTexts.ts');

/** field -> l10n key. One entry per line, argument-less t() call: the
 *  {0}/{1} placeholders must survive into the template for the core
 *  renderer to fill at render time (fillRefErrorTemplate). */
function l10nEntries(): Map<keyof RefErrorTexts, string> {
  const out = new Map<keyof RefErrorTexts, string>();
  for (const line of source.split(/\r?\n/)) {
    const m = /^\s*(\w+):\s*vscode\.l10n\.t\('([^']*)'\),?\s*$/.exec(line);
    if (m) out.set(m[1] as keyof RefErrorTexts, m[2]);
  }
  return out;
}

const entries = l10nEntries();
const enBundle: Record<string, string> = JSON.parse(read('l10n/bundle.l10n.json'));
const zhBundle: Record<string, string> = JSON.parse(read('l10n/bundle.l10n.zh-cn.json'));

describe('refErrorTexts l10n parity', () => {
  it('covers exactly the five fields of RefErrorTexts', () => {
    assert.deepStrictEqual([...entries.keys()].sort(), Object.keys(DEFAULT_REF_ERROR_TEXTS).sort());
  });

  it('uses the core English defaults as the l10n keys', () => {
    for (const [field, key] of entries) {
      assert.strictEqual(key, DEFAULT_REF_ERROR_TEXTS[field], `${field} drifted from DEFAULT_REF_ERROR_TEXTS`);
    }
  });

  it('calls l10n.t without arguments so {0}/{1} survive into the templates', () => {
    // A t(key, ...args) call would fill the placeholders at lookup time with
    // nothing to fill them from; the regex above only matches the bare form,
    // so this asserts no entry was lost to a different call shape.
    const callCount = (source.match(/vscode\.l10n\.t\(/g) || []).length;
    assert.strictEqual(callCount, entries.size, 'every t() call must be the argument-less template form');
    assert.ok(entries.get('content')!.includes('{0}'));
    assert.ok(entries.get('xref')!.includes('{0}') && entries.get('xref')!.includes('{1}'));
  });

  it('carries every key in both bundles; en is the identity mapping', () => {
    for (const key of entries.values()) {
      assert.strictEqual(enBundle[key], key, `en bundle missing or altered: ${key}`);
      assert.ok(typeof zhBundle[key] === 'string' && zhBundle[key].length > 0, `zh bundle missing: ${key}`);
    }
  });

  it('keeps the placeholders in the zh templates and uses full-width parentheses', () => {
    const zhContent = zhBundle[DEFAULT_REF_ERROR_TEXTS.content];
    const zhXref = zhBundle[DEFAULT_REF_ERROR_TEXTS.xref];
    assert.ok(zhContent.includes('{0}'), 'zh content template must keep {0}');
    assert.ok(zhXref.includes('{0}') && zhXref.includes('{1}'), 'zh xref template must keep {0}/{1}');
    assert.ok(zhContent.includes('（{0}）'), 'zh wraps the reason in full-width parentheses');
    assert.ok(zhXref.includes('（{1}）'));
  });
});