// Static + boot-time check for the two assembled webview scripts. The scripts
// are built by interpolating module-produced snippets into one template string,
// so tsc cannot see the final program: a snippet that references a helper which
// did not travel with it compiles fine and throws ReferenceError in the webview.
//
// Two passes over each assembled script:
//  1. scope walk -- report every identifier that is read but declared nowhere in
//     the script and is not a browser/webworker global. A missing moved helper
//     lands here. Over-reporting is possible (the walker is intentionally
//     conservative), under-reporting is not.
//  2. boot run -- execute the script against a stubbed DOM. Handlers are not
//     invoked, so this only catches throws that happen while the script runs.
//
// Usage: node scripts/check-webview-scope.cjs [name-filter]
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const acorn = require('acorn');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');

// The script factories reach vscode only through l10n.t(), which in a webview
// bundle is the catalog lookup that returns the fallback text. Stub it so this
// check needs no VS Code host; the strings themselves are not under test here.
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      l10n: {
        t: (message, ...rest) =>
          (Array.isArray(rest[0]) ? rest[0] : rest).reduce(
            (m, a) => m.replace(/\{\d+\}/, String(a)),
            message,
          ),
      },
      env: { appName: 'Visual Studio Code' },
      workspace: { getConfiguration: () => ({ get: () => undefined }) },
      Uri: { file: (p) => ({ fsPath: p, toString: () => String(p) }) },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

/** Build a throwaway bundle exposing the two script factories. */
async function loadScriptFactories() {
  const out = path.join(
    os.tmpdir(),
    `dita-viewer-webview-scope-${process.pid}.cjs`,
  );
  // The factories are not reachable from the extension entry, so they get their
  // own bundle. Written through stdin: no source file appears in the tree.
  const stdin = {
    contents: [
      "export { getWebviewScript } from '../src/editor/webview/topicScript';",
      "export { getMapWebviewScript } from '../src/editor/webview/mapScript';",
    ].join('\n'),
    resolveDir: path.join(ROOT, 'scripts'),
    loader: 'ts',
  };
  await esbuild.build({
    stdin,
    outfile: out,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    external: ['vscode'],
    logLevel: 'silent',
  });
  try {
    return { mod: require(out), out };
  } finally {
    Module._load = originalLoad;
  }
}

// ---------------------------------------------------------------- scope walk
// Scope kinds: 'script' and 'function' hold hoisted names (var, params, function
// declarations); 'block' holds only lexical bindings. Lookup walks up the chain.
class Scope {
  constructor(parent, kind) {
    this.parent = parent;
    this.kind = kind;
    this.hoisted = new Set();
    this.lexical = new Set();
  }
  hoist(name) {
    let s = this;
    while (s.kind === 'block') s = s.parent;
    s.hoisted.add(name);
  }
  lexicalDeclare(name) {
    this.lexical.add(name);
  }
  has(name) {
    for (let s = this; s; s = s.parent)
      if (s.hoisted.has(name) || s.lexical.has(name)) return true;
    return false;
  }
}

/** Identifiers that a binding pattern introduces. */
function boundIds(node, sink) {
  if (!node) return sink;
  switch (node.type) {
    case 'Identifier':
      sink.push(node.name);
      break;
    case 'ObjectPattern':
      for (const p of node.properties)
        boundIds(p.type === 'RestElement' ? p.argument : p.value, sink);
      break;
    case 'ArrayPattern':
      for (const el of node.elements) boundIds(el, sink);
      break;
    case 'RestElement':
      boundIds(node.argument, sink);
      break;
    case 'AssignmentPattern':
      boundIds(node.left, sink);
      break;
  }
  return sink;
}

