// Full-book search (docsite design doc, 4.4). Deliberately separate from
// the current-page search overlay (getSearchOverlayScript in
// ditaRenderUtils.ts), which is a pure DOM/<mark> mechanism that already
// works per-page for free in site mode -- searching the WHOLE book needs
// its own text index, since a book can have far more content than what is
// on screen at once. That said, the two are wired together rather than
// left as two unrelated features: this module's own matching reuses
// findTextMatches (the same pure match engine the page overlay uses) so
// "does this count as a match" agrees between the two, and picking a
// full-book result hands off to the page overlay to actually highlight
// and scroll to it once the target page has loaded (see getBookSearchScript's
// own comment on pendingSiteSearchHighlight).
//
// The one thing this module is careful never to do is run a full render
// (renderTopicCached/renderDocument) per topic to build that index: that
// would reintroduce exactly the O(topics-in-book) cost book/site mode
// exists to get away from (see the design doc's own framing of the
// problem in section 1). Extraction here is pure text -- no conref/keyref
// resolution, no HTML generation -- and the resulting index is built once
// per book and cached, not rebuilt per keystroke.

import { existsSync, readFileSync } from 'fs';
import { DitaNode } from '../parser/domTypes';
import { parseDita, preprocessEntities } from '../parser/ditaParser';
import { findTopLevelIndextermsInSubtree, collectIndextermChips } from '../render/baseTypeMap';
import { stampFiles, findTextMatches } from './ditaRenderUtils';
import type { DocsiteNavEntry } from './ditaRenderUtils';

export interface BookSearchEntry {
  absPath: string;
  /** Whitespace-collapsed body text, ORIGINAL casing (title included,
   *  prolog and indexterm text excluded -- see extractBodyText). Kept in
   *  its original case, not lowercased at build time: case sensitivity is
   *  a per-query option (searchBookIndex below), so a single stored copy
   *  has to serve both a case-sensitive and a case-insensitive search,
   *  and findTextMatches already handles the insensitive case via a regex
   *  flag rather than needing a pre-lowered copy to compare against. */
  bodyText: string;
  /** One entry per indexterm chip found anywhere in the topic (body or
   *  prolog/keywords) -- path keeps its original casing for display,
   *  pathText is its " "-joined form searchBookIndex matches against. */
  indexterms: Array<{ path: string[]; pathText: string }>;
}

/**
 * Recursively flattens a subtree to plain text, joining sibling elements
 * with a space (not concatenating directly) so "<p>Hello</p><p>World</p>"
 * extracts as "Hello World", not "HelloWorld" -- and skips topic/prolog
 * entirely, so private metadata (author, critdates, internal codenames...)
 * never becomes searchable body text. Also skips topic/indexterm's own
 * text: its term is already tracked precisely via the dedicated
 * `indexterms` list (collectIndextermsFrom below), and folding it into
 * bodyText too would mean every indexterm match ALSO produces a
 * redundant body hit for the exact same word for the exact same reason,
 * which isn't the independent-match case the 'body AND indexterm hit for
 * one topic' design (searchBookIndex's own doc comment) is meant to allow.
 */
function extractBodyText(node: DitaNode): string {
  if (node.type === 'text') return node.text || '';
  if (node.baseType === 'topic/prolog' || node.baseType === 'topic/indexterm') return '';
  return (node.children || []).map(extractBodyText).join(' ');
}

function collectIndextermsFrom(root: DitaNode): Array<{ path: string[]; pathText: string }> {
  const roots = findTopLevelIndextermsInSubtree(root);
  const chips = roots.flatMap((r) => collectIndextermChips(r));
  // index-see/index-see-also targets (docsite design doc, 4.4 closing
  // note) are deliberately NOT indexed as hits under this topic: they name
  // an entry that lives elsewhere ("see: X" is a redirect, not "this topic
  // discusses X"), and collectIndextermChips already keeps that text out
  // of a chip's own `path` (it lands in seeAnnotations instead, which this
  // ignores) -- so this simple version costs nothing extra to get right,
  // it just means a see-target's own name isn't searchable via THIS
  // topic's indexterms, which is the safe default called for there.
  return chips
    .filter((c) => c.path.length > 0)
    .map((c) => ({ path: c.path, pathText: c.path.join(' ') }));
}

