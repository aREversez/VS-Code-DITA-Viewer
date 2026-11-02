// The Site / Book navigation manifest: entry positions, titles, anchors and the topic a page shows.
// Split out of ditaRenderUtils.ts, which re-exports every name here.

import { resolve } from 'path';
import type { MapEntry } from '@dita-viewer/core';
import { decodeHrefPart, URL_SCHEME_RE } from '@dita-viewer/core';

/**
 * Resolves one map entry's href to the absolute path renderBookParts (and
 * the docsite-mode nav manifest below, which must agree with it exactly --
 * a sidebar listing a topic this book doesn't actually render, or vice
 * versa, is worse than either one being wrong consistently) would treat as
 * "this topic". Returns undefined for anything that isn't a renderable
 * .dita topic: no href, a fragment-only self-reference, or a .ditamap --
 * by the time entries reach here they should already be flattened by
 * expandDitamapRefs, so a .ditamap entry surviving to this point means the
 * caller skipped that step, not that this is a legitimate case to render.
 */
export function resolveBookTopicPath(entry: MapEntry, docDir: string): string | undefined {
  if (!entry.href) return undefined;
  const refPath = entry.href.split('#')[0];
  if (!refPath || refPath.toLowerCase().endsWith('.ditamap')) return undefined;
  // External resources (keydefs/topicrefs pointing at https:, mailto:, ...)
  // are links, not book members. Without this guard resolve() would splice
  // the URL onto docDir -- on Windows a topicref/keydef href of
  // "https://support.example.com" used to surface as the nonsense path
  // <docDir>\https:\support.example.com and blow up docsite/book mode with
  // "File not found". Same guard isInCurrentBook and the title/type
  // resolvers apply before touching the filesystem. (Drive-rooted hrefs
  // like "/topics/x.dita" stay resolvable on purpose -- resolve() already
  // handles them against docDir's own drive.)
  if (URL_SCHEME_RE.test(refPath)) return undefined;
  return resolve(docDir, decodeHrefPart(refPath));
}

export interface DocsiteNavEntry {
  /** Stable identifier for this entry, used to key persisted UI state
   *  (sidebar collapsed/expanded) across re-renders of the same map --
   *  see buildBookNavManifest's own comment for how it's computed.
   *  Optional (rather than required) so every existing call site that
   *  constructs a DocsiteNavEntry by hand for a test of renderSiteNavHtml/
   *  buildSiteNavTree/buildBookSearchIndex, none of which read this
   *  field, doesn't have to grow one just to satisfy the type checker;
   *  buildBookNavManifest itself always populates it. */
  id?: string;
  /** Resolved absolute path -- the same identity renderBookParts's own
   *  `visited` set and de-duplication use, and what the "is this xref
   *  target part of the current book" check (docsite design doc, 3.2/4.5;
   *  see the book members set in MapViewerProvider) keys off of. Undefined
   *  exactly when isGroup is true (see below) --
   *  a group entry has no topic file of its own to resolve one from. */
  absPath?: string;
  /** The entry's own raw DITA href (as written in the map, unresolved and
   *  possibly carrying a fragment), carried so the webview's sidebar
   *  context menu can offer "Copy Href" without ever putting an untrusted
   *  reference into the rendered DOM -- the host reads this back from the
   *  cached manifest by absPath. Undefined for a group entry (no href by
   *  definition) and never rendered into markup. */
  href?: string;
  title: string;
  /** Nesting level, 0 at the map's own top level -- for sidebar indentation. */
  depth: number;
  /** BookMap structural role ("Chapter 1", "Appendix A", ...), when the
   *  entry has one -- see collectMapEntries/createBookRoleLabeler. */
  role?: string;
  /** Displayable type label for the referenced topic's own root element
   *  ("Concept", "Task", "Reference", ...), when a resolveTopicType was
   *  passed to buildBookNavManifest and the topic file's root tag is one
   *  the labeler recognized. The generic `<topic>` root gets a chip too
   *  ("Topic"), so every entry with a topic file is labeled the same way
   *  and a plain topic isn't the odd row out among specializations. */
  topicType?: string;
  /** True for an entry with no topic of its own to navigate to -- a
   *  <topichead> (pure heading, no href by definition) or an href-less
   *  topicref used purely as a grouping container -- kept in the
   *  manifest anyway (rather than dropped, which is what happened before
   *  this field existed) purely so its real, navigable descendants have
   *  a labeled branch to nest under in the sidebar tree. See
   *  buildBookNavManifest's own comment for why an href-less entry with
   *  no descendants (a bare key-only topicref/keydef used only for
   *  keyref text substitution) is dropped rather than becoming an empty
   *  isGroup entry. Matches how tree mode already renders a topichead as
   *  a non-clickable heading with the same nested-children shape
   *  (map/topichead in mapTypeMap.ts) and how book mode already renders
   *  one as a plain section heading (renderBookParts's own `struct:`
   *  placeholder branch). renderSiteNavHtml skips the link markup
   *  entirely for a group entry -- title text only, no data-site-target,
   *  no click-to-navigate -- and every consumer that otherwise assumes
   *  every manifest entry has a real topic file behind it (search
   *  indexing, the initial/fallback page, book-membership checks) must
   *  filter these out first; see MapViewerProvider.ts's own
   *  siteNavigableEntries. */
  isGroup?: boolean;
  /** The key scope chains the entry sits in (see MapEntry.scopeChains): the scopes the
   *  topic it publishes is rendered in, so a keyref on the page resolves as DITA says.
   *  Set on every entry buildBookNavManifest builds; optional only so hand-built
   *  entries in tests need not carry one. */
  scopeChains?: string[][];
}

