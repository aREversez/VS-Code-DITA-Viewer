import * as assert from 'assert';
import { chooseSourcePlacement, touchRecent } from '../../editor/sourceEditorPlacement';

const g = (key: string, ...textUris: string[]) => ({ key, textUris });

describe('chooseSourcePlacement (open a topic source away from the docsite preview)', () => {
  it('opens beside the preview when it is the only group', () => {
    assert.deepStrictEqual(chooseSourcePlacement([g('A')], 'A', ['A'], 'file:///t.dita'), { kind: 'beside' });
  });

  it('never picks the preview\'s own group, even when it is the most recently active', () => {
    const p = chooseSourcePlacement([g('A'), g('B')], 'A', ['A', 'B'], 'file:///t.dita');
    assert.deepStrictEqual(p, { kind: 'group', key: 'B' });
  });

  it('with several other groups, picks the most recently active one', () => {
    const groups = [g('A'), g('B'), g('C')];
    assert.deepStrictEqual(chooseSourcePlacement(groups, 'A', ['A', 'C', 'B'], 'file:///t.dita'), { kind: 'group', key: 'C' });
    assert.deepStrictEqual(chooseSourcePlacement(groups, 'A', ['B', 'A', 'C'], 'file:///t.dita'), { kind: 'group', key: 'B' });
  });

  it('reuses a non-preview group that already has the source open, ahead of recency', () => {
    const groups = [g('A'), g('B'), g('C', 'file:///t.dita')];
    assert.deepStrictEqual(chooseSourcePlacement(groups, 'A', ['A', 'B', 'C'], 'file:///t.dita'), { kind: 'group', key: 'C' });
  });

  it('a source open only in the preview\'s own group does not count as already open', () => {
    const groups = [g('A', 'file:///t.dita'), g('B')];
    assert.deepStrictEqual(chooseSourcePlacement(groups, 'A', ['A', 'B'], 'file:///t.dita'), { kind: 'group', key: 'B' });
  });

  it('skips recent keys of groups that no longer exist, and falls back to the first other group', () => {
    const groups = [g('A'), g('B'), g('C')];
    assert.deepStrictEqual(chooseSourcePlacement(groups, 'A', ['gone', 'A'], 'file:///t.dita'), { kind: 'group', key: 'B' });
  });
});

describe('touchRecent', () => {
  it('moves a key to the front without mutating and without duplicating it', () => {
    const before = ['a', 'b', 'c'];
    assert.deepStrictEqual(touchRecent(before, 'c'), ['c', 'a', 'b']);
    assert.deepStrictEqual(before, ['a', 'b', 'c']);
    assert.deepStrictEqual(touchRecent([], 'x'), ['x']);
  });
});