/**
 * Pure per-topic extraction: reads and parses one topic file and pulls out
 * exactly what full-book search needs, nothing more (no keyMap, no
 * webview URIs, no rendering). Returns undefined on any failure (missing
 * file, parse error) rather than throwing, so buildBookSearchIndex can
 * skip a bad topic and keep indexing the rest of the book instead of
 * losing the whole index over one broken file.
 */
export function extractBookSearchEntry(filePath: string): BookSearchEntry | undefined {
  try {
    if (!existsSync(filePath)) return undefined;
    const raw = readFileSync(filePath, 'utf-8');
    const doc = parseDita(preprocessEntities(raw));
    const bodyText = extractBodyText(doc.root).replace(/\s+/g, ' ').trim();
    const indexterms = collectIndextermsFrom(doc.root);
    return { absPath: filePath, bodyText, indexterms };
  } catch (e) {
    console.warn(`Failed to extract search text from ${filePath}:`, e instanceof Error ? e.message : e);
    return undefined;
  }
}

/** Builds a fresh index from a docsite manifest (see buildBookNavManifest).
 *  A topic extractBookSearchEntry can't read simply has no entry in the
 *  returned map -- searchBookIndex treats a missing entry as "no match",
 *  which is the same as how an unreadable topic already behaves elsewhere
 *  in book/site mode (renderBookError-style, not a hard failure). */
export function buildBookSearchIndex(manifest: DocsiteNavEntry[]): Map<string, BookSearchEntry> {
  const index = new Map<string, BookSearchEntry>();
  for (const item of manifest) {
    const entry = extractBookSearchEntry(item.absPath);
    if (entry) index.set(item.absPath, entry);
  }
  return index;
}

interface BookSearchIndexCacheEntry {
  index: Map<string, BookSearchEntry>;
  filesKey: string;
  stamps: string;
}
const bookSearchIndexCache = new Map<string, BookSearchIndexCacheEntry>();
// Each entry holds full topic body text for an entire book -- heavier per
// entry than keyMap's or bookMembers' own caches, so this stays a smaller
// cap than either (KEY_MAP_CACHE_MAX/BOOK_MEMBERS_CACHE_MAX are 50).
const BOOK_SEARCH_INDEX_CACHE_MAX = 20;

/** Part of clearAllCaches() in DitaViewerProvider.ts. */
export function clearBookSearchIndexCache(): void {
  bookSearchIndexCache.clear();
}

/**
 * Drops just one book's cached index, forcing the next getBookSearchIndex
 * call for that docDir to rebuild from disk regardless of whether its own
 * mtime-based staleness check would have caught anything -- backs the
 * search box's manual refresh button (getBookSearchScript's bsRefreshBtn):
 * mtime stamps already invalidate automatically on an edit, so this exists
 * for the reassurance case (the reader isn't sure the index reflects
 * disk, or a file changed some other way stampFiles can't observe) rather
 * than being required for correctness the way clearBookSearchIndexCache's
 * blanket clear is for clearAllCaches.
 */
export function invalidateBookSearchIndex(docDir: string): void {
  bookSearchIndexCache.delete(docDir);
}

/**
 * Lazy + cached (docsite design doc, 3.1): the first full-book search in a
 * session pays for extracting every topic's text once; every search after
 * that against an unchanged book reuses the same index instance instead of
 * re-parsing the whole book per keystroke. Keyed by docDir (one open map,
 * one docDir, matching buildKeyMap/getStableBookMembers' own granularity)
 * and invalidated the same dual way buildKeyMap is: the manifest's own
 * file list (order and membership -- a changed topicref list needs a new
 * index even if every individual file's mtime happens to be unchanged)
 * AND each file's own mtime stamp (a topic can be edited without the
 * topicref list changing at all).
 */
