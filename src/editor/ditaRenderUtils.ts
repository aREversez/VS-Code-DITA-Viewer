import { readFileSync, openSync, readSync, closeSync } from 'fs';
import { resolve, dirname, isAbsolute } from 'path';
import type { MapEntry } from '../render/mapTypeMap';
import type { BookPart } from './bookPatch';
import { noteSourceDependencies } from './sourceText';
import { renderTopicCached } from './topicRender';
import { decodeHrefPart, URL_SCHEME_RE } from './refResolvers';
// Search match engine lives in the searchText leaf. Re-exported here so
// bookSearchIndex and the preview tests keep resolving it from this module; the
// webview overlay that injects it via .toString() now lives under ./webview/.
export { findTextMatches } from './searchText';
// Re-exported so existing importers keep resolving these from this module;
// they are now defined in refResolvers.ts.
export {
  readImageDimensions,
  IMAGE_DIMENSIONS_CACHE_MAX,
  clearImageDimensionsCache,
  makeFileCache,
  makeConrefResolver,
  makeConrefRangeResolver,
  makeFileTitleResolver,
  detectNoteLabels,
  detectIndexLabel,
  DEFAULT_NOTE_LABELS,
  ZH_NOTE_LABELS,
  makeIsInCurrentBook,
  decodeHrefPart,
  expandDitamapRefs,
} from './refResolvers';
export type { FileReader } from './refResolvers';
// Webview script builders now live under ./webview/. Re-exported from here so
// existing importers keep resolving them via this module (P5 forwarding barrel);
// this file itself no longer references any of the moved scripts.
export { getImageMapSupportScript } from './webview/imageMapScript';
export { getProfilingFilterScript } from './webview/profilingFilterScript';
export { getImageLightboxScript } from './webview/lightboxScript';
export { getSearchOverlayScript } from './webview/searchOverlayScript';
export { clampSidebarWidth, getSiteSidebarResizerScript } from './webview/siteSidebarResizerScript';
export {
  getSiteNavKeyboardScript,
  getSidebarUpdateScript,
  getSiteHistoryModelScript,
  getSiteNavClickHandlerScript,
  getBookNavClickHandlerScript,
  getBookScrollSyncScript,
  getOutlineSyncScript,
  getInitialSidebarBodyClass,
  getSiteNavCollapseStateHelperScript,
  getSiteNavExpandCollapseAllButtonsScript,
  getSiteNavToggleScript,
} from './webview/siteNavScripts';
export {
  getSiteHomeButtonScript,
  getSiteHistoryButtonsScript,
  getSitePrevNextButtonsScript,
  getSiteSidebarToggleScript,
  getModeToggleScript,
  getSiteOpenSourceScript,
  getToolbarPlacementScript,
  getTemplateSelectScript,
  HISTORY_BACK_ICON_SVG,
  HISTORY_FORWARD_ICON_SVG,
  PREV_TOPIC_ICON_SVG,
  NEXT_TOPIC_ICON_SVG,
  SITE_HOME_ICON_SVG,
  SITE_HOME_TARGET,
} from './webview/toolbarScripts';
export {
  getRefreshButtonScript,
  getToolbarScaffoldScript,
  getFontPrefsScript,
  getToolbarFontWidthTagTooltipsButtonsScript,
} from './webview/toolbarScaffold';
// Topic rendering pipeline (interfaces, parse-and-render, LRU cache) lives
// in ./topicRender. Re-exported here so providers and tests keep resolving
// everything from this module.
export {
  collectText,
  buildTitleMap,
  TopicRenderInput,
  TopicRenderResult,
  TopicXmlRenderInput,
  ParsedTopicResult,
  openHrefTarget,
  renderTopicXml,
  renderTopicToHtml,
  stampFiles,
  collectDitamapFilesUpward,
  TOPIC_RENDER_CACHE_MAX_BYTES,
  clearTopicRenderCache,
  topicRenderCacheSize,
  topicRenderCacheBytesHeld,
  setTopicRenderCacheBudgetForTesting,
  renderTopicCached,
} from './topicRender';

