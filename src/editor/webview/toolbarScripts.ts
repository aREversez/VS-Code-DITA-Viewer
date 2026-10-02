// Webview scripts for the preview toolbar / docsite chrome: the home, history,
// prev-next, sidebar-toggle, mode-toggle and open-source menu buttons, the
// template picker, and the toolbar placement glue -- plus the shared icon SVG
// constants and the private nav-button inline style. Moved verbatim from
// ditaRenderUtils.ts (P5 pure refactor); a self-contained leaf (no imports,
// no .toString() of host helpers). The icon consts stay exported because the
// providers consume them; SITE_NAV_BTN_STYLE is module-private.

/**
 * Shared inline style of the four site-mode navigation buttons (back,
 * forward, previous topic, next topic). A fixed width rather than
 * glyph-width-plus-padding sizing: the arrow/angle glyphs vary in width from
 * font to font, and the buttons used to come out as the longest things on the
 * toolbar. Fixed width + flex centering keeps all four the same compact size
 * with the icon in the middle.
 */
const SITE_NAV_BTN_STYLE = 'width:20px;padding:0;justify-content:center;text-align:center;';

/** Short-shafted arrows for the history buttons -- a font's own arrow glyph
 *  has a long shaft, which is what made these buttons wide. currentColor so
 *  they follow the button's (and its disabled) color. */
export const HISTORY_BACK_ICON_SVG =
  '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path d="M12.5 8H4M7.5 4.5L4 8l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
export const HISTORY_FORWARD_ICON_SVG =
  '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path d="M3.5 8H12M8.5 4.5L12 8l-3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Chevrons for the previous/next-topic buttons, drawn like the history arrows
 *  so the icon sits at the button's exact center (a font's ‹ › glyphs sit
 *  low on the line and their position varies by font). */
export const PREV_TOPIC_ICON_SVG =
  '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path d="M10 3.5L5.5 8 10 12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
export const NEXT_TOPIC_ICON_SVG =
  '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** House glyph for the home toolbar button, drawn like the other toolbar
 *  icons (short, centered, currentColor) rather than a font glyph. */
export const SITE_HOME_ICON_SVG =
  '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path d="M2 7.5L8 2.5L14 7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<path d="M3.5 6.5V13.5H12.5V6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * Sentinel `target` value meaning "the docsite home page", used the same way
 * a topic's absPath is used everywhere a site page is identified -- as the
 * `sitePage` stored in mapViewState.ts, as `currentSitePage` in
 * MapViewerProvider.ts, and as the `target` on the MSG_SWITCH_SITE_PAGE
 * postMessage the home toolbar button sends (getSiteHomeButtonScript below).
 * Deliberately not the empty string: MapViewerProvider's switchSitePage
 * handler rejects a falsy target outright, and this needs to pass that
 * check. Deliberately not a real filesystem path shape either, so it can
 * never collide with an actual entry.absPath -- every `=== SITE_HOME_TARGET`
 * comparison in this file and MapViewerProvider.ts relies on that.
 */
export const SITE_HOME_TARGET = '@@dita-viewer-site-home@@';

/**
 * Docsite mode's Home button -- built and appended the same
 * build-always/caller-places-it convention as getSitePrevNextButtonsScript,
 * placed leftmost of the navigation cluster (before back/forward) in
 * MapViewerProvider.ts. Unlike back/forward/prev/next, it does not act on a
 * `.site-nav-link` element (there isn't one for the home page -- it is not a
 * manifest entry), so it posts MSG_SWITCH_SITE_PAGE directly with
 * SITE_HOME_TARGET rather than going through switchToSitePage. It also
 * leaves siteHistory alone: that history is "the topics the reader has
 * visited" (siteHistoryExists tests a target against the sidebar's own
 * links, which the home page is deliberately not one of), not a generic
 * page stack, so a trip home is not recorded on it -- back/forward continues
 * to step through real topics as if the trip home never happened.
 * Its disabled state (already on the home page) is refreshed by
 * updatePrevNextButtons alongside the prev/next buttons, since both fire
 * from the exact same events (every page switch, plus init/mode-switch).
 */
