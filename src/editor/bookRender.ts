// Book mode: renders every topic of a map into one page, with placeholders for what cannot be shown.
// Split out of ditaRenderUtils.ts, which re-exports every name here.

import { dirname, resolve } from 'path';
import type { MapEntry } from '@dita-viewer/core';
import { decodeHrefPart, renderTopicCached } from '@dita-viewer/core';
import type { BookPart } from './bookPatch';
import { escapeAttr, escapeHtml } from './htmlEscape';
import { computeManifestEntryPositions, resolveBookTopicPath } from './siteNavManifest';

/** Renders `<div data-book-anchor="...">` when anchorId is given, nothing
 *  extra otherwise -- shared by renderBookPlaceholder/renderBookError/
 *  renderBookParts' own inline topic wrapper so the three places book mode
 *  writes a `.book-entry` root all spell the attribute the same way. See
 *  renderBookParts' own comment for where anchorId comes from and why it is
 *  absent for some parts (a duplicate reference, an external/.ditamap href,
 *  a childless hrefless entry -- anything buildBookNavManifest itself drops
 *  and the sidebar therefore never links to). */
function bookAnchorAttr(anchorId: string | undefined): string {
  return anchorId ? ` data-book-anchor="${escapeAttr(anchorId)}"` : '';
}

export function renderBookPlaceholder(displayName: string, depth: number, anchorId?: string): string {
  const level = Math.min(1 + depth, 6);
  return `<div class="book-entry book-entry--placeholder"${bookAnchorAttr(anchorId)}>
  <h${level} class="book-section-heading">${escapeAttr(displayName)}</h${level}>
</div>`;
}

export function renderBookError(displayName: string, errorMsg: string, depth: number, anchorId?: string): string {
  const level = Math.min(1 + depth, 6);
  return `<div class="book-entry book-entry--error"${bookAnchorAttr(anchorId)}>
  <h${level} class="book-entry-title">${escapeHtml(displayName)}</h${level}>
  <p class="book-error">${escapeHtml(errorMsg)}</p>
</div>`;
}

export function renderBookSkipMessage(href: string): string {
  return `<p class="book-skip">(Skipped: ${escapeHtml(href)} already included above)</p>`;
}


// ── Book mode assembly ──

export interface BookRenderInput {
  /** Flattened topicref list, in map order -- see collectMapEntries. */
  entries: MapEntry[];
  /** Directory the map itself lives in; entry hrefs resolve against it. */
  docDir: string;
  /**
   * One instance for the whole pass. renderTopicCached compares it by
   * identity, so a fresh Map per entry would defeat reuse entirely -- which
   * is what the benchmark script used to do, and why the assembly loop now
   * lives here where both callers share it.
   */
  keyMap: Map<string, string>;
  /**
   * Converts an absolute local path into a URI the webview can load. This is
   * the only vscode-specific primitive in a book render; everything else
   * (resolving hrefs against each topic's own directory, de-duplicating,
   * heading depth, error and placeholder markup) lives here so it can be
   * tested -- and benchmarked -- without a VS Code instance.
   */
  fileToWebviewUri: (absPath: string) => string;
  uiLanguage?: string;
}

/**
 * Keeps the same bookMembers Set instance alive across render passes of the
 * same open map when its actual membership hasn't changed -- which is the
 * overwhelmingly common case (editing a topic's own content, the debounced
 * trigger for nearly every book-mode re-render, changes nothing about which
 * topics the book references). renderTopicCached's own cache keys the
 * bookMembers field by identity, same rationale as keyMap (see
 * TopicRenderCacheEntry.bookMembers) -- without this, renderBookParts
 * handing a freshly `new Set()`-built membership to every single pass would
 * silently defeat topic-render reuse across every re-render, not just ones
 * that actually changed the map's topicref list.
 *
 * Keyed by docDir (one open map, one docDir -- matches buildKeyMap's own
 * cache granularity in keyMap.ts) and fingerprinted by the resolved
 * absolute-path list itself (cheap: pure path resolution already computed
 * to build the set, no extra disk I/O), not by entries' own object
 * identity -- entries is rebuilt fresh from freshly re-parsed map XML on
 * every render pass regardless of whether anything in it actually changed.
 */
interface BookMembersCacheEntry {
  fingerprint: string;
  members: Set<string>;
}

const bookMembersCache = new Map<string, BookMembersCacheEntry>();

const BOOK_MEMBERS_CACHE_MAX = 50;