/**
 * Default topic-type labeler used when no localized labeler is injected.
 * Returns a simple capitalized tag name for every root, the generic
 * `<topic>` included (`concept` -> "Concept", `task` -> "Task", `topic` ->
 * "Topic", ...): in a map that mixes specializations with plain topics, the
 * plain ones being the only rows with no chip read as "type unknown" rather
 * than "generic topic". Callers that want localized labels
 * (MapViewerProvider in VS Code) inject their own labeler; pure-function
 * tests use this default to stay vscode-free.
 */
function defaultTopicTypeLabel(tagName: string): string | undefined {
  if (!tagName) return undefined;
  return tagName.charAt(0).toUpperCase() + tagName.slice(1);
}

// Read at most this many bytes before falling back to the whole file --
// generous enough to clear an XML declaration, a handful of comments, and
// a DOCTYPE with a modest internal entity subset (the overwhelming
// majority of real DITA files), while still being a small, bounded read
// rather than the whole file.
const ROOT_TAG_SNIFF_BYTES = 8192;

// Matches one leading "preamble" construct at the start of a string: an
// XML declaration, a comment, a DOCTYPE (with or without a `[...]`
// internal subset), another processing instruction, or plain whitespace.
// sniffRootTagName below strips these one at a time until only the root
// element itself is left at the front of the string.
const PREAMBLE_CONSTRUCT_RE =
  /^(?:<\?xml[^>]*\?>|<!--[\s\S]*?-->|<!DOCTYPE[^[>]*(?:\[[\s\S]*?\])?\s*>|<\?[^>]*\?>|\s+)/;

/**
 * Extracts the root element's tag name from a string already known to
 * start (after any preamble) with that element -- the actual scan logic
 * sniffRootTagName below is built around; split out so it can be re-run
 * against progressively more of the file (the bounded chunk, then, only if
 * that wasn't enough, the whole file) without duplicating the preamble-
 * stripping loop.
 */
function extractRootTagName(content: string): string | undefined {
  let rest = content;
  // Realistically at most a handful of these constructs precede the root
  // element in any real document; the iteration cap is defensive against
  // a pathological input looping here, not a real limit on well-formed XML.
  for (let i = 0; i < 20; i++) {
    const m = PREAMBLE_CONSTRUCT_RE.exec(rest);
    if (!m || m[0].length === 0) break;
    rest = rest.slice(m[0].length);
  }
  const tagMatch = /^<([A-Za-z_][\w.-]*)/.exec(rest);
  return tagMatch ? tagMatch[1] : undefined;
}

/**
 * Reads just enough of a file to name its root element, without parsing it
 * -- makeFileTopicTypeResolver's whole reason to exist rather than reusing
 * makeFileTitleResolver's cache.loadFile(), which runs the file through
 * the full DITA parser (parseDita) to build a complete DOM. For a sidebar
 * chip that only needs one tag name, and that -- unlike the title fallback,
 * which only fires for entries the map itself left unnamed -- is
 * unconditional on every entry with an href, paying for a full parse of
 * every referenced topic on every docsite render would reintroduce exactly
 * the O(topics-in-book) cost docsite mode exists to avoid.
 *
 * Reads a bounded leading chunk first (ROOT_TAG_SNIFF_BYTES) and only
 * falls back to the whole file if the root tag wasn't found in it and
 * there was more file left to read -- a huge DOCTYPE internal subset is
 * rare, but should still resolve correctly rather than silently return
 * nothing.
 *
 * Reads the DISK, not the unsaved editor text (sourceText.ts), on purpose:
 * this only picks the sidebar's topic-type chip, and changing a topic's root
 * element while it is unsaved is rare enough that the chip catching up on
 * save is not worth a second overlay-aware read path over a partial file
 * read.
 */
function sniffRootTagName(absPath: string): string | undefined {
  // Reads the head of the file outside readSourceText, so report it by hand:
  // a panel drops change events for files its last render did not read, and
  // this file's root tag is something the render shows.
  noteSourceDependencies([absPath]);
  let fd: number | undefined;
  try {
    fd = openSync(absPath, 'r');
    const buf = Buffer.alloc(ROOT_TAG_SNIFF_BYTES);
    const bytesRead = readSync(fd, buf, 0, ROOT_TAG_SNIFF_BYTES, 0);
    const chunk = buf.toString('utf-8', 0, bytesRead);
    const tag = extractRootTagName(chunk);
    if (tag !== undefined || bytesRead < ROOT_TAG_SNIFF_BYTES) return tag;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* already closed or never opened successfully */ }
    }
  }
  // The bounded chunk didn't contain the root tag and the file is bigger
  // than that chunk -- fall back to reading (not parsing) the whole thing.
  try {
    return extractRootTagName(readFileSync(absPath, 'utf-8'));
  } catch {
    return undefined;
  }
}

