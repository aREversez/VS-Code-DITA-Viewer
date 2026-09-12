import * as vscode from 'vscode';
import { parseDitamap, preprocessEntities } from '../parser/ditaParser';
import { renderMapDocument, collectMapEntries } from '../render/mapTypeMap';
import { renderBookParts, wrapBookParts, escapeHtml, escapeAttr, expandDitamapRefs, getSearchOverlayScript, getProfilingFilterScript, getToolbarScaffoldScript, getFontPrefsScript, getToolbarFontWidthTagTooltipsButtonsScript, decodeHrefPart, buildBookNavManifest, renderSiteNavHtml, getSiteNavClickHandlerScript, getSitePrevNextButtonsScript, getSiteSidebarToggleScript, getModeToggleScript, getSiteSidebarResizerScript, renderTopicCached, makeFileTitleResolver, makeFileTopicTypeResolver, DocsiteNavEntry } from './ditaRenderUtils';
import { getBookSearchIndex, searchBookIndex, getBookSearchScript, invalidateBookSearchIndex } from './bookSearchIndex';
import { acquireDitaFileWatcher, ditaWatchBase } from './ditaFileWatcher';
import { diffBookParts, BookPart } from './bookPatch';
import { foldPendingRender, PendingRender } from './pendingRender';
import { sharedWebviewStrings } from './webviewL10n';
import { buildKeyMap, FONT_PREFS_KEY, DEFAULT_FONT_PREFS, WIDTH_SELECTION_KEY, TAG_TOOLTIPS_KEY, DEFAULT_TAG_TOOLTIPS, escapeJson } from './DitaViewerProvider';
import { formatLocalizedRole } from '../language/bookRoleL10n';
import { dirname, join, resolve } from 'path';
import { randomBytes } from 'crypto';

// Test-only hook: see the identical comment in DitaViewerProvider.ts.
const lastRenderedHtmlByUri = new Map<string, string>();

export function getLastRenderedMapHtmlForTesting(uriString: string): string | undefined {
  return lastRenderedHtmlByUri.get(uriString);
}

/**
 * Clears the cached rendered map HTML. Entries are already removed
 * individually as each webview panel disposes; this is a defensive full
 * reset for extension deactivation, not a fix for an actual leak. Called
 * from clearAllCaches() in DitaViewerProvider.ts via extension.ts's
 * deactivate().
 */
export function clearMapCache(): void {
  lastRenderedHtmlByUri.clear();
}

// The content-update protocol between this provider and its webview script.
//
// Both sides live in this file, but the script side is a string, so no
// compiler and no test can see that the two spellings of a message type agree.
// A typo on either side fails silently and looks exactly like "the preview
// stopped updating on edit" -- and patchContent is the worse case, since the
// webview would ignore every patch and the document would simply go stale.
// Interpolating one constant into both sides makes that unrepresentable
// rather than tested. The script's other message types (openTopic,
// switchMode, refresh) are left as literals: they are outside this change,
// and each one's failure is visible rather than silent.
const MSG_UPDATE_CONTENT = 'updateContent';
const MSG_PATCH_CONTENT = 'patchContent';
const MSG_REQUEST_FULL_RENDER = 'requestFullRender';
// Same treatment, same reason: a mismatch here is silent rather than loud --
// the button still changes document.body's style locally either way, so the
// only symptom of a typo is that the choice quietly fails to survive closing
// the panel, which is exactly the bug this pair of message types exists to
// fix (see FONT_PREFS_KEY / WIDTH_SELECTION_KEY above).
const MSG_SET_FONT_PREFS = 'setFontPrefs';
const MSG_SET_WIDTH_SELECTION = 'setWidthSelection';
// Same reasoning again -- see TAG_TOOLTIPS_KEY in DitaViewerProvider.ts for
// why this is a global, shared-with-the-topic-viewer preference.
const MSG_SET_TAG_TOOLTIPS = 'setTagTooltips';
// webview -> host only, no counterpart-typo risk on the other side to guard
// against (nothing else reads this literal), so it stays a plain constant
// rather than getting the MSG_UPDATE_CONTENT treatment above.
const MSG_SWITCH_SITE_PAGE = 'switchSitePage';
// Full-book search (docsite design doc, 4.4) -- webview -> host request and
// host -> webview response, same pairing convention as MSG_UPDATE_CONTENT
// above (both spellings live in this one file already, but the pair is
// still named/interpolated together rather than left as two independent
// literals, since a mismatch here would silently mean search never shows
// results instead of failing loudly).
const MSG_BOOK_SEARCH = 'bookSearch';
const MSG_BOOK_SEARCH_RESULTS = 'bookSearchResults';

// Localized topic-type labeler for the docsite sidebar's per-entry chip:
// every known DITA topic specialization gets a localized short label
// ("Concept"/"概念", "Task"/"任务", …), and the generic `<topic>` root
// returns undefined so a plain map full of `<topic>` files doesn't get a
// row of identical "Topic" chips with no information. Passed to
// makeFileTopicTypeResolver, which calls it with the topic file's root
// tag name (sniffed off the front of the file, not fully parsed -- see
// that function's own comment). Mirrors formatLocalizedRole's own
// contract (see bookRoleL10n.ts): the render layer stays pure, VS Code
// callers inject translated display text.
const TOPIC_TYPE_LABELS: Record<string, () => string> = {
  concept: () => vscode.l10n.t('Concept'),
  task: () => vscode.l10n.t('Task'),
  reference: () => vscode.l10n.t('Reference'),
  troubleshooting: () => vscode.l10n.t('Troubleshooting'),
  glossentry: () => vscode.l10n.t('Glossary Entry'),
  glossgroup: () => vscode.l10n.t('Glossary Group'),
};
function localizeTopicTypeLabel(tagName: string): string | undefined {
  if (!tagName || tagName === 'topic') return undefined;
  const factory = TOPIC_TYPE_LABELS[tagName];
  if (factory) return factory();
  // Unknown specializations (custom domains, future DITA modules) fall
  // back to a capitalized tag name rather than disappearing entirely --
  // the chip's whole point is to show *something* the reader can scan,
  // and "this is an unfamiliar type" is still more useful than nothing.
  return tagName.charAt(0).toUpperCase() + tagName.slice(1);
}