export function getSiteHomeButtonScript(opts: { title: string; switchSitePageMsgType: string }): string {
  const title = JSON.stringify(opts.title);
  const msgType = JSON.stringify(opts.switchSitePageMsgType);
  const homeTarget = JSON.stringify(SITE_HOME_TARGET);
  return `
  var siteHomeBtn = document.createElement('button');
  siteHomeBtn.id = '__site-home-btn';
  // innerHTML: the label is this file's own constant icon markup (SITE_HOME_ICON_SVG), never translated or user text.
  siteHomeBtn.innerHTML = ${JSON.stringify(SITE_HOME_ICON_SVG)};
  siteHomeBtn.title = ${title};
  siteHomeBtn.setAttribute('aria-label', ${title});
  siteHomeBtn.style.cssText = btnStyle + '${SITE_NAV_BTN_STYLE}';
  siteHomeBtn.addEventListener('click', function() {
    vscode.postMessage({ type: ${msgType}, target: ${homeTarget} });
  });
`;
}

/**
 * The toolbar's history buttons, created like getSitePrevNextButtonsScript's
 * (built here, appended by the caller, which decides where they go). Arrows
 * rather than the angle brackets the prev/next buttons use: those step through
 * the book's reading order, these through the pages the reader has visited,
 * and the two must not look like the same control. Wired up (enabled state and
 * click) by updateHistoryButtons in getSiteNavClickHandlerScript.
 */
export function getSiteHistoryButtonsScript(opts: { backLabel: string; backTitle: string; forwardLabel: string; forwardTitle: string }): string {
  const backLabel = JSON.stringify(opts.backLabel);
  const backTitle = JSON.stringify(opts.backTitle);
  const forwardLabel = JSON.stringify(opts.forwardLabel);
  const forwardTitle = JSON.stringify(opts.forwardTitle);
  return `
  var siteBackBtn = document.createElement('button');
  siteBackBtn.id = '__site-back-btn';
  // innerHTML, not textContent: the label is the caller's own constant
  // icon markup (a short SVG arrow), never translated or user text -- the
  // translated part is the title below.
  siteBackBtn.innerHTML = ${backLabel};
  siteBackBtn.title = ${backTitle};
  siteBackBtn.setAttribute('aria-label', ${backTitle});
  siteBackBtn.disabled = true;
  siteBackBtn.style.cssText = btnStyle + '${SITE_NAV_BTN_STYLE}';

  var siteForwardBtn = document.createElement('button');
  siteForwardBtn.id = '__site-forward-btn';
  siteForwardBtn.innerHTML = ${forwardLabel};
  siteForwardBtn.title = ${forwardTitle};
  siteForwardBtn.setAttribute('aria-label', ${forwardTitle});
  siteForwardBtn.disabled = true;
  siteForwardBtn.style.cssText = btnStyle + '${SITE_NAV_BTN_STYLE}';
`;
}

/**
 * Docsite mode's prev/next buttons -- built but, same convention as
 * getToolbarFontWidthTagTooltipsButtonsScript, NOT appended to the toolbar
 * here; the caller decides where in its own button order they belong
 * (design doc: "跟字号/页宽那些按钮放一起"). Their actual enabled state and
 * click targets are established by updatePrevNextButtons() in
 * getSiteNavClickHandlerScript above, called once these exist -- so this
 * function only needs to create the two elements, not wire them up.
 */
export function getSitePrevNextButtonsScript(opts: { prevLabel: string; prevTitle: string; nextLabel: string; nextTitle: string }): string {
  const prevLabel = JSON.stringify(opts.prevLabel);
  const prevTitle = JSON.stringify(opts.prevTitle);
  const nextLabel = JSON.stringify(opts.nextLabel);
  const nextTitle = JSON.stringify(opts.nextTitle);
  return `
  var sitePrevBtn = document.createElement('button');
  sitePrevBtn.id = '__site-prev-btn';
  // innerHTML: the label is the caller's constant icon markup (see PREV_TOPIC_ICON_SVG), never translated or user text.
  sitePrevBtn.innerHTML = ${prevLabel};
  sitePrevBtn.title = ${prevTitle};
  sitePrevBtn.setAttribute('aria-label', ${prevTitle});
  sitePrevBtn.style.cssText = btnStyle + '${SITE_NAV_BTN_STYLE}';

  var siteNextBtn = document.createElement('button');
  siteNextBtn.id = '__site-next-btn';
  siteNextBtn.innerHTML = ${nextLabel};
  siteNextBtn.title = ${nextTitle};
  siteNextBtn.setAttribute('aria-label', ${nextTitle});
  siteNextBtn.style.cssText = btnStyle + '${SITE_NAV_BTN_STYLE}';
`;
}

