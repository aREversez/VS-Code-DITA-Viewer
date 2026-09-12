// Full-book search (docsite design doc, 4.4). Deliberately separate from
// the current-page search overlay (getSearchOverlayScript in
// ditaRenderUtils.ts), which is a pure DOM/<mark> mechanism that already
// works per-page for free in site mode -- searching the WHOLE book needs
// its own text index, since a book can have far more content than what is
// on screen at once.
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
import { stampFiles } from './ditaRenderUtils';
import type { DocsiteNavEntry } from './ditaRenderUtils';

export interface BookSearchEntry {
  absPath: string;
  /** Whitespace-collapsed, already-lowercased body text (title included,
   *  prolog excluded -- see extractBookSearchEntry). Lowercased once here
   *  at index-build time rather than per query, since the same entry is
   *  matched against every keystroke of a search. */
  bodyTextLower: string;
  /** One entry per indexterm chip found anywhere in the topic (body or
   *  prolog/keywords) -- path keeps its original casing for display,
   *  pathLower is the space-joined lowercase form searchBookIndex matches
   *  against. */
  indexterms: Array<{ path: string[]; pathLower: string }>;
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

function collectIndextermsFrom(root: DitaNode): Array<{ path: string[]; pathLower: string }> {
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
    .map((c) => ({ path: c.path, pathLower: c.path.join(' ').toLowerCase() }));
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
    const bodyTextLower = extractBodyText(doc.root).replace(/\s+/g, ' ').trim().toLowerCase();
    const indexterms = collectIndextermsFrom(doc.root);
    return { absPath: filePath, bodyTextLower, indexterms };
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

export interface BookSearchHit {
  absPath: string;
  kind: 'indexterm' | 'body';
  /** For an indexterm hit: the matching chip's own path(s), " › "-joined.
   *  For a body hit: a short window of body text around the match. */
  snippet: string;
}

const SNIPPET_RADIUS = 40;

function makeBodySnippet(textLower: string, matchIndex: number, matchLength: number): string {
  const start = Math.max(0, matchIndex - SNIPPET_RADIUS);
  const end = Math.min(textLower.length, matchIndex + matchLength + SNIPPET_RADIUS);
  const prefix = start > 0 ? '\u2026' : '';
  const suffix = end < textLower.length ? '\u2026' : '';
  return prefix + textLower.slice(start, end) + suffix;
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
 */
export function searchBookIndex(index: Map<string, BookSearchEntry>, query: string, order: string[]): BookSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const indextermHits: BookSearchHit[] = [];
  const bodyHits: BookSearchHit[] = [];

  for (const absPath of order) {
    const entry = index.get(absPath);
    if (!entry) continue;

    const matchedChips = entry.indexterms.filter((t) => t.pathLower.includes(q));
    if (matchedChips.length > 0) {
      indextermHits.push({
        absPath,
        kind: 'indexterm',
        snippet: matchedChips.map((c) => c.path.join(' \u203A ')).join('; '),
      });
    }

    const matchIndex = entry.bodyTextLower.indexOf(q);
    if (matchIndex >= 0) {
      bodyHits.push({ absPath, kind: 'body', snippet: makeBodySnippet(entry.bodyTextLower, matchIndex, q.length) });
    }
  }

  return [...indextermHits, ...bodyHits];
}

/**
 * Docsite mode's full-book search UI: a toolbar button that toggles a
 * small panel with a query input and a results list. Deliberately a
 * simple first version (docsite design doc, 6.3: exact placement/styling
 * is left to iterate on once it's visible on a real machine) -- no
 * highlighting, no keyboard navigation between results, no dismiss-on-
 * outside-click yet.
 *
 * Same unconditional-build/caller-decides-append convention as
 * getSitePrevNextButtonsScript etc. in ditaRenderUtils.ts: this only
 * builds bookSearchBtn (for the toolbar) and appends bookSearchPanel to
 * document.body itself (a fixed-position overlay needs to escape the
 * toolbar's own layout, unlike a plain button). Assumes `btnStyle`
 * (getToolbarScaffoldScript) and `switchToSitePage`
 * (getSiteNavClickHandlerScript) are already in scope, same as this
 * project's other site-mode-only script generators.
 */
export function getBookSearchScript(opts: {
  buttonTitle: string;
  placeholder: string;
  noResultsLabel: string;
  requestMsgType: string;
  responseMsgType: string;
}): string {
  const buttonTitle = JSON.stringify(opts.buttonTitle);
  const placeholder = JSON.stringify(opts.placeholder);
  const noResultsLabel = JSON.stringify(opts.noResultsLabel);
  return `
  var bookSearchBtn = document.createElement('button');
  bookSearchBtn.id = '__site-search-btn';
  bookSearchBtn.innerHTML = '&#x1F50D;';
  bookSearchBtn.title = ${buttonTitle};
  bookSearchBtn.setAttribute('aria-label', ${buttonTitle});
  bookSearchBtn.style.cssText = btnStyle;

  var bookSearchPanel = document.createElement('div');
  bookSearchPanel.id = '__site-search-panel';
  bookSearchPanel.style.cssText = 'display:none;position:fixed;top:36px;right:12px;z-index:50;width:320px;max-height:60vh;overflow:auto;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);border:1px solid var(--vscode-panel-border);border-radius:4px;padding:8px;box-shadow:0 2px 8px rgba(0,0,0,0.25);';

  var bookSearchInput = document.createElement('input');
  bookSearchInput.type = 'text';
  bookSearchInput.placeholder = ${placeholder};
  bookSearchInput.style.cssText = 'width:100%;box-sizing:border-box;padding:4px 6px;margin-bottom:6px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:2px;';
  bookSearchPanel.appendChild(bookSearchInput);

  var bookSearchResults = document.createElement('div');
  bookSearchPanel.appendChild(bookSearchResults);

  bookSearchBtn.addEventListener('click', function() {
    var willShow = bookSearchPanel.style.display === 'none';
    bookSearchPanel.style.display = willShow ? 'block' : 'none';
    if (willShow) bookSearchInput.focus();
  });

  // Debounced -- a query is sent to the extension host (which builds/reuses
  // the lazy index; see getBookSearchIndex) at most once per pause in
  // typing, not once per keystroke.
  var bookSearchDebounce = null;
  bookSearchInput.addEventListener('input', function() {
    if (bookSearchDebounce) clearTimeout(bookSearchDebounce);
    var q = bookSearchInput.value;
    bookSearchDebounce = setTimeout(function() {
      vscode.postMessage({ type: '${opts.requestMsgType}', query: q });
    }, 200);
  });

  window.addEventListener('message', function(e) {
    if (e.data.type !== '${opts.responseMsgType}') return;
    var results = e.data.results || [];
    bookSearchResults.innerHTML = '';
    if (results.length === 0) {
      var empty = document.createElement('div');
      empty.textContent = ${noResultsLabel};
      empty.style.cssText = 'opacity:0.7;padding:4px 2px;';
      bookSearchResults.appendChild(empty);
      return;
    }
    results.forEach(function(r) {
      var item = document.createElement('div');
      item.style.cssText = 'padding:4px 2px;cursor:pointer;border-bottom:1px solid var(--vscode-panel-border);';
      var titleEl = document.createElement('div');
      // U+1F4D1 (bookmark tabs) matches the indexterm chip's own marker
      // (renderIndextermChip in baseTypeMap.ts) -- same visual language
      // for \"this came from an index entry\" wherever it shows up.
      titleEl.textContent = (r.kind === 'indexterm' ? '\\u{1F4D1} ' : '') + r.title;
      titleEl.style.cssText = 'font-weight:600;';
      var snippetEl = document.createElement('div');
      snippetEl.textContent = r.snippet;
      snippetEl.style.cssText = 'opacity:0.75;font-size:0.9em;';
      item.appendChild(titleEl);
      item.appendChild(snippetEl);
      item.addEventListener('click', function() {
        var navLinks = document.querySelectorAll('.site-nav-link');
        for (var i = 0; i < navLinks.length; i++) {
          if (navLinks[i].getAttribute('data-site-target') === r.absPath) {
            switchToSitePage(navLinks[i]);
            break;
          }
        }
        bookSearchPanel.style.display = 'none';
      });
      bookSearchResults.appendChild(item);
    });
  });
`;
}
