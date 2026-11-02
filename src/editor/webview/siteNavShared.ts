// Sidebar scripts both Book and Site mode use: keyboard model, sidebar updates, fold state, expand / collapse all, the fold toggle.
// Split out of siteNavScripts.ts, which re-exports every name here.

/**
 * Arrow-key navigation for the sidebar tree, book and docsite mode alike (the
 * ARIA tree pattern; the markup is renderSiteNavTreeHtml's, whose roving
 * tabindex makes the whole tree one Tab stop).
 *
 *   Down / Up      next / previous VISIBLE row (rows inside a collapsed branch
 *                  are not rows)
 *   Right          collapsed parent: expand; expanded parent: first child
 *   Left           expanded parent: collapse; anything else: the parent row
 *   Home / End     first / last visible row
 *   Enter / Space  a topic link: open it; a group: fold or unfold it
 *
 * The decision is siteNavKeyAction, a pure function over a simplified model of
 * the visible rows, so the unit tests run the same code the page does. The
 * rest is glue that builds that model from the DOM and carries the action out
 * -- and carries it out with the CONTROLS THE MOUSE USES: a fold is a click on
 * the row's toggle button, opening a topic is a click on its link. That keeps
 * one implementation of "fold a branch and remember it" (getSiteNavToggleScript,
 * which also reports the state to the extension) and of "open a page" (each
 * mode's own click handling), instead of a keyboard copy that could drift.
 *
 * Enter on a link, and Enter/Space on the toggle button, are left to the
 * browser: they already click, and handling them here as well would run the
 * action twice.
 *
 * Also keeps two things about the tree in step with what the other scripts do
 * to it: the Tab stop follows focus (and moves off a row whose branch was just
 * collapsed by mouse, so the tree can never end up with its only Tab stop
 * hidden), and aria-current follows the `active` class, however many places
 * change that.
 */