/** Part of clearAllCaches() in DitaViewerProvider.ts, same as clearKeyMapCache. */
export function clearBookMembersCache(): void {
  bookMembersCache.clear();
}

function getStableBookMembers(entries: MapEntry[], docDir: string): ReadonlySet<string> {
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.resourceOnly) continue; // never rendered as its own page -- not a book member for xref-target purposes either
    const absPath = resolveBookTopicPath(entry, docDir);
    if (absPath) paths.push(absPath);
  }
  // \u0000 can't appear in a filesystem path, so this join is collision-free
  // the same way TopicRenderCacheEntry's own cache key delimiter is.
  const fingerprint = paths.join('\u0000');
  const cached = bookMembersCache.get(docDir);
  if (cached && cached.fingerprint === fingerprint) return cached.members;

  if (bookMembersCache.size >= BOOK_MEMBERS_CACHE_MAX && !bookMembersCache.has(docDir)) {
    const oldest = bookMembersCache.keys().next().value;
    if (oldest !== undefined) bookMembersCache.delete(oldest);
  }
  const members = new Set(paths);
  bookMembersCache.set(docDir, { fingerprint, members });
  return members;
}

/**
 * Assembles every topic a map references into the ordered parts that Book
 * mode shows as one long document. Called by MapViewerProvider's
 * collectBookParts and by scripts/bench-book-render.js.
 *
 * It used to be a private method on the provider, with the benchmark keeping
 * its own hand-copied version of the loop. That copy had already drifted once
 * (it built a fresh keyMap per topic), and once rendering became cached the
 * drift stopped being cosmetic: the benchmark would have measured zero reuse
 * and reported that the cache did not work. One loop, two callers.
 *
 * Returns the parts rather than the joined document so MapViewerProvider can
 * diff two renders of the same map and send only the entries that changed
 * (see bookPatch.ts). wrapBookParts turns them back into exactly the document
 * this function used to return, byte for byte.
 */
