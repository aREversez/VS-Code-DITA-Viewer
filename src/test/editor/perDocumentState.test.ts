import * as assert from 'assert';
import { readForDocument, writeForDocument, StateStore } from '../../editor/perDocumentState';

/** In-memory stand-in for vscode.Memento: returns the stored value itself, like the real one. */
function makeStore(initial: Record<string, unknown> = {}): StateStore & { data: Record<string, unknown>; updates: number } {
  const store = {
    data: { ...initial },
    updates: 0,
    get<T>(key: string, defaultValue: T): T {
      return key in store.data ? (store.data[key] as T) : defaultValue;
    },
    update(key: string, value: unknown): Promise<void> {
      store.updates++;
      store.data[key] = value;
      return Promise.resolve();
    },
  };
  return store;
}

const KEY = 'test.byUri';
const A = { toString: () => 'file:///a.ditamap' };
const B = { toString: () => 'file:///b.ditamap' };

describe('per-document globalState buckets', () => {
  it('reads undefined for a document with no entry, and when the key was never written', () => {
    const store = makeStore();
    assert.strictEqual(readForDocument<string>(store, KEY, A), undefined);
    writeForDocument(store, KEY, B, 'x');
    assert.strictEqual(readForDocument<string>(store, KEY, A), undefined);
  });

  it('reads back what was written, keyed by the uri string', () => {
    const store = makeStore();
    writeForDocument(store, KEY, A, { mode: 'site' });
    assert.deepStrictEqual(readForDocument(store, KEY, A), { mode: 'site' });
    assert.deepStrictEqual(Object.keys(store.data[KEY] as object), ['file:///a.ditamap']);
  });

  it('keeps documents independent of each other and leaves other keys alone', () => {
    const store = makeStore({ other: 42 });
    writeForDocument(store, KEY, A, 'a');
    writeForDocument(store, KEY, B, 'b');
    writeForDocument(store, KEY, A, 'a2');
    assert.strictEqual(readForDocument(store, KEY, A), 'a2');
    assert.strictEqual(readForDocument(store, KEY, B), 'b');
    assert.strictEqual(store.data.other, 42);
  });

  it('never mutates the bucket object it read (the store may hand back its own copy)', () => {
    const before = { 'file:///b.ditamap': 'b' };
    const store = makeStore({ [KEY]: before });
    writeForDocument(store, KEY, A, 'a');
    assert.deepStrictEqual(before, { 'file:///b.ditamap': 'b' });
    assert.notStrictEqual(store.data[KEY], before);
  });

  it('survives a corrupt bucket (null, array, string) instead of throwing', () => {
    for (const bad of [null, [], 'oops', 7]) {
      const store = makeStore({ [KEY]: bad });
      assert.strictEqual(readForDocument(store, KEY, A), undefined);
      writeForDocument(store, KEY, A, 'ok');
      assert.strictEqual(readForDocument(store, KEY, A), 'ok');
    }
  });
});