export function getSiteNavKeyboardScript(): string {
  return `
  // rows: the visible rows, top to bottom, as { hasChildren, expanded, parent }
  // where parent is the index of the parent row in the same array (-1 at the
  // top level). Returns { type, index } -- focus that row, expand it, collapse
  // it, or activate it -- or null when the key means nothing there.
  function siteNavKeyAction(rows, index, key) {
    var row = rows[index];
    if (!row) return null;
    switch (key) {
      case 'ArrowDown':
        return index + 1 < rows.length ? { type: 'focus', index: index + 1 } : null;
      case 'ArrowUp':
        return index > 0 ? { type: 'focus', index: index - 1 } : null;
      case 'Home':
        return index !== 0 ? { type: 'focus', index: 0 } : null;
      case 'End':
        return index !== rows.length - 1 ? { type: 'focus', index: rows.length - 1 } : null;
      case 'ArrowRight':
        if (!row.hasChildren) return null;
        if (!row.expanded) return { type: 'expand', index: index };
        return index + 1 < rows.length && rows[index + 1].parent === index ? { type: 'focus', index: index + 1 } : null;
      case 'ArrowLeft':
        if (row.hasChildren && row.expanded) return { type: 'collapse', index: index };
        return row.parent >= 0 ? { type: 'focus', index: row.parent } : null;
      case 'Enter':
      case ' ':
        return { type: 'activate', index: index };
    }
    return null;
  }

  // The element of a row that takes focus: its link, or a group's label -- not
  // the <li>, which wraps the whole subtree, and not the toggle, which is for
  // the mouse.
  function siteNavFocusEl(li) {
    for (var i = 0; i < li.children.length; i++) {
      var c = li.children[i];
      if (c.classList.contains('site-nav-link') || c.classList.contains('site-nav-group-label')) return c;
    }
    return null;
  }

  function siteNavToggleBtn(li) {
    for (var i = 0; i < li.children.length; i++) {
      if (li.children[i].classList.contains('site-nav-toggle')) return li.children[i];
    }
    return null;
  }

  function siteNavHasCollapsedAncestor(li) {
    for (var p = li.parentElement; p; p = p.parentElement) {
      if (p.classList && p.classList.contains('site-nav-item') && p.classList.contains('collapsed')) return true;
    }
    return false;
  }

  // The visible rows as parallel arrays: the <li>s, and the model
  // siteNavKeyAction takes.
  function siteNavVisibleRows() {
    var all = document.querySelectorAll('.site-nav-tree .site-nav-item');
    var lis = [];
    var model = [];
    for (var i = 0; i < all.length; i++) {
      var li = all[i];
      if (siteNavHasCollapsedAncestor(li)) continue;
      var parentLi = li.parentElement ? li.parentElement.closest('.site-nav-item') : null;
      var hasChildren = li.classList.contains('has-children');
      lis.push(li);
      model.push({
        hasChildren: hasChildren,
        expanded: hasChildren && !li.classList.contains('collapsed'),
        parent: parentLi ? lis.indexOf(parentLi) : -1,
      });
    }
    return { lis: lis, model: model };
  }

  document.addEventListener('keydown', function(e) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    var t = e.target;
    if (!t || !t.closest) return;
    var li = t.closest('.site-nav-tree .site-nav-item');
    if (!li) return;
    var rows = siteNavVisibleRows();
    var index = rows.lis.indexOf(li);
    if (index < 0) return;
    var action = siteNavKeyAction(rows.model, index, e.key);
    if (!action) return;
    var el = siteNavFocusEl(rows.lis[action.index]);
    if (action.type === 'activate') {
      // Native: Enter on a link and Enter/Space on the toggle button click on their own.
      if (t.tagName === 'BUTTON' || (e.key === 'Enter' && t.tagName === 'A')) return;
      e.preventDefault();
      var toggle = siteNavToggleBtn(li);
      if (el && el.classList.contains('site-nav-link')) el.click();
      else if (toggle) toggle.click();
      return;
    }
    e.preventDefault();
    if (action.type === 'focus') {
      if (el) el.focus();
    } else {
      var btn = siteNavToggleBtn(rows.lis[action.index]);
      if (btn) btn.click();
    }
  });

  // One Tab stop for the whole tree, and it follows focus.
  document.addEventListener('focusin', function(e) {
    var t = e.target;
    if (!t || !t.closest || !t.closest('.site-nav-tree')) return;
    if (!(t.classList.contains('site-nav-link') || t.classList.contains('site-nav-group-label'))) return;
    var stops = document.querySelectorAll('.site-nav-tree [tabindex="0"]');
    for (var i = 0; i < stops.length; i++) stops[i].setAttribute('tabindex', '-1');
    t.setAttribute('tabindex', '0');
  });

  // A fold click can hide the row that holds the only Tab stop; move the stop
  // to the nearest row that is still visible. Runs after the toggle handler
  // (registered earlier), and after expand/collapse-all, which are clicks too.
  document.addEventListener('click', function() {
    var stop = document.querySelector('.site-nav-tree [tabindex="0"]');
    if (!stop) return;
    var li = stop.closest('.site-nav-item');
    if (!li || !siteNavHasCollapsedAncestor(li)) return;
    var visible = li;
    for (var p = li.parentElement; p; p = p.parentElement) {
      if (p.classList && p.classList.contains('site-nav-item') && !siteNavHasCollapsedAncestor(p)) { visible = p; break; }
    }
    var el = siteNavFocusEl(visible);
    if (!el) return;
    stop.setAttribute('tabindex', '-1');
    el.setAttribute('tabindex', '0');
  });

  // aria-current follows the 'active' class. Three places flip that class
  // (a docsite page switch, a book-mode sidebar click, book-mode scroll sync);
  // watching the class keeps the attribute right without a fourth copy of the
  // rule in each. The server sets it on first render (renderSiteNavTreeHtml).
  (function() {
    var nav = document.querySelector('.site-nav');
    if (!nav || typeof MutationObserver !== 'function') return;
    new MutationObserver(function(records) {
      for (var i = 0; i < records.length; i++) {
        var el = records[i].target;
        if (!el.classList || !el.classList.contains('site-nav-link')) continue;
        if (el.classList.contains('active')) el.setAttribute('aria-current', 'page');
        else el.removeAttribute('aria-current');
      }
    }).observe(nav, { attributes: true, subtree: true, attributeFilter: ['class'] });
  })();
`;
}

