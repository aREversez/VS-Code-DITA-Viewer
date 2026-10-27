// Before publishing @dita-viewer/core: pack it, check what is in the tarball,
// install the tarball into an empty project and use it the way a consumer
// would (CommonJS require, and TypeScript type resolution under node16 rules).
//
//   npm run check:core-pack
//
// Not part of `verify`: it installs from the npm registry (the package depends
// on sax), so it needs the network. Run it before every publish.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'packages', 'core');
const work = mkdtempSync(join(tmpdir(), 'dita-core-pack-'));
// `npm run` re-exports every npm config as an npm_config_* env var, and a nested
// npm reads those as if they were flags. A user-level `allow-scripts=` entry then
// lands in the consumer install below and fails with EALLOWSCRIPTS ("--allow-scripts
// is not allowed in project-scoped installs"). Drop that inheritance: the throwaway
// consumer is its own project, it should not pick up the developer's global policy.
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^npm_config_(allow_scripts|dangerously_allow_all_scripts)$/i.test(key)) delete env[key];
}
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
// npm is a .cmd shim on Windows, which cannot be spawned by name without a
// shell. When started through `npm run`, npm tells us where its own script is;
// run that with this node. Otherwise fall back to the plain command.
const npm = (args, cwd) =>
  process.env.npm_execpath && process.env.npm_execpath.endsWith('.js')
    ? run(process.execPath, [process.env.npm_execpath, ...args], cwd)
    : execFileSync('npm', args, { cwd, env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
};

try {
  // npm pack runs prepublishOnly's sibling lifecycle for `pack`, not publish; build explicitly.
  npm(['run', 'build', '-w', '@dita-viewer/core'], root);
  const info = JSON.parse(npm(['pack', '--json', '--pack-destination', work], pkgDir))[0];
  const files = info.files.map((f) => f.path);
  const has = (p) => files.includes(p);
  check(has('LICENSE'), 'tarball has LICENSE');
  check(has('README.md') && has('package.json'), 'tarball has README.md and package.json');
  check(has('dist/index.js') && has('dist/index.d.ts'), 'tarball has dist/index.js and dist/index.d.ts');
  check(has('dist-esm/index.js') && has('dist-esm/package.json'), 'tarball has dist-esm/index.js, the ES module build for bundlers');
  check(has('styles/dita-content.css') && has('styles/TOKENS.md'), 'tarball has the stylesheet and the token contract');
  check(!files.some((f) => f.endsWith('.map')), 'tarball has no source maps');
  check(!files.some((f) => f.startsWith('src/') || f.startsWith('test/') || f.startsWith('dist-test/')), 'tarball has no src, test or dist-test');

  const consumer = join(work, 'consumer');
  mkdirSync(consumer, { recursive: true });
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'consumer', version: '1.0.0', private: true }));
  npm(['install', join(work, info.filename), 'typescript@5', '@types/node@20', '--no-audit', '--no-fund'], consumer);

  writeFileSync(
    join(consumer, 'use.cjs'),
    `const core = require('@dita-viewer/core');
const doc = core.parseDita('<topic id="t"><title>T</title></topic>');
const r = core.renderTopicXml({ xml: '<topic id="t"><title>Hello</title><body><p>x</p></body></topic>', docDir: process.cwd(), keyMap: new Map(), asWebviewUri: (p) => p, headingLevel: 1 });
if (!doc.root || !/Hello/.test(r.html)) throw new Error('render failed');
console.log(Object.keys(core).length);`,
  );
  let exportCount = 0;
  try {
    exportCount = Number(run('node', ['use.cjs'], consumer).trim());
    check(exportCount > 30, `a CommonJS consumer can require it and render (${exportCount} exports)`);
  } catch (e) {
    check(false, `a CommonJS consumer can require it and render: ${e.stderr || e.message}`);
  }
  check(readdirSync(join(consumer, 'node_modules', '@dita-viewer', 'core', 'styles')).includes('dita-content.css'), 'the stylesheet is installed');

  // Node ignores the "module" condition, so a plain Node ES module import must still
  // land on the CommonJS build.
  try {
    const out = run(process.execPath, ['--input-type=module', '-e', "import { parseDita } from '@dita-viewer/core'; console.log(typeof parseDita);"], consumer).trim();
    check(out === 'function', 'a Node ES module consumer can import it');
  } catch (e) {
    check(false, `a Node ES module consumer can import it: ${e.stderr || e.message}`);
  }

  // A bundler takes dist-esm through the "module" condition and can drop what is not used:
  // importing only the parser must leave out the site renderer and the diagnostics.
  try {
    const esbuild = createRequire(join(root, 'package.json'))('esbuild');
    const bundled = esbuild.buildSync({
      stdin: { contents: "import { parseDita } from '@dita-viewer/core'; console.log(typeof parseDita);", resolveDir: consumer, loader: 'js' },
      bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent',
    }).outputFiles[0].text;
    check(!bundled.includes('renderSiteXml') && !bundled.includes('collectDiagnostics'), `a bundler drops the modules it does not use (${Math.round(bundled.length / 1024)} KB for the parser alone)`);
  } catch (e) {
    check(false, `a bundler drops the modules it does not use: ${e.message}`);
  }

  writeFileSync(
    join(consumer, 'use.ts'),
    `import { parseDita, renderTopicXml, type DitaDocument, type DitaNode } from '@dita-viewer/core';
const doc: DitaDocument = parseDita('<topic id="t"/>');
const node: DitaNode = doc.root;
const html: string = renderTopicXml({ xml: '', docDir: '.', keyMap: new Map(), asWebviewUri: (p) => p, headingLevel: 1 }).html;
export { node, html };
`,
  );
  writeFileSync(
    join(consumer, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { module: 'node16', moduleResolution: 'node16', target: 'es2022', strict: true, noEmit: true, skipLibCheck: false, types: ['node'] }, files: ['use.ts'] }),
  );
  try {
    run(process.execPath, [join(consumer, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'], consumer);
    check(true, 'a TypeScript consumer resolves the types (node16 resolution)');
  } catch (e) {
    check(false, `a TypeScript consumer resolves the types: ${e.stdout || e.message}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed; do not publish.`);
  process.exit(1);
}
console.log('\npack check passed.');
