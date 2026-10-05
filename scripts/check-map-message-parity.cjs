// Message-protocol parity check for the two previews: every type a webview
// posts must be routed by its provider, and every type the host posts must be
// compared by the webview script. A miss in either direction is silent -- the
// preview simply stops reacting -- which is the failure mode a message-router
// refactor (3946bd0) is most likely to introduce, and the one the controller's
// unit tests cannot reach because the router imports vscode.
//
// The webview side is scanned on the *assembled* script, because most
// postMessage calls are interpolated from helpers with the message type passed
// in as an option: scanning mapScript.ts's own text would miss them. The host
// side is parsed, not regex-matched: the providers contain several switch
// statements (message type, nav action, ...) and only the one on message.type
// describes the protocol.
//
// Usage: node scripts/check-map-message-parity.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const acorn = require('acorn');
const ts = require('typescript');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const Module = require('module');
const realLoad = Module._load;
// The script factories reach vscode only through l10n.t(), which in a webview
// bundle resolves to the fallback text.
Module._load = (request, ...rest) =>
  request === 'vscode'
    ? {
        l10n: {
          t: (message, ...args) =>
            (Array.isArray(args[0]) ? args[0] : args).reduce(
              (m, a) => m.replace(/\{\d+\}/, String(a)),
              message,
            ),
        },
        env: { appName: 'Visual Studio Code' },
        workspace: { getConfiguration: () => ({ get: () => undefined }) },
        Uri: { file: (p) => ({ fsPath: p, toString: () => String(p) }) },
      }
    : realLoad(request, ...rest);

const MSG_SRC = fs.readFileSync(
  path.join(ROOT, 'src/editor/mapMessages.ts'),
  'utf8',
);
const msgValues = new Map(
  [...MSG_SRC.matchAll(/export const (MSG_\w+) = '([^']+)'/g)].map((m) => [
    m[1],
    m[2],
  ]),
);

// ------------------------------------------------------------------ assembly
const ENTRY = [
  "export * as topic from '../src/editor/webview/topicScript';",
  "export * as map from '../src/editor/webview/mapScript';",
].join('\n');

async function assemble() {
  const out = path.join(os.tmpdir(), `dita-map-parity-${process.pid}.cjs`);
  await esbuild.build({
    stdin: {
      contents: ENTRY,
      resolveDir: path.join(ROOT, 'scripts'),
      loader: 'ts',
    },
    outfile: out,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    external: ['vscode'],
    logLevel: 'silent',
  });
  try {
    const mod = require(out);
    return {
      // the map preview's script is the one with the router counterpart; the
      // topic script is included so a shared helper's posts are not blamed on
      // the wrong provider
      map: mod.map.getMapWebviewScript([{ value: '', label: 'Default' }], ''),
      topic: mod.topic.getWebviewScript(),
    };
  } finally {
    fs.rmSync(out, { force: true });
    Module._load = realLoad;
  }
}

// ------------------------------------------------------------------ scanning
/** A comparison side's message-type value: a string literal, or one of the
 * shared MSG_ constants resolved through mapMessages.ts. */
const strLit = (node) => {
  if (!node) return undefined;
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isIdentifier(node)) return msgValues.get(node.text);
  return undefined;
};

/** Every `postMessage({ type: ... })` in the script. A type may be a literal or
 * a name bound at the script's top level -- helpers receive their message type
 * as a parameter, and the provider's call sites interpolate that binding. */
