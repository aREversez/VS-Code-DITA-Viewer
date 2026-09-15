import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

// dist-test/test/editor/webviewL10n.test.js -> repo root is three levels up.
const repoRoot = join(__dirname, '..', '..', '..');
const read = (rel: string): string => readFileSync(join(repoRoot, rel), 'utf8');

const sharedSource = read('src/editor/webviewL10n.ts');
const providerSources = [
  ['single-topic preview', 'src/editor/DitaViewerProvider.ts'],
  ['map preview', 'src/editor/MapViewerProvider.ts'],
] as const;

/**
 * sharedWebviewStrings() cannot be imported here: it calls vscode.l10n.t at
 * evaluation time, and the unit-test build deliberately excludes every module
 * that imports vscode. So these cases read the sources as text instead.
 *
 * What they pin is the arrangement the extraction created, and the ways it can
 * decay without anything else noticing: a provider that stops spreading the
 * table and grows a private copy back, a provider that re-declares a shared
 * key -- object spread lets a later literal override an earlier one with no
 * diagnostic, which would silently fork the two toolbars again -- and, the one
 * that matters most, an entry moved between the table's two value shapes. That
 * last failure renders as mangled toolbar text in a running webview; nothing in
 * the build reports it.
 *
 * The parsing is line-based: one key per line, block closed by a line that is
 * exactly `};`. A nested object literal would defeat it, so keep these tables
 * flat.
 */
function blockAfter(source: string, marker: string): string {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((l) => l.includes(marker));
  assert.notStrictEqual(start, -1, `marker not found: ${marker}`);
  const end = lines.findIndex((l, i) => i > start && /^\s*\};\s*$/.test(l));
  assert.notStrictEqual(end, -1, `no closing '};' after ${marker}`);
  return lines.slice(start + 1, end).join('\n');
}

/** key -> value expression. Whole-line comments are skipped, not stripped, so
 *  a `//` inside one of the long literal strings could not truncate a value. */
function entries(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of block.split('\n')) {
    if (/^\s*\/\//.test(line)) continue;
    const m = /^\s*(\w+):\s*(.+?)\s*,?\s*$/.exec(line);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

const sharedEntries = entries(blockAfter(sharedSource, 'export function sharedWebviewStrings()'));

describe('webview toolbar string table', () => {
  it('holds both value shapes, so neither group can be flattened into the other', () => {
    // Named keys rather than a count: a count would still pass on a table that
    // had been gutted and padded back out, and would say nothing about shape.
    // previewToolbar/pageWidth used to canary the pre-quoted group here, but
    // both moved to the raw group when getToolbarScaffoldScript/
    // getToolbarFontWidthTagTooltipsButtonsScript started taking them as
    // function arguments instead of the providers interpolating them
    // directly -- reloadContent and profilingOnTitle still are, and still
    // represent the pre-quoted group correctly.
    for (const key of ['reloadContent', 'profilingOnTitle']) {
      assert.ok(sharedEntries.has(key), `shared table lost ${key}`);
      assert.match(sharedEntries.get(key)!, /^JSON\.stringify\(/);
    }
    for (const key of ['searchPlaceholder', 'filterTitle']) {
      assert.ok(sharedEntries.has(key), `shared table lost ${key}`);
      assert.match(sharedEntries.get(key)!, /^vscode\.l10n\.t\(/);
    }
  });

  for (const [label, file] of providerSources) {
    describe(label, () => {
      const source = read(file);
      const block = blockAfter(source, 'const L = {');
      const local = entries(block);
      // No key is in both maps -- the case below asserts it -- so the merge
      // order cannot change the result.
      const all = new Map([...sharedEntries, ...local]);

      it('spreads the shared table instead of carrying its own copy', () => {
        assert.ok(
          block.includes('...sharedWebviewStrings()'),
          'expected const L to spread sharedWebviewStrings()',
        );
      });

      it('adds no key the shared table already provides', () => {
        const shadowed = [...local.keys()].filter((k) => sharedEntries.has(k));
        assert.deepStrictEqual(shadowed, []);
      });

      it('quotes what it interpolates, and leaves what it passes as a value unquoted', () => {
        const interpolated = new Set([...source.matchAll(/\$\{L\.(\w+)\}/g)].map((m) => m[1]));
        // The lookbehind keeps `${L.foo}` from also counting as a member access.
        const asOptionValue = new Set(
          [...source.matchAll(/(?<!\$\{)\bL\.(\w+)/g)].map((m) => m[1]),
        );
        // Walked as a union with what the script references, not as the table's
        // own keys. Nothing in CI typechecks these two files -- esbuild strips
        // types without checking them, and neither tsconfig.test.json nor
        // tsconfig.e2e.json includes src/editor's providers -- so a key the
        // template asks for and the table no longer provides would reach the
        // page as the literal text "undefined", in a dropdown option, with
        // every gate green. This loop is the only thing that sees it.
        const referenced = new Set([...interpolated, ...asOptionValue]);
        const problems: string[] = [];
        for (const key of new Set([...all.keys(), ...referenced])) {
          const value = all.get(key);
          const isInterpolated = interpolated.has(key);
          const isOption = asOptionValue.has(key);
          if (value === undefined) {
            problems.push(`${key} is referenced by the script but no table provides it`);
            continue;
          }
          if (isInterpolated === isOption) {
            problems.push(
              isInterpolated
                ? `${key} is interpolated into the template and passed as a value`
                : `${key} is in the table but never consumed`,
            );
            continue;
          }
          const quoted = /^JSON\.stringify\(/.test(value);
          if (isInterpolated && !quoted) {
            problems.push(`${key} is interpolated into the template but is not a JS literal`);
          }
          if (isOption && quoted) {
            problems.push(`${key} is passed to an overlay as a value but is pre-quoted`);
          }
        }
        assert.deepStrictEqual(problems, []);
      });
    });
  }
});