export function getBookSearchIndex(docDir: string, manifest: DocsiteNavEntry[]): Map<string, BookSearchEntry> {
  const files = manifest.map((m) => m.absPath);
  const filesKey = files.join('|');
  const stamps = stampFiles(files);

  const cached = bookSearchIndexCache.get(docDir);
  if (cached && cached.filesKey === filesKey && cached.stamps === stamps) {
    return cached.index;
  }

  const index = buildBookSearchIndex(manifest);
  if (bookSearchIndexCache.size >= BOOK_SEARCH_INDEX_CACHE_MAX && !bookSearchIndexCache.has(docDir)) {
    const oldest = bookSearchIndexCache.keys().next().value;
    if (oldest !== undefined) bookSearchIndexCache.delete(oldest);
  }
  bookSearchIndexCache.set(docDir, { index, filesKey, stamps });
  return index;
}

export interface BookSearchOptions {
  caseSensitive?: boolean;
  useRegex?: boolean;
}

export interface BookSearchHit {
  absPath: string;
  kind: 'indexterm' | 'body';
  /** For an indexterm hit: the matching chip's own path(s), " › "-joined.
   *  For a body hit: a short window of body text around the match. */
  snippet: string;
}

export interface BookSearchOutcome {
  hits: BookSearchHit[];
  /** Set only when useRegex produced an invalid pattern -- mirrors the
   *  page search overlay's own "invalid regex" state (getSearchOverlayScript's
   *  performSearch) rather than silently reporting zero results, which
   *  would look identical to "the pattern is valid but matches nothing". */
  error?: 'invalid-regex';
}

const SNIPPET_RADIUS = 40;

function makeBodySnippet(text: string, matchIndex: number, matchLength: number): string {
  const start = Math.max(0, matchIndex - SNIPPET_RADIUS);
  const end = Math.min(text.length, matchIndex + matchLength + SNIPPET_RADIUS);
  const prefix = start > 0 ? '\u2026' : '';
  const suffix = end < text.length ? '\u2026' : '';
  return prefix + text.slice(start, end) + suffix;
}

/**
 * Searches a book's index and returns hits ordered per the docsite design
 * doc's 4.4: every indexterm hit, across every topic, before every body
 * hit -- not just "indexterm before body within the same topic". A topic
 * that matches both ways gets one hit of each kind (a search results list
 * showing the same topic twice under different reasons is more useful
 * than silently picking one), each independently placed in its own bucket.
 *
 * `order` is the manifest's own reading order (its absPath list) -- hits
 * within each bucket follow that order, so results read top-to-bottom the
 * same way the book itself does, same rationale as buildBookNavManifest's
 * own entries being reading-order.
 *
 * Matching goes through findTextMatches -- the exact same pure engine the
 * page-level search overlay uses -- rather than a separate indexOf/includes
 * implementation, specifically so "is this a match" (and, with useRegex,
 * "is this even a valid pattern") agrees between the book-wide result list
 * and what lights up once the reader actually jumps to a result (see
 * getBookSearchScript's pendingSiteSearchHighlight hand-off).
 */
