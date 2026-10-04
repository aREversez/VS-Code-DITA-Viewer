// Webview script of the map preview (MapViewerProvider): outline, book and
// docsite modes, the sidebar, the toolbar and the host<->webview message
// handlers. Moved verbatim out of MapViewerProvider.ts so the provider holds
// host logic only; the output is byte-identical (checked against the pre-move
// generated script). The message types come from mapMessages.ts, which the
// provider imports too.
//
// The single-topic preview's counterpart is topicScript.ts.

import * as vscode from 'vscode';
import { getProfilingToggleScript } from './profilingToggleScript';
import { getSearchOverlayScript, getProfilingFilterScript, getImageLightboxScript, getImageMapSupportScript, getToolbarScaffoldScript, getFontPrefsScript, getToolbarFontWidthTagTooltipsButtonsScript, getRefreshButtonScript, getSiteNavClickHandlerScript, getSidebarUpdateScript, getBookNavClickHandlerScript, getBookScrollSyncScript, getOutlineSyncScript, getSiteNavToggleScript, getSiteNavKeyboardScript, getSiteNavCollapseStateHelperScript, getSiteNavExpandCollapseAllButtonsScript, getSitePrevNextButtonsScript, getSiteHistoryButtonsScript, getSiteOpenSourceScript, getTemplateSelectScript, getToolbarPlacementScript, PREV_TOPIC_ICON_SVG, NEXT_TOPIC_ICON_SVG, getSiteSidebarToggleScript, getModeToggleScript, getSiteSidebarResizerScript, HISTORY_BACK_ICON_SVG, HISTORY_FORWARD_ICON_SVG, getSiteHomeButtonScript } from '../ditaRenderUtils';
import { getBookSearchScript } from '../bookSearchIndex';
import { sharedWebviewStrings } from '../webviewL10n';
import { getContentSwapRefreshScript } from './contentSwapScript';
import { MSG_BOOK_SEARCH, MSG_BOOK_SEARCH_RESULTS, MSG_NAV_CONTEXT, MSG_OPEN_TOPIC_SOURCE, MSG_PATCH_CONTENT, MSG_REQUEST_FULL_RENDER, MSG_SET_FONT_PREFS, MSG_SET_NAV_COLLAPSED, MSG_SET_TAG_TOOLTIPS, MSG_SET_TEMPLATE, MSG_SET_WIDTH_SELECTION, MSG_SWITCH_MODE, MSG_SWITCH_SITE_PAGE, MSG_UPDATE_CONTENT, MSG_UPDATE_SIDEBAR } from '../mapMessages';

