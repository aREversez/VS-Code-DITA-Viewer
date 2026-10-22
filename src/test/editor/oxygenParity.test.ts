import * as assert from 'assert';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  CORPUS_FOLDERS,
  NormalizedFinding,
  PLATFORM_DEPENDENT_FILES,
  dropPlatformDependent,
  dropPlatformDependentSignatures,
  canonicalCategory,
  collectExtensionFindings,
  diffKeys,
  findingSignature,
} from './completenessHarness';
import { corpusRootFromReport, normalizeOxygenFindings, parseOxygenReportAuto } from './oxygenReport';

// __dirname is dist-test/test/editor at runtime, so the repo root is three up.
const repoRoot = join(__dirname, '..', '..', '..');
const corpusPath = (folder: string): string => join(repoRoot, 'test-dita-file', folder);

// Set UPDATE_OXYGEN_PARITY=1 to rewrite the expected file after a deliberate
// change in parity (a new real report, or a check that now matches Oxygen).
const update = process.env.UPDATE_OXYGEN_PARITY === '1';

interface Parity {
  /** (file, category) found by both the extension and the real Oxygen report. */
  matched: string[];
  /** Found by the extension only. */
  extensionOnly: string[];
  /** Found by Oxygen only: the open parity work. */
  oxygenOnly: string[];
}

const show = (sigs: string[]): string[] => sigs.map((s) => s.replace('\t', '  '));

async function computeParity(folder: string, corpusDir: string): Promise<Parity> {
  const incidents = parseOxygenReportAuto(readFileSync(join(corpusDir, 'oxygen-report.xml'), 'utf8'));
  const root = corpusRootFromReport(incidents) ?? corpusDir;
  const oxygen = dropPlatformDependent(folder, normalizeOxygenFindings(root, incidents)).map(findingSignature);
  const extension = dropPlatformDependent(folder, await collectExtensionFindings(corpusDir)).map(findingSignature);
  const diff = diffKeys(extension, oxygen);
  return {
    matched: show([...new Set(extension.filter((s) => oxygen.includes(s)))].sort()),
    extensionOnly: show(diff.onlyInA),
    oxygenOnly: show(diff.onlyInB),
  };
}

describe('Oxygen parity on the corpus (real report)', () => {
  for (const folder of CORPUS_FOLDERS) {
    it(`${folder}: matches the committed parity state, so any change in parity is deliberate`, async function () {
      const corpusDir = corpusPath(folder);
      if (!existsSync(join(corpusDir, 'oxygen-report.xml'))) {
        this.skip(); // no real Oxygen run has been committed for this corpus yet
      }
      const expectedPath = join(corpusDir, 'oxygen-parity.expected.json');
      const actual = await computeParity(folder, corpusDir);
      if (update) {
        assert.ok(
          !(folder in PLATFORM_DEPENDENT_FILES) || process.platform === 'win32',
          `${folder} has Windows-dependent probes: refresh its parity state on Windows`,
        );
        writeFileSync(expectedPath, `${JSON.stringify(actual, null, 2)}\n`, 'utf8');
        return;
      }
      const saved = JSON.parse(readFileSync(expectedPath, 'utf8')) as Parity;
      const expected: Parity = {
        matched: dropPlatformDependentSignatures(folder, saved.matched),
        extensionOnly: dropPlatformDependentSignatures(folder, saved.extensionOnly),
        oxygenOnly: dropPlatformDependentSignatures(folder, saved.oxygenOnly),
      };
      assert.deepStrictEqual(
        actual,
        expected,
        `${folder}: parity with the Oxygen report changed; if that is intended, rerun with UPDATE_OXYGEN_PARITY=1`,
      );
    });
  }

  it('leaves platform-dependent probe files out of a comparison off Windows only', () => {
    const f = (file: string) => ({ file, category: 'missing-reference' });
    const both = [f('topics/a-case-pos.dita'), f('topics/ok.dita')];
    assert.deepStrictEqual(
      dropPlatformDependent('completeness-corpus-2', both, 'linux').map((x) => x.file),
      ['topics/ok.dita'],
    );
    assert.strictEqual(dropPlatformDependent('completeness-corpus-2', both, 'win32').length, 2);
    assert.strictEqual(dropPlatformDependent('completeness-corpus', both, 'linux').length, 2);
    assert.deepStrictEqual(
      dropPlatformDependentSignatures(
        'completeness-corpus-2',
        ['topics/a-win-seps-pos.dita  missing-reference', 'topics/ok.dita\tduplicate-id'],
        'darwin',
      ),
      ['topics/ok.dita\tduplicate-id'],
    );
  });

  it('compares on canonical categories, so a resource/reference split still counts as matched', () => {
    // The mechanism behind the resources.dita parity (OXYGEN-PROBLEMS.md): the
    // extension and Oxygen name the same missing file differently, and
    // canonicalCategory folds them into one signature. It collapses only the
    // documented equivalences and leaves every other category untouched.
    const ext: NormalizedFinding = { category: 'missing-resource', severity: 'error', file: 'topics/resources.dita', line: 7, message: 'm' };
    const ox: NormalizedFinding = { category: 'missing-reference', severity: 'error', file: 'topics/resources.dita', line: 7, message: 'n' };
    assert.strictEqual(findingSignature(ext), findingSignature(ox));
    assert.strictEqual(canonicalCategory('missing-resource'), 'missing-reference');
    assert.strictEqual(canonicalCategory('duplicate-id'), 'duplicate-id');
    assert.strictEqual(canonicalCategory('unreferenced-link'), 'unreferenced-link');
  });
});