/**
 * Docsite mode's sidebar collapse toggle -- a single button that flips
 * `site-nav-collapsed` on document.body. Site mode starts with the class
 * absent (sidebar open); book mode starts with it already present (sidebar
 * collapsed) -- see getInitialSidebarBodyClass, which both modes' initial
 * body tag is built from (nested-fold-and-highlight-plan.md item 6). This
 * button behaves identically either way: it is how a reader tucks the
 * sidebar away or gets it back, regardless of which state it started in.
 * Deliberately a plain class toggle on body rather than
 * anything that touches the sidebar's own markup or posts a message to the
 * extension host: nothing here needs to survive a page switch through any
 * path other than "the class is already sitting on body, which page
 * switches never touch" (see postSitePageUpdate's own comment on why the
 * sidebar element itself is left alone by a content-only update) -- so
 * this one class flip is also, for free, exactly what keeps the sidebar's
 * open/closed state stable across clicking from topic to topic.
 * Same convention as getSitePrevNextButtonsScript: builds the element but
 * does not append it anywhere, so the caller decides where in the toolbar
 * it belongs.
 */
export function getSiteSidebarToggleScript(opts: { toggleTitle: string }): string {
  const toggleTitle = JSON.stringify(opts.toggleTitle);
  return `
  var siteSidebarToggleBtn = document.createElement('button');
  siteSidebarToggleBtn.id = '__site-sidebar-toggle-btn';
  siteSidebarToggleBtn.textContent = '\\u2630';
  siteSidebarToggleBtn.title = ${toggleTitle};
  siteSidebarToggleBtn.setAttribute('aria-label', ${toggleTitle});
  siteSidebarToggleBtn.style.cssText = btnStyle;
  siteSidebarToggleBtn.addEventListener('click', function() {
    document.body.classList.toggle('site-nav-collapsed');
  });
`;
}

/**
 * Docsite mode's mode-cycle toggle button (tree -> book -> site -> tree).
 * The button's label always names the CURRENT mode, not the mode a click
 * switches to -- an earlier version showed the target mode ("reads as a
 * destination button"), but in practice that reads backwards: seeing
 * "Site" while already in Book mode looks like the button is claiming
 * you're in Site mode, not offering to take you there. Relies on the
 * caller's own `currentMode` variable (declared once near the top of
 * getMapWebviewScript, updated by this same click handler) and `btnStyle`
 * (getToolbarScaffoldScript) already being in scope -- same closure
 * convention as the other button scripts in this file, and why this one
 * isn't reusable outside MapViewerProvider.ts's own script the way some of
 * the docsite-specific ones already aren't (getSiteNavClickHandlerScript's
 * switchToSitePage, for instance, also assumes an outer `vscode`).
 * Does not call toolbar.appendChild itself, same convention as
 * getSitePrevNextButtonsScript/getSiteSidebarToggleScript above.
 */
