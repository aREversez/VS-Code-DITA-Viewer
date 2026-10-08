import * as assert from 'assert';
import { readFileSync, readdirSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * Defect 3 regression. `templatesDirectory`, `cssDirectory` and `customCss`
 * name folders and files to read, so a user legitimately sets them in one
 * workspace folder's .vscode/settings.json. Two things had to line up for that
 * to work in a multi-root window, and this test pins both:
 *
 *  1. each setting declares `scope: "resource"`, otherwise VS Code never
 *     surfaces a folder-level value to the extension at all; and
 *  2. every read passes a scope Uri to getConfiguration, otherwise the value
 *     is invisible even once the scope is declared (an unscoped
 *     getConfiguration only sees the merged user/workspace value).
 *
 * A plain mocha run has no `vscode`, so — like the executable-path scope test —
 * the assertions run over the manifest and the source text.
 *
 * Two properties of that source scan are load-bearing, both learned from
 * mutating the code and watching the assertions stay quiet:
 *
 *  - it walks every TypeScript file under src/ instead of a list of the files
 *    written so far, so a newly added reader is checked rather than overlooked;
 *  - and it resolves each read to the `getConfiguration` call that produced the
 *    object the read goes through — by variable name, or by the call the read
 *    is chained onto — rather than to the nearest preceding call. A file may
 *    hold a scoped and an unscoped config at once, and then position alone
 *    proves nothing about the object your `.get()` was called on.
 */

const repoRoot = join(__dirname, '..', '..', '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const props = pkg.contributes.configuration.properties as Record<string, { scope?: string }>;

const RESOURCE_KEYS = ['templatesDirectory', 'cssDirectory', 'customCss'];

/** The start of every call that produces a `dita-viewer` config object. */
const CFG = `getConfiguration('dita-viewer'`;

/** The same, quoted for use inside a RegExp. */
const CFG_RE = CFG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The reads the fix had to scope: MapViewerProvider.templateRoots (1),
 * cssDiscovery.discoverCssFiles (2), the DITA-OT transform's template picker
 * (1) and scanCssFiles (2). Fewer than this means a read went away rather than
 * being scoped, which would leave the scan checking nothing.
 */
const MINIMUM_READS = 6;

/** Every TypeScript file under src/, minus the test trees (they fake vscode). */
function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        found.push(relative(repoRoot, abs).split(sep).join('/'));
      }
    }
  };
  walk(join(repoRoot, 'src'));
  return found.filter((rel) => !rel.startsWith('src/test'));
}

// Collapse whitespace so a call split across lines reads as one statement.
const squash = (s: string) => s.replace(/\s+/g, ' ');

/** Does the call at `idx` pass a scope argument? A comma right after the name. */
function callIsScoped(text: string, idx: number): boolean {
  return text[idx + CFG.length] === ',';
}

/** The index of the `)` closing the call whose start is at `idx`, or -1. */
function closingParen(flat: string, idx: number): number {
  let depth = 1;
  for (let i = idx + CFG.length; i < flat.length; i++) {
    if (flat[i] === '(') depth++;
    else if (flat[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

/**
 * Assert that the read at `readIdx` (the index of its `.get('<key>')`) goes
 * through a scoped config: either chained onto the call directly, or through a
 * variable that the last assignment before the read bound to one.
 */
function assertReadIsScoped(rel: string, flat: string, readIdx: number, key: string): void {
  const before = flat.slice(0, readIdx);
  const where = `${rel}: '${key}'`;
  const cfgIdx = before.lastIndexOf(CFG);

  // Chained: getConfiguration('dita-viewer', uri).get('key')
  if (cfgIdx >= 0 && closingParen(flat, cfgIdx) === readIdx - 1) {
    assert.ok(
      callIsScoped(flat, cfgIdx),
      `${where} is read through an UNSCOPED ${CFG}'); pass the document's Uri so a folder-level value reaches it`
    );
    return;
  }

  // Through a variable: const config = getConfiguration('dita-viewer', uri)
  // (`before` stops at the dot, which the read's own match already consumed)
  const receiver = /([A-Za-z_$][\w$]*)$/.exec(before);
  if (receiver) {
    const name = receiver[1];
    const declRe = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*(?:[A-Za-z_$][\\w$]*\\.)*${CFG_RE}`, 'g');
    let decl = -1;
    let m: RegExpExecArray | null;
    while ((m = declRe.exec(before))) decl = m.index + m[0].indexOf(CFG);
    assert.ok(
      decl >= 0,
      `${where} reads through '${name}', which no assignment in this file binds to a ${CFG} — the scope cannot be checked. Bind the config to a variable from a scoped call here instead of passing one in.`
    );
    assert.ok(
      callIsScoped(before, decl),
      `${where} is read through '${name}', which is assigned from an UNSCOPED ${CFG}'); pass the document's Uri so a folder-level value reaches it`
    );
    return;
  }

  assert.fail(
    `${where} cannot be traced to a getConfiguration call (${CFG} at ${cfgIdx} is not the call it reads through); the guard cannot check its scope`
  );
}

describe('settings that name folders/files to read', () => {
  for (const key of RESOURCE_KEYS) {
    it(`dita-viewer.${key} is resource-scoped so a workspace folder can set it`, () => {
      assert.ok(props[`dita-viewer.${key}`], `dita-viewer.${key} must be contributed`);
      assert.strictEqual(props[`dita-viewer.${key}`].scope, 'resource');
    });
  }
});

describe('reads of the resource-scoped settings pass a scope Uri', () => {
  it('every read in src/ goes through a scoped getConfiguration', () => {
    const files = sourceFiles();
    assert.ok(files.length > 50, `expected the source scan to find the extension's files, found ${files.length}`);
    let reads = 0;
    for (const rel of files) {
      const flat = squash(readFileSync(join(repoRoot, rel), 'utf8'));
      for (const key of RESOURCE_KEYS) {
        const readRe = new RegExp(`\\.get(?:<[^>]*>)?\\(\\s*'${key}'`, 'g');
        let m: RegExpExecArray | null;
        while ((m = readRe.exec(flat))) {
          reads += 1;
          assertReadIsScoped(rel, flat, m.index, key);
        }
      }
    }
    assert.ok(
      reads >= MINIMUM_READS,
      `expected at least ${MINIMUM_READS} reads of the resource-scoped settings, found ${reads} — a read that was deleted rather than scoped makes this test vacuous`
    );
  });
});
