import * as assert from 'assert';
import { createRefCountedPool } from '../../editor/refCountedPool';

/**
 * The pool is the lifecycle rule behind the shared DITA file watcher in
 * ditaFileWatcher.ts: one watcher per folder, however many preview panels and
 * sidebar trees are listening. Testing the rule here rather than through
 * vscode is the whole point -- a real FileSystemWatcher can only be observed
 * inside a running extension host, and "did the last panel closing actually
 * dispose it" is exactly the kind of thing that breaks silently there.
 */
describe('createRefCountedPool', () => {
  interface Harness {
    pool: ReturnType<typeof createRefCountedPool<string, number>>;
    log: string[];
    fire: (key: string, value: number) => void;
    liveKeys: () => string[];
  }

  function makeHarness(): Harness {
    const log: string[] = [];
    const broadcasts = new Map<string, (value: number) => void>();
    const pool = createRefCountedPool<string, number>((key, broadcast) => {
      log.push(`create:${key}`);
      broadcasts.set(key, broadcast);
      return () => {
        log.push(`dispose:${key}`);
        broadcasts.delete(key);
      };
    });
    return {
      pool,
      log,
      // Fires nothing once the resource is gone, which is how these tests
      // observe that the last release really did tear it down.
      fire: (key, value) => broadcasts.get(key)?.(value),
      liveKeys: () => [...broadcasts.keys()],
    };
  }

  it('creates the resource once and shares it between every consumer of the same key', () => {
    const h = makeHarness();
    const seenA: number[] = [];
    const seenB: number[] = [];

    h.pool.acquire('folder', (v) => seenA.push(v));
    h.pool.acquire('folder', (v) => seenB.push(v));

    assert.deepStrictEqual(h.log, ['create:folder'], 'the second acquire must not build another one');
    h.fire('folder', 7);
    assert.deepStrictEqual(seenA, [7]);
    assert.deepStrictEqual(seenB, [7]);
  });

  it('keeps a separate resource per key, and events do not cross between them', () => {
    const h = makeHarness();
    const seen: string[] = [];

    h.pool.acquire('folderA', () => seen.push('A'));
    h.pool.acquire('folderB', () => seen.push('B'));

    assert.deepStrictEqual(h.log, ['create:folderA', 'create:folderB']);
    h.fire('folderA', 1);
    assert.deepStrictEqual(seen, ['A'], 'a file event under one folder must not reach the other');
  });

  it('disposes only after the last consumer releases, and stops delivering to the ones that already did', () => {
    const h = makeHarness();
    const seen: number[] = [];
    const first = h.pool.acquire('folder', (v) => seen.push(v));
    const second = h.pool.acquire('folder', (v) => seen.push(v * 10));

    first.dispose();
    assert.deepStrictEqual(h.log, ['create:folder'], 'the other consumer is still holding it');
    h.fire('folder', 2);
    assert.deepStrictEqual(seen, [20], 'and the released one no longer hears it');

    second.dispose();
    assert.deepStrictEqual(h.log, ['create:folder', 'dispose:folder']);
    assert.deepStrictEqual(h.liveKeys(), []);
    h.fire('folder', 3);
    assert.deepStrictEqual(seen, [20], 'nothing is left to hear it');
  });

  it('treats release as idempotent, since panel teardown fires from both onDidDispose and deactivation', () => {
    const h = makeHarness();
    const a = h.pool.acquire('folder', () => undefined);
    const b = h.pool.acquire('folder', () => undefined);

    a.dispose();
    a.dispose();
    assert.deepStrictEqual(h.log, ['create:folder'], 'a doubled release must not be counted twice');
    h.fire('folder', 1);

    b.dispose();
    assert.deepStrictEqual(h.log, ['create:folder', 'dispose:folder'], 'the survivor held it until here');
  });

  it('counts the same listener function twice when it is acquired twice, so one release cannot orphan the resource', () => {
    const h = makeHarness();
    let calls = 0;
    const listener = (): void => {
      calls += 1;
    };

    const a = h.pool.acquire('folder', listener);
    const b = h.pool.acquire('folder', listener);

    assert.deepStrictEqual(
      [...h.pool.counts()],
      [['folder', 2]],
      'two releases are owed even though a Set holds the function once',
    );
    h.fire('folder', 1);
    assert.strictEqual(calls, 1, 'but it is still only called once per broadcast');

    a.dispose();
    assert.deepStrictEqual(h.log, ['create:folder'], 'so the first release must not tear it down');
    b.dispose();
    assert.deepStrictEqual(h.log, ['create:folder', 'dispose:folder']);
  });

  it('reports live consumer counts per key, dropping keys that reach zero', () => {
    const h = makeHarness();
    assert.strictEqual(h.pool.counts().size, 0);

    const x1 = h.pool.acquire('x', () => undefined);
    h.pool.acquire('x', () => undefined);
    h.pool.acquire('y', () => undefined);
    assert.deepStrictEqual([...h.pool.counts()], [['x', 2], ['y', 1]]);

    x1.dispose();
    assert.deepStrictEqual([...h.pool.counts()], [['x', 1], ['y', 1]]);
  });

  it('keeps delivering to the other consumers when one of them throws', () => {
    const h = makeHarness();
    const warnings: string[] = [];
    const realWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    const seen: number[] = [];
    try {
      h.pool.acquire('folder', () => {
        throw new Error('panel blew up');
      });
      h.pool.acquire('folder', (v) => seen.push(v));
      h.fire('folder', 5);
    } finally {
      console.warn = realWarn;
    }

    assert.deepStrictEqual(seen, [5], 'a consumer failing is not a reason to deafen the rest');
    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes('panel blew up'), 'and the cause is logged rather than swallowed');
  });

  it('delivers to a snapshot, so a listener acquired mid-broadcast hears the next one rather than the value in flight', () => {
    const h = makeHarness();
    const seen: number[] = [];
    let added = false;

    h.pool.acquire('folder', (v) => {
      seen.push(v);
      if (!added) {
        added = true;
        h.pool.acquire('folder', (w) => seen.push(w * 100));
      }
    });

    h.fire('folder', 1);
    assert.deepStrictEqual(seen, [1], 'mutating the listener set mid-iteration would have skipped or double-called');

    h.fire('folder', 2);
    assert.deepStrictEqual(seen, [1, 2, 200], 'from the next broadcast on it is a normal consumer');
  });

  it('releases the key for good, so re-acquiring builds a fresh resource instead of holding it warm forever', () => {
    const h = makeHarness();
    const a = h.pool.acquire('folder', () => undefined);
    a.dispose();
    h.pool.acquire('folder', () => undefined);

    assert.deepStrictEqual(
      h.log,
      ['create:folder', 'dispose:folder', 'create:folder'],
      'a pool that kept disposed resources around would leak one watcher per folder ever opened',
    );
  });
});
