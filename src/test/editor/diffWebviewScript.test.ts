import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

// dist-test/test/editor/diffWebviewScript.test.js -> repo root is three levels up.
const repoRoot = join(__dirname, '..', '..', '..');
const read = (rel: string): string => readFileSync(join(repoRoot, rel), 'utf8');

const SCRIPT_REL = 'media/diff-webview.js';
const PROVIDER_REL = 'src/editor/ditaDiffProvider.ts';
const script = read(SCRIPT_REL);
const provider = read(PROVIDER_REL);

/**
 * The diff panel's script moved out of a template literal in ditaDiffProvider.ts
 * and into a real file, loaded as `<script nonce src>`. That trades one failure
 * mode for another: the two halves of the panel -- the HTML the provider emits
 * and the script that drives it -- no longer live in the same file, so nothing
 * forces them to keep agreeing.
 *
 * Every way they can disagree is silent. A renamed button id leaves the toolbar
 * looking correct and doing nothing. A message type spelled differently on the
 * two sides makes the swap button inert. A pattern added to .vscodeignore ships
 * an extension whose diff panel never loads its script at all. None of these
 * reaches any other gate: esbuild does not typecheck, the script is a plain
 * asset that no compiler reads, and the end-to-end tests cannot click inside a
 * webview.
 */
describe('diff panel webview script', () => {
  it('is JavaScript that parses', () => {
    // Compiles without running: acquireVsCodeApi() and the DOM are only touched
    // when the body executes, which a webview does and this test does not.
    assert.doesNotThrow(() => new Function(script));
  });

  it('carries no leftover template syntax', () => {
    // Inside a template literal a stray `${` was an interpolation and a stray
    // backtick ended the string. In a plain file both are literal text, and
    // both are syntax errors in the running webview rather than at build time.
    assert.ok(!script.includes('${'), 'found an uninterpolated ${ in a plain .js file');
    assert.ok(!script.includes('`'), 'found a backtick in a plain .js file');
  });

  it('looks up only element ids the provider actually emits', () => {
    const wanted = [...script.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
    assert.ok(wanted.length >= 5, `expected the script to wire up its toolbar, found ${wanted.length} ids`);
    const emitted = new Set([...provider.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
    const missing = [...new Set(wanted)].filter((id) => !emitted.has(id));
    assert.deepStrictEqual(missing, [], 'script references ids absent from the panel HTML');
  });

  it('posts only message types the provider handles', () => {
    const posted = [...script.matchAll(/postMessage\(\{\s*type:\s*'([^']+)'/g)].map((m) => m[1]);
    assert.ok(posted.length >= 1, 'expected the script to post at least one message');
    const handled = new Set([...provider.matchAll(/msg\.type === '([^']+)'/g)].map((m) => m[1]));
    const unhandled = [...new Set(posted)].filter((t) => !handled.has(t));
    assert.deepStrictEqual(unhandled, [], 'script posts message types nobody listens for');
  });

  it('is loaded as an external script with the nonce on the tag that names it', () => {
    assert.ok(
      provider.includes('<script nonce="${nonce}" src="${diffScriptUri}"></script>'),
      'expected the panel to load the script by src, with the nonce on that tag',
    );
    assert.ok(
      provider.includes("'media', 'diff-webview.js'"),
      'expected diffScriptUri to be built from ' + SCRIPT_REL,
    );
    // The whole point of the move: no script body left inline to drift from the
    // file, and no second copy of it anywhere.
    assert.ok(!provider.includes('getDiffWebviewScript'), 'the inlined copy is still there');
    assert.ok(
      !/<script[^>]*>\s*\(function/.test(provider),
      'found an inline script body in the panel HTML',
    );
  });

  it('ships in the packaged extension', () => {
    // .vscodeignore uses npm-packignore globs. Only the two wildcards that can
    // reach this path are translated; everything else is compared literally, so
    // an unhandled construct fails towards reporting a problem.
    const matches = (pattern: string, relPath: string): boolean => {
      const src = pattern
        .replace(/[.+^$(){}|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\u0000')
        .replace(/\*/g, '[^/]*')
        .replace(/\u0000/g, '.*');
      return new RegExp('^' + src.replace(/\/$/, '/.*') + '$').test(relPath);
    };
    // Teeth first: a path that is ignored must be reported as ignored, otherwise
    // the assertion below could pass on a matcher that matches nothing at all.
    assert.ok(matches('src/**', 'src/editor/ditaDiffProvider.ts'), 'matcher is vacuous');

    const patterns = read('.vscodeignore')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('!'));
    const blocking = patterns.filter((p) => matches(p, SCRIPT_REL));
    assert.deepStrictEqual(
      blocking,
      [],
      `${SCRIPT_REL} is excluded from the package; the diff panel would load no script`,
    );
  });
});
