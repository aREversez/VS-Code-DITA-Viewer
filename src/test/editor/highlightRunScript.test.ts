import * as assert from 'assert';
import { getHighlightRunScript } from '../../editor/webview/highlightRunScript';

// The topic preview's highlight box. A conref/conkeyref/conrefend merge stamps
// every transplanted node with the referencing element's own source range
// (renderer.ts stampSourceRange), so clicking the referencing tag has to light
// up the whole run -- several sibling boxes an HTML <p> cannot contain -- and
// nothing else. None of that was executed by any test before: topicScript.ts
// is one template literal, and the pieces below were inside it. These tests
// run the real script text against a minimal fake DOM (jsdom is not a
// dependency here).

interface FakeEl {
  attrs: Record<string, string>;
  parentElement: FakeEl | null;
  classes: Set<string>;
  classList: { add(c: string): void; remove(c: string): void };
  getAttribute(n: string): string | null;
}

interface Api {
  findRunElements(best: FakeEl): { isRun: boolean; els: FakeEl[] };
  highlightElements(els: FakeEl[], isRun: boolean): void;
  clearHighlight(): void;
}

interface Timer { fn: () => void; ms: number; at: number; id: number; live: boolean }

function harness() {
  const all: FakeEl[] = [];
  const timers: Timer[] = [];
  let now = 0;
  let nextId = 1;

  function el(range: string, parent: FakeEl | null = null): FakeEl {
    const [line, endLine, startCol, endCol] = range.split(':');
    const classes = new Set<string>();
    const e: FakeEl = {
      attrs: { 'data-line': line, 'data-end-line': endLine, 'data-start-col': startCol, 'data-end-col': endCol },
      parentElement: parent,
      classes,
      classList: { add: (c) => void classes.add(c), remove: (c) => void classes.delete(c) },
      getAttribute: (n) => (n in e.attrs ? e.attrs[n] : null),
    };
    all.push(e);
    return e;
  }

  const document = { querySelectorAll: (sel: string) => (sel === '[data-line]' ? all.slice() : []) };
  const setTimeoutFake = (fn: () => void, ms: number): number => {
    const t: Timer = { fn, ms, at: now + ms, id: nextId++, live: true };
    timers.push(t);
    return t.id;
  };
  const clearTimeoutFake = (id: number): void => {
    for (const t of timers) if (t.id === id) t.live = false;
  };
  /** Runs every live timer due within `ms`, in order, including ones they schedule. */
  const advance = (ms: number): void => {
    const until = now + ms;
    for (;;) {
      const due = timers.filter((t) => t.live && t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.live = false;
      now = due.at;
      due.fn();
    }
    now = until;
  };

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    'document',
    'setTimeout',
    'clearTimeout',
    `${getHighlightRunScript()}\nreturn { findRunElements, highlightElements, clearHighlight };`,
  ) as (d: unknown, s: unknown, c: unknown) => Api;
  const api = factory(document, setTimeoutFake, clearTimeoutFake);
  return { api, el, advance, timers };
}

const classesOf = (e: FakeEl): string => [...e.classes].sort().join(' ');