/**
 * Resolves a topic href to its root element's displayable type label
 * ("Concept", "Task", "Reference", ...) for the docsite-mode sidebar's
 * per-entry chip. Mirrors makeFileTitleResolver's guard rules exactly
 * (local relative .dita/.xml hrefs only, fragment stripped since the
 * sidebar links to files and a fragment points inside one) but resolves
 * the root tag via sniffRootTagName instead of a full parse -- see that
 * function's own comment for why that distinction matters here
 * specifically. Has its own small per-resolver cache (path -> tag name)
 * rather than sharing makeFileTitleResolver's file-cache: there is no DOM
 * to share, and a de-duplicated entries list (buildBookNavManifest's own
 * contract) means this cache mostly guards against a resolver being
 * handed to buildBookNavManifest more than once, not a hot path.
 */
export function makeFileTopicTypeResolver(
  docDir: string,
  labeler: (tagName: string) => string | undefined = defaultTopicTypeLabel,
): (href: string) => string | undefined {
  const cache = new Map<string, string | undefined>();

  return (href: string): string | undefined => {
    if (!href || URL_SCHEME_RE.test(href) || isAbsolute(href)) return undefined;
    const hashIdx = href.indexOf('#');
    // Same file-level-only resolution makeFileTitleResolver uses for its
    // no-fragment branch: a bare id is not a filename and must not be
    // probed as one, and a fragment points inside the current topic file
    // (whose type this resolver already reports for the file itself).
    const filePath = hashIdx < 0 ? href : href.substring(0, hashIdx);
    if (!filePath || !/\.(dita|xml)$/i.test(filePath)) return undefined;
    const absPath = resolve(docDir, decodeHrefPart(filePath));
    if (cache.has(absPath)) {
      const tagName = cache.get(absPath);
      return tagName === undefined ? undefined : labeler(tagName);
    }
    const tagName = sniffRootTagName(absPath);
    cache.set(absPath, tagName);
    return tagName === undefined ? undefined : labeler(tagName);
  };
}

// ── Escaping (single source of truth for non-renderer code) ──

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Book rendering helpers (pure, no vscode dependency) ──
//
// Book mode is deliberately just "every referenced topic's own content,
// one after another" -- it composites topics for reading, the same way
// opening one of those topics directly would render it, profiling
// included (each topic's own inline profiling markup already renders
// correctly via renderTopicToHtml, unaffected by anything here). It does
// NOT layer in topicref-level (ditamap-source) profiling/filtering on top
// of that; that scope stays exclusive to Outline mode's tree, matching
// how a topic opened directly never reflects what any ditamap referencing
// it says either.

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
function computeManifestEntryPositions(
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
      result.push({ id: pos.id, title: entry.displayName, depth: pos.depth, role: entry.role, isGroup: true });
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
    result.push({ id: pos.id, absPath: pos.id, href: entry.href, title, depth: pos.depth, role: entry.role, topicType });
  }
  return result;
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

/** One home-page tile: a top-level manifest entry (or, for a childless-href
 *  group like a `<topichead>`, its first navigable descendant) plus enough
 *  to label the tile and say how much is behind it. */
export interface SiteHomeTile {
  title: string;
  /** Where clicking the tile navigates -- always a real topic path, never
   *  SITE_HOME_TARGET and never a group's own absPath (groups don't have one). */
  target: string;
  role?: string;
  topicType?: string;
  /** Count of navigable topics in this entry's own subtree (itself, if it has
   *  a topic of its own, plus every descendant) -- always at least 1, since a
   *  branch with none is dropped rather than given an unclickable tile. */
  topicCount: number;
}

