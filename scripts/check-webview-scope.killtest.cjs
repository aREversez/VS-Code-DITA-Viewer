// Kill test for check-webview-scope.cjs: deletes one definition from each
// assembled script and confirms the checker notices. Simulates the exact failure
// mode of a script move -- a snippet that calls a helper which did not travel.
const checker = require('./check-webview-scope.cjs');

async function run() {
  const { mod, out } = await checker.loadScriptFactories();
  const globals = checker.makeGlobals();
  const fs = require('fs');
  const cases = [
    {
      label: 'map preview (getMapWebviewScript)',
      src: mod.getMapWebviewScript([{ value: '', label: 'Default' }], ''),
      drop: 'function refreshAfterContentSwap()',
      why: 'the shared post-content-swap helper, called by the map patch handler',
    },
    {
      label: 'topic preview (getWebviewScript)',
      src: mod.getWebviewScript(),
      drop: 'function applyTagTooltips(',
      why: 'the tag-tooltip applier, called by the shared content-swap refresh',
    },
    {
      label: 'topic preview (getWebviewScript)',
      src: mod.getWebviewScript(),
      drop: 'var IMG_ZOOM_STEPS',
      why: 'a constant the image toolbar reads',
    },
    {
      label: 'map preview (getMapWebviewScript)',
      src: mod.getMapWebviewScript([{ value: '', label: 'Default' }], ''),
      drop: 'function patchBookContent(',
      why: 'the book-mode in-place patch entry point, if the map script defines it',
      optional: true,
    },
  ];
  let caught = 0;
  let exercised = 0;
  for (const c of cases) {
    const at = c.src.indexOf(c.drop);
    if (at < 0) {
      if (c.optional) {
        console.log(`skip  ${c.drop} not present in this script`);
        continue;
      }
      console.log(
        `SKIP  ${c.label}: ${c.drop} not found -- the checker was not exercised`,
      );
      continue;
    }
    exercised++;
    // Remove the whole definition, not just its first line: leaving a stranded
    // body would exercise the parser rather than the scope walk.
    const end = definitionEnd(c.src, at);
    const mutated = c.src.slice(0, at) + c.src.slice(end);
    const r = checker.analyzeScript(mutated, c.label, globals);
    const text = r.lines.join('\n');
    const name = c.drop
      .replace(/^function /, '')
      .replace(/^(const|let|var) /, '')
      .replace(/[({].*$/, '')
      .trim();
    const mentioned = text.includes(name);
    if (r.findings > 0 && mentioned) caught++;
    console.log(
      `${r.findings > 0 && mentioned ? 'CAUGHT' : 'MISSED'}  delete definition of ${name}  (${c.why})  findings=${r.findings}`,
    );
    if (!mentioned) console.log(text);
  }
  // and confirm the untouched scripts still pass, so a CAUGHT is not just noise
  let clean = 0;
  for (const [label, src] of [
    ['topic preview (getWebviewScript)', mod.getWebviewScript()],
    [
      'map preview (getMapWebviewScript)',
      mod.getMapWebviewScript([{ value: '', label: 'Default' }], ''),
    ],
  ]) {
    const r = checker.analyzeScript(src, label, globals);
    if (r.findings === 0) clean++;
    else console.log(`BASELINE NOT CLEAN  ${label}\n${r.lines.join('\n')}`);
  }
  fs.rmSync(out, { force: true });
  console.log(
    `\n${caught}/${exercised} mutations caught, ${clean}/2 clean baselines`,
  );
  process.exit(caught === exercised && clean === 2 ? 0 : 1);
}

// End of a definition starting at `at`: for a function, past its balanced body;
// for a one-line const, past the line.
function definitionEnd(src, at) {
  const brace = src.indexOf('{', at);
  const newline = src.indexOf('\n', at);
  if (brace < 0 || brace > newline) return newline + 1;
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i + 1;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i++;
        i++;
      }
    } else if (ch === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i);
    } else if (ch === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i) + 1;
    }
  }
  return src.length;
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