function collectFreeNames(src) {
  const ast = acorn.parse(src, {
    ecmaVersion: 2022,
    sourceType: 'script',
    locations: true,
  });
  const scriptScope = new Scope(null, 'script');
  const reads = [];

  // ---- pass 1: hoist everything declarable, so legal forward references are
  // not mistaken for missing ones
  const scan = (node, scope) => {
    if (!node || typeof node.type !== 'string') return;
    switch (node.type) {
      case 'FunctionDeclaration':
        if (node.id) scope.hoist(node.id.name);
        return; // its body belongs to a deeper scope
      case 'ClassDeclaration':
        if (node.id) scope.lexicalDeclare(node.id.name);
        return;
      case 'VariableDeclaration':
        for (const d of node.declarations) {
          const sink = [];
          boundIds(d.id, sink);
          for (const name of sink) {
            if (node.kind === 'var') scope.hoist(name);
            else scope.lexicalDeclare(name);
          }
        }
        return; // inits may declare more; handled by walk
      case 'ImportDeclaration':
        for (const spec of node.specifiers)
          scope.lexicalDeclare(spec.local.name);
        return;
    }
    for (const key of Object.keys(node)) {
      const v = node[key];
      if (Array.isArray(v)) for (const c of v) scan(c, scope);
      else if (v && typeof v === 'object' && typeof v.type === 'string')
        scan(v, scope);
    }
  };
  scan(ast, scriptScope);

  // ---- pass 2: walk with scopes, collecting reads
  const fnScope = new Map(); // function node -> its Scope (for later handler runs)

  const walkExpr = (node, scope) => walk(node, scope);

  const walkFunction = (node, scope) => {
    const inner = new Scope(scope, 'function');
    fnScope.set(node, inner);
    for (const p of node.params) {
      const sink = [];
      boundIds(p, sink);
      for (const name of sink) inner.hoist(name);
      if (p.type === 'AssignmentPattern') walkExpr(p.right, inner);
    }
    if (node.body.type === 'BlockStatement') {
      const body = new Scope(inner, 'block');
      // var and function declarations inside a body are visible to the whole
      // body, including statements that precede them, so declare first, walk second
      for (const stmt of node.body.body) declareAllNamesInto(stmt, body);
      for (const stmt of node.body.body) walk(stmt, body);
    } else walkExpr(node.body, inner);
    return inner;
  };

  const walkStatement = (node, scope) => walk(node, scope);

  function walk(node, scope) {
    if (!node || typeof node.type !== 'string') return;
    switch (node.type) {
      case 'Program': {
        for (const stmt of node.body) walk(stmt, scope);
        return;
      }
      case 'BlockStatement': {
        const inner = new Scope(scope, 'block');
        for (const stmt of node.body) declareAllNamesInto(stmt, inner);
        for (const stmt of node.body) walk(stmt, inner);
        return;
      }
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        walkFunction(node, scope);
        return;
      case 'ClassDeclaration':
      case 'ClassExpression': {
        const inner = new Scope(scope, 'block');
        if (node.superClass) walkExpr(node.superClass, scope);
        for (const m of node.body.body) {
          if (m.static || m.computed) walkExpr(m.key, scope);
          if (m.value) walkFunction(m.value, inner);
        }
        return;
      }
      case 'VariableDeclaration': {
        for (const d of node.declarations) {
          if (d.init) walkExpr(d.init, scope);
          if (node.kind !== 'var') {
            const sink = [];
            boundIds(d.id, sink);
            for (const name of sink) scope.lexicalDeclare(name);
          }
        }
        return;
      }
      case 'ExpressionStatement':
        walkExpr(node.expression, scope);
        return;
      case 'IfStatement':
        walkExpr(node.test, scope);
        walkStatement(node.consequent, scope);
        if (node.alternate) walkStatement(node.alternate, scope);
        return;
      case 'ReturnStatement':
      case 'ThrowStatement':
        if (node.argument) walkExpr(node.argument, scope);
        return;
      case 'TryStatement':
        walkStatement(node.block, scope);
        if (node.handler) {
          const inner = new Scope(scope, 'block');
          if (node.handler.param) {
            const sink = [];
            boundIds(node.handler.param, sink);
            for (const name of sink) inner.lexicalDeclare(name);
          }
          walkStatement(node.handler.body, inner);
        }
        if (node.finalizer) walkStatement(node.finalizer, scope);
        return;
      case 'SwitchStatement':
        walkExpr(node.discriminant, scope);
        for (const c of node.cases) {
          if (c.test) walkExpr(c.test, scope);
          for (const stmt of c.consequent) walkStatement(stmt, scope);
        }
        return;
      case 'ForStatement': {
        const inner = new Scope(scope, 'block');
        if (node.init) walk(node.init, inner);
        if (node.test) walkExpr(node.test, inner);
        if (node.update) walkExpr(node.update, inner);
        walkStatement(node.body, inner);
        return;
      }
      case 'ForInStatement':
      case 'ForOfStatement': {
        const inner = new Scope(scope, 'block');
        walk(node.left, inner);
        walkExpr(node.right, inner);
        walkStatement(node.body, inner);
        return;
      }
      case 'LabeledStatement':
        walkStatement(node.body, scope);
        return;
      case 'BreakStatement':
      case 'ContinueStatement':
        return; // node.label is not a variable read
      case 'DoWhileStatement':
        walkStatement(node.body, scope);
        walkExpr(node.test, scope);
        return;
      case 'WhileStatement':
        walkExpr(node.test, scope);
        walkStatement(node.body, scope);
        return;
      case 'Identifier': {
        // Only a name with nothing up the scope chain is a candidate global read.
        // Resolving during the walk keeps the report to the interesting set.
        if (!scope.has(node.name))
          reads.push({ name: node.name, line: node.loc.start.line });
        return;
      }
      case 'MemberExpression':
      case 'OptionalMemberExpression':
        walkExpr(node.object, scope);
        if (node.computed) walkExpr(node.property, scope);
        return;
      case 'Property': {
        if (node.computed) walkExpr(node.key, scope);
        if (node.shorthand) {
          // both a binding and a read of the same name
          scope.lexicalDeclare(node.key.name);
          walkExpr(node.value, scope);
          return;
        }
        walkExpr(node.value, scope);
        return;
      }
      case 'AssignmentPattern':
        walkExpr(node.left, scope);
        walkExpr(node.right, scope);
        return;
      case 'ArrayPattern':
      case 'ObjectPattern':
      case 'RestElement':
        return; // bindings only, handled by their declarator/param
      case 'UnaryExpression':
      case 'UpdateExpression':
      case 'AwaitExpression':
        walkExpr(node.argument, scope);
        return;
      case 'BinaryExpression':
      case 'LogicalExpression':
        walkExpr(node.left, scope);
        walkExpr(node.right, scope);
        return;
      case 'ConditionalExpression':
        walkExpr(node.test, scope);
        walkExpr(node.consequent, scope);
        walkExpr(node.alternate, scope);
        return;
      case 'CallExpression':
      case 'NewExpression':
      case 'ImportExpression':
        if (node.callee) walkExpr(node.callee, scope);
        if (node.source) walkExpr(node.source, scope);
        for (const a of node.arguments ?? [])
          walkExpr(a.type === 'SpreadElement' ? a.argument : a, scope);
        return;
      case 'SequenceExpression':
        for (const e of node.expressions) walkExpr(e, scope);
        return;
      case 'SpreadElement':
        walkExpr(node.argument, scope);
        return;
      case 'TemplateLiteral':
        for (const expr of node.expressions) walkExpr(expr, scope);
        return;
      case 'TaggedTemplateExpression':
        walkExpr(node.tag, scope);
        return;
      case 'YieldExpression':
        if (node.argument) walkExpr(node.argument, scope);
        return;
      case 'AssignmentExpression':
        walkExpr(node.left, scope);
        walkExpr(node.right, scope);
        return;
      default:
        for (const key of Object.keys(node)) {
          if (
            key === 'type' ||
            key === 'loc' ||
            key === 'start' ||
            key === 'end' ||
            key === 'regex'
          )
            continue;
          const v = node[key];
          if (Array.isArray(v))
            for (const c of v)
              if (c && typeof c.type === 'string') walk(c, scope);
              else if (v && typeof v === 'object' && typeof v.type === 'string')
                walk(v, scope);
        }
        return;
    }
  }

  // Deposit every name declared anywhere below `node` into `scope`. Deliberately
  // imprecise about nesting: a name declared in a deeper block also lands here,
  // which can only hide a finding, never invent one, and the global pass 1 above
  // already models real scope boundaries for the cases that matter.
  function declareAllNamesInto(node, scope) {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations) {
        const sink = [];
        boundIds(d.id, sink);
        for (const name of sink) {
          if (node.kind === 'var') scope.hoist(name);
          else scope.lexicalDeclare(name);
        }
      }
      return;
    }
    if (node.type === 'ClassDeclaration' && node.id) {
      scope.lexicalDeclare(node.id.name);
      return;
    }
    if (node.type === 'FunctionDeclaration' && node.id) {
      scope.hoist(node.id.name);
      return;
    }
    for (const key of Object.keys(node)) {
      const v = node[key];
      if (Array.isArray(v)) for (const c of v) declareAllNamesInto(c, scope);
      else if (
        v &&
        typeof v === 'object' &&
        typeof v.type === 'string' &&
        v.loc
      )
        declareAllNamesInto(v, scope);
    }
  }

  walk(ast, scriptScope);
  return { scriptScope, reads };
}

