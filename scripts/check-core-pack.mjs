// Before publishing @dita-viewer/core: pack it, check what is in the tarball,
// install the tarball into an empty project and use it the way a consumer
// would (CommonJS require, and TypeScript type resolution under node16 rules).
//
//   npm run check:core-pack
//
// Not part of `verify`: it installs from the npm registry (the package depends
// on sax), so it needs the network. Run it before every publish.
//
//   npm run check:core-portable
//
// The offline half, and part of `verify`: build core, bundle the portable entry
// for a browser with no Node built-ins available, and run the bundle in a
// context that has no require, process or Buffer. This is what keeps core
// usable where there is no Node (DESIGN.md goal G1).

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

// Bundles `entry` as a browser would (no Node built-ins, nothing external) and
// renders a topic from an in-memory file system inside a vm context that has no
// require, process or Buffer: only what a browser or worker has.
async function checkPortable(entry, resolveDir, label) {
  const esbuild = createRequire(join(root, 'package.json'))('esbuild');
  const vm = await import('node:vm');
  let code;
  try {
    code = esbuild.buildSync({
      stdin: { contents: `export * from ${JSON.stringify(entry)};`, resolveDir, loader: 'js' },
      bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'DitaCore', logLevel: 'silent',
    }).outputFiles[0].text;
  } catch (e) {
    check(false, `${label}: bundles for a browser with no Node built-ins: ${(e.errors || []).map((x) => x.text).join('; ') || e.message}`);
    return;
  }
  check(true, `${label}: bundles for a browser with no Node built-ins (${Math.round(code.length / 1024)} KB)`);
  check(!/require\(["'](node:)?(fs|path|os|url|child_process|crypto|util|buffer)["']\)/.test(code), `${label}: the bundle requires no Node built-in`);
  // (sax tries require('stream') inside try/catch and works without it, so `stream` is not on the list.)
  try {
    const sandbox = { TextEncoder, TextDecoder, console };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    const out = vm.runInContext(
      `(() => {
        const C = DitaCore;
        if (typeof require !== 'undefined' || typeof process !== 'undefined' || typeof Buffer !== 'undefined') throw new Error('sandbox is not clean');
        const fs = C.createMemoryFileSystem({ '/ws/other.dita': '<topic id="o"><title>Other</title></topic>', '/ws/i.png': new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,1,44,0,0,0,100]) });
        const engine = C.createEngine({ fs, path: C.posixPath });
        const html = engine.renderTopicXml({ xml: '<topic id="t"><title>Hello</title><body><p>x <xref href="other.dita"/></p><fig><image href="i.png"/></fig></body></topic>', docDir: '/ws', keyMap: new Map(), asWebviewUri: (p) => p, headingLevel: 1 }).html;
        const ast = C.parseDita('<topic id="t"><title>T</title></topic>');
        return JSON.stringify({ html, root: !!ast.root, pure: typeof C.complete, none: typeof C.renderTopicXml });
      })()`,
      sandbox,
    );
    const r = JSON.parse(out);
    check(/Hello/.test(r.html) && /Other/.test(r.html) && /width="300"/.test(r.html) && r.root && r.pure === 'function' && r.none === 'undefined',
      `${label}: renders from an in-memory file system in a context with no require, process or Buffer`);
  } catch (e) {
    check(false, `${label}: runs with no Node globals: ${e.message}`);
  }
}

if (process.argv.includes('--portable')) {
  try {
    npm(['run', 'build', '-w', '@dita-viewer/core'], root);
    await checkPortable(join(pkgDir, 'dist-esm', 'portable.js'), pkgDir, 'portable entry');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nportable check passed.');
  process.exit(0);
}

try {
  // npm pack runs prepublishOnly's sibling lifecycle for `pack`, not publish; build explicitly.
  npm(['run', 'build', '-w', '@dita-viewer/core'], root);
  const packOutput = npm(['pack', '--json', '--pack-destination', work], pkgDir);
  // `npm pack --json` does not print the same shape everywhere, and a failing
  // pack can print { "error": ... } with a zero exit status. Accept every
  // known shape and, when none has a file list, show npm's own output
  // instead of a TypeError.
  let packJson;
  try {
    packJson = JSON.parse(packOutput);
  } catch {
    throw new Error(`npm pack --json did not print JSON:\n${packOutput}`);
  }
  // Three shapes seen: [entry] (npm 10), entry itself, and { "<package name>":
  // entry } (an npm that prints per-workspace results keyed by name, as on
  // Termux with Node 26).
  const info = Array.isArray(packJson)
    ? packJson[0]
    : Array.isArray(packJson?.files)
      ? packJson
      : Object.values(packJson ?? {}).find((v) => v && Array.isArray(v.files));
  if (!info || !Array.isArray(info.files)) {
    throw new Error(`npm pack --json has no file list; npm printed:\n${packOutput}`);
  }
  const files = info.files.map((f) => f.path);
  const has = (p) => files.includes(p);
  check(has('LICENSE'), 'tarball has LICENSE');
  check(has('README.md') && has('package.json'), 'tarball has README.md and package.json');
  check(has('dist/index.js') && has('dist/index.d.ts'), 'tarball has dist/index.js and dist/index.d.ts');
  check(has('dist-esm/index.js') && has('dist-esm/package.json'), 'tarball has dist-esm/index.js, the ES module build for bundlers');
  check(has('dist/portable.js') && has('dist/portable.d.ts') && has('dist-esm/portable.js'), 'tarball has the portable entry (CommonJS, types, ES module)');
  check(has('dist/node/index.js') && has('dist/node/index.d.ts') && has('dist-esm/node/index.js'), 'tarball has the node entry (CommonJS, types, ES module)');
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

  // The subpath entries, from the installed package: CommonJS, ES module, a browser bundle, types.
  try {
    const out = run('node', ['-e', `
      const p = require('@dita-viewer/core/portable');
      const n = require('@dita-viewer/core/node');
      if (typeof p.createEngine !== 'function' || typeof p.parseDita !== 'function' || 'renderTopicXml' in p) throw new Error('portable surface');
      const e = n.createNodeEngine();
      const html = e.renderTopicXml({ xml: '<topic id="t"><title>Hello</title></topic>', docDir: process.cwd(), keyMap: new Map(), asWebviewUri: (x) => x, headingLevel: 1 }).html;
      if (!/Hello/.test(html) || typeof n.nodePlatform.fs.readText !== 'function') throw new Error('node engine');
      console.log('ok');`], consumer).trim();
    check(out === 'ok', 'a CommonJS consumer can use the portable and node entries');
  } catch (e) {
    check(false, `a CommonJS consumer can use the portable and node entries: ${e.stderr || e.message}`);
  }
  try {
    const out = run(process.execPath, ['--input-type=module', '-e', "import { createEngine, posixPath, createMemoryFileSystem } from '@dita-viewer/core/portable'; import { createNodeEngine } from '@dita-viewer/core/node'; console.log([typeof createEngine, typeof posixPath.join, typeof createMemoryFileSystem, typeof createNodeEngine].join());"], consumer).trim();
    check(out === 'function,function,function,function', 'a Node ES module consumer can import the portable and node entries');
  } catch (e) {
    check(false, `a Node ES module consumer can import the portable and node entries: ${e.stderr || e.message}`);
  }
  await checkPortable('@dita-viewer/core/portable', consumer, 'installed portable entry');

  writeFileSync(
    join(consumer, 'use-subpaths.ts'),
    `import { createEngine, createMemoryFileSystem, posixPath, parseDita, type Engine, type Platform, type FileSystem } from '@dita-viewer/core/portable';
import { createNodeEngine, nodePlatform } from '@dita-viewer/core/node';
const platform: Platform = { fs: createMemoryFileSystem({ '/a.dita': '<topic id="a"/>' }) satisfies FileSystem, path: posixPath };
const engine: Engine = createEngine(platform);
const html: string = engine.renderTopicXml({ xml: '', docDir: '/', keyMap: new Map(), asWebviewUri: (p) => p, headingLevel: 1 }).html;
const node: Engine = createNodeEngine();
export { html, node, nodePlatform, parseDita };
`,
  );
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
    JSON.stringify({ compilerOptions: { module: 'node16', moduleResolution: 'node16', target: 'es2022', strict: true, noEmit: true, skipLibCheck: false, types: ['node'] }, files: ['use.ts', 'use-subpaths.ts'] }),
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