/**
 * The home page's tiles, one per top-level manifest entry that leads
 * somewhere -- Oxygen-WebHelp-style entry points into the book, rather than
 * always dropping the reader on the first topic in reading order (see
 * renderSiteHomeHtml and the SITE_HOME_TARGET resolution in
 * MapViewerProvider.ts's renderMapContentUntracked/postSitePageUpdate).
 *
 * A leaf top-level entry (a real topic) is its own tile, targeting itself. A
 * group top-level entry (isGroup -- a `<topichead>` or an href-less
 * topicref, see DocsiteNavEntry's own comment) has no topic file to open, so
 * its tile targets the first navigable entry in its own subtree instead --
 * the same topic clicking into it in the sidebar and taking the first child
 * would land on. A top-level branch with no navigable entry anywhere under
 * it (every descendant is itself a childless group) gets no tile at all:
 * there is nowhere for it to lead.
 *
 * depth-based subtree slicing relies on the same "flat, already-in-reading-
 * order list keyed only by depth" manifest shape siteAdjacentLinks and
 * buildSiteNavTree already rely on (DocsiteNavEntry's own comment) -- an
 * entry's subtree is every following entry up to (not including) the next
 * one at its own depth or shallower.
 */
export function buildSiteHomeTiles(
  manifest: DocsiteNavEntry[],
  genericTopicLabel: string | undefined = defaultTopicTypeLabel('topic'),
): SiteHomeTile[] {
  const tiles: SiteHomeTile[] = [];
  for (let i = 0; i < manifest.length; i++) {
    const entry = manifest[i];
    if (entry.depth !== 0) continue;
    let end = i + 1;
    while (end < manifest.length && manifest[end].depth > 0) end++;
    const subtreeNavigable = siteNavigableEntries(manifest.slice(i, end));
    if (subtreeNavigable.length === 0) continue;
    const target = !entry.isGroup && entry.absPath !== undefined ? entry.absPath : subtreeNavigable[0].absPath;
    tiles.push({
      title: entry.title,
      target,
      role: entry.role,
      // The generic <topic> chip stays off a tile: the sidebar shows it so a
      // plain topic isn't the odd row out among specializations, but on a
      // home tile a chapter whose file happens to be a plain <topic> (the
      // normal bookmap case) would read "CHAPTER 1 | TOPIC" on every card,
      // and only the map's own <topichead> chapters (no file, so no chip)
      // would look different. Specializations (Task, Concept, ...) still show.
      topicType: entry.isGroup || entry.topicType === genericTopicLabel ? undefined : entry.topicType,
      topicCount: subtreeNavigable.length,
    });
  }
  return tiles;
}

/** Generic document glyph shown on every home tile -- deliberately one icon
 *  for every tile rather than one per topicType: buildSiteHomeTiles' tiles
 *  are frequently group entries (chapters) with no topicType of their own,
 *  so a per-type icon would be present on some tiles and silently missing on
 *  others. currentColor, same convention as the other inline icon constants
 *  in this file. */
const SITE_HOME_TILE_ICON_SVG =
  '<svg width="20" height="20" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path d="M4 1.5h5.5L12.5 4.5V14.5H4V1.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' +
  '<path d="M9.5 1.5V4.5H12.5" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' +
  '<path d="M5.75 8H10.75M5.75 10.25H10.75M5.75 12.5H9" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>';

/**
 * The docsite home page: a heading (the book's own title) and a tile grid,
 * one tile per buildSiteHomeTiles entry -- Oxygen WebHelp's own tile/tree
 * gallery home page (ug-editor/topics/whr-pt-feature-gallery.html) is the
 * model, not a `<topic>` file, so it does not go through renderTopicCached
 * at all.
 *
 * A tile is a plain `<a data-site-target>`, NOT `.site-nav-link` -- reusing
 * that class would pull every tile into siteAdjacentLinks' prev/next
 * computation (it queries every `.site-nav-link` in the whole document) and
 * into siteHistoryExists' existence check, corrupting both. Its click is
 * handled by a small dedicated delegation in getSiteNavClickHandlerScript
 * that looks up the matching sidebar link and drives the ordinary
 * switchToSitePage/history machinery through that -- the tile itself is
 * just a labeled pointer at a target.
 *
 * No tiles (every top-level entry is a childless group, so
 * buildSiteHomeTiles returned nothing) still renders the heading alone
 * rather than an empty grid -- shouldn't happen in practice (a map with no
 * navigable entries anywhere never reaches site mode at all, see
 * renderMapContentUntracked's own empty-manifest check), but an empty grid
 * with no tiles and no explanation would look broken rather than empty.
 */