// ---------------------------------------------------------------- boot run
function makeStubElement() {
  const noop = () => {};
  const target = {
    style: {},
    dataset: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    attributes: {},
    children: [],
    innerHTML: '',
    textContent: '',
  };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      if (
        k === 'querySelectorAll' ||
        k === 'getElementsByClassName' ||
        k === 'getElementsByTagName' ||
        k === 'matches'
      )
        return () => [];
      if (k === 'querySelector') return () => null;
      if (typeof k === 'symbol') return undefined;
      return noop;
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
}

// A DOM rich enough to run a script's top level, and no richer. Selections come
// back empty, elements are inert, and timers never fire -- so a boot run reaches
// the statements a webview runs before any event, and no further.
function makeStubDom() {
  const noop = () => {};
  const el = makeStubElement();
  const doc = {
    body: el,
    documentElement: el,
    head: el,
    readyState: 'complete',
    addEventListener: noop,
    removeEventListener: noop,
    createTextNode: () => el,
    createDocumentFragment: () => el,
    createElement: () => el,
    querySelector: () => el,
    querySelectorAll: () => [],
    getElementById: () => el,
    getElementsByClassName: () => [],
    getElementsByTagName: () => [],
    getSelection: () => ({
      rangeCount: 0,
      removeAllRanges: noop,
      addRange: noop,
      getRangeAt: () => null,
      toString: () => '',
    }),
    createRange: () => ({
      selectNodeContents: noop,
      setStart: noop,
      setEnd: noop,
      cloneContents: () => ({ toString: () => '' }),
    }),
    createTreeWalker: () => ({ nextNode: () => null }),
    createHighlight: () => null,
  };
  const window = {
    document: doc,
    location: {
      href: 'https://vscode-resource/provider/1/file.dita#topic',
      hash: '',
      protocol: 'https:',
      assign: noop,
      reload: noop,
    },
    addEventListener: noop,
    removeEventListener: noop,
    scrollX: 0,
    scrollY: 0,
    scrollTo: noop,
    scrollBy: noop,
    innerWidth: 1000,
    innerHeight: 800,
    devicePixelRatio: 1,
    matchMedia: () => ({
      matches: false,
      addEventListener: noop,
      addListener: noop,
    }),
    getComputedStyle: () => ({
      getPropertyValue: () => '',
      width: '100px',
      height: '100px',
    }),
    requestAnimationFrame: () => 0,
    setTimeout: () => 0,
    setInterval: () => 0,
    clearTimeout: noop,
    clearInterval: noop,
    dispatchEvent: () => true,
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        Object.assign(this, init || {});
      }
    },
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
    CSS: { highlights: { set: noop, delete: noop, get: () => undefined } },
    Highlight: class {
      add() {}
    },
    Element: class {},
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
    Range: class {},
    Image: class {},
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    IntersectionObserver: class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  };
  const posted = [];
  const sandbox = {
    window,
    document: doc,
    location: window.location,
    navigator: {
      clipboard: {
        writeText: () => Promise.resolve(),
        write: () => Promise.resolve(),
      },
    },
    acquireVsCodeApi: () => ({
      postMessage: (m) => posted.push(m),
      getState: () => undefined,
      setState: () => {},
    }),
    console: { log: noop, warn: noop, error: noop },
    ...window,
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  return { sandbox, posted };
}

