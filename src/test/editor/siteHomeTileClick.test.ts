import * as assert from 'assert';
import { getSiteNavClickHandlerScript } from '../../editor/ditaRenderUtils';

/**
 * A home-page tile (renderSiteHomeHtml) is deliberately NOT a
 * '.site-nav-link' -- see that function's own comment on why -- so its click
 * is handled by a small dedicated delegation inside
 * getSiteNavClickHandlerScript rather than the generic site-nav-link
 * handler. This wires that script up to fake DOM, the same way
 * siteHistoryWiring.test.ts does for the sidebar/back/forward wiring, and
 * checks the tile delegation specifically: it looks up the matching sidebar
 * link by data-site-target and drives the switch through THAT (so history/
 * active-class bookkeeping stays centralized in switchToSitePage), rather
 * than posting straight to the extension host itself.
 */

interface FakeEl {
  classList: { contains(c: string): boolean; add(c: string): void; remove(c: string): void };
  getAttribute(n: string): string | null;
  closest(sel: string): FakeEl | null;
}

function navLink(target: string, active = false): FakeEl {
  const classes = new Set(['site-nav-link']);
  if (active) classes.add('active');
  const el: FakeEl = {
    classList: { contains: (c) => classes.has(c), add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
    getAttribute: (n) => (n === 'data-site-target' ? target : null),
    closest: (sel) => (sel === '.site-nav-link' ? el : null),
  };
  return el;
}

/** A home tile: only ever matched by the '.site-home-tile[data-site-target]'
 *  selector the new delegation uses -- '.site-nav-link'.closest must NOT
 *  match it, which is the whole point of giving it its own class. */
function homeTile(target: string): FakeEl {
  const el: FakeEl = {
    classList: { contains: () => false, add: () => {}, remove: () => {} },
    getAttribute: (n) => (n === 'data-site-target' ? target : null),
    closest: (sel) => (sel === '.site-home-tile[data-site-target]' ? el : null),
  };
  return el;
}

function setup(links: FakeEl[]) {
  const listeners: Record<string, Array<(e: Record<string, unknown>) => void>> = {};
  const windowListeners: Record<string, Array<(e: Record<string, unknown>) => void>> = {};
  const window = {
    addEventListener: (evt: string, fn: (e: Record<string, unknown>) => void) => { (windowListeners[evt] = windowListeners[evt] || []).push(fn); },
  };
  const scroller = { scrollTop: 0 };
  const byId: Record<string, unknown> = { 'dita-content-root': scroller };
  const document = {
    addEventListener: (evt: string, fn: (e: Record<string, unknown>) => void) => { (listeners[evt] = listeners[evt] || []).push(fn); },
    querySelectorAll: (sel: string) => (sel === '.site-nav-link' ? links : []),
    querySelector: (sel: string) => (sel === '.site-nav-link.active' ? links.find((l) => l.classList.contains('active')) ?? null : null),
    getElementById: (id: string) => (byId[id] as unknown) ?? null,
  };
  const posted: Array<{ type: string; target: string }> = [];
  const vscode = {
    postMessage: (m: { type: string; target: string }) => posted.push(m),
    getState: () => undefined,
    setState: () => {},
  };
  const script = getSiteNavClickHandlerScript({ switchSitePageMsgType: 'switchSitePage' });
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('document', 'window', 'vscode', 'setTimeout', script)(document, window, vscode, () => 0);
  const fire = (e: Record<string, unknown>) => {
    const ev: Record<string, unknown> = { ...e, defaultPrevented: false, preventDefault: () => { ev.defaultPrevented = true; } };
    for (const fn of listeners.click || []) fn(ev);
  };
  const active = () => links.find((l) => l.classList.contains('active'))?.getAttribute('data-site-target') ?? null;
  return { fire, posted, active };
}

describe('home page tile click delegation', () => {
  it('switches to the target topic when a tile matches a sidebar link', () => {
    const s = setup([navLink('/w/a.dita', true), navLink('/w/b.dita')]);
    s.fire({ target: homeTile('/w/b.dita') });
    assert.strictEqual(s.posted.length, 1);
    assert.deepStrictEqual(s.posted[0], { type: 'switchSitePage', target: '/w/b.dita' });
    assert.strictEqual(s.active(), '/w/b.dita', 'switchToSitePage flips the active class, same as any other page switch');
  });

  it('does nothing for a tile whose target has no matching sidebar link (map edited/gone)', () => {
    const s = setup([navLink('/w/a.dita', true)]);
    s.fire({ target: homeTile('/w/gone.dita') });
    assert.strictEqual(s.posted.length, 0);
  });

  it('leaves a plain sidebar-link click to the existing site-nav-link handler, not this delegation', () => {
    const s = setup([navLink('/w/a.dita', true), navLink('/w/b.dita')]);
    s.fire({ target: navLink('/w/b.dita') });
    assert.strictEqual(s.posted.length, 1);
    assert.deepStrictEqual(s.posted[0], { type: 'switchSitePage', target: '/w/b.dita' });
  });

  it('ignores a click on neither a tile nor a nav link', () => {
    const s = setup([navLink('/w/a.dita', true)]);
    const plain: FakeEl = { classList: { contains: () => false, add: () => {}, remove: () => {} }, getAttribute: () => null, closest: () => null };
    s.fire({ target: plain });
    assert.strictEqual(s.posted.length, 0);
  });
});