export function getModeToggleScript(opts: {
  switchModeTitle: string;
  modeOutline: string;
  modeBook: string;
  modeSite: string;
  switchModeMsgType: string; // raw, e.g. 'switchMode'
  switchingLabel: string;
}): string {
  const switchModeTitle = JSON.stringify(opts.switchModeTitle);
  const modeOutline = JSON.stringify(opts.modeOutline);
  const modeBook = JSON.stringify(opts.modeBook);
  const modeSite = JSON.stringify(opts.modeSite);
  const switchingLabel = JSON.stringify(opts.switchingLabel);
  return `
  var modeBtn = document.createElement('button');
  modeBtn.title = ${switchModeTitle};
  modeBtn.setAttribute('aria-label', ${switchModeTitle});
  modeBtn.style.cssText = btnStyle;
  function nextMapMode(m) {
    return m === 'tree' ? 'site' : m === 'site' ? 'book' : 'tree';
  }
  function modeLabel(m) {
    return m === 'book' ? ${modeBook} : m === 'site' ? ${modeSite} : ${modeOutline};
  }
  function updateModeLabel() {
    modeBtn.textContent = modeLabel(currentMode);
  }
  updateModeLabel();
  // Shared with applyModeStage (MapViewerProvider.ts, same script scope):
  // whichever of the two runs second is what actually stops the OTHER from
  // firing late -- see the comment where applyModeStage clears this.
  var pendingSwitchOverlayTimer = null;
  // A large book's generateHtml (collectBookParts/wrapBookParts) runs
  // synchronously on the extension host and can take real time -- see
  // scripts/bench-book-render.js. The dimming below already shows a switch
  // is happening for a typical fast switch (outline/site, or a small book),
  // but past a beat, "dimmed and unresponsive" reads the same as "the
  // extension hung". This mirrors the full-reload path's own book-mode
  // placeholder (generateLoadingHtml/"Rendering book...") for that same
  // slow case, just as an overlay instead of a full document swap: delayed
  // so a fast switch never flashes it, appended as a CHILD of the OLD
  // #dita-content-root so applyModeStage's removal of that whole node is
  // what clears it away -- no separate teardown needed on the success path.
  function showPendingSwitchOverlay() {
    var cr = document.getElementById('dita-content-root');
    if (!cr) return;
    var overlay = document.createElement('div');
    overlay.className = 'dita-mode-switch-overlay';
    var spinner = document.createElement('div');
    spinner.className = 'dita-loading-spinner';
    spinner.setAttribute('role', 'status');
    spinner.setAttribute('aria-label', ${switchingLabel});
    var label = document.createElement('div');
    label.textContent = ${switchingLabel};
    overlay.appendChild(spinner);
    overlay.appendChild(label);
    cr.appendChild(overlay);
  }
  modeBtn.addEventListener('click', function() {
    // The label flips the instant this fires (optimistic -- it is what
    // makes the click feel like it landed), but the actual page only
    // catches up once the host's asynchronously-rendered stage comes back
    // over postMessage (applyModeStage, MapViewerProvider.ts). Left alone,
    // that gap reads as the button and the page disagreeing with each
    // other. modeBtn.disabled both gives a visible "switching" affordance
    // for that gap (paired with the dimming below) and doubles as a debounce:
    // a second click mid-flight is ignored rather than kicking off a second
    // switchMode request that could race the first one's reply. Cleared by
    // applyModeStage once the new stage actually lands (or, on the rare
    // render-failure fallback to a full reload, moot -- the reload replaces
    // this whole document, button included).
    if (modeBtn.disabled) return;
    var newMode = nextMapMode(currentMode);
    currentMode = newMode;
    updateModeLabel();
    modeBtn.disabled = true;
    var cr = document.getElementById('dita-content-root');
    if (cr) cr.classList.add('mode-switching');
    pendingSwitchOverlayTimer = setTimeout(showPendingSwitchOverlay, 400);
    vscode.postMessage({ type: '${opts.switchModeMsgType}', mode: newMode });
    // Safety net, not the normal path: applyModeStage (or a render-failure's
    // full reload, which replaces this whole document anyway) is what
    // ordinarily clears the disabled state. This just guards against the
    // button being stuck forever if the host throws before ever replying --
    // an unexpected host-side error rather than anything this feature's own
    // logic can produce, so a generous delay is fine.
    setTimeout(function() { modeBtn.disabled = false; }, 8000);
  });
`;
}