/**
 * The webview half of MSG_UPDATE_SIDEBAR: defines applySidebarUpdate(html),
 * which puts a freshly rendered sidebar tree (renderSiteNavTreeHtml) in place.
 *
 * Always a full innerHTML replace of the tree, never a diff -- the sidebar is
 * cheap to rebuild -- and never a replace of the .site-nav ELEMENT itself
 * (nav.outerHTML = ...): getSiteSidebarResizerScript captured that node once
 * at script-init time and never re-queries it, so replacing it would leave
 * the resizer silently pointing at a detached element.
 *
 * Book mode's .site-nav holds nothing but the tree, so its inner content is
 * the thing to replace. Site mode's does not: getBookSearchScript inserts the
 * search box into it and moves the original links into .site-nav-links, so
 * replacing the nav's whole inner content there would delete the search box
 * and any results with it. Only the link list is replaced. Either way the
 * prev/next buttons derive their targets from the .site-nav-link elements
 * (updatePrevNextButtons), which are new nodes now.
 *
 * `site` selects which half of the nav is replaced. MapViewerProvider always
 * passes true now that getMapWebviewScript is a superset script (it no longer
 * knows the mode at generation time): site:true replaces only .site-nav-links
 * where a search box exists, and falls back to the whole nav otherwise -- so
 * it is correct for book mode too, where there is no search box. The prev/
 * next re-derivation (updatePrevNextButtons) is declared by the always-
 * injected getSiteNavClickHandlerScript, so calling it from here is safe in
 * every mode. The `site: false` shape is kept
 * for the isolated book-style unit test. Extracted so it can be unit-tested;
 * the message listener that calls it lives in MapViewerProvider.ts.
 */
export function getSidebarUpdateScript(opts: { site: boolean }): string {
  return `
  function applySidebarUpdate(html) {
    var nav = document.querySelector('.site-nav');
    if (!nav) return;
    // Replacing the tree destroys the row that has keyboard focus, and with it
    // the reader's place in the sidebar. Note which row it was (by the same
    // stable id that keys the persisted fold state) and put focus on that row
    // of the new tree; focus that was not in the sidebar is left where it is.
    var focusedId = null;
    var current = document.activeElement;
    if (current && nav.contains(current)) {
      var focusedRow = current.closest('.site-nav-item');
      if (focusedRow) focusedId = focusedRow.getAttribute('data-nav-id');
    }
    ${opts.site
      ? `var links = nav.querySelector('.site-nav-links');
    (links || nav).innerHTML = html;
    updatePrevNextButtons();`
      : `nav.innerHTML = html;`}
    if (focusedId !== null) {
      var rows = nav.querySelectorAll('.site-nav-item');
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].getAttribute('data-nav-id') !== focusedId) continue;
        for (var k = 0; k < rows[i].children.length; k++) {
          var c = rows[i].children[k];
          if (c.classList.contains('site-nav-link') || c.classList.contains('site-nav-group-label')) { c.focus(); break; }
        }
        break;
      }
    }
  }
`;
}

/**
 * Sidebar panel's initial open/collapsed state (nested-fold-and-highlight-
 * plan.md item 6) -- site mode starts open (unchanged), book mode starts
 * collapsed. Book mode already shows every topic's content in one page the
 * moment it opens (unlike site mode, which shows nothing useful until a
 * topic is picked); leaving its sidebar open by default made book mode
 * look like a second copy of site mode on first look, when the actual
 * point of book mode is to read, not to navigate. Matches a PDF reader's
 * own bookmark-panel default: closed until the reader asks for it.
 *
 * Deliberately session-only, the same way the sidebar toggle button
 * itself already is (see getSiteSidebarToggleScript's own comment: a
 * plain class flip on body, nothing posted to the extension host, nothing
 * read back on the next generateHtml) -- reopening this document starts
 * collapsed again in book mode regardless of whether the reader opened
 * the panel last time, same as a PDF reader's own panel does not remember
 * being opened across closing and reopening the file. This deliberately
 * does NOT reuse item 3's per-document globalState persistence: that
 * store keys individual fold-node ids that default to "expanded", so
 * bolting one more per-document boolean onto it for "was the whole panel
 * open" would be a second, differently-shaped piece of state riding along
 * on the same key for no behavior a reader asked for.
 *
 * A pure function of `mode` alone (no DOM, no vscode API) so it is
 * testable directly rather than only through generateHtml's own HTML
 * string -- same reasoning as clampSidebarWidth living here instead of
 * inline in getSiteSidebarResizerScript.
 */
