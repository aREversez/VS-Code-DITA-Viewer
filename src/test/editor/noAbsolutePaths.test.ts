import * as assert from 'assert';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

// __dirname is dist-test/test/editor at runtime, so the repo root is three up.
const repoRoot = join(__dirname, '..', '..', '..');
const dirs = [
  join(repoRoot, 'test-dita-file', 'completeness-corpus'),
  join(repoRoot, 'test-dita-file', 'completeness-corpus-2'),
  join(repoRoot, 'test-dita-file', 'completeness-corpus-3'),
  join(repoRoot, 'test-dita-file', 'completeness-corpus-4'),
  join(repoRoot, 'test-dita-file', 'completeness-corpus-5'),
  join(repoRoot, 'test-dita-file', 'completeness-outside'),
];

// A Windows drive-letter absolute path (H:\..., C:/...). The negative lookbehind
// skips protocol schemes such as https://, where the colon follows a letter, so
// only a standalone drive letter is flagged. Committed test data must be relative.
const DRIVE_ABSOLUTE = /(?<![A-Za-z])[A-Za-z]:[\\/]/;

// A POSIX home-directory path (/Users/<name>/..., /home/<name>/...) or a UNC share
// (\\\\host\\share): the same per-machine leak on macOS, Linux and shared drives.
const HOME_OR_UNC = /(?:^|[\s"'=(>])\/(?:Users|home)\/[^\s"'/]+\/|\\\\[A-Za-z0-9_.-]+\\[A-Za-z0-9_.$-]+/;
// A probe that is about absolute references (completeness-corpus-2) has to contain one. Such
// a line says so with `probe-absolute-path` and uses a made-up location (Z:\\probe\\...), never
// a real one; every other line is still held to the rule.
const PROBE_MARK = /probe-absolute-path/;
const MACHINE_PATH = (line: string): boolean =>
  !PROBE_MARK.test(line) && (DRIVE_ABSOLUTE.test(line) || HOME_OR_UNC.test(line));

// Only files that hold genuine per-machine output are guarded: the corpus topics,
// the map, the real Oxygen report and the baselines. Markdown is documentation
// that legitimately shows example setup paths (e.g. `C:\\OxygenAll`), and the
// `.sample.` report is a parser fixture whose fabricated `D:\\corpus` paths are
// asserted verbatim to prove Windows-path normalization -- neither is a leak.
// `.raw.xml` is Oxygen's un-sanitized output on the developer's machine; it is
// listed in `.gitignore` and never committed, so guarding it here would just
// fail whenever someone regenerates it locally.
const GUARDED_EXT = /\.(?:dita|ditamap|ditaval|xml|json)$/i;
const SAMPLE_FIXTURE = /\.sample\./i;
const LOCAL_RAW_REPORT = /\.raw\.xml$/i;

function isGuarded(file: string): boolean {
  return GUARDED_EXT.test(file) && !SAMPLE_FIXTURE.test(file) && !LOCAL_RAW_REPORT.test(file);
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
  it('exempts only a line that is marked as an absolute-path probe', () => {
    assert.strictEqual(MACHINE_PATH('<topicref href="Z:\\probe\\x.dita"/>'), true);
    assert.strictEqual(MACHINE_PATH('<topicref href="Z:\\probe\\x.dita"/> <!-- probe-absolute-path -->'), false);
    assert.strictEqual(MACHINE_PATH('<!-- probe-absolute-path --> <p>/Users/someone/x</p>'), false);
    assert.strictEqual(MACHINE_PATH('<p>fine</p>'), false);
  });

  it('no corpus or report file contains a drive-letter, home-directory or UNC path', () => {
    const offenders: string[] = [];
    for (const dir of dirs) {
      for (const file of walk(dir)) {
        const lines = readFileSync(file, 'utf8').split(/\r?\n/);
        lines.forEach((line, i) => {
          if (MACHINE_PATH(line)) {
            offenders.push(`${file.replace(repoRoot, '')}:${i + 1}: ${line.trim().slice(0, 80)}`);
          }
        });
      }
    }
    assert.deepStrictEqual(
      offenders,
      [],
      `privacy: a machine-specific absolute path was committed in test data:\n${offenders.join('\n')}\n` +
        'make paths relative to the corpus folder instead.',
    );
  });
});