/**
 * The Book/Site sidebar's toolbar "Source" button and an Oxygen-style
 * right-click context menu on any sidebar topic row. The menu mirrors the
 * native DITA Map tree's context menu, acting on the row's own file without
 * switching page. Every row-scoped entry posts a single
 * {type: navContextMsgType, action, target} message -- the host validates
 * `target` against the map's own manifest and reads the trusted title/href
 * back from it, so no untrusted value (never mind a raw DITA href) is ever
 * placed in the DOM. The final group (Expand/Collapse All) acts in-page
 * through setAllSiteNavCollapsed, which
 * getSiteNavExpandCollapseAllButtonsScript declares in the same IIFE scope.
 *
 * Declares `siteOpenSourceBtn` for the caller to place, same build-always/
 * append-conditionally convention as the other toolbar scripts. The menu
 * reuses the image menu's CSS classes (plus `.dita-img-ctxmenu-sep`) so both
 * look alike; it needs `vscode` in scope. Group rows (topichead) carry no
 * data-site-target, so they never match the menu's selector.
 */
export function getSiteOpenSourceScript(opts: {
  openSourceMsgType: string;
  navContextMsgType: string;
  menuLabel: string;
  openMapLabel: string;
  oxygenLabel: string;
  revealLabel: string;
  findUnreferencedLabel: string;
  exportLabel: string;
  copyTitleLabel: string;
  copyHrefLabel: string;
  expandAllLabel: string;
  collapseAllLabel: string;
  buttonLabel: string;
  buttonTitle: string;
}): string {
  const msgType = JSON.stringify(opts.openSourceMsgType);
  const navMsgType = JSON.stringify(opts.navContextMsgType);
  const buttonLabel = JSON.stringify(opts.buttonLabel);
  const buttonTitle = JSON.stringify(opts.buttonTitle);
  // Groups are serialized as plain data (labels are host-supplied, trusted
  // l10n text), so building the menu in the webview never interpolates an
  // untrusted string into executable script. `action` is posted to the host;
  // `local` is handled in-page. Separator lines are drawn between groups.
  const menuGroups = [
    [
      { action: 'openMapSource', label: opts.openMapLabel },
      { action: 'openSource', label: opts.menuLabel },
      { action: 'openWithOxygen', label: opts.oxygenLabel },
    ],
    [
      { action: 'revealInExplorer', label: opts.revealLabel },
      { action: 'findUnreferenced', label: opts.findUnreferencedLabel },
    ],
    [{ action: 'exportHtml', label: opts.exportLabel }],
    [
      { action: 'copyTitle', label: opts.copyTitleLabel },
      { action: 'copyHref', label: opts.copyHrefLabel },
    ],
    [
      { local: 'expandAll', label: opts.expandAllLabel },
      { local: 'collapseAll', label: opts.collapseAllLabel },
    ],
  ];
  return `
  function requestOpenTopicSource(target) {
    if (target) vscode.postMessage({ type: ${msgType}, target: target });
  }

  var siteOpenSourceBtn = document.createElement('button');
  siteOpenSourceBtn.id = '__site-open-source-btn';
  siteOpenSourceBtn.textContent = ${buttonLabel};
  siteOpenSourceBtn.title = ${buttonTitle};
  siteOpenSourceBtn.setAttribute('aria-label', ${buttonTitle});
  siteOpenSourceBtn.style.cssText = btnStyle;
  siteOpenSourceBtn.addEventListener('click', function() {
    var active = document.querySelector('.site-nav-link.active[data-site-target]');
    if (active) requestOpenTopicSource(active.getAttribute('data-site-target'));
  });

  var NAV_CTX_GROUPS = ${JSON.stringify(menuGroups)};
  var srcCtxMenu = null;
  function closeSrcCtxMenu() {
    if (!srcCtxMenu) return;
    srcCtxMenu.remove();
    srcCtxMenu = null;
  }
  function runNavItem(entry, target) {
    if (entry.local === 'expandAll') { setAllSiteNavCollapsed(false); return; }
    if (entry.local === 'collapseAll') { setAllSiteNavCollapsed(true); return; }
    vscode.postMessage({ type: ${navMsgType}, action: entry.action, target: target });
  }
  document.addEventListener('contextmenu', function(e) {
    var link = e.target && e.target.closest ? e.target.closest('.site-nav-link[data-site-target]') : null;
    if (!link) { closeSrcCtxMenu(); return; }
    e.preventDefault();
    closeSrcCtxMenu();
    var target = link.getAttribute('data-site-target');
    var menu = document.createElement('div');
    menu.className = 'dita-img-ctxmenu';
    NAV_CTX_GROUPS.forEach(function(group, gi) {
      if (gi > 0) {
        var sep = document.createElement('div');
        sep.className = 'dita-img-ctxmenu-sep';
        menu.appendChild(sep);
      }
      group.forEach(function(entry) {
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'dita-img-ctxmenu-item';
        item.textContent = entry.label;
        item.addEventListener('click', function(ev) {
          ev.stopPropagation();
          closeSrcCtxMenu();
          runNavItem(entry, target);
        });
        menu.appendChild(item);
      });
    });
    document.body.appendChild(menu);
    // Clamped to the viewport once its real size is known, like the image menu.
    menu.style.left = Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 4) + 'px';
    menu.style.top = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 4) + 'px';
    srcCtxMenu = menu;
  });
  document.addEventListener('click', function(e) {
    if (srcCtxMenu && !srcCtxMenu.contains(e.target)) closeSrcCtxMenu();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeSrcCtxMenu();
  });
`;
}

