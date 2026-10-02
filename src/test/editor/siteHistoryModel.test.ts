import * as assert from 'assert';
import { getSiteHistoryModelScript } from '../../editor/ditaRenderUtils';

interface Entry { target: string; scrollTop: number }
interface History { entries: Entry[]; index: number }
interface Model {
  create(target: string): History;
  push(h: History, target: string, leavingScrollTop: number): History;
  step(h: History, dir: -1 | 1, exists: (t: string) => boolean, leavingScrollTop: number): { history: History; entry: Entry } | null;
  can(h: History, dir: -1 | 1, exists: (t: string) => boolean): boolean;
  restore(raw: unknown, activeTarget: string): History;
  LIMIT: number;
}

function load(): Model {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    `${getSiteHistoryModelScript()}
     return { create: siteHistoryCreate, push: siteHistoryPush, step: siteHistoryStep,
              can: siteHistoryCan, restore: siteHistoryRestore, LIMIT: SITE_HISTORY_LIMIT };`,
  ) as () => Model;
  return factory();
}

const always = () => true;
const targets = (h: History) => h.entries.map((e) => e.target);

describe('site history model', () => {
  const m = load();

  it('starts with the page that is showing, at scroll 0', () => {
    assert.deepStrictEqual(m.create('/a'), { entries: [{ target: '/a', scrollTop: 0 }], index: 0 });
  });

  describe('push', () => {
    it('appends the new page and remembers where the reader was on the page they left', () => {
      const h = m.push(m.create('/a'), '/b', 420);
      assert.deepStrictEqual(h, { entries: [{ target: '/a', scrollTop: 420 }, { target: '/b', scrollTop: 0 }], index: 1 });
    });

    it('drops the forward entries when navigating from the middle of the history, like a browser', () => {
      let h = m.push(m.push(m.create('/a'), '/b', 0), '/c', 0);
      h = m.step(h, -1, always, 0)!.history;
      h = m.step(h, -1, always, 0)!.history;
      h = m.push(h, '/d', 0);
      assert.deepStrictEqual(targets(h), ['/a', '/d']);
      assert.strictEqual(h.index, 1);
    });

    it('does nothing for the page that is already showing', () => {
      const h = m.create('/a');
      assert.strictEqual(m.push(h, '/a', 99), h);
    });

    it('does not mutate the history it was given (it is also what gets persisted)', () => {
      const h = m.create('/a');
      const before = JSON.stringify(h);
      m.push(h, '/b', 5);
      assert.strictEqual(JSON.stringify(h), before);
    });

    it('caps the length by dropping the oldest entries and keeps the index on the current page', () => {
      let h = m.create('/p0');
      for (let i = 1; i <= m.LIMIT + 20; i++) h = m.push(h, `/p${i}`, 0);
      assert.strictEqual(h.entries.length, m.LIMIT);
      assert.strictEqual(h.entries[h.index].target, `/p${m.LIMIT + 20}`);
      assert.strictEqual(h.index, m.LIMIT - 1);
      assert.strictEqual(h.entries[0].target, '/p21');
    });
  });

  describe('step', () => {
    const three = () => m.push(m.push(m.create('/a'), '/b', 10), '/c', 20);

    it('goes back and forward and returns the entry to land on, with its saved scroll', () => {
      const back = m.step(three(), -1, always, 30)!;
      assert.strictEqual(back.entry.target, '/b');
      assert.strictEqual(back.entry.scrollTop, 20, 'the position it was left at when going on to /c');
      assert.strictEqual(back.history.index, 1);
      const forward = m.step(back.history, 1, always, 0)!;
      assert.strictEqual(forward.entry.target, '/c');
      assert.strictEqual(forward.entry.scrollTop, 30, 'the scroll position left behind when going back is what forward restores');
    });

    it('is null at either end', () => {
      assert.strictEqual(m.step(m.create('/a'), -1, always, 0), null);
      assert.strictEqual(m.step(m.create('/a'), 1, always, 0), null);
      assert.strictEqual(m.step(three(), 1, always, 0), null);
    });

    it('skips entries whose page is gone from the book and lands on the next one that exists', () => {
      const h = three();
      const r = m.step(h, -1, (t) => t !== '/b', 0)!;
      assert.strictEqual(r.entry.target, '/a');
      assert.strictEqual(r.history.index, 0);
    });

    it('is null when every entry in that direction is gone', () => {
      assert.strictEqual(m.step(three(), -1, (t) => t === '/c', 0), null);
    });

    it('skips an entry that is the page already showing (a neighbour left equal by removed entries)', () => {
      let h = m.push(m.push(m.create('/a'), '/b', 0), '/a', 0);
      const r = m.step(h, -1, (t) => t !== '/b', 0);
      assert.strictEqual(r, null, 'the only earlier entry that exists is /a, which is where the reader already is');
      h = m.create('/a');
      assert.strictEqual(m.step(h, -1, always, 0), null);
    });

    it('does not mutate its input', () => {
      const h = three();
      const before = JSON.stringify(h);
      m.step(h, -1, always, 77);
      assert.strictEqual(JSON.stringify(h), before);
    });
  });

  describe('can', () => {
    it('agrees with step about whether there is somewhere to go', () => {
      const h = m.push(m.create('/a'), '/b', 0);
      assert.strictEqual(m.can(h, -1, always), true);
      assert.strictEqual(m.can(h, 1, always), false);
      assert.strictEqual(m.can(h, -1, () => false), false);
    });
  });

  describe('restore (what a reloaded page reads back from webview state)', () => {
    it('takes a well-formed history whose current page is the one showing', () => {
      const h = m.push(m.create('/a'), '/b', 12);
      assert.deepStrictEqual(m.restore(JSON.parse(JSON.stringify(h)), '/b'), h);
    });

    it('starts over when the current entry is not the page that came up', () => {
      const h = m.push(m.create('/a'), '/b', 12);
      assert.deepStrictEqual(m.restore(h, '/z'), m.create('/z'));
    });

    it('starts over for anything malformed rather than trusting it', () => {
      const bad: unknown[] = [
        undefined, null, 'x', 3, [], {},
        { entries: 'no', index: 0 },
        { entries: [], index: 0 },
        { entries: [{ target: '/a', scrollTop: 0 }], index: 5 },
        { entries: [{ target: '/a', scrollTop: 0 }], index: -1 },
        { entries: [{ target: '/a', scrollTop: 0 }], index: 0.5 },
        { entries: [{ target: 7, scrollTop: 0 }], index: 0 },
        { entries: [{ target: '/a', scrollTop: 'far' }], index: 0 },
        { entries: [{ target: '/a' }], index: 0 },
      ];
      for (const raw of bad) {
        assert.deepStrictEqual(m.restore(raw, '/a'), m.create('/a'), JSON.stringify(raw));
      }
    });

    it('clamps an oversized stored history to the limit', () => {
      const entries = Array.from({ length: m.LIMIT + 30 }, (_, i) => ({ target: `/p${i}`, scrollTop: 0 }));
      const h = m.restore({ entries, index: entries.length - 1 }, `/p${entries.length - 1}`);
      assert.strictEqual(h.entries.length, m.LIMIT);
      assert.strictEqual(h.entries[h.index].target, `/p${entries.length - 1}`);
    });
  });
});