export function renderSiteHomeHtml(
  tiles: SiteHomeTile[],
  opts: { heading: string; topicCountLabel: (count: number) => string; webhelp?: boolean },
): string {
  // Route B M3-10, §2.2: a webhelp-DOM page puts the same nodes under the
  // wh_* landing-page names of the contract (webhelpContract.ts, the 'home'
  // region) -- tile container/tile/title/text get a second class token, the
  // site-home-* classes every dv-base rule and the tile click delegation key
  // on stay exactly as they are. Purely additive, like the body-class and
  // sidebar-tree alignments before it. wh_welcome (a template's welcome text,
  // which no .opt-derived map data supplies yet) and wh_tile_shortdesc (needs
  // each topic file read for its shortdesc -- deferred with its own note
  // below) are optional contract hooks and simply not emitted until there is
  // something to put in them.
  const wh = (own: string, webhelpName: string): string =>
    opts.webhelp ? `${own} ${webhelpName}` : own;
  const heading = `<h1 class="site-home-title">${escapeHtml(opts.heading)}</h1>`;
  if (tiles.length === 0) return `<div class="site-home">${heading}</div>`;
  const cards = tiles
    .map((tile) => {
      const roleChip = tile.role ? `<span class="site-nav-chip site-nav-chip--role">${escapeHtml(tile.role)}</span>` : '';
      const typeChip = tile.topicType ? `<span class="site-nav-chip site-nav-chip--type">${escapeHtml(tile.topicType)}</span>` : '';
      return (
        `<a href="#" class="${wh('site-home-tile', 'wh_tile')}" data-site-target="${escapeAttr(tile.target)}" title="${escapeAttr(tile.title)}">` +
        `<span class="site-home-tile-icon">${SITE_HOME_TILE_ICON_SVG}</span>` +
        `<span class="site-home-tile-body">` +
        `<span class="site-home-tile-chips">${roleChip}${typeChip}</span>` +
        `<span class="${wh('site-home-tile-title', 'wh_tile_title')}">${escapeHtml(tile.title)}</span>` +
        `<span class="${wh('site-home-tile-meta', 'wh_tile_text')}">${escapeHtml(opts.topicCountLabel(tile.topicCount))}</span>` +
        `</span></a>`
      );
    })
    .join('');
  return `<div class="site-home">${heading}<div class="${wh('site-home-grid', 'wh_tiles')}" role="list">${cards}</div></div>`;
}

/** One manifest entry plus the direct children nested under it, built by
 *  buildSiteNavTree below. The manifest itself never carries parent/child
 *  links (see DocsiteNavEntry's own comment -- it's a flat, already-in-
 *  reading-order list keyed only by depth), so this is the one place that
 *  shape gets turned into an actual tree, purely for renderSiteNavHtml's
 *  own nested-<ul> output. */
interface SiteNavTreeNode {
  entry: DocsiteNavEntry;
  children: SiteNavTreeNode[];
}

/**
 * Groups a flat, depth-annotated manifest into a tree via a simple
 * ancestor stack: each entry becomes a child of the most recent
 * still-open entry with a strictly shallower depth (popping anything at
 * the same depth or deeper off the stack first, since those branches are
 * now closed). Works for irregular depth jumps the same way a strictly-
 * incrementing manifest would -- it only ever compares each entry's depth
 * to the stack, never assumes a fixed step of 1.
 */