export function getInitialSidebarBodyClass(mode: 'tree' | 'book' | 'site'): string {
  return mode === 'book' ? `mode-${mode} site-nav-collapsed` : `mode-${mode}`;
}

/**
 * Docsite mode's sidebar expand/collapse toggle (Oxygen-style triangle in
 * front of a parent entry) -- click delegation only, same one-listener-per-
 * concern pattern as the .site-nav-link and [data-dita-book-xref] listeners
 * in getSiteNavClickHandlerScript above (a separate function, and a
 * separate document-level listener, rather than folded into that one,
 * since this is a genuinely different concern: it never posts a message to
 * the extension host or touches which page is showing, only whether a
 * branch of the sidebar's own tree is visible).
 *
 * Purely a `collapsed` class flip on the entry's own <li class="site-nav-
 * item"> -- media/styles.css hides `.site-nav-item.collapsed >
 * .site-nav-children` (the direct child <ul>, so a collapsed grandparent's
 * hidden subtree doesn't need this script to separately walk into and
 * re-hide already-hidden descendants; the cascade is free). No state is
 * kept anywhere outside that class: renderSiteNavHtml (ditaRenderUtils.ts)
 * is called exactly once per mode-switch/refresh and always renders every
 * branch open, so collapsing a branch and then switching pages (which only
 * ever replaces the topic content pane, never re-renders the sidebar --
 * see renderSiteNavHtml's own doc comment) leaves it collapsed, same as a
 * real file explorer.
 *
 * The toggle button itself (renderSiteNavHtml) carries its own expand/
 * collapse aria-label strings as data-expand-label/data-collapse-label so
 * this script doesn't need its own copies threaded in as opts just to
 * flip aria-label text along with aria-expanded.
 */
/**
 * The one place that actually applies a collapsed/expanded state to a
 * sidebar <li class="site-nav-item">. Emitted once per webview script and
 * consumed by BOTH getSiteNavToggleScript (one item, on its own toggle
 * click) and getSiteNavExpandCollapseAllButtonsScript (every item at once)
 * -- a collapse touches four things that must move together (the item's
 * own `collapsed` class, aria-expanded on both the item and its toggle,
 * and the toggle's aria-label), and two copies of that bookkeeping would
 * drift the moment one of them gained a fifth. Callers must emit this
 * before/alongside either consumer; getMapWebviewScript does.
 *
 * Purely a `collapsed` class flip -- media/styles.css hides
 * `.site-nav-item.collapsed > .site-nav-children` (the DIRECT child <ul>),
 * so a collapsed ancestor's already-hidden subtree needs no separate walk;
 * the cascade is free. That is also why collapse-all can set the class on
 * every item indiscriminately without worrying about order.
 */
