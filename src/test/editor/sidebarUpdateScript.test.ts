import * as assert from 'assert';
import { getSidebarUpdateScript } from '../../editor/ditaRenderUtils';

/** A stand-in for one DOM element: just the members the handler touches, recording every write. */
interface FakeEl {
  innerHTML: string;
  writes: string[];
  querySelector(sel: string): FakeEl | null;
}

function makeEl(initial: string, links?: FakeEl): FakeEl {
  let html = initial;
  const writes: string[] = [];
  return {
    get innerHTML(): string { return html; },
    set innerHTML(v: string) { html = v; writes.push(v); },
    writes,
    querySelector: (sel: string) => (sel === '.site-nav-links' ? links ?? null : null),
  };
}

const makeNav = (links?: FakeEl): FakeEl => makeEl('searchbox+links', links);
const makeLinks = (): FakeEl => makeEl('old links');

function load(site: boolean, nav: FakeEl | null, updatePrevNext?: () => void): (html: string) => void {
  const script = getSidebarUpdateScript({ site });
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    'document',
    'updatePrevNextButtons',
    `${script}\nreturn applySidebarUpdate;`,
  ) as (d: unknown, u: unknown) => (html: string) => void;
  return factory({ querySelector: (sel: string) => (sel === '.site-nav' ? nav : null) }, updatePrevNext);
}

describe('sidebar update script', () => {
  describe('book mode', () => {
    it('replaces the whole nav content, as it always did', () => {
      const nav = makeNav();
      load(false, nav)('<ul>new</ul>');
      assert.deepStrictEqual(nav.writes, ['<ul>new</ul>']);
    });

    it('never mentions the site-only prev/next machinery (those identifiers are not declared in book mode)', () => {
      assert.ok(!getSidebarUpdateScript({ site: false }).includes('updatePrevNextButtons'));
    });
  });

  describe('site mode', () => {
    it('replaces only the link list, leaving the search box in the nav alone', () => {
      const links = makeLinks();
      const nav = makeNav(links);
      load(true, nav, () => undefined)('<ul>new</ul>');
      assert.deepStrictEqual(links.writes, ['<ul>new</ul>']);
      assert.deepStrictEqual(nav.writes, [], 'a write to the nav itself would wipe the search box');
    });

    it('re-derives prev/next from the new links, after they are in place', () => {
      const links = makeLinks();
      const nav = makeNav(links);
      const seen: string[] = [];
      load(true, nav, () => { seen.push(links.innerHTML); })('<ul>new</ul>');
      assert.deepStrictEqual(seen, ['<ul>new</ul>']);
    });

    it('falls back to the nav itself before the search box has wrapped the links, and still updates prev/next', () => {
      const nav = makeNav();
      let calls = 0;
      load(true, nav, () => { calls++; })('<ul>new</ul>');
      assert.deepStrictEqual(nav.writes, ['<ul>new</ul>']);
      assert.strictEqual(calls, 1);
    });
  });

  it('does nothing, and does not throw, when there is no sidebar', () => {
    assert.doesNotThrow(() => load(false, null)('<ul/>'));
    assert.doesNotThrow(() => load(true, null, () => { throw new Error('no nav, no prev/next'); })('<ul/>'));
  });
});