function getMapWebviewScript(): string {
  const L = {
    // Everything the single-topic preview's toolbar says too: the toolbar
    // label, the font and page-width controls, the Flags toggle, and the
    // option sets for both overlays. Kept in one table so the two previews
    // cannot drift apart on a control they share -- see webviewL10n.ts. What
    // follows is wording that exists only here.
    ...sharedWebviewStrings(),
    // The outline/book switch has no counterpart in the single-topic preview,
    // which only ever shows one topic.
    switchModeTitle: vscode.l10n.t('Switch between outline tree, full book view and docsite view'),
    modeOutline: vscode.l10n.t('Outline'),
    modeBook: vscode.l10n.t('Book'),
    modeSite: vscode.l10n.t('Site'),
    sitePrevTopic: vscode.l10n.t('Previous topic'),
    siteNextTopic: vscode.l10n.t('Next topic'),
    siteToggleSidebar: vscode.l10n.t('Show/hide topic list'),
    siteSearchTitle: vscode.l10n.t('Search this book'),
    siteSearchPlaceholder: vscode.l10n.t('Search all topics...'),
    siteSearchNoResults: vscode.l10n.t('No matches found'),
    siteSearchRefresh: vscode.l10n.t('Refresh search results'),
    siteSearchClear: vscode.l10n.t('Clear search'),
  };
  return `
(function() {
  var vscode = acquireVsCodeApi();
  // The whole HTML document is regenerated on every mode switch, so derive
  // the current mode from the body class instead of a hardcoded default —
  // otherwise the script's state resets to 'tree' while the extension is in
  // 'book' mode and the toggle can never switch back.
  var currentMode = document.body.classList.contains('mode-book') ? 'book'
    : document.body.classList.contains('mode-site') ? 'site' : 'tree';

  ${getSiteNavClickHandlerScript({ switchSitePageMsgType: MSG_SWITCH_SITE_PAGE })}
  ${getSiteSidebarResizerScript()}

  // Click on navigable tree node → post message to extension
  document.addEventListener('click', function(e) {
    var link = e.target.closest ? e.target.closest('.map-tree-link') : null;
    if (!link) return;
    e.preventDefault();
    var href = link.getAttribute('data-href');
    if (href) {
      vscode.postMessage({ type: 'openTopic', href: href });
    }
  });

  // Toolbar (same pattern as DITA viewer)
  ${getToolbarScaffoldScript({ previewToolbar: L.previewToolbar })}

  // Font size, typeface and page width are read back from the bootstrap
  // script (window.__fontPrefs / window.__widthSelection, set in
  // generateHtml from the same globalState keys the topic viewer reads --
  // see FONT_PREFS_KEY and WIDTH_SELECTION_KEY in DitaViewerProvider.ts) and
  // written back through postMessage on every change, exactly as the topic
  // viewer's own toolbar does. Until this, the three controls here changed
  // only document.body's inline style: nothing read them back on open and
  // nothing told the extension they had changed, so a size, typeface or
  // width picked in a map preview was gone the moment the panel closed.
  ${getFontPrefsScript({ setFontPrefsMsgType: MSG_SET_FONT_PREFS })}

  ${getToolbarFontWidthTagTooltipsButtonsScript({
    decreaseFontSize: L.decreaseFontSize,
    increaseFontSize: L.increaseFontSize,
    fontSans: L.fontSans,
    fontSerif: L.fontSerif,
    fontCurrentSans: L.fontCurrentSans,
    fontCurrentSerif: L.fontCurrentSerif,
    fontSizeButtonExtraStyle: '',
    includeFontReset: false,
    widthAuto: L.widthAuto,
    widthFull: L.widthFull,
    widthWide: L.widthWide,
    widthDesktop: L.widthDesktop,
    widthNarrow: L.widthNarrow,
    pageWidth: L.pageWidth,
    setWidthSelectionMsgType: MSG_SET_WIDTH_SELECTION,
    tagTooltipsLabel: L.tagTooltipsLabel,
    tagTooltipsOnTitle: L.tagTooltipsOnTitle,
    tagTooltipsOffTitle: L.tagTooltipsOffTitle,
    setTagTooltipsMsgType: MSG_SET_TAG_TOOLTIPS,
  })}
  toolbar.appendChild(fsDown);
  toolbar.appendChild(fsUp);
  toolbar.appendChild(fontBtn);
  toolbar.appendChild(wSel);

  // Sidebar collapse toggle -- docsite mode only, same unconditional-build/
  // conditional-append convention as the prev/next buttons right below.
  // The sidebar itself starts open (see body's own class construction: no
  // site-nav-collapsed by default); this is how a reader tucks the topic
  // list away once they don't need it, and gets it back the same way.
  ${getSiteSidebarToggleScript({ toggleTitle: L.siteToggleSidebar })}
  if (currentMode === 'site') {
    toolbar.appendChild(siteSidebarToggleBtn);
  }

  // Prev/next topic buttons -- docsite mode only. Built unconditionally
  // (same pattern the shared font/width buttons above already use: both
  // providers always create the full shared button set, then each decides
  // what to append) but only appended in site mode; updatePrevNextButtons
  // (getSiteNavClickHandlerScript) already no-ops when it can't find these
  // by id, which is exactly what happens if they were never appended.
  ${getSitePrevNextButtonsScript({
    prevLabel: '\u2039',
    prevTitle: L.sitePrevTopic,
    nextLabel: '\u203a',
    nextTitle: L.siteNextTopic,
  })}
  if (currentMode === 'site') {
    toolbar.appendChild(sitePrevBtn);
    toolbar.appendChild(siteNextBtn);
  }

  // Full-book search -- docsite mode only (docsite design doc, 4.4,
  // revised to live in the sidebar rather than a toolbar button after
  // first-look feedback -- see getBookSearchScript's own doc comment for
  // why). A topic-level, DOM-only search already exists
  // (getSearchOverlayScript, Ctrl+F) and needs no change here: it already
  // works per-page for free in site mode, and getBookSearchScript hands
  // off to it directly to actually highlight a picked result rather than
  // duplicating that mechanism. This is the separate, whole-book version,
  // backed by the lazy per-book text index built on the extension host
  // side (see bookSearchIndex.ts). getBookSearchScript inserts itself
  // into .site-nav directly (a no-op if that element does not exist, i.e.
  // tree/book mode), so there is no toolbar wiring needed here at all.
  ${getBookSearchScript({
    searchLabel: L.siteSearchTitle,
    placeholder: L.siteSearchPlaceholder,
    noResultsLabel: L.siteSearchNoResults,
    matchCaseLabel: L.searchMatchCase,
    useRegexLabel: L.searchUseRegex,
    invalidRegexLabel: L.searchInvalidRegex,
    refreshLabel: L.siteSearchRefresh,
    clearLabel: L.siteSearchClear,
    requestMsgType: MSG_BOOK_SEARCH,
    responseMsgType: MSG_BOOK_SEARCH_RESULTS,
  })}

  // Tag-name tooltip toggle -- same feature and same persisted preference
  // as the topic viewer's own (see TAG_TOOLTIPS_KEY in
  // DitaViewerProvider.ts). Book mode renders each topic through the same
  // renderTopicCached()/renderer.ts pipeline, so the same data-dita-tagname
  // attributes are already present here; this toggle is the only piece
  // that was missing.
  toolbar.appendChild(tagTooltipsBtn);

  // Mode toggle button. Cycles tree -> book -> site -> tree; the label
  // always names the CURRENT mode (see getModeToggleScript's own comment
  // for why).
  ${getModeToggleScript({
    switchModeTitle: L.switchModeTitle,
    modeOutline: L.modeOutline,
    modeBook: L.modeBook,
    modeSite: L.modeSite,
    switchModeMsgType: 'switchMode',
  })}
  toolbar.appendChild(modeBtn);

  // Profiling / conditional-attribute highlight toggle, same as the topic
  // viewer's Flags button -- purely a CSS class flip (body.hide-profiling),
  // no re-render needed. Defaults on for the same reason: the point is
  // surfacing what's flagged without the person having to discover the
  // toggle first.
  var profilingOn = true;
  var profilingBtn = document.createElement('button');
  profilingBtn.textContent = ${L.profilingLabel};
  profilingBtn.style.cssText = btnStyle + 'font-size:11px;';
  function applyProfilingToggle() {
    document.body.classList.toggle('hide-profiling', !profilingOn);
    profilingBtn.style.background = profilingOn ? 'var(--color-profiling-label-bg)' : '';
    profilingBtn.style.color = profilingOn ? 'var(--color-profiling-label-text)' : '';
    profilingBtn.title = profilingOn ? ${L.profilingOnTitle} : ${L.profilingOffTitle};
    profilingBtn.setAttribute('aria-label', profilingOn ? ${L.profilingOnTitle} : ${L.profilingOffTitle});
  }
  profilingBtn.addEventListener('click', function() {
    profilingOn = !profilingOn;
    applyProfilingToggle();
  });
  applyProfilingToggle();
  toolbar.appendChild(profilingBtn);

  // Filter button goes immediately next to Flags, same pairing as the
  // topic viewer -- in Outline mode this hides whole map entries by their
  // topicref-level profiling; in Book mode there's no topicref-level
  // profiling to speak of (see MapViewerProvider.collectBookParts), only
  // whatever profiled spans exist inside each composited topic's own
  // content, same as opening that topic directly.
  ${getProfilingFilterScript({
    buttonLabel: L.filterLabel,
    buttonTitle: L.filterTitle,
    closeLabel: L.filterClose,
    emptyLabel: L.filterEmpty,
  })}

  // Refresh button
  var refreshBtn = document.createElement('button');
  refreshBtn.innerHTML = '&#x21bb;';
  refreshBtn.title = ${L.reloadContent};
  refreshBtn.setAttribute('aria-label', ${L.reloadContent});
  refreshBtn.style.cssText = btnStyle;
  refreshBtn.addEventListener('click', function() { vscode.postMessage({ type: 'refresh' }); });
  toolbar.appendChild(refreshBtn);

  document.body.appendChild(toolbar);

  ${getSearchOverlayScript({
    placeholder: L.searchPlaceholder,
    nextMatch: L.searchNext,
    prevMatch: L.searchPrev,
    close: L.searchClose,
    matchCase: L.searchMatchCase,
    useRegex: L.searchUseRegex,
    invalidRegex: L.searchInvalidRegex,
  })}

  // Every source edit (a topicref's profiling attributes, reordering
  // entries, ...) sends just the freshly rendered content as a message
  // instead of the extension reassigning webview.html wholesale -- see
  // postContentUpdate in MapViewerProvider.ts for why (same reasoning as
  // the topic viewer's own content-only update). Content-dependent setup
  // that only ran once at initial load, because a full reload used to
  // rerun this entire script from scratch every time, needs to re-run
  // after each swap instead. Map view has no per-image zoom toolbar and
  // no source-editor scroll-sync of its own to re-apply (unlike the topic
  // viewer), so this is a shorter list.
  //
  // Both content paths call this. Patching a handful of entries leaves the
  // same kind of stale state behind as replacing all of them: profiling
  // decisions computed over DOM that has since been swapped, and search
  // highlights holding references to nodes that are no longer attached.
  function afterContentSwap() {
    if (typeof pfApplyFilter === 'function') pfApplyFilter();
    if (typeof pfPanel !== 'undefined' && pfPanel) {
      pfPanel.remove();
      pfPanel = pfBuildPanel();
      document.body.appendChild(pfPanel);
    }
    if (typeof sb !== 'undefined' && sb.style.display !== 'none' && searchInput.value) {
      performSearch(searchInput.value);
    }
    // Off (the default) needs no walk: fresh HTML, whether this is a full
    // replace or bookPatch.ts's per-entry patch, only ever carries
    // data-dita-tagname, never a stray title= from this feature.
    if (tagTooltipsOn) applyTagTooltips();
  }

  window.addEventListener('message', function(e) {
    if (e.data.type === '${MSG_UPDATE_CONTENT}') {
      var contentRoot = document.getElementById('dita-content-root');
      if (contentRoot) {
        contentRoot.innerHTML = e.data.html;
        afterContentSwap();
        // Site mode's book-internal xref jump (docsite design doc,
        // 3.2/4.5): switchToSitePage stashed the target anchor before the
        // page-switch postMessage, since the element it names doesn't
        // exist until this new HTML lands. A plain sidebar/prev-next
        // switch never sets this, so it's a no-op there.
        if (currentMode === 'site' && pendingSiteAnchor) {
          scrollToSiteAnchor(pendingSiteAnchor);
          pendingSiteAnchor = null;
        }
        // Full-book search result jump (bookSearchIndex.ts): a result
        // click on a DIFFERENT page stashed the query + case/regex flags
        // here rather than applying them immediately, since the page
        // search overlay needs this page's own content in the DOM before
        // performSearch can find anything to highlight.
        if (currentMode === 'site' && pendingSiteSearchHighlight) {
          bsApplyPageSearch(pendingSiteSearchHighlight);
          pendingSiteSearchHighlight = null;
        }
      }
    } else if (e.data.type === '${MSG_PATCH_CONTENT}') {
      // Book mode's incremental update: replace only the entries whose HTML
      // actually changed, so every other entry keeps its element -- and with
      // it anything the browser had derived per element: its scroll anchor, its
      // decoded images, its remembered size. See bookPatch.ts.
      //
      // The indices address positions among .ditamap-book's children, and
      // that only denotes the same entry on both sides for as long as the DOM
      // here and the list the extension diffed against are the same length.
      // If they are not -- a webview reload this provider instance never saw,
      // a message that landed after a mode switch -- patching would write
      // entries into the wrong places, silently and visibly. Ask for the
      // whole document instead; requestFullRender is handled extension-side.
      var book = document.querySelector('#dita-content-root > .ditamap-book');
      if (!book || book.children.length !== e.data.count) {
        vscode.postMessage({ type: '${MSG_REQUEST_FULL_RENDER}' });
        return;
      }
      var updates = e.data.updates;
      for (var i = 0; i < updates.length; i++) {
        var entry = book.children[updates[i].index];
        // Every part is exactly one root element (see BookPart.html), so this
        // swaps one child for one child and all the later indices stay valid.
        if (entry) entry.outerHTML = updates[i].html;
      }
      afterContentSwap();
    }
  });
})();
`;
}

