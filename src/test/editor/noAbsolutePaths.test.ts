import * as assert from 'assert';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

// __dirname is dist-test/test/editor at runtime, so the repo root is three up.
const repoRoot = join(__dirname, '..', '..', '..');
const dirs = [
  join(repoRoot, 'test-dita-file', 'completeness-corpus'),
  join(repoRoot, 'test-dita-file', 'completeness-outside'),
];

// A Windows drive-letter absolute path (H:\..., C:/...). The negative lookbehind
// skips protocol schemes such as https://, where the colon follows a letter, so
// only a standalone drive letter is flagged. Committed test data must be relative.
const DRIVE_ABSOLUTE = /(?<![A-Za-z])[A-Za-z]:[\\/]/;

// Only files that hold genuine per-machine output are guarded: the corpus topics,
// the map, the real Oxygen report and the baselines. Markdown is documentation
// that legitimately shows example setup paths (e.g. `C:\\OxygenAll`), and the
// `.sample.` report is a parser fixture whose fabricated `D:\\corpus` paths are
// asserted verbatim to prove Windows-path normalization -- neither is a leak.
const GUARDED_EXT = /\.(?:dita|ditamap|xml|json)$/i;
const SAMPLE_FIXTURE = /\.sample\./i;

function isGuarded(file: string): boolean {
  return GUARDED_EXT.test(file) && !SAMPLE_FIXTURE.test(file);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (isGuarded(p)) out.push(p);
  }
  return out;
}

describe('committed test data carries no machine paths', () => {
  it('no corpus or report file contains a drive-letter absolute path', () => {
    const offenders: string[] = [];
    for (const dir of dirs) {
      for (const file of walk(dir)) {
        const lines = readFileSync(file, 'utf8').split(/\r?\n/);
        lines.forEach((line, i) => {
          if (DRIVE_ABSOLUTE.test(line)) {
            offenders.push(`${file.replace(repoRoot, '')}:${i + 1}: ${line.trim().slice(0, 80)}`);
          }
        });
      }
    }
    assert.deepStrictEqual(
      offenders,
      [],
      `privacy: a drive-letter absolute path was committed in test data:\n${offenders.join('\n')}\n` +
        'make paths relative to the corpus folder instead.',
    );
  });
});
