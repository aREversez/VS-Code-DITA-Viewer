import * as assert from 'assert';
import { stable } from '../helpers/stable';

describe('stable (how conformance compares results)', () => {
  it('tells Sets and Maps with different members apart, which JSON.stringify cannot', () => {
    assert.strictEqual(JSON.stringify({ s: new Set([1]) }), JSON.stringify({ s: new Set([2]) }));
    assert.notStrictEqual(stable({ s: new Set([1]) }), stable({ s: new Set([2]) }));
    assert.notStrictEqual(stable({ m: new Map([['a', 1]]) }), stable({ m: new Map([['a', 2]]) }));
  });

  it('ignores the insertion order of a Set, and keeps that of a Map', () => {
    assert.strictEqual(stable({ s: new Set(['b', 'a']) }), stable({ s: new Set(['a', 'b']) }));
    assert.notStrictEqual(stable({ m: new Map([['a', 1], ['b', 2]]) }), stable({ m: new Map([['b', 2], ['a', 1]]) }));
  });

  it('does not confuse a Set with an array or an object of the same shape', () => {
    assert.notStrictEqual(stable({ x: new Set(['a']) }), stable({ x: ['a'] }));
  });
});
