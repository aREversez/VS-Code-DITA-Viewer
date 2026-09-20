import * as assert from 'assert';
import { getSiteNavKeyboardScript } from '../../editor/ditaRenderUtils';

interface Row { hasChildren: boolean; expanded: boolean; parent: number }
type Action = { type: 'focus' | 'expand' | 'collapse' | 'activate'; index: number } | null;

function load(): (rows: Row[], index: number, key: string) => Action {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function('document', 'MutationObserver', `${getSiteNavKeyboardScript()}\nreturn siteNavKeyAction;`) as (
    d: unknown, m: unknown,
  ) => (rows: Row[], index: number, key: string) => Action;
  return factory({ addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] }, undefined);
}

/**
 * The visible rows of this tree, top to bottom:
 *   0  Part (expanded)          parent -1
 *   1    Alpha                  parent 0
 *   2    Section (expanded)     parent 0
 *   3      Deep                 parent 2
 *   4  Folder (collapsed)       parent -1
 *   5  Gamma                    parent -1
 * (Folder's children are not visible, so they are not rows at all.)
 */
const rows: Row[] = [
  { hasChildren: true, expanded: true, parent: -1 },
  { hasChildren: false, expanded: false, parent: 0 },
  { hasChildren: true, expanded: true, parent: 0 },
  { hasChildren: false, expanded: false, parent: 2 },
  { hasChildren: true, expanded: false, parent: -1 },
  { hasChildren: false, expanded: false, parent: -1 },
];

describe('siteNavKeyAction', () => {
  const act = load();

  it('ArrowDown and ArrowUp move between visible rows and stop at the ends', () => {
    assert.deepStrictEqual(act(rows, 0, 'ArrowDown'), { type: 'focus', index: 1 });
    assert.deepStrictEqual(act(rows, 3, 'ArrowDown'), { type: 'focus', index: 4 }, 'the collapsed folder\'s hidden children are skipped by construction');
    assert.deepStrictEqual(act(rows, 5, 'ArrowDown'), null);
    assert.deepStrictEqual(act(rows, 5, 'ArrowUp'), { type: 'focus', index: 4 });
    assert.deepStrictEqual(act(rows, 0, 'ArrowUp'), null);
  });

  it('Home and End go to the first and last visible row', () => {
    assert.deepStrictEqual(act(rows, 3, 'Home'), { type: 'focus', index: 0 });
    assert.deepStrictEqual(act(rows, 3, 'End'), { type: 'focus', index: 5 });
    assert.deepStrictEqual(act(rows, 0, 'Home'), null);
    assert.deepStrictEqual(act(rows, 5, 'End'), null);
  });

  describe('ArrowRight', () => {
    it('expands a collapsed parent', () => {
      assert.deepStrictEqual(act(rows, 4, 'ArrowRight'), { type: 'expand', index: 4 });
    });
    it('moves to the first child of an expanded parent', () => {
      assert.deepStrictEqual(act(rows, 0, 'ArrowRight'), { type: 'focus', index: 1 });
      assert.deepStrictEqual(act(rows, 2, 'ArrowRight'), { type: 'focus', index: 3 });
    });
    it('does nothing on a leaf', () => {
      assert.deepStrictEqual(act(rows, 1, 'ArrowRight'), null);
    });
    it('does nothing on an expanded parent that shows no children (an empty group)', () => {
      const lonely: Row[] = [{ hasChildren: true, expanded: true, parent: -1 }, { hasChildren: false, expanded: false, parent: -1 }];
      assert.deepStrictEqual(act(lonely, 0, 'ArrowRight'), null);
    });
  });

  describe('ArrowLeft', () => {
    it('collapses an expanded parent', () => {
      assert.deepStrictEqual(act(rows, 2, 'ArrowLeft'), { type: 'collapse', index: 2 });
    });
    it('moves to the parent from a child, a leaf or a collapsed parent', () => {
      assert.deepStrictEqual(act(rows, 3, 'ArrowLeft'), { type: 'focus', index: 2 });
      assert.deepStrictEqual(act(rows, 1, 'ArrowLeft'), { type: 'focus', index: 0 });
      const nested: Row[] = [{ hasChildren: true, expanded: true, parent: -1 }, { hasChildren: true, expanded: false, parent: 0 }];
      assert.deepStrictEqual(act(nested, 1, 'ArrowLeft'), { type: 'focus', index: 0 });
    });
    it('does nothing at the top level on a leaf or a collapsed parent', () => {
      assert.deepStrictEqual(act(rows, 5, 'ArrowLeft'), null);
      assert.deepStrictEqual(act(rows, 4, 'ArrowLeft'), null);
    });
  });

  it('Enter and Space activate the row', () => {
    assert.deepStrictEqual(act(rows, 1, 'Enter'), { type: 'activate', index: 1 });
    assert.deepStrictEqual(act(rows, 1, ' '), { type: 'activate', index: 1 });
  });

  it('ignores every other key, and an index that is not a row', () => {
    for (const k of ['a', 'Tab', 'Escape', 'PageDown', 'ArrowDownn']) assert.strictEqual(act(rows, 1, k), null, k);
    assert.strictEqual(act(rows, -1, 'ArrowDown'), null);
    assert.strictEqual(act(rows, 99, 'ArrowDown'), null);
    assert.strictEqual(act([], 0, 'ArrowDown'), null);
  });
});
