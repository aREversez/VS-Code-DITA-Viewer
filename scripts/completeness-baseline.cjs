// Phase-0 differential tooling for "Validate and Check for Completeness".
//
//   node scripts/completeness-baseline.cjs                 # list the findings
//   node scripts/completeness-baseline.cjs --update        # rewrite the extension baseline
//   node scripts/completeness-baseline.cjs --diff <file>   # diff against another findings JSON
//
// The "extension side" is produced by bundling the pure harness
// (src/test/editor/completenessHarness.ts) with esbuild. The "Oxygen side" is
// produced outside this repo by Oxygen's own completeness check and saved in the
// same normalized JSON shape; see
// test-dita-file/completeness-corpus/README.md.
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require('esbuild');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');

// --corpus <folder under test-dita-file/> selects the corpus (default: completeness-corpus).
const CORPUS_FOLDER = (() => {
  const at = process.argv.indexOf('--corpus');
  if (at === -1) return 'completeness-corpus';
  const name = process.argv[at + 1];
  process.argv.splice(at, 2);
  return name;
})();
const CORPUS = path.join(ROOT, 'test-dita-file', CORPUS_FOLDER);
const BASELINE = path.join(CORPUS, 'baseline.extension.json');

// The harness chain is vscode-free, but stub it so a future transitive import
// cannot break the bundle (the same trick scripts/check-map-message-parity.cjs uses).
const realLoad = Module._load;
const stubLoad = () => {
  Module._load = (request, ...rest) =>
    request === 'vscode' ? { l10n: { t: (message) => message } } : realLoad(request, ...rest);
};

async function loadHarness() {
  const out = path.join(os.tmpdir(), `dita-completeness-${process.pid}.cjs`);
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'test', 'editor', 'completenessHarness.ts')],
    outfile: out,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    external: ['vscode'],
    logLevel: 'silent',
  });
  stubLoad();
  try {
    return require(out);
  } finally {
    Module._load = realLoad;
    fs.rmSync(out, { force: true });
  }
}

async function main() {
  const harness = await loadHarness();
  const run = await harness.collectExtensionFindings(CORPUS);
  const args = process.argv.slice(2);

  if (args.includes('--update')) {
    fs.writeFileSync(BASELINE, harness.serializeFindings(run), 'utf8');
    console.log(`wrote ${path.relative(ROOT, BASELINE)} (${run.length} findings)`);
    return;
  }

  const diffAt = args.indexOf('--diff');
  if (diffAt !== -1) {
    const other = args[diffAt + 1];
    if (!other) throw new Error('--diff needs the path of a findings JSON file');
    const baseline = harness.parseFindings(fs.readFileSync(other, 'utf8'));
    const diff = harness.diffFindings(baseline, run);
    console.log(`\n# in ${path.basename(other)} but not produced now (${diff.onlyInBaseline.length})`);
    for (const line of diff.onlyInBaseline) console.log(`  - ${line}`);
    console.log(`\n# produced now but not in ${path.basename(other)} (${diff.onlyInRun.length})`);
    for (const line of diff.onlyInRun) console.log(`  + ${line}`);
    process.exitCode = diff.onlyInBaseline.length || diff.onlyInRun.length ? 1 : 0;
    return;
  }

  console.log(`${run.length} findings for the corpus`);
  for (const f of run) console.log(`  ${harness.findingKey(f)}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { loadHarness };
