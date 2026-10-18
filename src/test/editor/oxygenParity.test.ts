import * as assert from 'assert';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  NormalizedFinding,
  canonicalCategory,
  collectExtensionFindings,
  diffKeys,
  findingSignature,
} from './completenessHarness';
import { corpusRootFromReport, normalizeOxygenFindings, parseOxygenReportAuto } from './oxygenReport';

// __dirname is dist-test/test/editor at runtime, so the repo root is three up.
const repoRoot = join(__dirname, '..', '..', '..');
const corpusDir = join(repoRoot, 'test-dita-file', 'completeness-corpus');
const reportPath = join(corpusDir, 'oxygen-report.xml');
const expectedPath = join(corpusDir, 'oxygen-parity.expected.json');

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

async function computeParity(): Promise<Parity> {
  const incidents = parseOxygenReportAuto(readFileSync(reportPath, 'utf8'));
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
  it('matches the committed parity state, so any change in parity is deliberate', async () => {
    const actual = await computeParity();
    if (update) {
      writeFileSync(expectedPath, `${JSON.stringify(actual, null, 2)}\n`, 'utf8');
      return;
    }
    const expected = JSON.parse(readFileSync(expectedPath, 'utf8')) as Parity;
    assert.deepStrictEqual(
      actual,
      expected,
      'parity with the Oxygen report changed; if that is intended, rerun with UPDATE_OXYGEN_PARITY=1',
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
