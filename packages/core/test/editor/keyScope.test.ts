import * as assert from 'assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import {
  buildKeySpace,
  collectMapKeys,
  createKeyScopeIndex,
  getKeyScopes,
  getTopicScopeChains,
  resolveKeyInScope,
  scopeKeyIndexKey,
} from '../../src/editor/keySpace';

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

describe('the key scope index a key space keeps', () => {
  let root: string;
  const read = (p: string, enc: 'utf-8') => readFileSync(p, enc);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'keyscope-test-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeMap(name: string, body: string): string {
    const p = join(root, name);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, `<?xml version="1.0"?><map>${body}</map>`);
    return p;
  }
  const keydef = (keys: string, value: string, href?: string): string =>
    `<keydef keys="${keys}"${href ? ` href="${href}"` : ''}><topicmeta><keywords><keyword>${value}</keyword></keywords></topicmeta></keydef>`;

  function scopedIndex(mapPath: string) {
    const flat = new Map<string, string>();
    const scopes = createKeyScopeIndex();
    collectMapKeys(mapPath, flat, read, undefined, scopes);
    return { flat, scopes };
  }

  it('records each definition under the scope it sits in, the flat map unchanged', () => {
    const m = writeMap(
      'a.ditamap',
      `${keydef('k', 'root')}<topicgroup keyscope="s1">${keydef('k', 'one')}${keydef('only1', 'x')}</topicgroup>` +
        `<topicgroup keyscope="s2">${keydef('k', 'two')}</topicgroup>`,
    );
    const { flat, scopes } = scopedIndex(m);
    assert.strictEqual(resolveKeyInScope('k', [[]], scopes.values), 'root');
    assert.strictEqual(resolveKeyInScope('k', [['s1']], scopes.values), 'one');
    assert.strictEqual(resolveKeyInScope('k', [['s2']], scopes.values), 'two');
    assert.strictEqual(resolveKeyInScope('only1', [[]], scopes.values), undefined);
    assert.strictEqual(resolveKeyInScope('s1.only1', [[]], scopes.values), 'x');
    // the flat map still answers to bare and qualified names, first definition winning
    assert.strictEqual(flat.get('k'), 'root');
    assert.strictEqual(flat.get('only1'), 'x');
    assert.strictEqual(flat.get('s2.k'), 'two');
  });

  it('keeps the first definition of a (scope, name), as the flat map does', () => {
    const m = writeMap('a.ditamap', `${keydef('k', 'first')}${keydef('k', 'second')}`);
    assert.strictEqual(resolveKeyInScope('k', [[]], scopedIndex(m).scopes.values), 'first');
  });

  it('records a keyscope that lists several names under each of them', () => {
    const m = writeMap('a.ditamap', `<topicgroup keyscope="a b">${keydef('k', 'both')}</topicgroup>`);
    const { scopes } = scopedIndex(m);
    assert.strictEqual(resolveKeyInScope('k', [['a']], scopes.values), 'both');
    assert.strictEqual(resolveKeyInScope('k', [['b']], scopes.values), 'both');
  });

  it('records the resource target per scope, so a conkeyref follows the same definition as the text', () => {
    const m = writeMap(
      'a.ditamap',
      `<topicgroup keyscope="s1">${keydef('k', 'one', 'one.dita')}</topicgroup>` +
        `<topicgroup keyscope="s2">${keydef('k', 'two', 'two.dita')}</topicgroup>`,
    );
    const { scopes } = scopedIndex(m);
    assert.strictEqual(resolveKeyInScope('k', [['s1']], scopes.defs)?.href, 'one.dita');
    assert.strictEqual(resolveKeyInScope('k', [['s2']], scopes.defs)?.href, 'two.dita');
  });

  it('reads a key defined in a submap in the scope of the mapref that includes it', () => {
    writeMap('sub.ditamap', keydef('k', 'from sub'));
    const m = writeMap('a.ditamap', '<mapref href="sub.ditamap" keyscope="s1"/>');
    const { scopes } = scopedIndex(m);
    assert.strictEqual(resolveKeyInScope('k', [['s1']], scopes.values), 'from sub');
    assert.strictEqual(resolveKeyInScope('k', [[]], scopes.values), undefined);
  });

  it('records the scope chains of every topicref that publishes a topic, in document order', () => {
    const m = writeMap(
      'maps/a.ditamap',
      '<topicref href="../t.dita"/>' +
        '<topicgroup keyscope="s1"><topicref href="../t.dita"/><topicref href="../only-s1.dita"/></topicgroup>' +
        '<topicgroup keyscope="s2"><topicref href="../t.dita"/></topicgroup>' +
        '<topicgroup keyscope="s1"><topicref href="../t.dita"/></topicgroup>',
    );
    const { scopes } = scopedIndex(m);
    assert.deepStrictEqual(getTopicScopeChains(scopes, resolve(root, 't.dita')), [[[]], [['s1']], [['s2']]]);
    assert.deepStrictEqual(getTopicScopeChains(scopes, resolve(root, 'only-s1.dita')), [[['s1']]]);
    assert.strictEqual(getTopicScopeChains(scopes, resolve(root, 'nobody.dita')), undefined);
  });

  it('does not count a keydef, a submap reference or a web link as publishing a topic', () => {
    const m = writeMap(
      'a.ditamap',
      '<keydef keys="k" href="kd.dita"/><topicref href="sub.ditamap" format="ditamap"/>' +
        '<topicref href="https://example.com/x.dita" scope="external"/>',
    );
    const { scopes } = scopedIndex(m);
    assert.strictEqual(getTopicScopeChains(scopes, resolve(root, 'kd.dita')), undefined);
    assert.strictEqual(getTopicScopeChains(scopes, resolve(root, 'sub.ditamap')), undefined);
  });

  it('resolves a topicref in a submap against the map that holds it, in the including mapref\'s scope', () => {
    writeMap('sub/inner.ditamap', '<topicref href="in-sub.dita"/>');
    const m = writeMap('a.ditamap', '<mapref href="sub/inner.ditamap" keyscope="s1"/>');
    const { scopes } = scopedIndex(m);
    assert.deepStrictEqual(getTopicScopeChains(scopes, resolve(root, 'sub', 'in-sub.dita')), [[['s1']]]);
  });

  it('is what buildKeySpace returns, and is found from the values map it was built with', () => {
    const m = writeMap('a.ditamap', `<topicgroup keyscope="s1">${keydef('k', 'one')}</topicgroup>`);
    const space = buildKeySpace(m, [], read);
    assert.strictEqual(getKeyScopes(space.keys), space.scopes);
    assert.strictEqual(resolveKeyInScope('k', [['s1']], space.scopes.values), 'one');
    assert.strictEqual(getKeyScopes(new Map()), undefined);
  });

  it('lets an earlier map win a (scope, name) over a later one, as for the flat map', () => {
    const a = writeMap('a.ditamap', `<topicgroup keyscope="s1">${keydef('k', 'from a')}</topicgroup>`);
    const b = writeMap('b.ditamap', `<topicgroup keyscope="s1">${keydef('k', 'from b')}</topicgroup>`);
    const space = buildKeySpace(undefined, [a, b], read);
    assert.strictEqual(resolveKeyInScope('k', [['s1']], space.scopes.values), 'from a');
  });
});
