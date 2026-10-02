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

  describe('keyboard focus', () => {
    // A sidebar row's stand-in: focusing it is recorded, so a test can see
    // where focus was put back.
    function makeRow(id: string, focused: string[]): { row: unknown; focusEl: unknown } {
      const focusEl = { classList: { contains: (c: string) => c === 'site-nav-link' }, focus: () => { focused.push(id); } };
      const row = { getAttribute: (n: string) => (n === 'data-nav-id' ? id : null), children: [focusEl] };
      return { row, focusEl };
    }

    function navWith(rowsAfter: Array<{ row: unknown }>, activeRow: { row: unknown; focusEl: unknown } | null) {
      const nav = makeNav();
      const active = activeRow ? { closest: (sel: string) => (sel === '.site-nav-item' ? activeRow.row : null) } : null;
      const navFull = Object.assign(nav, {
        contains: (el: unknown) => el === active,
        querySelectorAll: (sel: string) => (sel === '.site-nav-item' ? rowsAfter.map((r) => r.row) : []),
      });
      return { nav: navFull, active };
    }

    function run(site: boolean, navObj: FakeEl, activeElement: unknown, html: string) {
      const script = getSidebarUpdateScript({ site });
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const factory = new Function('document', 'updatePrevNextButtons', `${script}\nreturn applySidebarUpdate;`) as (
        d: unknown, u: unknown,
      ) => (html: string) => void;
      factory({ querySelector: (s: string) => (s === '.site-nav' ? navObj : null), activeElement }, () => undefined)(html);
    }

    it('puts focus back on the same row of the new tree when it was inside the sidebar (book and site mode alike)', () => {
      for (const site of [false, true]) {
        const focused: string[] = [];
        const before = makeRow('/b', focused);
        const after = [makeRow('/a', focused), makeRow('/b', focused)];
        const { nav, active } = navWith(after, before);
        run(site, nav, active, '<ul>new</ul>');
        assert.deepStrictEqual(focused, ['/b'], `site=${site}`);
      }
    });

    it('does not take focus when it was not in the sidebar', () => {
      const focused: string[] = [];
      const { nav } = navWith([makeRow('/b', focused)], null);
      run(false, nav, { closest: () => null }, '<ul>new</ul>');
      assert.deepStrictEqual(focused, []);
    });

    it('lets focus go when the row it was on is not in the new tree', () => {
      const focused: string[] = [];
      const before = makeRow('/gone', focused);
      const { nav, active } = navWith([makeRow('/a', focused)], before);
      assert.doesNotThrow(() => run(false, nav, active, '<ul>new</ul>'));
      assert.deepStrictEqual(focused, []);
    });
  });
});
