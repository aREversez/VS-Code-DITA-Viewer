import * as assert from 'assert';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  CORPUS_FOLDERS,
  NormalizedFinding,
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

async function computeParity(corpusDir: string): Promise<Parity> {
  const incidents = parseOxygenReportAuto(readFileSync(join(corpusDir, 'oxygen-report.xml'), 'utf8'));
  const root = corpusRootFromReport(incidents) ?? corpusDir;
  const oxygen = normalizeOxygenFindings(root, incidents).map(findingSignature);
  const extension = (await collectExtensionFindings(corpusDir)).map(findingSignature);
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
      const actual = await computeParity(corpusDir);
      if (update) {
        writeFileSync(expectedPath, `${JSON.stringify(actual, null, 2)}\n`, 'utf8');
        return;
      }
      const expected = JSON.parse(readFileSync(expectedPath, 'utf8')) as Parity;
      assert.deepStrictEqual(
        actual,
        expected,
        `${folder}: parity with the Oxygen report changed; if that is intended, rerun with UPDATE_OXYGEN_PARITY=1`,
      );
    });
  }

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
