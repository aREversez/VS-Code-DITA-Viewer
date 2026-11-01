import * as assert from 'assert';
import { resolveKeyInScope, scopeKeyIndexKey } from '../../src/editor/keySpace';

// An index the way a crawl or a key space builds it: one entry per (scope, name).
function indexOf(defs: Array<[scope: string[], name: string, value: string]>): Map<string, string> {
  const index = new Map<string, string>();
  for (const [scope, name, value] of defs) {
    const k = scopeKeyIndexKey(scope.join('/'), name);
    if (!index.has(k)) index.set(k, value);
  }
  return index;
}

describe('resolveKeyInScope', () => {
  const twoScopes = indexOf([
    [['s1'], 'k', 'from s1'],
    [['s2'], 'k', 'from s2'],
    [[], 'k', 'from root'],
    [[], 'only-root', 'root only'],
    [['s1'], 'only-s1', 's1 only'],
  ]);

  it('finds the key in the use\'s own scope', () => {
    assert.strictEqual(resolveKeyInScope('k', [['s1']], twoScopes), 'from s1');
    assert.strictEqual(resolveKeyInScope('k', [['s2']], twoScopes), 'from s2');
  });

  it('falls back to the enclosing scope, nearest first', () => {
    assert.strictEqual(resolveKeyInScope('only-root', [['s1']], twoScopes), 'root only');
    assert.strictEqual(resolveKeyInScope('k', [[]], twoScopes), 'from root');
    assert.strictEqual(resolveKeyInScope('k', [['s3']], twoScopes), 'from root');
  });

  it('does not see a key of a sibling or inner scope by its bare name', () => {
    assert.strictEqual(resolveKeyInScope('only-s1', [[]], twoScopes), undefined);
    assert.strictEqual(resolveKeyInScope('only-s1', [['s2']], twoScopes), undefined);
  });

  it('reaches a scoped key from outside by its qualified name', () => {
    assert.strictEqual(resolveKeyInScope('s1.only-s1', [[]], twoScopes), 's1 only');
    assert.strictEqual(resolveKeyInScope('s2.k', [['s1']], twoScopes), 'from s2');
  });

  it('resolves through nested scopes, the inner definition winning', () => {
    const nested = indexOf([
      [['x'], 'k', 'x'],
      [['x', 'y'], 'k', 'x.y'],
      [['x'], 'only-x', 'x only'],
    ]);
    assert.strictEqual(resolveKeyInScope('k', [['x', 'y']], nested), 'x.y');
    assert.strictEqual(resolveKeyInScope('only-x', [['x', 'y']], nested), 'x only');
    assert.strictEqual(resolveKeyInScope('y.k', [['x']], nested), 'x.y');
    assert.strictEqual(resolveKeyInScope('x.y.k', [[]], nested), 'x.y');
  });

  it('tries every chain of a keyscope that lists several names, first hit wins', () => {
    const multi = indexOf([
      [['b'], 'k', 'from b'],
    ]);
    assert.strictEqual(resolveKeyInScope('k', [['a'], ['b']], multi), 'from b');
    assert.strictEqual(resolveKeyInScope('k', [['a']], multi), undefined);
  });

  it('returns undefined for a key nothing defines', () => {
    assert.strictEqual(resolveKeyInScope('nope', [['s1']], twoScopes), undefined);
  });

  it('keeps a dot inside a key name that is defined with one', () => {
    const dotted = indexOf([[[], 'a.b', 'dotted']]);
    assert.strictEqual(resolveKeyInScope('a.b', [[]], dotted), 'dotted');
  });
});
