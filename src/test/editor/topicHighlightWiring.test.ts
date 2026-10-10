import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getHighlightRunScript } from '../../editor/webview/highlightRunScript';

// dist-test/test/editor -> repo root is three levels up.
const repoRoot = join(__dirname, '..', '..', '..');
const topicSource = readFileSync(join(repoRoot, 'src/editor/webview/topicScript.ts'), 'utf8');

/**
 * The cursor-to-box wiring: findContaining picks the clicked element, the
 * highlight module regroups it into a merged conref run and tints it, and the
 * run's first box becomes the scroll anchor if it sits off screen. highlightRun
 * Script.test.ts executes the module half; nothing executed the half that
 * decides WHICH element a cursor position maps to and WHAT happens to the run
 * it belongs to (5a7287f and 7327ea5 were both fixes in that half).
 *
 * topicScript.ts imports vscode, so no test can require it and call
 * getWebviewScript() -- the existing suite settled for source-text checks on
 * that account (webviewScriptHome.test.ts, topicToolbarOrder.test.ts). The
 * three functions below are pure over `document` and their arguments, so they
 * are sliced out of the source and run as written rather than paraphrased. A
 * rename or re-indent makes the slice assert, not silently skip.
 */

/** `function <name>(...) { ... }`, up to the closing brace at the template's base indent. */
function extractFn(name: string): string {
  const start = topicSource.indexOf(`  function ${name}(`);
  assert.notStrictEqual(start, -1, `topicScript.ts no longer defines ${name}`);
  const end = topicSource.indexOf('\n  }', start);
  assert.notStrictEqual(end, -1, `${name} no longer closes at the template's base indent`);
  return topicSource.slice(start, end + '\n  }'.length);
}

interface FakeEl {
  attrs: Record<string, string>;
  parentElement: FakeEl | null;
  classes: Set<string>;
  classList: { add(c: string): void; remove(c: string): void };
  getAttribute(n: string): string | null;
  scrollIntoView(opts: unknown): void;
}

function wire(visible: (el: FakeEl) => boolean = () => true) {
  const all: FakeEl[] = [];
  const scrolls: { el: FakeEl; opts: unknown }[] = [];
  let programmaticBegins = 0;
  const pending: { fn: () => void; ms: number }[] = [];

  function el(range: string, parent: FakeEl | null = null): FakeEl {
    const [line, endLine, startCol, endCol] = range.split(':');
    const classes = new Set<string>();
    const e: FakeEl = {
      attrs: { 'data-line': line, 'data-end-line': endLine, 'data-start-col': startCol, 'data-end-col': endCol },
      parentElement: parent,
      classes,
      classList: { add: (c) => void classes.add(c), remove: (c) => void classes.delete(c) },
      getAttribute: (n) => (n in e.attrs ? e.attrs[n] : null),
      scrollIntoView: (opts) => void scrolls.push({ el: e, opts }),
    };
    all.push(e);
    return e;
  }

  const document = { querySelectorAll: (sel: string) => (sel === '[data-line]' ? all.slice() : []) };
  // These tests only check the synchronous half of a click; the fade timers
  // the script arms are recorded and left unfired (their timing is covered in
  // highlightRunScript.test.ts against the real script text).
  const setTimeoutFake = (fn: () => void, ms: number): number => {
    pending.push({ fn, ms });
    return pending.length;
  };
  const clearTimeoutFake = (id: number): void => {
    const t = pending[id - 1];
    if (t) t.fn = () => undefined;
  };

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    'document',
    'setTimeout',
    'clearTimeout',
    'isElementVisible',
    'beginProgrammaticScroll',
    [
      getHighlightRunScript(),
      extractFn('findClosest'),
      extractFn('findContaining'),
      extractFn('applyHighlightLine'),
      'return { findContaining, applyHighlightLine };',
    ].join('\n'),
  ) as (
    d: unknown,
    s: unknown,
    c: unknown,
    v: (el: FakeEl) => boolean,
    b: () => void,
  ) => {
    findContaining(line: number, col: number): FakeEl | null;
    applyHighlightLine(line: number, col: number): void;
  };
  const api = factory(document, setTimeoutFake, clearTimeoutFake, visible, () => {
    programmaticBegins++;
  });

  return {
    el,
    api,
    scrolls,
    beginCount: () => programmaticBegins,
    classes: (e: FakeEl) => [...e.classes].sort().join(' '),
  };
}