export function searchBookIndex(
  index: Map<string, BookSearchEntry>,
  query: string,
  order: string[],
  options: BookSearchOptions = {},
): BookSearchOutcome {
  const q = query.trim();
  if (!q) return { hits: [] };

  const caseSensitive = options.caseSensitive ?? false;
  const useRegex = options.useRegex ?? false;

  // findTextMatches itself returns null for an invalid pattern, but only
  // once it is handed an actual piece of text -- validating once here
  // up front means an invalid regex is reported once, not once per topic
  // (and not "no results" for a book that might otherwise match plenty).
  if (useRegex) {
    const probe = findTextMatches('', q, true, caseSensitive);
    if (probe === null) return { hits: [], error: 'invalid-regex' };
  }

  const indextermHits: BookSearchHit[] = [];
  const bodyHits: BookSearchHit[] = [];

  for (const absPath of order) {
    const entry = index.get(absPath);
    if (!entry) continue;

    const matchedChips = entry.indexterms.filter(
      (t) => (findTextMatches(t.pathText, q, useRegex, caseSensitive)?.length ?? 0) > 0,
    );
    if (matchedChips.length > 0) {
      indextermHits.push({
        absPath,
        kind: 'indexterm',
        snippet: matchedChips.map((c) => c.path.join(' \u203A ')).join('; '),
      });
    }

    const bodyMatches = findTextMatches(entry.bodyText, q, useRegex, caseSensitive);
    if (bodyMatches && bodyMatches.length > 0) {
      const first = bodyMatches[0];
      bodyHits.push({ absPath, kind: 'body', snippet: makeBodySnippet(entry.bodyText, first.start, first.end - first.start) });
    }
  }

  return { hits: [...indextermHits, ...bodyHits] };
}

/**
 * Docsite mode's full-book search UI (docsite design doc, 4.4 and 6.3,
 * revised after first-look feedback on the initial toolbar-button version):
 * an always-visible search box pinned to the top of the sidebar's topic
 * list, not a magnifying-glass button in the per-topic toolbar. Two
 * reasons, both from that feedback: every other toolbar control acts on
 * the CURRENT topic (font, width, tags, current-page search...), so a
 * button there reads as "search this page" even before considering its
 * icon; and putting the search box directly above the topic list it
 * searches is a stronger, self-explanatory placement than any icon choice
 * could be. The "Aa" / ".*" toggle buttons deliberately reuse the exact
 * button styling AND wording (via the caller's L.searchMatchCase/
 * L.searchUseRegex/L.searchInvalidRegex, the same strings the page overlay
 * itself is built with) as getSearchOverlayScript's own case/regex
 * toggles, rather than a new icon vocabulary -- consistency was the
 * complaint, so this reuses the one pair of controls already established
 * as this project's visual language for "match case" / "use regex".
 *
 * Same unconditional-build/caller-decides-append convention as
 * getSitePrevNextButtonsScript etc. in ditaRenderUtils.ts: this builds
 * everything and then, itself, finds .site-nav and inserts into it --
 * MapViewerProvider.ts's own toolbar assembly does not need to know this
 * feature exists. Assumes `switchToSitePage`/`pendingSiteAnchor`
 * (getSiteNavClickHandlerScript) and the page search overlay's own
 * `performSearch`/`openSearchBar`/`caseSensitive`/`useRegex`/`searchInput`/
 * `caseBtn`/`regexBtn`/`updateToggleVisual` (getSearchOverlayScript) are
 * already in scope, same as this project's other site-mode-only script
 * generators.
 */
