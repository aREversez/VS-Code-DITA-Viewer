// Reference-counted sharing of one expensive resource among many consumers.
//
// Extracted from a concrete problem: every open DITA preview panel created
// its own workspace-wide FileSystemWatcher over the same glob, so a map open
// next to three topic previews meant four watchers, each matching every file
// event in the folder and each holding its own emitter chain. The pool below
// owns only the lifecycle rule -- create on the first acquire for a key, hand
// every acquirer the same resource, dispose when the last one releases -- and
// deliberately knows nothing about watchers, or about vscode: keeping it free
// of that import is what makes the rule unit-testable under plain mocha.

type Listener<T> = (value: T) => void;

/** Structurally identical to vscode.Disposable, so callers can push the
 *  result straight into a subscriptions array. */
export interface Disposable {
  dispose(): void;
}

interface PoolEntry<T> {
  listeners: Set<Listener<T>>;
  /**
   * Counted separately from listeners.size on purpose: the same listener
   * function acquired twice lands in the Set once, but two releases are still
   * owed, and using the Set's size would dispose the resource after the first.
   */
  refs: number;
  dispose: () => void;
}

export interface RefCountedPool<K, T> {
  /**
   * Registers listener under key, creating the resource on first use. The
   * returned Disposable is idempotent, because panel teardown runs from both
   * an onDidDispose handler and extension deactivation, and a second release
   * must not drive the count negative and drop a resource other consumers are
   * still using.
   */
  acquire(key: K, listener: Listener<T>): Disposable;
  /** key -> live acquirer count, for diagnostics and tests. */
  counts(): Map<K, number>;
}

/**
 * @param create Builds the resource for a key. It is handed a broadcast
 *   function that delivers a value to every current listener, and must return
 *   the teardown for whatever it set up.
 */
export function createRefCountedPool<K, T>(
  create: (key: K, broadcast: (value: T) => void) => () => void,
): RefCountedPool<K, T> {
  const entries = new Map<K, PoolEntry<T>>();

  return {
    acquire(key, listener) {
      let entry = entries.get(key);
      if (!entry) {
        const listeners = new Set<Listener<T>>();
        const broadcast = (value: T): void => {
          // Snapshot before iterating: a listener is allowed to acquire or
          // release while handling a value, and mutating the Set mid-iteration
          // would skip listeners. A listener added during a broadcast starts
          // receiving from the next one, which is the safe direction -- the
          // alternative is delivering a value to a consumer that was not yet
          // registered when it was produced.
          for (const l of [...listeners]) {
            try {
              l(value);
            } catch (e) {
              // One consumer throwing must not deafen the others sharing this
              // resource; a panel's re-render failing is not a reason for the
              // map tree to stop hearing about the same file.
              console.warn('shared resource listener failed:', e instanceof Error ? e.message : e);
            }
          }
        };
        entry = { listeners, refs: 0, dispose: create(key, broadcast) };
        entries.set(key, entry);
      }
      entry.listeners.add(listener);
      entry.refs += 1;

      let released = false;
      return {
        dispose: () => {
          if (released) return;
          released = true;
          const current = entries.get(key);
          if (!current) return;
          current.listeners.delete(listener);
          current.refs -= 1;
          if (current.refs <= 0) {
            // Unregister before tearing down, so anything the resource's own
            // disposal triggers sees a pool that no longer offers this key
            // rather than a half-dead entry.
            entries.delete(key);
            current.dispose();
          }
        },
      };
    },

    counts() {
      const out = new Map<K, number>();
      for (const [key, entry] of entries) out.set(key, entry.refs);
      return out;
    },
  };
}