export function getMapWebviewScript(
  templateOptions: ReadonlyArray<{ value: string; label: string }>,
  selectedTemplate: string,
): string {
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
    modeSwitching: vscode.l10n.t('Switching view…'),
    siteHome: vscode.l10n.t('Go to book home'),
    siteBack: vscode.l10n.t('Go back'),
    siteForward: vscode.l10n.t('Go forward'),
    siteOpenSource: vscode.l10n.t('Source'),
    siteOpenSourceTitle: vscode.l10n.t('Open this topic\'s source in the editor'),
    siteOpenSourceMenu: vscode.l10n.t('Open source'),
    // Book/Site sidebar row context-menu labels (see getSiteOpenSourceScript).
    // "Open source" above is reused for that menu's second item; the rest are
    // menu-only. Titles match the native DITA Map tree's context menu where an
    // equivalent exists.
    navMenuOpenMap: vscode.l10n.t('Open Map in Editor'),
    navMenuOpenWithOxygen: vscode.l10n.t('Open with Oxygen XML Editor'),
    // "Reveal in Explorer" for the native tree is VS Code's own Explorer
    // view (revealInExplorer); this one opens the OS file manager
    // (revealFileInOS) -- VS Code's standard label for that command, kept
    // deliberately different so the two entries don't read as the same action.
    navMenuRevealInExplorer: vscode.l10n.t('Reveal in File Explorer'),
    navMenuFindUnreferenced: vscode.l10n.t('Find Unreferenced Resources…'),
    navMenuExportHtml: vscode.l10n.t('Export as HTML…'),
    navMenuCopyTitle: vscode.l10n.t('Copy Title'),
    navMenuCopyHref: vscode.l10n.t('Copy Href'),
    navMenuExpandAll: vscode.l10n.t('Expand All'),
    navMenuCollapseAll: vscode.l10n.t('Collapse All'),
    templateTitle: vscode.l10n.t('Template'),
    templateNone: vscode.l10n.t('Default look'),
    sitePrevTopic: vscode.l10n.t('Previous topic'),
    siteNextTopic: vscode.l10n.t('Next topic'),
    siteToggleSidebar: vscode.l10n.t('Show/hide topic list'),
    siteExpandAll: vscode.l10n.t('Expand all topics'),
    siteCollapseAll: vscode.l10n.t('Collapse all topics'),
    siteSearchTitle: vscode.l10n.t('Search this book'),
    siteSearchPlaceholder: vscode.l10n.t('Search all topics...'),
    siteSearchNoResults: vscode.l10n.t('No matches found'),
    // {0}/{1} stay as literal placeholders here; the webview fills them in.
    siteSearchTruncated: vscode.l10n.t('Showing the first {0} of {1} results'),
    siteSearchRefresh: vscode.l10n.t('Refresh search results'),
    siteSearchClear: vscode.l10n.t('Clear search'),
  };
  return `
(function() {
  var vscode = acquireVsCodeApi();
  // Seed the current mode from the server-rendered body class. A mode switch
  // no longer regenerates the document (it is applied in place by the
  // MSG_SWITCH_MODE handler below), so this derivation only ever runs on the
  // initial load -- but it must still read the mode the document was opened
  // in, otherwise a document opened straight into book/site (a remembered
  // view) would seed 'tree' and the toggle would be one click out of sync.
  var currentMode = document.body.classList.contains('mode-book') ? 'book'
    : document.body.classList.contains('mode-site') ? 'site' : 'tree';

  // Superset script: every mode's handlers are always present so an in-place
  // switch needs no reload. The site/book click and keyboard handlers each
  // carry a "typeof currentMode" runtime guard so only the active mode's one
  // acts on a shared selector (e.g. .site-nav-link); the mode-specific toolbar
  // buttons are always built and appended and merely hidden by CSS keyed on
  // the body's mode-* class (see media/styles.css), which keeps the always-
  // present right-hand cluster of the bar -- and the mode button itself -- in
  // one fixed spot across modes.
  ${getSiteNavClickHandlerScript({ switchSitePageMsgType: MSG_SWITCH_SITE_PAGE })}
  ${getBookNavClickHandlerScript()}
  ${getSiteNavCollapseStateHelperScript({ reportCollapseMsgType: MSG_SET_NAV_COLLAPSED })}
  ${getBookScrollSyncScript()}
  ${getOutlineSyncScript()}
  ${getSiteNavToggleScript()}
  ${getSiteNavKeyboardScript()}
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
    widthTooNarrow: L.widthTooNarrow,
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

  // Sidebar collapse toggle -- docsite and book view. Built and appended in
  // every mode now (superset script); CSS keyed on the body's mode-* class
  // hides it in outline (see media/styles.css), so switching modes only flips
  // visibility and never moves the always-present right-hand cluster. Site
  // mode's sidebar starts open; book mode's starts collapsed (see
  // getInitialSidebarBodyClass, body's own class construction below --
  // nested-fold-and-highlight-plan.md item 6). This button is how a
  // reader tucks the topic list away or gets it back, in either mode.
  ${getSiteSidebarToggleScript({ toggleTitle: L.siteToggleSidebar })}
  toolbar.appendChild(siteSidebarToggleBtn);

  // Expand-all / collapse-all, right after the sidebar toggle they
  // operate on. Same append-always/CSS-hides-outside-its-mode convention; both
  // sidebar modes get them, since book and site render the identical
  // sidebar markup (renderSiteNavTreeHtml).
  ${getSiteNavExpandCollapseAllButtonsScript({
    expandAllTitle: L.siteExpandAll,
    collapseAllTitle: L.siteCollapseAll,
  })}
  toolbar.appendChild(siteExpandAllBtn);
  toolbar.appendChild(siteCollapseAllBtn);

  // Prev/next topic buttons -- docsite mode only. Built and appended in every
  // mode (superset), hidden by CSS outside site mode. updatePrevNextButtons
  // (getSiteNavClickHandlerScript) finds them by id even while hidden, which
  // is harmless (updating a display:none button). Back/forward through the
  // pages the reader has visited (site mode only, like prev/next, which step
  // through reading order instead -- hence arrows rather than angle brackets).
  // Wired up by updateHistoryButtons in getSiteNavClickHandlerScript.
  // Home -- docsite mode only, like the buttons around it, and leftmost of
  // the cluster: back/forward/prev/next all walk relative to wherever the
  // reader currently is, this is the one fixed place among them.
  ${getSiteHomeButtonScript({
    title: L.siteHome,
    switchSitePageMsgType: MSG_SWITCH_SITE_PAGE,
  })}
  ${getSiteHistoryButtonsScript({
    backLabel: HISTORY_BACK_ICON_SVG,
    backTitle: L.siteBack,
    forwardLabel: HISTORY_FORWARD_ICON_SVG,
    forwardTitle: L.siteForward,
  })}
  ${getSitePrevNextButtonsScript({
    prevLabel: PREV_TOPIC_ICON_SVG,
    prevTitle: L.sitePrevTopic,
    nextLabel: NEXT_TOPIC_ICON_SVG,
    nextTitle: L.siteNextTopic,
  })}
  // Open the shown topic's source (and, via right-click on a sidebar row,
  // any topic's) -- docsite mode only, like the buttons around it.
  ${getSiteOpenSourceScript({
    openSourceMsgType: MSG_OPEN_TOPIC_SOURCE,
    navContextMsgType: MSG_NAV_CONTEXT,
    menuLabel: L.siteOpenSourceMenu,
    openMapLabel: L.navMenuOpenMap,
    oxygenLabel: L.navMenuOpenWithOxygen,
    revealLabel: L.navMenuRevealInExplorer,
    findUnreferencedLabel: L.navMenuFindUnreferenced,
    exportLabel: L.navMenuExportHtml,
    copyTitleLabel: L.navMenuCopyTitle,
    copyHrefLabel: L.navMenuCopyHref,
    expandAllLabel: L.navMenuExpandAll,
    collapseAllLabel: L.navMenuCollapseAll,
    buttonLabel: L.siteOpenSource,
    buttonTitle: L.siteOpenSourceTitle,
  })}
  toolbar.appendChild(siteHomeBtn);
  toolbar.appendChild(siteBackBtn);
  toolbar.appendChild(siteForwardBtn);
  toolbar.appendChild(sitePrevBtn);
  toolbar.appendChild(siteNextBtn);
  toolbar.appendChild(siteOpenSourceBtn);

  // Full-book search -- docsite mode only (docsite design doc, 4.4,
  // revised to live in the sidebar rather than a toolbar button after
  // first-look feedback -- see getBookSearchScript's own doc comment for
  // why). A topic-level, DOM-only search already exists
  // (getSearchOverlayScript, Ctrl+F) and needs no change here: it already
  // works per-page for free in site mode, and getBookSearchScript hands
  // off to it directly to actually highlight a picked result rather than
  // duplicating that mechanism. This is the separate, whole-book version,
  // backed by the lazy per-book text index built on the extension host
  // side (see bookSearchIndex.ts). getBookSearchScript inserts itself into
  // .site-nav directly, so there is no toolbar wiring needed here at all --
  // but book mode now has its own .site-nav too (nested-fold-and-highlight-
  // plan.md item 1), and getBookSearchScript's own click-through
  // (switchToSitePage, a genuine page fetch) has no book-mode equivalent, so
  // it stays docsite-only. In the superset script it is emitted in every mode
  // and gates itself at run time (its bindBookSearch early-returns unless
  // currentMode is 'site'), so a switch into site builds the box and a switch
  // out leaves it unbuilt -- no reload needed either way.
  ${getBookSearchScript({
    searchLabel: L.siteSearchTitle,
    placeholder: L.siteSearchPlaceholder,
    noResultsLabel: L.siteSearchNoResults,
    truncatedLabel: L.siteSearchTruncated,
    matchCaseLabel: L.searchMatchCase,
    useRegexLabel: L.searchUseRegex,
    invalidRegexLabel: L.searchInvalidRegex,
    refreshLabel: L.siteSearchRefresh,
    clearLabel: L.siteSearchClear,
    requestMsgType: MSG_BOOK_SEARCH,
    responseMsgType: MSG_BOOK_SEARCH_RESULTS,
  })}


  // Template picker -- docsite and book view (outline view has no template,
  // where CSS hides this). Placed BEFORE the mode button on purpose: the bar
  // is right-aligned, so the mode button (and Tags/Flags/Filter/refresh after
  // it) keep their distance from the right edge whether or not this picker is
  // visible -- switching modes must not move the mode button out from under
  // the cursor.
  ${getTemplateSelectScript({
    msgType: MSG_SET_TEMPLATE,
    title: L.templateTitle,
    noneLabel: L.templateNone,
    options: templateOptions,
    selected: selectedTemplate,
  })}
  toolbar.appendChild(templateSel);

  // Mode toggle button. Cycles tree -> site -> book -> tree; the label
  // always names the CURRENT mode (see getModeToggleScript's own comment
  // for why).
  ${getModeToggleScript({
    switchModeTitle: L.switchModeTitle,
    modeOutline: L.modeOutline,
    modeBook: L.modeBook,
    modeSite: L.modeSite,
    switchModeMsgType: 'switchMode',
    switchingLabel: L.modeSwitching,
  })}
  toolbar.appendChild(modeBtn);

  // Tag-name tooltip toggle -- same feature and same persisted preference
  // as the topic viewer's own (see TAG_TOOLTIPS_KEY in
  // DitaViewerProvider.ts). Book mode renders each topic through the same
  // renderTopicCached()/renderer.ts pipeline, so the same data-dita-tagname
  // attributes are already present here; this toggle is the only piece
  // that was missing.
  toolbar.appendChild(tagTooltipsBtn);

  ${getProfilingToggleScript({ label: L.profilingLabel, onTitle: L.profilingOnTitle, offTitle: L.profilingOffTitle })}

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

  ${getRefreshButtonScript({ title: L.reloadContent })}
  toolbar.appendChild(refreshBtn);

  ${getToolbarPlacementScript()}

  ${getSearchOverlayScript({
    placeholder: L.searchPlaceholder,
    nextMatch: L.searchNext,
    prevMatch: L.searchPrev,
    close: L.searchClose,
    matchCase: L.searchMatchCase,
    useRegex: L.searchUseRegex,
    invalidRegex: L.searchInvalidRegex,
  })}

  // Click-to-enlarge lightbox + image copy menu -- the same script the topic
  // viewer embeds. styles.css gives every rendered image cursor:zoom-in in
  // BOTH webviews, so book/site mode's images promised enlargement on click
  // but nothing here kept that promise: the cursor turned into a magnifying
  // glass and clicking did nothing. Embedding the shared script makes the
  // promise true (and gives tree mode's occasional inline images the same
  // behavior for free). No afterContentSwap involvement needed: every
  // listener is document-level delegation, and lightboxCandidates()
  // re-queries the DOM on each open, so content swaps and book-mode patches
  // are picked up automatically -- see getImageLightboxScript in
  // ditaRenderUtils.ts.
  ${getImageLightboxScript({
    copyMenuItem: L.imgCopyMenuItem,
    copyDoneLabel: L.imgCopyDoneLabel,
    copyFailedLabel: L.imgCopyFailedLabel,
    copyUnsupportedLabel: L.imgCopyUnsupportedLabel,
    copyToastDone: L.imgCopyToastDone,
    copyToastFailed: L.imgCopyToastFailed,
  })}

  // Image-map hotspots: same two fixes as the topic preview (see
  // getImageMapSupportScript in ditaRenderUtils.ts) -- keeps <area> hit
  // regions aligned with the rendered image across max-width clamping and
  // content swaps, and routes non-fragment hotspot clicks to the host via
  // openImagemapLink instead of letting the webview navigate itself to a
  // vscode-webview:// 404. Book-internal hotspots are untouched: their
  // data-dita-book-xref attribute is handled by the site/book click
  // handlers that already run on the same event.
  ${getImageMapSupportScript({ openMsgType: 'openImagemapLink' })}

  // Every source edit (a topicref's profiling attributes, reordering
  // entries, ...) sends just the freshly rendered content as a message
  // instead of the extension reassigning webview.html wholesale -- see
  // postContentUpdate in MapViewerProvider.ts for why (same reasoning as
  // the topic viewer's own content-only update). Content-dependent setup
  // that only ran once at initial load, because a full reload used to
  // rerun this entire script from scratch every time, needs to re-run
  // after each swap instead. The image lightbox needs none of this -- its
  // document-level delegation survives any content swap untouched -- and
  // there is still no per-image zoom toolbar or source-editor scroll-sync
  // here to re-apply (unlike the topic viewer), so this is a shorter list.
  //
  // Both content paths call this. Patching a handful of entries leaves the
  // same kind of stale state behind as replacing all of them: profiling
  // decisions computed over DOM that has since been swapped, and search
  // highlights holding references to nodes that are no longer attached.
  ${getContentSwapRefreshScript()}
  function afterContentSwap() {
    refreshAfterContentSwap();
  }

  // site:true is now unconditional: updatePrevNextButtons is declared by the
  // always-injected getSiteNavClickHandlerScript (superset script), and the
  // site:true body is book-safe too (it falls back to the whole nav when there
  // is no .site-nav-links, and returns early in tree mode where there is no
  // .site-nav at all).
  ${getSidebarUpdateScript({ site: true })}

  // Applies a mode the host just rendered, IN PLACE: swap the body class, the
  // template css + dropdown, and the content that follows the persistent
  // #__topbar -- without reassigning webview.html, so the toolbar (and the
  // mode button inside it) never leaves the page. The element-binding scripts
  // (resizer, scroll-sync, book search, deferred site-nav init) re-run over the
  // new DOM via the ditamap:stage event dispatched at the end.
  function applyModeStage(stage) {
    currentMode = stage.mode;
    if (typeof updateModeLabel === 'function') updateModeLabel();
    // Re-enable the mode button now that the stage it was waiting on has
    // actually landed (see the disabled/debounce comment in
    // getModeToggleScript). The old, dimmed #dita-content-root this click
    // disabled the button for is about to be discarded below along with the
    // rest of the pre-switch content, so there is nothing to un-dim here --
    // the freshly inserted one starts undimmed.
    if (typeof modeBtn !== 'undefined' && modeBtn) modeBtn.disabled = false;
    // Cancel the delayed "switching..." overlay (getModeToggleScript) if it
    // has not fired yet -- the switch just landed inside the 400ms grace
    // period, so there is nothing slow to explain. If it HAS already fired,
    // there is nothing to undo here either: it was appended as a child of
    // the very #dita-content-root node the removal loop below discards, so
    // it goes with it. Guarded with typeof the same defensive way modeBtn
    // is just above -- both are declared by getModeToggleScript, elsewhere
    // in this same concatenated script, and this file has no static check
    // tying the two pieces together.
    if (typeof pendingSwitchOverlayTimer !== 'undefined' && pendingSwitchOverlayTimer) {
      clearTimeout(pendingSwitchOverlayTimer);
      pendingSwitchOverlayTimer = null;
    }

    // Search state does not survive a mode switch: the highlighted terms and
    // matches belong to the content that is about to be torn down. Close it
    // BEFORE that content is removed below, for two reasons -- (1) it clears
    // the CSS Custom Highlight registrations and resets the input/count, so
    // afterContentSwap()'s refreshSearchAfterDomChange (called at the end of
    // this function, same as it is for a live-edit refresh) does not see an
    // "open" search bar and silently re-run performSearch against the new
    // mode's content, which is what used to make old matches reappear
    // highlighted on the page the reader just switched to; and (2) sb
    // (#__search_bar) is a normal DOM node appended after #__topbar, so
    // without this it would otherwise still be showing open when the removal
    // loop below detaches it from the document a few lines down.
    if (typeof closeSearchBar === 'function') closeSearchBar();

    // Body: this mode's classes and template hook, but keep the client-owned
    // hide-profiling toggle (a Flags-button state that a switch must not reset).
    var cls = stage.bodyClass || '';
    if (document.body.classList.contains('hide-profiling')) cls += (cls ? ' ' : '') + 'hide-profiling';
    document.body.className = cls;
    if (stage.templateDataAttr) document.body.setAttribute('data-template', stage.templateDataAttr);
    else document.body.removeAttribute('data-template');

    // Template css into the persistent head <style>, and the dropdown choice.
    var tplStyle = document.getElementById('dita-template-style');
    if (tplStyle) tplStyle.textContent = stage.templateCss || '';
    if (typeof templateSel !== 'undefined' && templateSel) templateSel.value = stage.selectedTemplate || '';

    // Replace everything the #__topbar does NOT own: drop the current body
    // children after it (keeping the bar itself, the already-run <script>
    // tags whose side effects must stay, and #__search_bar -- the search
    // overlay is shell chrome like the bar itself, not mode content: it is
    // built once by the superset script and reused across switches, same as
    // #__topbar, rather than being torn down and left permanently
    // unreachable by the still-live sb variable its own click handlers
    // close over), then insert the new stage markup right after the bar --
    // the same order a full document had them in.
    var bar = document.getElementById('__topbar');
    if (bar) {
      var n = bar.nextSibling;
      while (n) {
        var next = n.nextSibling;
        if (!(n.nodeType === 1 && (n.tagName === 'SCRIPT' || n.id === '__search_bar'))) n.remove();
        n = next;
      }
      bar.insertAdjacentHTML('afterend', stage.shellHtml || '');

      // The bar's own placement tracks the stage: docsite/book shells keep it
      // as the shell's first flex row; outline (and an empty book) pin it as a
      // full-width top row (topbar--top) with the content scrolling beneath.
      // The title shows only inside a shell that has no template header of its
      // own already carrying one -- checked after the swap, against the NEW DOM.
      bar.classList.toggle('topbar--top', !stage.isShell);
      var titleEl = bar.querySelector('.topbar-title');
      var wantTitle = stage.isShell && !document.querySelector('.tpl-header');
      var title = typeof window.__mapTitle === 'string' ? window.__mapTitle : '';
      if (wantTitle && title) {
        if (!titleEl) {
          titleEl = document.createElement('span');
          titleEl.className = 'topbar-title';
          bar.insertBefore(titleEl, bar.firstChild);
        }
        titleEl.textContent = title;
        titleEl.title = title;
      } else if (titleEl) {
        titleEl.remove();
      }
    }

    afterContentSwap();
    window.dispatchEvent(new Event('ditamap:stage'));
  }

  window.addEventListener('message', function(e) {
    if (e.data.type === '${MSG_UPDATE_CONTENT}') {
      var contentRoot = document.getElementById('dita-content-root');
      if (contentRoot) {
        contentRoot.innerHTML = e.data.html;
        afterContentSwap();
        // Refreshes the Home button's disabled state (updatePrevNextButtons
        // also handles it, see getSiteNavClickHandlerScript) against the DOM
        // that just landed -- the home toolbar button's own click handler
        // posts straight to the extension host without switchToSitePage's
        // usual optimistic pre-update, so nothing else does this for a trip
        // to or from the home page. Harmless where it is redundant (a plain
        // topic-to-topic switch already updated this before the postMessage).
        if (currentMode === 'site' && typeof updatePrevNextButtons === 'function') updatePrevNextButtons();
        // Site mode's book-internal xref jump (docsite design doc,
        // 3.2/4.5): switchToSitePage stashed the target anchor before the
        // page-switch postMessage, since the element it names doesn't
        // exist until this new HTML lands. A plain sidebar/prev-next
        // switch never sets this, so it's a no-op there.
        //
        // Always emitted now: the identifiers these blocks read
        // (pendingSiteAnchor/scrollToSiteAnchor from
        // getSiteNavClickHandlerScript, pendingSiteScroll, and
        // pendingSiteSearchHighlight/bsApplyPageSearch from
        // getBookSearchScript) are DECLARED by those same scripts, which the
        // superset design injects in every mode so an in-place switch needs
        // no reload. The currentMode === 'site' runtime guards below keep
        // them inert outside site mode.
        if (currentMode === 'site' && pendingSiteAnchor) {
          scrollToSiteAnchor(pendingSiteAnchor);
          pendingSiteAnchor = null;
        }
        // A page switch's own scroll: the top of a new page, or where the
        // reader was for a step through the history. Set only by a switch --
        // every other content update (the in-place refresh after an edit)
        // leaves it null and the scroll untouched. Before the search-result
        // jump below, which scrolls to its first match and must win.
        if (currentMode === 'site' && pendingSiteScroll !== null) {
          contentRoot.scrollTop = pendingSiteScroll;
          pendingSiteScroll = null;
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
    } else if (e.data.type === '${MSG_UPDATE_SIDEBAR}') {
      // Sent by book mode's content updates and, since site mode stopped
      // reloading the page on an edit, by site mode's too -- see
      // getSidebarUpdateScript for what each replaces and why.
      applySidebarUpdate(e.data.html);
    } else if (e.data.type === '${MSG_SWITCH_MODE}') {
      // A mode the host rendered and is handing to this still-alive document:
      // applied in place by applyModeStage (see above) rather than a reload,
      // which is what keeps the toolbar from flashing out and back on a switch.
      applyModeStage(e.data.stage);
    }
  });
})();
`;
}
