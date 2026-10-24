// Compare the extension's completeness findings against Oxygen's, for the fixed
// corpus. Signature-level (file + category), because wording and line numbers
// legitimately differ between the two tools.
//
//   node scripts/oxygen-diff.cjs <oxygen-report.xml> [--corpus <folder>]
//
// The Oxygen report is produced outside this repo by Oxygen Scripting:
//   sh scripts/validateCheckDITA.sh -i <corpus>/corpus.ditamap \
//       -s <corpus>/corpus.settings.xml -r oxygen-report.xml
// See test-dita-file/completeness-corpus/OXYGEN.md. A committed sample exists at
// test-dita-file/completeness-corpus/oxygen-report.sample.xml.
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

const ENTRY = [
  "export * from '../src/test/editor/completenessHarness';",
  "export * from '../src/test/editor/oxygenReport';",
].join('\n');

async function loadModules() {
  const out = path.join(os.tmpdir(), `dita-oxygen-diff-${process.pid}.cjs`);
  await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: path.join(ROOT, 'scripts'), loader: 'ts' },
    outfile: out,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    external: ['vscode'],
    logLevel: 'silent',
  });
  const realLoad = Module._load;
  Module._load = (request, ...rest) =>
    request === 'vscode' ? { l10n: { t: (m) => m } } : realLoad(request, ...rest);
  try {
    return require(out);
  } finally {
    Module._load = realLoad;
    fs.rmSync(out, { force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const rootAt = args.indexOf('--corpus-root');
  const explicitRoot = rootAt !== -1 ? args[rootAt + 1] : undefined;
  const skip = rootAt !== -1 ? rootAt + 1 : -1;
  const reportPath = args.filter((a, i) => !a.startsWith('--') && i !== skip)[0];
  if (!reportPath) {
    console.error(
      'usage: node scripts/oxygen-diff.cjs <oxygen-report.xml|json> [--corpus <folder>] [--corpus-root <dir>]',
    );
    process.exit(2);
  }

  const mod = await loadModules();
  const extension = await mod.collectExtensionFindings(CORPUS);
  const incidents = mod.parseOxygenReportAuto(fs.readFileSync(reportPath, 'utf8'));
  // Default to the folder the report was produced from, so a report saved on
  // another machine (another drive, another OS) still lines up with the corpus.
  const oxygenRoot = explicitRoot ?? mod.corpusRootFromReport(incidents) ?? CORPUS;
  const oxygenAll = mod.normalizeOxygenFindings(oxygenRoot, incidents);
  // Probe files whose result depends on the OS are compared on Windows only (see
  // PLATFORM_DEPENDENT_FILES), exactly as the tests do.
  const extensionKept = mod.dropPlatformDependent(CORPUS_FOLDER, extension);
  const oxygen = mod.dropPlatformDependent(CORPUS_FOLDER, oxygenAll);
  if (extensionKept.length !== extension.length || oxygen.length !== oxygenAll.length) {
    console.log(`# off Windows: ${extension.length - extensionKept.length + oxygenAll.length - oxygen.length} finding(s) of platform-dependent probe files left out of the comparison`);
  }

  const extSigs = extensionKept.map(mod.findingSignature);
  const oxSigs = oxygen.map(mod.findingSignature);
  const diff = mod.diffKeys(extSigs, oxSigs);

  const unmapped = mod.unmappedProblemIds(incidents);
  if (unmapped.length) {
    console.log('# Oxygen problem IDs not yet mapped to an extension category');
    console.log('# (add confirmations to PROBLEM_ID_CATEGORY in src/test/editor/oxygenReport.ts):');
    for (const id of unmapped) console.log(`  ${id}`);
    console.log('');
  }

  // Incidents the extension deliberately does not answer (ACCEPTED_PROBLEM_IDS and
  // ACCEPTED_DESCRIPTIONS): listed for the record, kept out of the exit code.
  const accepted = mod.acceptedFindings(oxygenRoot, incidents);
  if (accepted.length) {
    console.log(`# accepted differences (not counted) [${accepted.length}]`);
    for (const a of accepted)
      console.log(`  ~ ${a.file}:${a.line}  ${a.problemID || '(no id)'}  ${a.reason}`);
    console.log('');
  }

  console.log(`report:     ${reportPath}`);
  console.log(`oxygen root:${oxygenRoot}`);
  console.log(`extension findings: ${extensionKept.length}   Oxygen incidents: ${oxygen.length}`);
  console.log(`signatures matched: ${new Set(extSigs.filter((s) => oxSigs.includes(s))).size}`);
  console.log(`\n# extension only (found here, not by Oxygen) [${diff.onlyInA.length}]`);
  for (const s of diff.onlyInA) console.log(`  - ${s.replace('\t', '  ')}`);
  console.log(`\n# Oxygen only (found by Oxygen, not here) [${diff.onlyInB.length}]`);
  for (const s of diff.onlyInB) console.log(`  + ${s.replace('\t', '  ')}`);

  process.exitCode = diff.onlyInA.length || diff.onlyInB.length ? 1 : 0;
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