export function renderBookParts(input: BookRenderInput): BookPart[] {
  const { entries, docDir, keyMap, fileToWebviewUri, uiLanguage } = input;

  // Track visited absolute paths to avoid duplicates
  const visited = new Set<string>();

  // The full set of topics this book contains, computed once up front --
  // deliberately NOT the same thing as `visited` above, which only grows
  // as the loop below reaches each entry. A topic near the start of the
  // book can legitimately xref one near the end (docsite design doc,
  // 3.2/4.5): by the time that early topic is rendered, `visited` would
  // not yet contain the later one, and an xref renderer keying off it
  // would wrongly treat an in-book target as outside the book. Same
  // one-entry-per-topic identity resolveBookTopicPath/buildBookNavManifest
  // already use, so this set agrees with the sidebar on exactly which
  // topics "this book" means. getStableBookMembers (not a plain `new
  // Set()` built inline here) keeps the same Set instance across passes
  // where membership hasn't actually changed -- see its own comment for
  // why that identity has to survive a re-render for renderTopicCached's
  // reuse to work at all.
  const bookMembers = getStableBookMembers(entries, docDir);

  // Parallel to `entries`: entries[i]'s stable sidebar-manifest id, or
  // undefined when buildBookNavManifest itself would drop this entry (a
  // duplicate reference, an external/.ditamap href, a childless hrefless
  // entry) -- see computeManifestEntryPositions' own comment. The
  // book-mode sidebar (nested-fold-and-highlight-plan.md item 1) scrolls
  // to `[data-book-anchor="id"]`, so every part whose entry buildBookNavManifest
  // keeps gets that same id stamped onto its own root element here, computed
  // once from the exact same shared helper the sidebar manifest itself is
  // built from -- not re-derived independently, so the two can never point
  // at different nodes for the same entry.
  const anchorIds = computeManifestEntryPositions(entries, docDir);

  const parts: BookPart[] = [];
  // A key per part, so two renders of the same map can be compared part by
  // part. Uniqueness is enforced here rather than assumed: a topic's resolved
  // path cannot repeat (the visited set above already de-duplicates those),
  // but two sub-maps, two skip notes or two structural headings can easily
  // collide, and a repeated key would make the diff read two different
  // entries as the same one. The suffix comes from the collision count, so it
  // is itself stable across re-renders of an unchanged map.
  const usedKeys = new Map<string, number>();
  const push = (keyBase: string, html: string): void => {
    const seen = usedKeys.get(keyBase) ?? 0;
    usedKeys.set(keyBase, seen + 1);
    parts.push({ key: seen === 0 ? keyBase : `${keyBase}~${seen + 1}`, html });
  };
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const anchorId = anchorIds[i]?.id;
    if (entry.resourceOnly) continue; // exists purely to be pulled in via keyref/conref elsewhere, never its own page or heading
    if (entry.href) {
      // Sub-map reference: its contents were already inlined as child
      // entries by expandDitamapRefs — render a section heading only
      // instead of parsing the map file as a topic.
      const refPath = entry.href.split('#')[0];
      if (refPath.toLowerCase().endsWith('.ditamap')) {
        push(
          `map:${resolve(docDir, decodeHrefPart(refPath))}`,
          // anchorId is always undefined here -- computeManifestEntryPositions
          // resolves this same entry's absPath via resolveBookTopicPath too,
          // which returns undefined for a .ditamap href (see its own test),
          // so buildBookNavManifest drops this entry and the sidebar never
          // links to it. Passed through anyway for symmetry with the other
          // two renderBook* call sites, rather than hand-omitting it here.
          renderBookPlaceholder(entry.displayName, entry.depth, anchorId),
        );
        continue;
      }
      const absPath = resolveBookTopicPath(entry, docDir);
      if (!absPath) {
        // External resource (https:, mailto:, absolute path) -- a link, not
        // a book member; getStableBookMembers already excluded it, so there
        // is nothing to render inline.
        continue;
      }
      if (visited.has(absPath)) {
        push(`skip:${entry.href}`, renderBookSkipMessage(entry.href));
        continue;
      }
      visited.add(absPath);

      // Per-topic asWebviewUri: image hrefs inside a topic are relative to
      // that topic's own directory, not to the map's.
      const topicDir = dirname(absPath);
      const asWebviewUri = (relPath: string): string => {
        try {
          return fileToWebviewUri(resolve(topicDir, decodeHrefPart(relPath)));
        } catch (e) {
          // The empty src still surfaces as a visibly broken image (the
          // webview script's document-level error listener marks it);
          // log the cause so path-resolution failures are debuggable.
          console.warn(`Failed to resolve webview URI for ${relPath}:`, e instanceof Error ? e.message : e);
          return '';
        }
      };

      const headingLevel = Math.min(1 + entry.depth, 6);
      // Cached, unlike the equivalent call in exportHtml.ts (which renders
      // once into a standalone file and has nothing to invalidate). Book
      // mode re-renders the whole map on every edit to any watched file,
      // and reuse keyed on the set of files each render actually read
      // turns that from "every topic again" into "the edited topic, plus
      // whatever conrefs it".
      const result = renderTopicCached({
        filePath: absPath,
        keyMap,
        asWebviewUri,
        headingLevel,
        uiLanguage,
        bookMembers,
        // Where the map put this topic: the same topic under two keyscopes shows
        // each scope's key text, and the cache keeps them apart.
        keyScope: entry.scopeChains,
      });

      if (result.error) {
        // Keyed like the topic it stands in for, so a topic that starts or
        // stops failing to parse patches that one entry in place instead of
        // forcing a whole-document replace. Still gets its anchorId (the
        // sidebar shows it under its fallback title regardless of whether
        // the topic file itself parses -- see buildBookNavManifest, which
        // doesn't condition on that either) so a broken topic is still
        // reachable by scrolling to it.
        push(`topic:${absPath}`, renderBookError(entry.displayName, result.error, entry.depth, anchorId));
      } else {
        // Book mode is just each referenced topic's own content, one
        // after another -- the same profiling/highlighting a topic
        // already renders when opened directly (via renderTopicCached
        // above) carries straight through here unchanged. No separate
        // topicref-level (ditamap-source) profiling layered on top of
        // it; that scope is exclusive to Outline mode's tree.
        push(`topic:${absPath}`, `<div class="book-entry"${bookAnchorAttr(anchorId)}>${result.html}</div>`);
      }
    } else {
      push(`struct:${entry.depth}:${entry.displayName}`, renderBookPlaceholder(entry.displayName, entry.depth, anchorId));
    }
  }

  return parts;
}

/**
 * Joins parts into the single container that both the stylesheet and the
 * webview script address as .ditamap-book. Kept apart from renderBookParts so
 * the incremental path can diff the parts and still produce exactly the same
 * document whenever it has to fall back to sending all of them.
 */
export function wrapBookParts(parts: BookPart[]): string {
  return `<div class="ditamap-book">${parts.map((part) => part.html).join('\n')}</div>`;
}

export function renderBookEntries(input: BookRenderInput): string {
  return wrapBookParts(renderBookParts(input));
}