/**
 * Puts the finished toolbar on the page as the top bar: the first row, so it
 * never covers what is under it.
 *
 * In a docsite/book page (body has `site-shell`, see wrapShell) the bar is the
 * first row of the page's column, above any template header, and the content
 * pane scrolls beneath it. Its left side carries the map's title
 * (window.__mapTitle) when there is room and no template header already shows
 * a title; on a narrow bar the title hides (container query in styles.css)
 * and the buttons wrap.
 *
 * Every other page (outline view; a book with an empty map) is one long
 * scrolling document, so there the bar is a full-width first ROW (`topbar--top`)
 * of a one-viewport-tall flex-column body, and the content region scrolls in its
 * own area beneath it. That keeps the vertical scrollbar on the content, below
 * the bar's row and at the window's right edge, instead of running beside a
 * fixed bar and pushing its right-aligned buttons left. No title on that bar:
 * outline view's own heading already shows it.
 *
 * Define-then-call: the caller inserts this where it used to append the
 * toolbar to the body.
 */
export function getToolbarPlacementScript(): string {
  return `
  function placeToolbar(tb) {
    var shell = document.body.classList.contains('site-shell');
    var bar = document.createElement('div');
    bar.id = '__topbar';
    var title = typeof window.__mapTitle === 'string' ? window.__mapTitle : '';
    if (shell && title && !document.querySelector('.tpl-header')) {
      var t = document.createElement('span');
      t.className = 'topbar-title';
      t.textContent = title;
      t.title = title;
      bar.appendChild(t);
    }
    tb.classList.add('in-topbar');
    bar.appendChild(tb);
    if (!shell) bar.classList.add('topbar--top');
    document.body.insertBefore(bar, document.body.firstChild);
  }
  placeToolbar(toolbar);
`;
}

/**
 * Template dropdown for docsite/book view. Declares `templateSel` for the
 * caller to place. The first option ("no template", value '') is always
 * present; picking one posts its id and the host re-renders the page with
 * that template's style (a full render, like a theme switch).
 */
export function getTemplateSelectScript(opts: {
  msgType: string;
  title: string;
  noneLabel: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  selected: string;
}): string {
  const msgType = JSON.stringify(opts.msgType);
  const title = JSON.stringify(opts.title);
  const options = JSON.stringify([{ value: '', label: opts.noneLabel }, ...opts.options]);
  const selected = JSON.stringify(opts.selected);
  return `
  var templateSel = document.createElement('select');
  templateSel.id = '__template-select';
  templateSel.title = ${title};
  templateSel.setAttribute('aria-label', ${title});
  // text-align-last is what centers a <select>'s displayed value.
  templateSel.style.cssText = 'max-width:96px;text-align:center;text-align-last:center;' + ddStyle;
  var templateOptions = ${options};
  for (var ti = 0; ti < templateOptions.length; ti++) {
    var tOpt = document.createElement('option');
    tOpt.value = templateOptions[ti].value;
    tOpt.textContent = templateOptions[ti].label;
    if (templateOptions[ti].value === ${selected}) tOpt.selected = true;
    templateSel.appendChild(tOpt);
  }
  templateSel.addEventListener('change', function() {
    vscode.postMessage({ type: ${msgType}, id: templateSel.value });
  });
`;
}