export function getSiteNavCollapseStateHelperScript(opts: { reportCollapseMsgType?: string } = {}): string {
  // reportSiteNavCollapseState -- item 3's persistence side channel. Called
  // once per user action (a toggle click, or a whole expand/collapse-all
  // sweep), not once per item mutated: it re-scans the DOM for the FULL
  // current set of collapsed ids and posts that whole set, rather than
  // sending an incremental {id, collapsed} delta per change. A whole-set
  // replace is simpler on the host side (one array write, no partial-
  // update bookkeeping to keep consistent with what a full render would
  // have produced) and collapse-all would otherwise fire the same number
  // of messages as items in the tree instead of one.
  //
  // Only emitted when a message type is supplied -- getSiteNavToggleScript
  // and getSiteNavExpandCollapseAllButtonsScript both guard their own call
  // to it with `typeof reportSiteNavCollapseState === 'function'`, so a
  // caller that renders a sidebar with no persistence wired up (or a test
  // exercising the toggle/batch scripts in isolation) gets the same
  // collapse/expand behavior as before this feature, just without the
  // report.
  const report = opts.reportCollapseMsgType
    ? `
  function reportSiteNavCollapseState() {
    var ids = [];
    var items = document.querySelectorAll('.site-nav-item.has-children[data-nav-id]');
    for (var i = 0; i < items.length; i++) {
      // 'nav-auto-expanded': opened by revealing the active page, not by the
      // reader (see expandSiteNavAncestorsOf). It is open on screen but the
      // reader's saved choice for it is still "collapsed", and since this
      // reports the WHOLE DOM state, counting it as expanded here would
      // overwrite that choice the next time they touch any chevron.
      if (items[i].classList.contains('collapsed') || items[i].classList.contains('nav-auto-expanded')) {
        ids.push(items[i].getAttribute('data-nav-id'));
      }
    }
    vscode.postMessage({ type: ${JSON.stringify(opts.reportCollapseMsgType)}, ids: ids });
  }
`
    : '';
  return `
  // Opens every collapsed ancestor of a sidebar row -- the one place that
  // knows how (site mode's page switch and book mode's scroll sync both
  // reveal a row this way). Returns whether it opened anything. What it
  // opens is marked auto-expanded so the persisted fold state can still say
  // "collapsed" for it -- see reportSiteNavCollapseState.
  function expandSiteNavAncestorsOf(navItem) {
    var changed = false;
    var parent = navItem && navItem.parentElement && navItem.parentElement.closest
      ? navItem.parentElement.closest('.site-nav-item.collapsed')
      : null;
    while (parent) {
      setSiteNavItemCollapsed(parent, false, true);
      changed = true;
      parent = parent.parentElement && parent.parentElement.closest
        ? parent.parentElement.closest('.site-nav-item.collapsed')
        : null;
    }
    return changed;
  }

  // autoExpanded is only ever true from expandSiteNavAncestorsOf. Every
  // other caller (a toggle click, expand-all, collapse-all) is the reader
  // deciding, which replaces the marker: it is cleared here.
  function setSiteNavItemCollapsed(item, collapsed, autoExpanded) {
    if (!item) return;
    if (collapsed) item.classList.add('collapsed');
    else item.classList.remove('collapsed');
    if (autoExpanded && !collapsed) item.classList.add('nav-auto-expanded');
    else item.classList.remove('nav-auto-expanded');
    // Webhelp mode: mirror the fold state onto the tree class a template's css
    // reads. topicref is only ever present on a webhelp-rendered row, so in
    // own mode this is a no-op -- our collapse still rides on .collapsed and
    // aria-expanded. (webhelp-compat-plan.md §2.2: one node, one JS.)
    if (item.classList.contains('topicref')) {
      if (collapsed) item.classList.remove('expanded');
      else item.classList.add('expanded');
    }
    item.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    var toggle = item.querySelector(':scope > .site-nav-toggle');
    if (!toggle) return;
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    var label = collapsed ? toggle.getAttribute('data-expand-label') : toggle.getAttribute('data-collapse-label');
    if (label) toggle.setAttribute('aria-label', label);
  }
${report}`;
}

// Expand All / Collapse All icons -- Oxygen's own icon (two overlapping
// "window" squares with a blue +/- badge) is the semantic reference for
// what these two actions should read as, not something copied verbatim:
// Oxygen's version is a fixed-color raster-style glyph (hardcoded gray/
// white/blue), which would sit as a flat, wrong-toned image next to
// every other button in this toolbar, all of which are themed through
// currentColor / the same --vscode-dropdown-* variables btnStyle itself
// uses (font size, width, tag tooltips, sidebar toggle, prev/next,
// search). These two keep that same two-overlapping-squares-plus-badge
// silhouette -- legible as "more than one node, all at once" the same
// way Oxygen's is -- but as inline <svg> using currentColor for the
// outline and the button's own --vscode-dropdown-background for the
// front square's fill, so the icon repaints itself with every theme
// switch exactly like the rest of the toolbar already does, rather than
// carrying a fixed palette of its own. Inline markup (not a data: URI on
// an <img>, this function's own previous approach) is what makes
// currentColor/var(...) resolution possible at all: an <img>'s SVG
// renders in its own separate resource context and cannot see the
// page's CSS custom properties or inherited color.
const NAV_ALL_ICON_SQUARES =
  '<rect x="1.5" y="1.5" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.1"/>' +
  '<rect x="6.5" y="6.5" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.1" fill="var(--vscode-dropdown-background,#333)"/>';