export function getBookSearchScript(opts: {
  searchLabel: string;
  placeholder: string;
  noResultsLabel: string;
  matchCaseLabel: string;
  useRegexLabel: string;
  invalidRegexLabel: string;
  refreshLabel: string;
  clearLabel: string;
  requestMsgType: string;
  responseMsgType: string;
}): string {
  const searchLabel = JSON.stringify(opts.searchLabel);
  const placeholder = JSON.stringify(opts.placeholder);
  const noResultsLabel = JSON.stringify(opts.noResultsLabel);
  const matchCaseLabel = JSON.stringify(opts.matchCaseLabel);
  const useRegexLabel = JSON.stringify(opts.useRegexLabel);
  const invalidRegexLabel = JSON.stringify(opts.invalidRegexLabel);
  const refreshLabel = JSON.stringify(opts.refreshLabel);
  const clearLabel = JSON.stringify(opts.clearLabel);
  return `
  // Consumed once by MSG_UPDATE_CONTENT's handler (MapViewerProvider.ts)
  // when the target page's HTML actually arrives -- cleared immediately
  // after, same lifecycle as pendingSiteAnchor above. Declared ahead of
  // the .site-nav guard below (rather than inside it) so MapViewerProvider's
  // handler can always safely check/clear it even in tree/book mode, where
  // it will simply stay null forever.
  var pendingSiteSearchHighlight = null;

  // Shared by both paths a search result click can take: the target page
  // is already the one showing (nothing to switch, so no MSG_UPDATE_CONTENT
  // will ever arrive to trigger this -- it has to run immediately), or a
  // different page (deferred via pendingSiteSearchHighlight above until
  // that page's HTML actually lands). Either way, this defers the ACTUAL
  // highlighting to the page's own already-tested search overlay
  // (performSearch/openSearchBar/caseSensitive/useRegex/searchInput/
  // caseBtn/regexBtn/updateToggleVisual -- getSearchOverlayScript) rather
  // than this feature inventing a second, parallel highlighting mechanism.
  function bsApplyPageSearch(opts) {
    caseSensitive = opts.caseSensitive;
    useRegex = opts.useRegex;
    updateToggleVisual(caseBtn, caseSensitive);
    updateToggleVisual(regexBtn, useRegex);
    searchInput.value = opts.term;
    openSearchBar();
    performSearch(opts.term);
  }

  var siteNav = document.querySelector('.site-nav');
  if (siteNav) {
    // renderSiteNavHtml (ditaRenderUtils.ts) renders the topic links
    // directly as .site-nav's children -- wrapping them here, at script
    // run time, rather than changing that function, is what lets this
    // hide/show "the topic list" as one unit while a search is active,
    // without that pure/tested HTML-generation function needing to know
    // search exists at all.
    var bsLinksWrap = document.createElement('div');
    bsLinksWrap.className = 'site-nav-links';
    var bsExistingLinks = Array.prototype.slice.call(siteNav.children);
    bsExistingLinks.forEach(function(el) { bsLinksWrap.appendChild(el); });

    var bsBox = document.createElement('div');
    bsBox.setAttribute('role', 'search');
    bsBox.setAttribute('aria-label', ${searchLabel});
    bsBox.style.cssText = 'padding:6px 8px;border-bottom:1px solid var(--vscode-panel-border);display:flex;flex-direction:column;gap:4px;';

    // Icon-only action buttons (refresh, clear) -- reusing this project's
    // own already-established glyphs for these exact actions (the main
    // toolbar's refresh button and the page search overlay's close
    // button, both in this same assembled script) rather than inventing
    // new ones, per the "copy VS Code's own search-panel icon row"
    // request this row is modeled on.
    var bsIconBtnStyle = 'padding:1px 5px;border-radius:3px;border:1px solid transparent;background:transparent;color:var(--vscode-icon-foreground,var(--vscode-foreground));cursor:pointer;font-size:13px;line-height:1.4;outline:none;';
    var bsHeaderRow = document.createElement('div');
    bsHeaderRow.style.cssText = 'display:flex;justify-content:flex-end;gap:2px;';

    var bsRefreshBtn = document.createElement('button');
    bsRefreshBtn.innerHTML = '&#x21bb;';
    bsRefreshBtn.title = ${refreshLabel};
    bsRefreshBtn.setAttribute('aria-label', ${refreshLabel});
    bsRefreshBtn.style.cssText = bsIconBtnStyle;

    var bsClearBtn = document.createElement('button');
    bsClearBtn.innerHTML = '&times;';
    bsClearBtn.title = ${clearLabel};
    bsClearBtn.setAttribute('aria-label', ${clearLabel});
    bsClearBtn.style.cssText = bsIconBtnStyle + 'font-size:16px;';

    bsHeaderRow.appendChild(bsRefreshBtn);
    bsHeaderRow.appendChild(bsClearBtn);
    bsBox.appendChild(bsHeaderRow);

    var bsInputRow = document.createElement('div');
    bsInputRow.style.cssText = 'display:flex;align-items:center;gap:4px;';

    var bookSearchInput = document.createElement('input');
    bookSearchInput.type = 'text';
    bookSearchInput.placeholder = ${placeholder};
    bookSearchInput.setAttribute('aria-label', ${placeholder});
    bookSearchInput.style.cssText = 'flex:1;min-width:0;box-sizing:border-box;padding:3px 6px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--vscode-widget-border,#555));border-radius:3px;font-size:12px;outline:none;';

    // Exact same button styling and toggle-visual convention as the page
    // search overlay's own caseBtn/regexBtn (getSearchOverlayScript) --
    // deliberately duplicated as bs-prefixed constants rather than shared
    // variables, so this toggle's on/off state stays independent of the
    // page overlay's own (a reader filtering the book-wide result list in
    // regex mode is not necessarily also mid-way through a page-level
    // regex search), while still looking identical.
    var bsToggleStyle = 'padding:1px 5px;border-radius:3px;border:1px solid var(--vscode-dropdown-border,var(--vscode-widget-border,#555));background:var(--vscode-dropdown-background,#333);color:var(--vscode-dropdown-foreground,#eee);cursor:pointer;font-size:11px;line-height:1.4;outline:none;';
    var bsActiveBg = 'var(--vscode-button-background,#0e639c)';
    var bsActiveFg = 'var(--vscode-button-foreground,#fff)';
    var bsInactiveBg = 'var(--vscode-dropdown-background,#333)';
    var bsInactiveFg = 'var(--vscode-dropdown-foreground,#eee)';
    var bsInactiveBd = 'var(--vscode-dropdown-border,var(--vscode-widget-border,#555))';
    function bsUpdateToggle(btn, active) {
      btn.style.background = active ? bsActiveBg : bsInactiveBg;
      btn.style.color = active ? bsActiveFg : bsInactiveFg;
      btn.style.borderColor = active ? bsActiveBg : bsInactiveBd;
    }

    var bsCaseBtn = document.createElement('button');
    bsCaseBtn.textContent = 'Aa';
    bsCaseBtn.title = ${matchCaseLabel};
    bsCaseBtn.setAttribute('aria-label', ${matchCaseLabel});
    bsCaseBtn.style.cssText = bsToggleStyle;
    bsUpdateToggle(bsCaseBtn, false);

    var bsRegexBtn = document.createElement('button');
    bsRegexBtn.textContent = '.*';
    bsRegexBtn.title = ${useRegexLabel};
    bsRegexBtn.setAttribute('aria-label', ${useRegexLabel});
    bsRegexBtn.style.cssText = bsToggleStyle + 'font-family:monospace;';
    bsUpdateToggle(bsRegexBtn, false);

    bsInputRow.appendChild(bookSearchInput);
    bsInputRow.appendChild(bsCaseBtn);
    bsInputRow.appendChild(bsRegexBtn);
    bsBox.appendChild(bsInputRow);

    var bookSearchResults = document.createElement('div');
    bookSearchResults.style.cssText = 'display:none;max-height:50vh;overflow:auto;';
    bsBox.appendChild(bookSearchResults);

    siteNav.insertBefore(bsLinksWrap, siteNav.firstChild);
    siteNav.insertBefore(bsBox, bsLinksWrap);

    var bsCaseSensitive = false;
    var bsUseRegex = false;

    function bsShowLinks() {
      bookSearchResults.style.display = 'none';
      bookSearchResults.innerHTML = '';
      bsLinksWrap.style.display = '';
    }

    function bsRunQuery(forceRefresh) {
      var q = bookSearchInput.value;
      if (!q) {
        bsShowLinks();
        return;
      }
      vscode.postMessage({ type: '${opts.requestMsgType}', query: q, caseSensitive: bsCaseSensitive, useRegex: bsUseRegex, refresh: !!forceRefresh });
    }

    // Debounced -- a query is sent to the extension host (which builds/reuses
    // the lazy index; see getBookSearchIndex) at most once per pause in
    // typing, not once per keystroke.
    var bsDebounce = null;
    bookSearchInput.addEventListener('input', function() {
      if (bsDebounce) clearTimeout(bsDebounce);
      bsDebounce = setTimeout(function() { bsRunQuery(false); }, 200);
    });

    bsCaseBtn.addEventListener('click', function() {
      bsCaseSensitive = !bsCaseSensitive;
      bsUpdateToggle(bsCaseBtn, bsCaseSensitive);
      bsRunQuery(false);
    });
    bsRegexBtn.addEventListener('click', function() {
      bsUseRegex = !bsUseRegex;
      bsUpdateToggle(bsRegexBtn, bsUseRegex);
      bsRunQuery(false);
    });

    // Mtime-based cache invalidation (getBookSearchIndex) already catches
    // an edited topic on its own -- this is for the reassurance case
    // (unsure the index reflects disk) rather than being needed for
    // correctness, same as VS Code's own search panel refresh button
    // re-running a search that could otherwise already be showing stale
    // results. A no-op on an empty query: there is nothing to refresh.
    bsRefreshBtn.addEventListener('click', function() {
      if (bookSearchInput.value) bsRunQuery(true);
    });

    bsClearBtn.addEventListener('click', function() {
      bookSearchInput.value = '';
      bsShowLinks();
      bookSearchInput.focus();
    });

    window.addEventListener('message', function(e) {
      if (e.data.type !== '${opts.responseMsgType}') return;
      bookSearchResults.innerHTML = '';
      bookSearchResults.style.display = 'block';
      bsLinksWrap.style.display = 'none';

      if (e.data.error === 'invalid-regex') {
        var err = document.createElement('div');
        err.textContent = ${invalidRegexLabel};
        err.style.cssText = 'color:var(--vscode-errorForeground,#f48771);padding:4px 2px;font-size:12px;';
        bookSearchResults.appendChild(err);
        return;
      }

      var results = e.data.results || [];
      if (results.length === 0) {
        var empty = document.createElement('div');
        empty.textContent = ${noResultsLabel};
        empty.style.cssText = 'opacity:0.7;padding:4px 2px;font-size:12px;';
        bookSearchResults.appendChild(empty);
        return;
      }
      results.forEach(function(r) {
        var item = document.createElement('div');
        item.style.cssText = 'padding:4px 2px;cursor:pointer;border-bottom:1px solid var(--vscode-panel-border);font-size:12px;';
        var titleEl = document.createElement('div');
        // U+1F4D1 (bookmark tabs) matches the indexterm chip's own marker
        // (renderIndextermChip in baseTypeMap.ts) -- same visual language
        // for \"this came from an index entry\" wherever it shows up.
        titleEl.textContent = (r.kind === 'indexterm' ? '\\u{1F4D1} ' : '') + r.title;
        titleEl.style.cssText = 'font-weight:600;';
        var snippetEl = document.createElement('div');
        snippetEl.textContent = r.snippet;
        snippetEl.style.cssText = 'opacity:0.75;';
        item.appendChild(titleEl);
        item.appendChild(snippetEl);
        item.addEventListener('click', function() {
          var opts = { term: bookSearchInput.value, caseSensitive: bsCaseSensitive, useRegex: bsUseRegex };
          var navLinks = bsLinksWrap.querySelectorAll('.site-nav-link');
          var navLink = null;
          for (var i = 0; i < navLinks.length; i++) {
            if (navLinks[i].getAttribute('data-site-target') === r.absPath) { navLink = navLinks[i]; break; }
          }
          if (!navLink) return;
          if (navLink.classList.contains('active')) {
            // Already on this page -- switchToSitePage would no-op and no
            // MSG_UPDATE_CONTENT will ever arrive to trigger the deferred
            // path below, so apply the highlight right now instead.
            bsApplyPageSearch(opts);
          } else {
            pendingSiteSearchHighlight = opts;
            switchToSitePage(navLink);
          }
        });
        bookSearchResults.appendChild(item);
      });
    });
  }
`;
}