/**
 * Builds the docsite-mode sidebar/prev-next data source from the same
 * flattened entries list renderBookParts renders from -- pass it the exact
 * same `entries` (and `docDir`) used for the content render, not a
 * separately-collected one, so the nav can never list a topic the book
 * doesn't actually contain or omit one it does. Order matches document
 * order (collectMapEntries' own order), which is what a reading-order
 * prev/next needs.
 *
 * resolveTopicTitle, when given, is called for every entry that has an
 * href -- regardless of MapEntry.displayNameExplicit -- and its result, if
 * any, wins over entry.displayName. This deliberately overrides an
 * explicit map-authored navtitle/linktext/keyword too: the sidebar is
 * showing the reader a list of topics, and a book's own rendered content
 * (tree mode's tooltip aside) always shows a topic's real <title>
 * regardless of what the map called it, so the sidebar should match that
 * rather than surface the map's own label for it, which can drift from the
 * topic's actual title over time. entry.displayName is still the fallback
 * when resolveTopicTitle finds nothing (topic has no <title>, or the file
 * failed to read) -- an explicit navtitle beats no title at all. Passed
 * entry.href (the original relative href, not the resolved absPath) so a
 * caller can hand this makeFileTitleResolver(docDir) directly.
 *
 * resolveTopicType, when given, is called for every entry with a real
 * href (regardless of role -- a chapter can still be a <task>, and
 * showing both chips lets the sidebar answer "structural role" and
 * "information type" independently) and produces the sidebar's per-entry
 * type chip. Pass makeFileTopicTypeResolver(docDir); unlike
 * resolveTopicTitle this isn't conditioned on the map having left the
 * entry unnamed, since a topic's type isn't something the map ever states
 * on its own -- but the resolver itself stays cheap by design (a bounded
 * sniff of the root tag, not a full parse; see sniffRootTagName's own
 * comment), specifically so this being unconditional doesn't reintroduce
 * an O(topics-in-book) cost on every docsite render.
 *
 * entry.resourceOnly is checked before anything else, group entries
 * included -- a resource-only <topichead> (unusual, but not invalid) is
 * skipped outright rather than surfaced as an empty group, same as a
 * resource-only real topic is skipped rather than surfaced as a page.
 *
 * The returned entries' depth values are COMPACTED, not copied straight
 * from MapEntry.depth: skipping an entry (resource-only, a duplicate
 * topic, a dropped childless hrefless entry) also promotes everything
 * that survives underneath it by however many ancestors were skipped, so
 * the output tree never has a surviving entry stranded one level deeper
 * than a parent that no longer exists in it.
 */