function postedByVscodeApi(text) {
  const out = [];
  const seen = new Set();
  const unresolvedType = [];
  const ast = acorn.parse(text, {
    ecmaVersion: 2022,
    sourceType: 'script',
    locations: true,
  });
  const keyName = (key) =>
    key.type === 'Identifier'
      ? key.name
      : key.type === 'Literal'
        ? String(key.value)
        : undefined;
  // `NAME = 'literal'` anywhere in the script -- helpers receive their message
  // type as a parameter, and the provider's call sites interpolate it, so a
  // posted type can arrive as a name rather than a literal. Collecting from any
  // depth (rather than only the script body) is deliberate: a miss here would
  // silently shrink the set of types under test.
  const bindings = new Map();
  const collectBindings = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (
      node.type === 'VariableDeclarator' &&
      node.id &&
      node.id.type === 'Identifier' &&
      node.init &&
      node.init.type === 'Literal' &&
      typeof node.init.value === 'string'
    ) {
      bindings.set(node.id.name, node.init.value);
    }
    if (
      node.type === 'AssignmentExpression' &&
      node.left &&
      node.left.type === 'Identifier' &&
      node.right.type === 'Literal' &&
      typeof node.right.value === 'string'
    ) {
      bindings.set(node.left.name, node.right.value);
    }
    for (const key of Object.keys(node)) {
      const v = node[key];
      if (Array.isArray(v)) for (const c of v) collectBindings(c);
      else if (v && typeof v === 'object' && typeof v.type === 'string')
        collectBindings(v);
    }
  };
  collectBindings(ast);
  const walk = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (
      node.type === 'CallExpression' &&
      node.callee &&
      node.callee.type === 'MemberExpression' &&
      node.callee.property &&
      node.callee.property.name === 'postMessage'
    ) {
      const receiver = text.slice(
        node.callee.object.start,
        node.callee.object.end,
      );
      for (const arg of node.arguments) {
        if (arg.type !== 'ObjectExpression') continue;
        for (const prop of arg.properties) {
          if (prop.type !== 'Property' || keyName(prop.key) !== 'type')
            continue;
          let value;
          if (
            prop.value.type === 'Literal' &&
            typeof prop.value.value === 'string'
          )
            value = prop.value.value;
          else if (prop.value.type === 'Identifier')
            value = bindings.get(prop.value.name);
          if (!value) {
            unresolvedType.push(
              `${prop.value.type === 'Identifier' ? prop.value.name : text.slice(prop.value.start, prop.value.end)} at line ${prop.value.loc.start.line}`,
            );
            continue;
          }
          const id = `${receiver}|${value}`;
          if (seen.has(id)) continue;
          seen.add(id);
          out.push({ receiver, value, line: prop.value.loc.start.line });
        }
      }
    }
    for (const key of Object.keys(node)) {
      const v = node[key];
      if (Array.isArray(v)) for (const c of v) walk(c);
      else if (v && typeof v === 'object' && typeof v.type === 'string')
        walk(v);
    }
  };
  walk(ast);
  return { posts: out, unresolvedType };
}

/** Strings compared against a `.type` member -- the shape both sides use for a
 * message type. Permissive on purpose: an extra entry here can only hide a
 * finding, never invent one. */