describe('topic preview highlight: merged conref runs', () => {
  it('an ordinary element is its own single-box highlight, not a run', () => {
    const h = harness();
    const p = h.el('3:3:0:20');
    h.el('3:3:4:10', p); // a child carries its own, narrower range
    const run = h.api.findRunElements(p);
    assert.strictEqual(run.isRun, false);
    assert.deepStrictEqual(run.els, [p]);
  });

  it('every element stamped with the same range forms one run, keeping only each outermost box', () => {
    const h = harness();
    const section = h.el('2:20:0:9'); // the enclosing box: not a member, carries its own range
    const holder = h.el('5:5:0:30', section); // the <p conref> itself
    const dl = h.el('5:5:0:30', section); // hoisted out beside it by the HTML parser
    const dt = h.el('5:5:0:30', dl); // nested member: must not get a second tint layer
    const table = h.el('5:5:0:30', section);
    h.el('9:9:0:10'); // unrelated element elsewhere
    const run = h.api.findRunElements(dl);
    assert.strictEqual(run.isRun, true);
    assert.deepStrictEqual(run.els, [holder, dl, table]);
    assert.ok(!run.els.includes(dt));
  });

  it('finds the roots of a large run without a linear membership scan per member', () => {
    // A conref can pull in a whole section: thousands of elements share one
    // range. Asking `members.indexOf(parent)` for each of them is quadratic
    // (every click on such a tag stalled the webview), so the membership test
    // must be a hash lookup. Counted rather than timed, to stay deterministic.
    const h = harness();
    const section = h.el('1:50:0:9');
    const N = 3000;
    const members: FakeEl[] = [];
    for (let i = 0; i < N; i++) members.push(h.el('5:5:0:30', section));
    const realIndexOf = Array.prototype.indexOf;
    let bigScans = 0;
    Array.prototype.indexOf = function (this: unknown[], ...args: [unknown, number?]) {
      if (this.length >= 1000) bigScans++;
      return realIndexOf.apply(this, args);
    } as typeof Array.prototype.indexOf;
    let run: { isRun: boolean; els: FakeEl[] };
    try {
      run = h.api.findRunElements(members[0]);
    } finally {
      Array.prototype.indexOf = realIndexOf;
    }
    assert.strictEqual(run.els.length, N);
    assert.strictEqual(bigScans, 0, `${bigScans} linear scans of a ${N}-member run`);
  });

  it('a range that differs in any one of line, end line, start col or end col is not part of the run', () => {
    const h = harness();
    const a = h.el('5:5:0:30');
    h.el('5:6:0:30');
    h.el('5:5:1:30');
    h.el('5:5:0:31');
    h.el('6:5:0:30');
    const run = h.api.findRunElements(a);
    assert.strictEqual(run.isRun, false);
    assert.deepStrictEqual(run.els, [a]);
  });

  it('a run is tinted flat (__hl-run) and a single element keeps its outline', () => {
    const h = harness();
    const a = h.el('1:1:0:5');
    const b = h.el('1:1:0:5');
    h.api.highlightElements([a, b], true);
    assert.strictEqual(classesOf(a), '__hl __hl-run');
    assert.strictEqual(classesOf(b), '__hl __hl-run');
    const solo = h.el('2:2:0:5');
    h.api.highlightElements([solo], false);
    assert.strictEqual(classesOf(solo), '__hl');
    assert.strictEqual(classesOf(a), '', 'the previous run must be cleared, every box of it');
    assert.strictEqual(classesOf(b), '');
  });

  it('a later highlight clears all of an earlier multi-box run, not just one element of it', () => {
    const h = harness();
    const run = [h.el('1:1:0:5'), h.el('1:1:0:5'), h.el('1:1:0:5')];
    h.api.highlightElements(run, true);
    const next = h.el('4:4:0:5');
    h.api.highlightElements([next], false);
    for (const e of run) assert.strictEqual(classesOf(e), '');
    assert.strictEqual(classesOf(next), '__hl');
  });

  it('fades after 1500ms and is removed entirely 600ms later', () => {
    const h = harness();
    const a = h.el('1:1:0:5');
    const b = h.el('1:1:0:5');
    h.api.highlightElements([a, b], true);
    h.advance(1499);
    assert.strictEqual(classesOf(a), '__hl __hl-run');
    h.advance(1);
    assert.strictEqual(classesOf(a), '__hl __hl-fade __hl-run');
    assert.strictEqual(classesOf(b), '__hl __hl-fade __hl-run');
    h.advance(599);
    assert.strictEqual(classesOf(a), '__hl __hl-fade __hl-run');
    h.advance(1);
    assert.strictEqual(classesOf(a), '');
    assert.strictEqual(classesOf(b), '');
  });

  it('replacing a highlight cancels the old one\'s pending fade, so it cannot cut the new one short', () => {
    const h = harness();
    const a = h.el('1:1:0:5');
    h.api.highlightElements([a], false);
    h.advance(1000);
    const b = h.el('2:2:0:5');
    h.api.highlightElements([b], false);
    h.advance(1000); // the old timer would have fired at 1500: b must still be plainly visible
    assert.strictEqual(classesOf(b), '__hl');
    assert.strictEqual(classesOf(a), '', 'the replaced element must not be touched again by its stale fade timer');
    h.advance(500);
    assert.strictEqual(classesOf(b), '__hl __hl-fade');
  });

  it('an empty element list highlights nothing and still clears the previous highlight', () => {
    const h = harness();
    const a = h.el('1:1:0:5');
    h.api.highlightElements([a], false);
    h.api.highlightElements([], false);
    assert.strictEqual(classesOf(a), '');
  });
});