function bootRun(src, label) {
  const { sandbox, posted } = makeStubDom();
  const ctx = vm.createContext(sandbox);
  try {
    vm.runInContext(src, ctx, { filename: label });
    return { ok: true, posted };
  } catch (err) {
    return { ok: false, err };
  }
}

async function main() {
  const filter = process.argv[2];
  const { mod, out } = await loadScriptFactories();
  const globals = makeWebviewGlobals();

  const scripts = [
    { label: 'topic preview (getWebviewScript)', src: mod.getWebviewScript() },
    {
      label: 'map preview (getMapWebviewScript)',
      src: mod.getMapWebviewScript(
        [
          { value: '', label: 'Default' },
          { value: 'aurora', label: 'Aurora' },
        ],
        '',
      ),
    },
  ].filter((s) => !filter || s.label.includes(filter));

  let findings = 0;
  for (const s of scripts) {
    console.log(`\n=== ${s.label} ===`);
    const r = analyzeScript(s.src, s.label, globals);
    findings += r.findings;
    console.log(r.lines.join('\n'));
  }

  fs.rmSync(out, { force: true });
  console.log(
    `\n${findings === 0 ? 'PASS' : 'REVIEW'}: ${findings} finding(s)`,
  );
}

// One script's verdict as text, so a caller can run it over a mutated script.
function analyzeScript(src, label, globals) {
  const lines = [`  assembled script: ${src.split('\n').length} lines`];
  let findings = 0;
  const { reads } = collectFreeNames(src);
  const unresolved = new Map();
  const knownGlobal = new Map();
  for (const r of reads) {
    const bucket = globals.has(r.name) ? knownGlobal : unresolved;
    if (!bucket.has(r.name)) bucket.set(r.name, []);
    bucket.get(r.name).push(r.line);
  }
  const describe = (name) => {
    const at = unresolved.get(name) || [];
    return `  MISSING  ${name}  -- read ${at.length}x, first at line ${at[0]}: ${String(
      src.split('\n')[at[0] - 1] || '',
    )
      .trim()
      .slice(0, 120)}`;
  };
  if (unresolved.size === 0) {
    lines.push(
      '  scope: every identifier the script reads is declared in it or is a known webview global',
    );
  } else {
    // SCREAMING_CASE names are the script's own constants: a read that resolves
    // nowhere is the exact signature of a constant left behind by a move.
    const consts = [...unresolved.keys()]
      .filter((n) => /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(n))
      .sort();
    const functions = [...unresolved.keys()]
      .filter(
        (n) => !/^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(n) && /^[a-z_$]/.test(n),
      )
      .sort();
    const odd = [...unresolved.keys()]
      .filter((n) => !consts.includes(n) && !functions.includes(n))
      .sort();
    findings += unresolved.size;
    for (const n of consts)
      lines.push(
        describe(n) +
          '   <- SCREAMING_CASE constant, defined nowhere in the assembled script',
      );
    for (const n of functions)
      lines.push(
        describe(n) +
          '   <- lowercase name, defined nowhere in the assembled script',
      );
    for (const n of odd)
      lines.push(
        `  CHECK  ${n}  -- unresolved, ${unresolved.get(n).length} read(s); a Capitalised name the global list does not know`,
      );
  }
  if (knownGlobal.size) {
    lines.push(
      `  (reads satisfied by a webview global: ${[...knownGlobal.keys()].sort().join(', ')})`,
    );
  }

  const boot = bootRun(src, label);
  if (boot.ok) {
    lines.push(
      '  boot run: top level executed against the stub DOM without throwing',
    );
  } else {
    const err = boot.err;
    const missing = /ReferenceError: (\S+) is not defined/.exec(
      String(err && err.message),
    );
    const kind = err && err.constructor ? err.constructor.name : typeof err;
    if (missing && globals.has(missing[1])) {
      lines.push(
        `  boot run: stopped where the stub runs out -- ${missing[1]} is a browser API the sandbox does not provide`,
      );
    } else if (missing) {
      findings++;
      lines.push(
        `  boot run: THREW ReferenceError: ${missing[1]} is not defined -- no such name in the script or the webview globals`,
      );
    } else {
      lines.push(
        `  boot run: stopped at ${kind}: ${err && err.message} (stub DOM limitation, not counted)`,
      );
    }
  }
  return { lines, findings };
}

