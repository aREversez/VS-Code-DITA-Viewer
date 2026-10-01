#!/usr/bin/env node
// Packaging checker: build the .vsix and assert its contents.
// Run via `npm run check:package` (which runs vsce first). Exits non-zero if a
// required asset is missing or a development-only path leaked into the package.
//
// Why this exists: .vscodeignore keeps test-dita-file/** and src/** out, while
// the shipped templates, the pdf-customization tree and the DITA-OT plugin must
// travel WITH the extension -- a typo there is only discovered after a user
// installs the vsix, which CI never exercises. This turns that silent contract
// into a green/red gate.
//
// vsce wraps every file under `extension/` inside the vsix (a zip), so all
// patterns below are written against that prefix.
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// Must be present, by exact path.
const REQUIRED_FILES = [
  'extension/package.json',
  'extension/dist/extension.js',
  'extension/l10n/bundle.l10n.json',
  'extension/l10n/bundle.l10n.zh-cn.json',
  'extension/snippets/dita.json',
  'extension/snippets/ditamap.json',
  'extension/media/icons/extension-icon.png',
  'extension/media/fonts/dita-viewer-icons.woff',
];

// Must have at least one entry beneath them (contents are data, not one file).
const REQUIRED_DIRS = [
  'extension/media/templates/',
  'extension/media/pdf-customization/',
  'extension/media/dita-ot-plugins/',
];

// Must NOT appear at all -- source, test fixtures, CI config, dev build output
// and the dev-only toolchain configs belong on disk, not in a user's install.
// dist-test/ and dist-test-visual/ are the two tsc test-output dirs; test-visual/
// holds Playwright screenshots -- both leak into the vsix if .vscodeignore drifts
// (it had, for the -visual siblings of already-ignored paths).
const FORBIDDEN = [
  'extension/src/',
  'extension/test-dita-file/',
  'extension/.github/',
  'extension/dist-test/',
  'extension/dist-test-visual/',
  'extension/test-visual/',
  'extension/tsconfig.visual.json',
  'extension/.mocharc.visual.json',
];

/** Read every entry name from a zip's central directory (no inflate, no deps). */
function readZipEntryNames(buf) {
  const SIG_EOCD = 0x06054b50;
  const SIG_CENTRAL = 0x02014b50;
  let eocd = -1;
  const minStart = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (i >= 0 && buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip archive: end-of-central-directory not found');
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) {
      throw new Error(`corrupt central directory at offset ${p} (entry ${n} of ${total})`);
    }
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    names.push(buf.toString('utf8', p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

function findVsix() {
  const explicit = process.argv[2];
  if (explicit) {
    const abs = path.isAbsolute(explicit) ? explicit : path.join(root, explicit);
    if (!fs.existsSync(abs)) throw new Error(`vsix not found: ${abs}`);
    return abs;
  }
  // Newest .vsix in the repo root (vsce writes <name>-<version>.vsix there).
  const candidates = fs
    .readdirSync(root)
    .filter((f) => f.endsWith('.vsix'))
    .map((f) => ({ f, m: fs.statSync(path.join(root, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (!candidates.length) throw new Error('no .vsix in repo root -- run `npm run check:package`');
  return path.join(root, candidates[0].f);
}

function main() {
  const vsix = findVsix();
  const names = new Set(readZipEntryNames(fs.readFileSync(vsix)));
  console.log(`checking ${path.basename(vsix)} (${names.size} entries)`);

  const missingFiles = REQUIRED_FILES.filter((f) => !names.has(f));
  const missingDirs = REQUIRED_DIRS.filter((d) => ![...names].some((n) => n.startsWith(d)));
  const leaked = FORBIDDEN.filter((d) => [...names].some((n) => n.startsWith(d)));

  if (missingFiles.length) {
    console.error(`\nMISSING required files (${missingFiles.length}):`);
    missingFiles.forEach((f) => console.error(`    ${f}`));
  }
  if (missingDirs.length) {
    console.error(`\nMISSING required directories (${missingDirs.length}) -- nothing shipped beneath them:`);
    missingDirs.forEach((d) => console.error(`    ${d}`));
  }
  if (leaked.length) {
    console.error(`\nFORBIDDEN paths present (${leaked.length}) -- dev-only content shipped to users:`);
    leaked.forEach((d) => console.error(`    ${d}`));
  }

  const problems = missingFiles.length + missingDirs.length + leaked.length;
  console.log(`\n${problems === 0 ? 'OK' : 'PROBLEMS: ' + problems}`);
  process.exit(problems === 0 ? 0 : 1);
}

try {
  main();
} catch (e) {
  console.error(`check-package failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
