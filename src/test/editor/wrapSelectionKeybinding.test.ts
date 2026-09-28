import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The "wrap selection with tag" Enter binding is asserted on package.json
 * (the binding IS the data; the command module imports vscode, which plain
 * mocha does not have).
 *
 * Worth pinning down because a too-broad `when` fails silently: Enter with
 * any non-empty selection is a normal "replace selection with a newline",
 * and a selected snippet placeholder counts as a selection.
 */

const repoRoot = join(__dirname, '..', '..', '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const nls = JSON.parse(readFileSync(join(repoRoot, 'package.nls.json'), 'utf8'));
const nlsZh = JSON.parse(readFileSync(join(repoRoot, 'package.nls.zh-cn.json'), 'utf8'));

const COMMAND = 'ditaViewer.wrapSelectionWithTag';
const SETTING = 'dita-viewer.wrapSelectionOnEnter';

function enterBinding(): { key: string; when: string } {
  const b = pkg.contributes.keybindings.find(
    (k: { command: string; key: string }) => k.command === COMMAND && k.key === 'enter',
  );
  assert.ok(b, 'wrap-selection Enter keybinding must exist');
  return b;
}

describe('wrap-selection Enter keybinding', () => {
  it('should not fire while a snippet is active (a selected placeholder is a selection)', () => {
    assert.ok(enterBinding().when.includes('!inSnippetMode'));
  });

  it('should not fire in a read-only editor (the wrap edit would be rejected)', () => {
    assert.ok(enterBinding().when.includes('!editorReadonly'));
  });

  it('should be switchable off through a setting, so Enter-replaces-selection users can opt out', () => {
    assert.ok(enterBinding().when.includes(`config.${SETTING}`));
    const prop = pkg.contributes.configuration.properties[SETTING];
    assert.ok(prop, 'the setting must be contributed');
    assert.strictEqual(prop.type, 'boolean');
    assert.strictEqual(prop.default, true);
  });

  it('should ship the setting description in both en and zh-cn', () => {
    const prop = pkg.contributes.configuration.properties[SETTING];
    const key = String(prop.description).replace(/^%|%$/g, '');
    assert.ok(nls[key], `package.nls.json is missing ${key}`);
    assert.ok(nlsZh[key], `package.nls.zh-cn.json is missing ${key}`);
  });
});