const EXPAND_ALL_ICON_SVG =
  `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${NAV_ALL_ICON_SQUARES}` +
  '<path d="M10.5 8.7V12.3M8.7 10.5H12.3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

const COLLAPSE_ALL_ICON_SVG =
  `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${NAV_ALL_ICON_SQUARES}` +
  '<path d="M8.7 10.5H12.3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

/**
 * Expand-all / collapse-all: two separate buttons (not one tri-state
 * toggle -- with a partly-expanded tree there is no defensible answer to
 * which direction a single button should go, and guessing wrong undoes
 * the reader's own work). Built but NOT appended to the toolbar here,
 * same convention as getToolbarFontWidthTagTooltipsButtonsScript and
 * getSitePrevNextButtonsScript: the caller decides placement.
 *
 * Operates on `.site-nav-item.has-children` only -- a leaf item has no
 * toggle and no children <ul>, so giving it a `collapsed` class would be
 * inert but misleading in the DOM. Shared verbatim by book and site mode:
 * both now render the same sidebar markup (renderSiteNavTreeHtml), so this
 * takes no mode parameter and needs no per-mode branch.
 */
export function getSiteNavExpandCollapseAllButtonsScript(opts: { expandAllTitle: string; collapseAllTitle: string }): string {
  const expandAllTitle = JSON.stringify(opts.expandAllTitle);
  const collapseAllTitle = JSON.stringify(opts.collapseAllTitle);
  return `
  function setAllSiteNavCollapsed(collapsed) {
    var items = document.querySelectorAll('.site-nav-item.has-children');
    for (var i = 0; i < items.length; i++) setSiteNavItemCollapsed(items[i], collapsed);
    if (typeof reportSiteNavCollapseState === 'function') reportSiteNavCollapseState();
  }

  var siteExpandAllBtn = document.createElement('button');
  siteExpandAllBtn.id = '__site-expand-all-btn';
  // aria-hidden on the <svg> itself (baked into the markup above) plus no
  // separate alt text here: the button's own title/aria-label already
  // carry the accessible name, so a screen reader would otherwise
  // announce it twice.
  siteExpandAllBtn.innerHTML = '${EXPAND_ALL_ICON_SVG}';
  siteExpandAllBtn.title = ${expandAllTitle};
  siteExpandAllBtn.setAttribute('aria-label', ${expandAllTitle});
  siteExpandAllBtn.style.cssText = btnStyle + 'justify-content:center;';
  siteExpandAllBtn.addEventListener('click', function() { setAllSiteNavCollapsed(false); });

  var siteCollapseAllBtn = document.createElement('button');
  siteCollapseAllBtn.id = '__site-collapse-all-btn';
  siteCollapseAllBtn.innerHTML = '${COLLAPSE_ALL_ICON_SVG}';
  siteCollapseAllBtn.title = ${collapseAllTitle};
  siteCollapseAllBtn.setAttribute('aria-label', ${collapseAllTitle});
  siteCollapseAllBtn.style.cssText = btnStyle + 'justify-content:center;';
  siteCollapseAllBtn.addEventListener('click', function() { setAllSiteNavCollapsed(true); });
`;
}

export function getSiteNavToggleScript(): string {
  return `
  document.addEventListener('click', function(e) {
    var toggle = e.target.closest ? e.target.closest('.site-nav-toggle') : null;
    if (!toggle) return;
    e.preventDefault();
    var item = toggle.closest ? toggle.closest('.site-nav-item') : null;
    if (!item) return;
    // Reads the current state off the class rather than using
    // classList.toggle's return value, so the actual state change goes
    // through the one shared setter (setSiteNavItemCollapsed) that
    // expand-all/collapse-all uses too.
    setSiteNavItemCollapsed(item, !item.classList.contains('collapsed'));
    if (typeof reportSiteNavCollapseState === 'function') reportSiteNavCollapseState();
  });
`;
}
