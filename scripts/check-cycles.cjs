// Import-cycle check: no module may (transitively) import itself.
//
// Splitting a large file into modules is only a clean split while the imports
// still point one way; a cycle between two of the new files compiles, then
// breaks on whichever module a bundler happens to evaluate first (a `const`
// read at load time is undefined while the cycle is half-initialised). This
// walks the relative imports and re-exports of every source file under src/
// and packages/core/src/ and reports each strongly connected group of files.
//
// Edges are the relative `require` calls in each file's compiled output, so a
// type-only import (erased by the compiler) is not an edge, while a value
// import, an `export ... from` and a dynamic `import('./x')` are.
//  - Tests (src/test*, packages/core/test) and the vscode-free core are checked
//    separately from each other: a package boundary is `@dita-viewer/core`,
//    which is a bare specifier and not followed.
//
// Usage: node scripts/check-cycles.cjs
// (CHECK_CYCLES_ROOT=<dir> checks another tree with the same src/ layout; the test uses it.)
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = process.env.CHECK_CYCLES_ROOT ? path.resolve(process.env.CHECK_CYCLES_ROOT) : path.resolve(__dirname, '..');
const ROOTS = ['src', 'packages/core/src'];
const SKIP_DIR = /(^|\/)(test|test-e2e|test-visual|node_modules|dist|dist-test)(\/|$)/;

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (!SKIP_DIR.test(rel)) walk(full, out);
    } else if (/\.ts$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
}

function resolveRelative(from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  for (const candidate of [base + '.ts', path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

// What a module imports at run time, read from its own compiled output: the
// compiler drops an import that is only used as a type (or marked `import type`),
// so what is left are exactly the `require` calls that can take part in a cycle.
// Re-exports (`export ... from`) and dynamic `import()` compile to `require` too.
function importsOf(file) {
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const specs = [];
  const re = /\brequire\((["'])(\.[^"']*)\1\)/g;
  let m;
  while ((m = re.exec(outputText)) !== null) specs.push(m[2]);
  return specs;
}

const files = [];
for (const r of ROOTS) walk(path.join(ROOT, r), files);
const graph = new Map();
for (const file of files) {
  const targets = [];
  for (const spec of importsOf(file)) {
    const target = resolveRelative(file, spec);
    if (target && target !== file) targets.push(target);
  }
  graph.set(file, [...new Set(targets)]);
}

// Tarjan's strongly connected components, iterative to survive deep graphs.
let counter = 0;
const index = new Map();
const low = new Map();
const onStack = new Set();
const stack = [];
const groups = [];
for (const start of graph.keys()) {
  if (index.has(start)) continue;
  const work = [[start, 0]];
  while (work.length) {
    const frame = work[work.length - 1];
    const [v, i] = frame;
    if (i === 0) {
      index.set(v, counter);
      low.set(v, counter);
      counter++;
      stack.push(v);
      onStack.add(v);
    }
    const next = graph.get(v) || [];
    if (i < next.length) {
      frame[1]++;
      const w = next[i];
      if (!graph.has(w)) continue;
      if (!index.has(w)) work.push([w, 0]);
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    } else {
      if (low.get(v) === index.get(v)) {
        const group = [];
        let w;
        do {
          w = stack.pop();
          onStack.delete(w);
          group.push(w);
        } while (w !== v);
        if (group.length > 1) groups.push(group);
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1][0];
        low.set(parent, Math.min(low.get(parent), low.get(v)));
      }
    }
  }
}

if (groups.length) {
  console.error(`import cycles: ${groups.length} group(s)`);
  for (const group of groups) {
    console.error('  - ' + group.map((f) => path.relative(ROOT, f).split(path.sep).join('/')).sort().join('\n    '));
  }
  process.exit(1);
}
console.log(`no import cycles (${files.length} files)`);
