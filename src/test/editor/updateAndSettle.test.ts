import * as assert from 'assert';
import { MementoLike, updateAndSettle } from '../../test-e2e/updateAndSettle';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * A memento that behaves the way VS Code's extension globalState was measured to
 * behave on the e2e runner: update() resolves with the new value already
 * readable, then ~40 ms later an earlier write's sync echo puts the old value
 * back, and ~260 ms after that the write lands and the new value returns. A page
 * rendered inside that window bakes in the OLD value, and the preview renders
 * once, so a poll for the new one can never succeed. Scaled down here.
 */
function revertingMemento(opts: { revertAfterMs: number; healAfterMs: number | undefined }): MementoLike & { calls: string[] } {
  const store = new Map<string, unknown>();
  const calls: string[] = [];
  return {
    calls,
    get<T>(key: string): T | undefined {
      return store.get(key) as T | undefined;
    },
    update(key: string, value: unknown): Thenable<void> {
      const old = store.get(key);
      calls.push(key);
      store.set(key, value);
      setTimeout(() => store.set(key, old), opts.revertAfterMs);
      if (opts.healAfterMs !== undefined) setTimeout(() => store.set(key, value), opts.healAfterMs);
      return Promise.resolve();
    },
  };
}

describe('updateAndSettle', () => {
  it('does not return while the written value is still going to be reverted', async () => {
    const m = revertingMemento({ revertAfterMs: 15, healAfterMs: 200 });
    await updateAndSettle(m, 'k', true, { stableMs: 60, intervalMs: 5, timeoutMs: 2000 });
    assert.strictEqual(m.get('k'), true, 'the value is there when the helper returns');
    await sleep(120); // past the revert; a helper that returned at once is caught here
    assert.strictEqual(m.get('k'), true, 'and it is still there afterwards, not reverted under the caller');
  });

  it('fails with the key named when the value never holds', async () => {
    const m = revertingMemento({ revertAfterMs: 10, healAfterMs: undefined });
    await assert.rejects(
      () => updateAndSettle(m, 'ditaViewer.tagTooltips', true, { stableMs: 60, intervalMs: 5, timeoutMs: 300 }),
      /ditaViewer\.tagTooltips/,
    );
  });

  it('settles on an object value by content, not identity', async () => {
    const m = revertingMemento({ revertAfterMs: 15, healAfterMs: 80 });
    await updateAndSettle(m, 'font', { size: 140, serif: true }, { stableMs: 40, intervalMs: 5, timeoutMs: 2000 });
    await sleep(60);
    assert.deepStrictEqual(m.get('font'), { size: 140, serif: true });
  });

  it('settles on undefined, which is how a test restores a key it found unset', async () => {
    const m = revertingMemento({ revertAfterMs: 10, healAfterMs: 50 });
    await m.update('k', 'before');
    await sleep(100);
    await updateAndSettle(m, 'k', undefined, { stableMs: 40, intervalMs: 5, timeoutMs: 2000 });
    await sleep(60);
    assert.strictEqual(m.get('k'), undefined);
  });
});
