#!/usr/bin/env node
// Makes a real Oxygen report safe to commit: paths under the corpus become relative
// to it, and the script refuses to write anything that still holds a machine path.
//
//   node scripts/sanitize-oxygen-report.cjs <raw-report.xml> [--root <corpus dir as it
//     appears in the report>] [--out <file>]     (default out: the committed report)
//
// Without --out it writes oxygen-report.xml in the corpus folder (--corpus <folder>,
// default completeness-corpus).
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
const DEFAULT_OUT = path.join(ROOT, 'test-dita-file', CORPUS_FOLDER, 'oxygen-report.xml');

async function loadAdapter() {
  const out = path.join(os.tmpdir(), `dita-oxygen-sanitize-${process.pid}.cjs`);
  await esbuild.build({
    stdin: {
      contents: "export * from '../src/test/editor/oxygenReport';",
      resolveDir: path.join(ROOT, 'scripts'),
      loader: 'ts',
    },
    outfile: out, bundle: true, format: 'cjs', platform: 'node', external: ['vscode'], logLevel: 'silent',
  });
  const realLoad = Module._load;
  Module._load = (request, ...rest) => (request === 'vscode' ? { l10n: { t: (m) => m } } : realLoad(request, ...rest));
  try {
    return require(out);
  } finally {
    Module._load = realLoad;
    fs.rmSync(out, { force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const at = args.indexOf(name);
    return at === -1 ? undefined : args[at + 1];
  };
  const skip = new Set(['--root', '--out'].flatMap((n) => (args.includes(n) ? [args.indexOf(n) + 1] : [])));
  const input = args.filter((a, i) => !a.startsWith('--') && !skip.has(i))[0];
  if (!input) {
    console.error('usage: node scripts/sanitize-oxygen-report.cjs <raw-report.xml> [--root <dir>] [--out <file>]');
    process.exit(2);
  }
  const mod = await loadAdapter();
  const xml = fs.readFileSync(input, 'utf8');
  const root = opt('--root') ?? mod.corpusRootFromReport(mod.parseOxygenReportAuto(xml));
  if (!root) {
    console.error('cannot tell the corpus folder from the report; pass --root <dir as written in the report>');
    process.exit(2);
  }
  const res = mod.sanitizeOxygenReport(xml, root);
  if (res.leftovers.length) {
    console.error('the report is not safe to commit (machine paths remain, or it was run on another root map); nothing written:');
    for (const l of res.leftovers) console.error(`  ${l}`);
    process.exit(1);
  }
  const out = opt('--out') ?? DEFAULT_OUT;
  fs.writeFileSync(out, res.xml, 'utf8');
  console.log(`wrote ${path.relative(ROOT, out)} (root ${root} made relative)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