/**
 * The per-entry position (stable id + compacted depth) buildBookNavManifest
 * itself gives each surviving entry -- or undefined for one it drops
 * entirely (resource-only, a duplicate topic path already seen earlier in
 * this same pass, or a childless hrefless entry). Parallel to `entries`:
 * same length, same order, index-for-index.
 *
 * Factored out of buildBookNavManifest so a second consumer needing the
 * exact same per-entry id -- renderBookParts, for book mode's own scroll-to
 * anchors (nested-fold-and-highlight-plan.md item 1) -- reads it off
 * directly instead of re-deriving this stack a second time. Two independent
 * copies of "which sibling number is this" is exactly the kind of drift a
 * prior fix (mapref depth transparency, 2ae5729) already had to clean up
 * once for the depth side of this same stack; the id side deserves the same
 * caution. Fresh state every call -- calling this twice on the same
 * entries/docDir (as buildBookNavManifest and renderBookParts each do) is
 * safe and gives identical results, since nothing is cached or shared
 * across calls.
 *
 * Depth compaction: entries carry their ORIGINAL depth from the full,
 * unfiltered map structure (collectMapEntries) -- but a skipped entry
 * (resource-only, a duplicate reference, or a childless hrefless entry
 * dropped outright below) must not leave a "hole" that pushes its own
 * surviving descendants one level deeper in the sidebar tree than they
 * should sit. survivingAncestors holds the ORIGINAL depth of every
 * still-open ancestor that DID survive, in nesting order; its length at
 * any point is exactly the entry now being considered's own compacted
 * depth (no surviving ancestor open above it -> depth 0; one -> depth 1;
 * and so on). A skipped entry is simply never pushed onto it, so whatever
 * survives right after it re-parents to the next real ancestor still on
 * the stack -- e.g. a topichead marked resource-only that would otherwise
 * have grouped three real topics underneath it: those three now surface
 * as depth-0 siblings instead of stranded, unreachable depth-1 orphans
 * with no depth-0 parent left in the output tree for buildSiteNavTree
 * (renderSiteNavHtml) to nest them under.
 *
 * id computation runs alongside the depth-compaction stack, on exactly the
 * same "did this entry actually survive" logic -- a skipped entry consumes
 * no sibling slot, for the same reason it leaves no depth hole: a later
 * sibling's id must not depend on how many entries ahead of it happened to
 * get filtered out, or persisted collapsed state would silently point at
 * the wrong node the next time the map gains or loses an unrelated
 * resource-only entry.
 *
 * ancestorIndices holds, for every still-open surviving ancestor (kept in
 * lockstep with survivingAncestors -- same push/pop sites), the sibling
 * index THAT ancestor was itself given when it was emitted; a group's own
 * id is 'grp:' + those ancestor indices plus its own, dot-joined (e.g.
 * 'grp:0.2' for the third child of the first top-level group) --
 * positional, not title-based, since two <topichead> group headers
 * commonly share the exact same navtitle text, and the same title can also
 * be re-localized out from under a stored id when the UI language changes.
 *
 * childCounts[d] is the next sibling index to hand out at compacted depth
 * d under the currently-open parent chain; truncated to exactly depth+1
 * entries every iteration (dropping any deeper level's leftover counter
 * from a now-closed branch, extending with a fresh 0 the first time this
 * depth is reached under the current parent) so numbering restarts
 * correctly every time a shallower sibling closes off a branch, the same
 * "no ancestor -> depth 0" invariant survivingAncestors itself already
 * relies on.
 */
