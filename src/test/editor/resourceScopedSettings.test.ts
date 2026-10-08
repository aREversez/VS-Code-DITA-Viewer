import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Defect 3 regression. `templatesDirectory`, `cssDirectory` and `customCss`
 * point at file reads, so a user legitimately sets them in one workspace
 * folder's .vscode/settings.json. Two things had to line up for that to work
 * in a multi-root window, and this test pins both:
 *
 *  1. each setting declares `scope: "resource"`, otherwise VS Code never
 *     surfaces a folder-level value to the extension at all; and
 *  2. every read passes a scope Uri to getConfiguration, otherwise the value
 *     is invisible even once the scope is declared (an unscoped
 *     getConfiguration only sees the user/workspace merged value).
 *
 * The reads span three files; a plain mocha run has no `vscode`, so — like the
 * executable-path scope test — we assert against the declarations/source.
 */

const repoRoot = join(__dirname, '..', '..', '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const props = pkg.contributes.configuration.properties as Record<string, { scope?: string }>;

const RESOURCE_KEYS = ['templatesDirectory', 'cssDirectory', 'customCss'];

const SOURCES = [
  'src/editor/MapViewerProvider.ts',
  'src/editor/cssDiscovery.ts',
  'src/extension.ts',
].map((rel) => ({ rel, text: readFileSync(join(repoRoot, rel), 'utf8') }));

describe('settings that name folders/files to read', () => {
  for (const key of RESOURCE_KEYS) {
    it(`dita-viewer.${key} is resource-scoped so a workspace folder can set it`, () => {
      assert.ok(props[`dita-viewer.${key}`], `dita-viewer.${key} must be contributed`);
      assert.strictEqual(props[`dita-viewer.${key}`].scope, 'resource');
    });
  }
});

describe('reads of the resource-scoped settings pass a scope Uri', () => {
  // Collapse whitespace so a call split across lines reads as one statement.
  const squash = (s: string) => s.replace(/\s+/g, ' ');

  it('every read of the three settings goes through a scoped getConfiguration', () => {
    for (const { rel, text } of SOURCES) {
      const flat = squash(text);
      let seen = 0;
      // Find every `.get<...>('<key>')` of a resource key and walk back to the
      // getConfiguration call that produced the config it reads through.
      for (const key of RESOURCE_KEYS) {
        const readRe = new RegExp(`\\.get(?:<[^>]*>)?\\(\\s*'${key}'`, 'g');
        let m: RegExpExecArray | null;
        while ((m = readRe.exec(flat))) {
          seen += 1;
          const before = flat.slice(0, m.index);
          const cfgIdx = before.lastIndexOf(`getConfiguration('dita-viewer'`);
          assert.ok(cfgIdx >= 0, `${rel}: .get('${key}') has no preceding getConfiguration('dita-viewer')`);
          const afterName = flat.slice(cfgIdx + `getConfiguration('dita-viewer'`.length);
          const scoped = /^\s*,/.test(afterName); // a comma means a scope argument follows
          assert.ok(scoped, `${rel}: '${key}' is read through an UNSCOPED getConfiguration('dita-viewer'); pass the document's Uri so a folder-level value reaches it`);
        }
      }
      assert.ok(seen > 0, `${rel}: expected at least one read of a resource-scoped setting, found none (test gone vacuous)`);
    }
  });
});
