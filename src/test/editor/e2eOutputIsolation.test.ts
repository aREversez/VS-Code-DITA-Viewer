import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The e2e runner and the plain `tsc -p tsconfig.json` emit used to share the
 * `dist/test` directory, and the suite silently degraded because of it:
 *
 *   - tsconfig.json includes all of src/ with rootDir src and outDir dist, so a
 *     plain `tsc -p tsconfig.json` (what a bare `tsc` invocation runs) emits the
 *     UNIT tests to dist/test/<subdir>/*.test.js.
 *   - tsconfig.e2e.json emitted the E2E specs flat into that same directory, and
 *     src/test-e2e/index.ts collects specs by walking its OWN directory
 *     recursively (`findCompiledTestFiles(__dirname)`).
 *
 * One stale unit-test build therefore made the e2e run also execute every unit
 * test -- inside a real VS Code host, against the esbuild output in dist/editor,
 * at whatever version the editor happened to compile last. `npm run test:e2e`
 * only runs `tsc -p tsconfig.e2e.json`, so those copies were not merely
 * redundant but stale, and their failures read as e2e regressions.
 *
 * A configuration assertion, not a behaviour test: nothing at runtime can
 * observe the collision, because by the time the suite runs the wrong files are
 * already loaded. This fails the moment either output moves back onto the
 * other's path.
 */

// dist-test/test/editor -> repo root is three levels up (tsconfig.test.json's
// rootDir is src).
const repoRoot = join(__dirname, '..', '..', '..');
const read = (file: string): string => readFileSync(join(repoRoot, file), 'utf8');

/** tsconfig files carry comments, which JSON.parse rejects. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function outDirOf(file: string): string {
  const json = JSON.parse(stripComments(read(file))) as { compilerOptions?: { outDir?: string } };
  const out = json.compilerOptions?.outDir;
  assert.ok(out, `${file}: no outDir`);
  return String(out).replace(/\\/g, '/').replace(/\/+$/, '');
}

describe('e2e and unit-test build outputs do not share a directory', () => {
  const e2eOut = outDirOf('tsconfig.e2e.json');
  const mainOut = outDirOf('tsconfig.json');
  // Where plain `tsc -p tsconfig.json` puts src/test/**/*.test.ts (rootDir: src).
  const unitLanding = `${mainOut}/test`;

  it('the e2e output is neither the plain tsc output nor the directory the unit tests land in (regression: both were dist/test, and index.ts walks its own directory recursively, so every unit test tsc emitted there ran inside the VS Code host against stale dist/editor builds)', () => {
    assert.notStrictEqual(e2eOut, mainOut, 'e2e must not emit into the whole tsc output tree');
    assert.notStrictEqual(e2eOut, unitLanding, `e2e must not emit into ${unitLanding}, where unit tests are written`);
  });

  it('no unit-test output can be reached by the recursive spec walk (the walk is rooted at the e2e outDir, so anything nested under it is loaded as an e2e spec)', () => {
    assert.ok(
      !(unitLanding + '/').startsWith(`${e2eOut}/`),
      `unit tests emit into ${unitLanding}, which sits inside the walked ${e2eOut}`,
    );
  });

  it('test-runner.cjs points extensionTestsPath at exactly the e2e outDir (a runner left on the old path would load a directory nothing writes to any more)', () => {
    const m = /extensionTestsPath\s*=\s*path\.resolve\(__dirname,\s*'([^']+)'\)/.exec(read('test-runner.cjs'));
    assert.ok(m, 'could not find extensionTestsPath in test-runner.cjs');
    assert.strictEqual(
      m[1].replace(/\\/g, '/').replace(/\/+$/, ''),
      e2eOut,
      'test-runner.cjs and tsconfig.e2e.json disagree on where the specs are',
    );
  });

  it('the dev-only test output dirs stay out of the packaged extension (both sit UNDER the shipped dist/ folder, so the package checker top-level allowlist cannot catch them -- only its denylist can)', () => {
    const ignore = read('.vscodeignore');
    const checker = read('scripts/check-package.cjs');
    for (const dir of [e2eOut, unitLanding]) {
      assert.ok(ignore.includes(`${dir}/**`), `.vscodeignore must ignore ${dir}/**`);
      assert.ok(
        checker.includes(`'extension/${dir}/'`),
        `check-package.cjs FORBIDDEN must list extension/${dir}/, nested inside the allowed dist/`,
      );
    }
  });
});