describe('the topic preview cursor-to-highlight wiring (findContaining -> run -> tint -> anchor scroll)', () => {
  it('a position on a shared line lands on the narrowest element whose full range contains it', () => {
    // 5a7287f's whole point: <uicontrol> and the <p> around it carry the same
    // source line, and picking by start line alone highlighted the paragraph
    // when the cursor was inside the tag's columns.
    const w = wire();
    const p = w.el('3:3:0:40');
    const ui = w.el('3:3:10:20', p);
    assert.strictEqual(w.api.findContaining(3, 12), ui);
    assert.strictEqual(w.api.findContaining(3, 2), p, 'text outside the inline tag still belongs to the paragraph');
    assert.strictEqual(w.api.findContaining(3, 45), p, 'nothing contains it: the closest-start-line fallback');
  });

  it('the closest-start-line fallback picks the nearest element when no range contains the position', () => {
    const w = wire();
    w.el('2:2:0:9');
    const late = w.el('8:8:0:9');
    assert.strictEqual(w.api.findContaining(7, 0), late);
  });

  it('a click inside a merged conref run tints every outermost box of the run', () => {
    // 7327ea5: the transplanted boxes carry the referencing tag's range, so
    // one click has to light up all of them -- and only the outermost, never
    // the enclosing section or a stacked tint on a nested member.
    const w = wire();
    const section = w.el('2:20:0:9');
    const dl = w.el('5:5:0:30', section);
    const holder = w.el('5:5:0:30', section);
    const nested = w.el('5:5:0:30', dl);
    w.el('9:9:0:10');
    w.api.applyHighlightLine(5, 12);
    assert.strictEqual(w.classes(dl), '__hl __hl-run');
    assert.strictEqual(w.classes(holder), '__hl __hl-run');
    assert.strictEqual(w.classes(nested), '', 'a nested member must not get its own layer');
    assert.strictEqual(w.classes(section), '', 'the run is the range, not everything around it');
  });

  it('a click on an ordinary element tints only that element, with the single-box outline', () => {
    const w = wire();
    const p = w.el('3:3:0:40');
    w.el('3:3:10:20', p); // a child with its own narrower range
    w.api.applyHighlightLine(3, 2);
    assert.strictEqual(w.classes(p), '__hl', 'isRun false: no flat __hl-run tint');
  });

  it('an off-screen run scrolls its first box into view, marked programmatic', () => {
    const w = wire((e) => e.attrs['data-line'] !== '5');
    const section = w.el('2:20:0:9');
    const dl = w.el('5:5:0:30', section);
    const holder = w.el('5:5:0:30', section);
    w.api.applyHighlightLine(5, 12);
    assert.strictEqual(w.scrolls.length, 1, 'one scroll for the whole run, not one per box');
    assert.strictEqual(w.scrolls[0].el, dl, 'the run\'s first box is the anchor');
    assert.notStrictEqual(w.scrolls[0].el, holder);
    assert.deepStrictEqual(w.scrolls[0].opts, { block: 'center', behavior: 'smooth' });
    assert.strictEqual(w.beginCount(), 1, 'without beginProgrammaticScroll the echo loops back into the editor');
  });

  it('a visible anchor does not scroll the preview out from under the reader', () => {
    const w = wire();
    const section = w.el('2:20:0:9');
    w.el('5:5:0:30', section);
    w.el('5:5:0:30', section);
    w.api.applyHighlightLine(5, 12);
    assert.strictEqual(w.scrolls.length, 0);
    assert.strictEqual(w.beginCount(), 0);
  });
});