export class MapViewerProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const documentRoot = vscode.Uri.file(dirname(document.uri.fsPath));
    // Per-panel mode state (not global)
    let currentMode: 'tree' | 'book' | 'site' = 'tree';
    // Which topic (absolute path) docsite mode is currently showing --
    // undefined before the first site-mode render, which falls back to the
    // nav manifest's first entry (see generateHtml's site-mode branch).
    let currentSitePage: string | undefined;
    // Populated by every full site-mode render (updateWebview), consumed by
    // postSitePageUpdate so a page-switch click reuses the already-built
    // manifest/keyMap instead of re-parsing the whole map and re-reading
    // every un-navtitled topic's <title> off disk again on every click --
    // see postSitePageUpdate's own comment. Self-heals: postContentUpdate's
    // site-mode branch always falls back to a full updateWebview() on a
    // source edit (never a content-only message in site mode), which
    // repopulates this: there is no separate invalidation path to keep in
    // sync by hand.
    let siteManifestCache: { manifest: DocsiteNavEntry[]; keyMap: Map<string, string>; bookMembers: ReadonlySet<string> } | undefined;

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(this.context.extensionPath),
        documentRoot,
        ...(vscode.workspace.workspaceFolders || []).map((f) => f.uri),
      ],
    };

    webviewPanel.webview.onDidReceiveMessage((message) => {
      if (message.type === 'refresh') {
        requestUpdate('full');
      } else if (message.type === 'openTopic') {
        const href = message.href as string;
        if (!href) return;
        const mapDir = dirname(document.uri.fsPath);
        const filePart = decodeHrefPart(href.split('#')[0]);
        const targetPath = resolve(mapDir, filePart);
        const targetUri = vscode.Uri.file(targetPath);
        // Decide the viewer by the file part only — "sub.ditamap#id" must
        // still open in the map preview.
        const viewType = filePart.toLowerCase().endsWith('.ditamap') ? 'ditaViewer.mapPreview' : 'ditaViewer.preview';
        vscode.commands.executeCommand('vscode.openWith', targetUri, viewType);
      } else if (message.type === 'switchMode') {
        currentMode = message.mode as 'tree' | 'book' | 'site';
        requestUpdate('full');
      } else if (message.type === MSG_SWITCH_SITE_PAGE) {
        const target = message.target as string;
        if (!target || target === currentSitePage) return;
        currentSitePage = target;
        postSitePageUpdate();
      } else if (message.type === MSG_BOOK_SEARCH) {
        // Reuses siteManifestCache when it is already warm (the common
        // case: the person opened site mode, which is the only mode this
        // search box exists in, before ever touching it) rather than
        // re-parsing the map -- same rationale as postSitePageUpdate's own
        // reuse of it. getBookSearchIndex is its own separate lazy cache on
        // top of that (docsite design doc, 3.1): the manifest gives it
        // which topics to index, but the actual per-topic text extraction
        // only happens once per book per edit, not once per keystroke.
        const query = typeof message.query === 'string' ? message.query : '';
        const searchOptions = {
          caseSensitive: message.caseSensitive === true,
          useRegex: message.useRegex === true,
        };
        let site = siteManifestCache;
        if (!site) {
          const built = this.buildSiteManifest(document);
          site = built.error !== undefined ? undefined : { manifest: built.manifest, keyMap: built.keyMap, bookMembers: built.bookMembers };
        }
        if (!site) {
          webviewPanel.webview.postMessage({ type: MSG_BOOK_SEARCH_RESULTS, results: [] });
          return;
        }
        const searchDocDir = dirname(document.uri.fsPath);
        // The manual refresh button (getBookSearchScript's bsRefreshBtn):
        // getBookSearchIndex's own mtime-based staleness check already
        // catches an edited topic on its own, so this only matters for
        // the reassurance case of forcing a rebuild anyway.
        if (message.refresh === true) invalidateBookSearchIndex(searchDocDir);
        const searchIndex = getBookSearchIndex(searchDocDir, site.manifest);
        const outcome = searchBookIndex(searchIndex, query, site.manifest.map((m) => m.absPath), searchOptions);
        if (outcome.error) {
          webviewPanel.webview.postMessage({ type: MSG_BOOK_SEARCH_RESULTS, results: [], error: outcome.error });
          return;
        }
        const titleByPath = new Map(site.manifest.map((m) => [m.absPath, m.title] as const));
        // Capped rather than sent in full: a broad query against a very
        // large book could otherwise match most of it, and the panel
        // (docsite design doc, 6.3: a simple first version) has no
        // pagination -- a long but bounded list is more useful than either
        // an unbounded one or truncating silently with no signal at all.
        const results = outcome.hits.slice(0, 30).map((h) => ({
          absPath: h.absPath,
          title: titleByPath.get(h.absPath) ?? h.absPath,
          kind: h.kind,
          snippet: h.snippet,
        }));
        webviewPanel.webview.postMessage({ type: MSG_BOOK_SEARCH_RESULTS, results });
      } else if (message.type === MSG_REQUEST_FULL_RENDER) {
        // The webview declined a patch: its DOM does not match the baseline
        // the indices were computed against. Straight to updateWebview rather
        // than requestUpdate('full') -- the panel is visible by definition, a
        // hidden webview is not running the script that sent this -- and a
        // full render also resets lastBookParts to the document just sent,
        // which is what makes the next patch trustworthy again.
        updateWebview();
      } else if (message.type === MSG_SET_FONT_PREFS) {
        // Same key the topic viewer writes (FONT_PREFS_KEY, imported from
        // DitaViewerProvider.ts) -- font size and typeface describe how the
        // person likes to read, not which provider is showing them the
        // document, so one preference for both rather than a second copy
        // that could silently disagree with it.
        const size = typeof message.size === 'number' ? message.size : DEFAULT_FONT_PREFS.size;
        const serif = message.serif === true;
        this.context.globalState.update(FONT_PREFS_KEY, { size, serif });
      } else if (message.type === MSG_SET_WIDTH_SELECTION) {
        // Same map the topic viewer keeps (WIDTH_SELECTION_KEY), keyed by
        // this document's own uri -- a ditamap's uri cannot collide with a
        // topic's, so the two providers sharing the map costs nothing.
        if (typeof message.value === 'string') {
          const map = this.context.globalState.get<Record<string, string>>(WIDTH_SELECTION_KEY, {});
          map[document.uri.toString()] = message.value;
          this.context.globalState.update(WIDTH_SELECTION_KEY, map);
        }
      } else if (message.type === MSG_SET_TAG_TOOLTIPS) {
        this.context.globalState.update(TAG_TOOLTIPS_KEY, message.value === true);
      }
    });

    let disposed = false;
    let renderDebounceTimer: ReturnType<typeof setTimeout> | undefined;
    // The render a currently-hidden panel is owed, if any. 'content' is a
    // source edit, satisfied by postContentUpdate; 'full' is a theme switch,
    // manual refresh or tree/book mode toggle, each of which has to reassign
    // webview.html -- the light/dark class lives on <html>, outside the
    // content div a content-only update touches, and a mode switch replaces
    // the whole document rather than patching it. Escalates only -- a theme
    // switch landing while an edit is already pending must not be
    // downgraded, or the class stays stale until some later re-render. The
    // fold itself lives in pendingRender.ts -- see foldPendingRender -- so
    // the rule is pinned by a unit test rather than only by this comment.
    let pendingUpdate: PendingRender = 'none';
    // The parts behind whatever this panel's webview is showing in book mode
    // -- the baseline the next render gets diffed against (bookPatch.ts).
    // A local, not a field, for the same reason pendingUpdate is: one
    // MapViewerProvider instance resolves every map panel in the window, so a
    // field would have two panels diffing against each other's documents.
    // undefined means "no idea what is on screen", which is the state before
    // the first render, after any full page render in tree mode, and after a
    // render error -- all of which must fall back to sending the document.
    let lastBookParts: BookPart[] | undefined;
    const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
      renderDebounceTimer = setTimeout(() => requestUpdate('content'), 300);
    });

    // Same rationale as DitaViewerProvider's referencedFilesWatcher: a
    // ditamap's topicrefs/keydefs/maprefs and each inlined topic's own
    // conref/image references routinely point outside this document, so
    // only watching this document itself (above) misses edits to the very
    // files book/outline mode is built from. Watches the containing
    // workspace folder broadly rather than the resolved reference set for
    // the same reason given there, and shares that folder's watcher with
    // every other panel and with the map tree -- a map open beside three
    // topic previews is one watcher serving four consumers, not four
    // watchers. See ditaFileWatcher.ts.
    const referencedFilesWatcher = acquireDitaFileWatcher(ditaWatchBase(document.uri), (event) => {
      if (disposed) return;
      if (event.uri.toString() === document.uri.toString()) return; // already handled above
      if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
      renderDebounceTimer = setTimeout(() => requestUpdate('content'), 300);
    });

    // Re-render on theme switch so the manually-computed light/dark class
    // never goes stale relative to the actual active theme. A genuine full
    // reload, unlike postContentUpdate below -- the class lives on <html>,
    // outside the content div a content-only update touches.
    const themeSubscription = vscode.window.onDidChangeActiveColorTheme(() => {
      requestUpdate('full');
    });

    const updateWebview = async () => {
      if (disposed) return;
      if (currentMode === 'book') {
        // collectBookParts/wrapBookParts below assembles every referenced
        // topic into one document synchronously on the extension host --
        // see scripts/bench-book-render.js for how long that can actually
        // take on a large book. Without a placeholder the panel just sits
        // however it last looked (or blank, on first switch into book
        // mode) for the whole stretch, which reads as the extension having
        // hung rather than as work in progress.
        webviewPanel.webview.html = this.generateLoadingHtml(webviewPanel.webview);
        // Yield one tick so the webview process actually receives and
        // paints the placeholder before the synchronous render below
        // monopolizes the extension host's single JS thread.
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (disposed) return;
      }
      const rendered = this.generateHtml(document, webviewPanel.webview, currentMode, currentSitePage);
      webviewPanel.webview.html = rendered.html;
      lastRenderedHtmlByUri.set(document.uri.toString(), rendered.html);
      // Reassigning webview.html replaces the DOM outright, so the baseline
      // becomes whatever this render produced -- including nothing at all in
      // tree mode and on the error page, where there are no parts to diff.
      lastBookParts = rendered.parts;
      // Site mode may have fallen back to the manifest's first entry (no
      // hint yet, or the hint no longer names a topic this map has) --
      // adopt whatever it actually rendered, so the next page-switch click
      // and the next full re-render agree on what is currently on screen.
      if (rendered.resolvedSitePage !== undefined) currentSitePage = rendered.resolvedSitePage;
      siteManifestCache = rendered.siteManifest
        ? { manifest: rendered.siteManifest, keyMap: rendered.siteKeyMap!, bookMembers: rendered.siteBookMembers! }
        : undefined;
    };

    // Docsite mode's page-switch path: unlike postContentUpdate below (a
    // source edit, which can land in any mode), this only ever fires from
    // the site-mode sidebar's own click handler, so there is no tree/book
    // case to fall through to -- just render the newly-selected topic and
    // send it as a content-only update. The sidebar itself is untouched:
    // its own click handler already flipped the active class client-side
    // before this message was even sent (see getMapWebviewScript).
    //
    // Reuses siteManifestCache (populated by the last full updateWebview()
    // render) rather than re-parsing the map and rebuilding the manifest --
    // which, for any topic the map itself never gave a navtitle, means
    // re-reading that topic's <title> off disk -- on every single click.
    // buildSiteManifest(document) is still here as a defensive fallback for
    // the case postSitePageUpdate somehow fires with no prior full render
    // (shouldn't happen: entering site mode always goes through
    // updateWebview first), not the normal path.
    const postSitePageUpdate = () => {
      if (disposed) return;
      let site = siteManifestCache;
      if (!site) {
        const built = this.buildSiteManifest(document);
        site = built.error !== undefined ? undefined : { manifest: built.manifest, keyMap: built.keyMap, bookMembers: built.bookMembers };
      }
      if (!site || site.manifest.length === 0) {
        updateWebview(); // show whatever error/empty state a full render produces
        return;
      }
      const resolvedSitePage = currentSitePage && site.manifest.some((m) => m.absPath === currentSitePage)
        ? currentSitePage
        : site.manifest[0].absPath;
      currentSitePage = resolvedSitePage;
      const topic = this.renderSiteTopicContent(resolvedSitePage, webviewPanel.webview, site.keyMap, site.bookMembers);
      if (topic.error !== undefined) {
        updateWebview();
        return;
      }
      webviewPanel.webview.postMessage({ type: MSG_UPDATE_CONTENT, html: topic.html });
    };

    // The common case: a regular source edit (topicref profiling, adding/
    // reordering entries, ...). Sends just the freshly rendered content as
    // a message instead of reassigning webview.html -- same reasoning, and
    // the same fix, as DitaViewerProvider.ts's postContentUpdate: no full
    // page reload means no images re-requesting/re-decoding, no scroll
    // position lost, and nothing for an in-flight scroll correction to
    // race against. Falls back to a full reload only if rendering itself
    // failed, to show the error page.
    const postContentUpdate = () => {
      if (disposed) return;
      if (currentMode === 'site') {
        // A source edit can rename a topicref's navtitle, add/remove/reorder
        // entries, or change which topic a keyref-driven title resolves to
        // -- all sidebar changes, not just content-pane ones. The sidebar
        // lives outside #dita-content-root (postSitePageUpdate's own
        // content-only message only ever touches that div), so a content-
        // only update here would leave it showing stale topics/titles.
        // Correctness over avoiding a reload for this one case; postponing
        // the same optimization postSitePageUpdate already does for actual
        // page switches is a smaller, separate follow-up.
        updateWebview();
        return;
      }
      const result = this.renderMapContent(document, webviewPanel.webview, currentMode);
      if (result.error !== undefined) {
        updateWebview();
        return;
      }
      const parts = result.parts;
      // Tree mode produces no parts and keeps sending its whole (small)
      // content div, exactly as before.
      if (!parts) {
        webviewPanel.webview.postMessage({ type: MSG_UPDATE_CONTENT, html: result.html });
        return;
      }
      const patch = diffBookParts(lastBookParts, parts);
      // Recorded before sending: the baseline describes what the webview will
      // be showing once this message lands, whichever branch it takes.
      lastBookParts = parts;
      if (patch.kind === 'none') return;
      if (patch.kind === 'patch') {
        // count rides along so the webview can decline to patch a document it
        // knows is not the one these indices were computed against, and ask
        // for a full render instead.
        webviewPanel.webview.postMessage({
          type: MSG_PATCH_CONTENT,
          count: parts.length,
          updates: patch.updates,
        });
        return;
      }
      webviewPanel.webview.postMessage({ type: MSG_UPDATE_CONTENT, html: result.html });
    };

    // A hidden panel (tabbed behind another editor, or sitting in a
    // collapsed group) still has a live webview under
    // retainContextWhenHidden, so without this every edit anywhere in the
    // watched set pays for a full re-render nobody is looking at. That is
    // expensive here in a way it isn't for a single topic: book mode
    // re-renders every referenced topic from scratch (see the render cost
    // note in scripts/bench-book-render.js), and the extension host is
    // single-threaded, so the cost lands on every other extension's
    // completions and hovers too. Record the debt instead and settle it
    // once, when the panel comes back.
    const requestUpdate = (kind: 'content' | 'full') => {
      if (disposed) return;
      if (!webviewPanel.visible) {
        pendingUpdate = foldPendingRender(pendingUpdate, kind);
        return;
      }
      if (kind === 'full') updateWebview();
      else postContentUpdate();
    };

    const viewStateSubscription = webviewPanel.onDidChangeViewState((e) => {
      if (!e.webviewPanel.visible || pendingUpdate === 'none') return;
      // Clear before rendering: postContentUpdate falls back to
      // updateWebview when rendering fails, and re-entering with a stale
      // pendingUpdate would render twice.
      const owed = pendingUpdate;
      pendingUpdate = 'none';
      if (owed === 'full') updateWebview();
      else postContentUpdate();
    });

    updateWebview();

    webviewPanel.onDidDispose(() => {
      disposed = true;
      if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
      changeSubscription.dispose();
      referencedFilesWatcher.dispose();
      themeSubscription.dispose();
      viewStateSubscription.dispose();
      lastRenderedHtmlByUri.delete(document.uri.toString());
    });
  }

  private buildSiteManifestFromParsedMap(
    mapRoot: import('../parser/domTypes').DitaNode,
    document: vscode.TextDocument,
    docDir: string,
  ): { keyMap: Map<string, string>; manifest: DocsiteNavEntry[]; bookMembers: ReadonlySet<string> } {
    const keyMap = buildKeyMap(document.uri);
    const entries = collectMapEntries(mapRoot, (k) => keyMap.get(k));
    // makeFileTitleResolver reads a topic file's own <title> off disk --
    // only actually invoked for entries the map itself never named
    // (buildBookNavManifest's own resolveTopicTitle contract), so a
    // well-authored map with real navtitles everywhere pays nothing extra
    // here beyond the resolver's own construction.
    //
    // makeFileTopicTypeResolver, unlike the title resolver, is called for
    // every entry with an href regardless of whether the map named it --
    // a topic's type isn't something the map ever states on its own. It
    // stays cheap despite being unconditional because it only sniffs the
    // root tag (a bounded read, not a full parse) rather than sharing the
    // title resolver's DOM-based file cache; see that function's own
    // comment for why a full parse here would reintroduce exactly the
    // O(topics-in-book) cost docsite mode exists to avoid.
    const manifest = buildBookNavManifest(
      entries,
      docDir,
      makeFileTitleResolver(docDir),
      makeFileTopicTypeResolver(docDir, localizeTopicTypeLabel),
    );
    // Book-internal cross-topic xref (docsite design doc, 3.2/4.5): built
    // once here, alongside the manifest it's derived from, and handed as
    // the SAME instance to every renderSiteTopicContent call made against
    // this manifest (both the initial page render below and every later
    // page-switch in postSitePageUpdate) -- renderTopicCached's own cache
    // keys bookMembers by identity, so reusing this instance rather than
    // building a fresh Set per page switch is what keeps switching pages
    // back and forth cheap instead of silently re-rendering every time.
    const bookMembers = new Set(manifest.map((entry) => entry.absPath));
    return { keyMap, manifest, bookMembers };
  }

  private buildSiteManifest(
    document: vscode.TextDocument,
  ):
    | { docDir: string; keyMap: Map<string, string>; manifest: DocsiteNavEntry[]; bookMembers: ReadonlySet<string>; error?: undefined }
    | { error: string } {
    const docDir = dirname(document.uri.fsPath);
    try {
      const rawXml = document.getText();
      const preprocessedXml = preprocessEntities(rawXml);
      const mapDoc = parseDitamap(preprocessedXml);
      expandDitamapRefs(mapDoc.root, docDir);
      const { keyMap, manifest, bookMembers } = this.buildSiteManifestFromParsedMap(mapDoc.root, document, docDir);
      return { docDir, keyMap, manifest, bookMembers };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: message };
    }
  }

  /**
   * Renders exactly one topic's content for docsite mode -- the sidebar
   * (built separately, see buildBookNavManifest/renderSiteNavHtml) never
   * needs to re-render alongside it, which is the entire point of docsite
   * mode over Book mode: switching pages costs one renderTopicCached call,
   * not every topic in the map.
   *
   * headingLevel: 1 and a topic-relative asWebviewUri, matching
   * DitaViewerProvider's own single-topic render -- a docsite page is
   * meant to read exactly like opening that topic directly, same
   * philosophy Book mode's own per-entry render already follows (see
   * renderBookParts' own comment).
   */
  private renderSiteTopicContent(
    absPath: string,
    webview: vscode.Webview,
    keyMap: Map<string, string>,
    bookMembers: ReadonlySet<string>,
  ): { html: string; error?: undefined } | { html?: undefined; error: string } {
    const topicDir = dirname(absPath);
    const asWebviewUri = (relPath: string): string => {
      try {
        return webview.asWebviewUri(vscode.Uri.file(resolve(topicDir, decodeHrefPart(relPath)))).toString();
      } catch (e) {
        console.warn(`Failed to resolve webview URI for ${relPath}:`, e instanceof Error ? e.message : e);
        return '';
      }
    };
    const result = renderTopicCached({
      filePath: absPath,
      keyMap,
      asWebviewUri,
      headingLevel: 1,
      uiLanguage: vscode.env.language,
      bookMembers,
    });
    if (result.error) return { error: result.error };
    return { html: result.html };
  }

  private renderMapContent(
    document: vscode.TextDocument,
    webview: vscode.Webview,
    mode: 'tree' | 'book' | 'site',
    sitePageHint?: string,
  ): { html: string; parts?: BookPart[]; sidebarHtml?: string; resolvedSitePage?: string; siteManifest?: DocsiteNavEntry[]; siteKeyMap?: Map<string, string>; siteBookMembers?: ReadonlySet<string>; error?: undefined } | { html?: undefined; error: string } {
    const docDir = dirname(document.uri.fsPath);
    try {
      const rawXml = document.getText();
      const preprocessedXml = preprocessEntities(rawXml);
      const mapDoc = parseDitamap(preprocessedXml);

      // Expand topicrefs/keydefs that reference external .ditamap files
      // so their key-value pairs are visible inline in both tree and book mode
      expandDitamapRefs(mapDoc.root, docDir);

      if (mode === 'site') {
        // mapDoc.root is already parsed and expandDitamapRefs'd above --
        // reuse it rather than going through buildSiteManifest (which
        // re-parses from document.getText() for postSitePageUpdate's
        // benefit, where there is no already-parsed mapDoc to hand it).
        const { keyMap, manifest, bookMembers } = this.buildSiteManifestFromParsedMap(mapDoc.root, document, docDir);
        if (manifest.length === 0) {
          return { error: vscode.l10n.t('This map has no topics to show in site view.') };
        }
        // sitePageHint is whatever the caller last knew as "current" -- stale
        // (the map was edited and that topic's entry is gone) or never set
        // (first render) both fall back to the first entry, same as opening
        // a book always starts at its first topic.
        const resolvedSitePage = sitePageHint && manifest.some((m) => m.absPath === sitePageHint)
          ? sitePageHint
          : manifest[0].absPath;
        const topic = this.renderSiteTopicContent(resolvedSitePage, webview, keyMap, bookMembers);
        if (topic.error !== undefined) return { error: topic.error };
        const sidebarHtml = renderSiteNavHtml(manifest, resolvedSitePage, vscode.l10n.t('Topics'));
        // manifest/keyMap/bookMembers go back to the caller too
        // (updateWebview) so a page switch (postSitePageUpdate) can reuse
        // them instead of re-parsing the map, re-reading every
        // un-navtitled topic's <title> off disk, and rebuilding the book
        // membership set on every single click -- see that function's own
        // comment.
        return { html: topic.html, sidebarHtml, resolvedSitePage, siteManifest: manifest, siteKeyMap: keyMap, siteBookMembers: bookMembers };
      }

      let content: string;
      // Parts are produced in book mode only. That is the one content worth
      // patching entry by entry: it is assembled from pieces that each carry a
      // stable identity, and it is the one that grows to megabytes. Outline
      // mode's tree is small and still goes out whole.
      let parts: BookPart[] | undefined;
      if (mode === 'book') {
        parts = this.collectBookParts(mapDoc.root, document, webview, docDir);
        content = wrapBookParts(parts);
      } else {
        // Resolve <ph keyref="..."/> etc. in the map title and navtitles
        const keyMap = buildKeyMap(document.uri);
        content = renderMapDocument(mapDoc.root, {
          docDir,
          resolveKey: (k) => keyMap.get(k),
          roleFormat: formatLocalizedRole,
          treeLabel: vscode.l10n.t('Document outline'),
        });
      }
      return { html: content, parts };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: message };
    }
  }

  private generateLoadingHtml(webview: vscode.Webview): string {
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.file(join(this.context.extensionPath, 'media', 'styles.css')),
    );
    const theme = vscode.window.activeColorTheme;
    const isDark = theme.kind === vscode.ColorThemeKind.Dark || theme.kind === vscode.ColorThemeKind.HighContrast;
    const label = vscode.l10n.t('Rendering book…');
    return `<!DOCTYPE html>
<html lang="en"${isDark ? ' class="vscode-dark"' : ''}>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; base-uri 'none';">
<link rel="stylesheet" href="${stylesUri}">
<title>DITA</title>
</head>
<body class="dita-loading">
<div class="dita-loading-spinner" role="status" aria-label="${escapeAttr(label)}"></div>
<div>${escapeHtml(label)}</div>
</body>
</html>`;
  }

  private generateHtml(
    document: vscode.TextDocument,
    webview: vscode.Webview,
    mode: 'tree' | 'book' | 'site',
    sitePageHint?: string,
  ): { html: string; parts?: BookPart[]; resolvedSitePage?: string; siteManifest?: DocsiteNavEntry[]; siteKeyMap?: Map<string, string>; siteBookMembers?: ReadonlySet<string> } {
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.file(join(this.context.extensionPath, 'media', 'styles.css')),
    );

    const result = this.renderMapContent(document, webview, mode, sitePageHint);
    if (result.error !== undefined) {
      const message = result.error;
      // No parts on the error page: it is not a book, so there is nothing a
      // later incremental update could diff against, and the caller's
      // baseline has to drop back to "unknown".
      return {
        html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Error</title></head>
<body>
<div style="padding:2rem;color:#c0392b;">
<h2>Map Render Error</h2>
<pre>${escapeHtml(message)}</pre>
</div>
</body>
</html>`,
      };
    }

    const script = getMapWebviewScript();
    const nonce = randomBytes(16).toString('base64');
    const theme = vscode.window.activeColorTheme;
    const isDark = theme.kind === vscode.ColorThemeKind.Dark || theme.kind === vscode.ColorThemeKind.HighContrast;

    // Font size/typeface (global, shared with the topic viewer -- see
    // FONT_PREFS_KEY above) and page width (per-document, keyed by this
    // map's own uri) read back the same way the topic viewer's generateHtml
    // reads them, so a preference set in either preview survives closing
    // and reopening this one.
    const fontPrefs = this.context.globalState.get(FONT_PREFS_KEY, DEFAULT_FONT_PREFS);
    const fontPrefsJson = escapeJson(JSON.stringify(fontPrefs));
    const widthSelection = this.context.globalState.get<Record<string, string>>(WIDTH_SELECTION_KEY, {})[document.uri.toString()] || '';
    const widthSelectionJson = escapeJson(JSON.stringify(widthSelection));
    const tagTooltips = this.context.globalState.get(TAG_TOOLTIPS_KEY, DEFAULT_TAG_TOOLTIPS);
    const tagTooltipsJson = escapeJson(JSON.stringify(tagTooltips));

    return {
      html: `<!DOCTYPE html>
<html lang="en"${isDark ? ' class="vscode-dark"' : ''}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none';">
<link rel="stylesheet" href="${stylesUri}">
<title>${escapeHtml(document.fileName)}</title>
</head>
<body class="mode-${mode}">
${result.sidebarHtml ?? ''}
${mode === 'site' ? '<div id="__site-nav-resizer" class="site-nav-resizer" role="separator" aria-orientation="vertical" tabindex="0"></div>' : ''}
<div id="dita-content-root"${mode === 'site' ? ' class="site-main"' : ''}>${result.html}</div>
<script nonce="${nonce}">window.__fontPrefs=${fontPrefsJson};window.__widthSelection=${widthSelectionJson};window.__tagTooltips=${tagTooltipsJson};</script>
<script nonce="${nonce}">${script}</script>
</body>
</html>`,
      parts: result.parts,
      resolvedSitePage: result.resolvedSitePage,
      siteManifest: result.siteManifest,
      siteKeyMap: result.siteKeyMap,
      siteBookMembers: result.siteBookMembers,
    };
  }

  private collectBookParts(
    mapRoot: import('../parser/domTypes').DitaNode,
    document: vscode.TextDocument,
    webview: vscode.Webview,
    docDir: string,
  ): BookPart[] {
    // Build key map once for all entries. renderTopicCached compares it by
    // identity, so one instance for the whole pass is what makes reuse work.
    const keyMap = buildKeyMap(document.uri);
    const resolveKey = (k: string) => keyMap.get(k);
    const entries = collectMapEntries(mapRoot, resolveKey);

    // The assembly loop lives in ditaRenderUtils.renderBookParts so it can be
    // unit-tested -- and benchmarked against the same code that ships --
    // without a VS Code instance. This method contributes the two things that
    // genuinely need one: the map's key definitions and the webview's
    // resource-URI conversion.
    return renderBookParts({
      entries,
      docDir,
      keyMap,
      fileToWebviewUri: (absPath) => webview.asWebviewUri(vscode.Uri.file(absPath)).toString(),
      uiLanguage: vscode.env.language,
    });
  }
}