module.exports = {
  loadScriptFactories,
  collectFreeNames,
  analyzeScript,
  bootRun,
  makeGlobals: makeWebviewGlobals,
  restoreModuleLoad: () => (Module._load = originalLoad),
};

// A webview script runs in a browser-like worker context: document and window
// are there, Node's require/process are not. Anything the script reads from
// outside its own scope has to be on this list.
function makeWebviewGlobals() {
  const g = require('globals');
  // Deliberately narrow -- builtins, browser and worker only, nothing from Node.
  const SKIP_GLOBAL_SETS = new Set([
    'node',
    'nodeBuiltin',
    'commonjs',
    'mocha',
    'jest',
    'jasmine',
    'qunit',
    'phantomjs',
    'couch',
    'rhino',
    'nashorn',
    'wsh',
    'jquery',
    'yui',
    'shelljs',
    'prototypejs',
    'meteor',
    'mongo',
    'applescript',
    'atomtest',
    'embertest',
    'protractor',
    'webextensions',
    'greasemonkey',
    'devtools',
    'serviceworker',
  ]);
  // The CSS Highlight API is recent enough to be missing from the global list,
  // but both previews use it for search highlighting.
  const globals = new Set([
    'acquireVsCodeApi',
    'globalThis',
    'Highlight',
    'CSSHighlight',
    'CustomHighlight',
  ]);
  for (const key of Object.keys(g)) {
    if (SKIP_GLOBAL_SETS.has(key)) continue;
    const set = g[key];
    if (set && typeof set === 'object')
      for (const name of Object.keys(set)) globals.add(name);
  }
  return globals;
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