export function computeManifestEntryPositions(
  entries: MapEntry[],
  docDir: string,
): ({ id: string; depth: number } | undefined)[] {
  const seen = new Set<string>();
  const positions: ({ id: string; depth: number } | undefined)[] = [];
  const survivingAncestors: number[] = [];
  const ancestorIndices: number[] = [];
  const childCounts: number[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    while (survivingAncestors.length > 0 && survivingAncestors[survivingAncestors.length - 1] >= entry.depth) {
      survivingAncestors.pop();
      ancestorIndices.pop();
    }
    const depth = survivingAncestors.length;
    if (childCounts.length > depth + 1) childCounts.length = depth + 1;
    if (childCounts.length <= depth) childCounts.push(0);

    if (entry.resourceOnly) { positions.push(undefined); continue; } // exists purely to be pulled in via keyref/conref elsewhere, never its own page
    if (!entry.href) {
      // No topic file of its own -- either a <topichead> (which by
      // definition never has one) or a bare key-only topicref/keydef
      // (used purely for keyref text substitution, e.g.
      // <topicref keys="product_version"><topicmeta><linktext>1.0
      // </linktext></topicmeta></topicref>, with no navigable content of
      // its own either). Those two cases look identical on a MapEntry (no
      // baseType/tagName carried through), so they're told apart the only
      // way that's actually meaningful for the sidebar: does this entry
      // have anything nested under it. A topichead grouping real
      // topicrefs has entries[i+1..] at a deeper ORIGINAL depth right
      // after it (compaction doesn't change whether one entry nests
      // under another in the source map, only what depth number a
      // surviving entry is labeled with) and becomes a group header; a
      // leaf key-only topicref has nothing deeper following it and is
      // dropped, exactly as it always was before group headers existed
      // -- showing an unclickable, childless "V1.0.0" row in the reading
      // sidebar for what is really just a keyref variable would be pure
      // noise, not navigation.
      const hasChildren = i + 1 < entries.length && entries[i + 1].depth > entry.depth;
      if (hasChildren) {
        const siblingIndex = childCounts[depth]++;
        const id = 'grp:' + [...ancestorIndices, siblingIndex].join('.');
        positions.push({ id, depth });
        survivingAncestors.push(entry.depth);
        ancestorIndices.push(siblingIndex);
      } else {
        positions.push(undefined);
      }
      continue;
    }
    const absPath = resolveBookTopicPath(entry, docDir);
    if (!absPath || seen.has(absPath)) { positions.push(undefined); continue; } // same one-entry-per-topic rule renderBookParts's own `visited` set enforces
    seen.add(absPath);
    // A navigable entry's absPath is already unique (the `seen` dedup
    // above guarantees it) and stays meaningful across a document's own
    // edits in a way a positional path wouldn't, so it doubles as the
    // entry's id directly rather than getting its own 'grp:'-style
    // synthetic one. It still consumes a sibling slot in childCounts
    // (via siblingIndex below) purely so a LATER, deeper group nested
    // under this entry gets a correctly-numbered ancestor prefix -- a
    // real topic can itself have further topicrefs nested under it in
    // the map, same as a topichead can.
    const siblingIndex = childCounts[depth]++;
    positions.push({ id: absPath, depth });
    survivingAncestors.push(entry.depth);
    ancestorIndices.push(siblingIndex);
  }
  return positions;
}

export function buildBookNavManifest(
  entries: MapEntry[],
  docDir: string,
  resolveTopicTitle?: (href: string) => string | undefined,
  resolveTopicType?: (href: string) => string | undefined,
): DocsiteNavEntry[] {
  const positions = computeManifestEntryPositions(entries, docDir);
  const result: DocsiteNavEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const pos = positions[i];
    if (!pos) continue;
    if (!entry.href) {
      result.push({ id: pos.id, title: entry.displayName, depth: pos.depth, role: entry.role, isGroup: true, ...(entry.scopeChains ? { scopeChains: entry.scopeChains } : {}) });
      continue;
    }
    let title = entry.displayName;
    if (resolveTopicTitle) {
      const realTitle = resolveTopicTitle(entry.href);
      if (realTitle) title = realTitle;
    }
    const topicType = resolveTopicType ? resolveTopicType(entry.href) : undefined;
    // pos.id is this navigable entry's absPath (see computeManifestEntryPositions),
    // so it doubles as `absPath` directly rather than resolving it again here.
    result.push({ id: pos.id, absPath: pos.id, href: entry.href, title, depth: pos.depth, role: entry.role, topicType, ...(entry.scopeChains ? { scopeChains: entry.scopeChains } : {}) });
  }
  return result;
}

/**
 * The key scopes a site page is rendered in: those of the first entry that publishes it,
 * which is the one Book mode renders when a topic appears twice (renderBookParts keeps the
 * first). Undefined when the manifest has no such entry, and the render then falls back
 * to the first topicref that publishes the file.
 */
export function sitePageKeyScope(manifest: readonly DocsiteNavEntry[], absPath: string): string[][] | undefined {
  return manifest.find((e) => !e.isGroup && e.absPath === absPath)?.scopeChains;
}

/**
 * The subset of a docsite manifest that actually has a topic file behind
 * it -- every entry except a group header (DocsiteNavEntry.isGroup; see
 * its own comment). buildBookNavManifest's result is the sidebar's own
 * data source and needs the group headers to build its nested tree, but
 * anything treating the manifest as "the list of pages/files in this
 * book" (full-text search indexing, the book-membership set xref
 * resolution checks against, picking a fallback/first page to land on)
 * would misbehave on an absPath-less entry -- this is the one place that
 * filter lives, rather than every one of those call sites repeating
 * `.filter((m) => m.absPath !== undefined)` (and the type narrowing that
 * goes with it) on its own.
 */
export function siteNavigableEntries(manifest: DocsiteNavEntry[]): (DocsiteNavEntry & { absPath: string })[] {
  return manifest.filter((entry): entry is DocsiteNavEntry & { absPath: string } => entry.absPath !== undefined);
}
