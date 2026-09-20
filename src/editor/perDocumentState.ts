/**
 * Per-document preferences kept in globalState: one key per kind of
 * preference, holding an object that maps a document's uri string to the
 * value for that document (WIDTH_SELECTION_KEY, CSS_SELECTION_KEY,
 * COLLAPSED_NAV_KEY, MAP_VIEW_STATE_KEY). Every one of them used to spell
 * out the same get / index-by-uri / mutate / update dance at each call site;
 * routing them through these two functions keeps them from drifting apart.
 *
 * Pure of the vscode module on purpose -- StateStore is the slice of
 * vscode.Memento that is used -- so it can be unit-tested.
 */
export interface StateStore {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): PromiseLike<void>;
}

type Bucket<T> = Record<string, T>;

/** The stored object, or an empty one if the key is missing or not an object (a hand-edited or corrupt store). */
function readBucket<T>(store: StateStore, key: string): Bucket<T> {
  const raw = store.get<unknown>(key, undefined);
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Bucket<T>) : {};
}

export function readForDocument<T>(store: StateStore, key: string, uri: { toString(): string }): T | undefined {
  const bucket = readBucket<T>(store, key);
  const id = uri.toString();
  return Object.prototype.hasOwnProperty.call(bucket, id) ? bucket[id] : undefined;
}

/**
 * Replaces this document's entry, leaving every other document's alone.
 * Writes a new object rather than mutating the one it read: the store is
 * free to hand back its own copy, and a mutated one that is then passed back
 * to update() is exactly the case where "did that change?" gets murky.
 */
export function writeForDocument<T>(store: StateStore, key: string, uri: { toString(): string }, value: T): void {
  const next: Bucket<T> = { ...readBucket<T>(store, key), [uri.toString()]: value };
  void store.update(key, next);
}
