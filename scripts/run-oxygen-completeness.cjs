// One command to produce Oxygen's findings for the corpus and diff them against
// the extension's. Wraps Oxygen Scripting's validateCheckDITA script.
//
//   node scripts/run-oxygen-completeness.cjs <OXYGEN_ALL_PLATFORMS_DIR>
//
// <OXYGEN_ALL_PLATFORMS_DIR> is the folder you extracted oxygen.tar.gz into --
// the one containing the "scripts" folder and scriptinglicensekey.txt. You can
// also set OXYGEN_SCRIPTING_HOME instead of passing it.
//
// Steps it performs:
//   1. finds scripts/validateCheckDITA.bat (Windows) or .sh (Unix) in that folder
//   2. runs it on corpus.ditamap, with corpus.settings.xml if present, writing
//      oxygen-report.xml next to the corpus
//   3. runs scripts/oxygen-diff.cjs on the report
//
// See test-dita-file/completeness-corpus/OXYGEN.md for the full explanation and
// how to export corpus.settings.xml from the Oxygen GUI.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CORPUS = path.join(ROOT, 'test-dita-file', 'completeness-corpus');
const ROOT_MAP = path.join(CORPUS, 'corpus.ditamap');
const SETTINGS = path.join(CORPUS, 'corpus.settings.xml');
const REPORT = path.join(CORPUS, 'oxygen-report.xml');

function findScript(dir) {
  const names =
    process.platform === 'win32'
      ? ['validateCheckDITA.bat', 'validateCheckDITA.sh']
      : ['validateCheckDITA.sh', 'validateCheckDITA.bat'];
  for (const base of [path.join(dir, 'scripts'), dir]) {
    for (const name of names) {
      const p = path.join(base, name);
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined;
}

function findLicense(dir) {
  for (const base of [dir, path.dirname(dir)]) {
    const p = path.join(base, 'scriptinglicensekey.txt');
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

function main() {
  const dir = process.argv[2] || process.env.OXYGEN_SCRIPTING_HOME;
  if (!dir) {
    console.error('usage: node scripts/run-oxygen-completeness.cjs <OXYGEN_ALL_PLATFORMS_DIR>');
    console.error('   or: set OXYGEN_SCRIPTING_HOME to that folder');
    process.exit(2);
  }
  if (!fs.existsSync(dir)) {
    console.error(`Not found: ${dir}`);
    process.exit(2);
  }

  const script = findScript(dir);
  if (!script) {
    console.error(`No validateCheckDITA script under ${dir} (looked in ${dir} and ${path.join(dir, 'scripts')}).`);
    console.error('Is this the Oxygen XML Editor All Platforms distribution (the one that ships a scripts/ folder)?');
    process.exit(2);
  }
  if (!findLicense(dir)) {
    console.warn(
      `Warning: no scriptinglicensekey.txt found in ${dir} (or its parent).\n` +
        'The script will fail without an Oxygen Scripting license key.\n',
    );
  }

  const args = ['-i', ROOT_MAP, '-r', REPORT];
  if (fs.existsSync(SETTINGS)) {
    args.push('-s', SETTINGS);
  } else {
    console.warn(
      `Warning: ${path.basename(SETTINGS)} is missing, so Oxygen will run with its own\n` +
        'options and the diff may show option differences rather than algorithm ones.\n' +
        'See OXYGEN.md to export it from the DITA Map Completeness Check dialog.\n',
    );
  }

  const isBat = /\.bat$/i.test(script);
  const quoted = `"${script}" ${args.map((a) => `"${a}"`).join(' ')}`;
  const invocation =
    process.platform === 'win32' || isBat
      ? { command: 'cmd.exe', args: ['/c', quoted] }
      : { command: 'sh', args: ['-c', quoted] };

  console.log(`Running ${script}\n  on ${ROOT_MAP}\n  -> ${REPORT}\n`);
  const run = spawnSync(invocation.command, invocation.args, { stdio: 'inherit' });
  if (run.error) throw run.error;
  if (run.status !== 0) {
    console.error(`\nvalidateCheckDITA exited with code ${run.status}.`);
    console.error('Common causes: missing/invalid license key, no Java 11/17 on PATH, or a bad -s settings file.');
    process.exit(run.status ?? 1);
  }
  if (!fs.existsSync(REPORT)) {
    console.error(`\nThe script reported success but ${REPORT} was not written.`);
    process.exit(1);
  }

  console.log('\n--- diff ---\n');
  const diff = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'oxygen-diff.cjs'), REPORT], {
    stdio: 'inherit',
  });
  if (diff.error) throw diff.error;
  process.exit(diff.status ?? 0);
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
