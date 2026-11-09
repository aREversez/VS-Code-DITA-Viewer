#!/usr/bin/env node
// Explains an invalid-id-syntax row without leaking the id: for each file given, whether it has a
// DOCTYPE and the shape of every @id that is not an XML NCName (letters a, digits 9, non-ASCII
// letters u, whitespace _s_, other characters as they are). Prints no file name.
//
//   node scripts/id-shapes.cjs <file.dita> [<file.dita> ...]
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require('esbuild');

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('usage: node scripts/id-shapes.cjs <file> [<file> ...]');
    process.exit(2);
  }
  const out = path.join(os.tmpdir(), `dita-id-shapes-${process.pid}.cjs`);
  await esbuild.build({
    stdin: { contents: "export * from '../src/test/editor/realMapDiff';", resolveDir: __dirname, loader: 'ts' },
    outfile: out, bundle: true, format: 'cjs', platform: 'node', logLevel: 'silent',
  });
  const mod = require(out);
  fs.rmSync(out, { force: true });
  files.forEach((f, i) => {
    const r = mod.invalidIdShapes(fs.readFileSync(f, 'utf8'));
    console.log(`file ${i + 1}: DOCTYPE ${r.hasDoctype ? 'yes' : 'no'}, ${r.ids.length} invalid id(s)`);
    for (const x of r.ids) console.log(`  <${x.tag}> id shape: ${x.shape}`);
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
