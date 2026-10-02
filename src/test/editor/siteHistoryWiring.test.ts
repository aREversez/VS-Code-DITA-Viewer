import * as assert from 'assert';
import { getSiteNavClickHandlerScript, getSiteHistoryButtonsScript } from '../../editor/ditaRenderUtils';

/**
 * The docsite page-switch script wired to a fake document: does a page switch
 * record history, do the back/forward entry points step through it, is the
 * scroll position handled, does the history survive a reload.
 */
interface FakeLink {
  classList: { contains(c: string): boolean; add(c: string): void; remove(c: string): void };
  getAttribute(n: string): string | null;
  closest(sel: string): unknown;
}

function link(target: string, active = false): FakeLink {
  const classes = new Set(['site-nav-link']);
  if (active) classes.add('active');
  const el: FakeLink = {
    classList: { contains: (c) => classes.has(c), add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
    getAttribute: (n) => (n === 'data-site-target' ? target : null),
    closest: (sel) => (sel === '.site-nav-link' ? el : null),
  };
  return el;
}

interface Button { disabled: boolean; onclick: (() => void) | null }

function setup(opts: { targets: string[]; active: string; savedState?: unknown; scrollTop?: number }) {
  const links = opts.targets.map((t) => link(t, t === opts.active));
  const scroller = { scrollTop: opts.scrollTop ?? 0 };
  const back: Button = { disabled: true, onclick: null };
  const forward: Button = { disabled: true, onclick: null };
  const byId: Record<string, unknown> = {
    'dita-content-root': scroller,
    '__site-back-btn': back,
    '__site-forward-btn': forward,
  };
  const listeners: Record<string, Array<(e: Record<string, unknown>) => void>> = {};
  const windowListeners: Record<string, Array<(e: Record<string, unknown>) => void>> = {};
  const window = {
    addEventListener: (evt: string, fn: (e: Record<string, unknown>) => void) => { (windowListeners[evt] = windowListeners[evt] || []).push(fn); },
  };
  const document = {
    addEventListener: (evt: string, fn: (e: Record<string, unknown>) => void) => { (listeners[evt] = listeners[evt] || []).push(fn); },
    querySelectorAll: (sel: string) => (sel === '.site-nav-link' ? links : []),
    querySelector: (sel: string) => (sel === '.site-nav-link.active' ? links.find((l) => l.classList.contains('active')) ?? null : null),
    getElementById: (id: string) => (byId[id] as unknown) ?? null,
  };
  const posted: Array<{ type: string; target: string }> = [];
  const stored: { value: unknown } = { value: opts.savedState };
  const vscode = {
    postMessage: (m: { type: string; target: string }) => posted.push(m),
    getState: () => stored.value,
    setState: (v: unknown) => { stored.value = v; },
  };
  const timers: Array<() => void> = [];
  const script = getSiteNavClickHandlerScript({ switchSitePageMsgType: 'switchSitePage' });
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const api = new Function(
    'document', 'window', 'vscode', 'setTimeout',
    `${script}
     return { pendingScroll: function() { return pendingSiteScroll; }, go: function(d) { siteHistoryGo(d); } };`,
  )(document, window, vscode, (fn: () => void) => { timers.push(fn); return 0; }) as { pendingScroll(): number | null; go(d: -1 | 1): void };
  const init = () => { for (const t of timers.splice(0)) t(); };
  // Dispatches like a browser bubbling from the target: the document's
  // listeners first, then the window's, with one shared event whose
  // defaultPrevented is what an earlier listener left it as.
  const fire = (evt: string, e: Record<string, unknown>) => {
    const ev: Record<string, unknown> = {
      ...e,
      defaultPrevented: false,
      preventDefault: () => { ev.defaultPrevented = true; (e as { prevented?: boolean }).prevented = true; },
    };
    for (const fn of listeners[evt] || []) fn(ev);
    for (const fn of windowListeners[evt] || []) fn(ev);
  };
  const click = (l: FakeLink) => fire('click', { target: l });
  const active = () => links.find((l) => l.classList.contains('active'))!.getAttribute('data-site-target');
  const linkOf = (t: string) => links.find((l) => l.getAttribute('data-site-target') === t)!;
  const removeLink = (t: string) => { links.splice(links.findIndex((l) => l.getAttribute('data-site-target') === t), 1); };
  const addDocumentListener = (evt: string, fn: (e: Record<string, unknown>) => void) => { document.addEventListener(evt, fn); };
  return { api, init, fire, click, active, linkOf, removeLink, posted, stored, scroller, back, forward, addDocumentListener };
}

const T = ['/a', '/b', '/c'];

describe('docsite back/forward wiring', () => {
  it('starts with nothing to go back or forward to', () => {
    const s = setup({ targets: T, active: '/a' });
    s.init();
    assert.strictEqual(s.back.disabled, true);
    assert.strictEqual(s.forward.disabled, true);
  });

  it('a page switch makes back available, and back returns to the previous page and asks the host for it', () => {
    const s = setup({ targets: T, active: '/a' });
    s.init();
    s.click(s.linkOf('/b'));
    assert.strictEqual(s.active(), '/b');
    assert.strictEqual(s.back.disabled, false);
    assert.strictEqual(typeof s.back.onclick, 'function');

    s.back.onclick!();
    assert.strictEqual(s.active(), '/a');
    assert.deepStrictEqual(s.posted.map((m) => m.target), ['/b', '/a']);
    assert.strictEqual(s.back.disabled, true);
    assert.strictEqual(s.forward.disabled, false);

    s.forward.onclick!();
    assert.strictEqual(s.active(), '/b');
    assert.deepStrictEqual(s.posted.map((m) => m.target), ['/b', '/a', '/b']);
  });

  it('stepping through the history does not add to it', () => {
    const s = setup({ targets: T, active: '/a' });
    s.init();
    s.click(s.linkOf('/b'));
    s.api.go(-1);
    s.api.go(1);
    s.api.go(-1);
    assert.strictEqual(s.forward.disabled, false, 'still able to go forward: the steps did not truncate or extend anything');
    assert.strictEqual(s.back.disabled, true);
  });

  it('a click on the page already showing does nothing to the history', () => {
    const s = setup({ targets: T, active: '/a' });
    s.init();
    s.click(s.linkOf('/a'));
    assert.strictEqual(s.back.disabled, true);
    assert.deepStrictEqual(s.posted, []);
  });

  it('steps over a page that has left the sidebar', () => {
    const s = setup({ targets: T, active: '/a' });
    s.init();
    s.click(s.linkOf('/b'));
    s.click(s.linkOf('/c'));
    s.removeLink('/b'); // the map was edited: /b is gone
    s.api.go(-1);
    assert.strictEqual(s.active(), '/a');
  });

  describe('scroll position of the content pane', () => {
    it('a plain navigation asks for the top of the new page (it used to keep the old page\'s offset)', () => {
      const s = setup({ targets: T, active: '/a', scrollTop: 640 });
      s.init();
      s.click(s.linkOf('/b'));
      assert.strictEqual(s.api.pendingScroll(), 0);
    });

    it('a navigation to an anchor leaves the scrolling to the anchor', () => {
      const s = setup({ targets: T, active: '/a', scrollTop: 640 });
      s.init();
      const xref = { getAttribute: (n: string) => (n === 'data-dita-book-xref' ? '/b#sec' : null), closest: (sel: string) => (sel === '[data-dita-book-xref]' ? xref : null) };
      s.fire('click', { target: xref });
      assert.strictEqual(s.active(), '/b');
      assert.strictEqual(s.api.pendingScroll(), null);
    });

    it('going back restores where the reader was, going forward restores where they left that page', () => {
      const s = setup({ targets: T, active: '/a', scrollTop: 640 });
      s.init();
      s.click(s.linkOf('/b'));          // leaves /a at 640
      s.scroller.scrollTop = 90;        // reads /b down to 90
      s.api.go(-1);
      assert.strictEqual(s.api.pendingScroll(), 640);
      s.scroller.scrollTop = 5;         // back on /a, moved a little
      s.api.go(1);
      assert.strictEqual(s.api.pendingScroll(), 90);
    });
  });

  describe('other ways in', () => {
    it('the mouse back and forward buttons step through the history', () => {
      const s = setup({ targets: T, active: '/a' });
      s.init();
      s.click(s.linkOf('/b'));
      const up = { button: 3 } as Record<string, unknown>;
      s.fire('mouseup', up);
      assert.strictEqual(s.active(), '/a');
      assert.strictEqual(up.prevented, true, 'the browser\'s own back navigation must not also run');
      s.fire('mouseup', { button: 4 });
      assert.strictEqual(s.active(), '/b');
      s.fire('mouseup', { button: 0 });
      assert.strictEqual(s.active(), '/b', 'the main button is not a history button');
    });

    it('leaves Alt+Left and Alt+Right entirely to VS Code: no navigation here, and nothing prevented', () => {
      const s = setup({ targets: T, active: '/b' });
      s.init();
      s.click(s.linkOf('/c'));
      for (const key of ['ArrowLeft', 'ArrowRight']) {
        const ev = { key, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false } as Record<string, unknown>;
        s.fire('keydown', ev);
        assert.strictEqual(ev.prevented, undefined, `Alt+${key} must reach VS Code's own handling`);
      }
      assert.strictEqual(s.active(), '/c');
      assert.deepStrictEqual(s.posted.map((m) => m.target), ['/c']);
    });
  });

  describe('arrow keys turn the page', () => {
    const key = (k: string, extra: Record<string, unknown> = {}) =>
      ({ key: k, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...extra }) as Record<string, unknown>;
    const inside = (...selectors: string[]) => ({ closest: (sel: string) => (selectors.some((x) => sel.includes(x)) ? {} : null) });

    it('Right goes to the next topic in reading order and Left to the previous one, as the toolbar buttons do', () => {
      const s = setup({ targets: T, active: '/b' });
      s.init();
      const right = key('ArrowRight');
      s.fire('keydown', right);
      assert.strictEqual(s.active(), '/c');
      assert.strictEqual(right.prevented, true);
      s.fire('keydown', key('ArrowLeft'));
      s.fire('keydown', key('ArrowLeft'));
      assert.strictEqual(s.active(), '/a');
      assert.deepStrictEqual(s.posted.map((m) => m.target), ['/c', '/b', '/a']);
    });

    it('does nothing, and does not swallow the key, at the first and last topic', () => {
      const s = setup({ targets: T, active: '/a' });
      s.init();
      const left = key('ArrowLeft');
      s.fire('keydown', left);
      assert.strictEqual(left.prevented, undefined);
      assert.strictEqual(s.active(), '/a');
      s.click(s.linkOf('/c'));
      const right = key('ArrowRight');
      s.fire('keydown', right);
      assert.strictEqual(right.prevented, undefined);
    });

    it('is ordinary navigation: it lands in the history and starts the new page at the top', () => {
      const s = setup({ targets: T, active: '/a', scrollTop: 500 });
      s.init();
      s.fire('keydown', key('ArrowRight'));
      assert.strictEqual(s.back.disabled, false);
      assert.strictEqual(s.api.pendingScroll(), 0);
    });

    it('is not ours with Shift, Ctrl, Meta or Alt held', () => {
      const s = setup({ targets: T, active: '/b' });
      s.init();
      for (const extra of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
        s.fire('keydown', key('ArrowRight', extra));
      }
      assert.strictEqual(s.active(), '/b');
    });

    it('is not ours in a text field, a dropdown, the sidebar tree or the sidebar resizer', () => {
      const s = setup({ targets: T, active: '/b' });
      s.init();
      for (const where of [inside('input'), inside('select'), inside('[contenteditable]'), inside('.site-nav-tree'), inside('[role="separator"]')]) {
        const ev = key('ArrowRight', { target: where });
        s.fire('keydown', ev);
        assert.strictEqual(ev.prevented, undefined);
      }
      assert.strictEqual(s.active(), '/b');
    });

    it('yields to whoever already took the key (the image lightbox steps through images with the same keys)', () => {
      const s = setup({ targets: T, active: '/b' });
      s.init();
      // Registered on the document after this script, as the lightbox's own handler is when it opens.
      s.addDocumentListener('keydown', (e) => (e as { preventDefault(): void }).preventDefault());
      s.fire('keydown', key('ArrowRight'));
      assert.strictEqual(s.active(), '/b');
    });
  });

  describe('surviving a reload (webview state)', () => {
    it('saves the history in the webview state after every page switch, without disturbing other state', () => {
      const s = setup({ targets: T, active: '/a', savedState: { other: 1 } });
      s.init();
      s.click(s.linkOf('/b'));
      const st = s.stored.value as { other: number; siteHistory: { entries: Array<{ target: string }>; index: number } };
      assert.strictEqual(st.other, 1);
      assert.deepStrictEqual(st.siteHistory.entries.map((e) => e.target), ['/a', '/b']);
      assert.strictEqual(st.siteHistory.index, 1);
    });

    it('picks the saved history back up when the page that came up is its current entry', () => {
      const saved = { siteHistory: { entries: [{ target: '/a', scrollTop: 30 }, { target: '/b', scrollTop: 0 }], index: 1 } };
      const s = setup({ targets: T, active: '/b', savedState: saved });
      s.init();
      assert.strictEqual(s.back.disabled, false);
      s.api.go(-1);
      assert.strictEqual(s.active(), '/a');
      assert.strictEqual(s.api.pendingScroll(), 30);
    });

    it('starts a fresh history when the saved one does not match the page that came up', () => {
      const saved = { siteHistory: { entries: [{ target: '/a', scrollTop: 0 }, { target: '/b', scrollTop: 0 }], index: 1 } };
      const s = setup({ targets: T, active: '/c', savedState: saved });
      s.init();
      assert.strictEqual(s.back.disabled, true);
    });
  });
});

describe('getSiteHistoryButtonsScript', () => {
  it('produces parseable script that defines a back and a forward button with the given labels', () => {
    const script = getSiteHistoryButtonsScript({ backLabel: '\u2190', backTitle: 'Back', forwardLabel: '\u2192', forwardTitle: 'Forward' });
    assert.doesNotThrow(() => new Function(script));
    assert.ok(script.includes("'__site-back-btn'") && script.includes("'__site-forward-btn'"));
    assert.ok(script.includes('"Back"') && script.includes('"Forward"'));
  });

  it('cannot be broken by a title with quotes in it (translations are free text)', () => {
    const script = getSiteHistoryButtonsScript({ backLabel: 'x', backTitle: 'a"b\'c', forwardLabel: 'y', forwardTitle: '</script>' });
    assert.doesNotThrow(() => new Function(script));
  });
});
