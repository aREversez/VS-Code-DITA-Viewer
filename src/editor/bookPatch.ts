// The decision behind book mode's incremental content update, extracted from
// MapViewerProvider.ts.
//
// Book mode composites every topic a map references into one document. A
// source edit used to re-send that whole document and the webview replaced
// #dita-content-root's innerHTML with it, destroying and rebuilding every
// entry element. The rebuild is what makes this worth more than the saved
// bytes: it also discards whatever the browser had worked out per element --
// its scroll anchoring, its decoded images, and the remembered size that
// content-visibility keeps for elements it has already laid out. Patching
// only the entries whose HTML actually changed leaves every other entry's
// element, and everything the browser derived from it, alone.
//
// Its own module for the reason pendingRender.ts, mapTreeRefresh.ts and
// referenceableFiles.ts are: MapViewerProvider.ts imports vscode, so nothing
// written inside it is reachable from the plain-mocha unit tests, and this
// decision -- when a patch really is equivalent to the full replace it stands
// in for -- is the part that has to be right. Getting it wrong is silent and
// visual: entries written into the wrong positions, or a document left stale
// because a change was classified as no change.

/** One rendered piece of a book: a topic, a structural heading, an error or a skip note. */
export interface BookPart {
  /**
   * Identity that survives re-rendering the same map, derived from what the
   * part is about -- the topic's resolved path, the sub-map's path, the
   * structural entry's name -- and never from its rendered HTML. A key that
   * moved when content changed would make every keystroke look structural,
   * and the patch path would never fire.
   */
  key: string;
  /**
   * The part's complete markup: exactly one root element, and exactly the
   * string that gets joined into .ditamap-book. The webview applies a patch
   * by assigning this to an existing entry's outerHTML, so one root element
   * is what keeps the entry count -- and therefore every other index in the
   * patch -- valid.
   */
  html: string;
}

/** One entry to replace, addressed by its position among .ditamap-book's children. */
export interface BookPartUpdate {
  index: number;
  html: string;
}

/**
 * What a book re-render owes the webview.
 *
 * Three states rather than two because 'none' is not an empty 'patch'.
 * Sending an empty patch would still cost a message and, in the webview,
 * still re-run the profiling filter and any open search -- pure overhead
 * when nothing changed. And 'none' is reachable in practice, not just in
 * theory: a save fires both the document watcher and the workspace-folder
 * watcher, so one edit can easily produce a second render whose output is
 * identical to the first.
 */
export type BookPatch =
  | { kind: 'none' }
  | { kind: 'patch'; updates: BookPartUpdate[] }
  | { kind: 'full' };

/**
 * Compares the parts of the previous book render against a fresh one and
 * decides what the webview needs.
 *
 * `prev` is undefined when this provider instance has no record of what the
 * webview is showing -- a freshly resolved panel, a restarted extension host
 * -- and then a full document is the only safe answer.
 */
export function diffBookParts(prev: BookPart[] | undefined, next: BookPart[]): BookPatch {
  if (prev === undefined) return { kind: 'full' };

  // Anything that changes the entry sequence -- a topicref added, removed,
  // reordered, or an href edited -- goes down the full path. A positional
  // patch could still be made to produce the right final DOM here, but it
  // would rewrite every entry after the change point, which is the cost this
  // exists to avoid, and structural edits are rare next to typing inside a
  // topic. Comparing keys before comparing HTML is also what makes the patch
  // path sound at all: index i in the message denotes the same entry on both
  // sides only for as long as the two key sequences are identical.
  if (prev.length !== next.length) return { kind: 'full' };
  for (let i = 0; i < next.length; i++) {
    if (prev[i].key !== next[i].key) return { kind: 'full' };
  }

  const updates: BookPartUpdate[] = [];
  for (let i = 0; i < next.length; i++) {
    if (prev[i].html !== next[i].html) updates.push({ index: i, html: next[i].html });
  }
  return updates.length === 0 ? { kind: 'none' } : { kind: 'patch', updates };
}