function buildSiteNavTree(manifest: readonly DocsiteNavEntry[]): SiteNavTreeNode[] {
  const roots: SiteNavTreeNode[] = [];
  const stack: SiteNavTreeNode[] = [];
  for (const entry of manifest) {
    const node: SiteNavTreeNode = { entry, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].entry.depth >= entry.depth) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

/** Width, in px, reserved in front of every entry's title for the
 *  expand/collapse toggle -- reserved at every depth (not just where a
 *  toggle actually renders) so a leaf's title still lines up under its
 *  parent's title rather than jumping left by one toggle's width. */
const SITE_NAV_TOGGLE_SLOT = 16;

/**
 * Docsite mode's sidebar -- one link per topic, nested and indented by
 * depth to match the map's own structure, the current page marked active.
 * Parent entries (anything with at least one entry nested under it) get an
 * expand/collapse toggle to their left, Oxygen-style; leaves don't, but
 * still reserve that same width (SITE_NAV_TOGGLE_SLOT) so titles at a
 * given depth line up whether or not that particular row has a toggle.
 * Collapsing/expanding is pure client-side state (getSiteNavToggleScript)
 * -- which topics exist and how they nest never changes just because a
 * branch is tucked away, so this function never needs to know about
 * collapsed state at all, and this HTML is still rendered exactly once and
 * left alone afterward: switching pages toggles the `active` class
 * client-side (see the webview script's .site-nav-link click handler)
 * rather than re-rendering this nav on every page change.
 *
 * currentAbsPath must be one of manifest's own absPath values (generateHtml
 * resolves an unknown/stale one back to the first entry before calling
 * this) -- if it somehow isn't, nothing throws, the sidebar just renders
 * with no active entry.
 *
 * Each entry can carry up to two chips in front of its title: a role chip
 * for the bookmap's structural role ("Chapter 1", "Appendix A", ...) and a
 * type chip for the topic's own root element type ("Concept", "Task", ...).
 * Both are optional per entry; missing chips simply don't render, which
 * keeps a plain map full of generic `<topic>` files from getting a row of
 * identical "Topic" labels with no information value (see
 * makeFileTopicTypeResolver's default labeler for that filter). The title
 * text is wrapped in its own span so the link's flex layout can ellipsis
 * the title without ever clipping the chips -- the chips are short fixed
 * labels and the title is the part that overflows on narrow sidebars.
 *
 * toggleLabels is optional (defaults to English) rather than required so
 * every existing caller/test that only cares about the link markup itself
 * doesn't have to thread localized strings through just to satisfy the
 * type checker.
 */
/**
 * Just the `<ul class="site-nav-tree">` of sidebar rows -- renderSiteNavHtml
 * below wraps this in `<nav class="site-nav">`. Split out so a content-only
 * refresh (book mode's own incremental sidebar update,
 * nested-fold-and-highlight-plan.md item 1 -- see MSG_UPDATE_SIDEBAR in
 * MapViewerProvider.ts) can replace just this element's innerHTML client-
 * side, leaving the outer `<nav class="site-nav">` DOM node itself
 * untouched. That matters because getSiteSidebarResizerScript captures
 * that exact node once, at script-init time (`document.querySelector(
 * '.site-nav')`), and never re-queries it afterward -- replacing the whole
 * `<nav>` via outerHTML on every content edit would leave the resizer
 * silently holding a reference to a now-detached element, and dragging it
 * would do nothing. Site mode never needs this: its own page-switch
 * content-only update intentionally leaves the sidebar alone entirely (see
 * postSitePageUpdate's own comment) rather than refreshing it, so
 * renderSiteNavHtml stays the only entry point there.
 *
 * `collapsedIds` (nested-fold-and-highlight-plan.md item 3, persisted
 * collapse state) renders the matching rows already collapsed on arrival,
 * rather than rendering everything expanded and having a script collapse
 * them afterward -- that would flash open before snapping shut on every
 * load, exactly the "render collapsed initial state directly" requirement
 * the plan itself calls out. Membership is checked against
 * DocsiteNavEntry.id (buildBookNavManifest's stable id -- see its own
 * comment), which is also what gets stamped onto the row as
 * data-nav-id so the client can report it back after a toggle
 * (getSiteNavCollapseStateHelperScript's reportSiteNavCollapseState). A
 * hand-built manifest in a test that never sets `id` simply never
 * matches and never gets the attribute -- both are optional, not a
 * fallback onto title or position, for the exact reason buildBookNavManifest's
 * own id computation avoids title-keying: it would silently merge two
 * same-named branches' collapse state.
 */
export function renderSiteNavTreeHtml(
  manifest: DocsiteNavEntry[],
  currentAbsPath: string,
  toggleLabels: { expand: string; collapse: string } = { expand: 'Expand', collapse: 'Collapse' },
  collapsedIds: ReadonlySet<string> = new Set(),
  revealActive = false,
  webhelp = false,
): string {
  const expandLabel = escapeAttr(toggleLabels.expand);
  const collapseLabel = escapeAttr(toggleLabels.collapse);

  const tree = buildSiteNavTree(manifest);

  // With revealActive (site mode), every ancestor of the active page is
  // rendered expanded whatever collapsedIds says. Site mode re-renders the
  // whole page, sidebar included, on every open and every edit; honouring a
  // persisted collapse on the branch that holds the page being read would
  // hide the one row that says where the reader is, with nothing to explain
  // why. Book mode leaves this off: its `currentAbsPath` is only the
  // initial highlight (the first topic) and book mode's own scroll-sync
  // decides what to reveal as the reader actually scrolls.
  const ancestorsOfActive = new Set<SiteNavTreeNode>();
  if (revealActive) {
    const mark = (nodes: SiteNavTreeNode[]): boolean => {
      let found = false;
      for (const n of nodes) {
        const inChildren = mark(n.children);
        if (inChildren) ancestorsOfActive.add(n);
        if (inChildren || (!n.entry.isGroup && n.entry.absPath !== undefined && n.entry.absPath === currentAbsPath)) found = true;
      }
      return found;
    };
    mark(tree);
  }

  // Roving tabindex (the ARIA tree pattern): the whole tree is ONE Tab stop,
  // and arrow keys move within it (getSiteNavKeyboardScript). Without it every
  // topic link and every fold toggle is its own stop, and a large map takes
  // hundreds of Tab presses to get past the sidebar. The stop starts on the
  // active page -- where the reader is -- or the first row when there is none
  // (book mode's initial highlight, a page the map no longer has). The client
  // script moves it as focus moves.
  const findActive = (nodes: SiteNavTreeNode[]): SiteNavTreeNode | undefined => {
    for (const n of nodes) {
      if (!n.entry.isGroup && n.entry.absPath !== undefined && n.entry.absPath === currentAbsPath) return n;
      const inChildren = findActive(n.children);
      if (inChildren) return inChildren;
    }
    return undefined;
  };
  const rovingNode = findActive(tree) ?? tree[0];

  const renderNode = (node: SiteNavTreeNode): string => {
    const entry = node.entry;
    const hasChildren = node.children.length > 0;
    const rowTabindex = node === rovingNode ? '0' : '-1';
    // The link's own padding-left carries the full indent, toggle slot
    // included, exactly as before this feature -- the toggle itself is a
    // sibling, absolutely positioned into that reserved slot (see
    // .site-nav-toggle/.site-nav-item in media/styles.css) rather than an
    // inline child of the link, so a click on it can be told apart from a
    // click on the link (the .site-nav-link click delegation only ever
    // matches inside the <a> itself).
    const indent = 8 + SITE_NAV_TOGGLE_SLOT + entry.depth * 16;
    const toggleLeft = 8 + entry.depth * 16;
    // Role chip first (the rarer, more specific signal), then the type
    // chip (the topic's information type), then the title. Both chips
    // are escaped the same way the title is -- they're already display
    // strings produced by labelers, but a labeler fed a malicious tag
    // name (from a parsed topic a user controls) shouldn't be able to
    // inject markup into the sidebar.
    const roleChip = entry.role
      ? `<span class="site-nav-chip site-nav-chip--role">${escapeHtml(entry.role)}</span>`
      : '';
    const typeChip = entry.topicType
      ? `<span class="site-nav-chip site-nav-chip--type">${escapeHtml(entry.topicType)}</span>`
      : '';
    const navIdAttr = entry.id ? ` data-nav-id="${escapeAttr(entry.id)}"` : '';
    // Collapsed on arrival when this row's own id is in the persisted set
    // -- everything else defaults to expanded, matching the "only the
    // non-default state is ever stored" design (see MapViewerProvider.ts's
    // COLLAPSED_NAV_KEY comment). A row with no id (only possible from a
    // hand-built test manifest -- buildBookNavManifest always sets one)
    // can never match and is always rendered expanded, same as before
    // this feature existed.
    const isCollapsed = hasChildren && entry.id !== undefined && collapsedIds.has(entry.id) && !ancestorsOfActive.has(node);
    const toggleHtml = hasChildren
      ? `<button type="button" class="site-nav-toggle" style="left:${toggleLeft}px" aria-expanded="${isCollapsed ? 'false' : 'true'}" aria-label="${isCollapsed ? expandLabel : collapseLabel}" tabindex="-1" data-expand-label="${expandLabel}" data-collapse-label="${collapseLabel}"></button>`
      : '';
    const childrenHtml = hasChildren
      ? `<ul class="site-nav-children" role="group">${node.children.map(renderNode).join('')}</ul>`
      : '';
    const itemClass = hasChildren ? (isCollapsed ? ' has-children collapsed' : ' has-children') : '';
    // Webhelp mode (route B, step 4) doubles the tree classes onto the same
    // node: the WebHelp names a template's css reads (topicref / expanded /
    // active) sit alongside our own site-nav-* classes, which our behaviour JS
    // keeps driving. has-children is already ours; expanded is added only for
    // an open parent, active only for the row that is the current page. In own
    // mode this is the empty string, so the markup is byte-for-byte unchanged.
    const whClass = webhelp ? ` topicref${hasChildren && !isCollapsed ? ' expanded' : ''}` : '';
    const itemAriaExpanded = hasChildren ? ` aria-expanded="${isCollapsed ? 'false' : 'true'}"` : '';
    // A group entry (DocsiteNavEntry.isGroup -- a <topichead> or a bare
    // key-only topicref, see that field's own comment) has no topic file
    // to navigate to, so it renders as a plain non-clickable label -- no
    // <a>, no data-site-target, no href -- instead of renderSiteNavHtml's
    // usual link markup. Its own expand/collapse toggle (if it has
    // children) still works exactly like any other parent's; only the
    // click-to-navigate behavior is missing, matching how tree mode
    // already renders a topichead as a non-clickable heading
    // (map/topichead in mapTypeMap.ts) and book mode renders one as a
    // plain section heading (renderBookParts's own `struct:` branch).
    if (entry.isGroup) {
      const label = `<span class="site-nav-group-label" tabindex="${rowTabindex}" style="padding-left:${indent}px" title="${escapeAttr(entry.title)}">${roleChip}<span class="site-nav-link-text">${escapeHtml(entry.title)}</span></span>`;
      return `<li class="site-nav-item site-nav-item--group${itemClass}${whClass}" role="treeitem"${itemAriaExpanded}${navIdAttr}>${toggleHtml}${label}${childrenHtml}</li>`;
    }
    const activeClass = entry.absPath === currentAbsPath ? ' active' : '';
    const currentAttr = activeClass ? ' aria-current="page"' : '';
    const link = `<a href="#" class="site-nav-link${activeClass}"${currentAttr} tabindex="${rowTabindex}" data-site-target="${escapeAttr(entry.absPath as string)}" style="padding-left:${indent}px" title="${escapeAttr(entry.title)}">${roleChip}${typeChip}<span class="site-nav-link-text">${escapeHtml(entry.title)}</span></a>`;
    return `<li class="site-nav-item${itemClass}${whClass}${webhelp && activeClass ? ' active' : ''}" role="treeitem"${itemAriaExpanded}${navIdAttr}>${toggleHtml}${link}${childrenHtml}</li>`;
  };

  const items = tree.map(renderNode).join('');
  return `<ul class="site-nav-tree" role="tree">${items}</ul>`;
}

export function renderSiteNavHtml(
  manifest: DocsiteNavEntry[],
  currentAbsPath: string,
  navLabel: string,
  toggleLabels: { expand: string; collapse: string } = { expand: 'Expand', collapse: 'Collapse' },
  collapsedIds: ReadonlySet<string> = new Set(),
  revealActive = false,
  webhelp = false,
): string {
  return wrapSiteNavTreeHtml(renderSiteNavTreeHtml(manifest, currentAbsPath, toggleLabels, collapsedIds, revealActive, webhelp), navLabel);
}

/**
 * The <nav> a rendered sidebar tree goes in. Split out of renderSiteNavHtml
 * so a caller that also needs the bare tree (MSG_UPDATE_SIDEBAR sends the
 * tree alone) can render it once and wrap it, instead of rendering it twice.
 */
export function wrapSiteNavTreeHtml(treeHtml: string, navLabel: string): string {
  return `<nav class="site-nav" aria-label="${escapeAttr(navLabel)}">${treeHtml}</nav>`;
}

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
