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

/** One `  var NAME = ...;` line of the template, run as written. */
function extractVar(name: string): string {
  const start = topicSource.indexOf(`  var ${name} = `);
  assert.notStrictEqual(start, -1, `topicScript.ts no longer declares ${name}`);
  return topicSource.slice(start, topicSource.indexOf('\n', start));
}

interface FakeEl {
  attrs: Record<string, string>;
  parentElement: FakeEl | null;
  classes: Set<string>;
  classList: { add(c: string): void; remove(c: string): void };
  getAttribute(n: string): string | null;
  isConnected: boolean;
  rect: { top: number; height: number };
  getBoundingClientRect(): { top: number; height: number };
  scrollIntoView(opts: { block: string; behavior: string }): void;
}

interface FakeWindow {
  innerHeight: number;
  scrollY: number;
  scrollTo(opts: { top: number; behavior: string }): void;
}

function wire(visible: (el: FakeEl) => boolean = () => true) {
  const all: FakeEl[] = [];
  const scrolls: { top: number; behavior: string }[] = [];
  const reveals: { block: string; behavior: string }[] = [];
  const win: FakeWindow = {
    innerHeight: 700,
    scrollY: 0,
    scrollTo: (opts) => void scrolls.push(opts),
  };
  let scrollHeight = 20000;
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
      isConnected: true,
      rect: { top: 0, height: 20 },
      getBoundingClientRect: () => e.rect,
      scrollIntoView: (opts) => void reveals.push(opts),
    };
    all.push(e);
    return e;
  }

  const document = {
    querySelectorAll: (sel: string) => (sel === '[data-line]' ? all.slice() : []),
    documentElement: { get scrollHeight() { return scrollHeight; } },
  };
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

  const factory = new Function(
    'document',
    'window',
    'setTimeout',
    'clearTimeout',
    'isElementVisible',
    'onBegin',
    [
      getHighlightRunScript(),
      'var programmaticScroll = false;',
      'function beginProgrammaticScroll() { programmaticScroll = true; onBegin(); }',
      extractVar('ALIGN_SETTLE_MS'),
      extractVar('ALIGN_TOLERANCE_PX'),
      extractVar('alignPending'),
      extractFn('findClosest'),
      extractFn('findContaining'),
      extractFn('isTallAnchor'),
      extractFn('anchorDesiredTop'),
      extractFn('anchorNeedsScroll'),
      extractFn('scrollAnchorIntoPlace'),
      extractFn('settleAnchor'),
      extractFn('scrollToLine'),
      extractFn('applyHighlightLine'),
      'return { findContaining, applyHighlightLine, settleAnchor, scrollToLine, pending: function() { return alignPending; }, setInFlight: function(v) { programmaticScroll = v; }, cancel: function() { alignPending = null; } };',
    ].join('\n'),
  ) as (
    d: unknown,
    w: unknown,
    s: unknown,
    c: unknown,
    v: (el: FakeEl) => boolean,
    b: () => void,
  ) => {
    findContaining(line: number, col: number): FakeEl | null;
    applyHighlightLine(line: number, col: number): void;
    settleAnchor(): void;
    scrollToLine(targetLine: number, instant?: boolean): void;
    pending(): { el: FakeEl; attempts: number } | null;
    cancel(): void;
    setInFlight(v: boolean): void;
  };
  const api = factory(document, win, setTimeoutFake, clearTimeoutFake, visible, () => {
    programmaticBegins++;
  });

  return {
    el,
    api,
    win,
    scrolls,
    reveals,
    setScrollHeight: (h: number) => {
      scrollHeight = h;
    },
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

  it('an off-screen run scrolls its first box into place, marked programmatic', () => {
    const w = wire((e) => e.attrs['data-line'] !== '5');
    const section = w.el('2:20:0:9');
    const dl = w.el('5:5:0:30', section);
    const holder = w.el('5:5:0:30', section);
    dl.rect = { top: 900, height: 20 };
    holder.rect = { top: 1300, height: 20 };
    w.api.applyHighlightLine(5, 12);
    assert.strictEqual(w.scrolls.length, 1, 'one scroll for the whole run, not one per box');
    // The run's first box is the anchor: it is centered (a short element),
    // so the page moves by its top minus (viewport - height) / 2.
    assert.deepStrictEqual(w.scrolls[0], { top: 900 - (700 - 20) / 2, behavior: 'smooth' });
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

describe('the topic preview places a tall jump target by its top and keeps it there', () => {
  // A go-to-definition jump lands on a <section> that can be many screens
  // tall. Centering it put its middle on screen with the heading far above the
  // fold, and a smooth scroll computed before lazy images shrank landed off
  // again -- both seen in real Chromium (see test-visual).
  function tallSection(w: ReturnType<typeof wire>, top: number) {
    const section = w.el('12:40:0:9');
    section.rect = { top, height: 1640 };
    return section;
  }

  it('a tall element is put at the top of the page, not centered', () => {
    const w = wire((e) => e.rect.top < 0 || e.rect.top > 700);
    const section = tallSection(w, 5000);
    w.api.applyHighlightLine(12, 0);
    assert.strictEqual(w.scrolls.length, 1);
    // 20% of the 700px viewport = 140px below the edge; centering would have
    // been 5000 - (700 - 1640) / 2 = 5470.
    assert.deepStrictEqual(w.scrolls[0], { top: 5000 - 140, behavior: 'smooth' });
    assert.strictEqual(w.beginCount(), 1);
    assert.strictEqual(w.api.pending()?.el, section);
  });

  it('a tall element whose top is above the fold counts as not there yet, even though it overlaps the screen', () => {
    // Overlap is all isElementVisible checks, and a tall section that started
    // 470px up still overlapped -- so the first fix attempt never moved at all.
    const w = wire(() => true);
    w.win.scrollY = 3000; // somewhere the page can still scroll up from
    tallSection(w, -470);
    w.api.applyHighlightLine(12, 0);
    assert.strictEqual(w.scrolls.length, 1);
    assert.deepStrictEqual(w.scrolls[0], { top: 3000 - 470 - 140, behavior: 'smooth' });
  });

  it('a tall element whose top is already on screen is left alone', () => {
    const w = wire(() => true);
    tallSection(w, 300);
    w.api.applyHighlightLine(12, 0);
    assert.strictEqual(w.scrolls.length, 0);
    assert.strictEqual(w.beginCount(), 0);
    assert.strictEqual(w.api.pending(), null);
  });

  it('a cursor deep inside a tall element keeps the old overlap rule', () => {
    const w = wire(() => true);
    const section = tallSection(w, -470);
    w.el('20:20:0:30', section); // a paragraph in it, but the cursor is on line 20
    w.api.applyHighlightLine(20, 5);
    assert.strictEqual(w.scrolls.length, 0, 'reading the middle of a long section must not snap to its heading');
  });

  it('after the scroll settles, a layout shift is corrected with an instant scroll', () => {
    const w = wire((e) => e.rect.top < 0 || e.rect.top > 700);
    const section = tallSection(w, 5000);
    w.api.applyHighlightLine(12, 0);
    w.api.setInFlight(false); // scrollend has fired
    w.win.scrollY = 4860; // the smooth scroll landed where it was aimed...
    section.rect = { top: 140 + 526, height: 1640 }; // ...but images above shrank/loaded since
    w.api.settleAnchor();
    assert.strictEqual(w.scrolls.length, 2);
    assert.deepStrictEqual(w.scrolls[1], { top: 4860 + 526, behavior: 'auto' });
    assert.strictEqual(w.beginCount(), 2, 'the correction is programmatic too');
  });

  it('settling does nothing once the anchor is where it belongs, and keeps waiting for late image loads', () => {
    const w = wire((e) => e.rect.top < 0 || e.rect.top > 700);
    const section = tallSection(w, 5000);
    w.api.applyHighlightLine(12, 0);
    section.rect = { top: 140 + 5, height: 1640 }; // within tolerance
    w.api.settleAnchor();
    assert.strictEqual(w.scrolls.length, 1);
    assert.strictEqual(w.beginCount(), 1);
    assert.strictEqual(w.api.pending()?.el, section, 'still pending: an image can load later');
  });

  it('never raises the programmatic flag for a correction the page cannot make (end of document)', () => {
    // scrollend only fires for a scroll that moved something; a flag raised for
    // a clamped no-op would swallow the reader's next real scroll.
    const w = wire((e) => e.rect.top < 0 || e.rect.top > 700);
    const section = tallSection(w, 5000);
    w.api.applyHighlightLine(12, 0);
    w.api.setInFlight(false); // scrollend has fired
    w.setScrollHeight(5000 + 700);
    w.win.scrollY = 5000; // already at the very bottom
    section.rect = { top: 900, height: 1640 };
    w.api.settleAnchor();
    assert.strictEqual(w.scrolls.length, 1, 'only the original smooth scroll');
    assert.strictEqual(w.beginCount(), 1);
  });

  it('gives up after a few corrections, once the reader takes over, or when the element is gone', () => {
    const w = wire((e) => e.rect.top < 0 || e.rect.top > 700);
    const section = tallSection(w, 5000);
    w.api.applyHighlightLine(12, 0);
    for (let i = 0; i < 20; i++) {
      section.rect = { top: 900 + i, height: 1640 };
      w.api.settleAnchor();
    }
    assert.strictEqual(w.scrolls.length, 1 + 8, 'bounded: the first scroll plus at most 8 corrections');
    assert.strictEqual(w.api.pending(), null, 'the 9th settle drops the pending alignment');

    const w2 = wire((e) => e.rect.top < 0 || e.rect.top > 700);
    const s2 = tallSection(w2, 5000);
    w2.api.applyHighlightLine(12, 0);
    w2.api.cancel(); // what the wheel/touch/key/mouse listeners do
    s2.rect = { top: 900, height: 1640 };
    w2.api.settleAnchor();
    assert.strictEqual(w2.scrolls.length, 1);

    const w3 = wire((e) => e.rect.top < 0 || e.rect.top > 700);
    const s3 = tallSection(w3, 5000);
    w3.api.applyHighlightLine(12, 0);
    s3.isConnected = false; // a content swap replaced it
    s3.rect = { top: 900, height: 1640 };
    w3.api.settleAnchor();
    assert.strictEqual(w3.scrolls.length, 1);
    assert.strictEqual(w3.api.pending(), null);
  });
});

describe('a highlight that arrives while a programmatic scroll is still in flight', () => {
  // Clicking a link places the cursor at the link, and the go-to-definition
  // jump follows a few ms later. Reproduced in real Chromium: the target
  // looked on screen at the moment the second highlight arrived (the page was
  // only just leaving it), nothing was asked for, and the first scroll carried
  // the preview to the link and left it there.
  it('re-aims instead of trusting where the page happens to be right now', () => {
    const w = wire(() => true); // everything "visible" at this instant
    const section = w.el('12:40:0:9');
    section.rect = { top: 300, height: 1640 }; // top on screen: normally "already there"
    w.api.setInFlight(true);
    w.api.applyHighlightLine(12, 0);
    assert.strictEqual(w.scrolls.length, 1, 'a new scroll replaces the one in flight');
    assert.deepStrictEqual(w.scrolls[0], { top: 300 - 140, behavior: 'smooth' });
  });

  it('re-aims even when the target is exactly where the page is, since that is the only way to cancel the old animation', () => {
    const w = wire(() => true);
    const section = w.el('12:40:0:9');
    section.rect = { top: 140, height: 1640 };
    w.api.setInFlight(true);
    w.api.applyHighlightLine(12, 0);
    assert.strictEqual(w.scrolls.length, 1);
    assert.deepStrictEqual(w.scrolls[0], { top: 0, behavior: 'smooth' });
  });

  it('without a scroll in flight an on-screen target is still left alone', () => {
    const w = wire(() => true);
    const section = w.el('12:40:0:9');
    section.rect = { top: 300, height: 1640 };
    w.api.applyHighlightLine(12, 0);
    assert.strictEqual(w.scrolls.length, 0);
  });
});

describe('a source-side reveal (revealLine) that arrives after a highlight', () => {
  // A reveal is how the source editor tells the preview which line to follow
  // (DitaViewerProvider posts it ~120ms after the editor's visible range
  // moves). Because settleAnchor() now runs on every programmatic scrollend, a
  // highlight's still-pending correction used to drag the page back to the
  // highlighted element immediately after the reveal had landed it on the line
  // the reader was looking at -- and again on every further source scroll for
  // the rest of the 3s window.
  function tallSection(w: ReturnType<typeof wire>, top: number) {
    const section = w.el('12:40:0:9');
    section.rect = { top, height: 1640 };
    return section;
  }

  it('drops the pending correction, so the reveal is not dragged back to the highlight', () => {
    const w = wire((e) => e.rect.top < 0 || e.rect.top > 700);
    const section = tallSection(w, 5000);
    w.api.applyHighlightLine(12, 0); // smooth scroll to the section, correction pending
    w.api.setInFlight(false); // that scroll's scrollend
    section.rect = { top: 140, height: 1640 }; // landed on target

    const p = w.el('40:40:0:30');
    p.rect = { top: 2800, height: 20 }; // well down the page: where the source now is
    w.api.scrollToLine(40);
    assert.deepStrictEqual(w.reveals, [{ block: 'start', behavior: 'smooth' }], 'the reveal still scrolls as before');

    w.api.setInFlight(false); // the reveal scroll's scrollend
    section.rect = { top: 2800, height: 1640 }; // the reveal moved the page far from it
    w.api.settleAnchor();

    assert.strictEqual(w.api.pending(), null, 'the reveal replaced the highlight as the instruction to follow');
    assert.strictEqual(w.scrolls.length, 1, 'only the highlight\'s own smooth scroll: no yank back');
    assert.strictEqual(w.beginCount(), 2, 'one begin per real scroll, the reveal included');
  });

  it('a reveal to a line already at the top of the viewport asks for nothing', () => {
    const w = wire();
    const p = w.el('40:40:0:30');
    p.rect = { top: 2, height: 20 }; // inside the +/-5px the reveal treats as "there"
    w.api.scrollToLine(40);
    assert.strictEqual(w.reveals.length, 0);
    assert.strictEqual(w.beginCount(), 0, 'a flag raised for a no-op scroll would have no scrollend to clear it');
  });

  it('a reveal to the top of an already-at-top page raises no flag and scrolls nothing', () => {
    // scrollend never fires for a scroll that moves nothing, so the raised flag
    // survived until the reader's next real scroll cleared (and was swallowed by)
    // it -- and the first highlight after load read it as "a scroll is in
    // flight", re-centring even a target that was already on screen.
    const w = wire();
    w.win.scrollY = 0; // the source editor sits at line 0, the preview's default
    w.api.scrollToLine(0);
    assert.strictEqual(w.scrolls.length, 0);
    assert.strictEqual(w.beginCount(), 0);
  });

  it('a reveal to the top from further down still scrolls, marked programmatic', () => {
    const w = wire();
    w.win.scrollY = 4000;
    w.api.scrollToLine(0);
    assert.deepStrictEqual(w.scrolls[0], { top: 0, behavior: 'smooth' });
    assert.strictEqual(w.beginCount(), 1);
  });
});

describe('the correction an image load triggers', () => {
  it('waits a frame, because in the capture phase the image has not been resized yet', () => {
    // enhanceOneImage hangs its own load handler on the <img> (target phase) and
    // that is what applies the default preview scale, so a capture-phase
    // measurement reads the natural size and aims the correction at a layout
    // that is about to be replaced. Real Chromium covers the outcome; this pins
    // the ordering that makes it possible.
    const listener = /document\.addEventListener\('load',[\s\S]*?\}, true\);/.exec(topicSource);
    assert.ok(listener, 'topicScript.ts no longer registers the document-level load listener');
    assert.ok(/requestAnimationFrame\(/.test(listener[0]), 'measuring inside the capture phase reads the pre-resize box');
  });
});

describe('the programmatic-scroll flag cannot be left raised by a scroll that moves nothing', () => {
  // scrollend never fires for a scroll that moved nothing. Reproduced in real
  // Chromium: a revealLine to a line sitting below the top of the screen, on
  // a page already at the end of the document, raised the flag for a
  // scrollIntoView that the end of the document clamped to a no-op, and the
  // reader's next scroll was swallowed instead of reported.
  it('a reveal the end of the document clamps to nothing raises no flag and scrolls nothing', () => {
    const w = wire();
    const last = w.el('30:30:0:40');
    last.rect = { top: 300, height: 40 };
    w.setScrollHeight(14759 + 700);
    w.win.scrollY = 14759; // the very bottom
    w.api.scrollToLine(30);
    assert.strictEqual(w.beginCount(), 0);
    assert.strictEqual(w.reveals.length, 0);
  });

  it('a reveal the page can make still raises the flag and scrolls', () => {
    const w = wire();
    const el = w.el('30:30:0:40');
    el.rect = { top: 300, height: 40 };
    w.setScrollHeight(20000);
    w.win.scrollY = 1000;
    w.api.scrollToLine(30);
    assert.strictEqual(w.beginCount(), 1);
    assert.strictEqual(w.reveals.length, 1);
  });

  function wireFlag(hasScrollend: boolean) {
    const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
    let settles = 0;
    const factory = new Function(
      'window',
      'setTimeout',
      'clearTimeout',
      'settleAnchor',
      [
        extractVar('programmaticScroll'),
        extractVar('programmaticScrollFallbackTimer'),
        extractVar('supportsScrollend'),
        extractVar('PROGRAMMATIC_SCROLL_WATCHDOG_MS'),
        extractVar('PROGRAMMATIC_SCROLL_FALLBACK_MS'),
        extractFn('beginProgrammaticScroll'),
        'return { begin: beginProgrammaticScroll, up: function() { return programmaticScroll; }, set: function(v) { programmaticScroll = v; } };',
      ].join('\n'),
    ) as (
      w: unknown,
      s: (fn: () => void, ms: number) => number,
      c: (id: number) => void,
      settle: () => void,
    ) => { begin(): void; up(): boolean; set(v: boolean): void };
    const api = factory(
      hasScrollend ? { onscrollend: null } : {},
      (fn, ms) => timers.push({ fn, ms, cleared: false }),
      (id) => {
        if (timers[id - 1]) timers[id - 1].cleared = true;
      },
      () => void settles++,
    );
    return { api, timers, settles: () => settles };
  }

  it('whatever raises the flag also arms a watchdog that ends the scroll like scrollend would', () => {
    const f = wireFlag(true);
    f.api.begin();
    assert.strictEqual(f.api.up(), true);
    assert.strictEqual(f.timers.length, 1);
    assert.strictEqual(f.timers[0].ms, 4000);
    f.timers[0].fn();
    assert.strictEqual(f.api.up(), false, 'a flag nobody lowered comes down by itself');
    assert.strictEqual(f.settles(), 1, 'and runs the correction scrollend would have run');
  });

  it('a second scroll replaces the first one\'s watchdog instead of being cut short by it', () => {
    const f = wireFlag(true);
    f.api.begin();
    f.api.begin();
    assert.strictEqual(f.timers.length, 2);
    assert.strictEqual(f.timers[0].cleared, true);
    assert.strictEqual(f.timers[1].cleared, false);
  });

  it('a watchdog that fires after scrollend already lowered the flag does nothing', () => {
    const f = wireFlag(true);
    f.api.begin();
    f.api.set(false); // scrollend ran
    f.timers[0].fn();
    assert.strictEqual(f.settles(), 0);
  });

  it('without scrollend the same timer is the only thing that ends a scroll, with the shorter wait', () => {
    const f = wireFlag(false);
    f.api.begin();
    assert.strictEqual(f.timers[0].ms, 2000);
    f.timers[0].fn();
    assert.strictEqual(f.api.up(), false);
    assert.strictEqual(f.settles(), 1, 'the correction runs there too, which scrollend-less webviews never got');
  });
});
