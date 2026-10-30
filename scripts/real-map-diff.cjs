#!/usr/bin/env node
// Differential run on a real map (test-dita-file/completeness-corpus/REAL-MAP.md): the same
// extension-vs-Oxygen comparison as oxygen-diff.cjs, but on a map that cannot be committed, with
// output that can be shared: no paths, file names, lines or messages, only counts, categories and
// opaque file labels. The label-to-file table is written to a private file that stays local.
//
//   node scripts/real-map-diff.cjs --map <root.ditamap> --report <oxygen-report.xml>
//     [--oxygen-root <dir>]      folder the report's paths are relative to (default: the map's folder)
//     [--prefs <prefs.json>]     {"attributes":{"audience":["a","b"]},"singleValue":[]}
//     [--ditaval <file>]...      DITAVAL files, as chosen in Oxygen's dialog
//     [--exclude <category>]...  leave a category out of both sides (e.g. profiling-preference)
//     [--private <file>]         label table (default: real-map-diff.private.json in the cwd)
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require('esbuild');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = [
  "export * from '../src/test/editor/completenessHarness';",
  "export * from '../src/test/editor/oxygenReport';",
  "export * from '../src/test/editor/realMapDiff';",
].join('\n');

async function loadModules() {
  const out = path.join(os.tmpdir(), `dita-real-map-diff-${process.pid}.cjs`);
  await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: path.join(ROOT, 'scripts'), loader: 'ts' },
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

function options(argv) {
  const one = {};
  const many = { '--ditaval': [], '--exclude': [] };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    if (!k.startsWith('--') || argv[i + 1] === undefined) throw new Error(`bad argument: ${k}`);
    if (many[k]) many[k].push(argv[i + 1]);
    else one[k] = argv[i + 1];
  }
  return { one, many };
}

async function main() {
  const { one, many } = options(process.argv.slice(2));
  if (!one['--map'] || !one['--report']) {
    console.error('usage: node scripts/real-map-diff.cjs --map <root.ditamap> --report <oxygen-report.xml> [--oxygen-root <dir>] [--prefs <json>] [--ditaval <file>]... [--exclude <category>]... [--private <file>]');
    process.exit(2);
  }
  const mapPath = path.resolve(one['--map']);
  const dir = path.dirname(mapPath);
  const mod = await loadModules();

  const settings = {
    ditavalFiles: many['--ditaval'].map((f) => path.resolve(f)),
    preferences: one['--prefs'] ? JSON.parse(fs.readFileSync(one['--prefs'], 'utf8')) : undefined,
  };
  const extension = await mod.collectExtensionFindings(dir, { rootMap: path.basename(mapPath), settings });

  const incidents = mod.parseOxygenReportAuto(fs.readFileSync(one['--report'], 'utf8'));
  const oxygenRoot = one['--oxygen-root'] ?? dir;
  const oxygen = incidents
    .filter((i) => mod.acceptedReason(i) === undefined)
    .map((i) => ({
      file: mod.normalizeOxygenFindings(oxygenRoot, [i])[0].file,
      category: mod.categoryForProblemId(i.problemID, i.description),
      problemID: i.problemID,
    }));

  const summary = mod.summarizeRealMapDiff(
    extension.map((f) => ({ file: f.file, category: f.category })),
    oxygen,
    many['--exclude'],
  );
  const privateOut = path.resolve(one['--private'] ?? 'real-map-diff.private.json');
  fs.writeFileSync(privateOut, JSON.stringify(summary.labels, null, 2), 'utf8');
  console.log(summary.text);
  console.error(`label table (keep it local): ${privateOut}`);
  process.exitCode = summary.extensionOnly || summary.oxygenOnly ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