function comparedTypeLiterals(srcText, fileName) {
  const sf = ts.createSourceFile(
    fileName,
    srcText,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const found = new Map();
  const note = (lit, line) => {
    if (lit !== undefined && !found.has(lit)) found.set(lit, line);
  };
  const isTypeRead = (node) =>
    ts.isPropertyAccessExpression(node) && node.name.text === 'type';
  const lineOf = (node) =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const visit = (node) => {
    if (
      ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
      ].includes(node.operatorToken.kind)
    ) {
      if (isTypeRead(node.left)) note(strLit(node.right), lineOf(node));
      if (isTypeRead(node.right)) note(strLit(node.left), lineOf(node));
    }
    if (ts.isSwitchStatement(node) && isTypeRead(node.expression)) {
      for (const clause of node.caseBlock.clauses) {
        if (ts.isCaseClause(clause))
          note(strLit(clause.expression), lineOf(clause));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Strings the host posts as `{ type: 'x' }` / `{ type: MSG_X }`. */
function hostPostedTypes(srcText, fileName) {
  const sf = ts.createSourceFile(
    fileName,
    srcText,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const found = new Map();
  const resolve = (node) => {
    if (ts.isStringLiteral(node)) return node.text;
    if (ts.isIdentifier(node) && msgValues.has(node.text))
      return msgValues.get(node.text);
    return undefined;
  };
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        if (
          !ts.isPropertyAssignment(prop) ||
          !prop.name ||
          prop.name.getText() !== 'type'
        )
          continue;
        const value = resolve(prop.initializer);
        if (value && !found.has(value))
          found.set(
            value,
            sf.getLineAndCharacterOfPosition(prop.getStart(sf)).line + 1,
          );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** `navContextAction` carries an `action` field with its own dispatch, and an
 * unhandled action is silent too: the menu item just does nothing. Both spellings
 * are compared -- the script's object literals, the provider's cases and ifs. */
function checkNavActions(mapScript, providerSrc) {
  const offered = new Map();
  const ast = acorn.parse(mapScript, {
    ecmaVersion: 2022,
    sourceType: 'script',
    locations: true,
  });
  const keyName = (key) =>
    key.type === 'Identifier'
      ? key.name
      : key.type === 'Literal'
        ? String(key.value)
        : undefined;
  const walk = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (
      node.type === 'Property' &&
      keyName(node.key) === 'action' &&
      node.value.type === 'Literal' &&
      typeof node.value.value === 'string'
    ) {
      if (!offered.has(node.value.value))
        offered.set(node.value.value, node.value.loc.start.line);
    }
    for (const key of Object.keys(node)) {
      const v = node[key];
      if (Array.isArray(v)) for (const c of v) walk(c);
      else if (v && typeof v === 'object' && typeof v.type === 'string')
        walk(v);
    }
  };
  walk(ast);

  const handled = new Map();
  for (const re of [
    /case\s+'([a-zA-Z]\w+)'\s*:/g,
    /\baction\s*[=!]==?\s*'([a-zA-Z]\w+)'/g,
  ]) {
    for (const m of providerSrc.matchAll(re)) {
      if (!handled.has(m[1]))
        handled.set(m[1], providerSrc.slice(0, m.index).split('\n').length);
    }
  }
  let bad = 0;
  console.log('\n=== nav context menu actions: each item must be handled ===');
  for (const [action, line] of [...offered].sort()) {
    const at = handled.get(action);
    if (at === undefined) {
      console.log(`  UNHANDLED   '${action}'  offered at script line ${line}`);
      bad++;
    } else {
      console.log(
        `  ok          '${action}'  script line ${line} -> MapViewerProvider.ts:${at}`,
      );
    }
  }
  return bad;
}

function main() {
  return Promise.all([assemble(), readHosts()]).then(([scripts, hosts]) => {
    if (process.argv.includes('--kill')) {
      return killTest(scripts, hosts);
    }
    const bad = runChecks(scripts, hosts);
    console.log(`\n${bad === 0 ? 'PASS' : 'REVIEW'}: ${bad} protocol gap(s)`);
    process.exit(bad === 0 ? 0 : 1);
  });
}

// Rename a message/action literal wherever it is spelled, regardless of quote
// style. The assembled script emits compares in single quotes but JSON.stringify
// -built nav-menu data in double quotes; a mutation that matched nothing would
// pass the kill test for the wrong reason, so match both forms.
function renameLiteral(text, from, to) {
  return text
    .split(`'${from}'`)
    .join(`'${to}'`)
    .split(`"${from}"`)
    .join(`"${to}"`);
}

// Each mutation deletes one side of one pairing. The checker must notice all of
// them; a checker that passes these scripts but not these is not checking.
function killTest(scripts, hosts) {
  const cases = [
    {
      name: "drop the provider's `case 'refresh'` route",
      expect: 'UNROUTED',
      apply: (s, h) => ({
        scripts: s,
        // rename keeps the switch well-formed and removes exactly one route
        hosts: {
          ...h,
          mapProvider: {
            ...h.mapProvider,
            text: renameLiteral(h.mapProvider.text, 'refresh', 'refreshRenamed'),
          },
        },
      }),
    },
    {
      name: "drop the script's comparison against 'patchContent'",
      expect: 'UNLISTENED',
      apply: (s) => ({
        // rename rather than blank: blanking would leave `=== )` and acorn could
        // not parse the mutated script at all
        scripts: {
          ...s,
          map: renameLiteral(s.map, 'patchContent', 'patchContentRenamed'),
        },
        hosts: null,
      }),
    },
    {
      name: "rename the nav action 'openMapSource' on the menu side only",
      expect: 'UNHANDLED',
      apply: (s) => ({
        scripts: {
          ...s,
          map: renameLiteral(s.map, 'openMapSource', 'openMapSourceX'),
        },
        hosts: null,
      }),
    },
  ];
  let caught = 0;
  let run = 0;
  for (const c of cases) {
    const log = [];
    const write = console.log;
    console.log = (...a) => log.push(a.join(' '));
    let bad;
    try {
      const mutated = c.apply(scripts, hosts);
      bad = runChecks(mutated.scripts, mutated.hosts || hosts);
    } finally {
      console.log = write;
    }
    run++;
    const text = log.join('\n');
    const hit = bad > 0 && text.includes(c.expect);
    if (hit) caught++;
    console.log(`${hit ? 'CAUGHT' : 'MISSED'}  ${c.name}  (expected ${c.expect}, findings=${bad})`);
    if (!hit) console.log(text.split('\n').filter((l) => /UN|MISSING/.test(l)).join('\n') || '  (no findings at all)');
  }
  console.log(`\n${caught}/${run} mutations caught`);
  process.exit(caught === run ? 0 : 1);
}

const HOST_FILES = {
  mapProvider: 'src/editor/MapViewerProvider.ts',
  mapController: 'src/editor/mapPanelController.ts',
  topicProvider: 'src/editor/DitaViewerProvider.ts',
};

function readHosts() {
  const out = {};
  for (const [key, rel] of Object.entries(HOST_FILES)) {
    out[key] = { rel, text: fs.readFileSync(path.join(ROOT, rel), 'utf8') };
  }
  return out;
}

// The comparison itself, over given inputs, so the kill test can run it against
// mutated text without touching the tree and without main's process.exit.
function runChecks(scripts, hosts) {
  const providers = {
    'map preview': {
      script: scripts.map,
      routeFiles: [hosts.mapProvider],
      postFiles: [hosts.mapController, hosts.mapProvider],
    },
    'topic preview': {
      script: scripts.topic,
      routeFiles: [hosts.topicProvider],
      postFiles: [hosts.topicProvider],
    },
  };
  let bad = 0;
  for (const [label, cfg] of Object.entries(providers)) {
    const routes = new Map();
    for (const f of cfg.routeFiles) {
      for (const [type, line] of comparedTypeLiterals(f.text, f.rel)) {
        if (!routes.has(type)) routes.set(type, `${f.rel}:${line}`);
      }
    }
    const listens = new Map();
    const posts = new Map();
    for (const f of cfg.postFiles) {
      for (const [type, line] of hostPostedTypes(f.text, f.rel)) {
        if (!posts.has(type)) posts.set(type, `${f.rel}:${line}`);
      }
    }
    for (const [type, line] of comparedTypeLiterals(
      cfg.script,
      'assembled.js',
    )) {
      if (!listens.has(type)) listens.set(type, `line ${line}`);
    }

    console.log(`\n################ ${label} ################`);
    console.log(
      '=== webview -> host: each posted type must be routed by the provider ===',
    );
    const sent = new Map();
    const skipped = new Set();
    const { posts: scriptPosts, unresolvedType } = postedByVscodeApi(
      cfg.script,
    );
    for (const p of scriptPosts) {
      // the vscode api object reaches the script as `acquireVsCodeApi()`, so a
      // receiver naming it (or the local holding it) is a post to the extension
      if (!/vscode/i.test(p.receiver)) {
        skipped.add(p.receiver);
        continue;
      }
      if (!sent.has(p.value)) sent.set(p.value, p.line);
    }
    if (skipped.size)
      console.log(
        `  (not counted as host posts, posted on ${[...skipped].join(', ')}: in-page calls)`,
      );
    if (unresolvedType.length) {
      console.log(
        `  UNRESOLVED  type expression(s) the checker could not pin to a string: ${unresolvedType.join(', ')}`,
      );
      bad++;
    }
    for (const [type, line] of [...sent].sort()) {
      const at = routes.get(type);
      if (at === undefined) {
        const spelledSomewhere = cfg.routeFiles.some((f) =>
          f.text.includes(`'${type}'`),
        );
        console.log(
          `  UNROUTED    '${type}'  posted at script line ${line}; spelled in the provider at all: ${spelledSomewhere}`,
        );
        bad++;
      } else {
        console.log(`  ok          '${type}'  script line ${line} -> ${at}`);
      }
    }

    console.log(
      '\n=== host -> webview: each posted type must be compared by the script ===',
    );
    for (const [type, at] of [...posts].sort()) {
      const seenInScript =
        listens.get(type) ||
        (cfg.script.includes(`'${type}'`)
          ? 'present in the script (matched indirectly)'
          : undefined);
      if (seenInScript) {
        console.log(
          `  ok          '${type}'  ${at} -> ${listens.get(type) ? 'compared at ' + seenInScript : seenInScript}`,
        );
      } else {
        console.log(
          `  UNLISTENED  '${type}'  ${at} -- the script neither compares it nor contains it`,
        );
        bad++;
      }
    }
  }
  bad += checkNavActions(scripts.map, hosts.mapProvider.text);
  return bad;
}

module.exports = {
  assemble,
  readHosts,
  runChecks,
  checkNavActions,
  postedByVscodeApi,
  comparedTypeLiterals,
  hostPostedTypes,
};

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
