import * as assert from 'assert';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  CORPUS_FOLDERS,
  NormalizedFinding,
  PLATFORM_DEPENDENT_FILES,
  dropPlatformDependent,
  collectExtensionFindings,
  diffFindings,
  findingKey,
  parseFindings,
  serializeFindings,
} from './completenessHarness';

// __dirname is dist-test/test/editor at runtime, so the repo root is three up.
const repoRoot = join(__dirname, '..', '..', '..');
const corpusDirOf = (folder: string): string => join(repoRoot, 'test-dita-file', folder);
// The original corpus also has to exercise every category listed below.
const corpusDir = corpusDirOf('completeness-corpus');

// Set UPDATE_COMPLETENESS_BASELINE=1 to regenerate the committed baseline.
const updateBaseline = process.env.UPDATE_COMPLETENESS_BASELINE === '1';

describe('Validate and Check for Completeness: Oxygen differential baseline', () => {
  for (const folder of CORPUS_FOLDERS) {
    it(`${folder}: locks the extension findings to the committed baseline`, async () => {
      const dir = corpusDirOf(folder);
      const baselinePath = join(dir, 'baseline.extension.json');
      const complete = await collectExtensionFindings(dir);
      const run = dropPlatformDependent(folder, complete);
      if (updateBaseline) {
        assert.ok(
          !(folder in PLATFORM_DEPENDENT_FILES) || process.platform === 'win32',
          `${folder} has Windows-dependent probes: refresh its baseline on Windows`,
        );
        writeFileSync(baselinePath, serializeFindings(complete), 'utf8');
        return;
      }
      const baseline = dropPlatformDependent(folder, parseFindings(readFileSync(baselinePath, 'utf8')));
      const diff = diffFindings(baseline, run);
      assert.deepStrictEqual(
        diff.onlyInRun,
        [],
        `findings the extension now reports but the baseline does not:\n${diff.onlyInRun.join('\n')}`,
      );
      assert.deepStrictEqual(
        diff.onlyInBaseline,
        [],
        `findings the baseline has but the extension no longer reports:\n${diff.onlyInBaseline.join('\n')}`,
      );
    });
  }

  it('exercises every check category the corpus is meant to cover', async () => {
    const run = await collectExtensionFindings(corpusDir);
    const categories = new Set(run.map((f) => f.category));
    const expected = [
      'validation',
      'missing-reference',
      'undefined-key',
      'outside-folder',
      'unreferenced-link',
      'multiple-reference',
      'duplicate-id',
      'duplicate-key',
      'unreferenced-key',
      'unreferenced-reusable',
      'table-layout',
      'profiling-conflict',
      'profiling-preference',
    ];
    const missing = expected.filter((c) => !categories.has(c));
    assert.deepStrictEqual(
      missing,
      [],
      `corpus produced no finding for: ${missing.join(', ')}`,
    );
  });

  it('reports a symmetric difference by finding key', () => {
    const a: NormalizedFinding[] = [
      {
        category: 'x',
        severity: 'warning',
        file: 'a.dita',
        line: 1,
        message: 'm',
      },
    ];
    const b: NormalizedFinding[] = [
      {
        category: 'x',
        severity: 'warning',
        file: 'a.dita',
        line: 1,
        message: 'm',
      },
      {
        category: 'y',
        severity: 'error',
        file: 'b.dita',
        line: 2,
        message: 'n',
      },
    ];
    const diff = diffFindings(a, b);
    assert.deepStrictEqual(diff.onlyInBaseline, []);
    assert.deepStrictEqual(diff.onlyInRun, [findingKey(b[1])]);
  });
});
