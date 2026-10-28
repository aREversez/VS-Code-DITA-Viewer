/**
 * What the e2e suite needs from a `vscode.Memento`: this much, so the helper
 * below has no `vscode` import and its behaviour can be unit-tested.
 */
export interface MementoLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

export interface SettleOptions {
  /** How long the value has to read back as written, without a break. */
  stableMs?: number;
  /** Give up after this long; a value that never holds is a stuck test, not a slow one. */
  timeoutMs?: number;
  intervalMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Mementos hold JSON, so comparing the serialised form is the comparison
// that matters, and it covers the object values (font prefs, width map).
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * `await memento.update(k, v)` and then wait until `get(k)` keeps returning `v`.
 *
 * `update()` resolving does not mean the value is settled. Measured on the e2e
 * host: right after `update()` resolves `get()` returns the new value, then
 * ~40 ms later the echo of an EARLIER write (the previous test's `finally`
 * restoring another key, ~30 ms before) puts the old value back, and ~260 ms
 * after that the write lands and the new value returns. The previews read the
 * memento once, when they render, and never again, so a preview opened inside
 * that window carries the old value for good -- a poll for the new one waits
 * forever, whatever its timeout (this was the tag-tooltip test's "Timed out
 * waiting for the preview to render", on CI and locally about one run in two).
 * Waiting for the value to hold, rather than for update() to resolve, is what
 * makes "set a preference, then open a preview that reads it" a test and not a
 * race. Use it for the restore in a `finally` too: that write's echo is what
 * hits the next test.
 */
export async function updateAndSettle(memento: MementoLike, key: string, value: unknown, opts: SettleOptions = {}): Promise<void> {
  const { stableMs = 500, timeoutMs = 10000, intervalMs = 20 } = opts;
  await memento.update(key, value);
  const start = Date.now();
  let stableSince: number | undefined;
  for (;;) {
    const now = Date.now();
    if (same(memento.get(key), value)) {
      stableSince ??= now;
      if (now - stableSince >= stableMs) return;
    } else {
      stableSince = undefined;
    }
    if (now - start > timeoutMs) {
      throw new Error(
        `The memento never held ${key}=${JSON.stringify(value)} for ${stableMs}ms (last read: ${JSON.stringify(memento.get(key))}), ` +
          'so a preview opened now could not be trusted to render it.',
      );
    }
    await sleep(intervalMs);
  }
}
