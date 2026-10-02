// Webview scripts for the sidebar tree navigation -- keyboard model, click
// handlers, book/site scroll + outline sync, collapse-state helpers, the
// expand-all/collapse-all buttons, and the fold toggle. Moved verbatim from
// ditaRenderUtils.ts (P5 pure refactor). Self-contained leaf: getSiteNav-
// ClickHandlerScript composes getSiteHistoryModelScript() in-module, and the
// three private icon consts feed only getSiteNavExpandCollapseAllButtonsScript
// here; none of it reaches back through the ditaRenderUtils barrel.

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
 * The back/forward history of docsite mode, as plain functions over plain
 * data: `{ entries: [{ target, scrollTop }], index }`, where target is a
 * page's absolute path (the same string as a sidebar link's data-site-target)
 * and scrollTop is where the reader was on it when they last left.
 *
 * Immutable -- every function returns a new history and never touches its
 * argument -- because the value is also what gets persisted through
 * vscode.setState, and because the caller's rule is "compute the new history,
 * then commit it once the navigation is really happening".
 *
 * Defined as a script (rather than TypeScript the webview script would have
 * to duplicate) so unit tests run the very code the webview runs; it uses no
 * DOM. What it does NOT know is whether a page still exists -- the map may
 * have been edited since the entry was made -- so the callers that need to
 * know pass `exists`, and entries that fail it are skipped over, not deleted:
 * a page that comes back (an undone edit) is reachable again.
 */
export function getSiteHistoryModelScript(): string {
  return `
  var SITE_HISTORY_LIMIT = 100;

  function siteHistoryCreate(target) {
    return { entries: [{ target: target, scrollTop: 0 }], index: 0 };
  }

  // Keeps the newest SITE_HISTORY_LIMIT entries; the index follows its entry.
  function siteHistoryClamp(entries, index) {
    var drop = entries.length - SITE_HISTORY_LIMIT;
    if (drop <= 0) return { entries: entries, index: index };
    return { entries: entries.slice(drop), index: Math.max(0, index - drop) };
  }

  // A new page reached by navigating (as opposed to stepping through the
  // history): forward entries are discarded, as in a browser, and the page
  // being left remembers where the reader was on it.
  function siteHistoryPush(h, target, leavingScrollTop) {
    if (h.entries[h.index].target === target) return h;
    var entries = h.entries.slice(0, h.index + 1);
    entries[h.index] = { target: entries[h.index].target, scrollTop: leavingScrollTop };
    entries.push({ target: target, scrollTop: 0 });
    return siteHistoryClamp(entries, entries.length - 1);
  }

  // The nearest entry in a direction (-1 back, +1 forward) that is worth
  // going to: its page still exists, and it is not the page already showing.
  function siteHistoryFind(h, dir, exists) {
    var here = h.entries[h.index].target;
    for (var i = h.index + dir; i >= 0 && i < h.entries.length; i += dir) {
      var t = h.entries[i].target;
      if (t !== here && exists(t)) return i;
    }
    return -1;
  }

  function siteHistoryCan(h, dir, exists) {
    return siteHistoryFind(h, dir, exists) >= 0;
  }

  // Moves through the history. Returns null when there is nowhere to go;
  // otherwise the new history and the entry to land on (with the scroll
  // position it was left at). The page being left records its own position,
  // which is what stepping the other way restores.
  function siteHistoryStep(h, dir, exists, leavingScrollTop) {
    var i = siteHistoryFind(h, dir, exists);
    if (i < 0) return null;
    var entries = h.entries.slice();
    entries[h.index] = { target: entries[h.index].target, scrollTop: leavingScrollTop };
    return { history: { entries: entries, index: i }, entry: entries[i] };
  }

  // What comes back from webview state after a reload is only trusted as far
  // as it checks out, and only if its current entry is the page that came up
  // (a theme switch reloads the same page; anything else means it is stale).
  function siteHistoryRestore(raw, activeTarget) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries) || raw.entries.length === 0) {
      return siteHistoryCreate(activeTarget);
    }
    var index = raw.index;
    if (typeof index !== 'number' || index % 1 !== 0 || index < 0 || index >= raw.entries.length) {
      return siteHistoryCreate(activeTarget);
    }
    var entries = [];
    for (var i = 0; i < raw.entries.length; i++) {
      var e = raw.entries[i];
      if (!e || typeof e.target !== 'string' || typeof e.scrollTop !== 'number' || !isFinite(e.scrollTop)) {
        return siteHistoryCreate(activeTarget);
      }
      entries.push({ target: e.target, scrollTop: e.scrollTop });
    }
    var clamped = siteHistoryClamp(entries, index);
    if (clamped.entries[clamped.index].target !== activeTarget) return siteHistoryCreate(activeTarget);
    return clamped;
  }
`;
}

/**
 * Docsite mode's sidebar click handler -- flips which .site-nav-link
 * carries the `active` class (client-side, no server round-trip for that
 * part; see renderSiteNavHtml's own comment for why) and asks the
 * extension host to render the newly-selected topic. Extracted into its
 * own testable function rather than left inline in getMapWebviewScript
 * (MapViewerProvider.ts, which isn't reachable from mocha -- it imports
 * vscode) for the same reason getSearchOverlayScript/
 * getProfilingFilterScript above are: new Function(script) is the cheapest
 * check that still catches a broken template literal.
 */
export function getSiteNavClickHandlerScript(opts: { switchSitePageMsgType: string }): string {
  return `
  ${getSiteHistoryModelScript()}

  // Back/forward history (getSiteHistoryModelScript above). null until the
  // deferred init at the bottom of this script, which is when the active link
  // exists to seed it from.
  var siteHistory = null;

  // The content pane, not the window, is what scrolls (#dita-content-root.
  // site-main has its own overflow-y). Absent in the few fake documents that
  // exercise this script without one.
  function siteScrollTop() {
    var scroller = document.getElementById('dita-content-root');
    return scroller ? scroller.scrollTop : 0;
  }

  function siteLinkFor(target) {
    var links = document.querySelectorAll('.site-nav-link');
    for (var i = 0; i < links.length; i++) {
      if (links[i].getAttribute('data-site-target') === target) return links[i];
    }
    return null;
  }

  function siteHistoryExists(target) {
    return !!siteLinkFor(target);
  }

  // Kept across a full reload (theme switch, manual refresh, a trip through
  // another mode) in the webview's own state, next to whatever else is there.
  function persistSiteHistory() {
    if (!siteHistory || typeof vscode.setState !== 'function') return;
    var state = (typeof vscode.getState === 'function' && vscode.getState()) || {};
    state.siteHistory = siteHistory;
    vscode.setState(state);
  }

  // A no-op wherever the buttons don't exist, like updatePrevNextButtons.
  function updateHistoryButtons() {
    var backBtn = document.getElementById('__site-back-btn');
    var forwardBtn = document.getElementById('__site-forward-btn');
    var canBack = !!siteHistory && siteHistoryCan(siteHistory, -1, siteHistoryExists);
    var canForward = !!siteHistory && siteHistoryCan(siteHistory, 1, siteHistoryExists);
    if (backBtn) {
      backBtn.disabled = !canBack;
      backBtn.onclick = canBack ? function() { siteHistoryGo(-1); } : null;
    }
    if (forwardBtn) {
      forwardBtn.disabled = !canForward;
      forwardBtn.onclick = canForward ? function() { siteHistoryGo(1); } : null;
    }
  }

  // Back (-1) or forward (+1): the model picks the page (skipping ones the
  // book no longer has) and switchToSitePage does the switching, told not to
  // record it as new navigation.
  function siteHistoryGo(dir) {
    if (!siteHistory) return;
    var step = siteHistoryStep(siteHistory, dir, siteHistoryExists, siteScrollTop());
    if (!step) return;
    switchToSitePage(siteLinkFor(step.entry.target), '', step);
  }

  // The mouse's own back/forward buttons. Their default (navigating the
  // webview document itself) must not also run.
  //
  // Guarded to site mode: in the always-on superset script these listeners
  // coexist with book mode, where the mouse back/forward should stay native.
  // The typeof keeps the isolated unit tests (no currentMode in scope) running
  // the handler unconditionally.
  document.addEventListener('mousedown', function(e) {
    if (typeof currentMode !== 'undefined' && currentMode !== 'site') return;
    if (e.button === 3 || e.button === 4) e.preventDefault();
  });
  document.addEventListener('mouseup', function(e) {
    if (typeof currentMode !== 'undefined' && currentMode !== 'site') return;
    if (e.button === 3) { e.preventDefault(); siteHistoryGo(-1); }
    else if (e.button === 4) { e.preventDefault(); siteHistoryGo(1); }
  });
  // Left / Right arrow: the previous / next topic, in reading order (the
  // toolbar's prev/next buttons). Alt+arrow is deliberately NOT handled --
  // VS Code binds it (navigate back/forward through editor locations), and a
  // page that takes it only some of the time is worse than one that never
  // does; the history has its buttons and the mouse's back/forward buttons.
  //
  // Registered on the window, which a keydown reaches after the document, so
  // by the time this runs everything with a claim on the arrow keys has had
  // its turn and marked the event handled: the image lightbox (steps through
  // images), the sidebar tree (a document listener, and the tree is excluded
  // below anyway), the sidebar resizer (nudges its width). The exclusions are
  // for the cases where the key is not "handled" by preventDefault but still
  // means something else: moving a caret, changing a dropdown's selection.
  window.addEventListener('keydown', function(e) {
    if (typeof currentMode !== 'undefined' && currentMode !== 'site') return;
    if (e.defaultPrevented) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    var t = e.target;
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable], [role="separator"], .site-nav-tree')) return;
    var adjacent = siteAdjacentLinks();
    var link = e.key === 'ArrowLeft' ? adjacent.prev : adjacent.next;
    if (!link) return;
    e.preventDefault();
    switchToSitePage(link);
  });

  // Shared by the sidebar's own click handler and the prev/next buttons
  // (getSitePrevNextButtonsScript below) -- switching pages always means
  // the same three things: flip which sidebar link is 'active', refresh
  // prev/next's own enabled state and click targets against the new
  // active link, and ask the extension host to render it. Takes the
  // .site-nav-link element itself (not just its target path) so
  // updatePrevNextButtons can read the *next* prev/next targets' own
  // title attribute for free.
  //
  // The optional anchor is for book-internal xref jumps (docsite design
  // doc, 3.2/4.5): a plain sidebar/prev-next click never has one. When
  // present, it's an element id on the TARGET page to scroll to once its
  // HTML actually lands -- remembered in pendingSiteAnchor rather than
  // acted on here, since the new content doesn't exist in the DOM yet at
  // click time (it's still an async render on the extension host side).
  function switchToSitePage(link, anchor, historyStep) {
    if (!link) return;
    if (link.classList.contains('active')) {
      // Same page already showing -- an xref jump still needs to scroll,
      // a plain nav click has no anchor and this is just a no-op.
      if (anchor) scrollToSiteAnchor(anchor);
      return;
    }
    var target = link.getAttribute('data-site-target');
    if (!target) return;
    var prevActive = document.querySelector('.site-nav-link.active');
    if (prevActive) prevActive.classList.remove('active');
    link.classList.add('active');
    // Reveal the row: prev/next and xref jumps can land inside a collapsed
    // branch, leaving the active highlight on an invisible row. DOM-only, not
    // reported to be persisted -- the reader navigated, they did not choose
    // to unfold those branches, and the next render keeps the path to the
    // active page open by itself (renderSiteNavTreeHtml's revealActive).
    var navItem = link.closest ? link.closest('.site-nav-item') : null;
    if (navItem && typeof expandSiteNavAncestorsOf === 'function') expandSiteNavAncestorsOf(navItem);
    if (link.scrollIntoView) link.scrollIntoView({ block: 'nearest' });
    updatePrevNextButtons();
    pendingSiteAnchor = anchor || null;
    if (historyStep) {
      // Stepping through the history: land where the reader was.
      siteHistory = historyStep.history;
      pendingSiteScroll = historyStep.entry.scrollTop;
    } else {
      if (siteHistory) siteHistory = siteHistoryPush(siteHistory, target, siteScrollTop());
      // A new page starts at its top. The content pane keeps its scroll
      // offset across a content swap, so without this the page opened at
      // wherever the previous one had been scrolled to. An anchor jump does
      // its own scrolling.
      pendingSiteScroll = anchor ? null : 0;
    }
    persistSiteHistory();
    updateHistoryButtons();
    vscode.postMessage({ type: '${opts.switchSitePageMsgType}', target: target });
  }

  // Set right before the page-switch postMessage above and consumed once
  // by the MSG_UPDATE_CONTENT handler when the new page's HTML actually
  // arrives (see getMapWebviewScript) -- cleared immediately after so a
  // later plain sidebar/prev-next switch (no anchor) doesn't accidentally
  // replay a stale scroll target.
  var pendingSiteAnchor = null;

  // The content pane's scrollTop to apply when the new page's HTML lands
  // (consumed once by the MSG_UPDATE_CONTENT handler, like pendingSiteAnchor).
  // null: leave the scroll alone -- the state of every content update that is
  // not a page switch, such as the in-place refresh after an edit.
  var pendingSiteScroll = null;

  function scrollToSiteAnchor(anchor) {
    var el = document.getElementById(anchor);
    if (el && el.scrollIntoView) el.scrollIntoView();
  }

  // Prev/next's targets are derived from the sidebar's own link order
  // rather than tracked separately -- buildBookNavManifest's own contract
  // is that its entries (and so the sidebar links built from them) are
  // already in document/reading order, so the sidebar IS the ordering,
  // not just a display of it. One function, because the toolbar buttons and
  // the Left/Right arrow keys must agree on what "next" is.
  function siteAdjacentLinks() {
    var links = Array.prototype.slice.call(document.querySelectorAll('.site-nav-link'));
    var activeIdx = -1;
    for (var i = 0; i < links.length; i++) {
      if (links[i].classList.contains('active')) { activeIdx = i; break; }
    }
    return {
      prev: activeIdx > 0 ? links[activeIdx - 1] : null,
      next: activeIdx >= 0 && activeIdx < links.length - 1 ? links[activeIdx + 1] : null
    };
  }

  // A no-op wherever the buttons don't exist (only site mode creates them;
  // see getSitePrevNextButtonsScript).
  function updatePrevNextButtons() {
    var prevBtn = document.getElementById('__site-prev-btn');
    var nextBtn = document.getElementById('__site-next-btn');
    if (prevBtn || nextBtn) {
      var adjacent = siteAdjacentLinks();
      var prevLink = adjacent.prev;
      var nextLink = adjacent.next;
      if (prevBtn) {
        prevBtn.disabled = !prevLink;
        prevBtn.onclick = prevLink ? function() { switchToSitePage(prevLink); } : null;
      }
      if (nextBtn) {
        nextBtn.disabled = !nextLink;
        nextBtn.onclick = nextLink ? function() { switchToSitePage(nextLink); } : null;
      }
    }
    // Same events as prev/next above (every page switch, plus init/mode-
    // switch) refresh whether the reader is already on the home page --
    // '.site-home' only ever marks up the page renderSiteHomeHtml produced.
    var homeBtn = document.getElementById('__site-home-btn');
    if (homeBtn) homeBtn.disabled = !!document.querySelector('#dita-content-root .site-home');
  }

  document.addEventListener('click', function(e) {
    if (typeof currentMode !== 'undefined' && currentMode !== 'site') return;
    var siteLink = e.target.closest ? e.target.closest('.site-nav-link') : null;
    if (!siteLink) return;
    e.preventDefault();
    switchToSitePage(siteLink);
  });

  // Book-internal cross-topic xref (docsite design doc, 3.2/4.5): the
  // renderer only ever emits data-dita-book-xref for a target it already
  // confirmed is part of this book (RenderContext.isInCurrentBook), so
  // the matching sidebar link should always exist -- if it doesn't
  // (shouldn't happen, but the manifest and the render pass could in
  // principle disagree), this silently does nothing rather than throwing.
  document.addEventListener('click', function(e) {
    if (typeof currentMode !== 'undefined' && currentMode !== 'site') return;
    var xrefLink = e.target.closest ? e.target.closest('[data-dita-book-xref]') : null;
    if (!xrefLink) return;
    e.preventDefault();
    var raw = xrefLink.getAttribute('data-dita-book-xref');
    if (!raw) return;
    var hashIdx = raw.indexOf('#');
    var targetPath = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
    var anchor = hashIdx >= 0 ? raw.slice(hashIdx + 1) : '';
    var navLinks = document.querySelectorAll('.site-nav-link');
    var navLink = null;
    for (var j = 0; j < navLinks.length; j++) {
      if (navLinks[j].getAttribute('data-site-target') === targetPath) { navLink = navLinks[j]; break; }
    }
    if (navLink) switchToSitePage(navLink, anchor);
  });

  // Home page tile (renderSiteHomeHtml): NOT a '.site-nav-link' (see that
  // function's own comment on why), so it does not reach switchToSitePage
  // via the generic site-nav-link handler above -- this finds the matching
  // sidebar link by the tile's own data-site-target and drives the switch
  // through that, the same lookup-by-target the xref handler above uses.
  document.addEventListener('click', function(e) {
    if (typeof currentMode !== 'undefined' && currentMode !== 'site') return;
    var tile = e.target.closest ? e.target.closest('.site-home-tile[data-site-target]') : null;
    if (!tile) return;
    e.preventDefault();
    var tileTarget = tile.getAttribute('data-site-target');
    var tileLink = tileTarget ? siteLinkFor(tileTarget) : null;
    if (tileLink) switchToSitePage(tileLink);
  });

  // Deferred rather than called inline: this script is injected into the
  // page (MapViewerProvider.ts) before getSitePrevNextButtonsScript creates
  // the prev/next buttons and before they're appended to the toolbar, so an
  // inline call here used to run while document.getElementById('__site-
  // prev-btn') still returned null -- a silent no-op -- leaving the buttons
  // unresponsive until the first manual sidebar click called
  // updatePrevNextButtons() again (switchToSitePage above already does,
  // on every subsequent switch). setTimeout(..., 0) runs after the rest of
  // the synchronous page-load script finishes, by which point the buttons
  // exist no matter which order the two scripts happen to be assembled in.
  //
  // Named and re-runnable rather than a one-shot timer body: an in-place mode
  // switch into site mode leaves the sidebar links as fresh nodes with no
  // siteHistory seeded and prev/next unrefreshed, so this has to run again on
  // the ditamap:stage event, guarded to site mode. The window/typeof guards
  // keep the isolated unit tests -- which dispatch no stage event and carry no
  // currentMode -- exercising only the immediate timer call.
  function initSiteNavDeferred() {
    if (typeof currentMode !== 'undefined' && currentMode !== 'site') return;
    updatePrevNextButtons();
    var activeLink = document.querySelector('.site-nav-link.active');
    var activeTarget = activeLink ? activeLink.getAttribute('data-site-target') : null;
    if (activeTarget) {
      var saved = typeof vscode.getState === 'function' ? vscode.getState() : null;
      siteHistory = siteHistoryRestore(saved && saved.siteHistory, activeTarget);
      persistSiteHistory();
    }
    updateHistoryButtons();
  }
  setTimeout(initSiteNavDeferred, 0);
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('ditamap:stage', initSiteNavDeferred);
  }
`;
}

/**
 * Book mode's own sidebar click handler (nested-fold-and-highlight-plan.md
 * item 1) -- deliberately NOT getSiteNavClickHandlerScript's
 * switchToSitePage. Book mode is already one single page with every
 * topic's content already in the DOM (renderBookParts stamped a
 * data-book-anchor attribute onto each surviving entry's own root element,
 * matching this same sidebar link's own data-site-target -- both trace
 * back to the one shared computeManifestEntryPositions helper, see its own
 * comment), so a sidebar click here only needs to scroll to that element
 * locally; there is no separate page for the extension host to render, and
 * so no postMessage round-trip either.
 *
 * The target element is found by iterating every [data-book-anchor] node
 * and comparing its attribute value directly, rather than building a CSS
 * attribute-selector string (`document.querySelector('[data-book-anchor="'
 * + id + '"]')`): id is an absolute filesystem path, which on Windows
 * contains backslashes -- CSS-special inside a quoted attribute-selector
 * string the same way they are inside a JS string literal -- so a selector
 * built from one without CSS.escape (not universally available) would
 * mis-match or throw on exactly the paths this project's own Windows-path
 * tests already flag as a recurring gotcha (see resolveBookTopicPath's own
 * tests). Plain string comparison sidesteps that entirely.
 *
 * Always injected now (superset script, so an in-place mode switch needs no
 * reload -- see getMapWebviewScript): the click handler carries a
 * `currentMode !== 'book'` runtime guard so it only acts while book mode is
 * showing, the same guard MapViewerProvider.ts's mode-toggle `currentMode`
 * variable drives. A test that runs this script in isolation has no
 * `currentMode` in scope, so `typeof currentMode` is 'undefined' and the
 * guard lets the handler run.
 */
export function getBookNavClickHandlerScript(): string {
  return `
  function findBookAnchor(id) {
    var candidates = document.querySelectorAll('[data-book-anchor]');
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].getAttribute('data-book-anchor') === id) return candidates[i];
    }
    return null;
  }

  document.addEventListener('click', function(e) {
    // In the always-on superset webview script (MapViewerProvider.ts), this
    // and getSiteNavClickHandlerScript's own .site-nav-link listener coexist;
    // each defers to the other outside its mode. The typeof guard keeps the
    // isolated unit tests -- which run this script alone, with no currentMode
    // in scope -- exercising the handler unconditionally.
    if (typeof currentMode !== 'undefined' && currentMode !== 'book') return;
    var link = e.target.closest ? e.target.closest('.site-nav-link') : null;
    if (!link) return;
    e.preventDefault();
    var target = link.getAttribute('data-site-target');
    if (!target) return;
    var el = findBookAnchor(target);
    if (!el) return;
    var prevActive = document.querySelector('.site-nav-link.active');
    if (prevActive) prevActive.classList.remove('active');
    link.classList.add('active');
    if (el.scrollIntoView) el.scrollIntoView();
  });
`;
}

/**
 * Book mode's scroll-position -> sidebar highlight sync
 * (nested-fold-and-highlight-plan.md item 5). getBookNavClickHandlerScript
 * above only covers sidebar-click -> scroll; this is the reverse direction
 * -- scrolling the book's own content pane should keep the sidebar's
 * `.active` link (and, if necessary, the collapsed state around it)
 * pointed at whatever part is actually on screen, the same way a PDF
 * reader's bookmark panel tracks the current page.
 *
 * Always injected now (superset script, so an in-place mode switch needs no
 * reload -- see getMapWebviewScript), where it self-binds to #dita-content-root
 * and re-binds on the ditamap:stage event. It is inert outside book mode on its
 * own: it tracks [data-book-anchor] parts, which only exist in a book's content,
 * so site mode has no equivalent to worry about -- each topic there is its own
 * page load, and the server-rendered `.active` class on load already IS the
 * answer; nothing to track as the reader scrolls one topic's own content.
 *
 * Picking the active anchor: `entries[i].isIntersecting` from
 * IntersectionObserver only tells you which anchors are inside the
 * observed band right now, not which one the reader would call "the
 * current part" -- for a long part that fills the whole viewport, that
 * band can hold exactly one anchor (itself) while a short part just above
 * or below it slips in and out. Comparing intersection *ratio* to break
 * ties would favor whichever part happens to be longer, not whichever one
 * is actually nearest the top of the reading area. Instead this keeps a
 * running `visibleIds` list (anchors currently inside the band, in
 * whatever order the observer reports them) and, every time that set
 * changes, re-derives the active id by walking `anchors` -- which is
 * already in document/reading order, see computeManifestEntryPositions'
 * own comment, renderBookParts stamps data-book-anchor while walking the
 * manifest linearly in that same order -- and taking the first one that's
 * currently in `visibleIds`. That is "the topmost visible anchor" without
 * ever touching getBoundingClientRect.
 *
 * `rootMargin: '0px 0px -70% 0px'` shrinks the observed band to the
 * viewport's own top 30% (root is #dita-content-root, the actual scrolling
 * element in book mode -- see media/styles.css's own
 * `#dita-content-root.site-main { overflow-y: auto }` -- not the window)
 * so a part only becomes "current" once its top has scrolled into that
 * region, rather than the moment any sliver of it appears at the very
 * bottom of the pane.
 *
 * applyActive bails out immediately when the newly-picked id is the same
 * one already active: besides being the obvious no-op, this is also the
 * only debouncing this needs. A fast scroll can fire the observer callback
 * many times in a row, but almost all of those calls still resolve to the
 * same topmost-visible id as last time (the set of anchors inside a fixed-
 * size band changes far less often than the callback fires), so the actual
 * DOM writes below (class flips, ancestor expansion) only happen on a
 * genuine change, not on every callback tick.
 *
 * A highlighted node whose sidebar row is hidden by a collapsed ancestor
 * is worse than no highlight at all -- it looks like the sync silently
 * broke. expandAncestorsOf walks up from the matching `.site-nav-item`
 * through every ancestor `.site-nav-item.collapsed` (there can be more
 * than one: media/styles.css only hides the DIRECT child
 * `.site-nav-children`, so a grandparent being collapsed hides everything
 * under it regardless of the immediate parent's own state -- same fact
 * getSiteNavCollapseStateHelperScript's own comment already relies on for
 * collapse-all) and un-collapses each one with the same
 * setSiteNavItemCollapsed helper the click-driven toggle and expand/
 * collapse-all buttons already share (getSiteNavCollapseStateHelperScript,
 * emitted once per script and relied on here rather than duplicated) --
 * one shared implementation for "flip a nav item's collapsed state",
 * whatever triggered the flip. If that expansion actually changed
 * anything. That expansion is DOM-only: it does not itself trigger a
 * report for persistence, since it follows from where the reader scrolled,
 * not from a choice about the tree, and book mode's sidebar is closed by
 * default, so persisting it would silently erase the folds the reader had
 * saved without their ever seeing it happen. The rows it opens are marked
 * (nav-auto-expanded) so that when a LATER manual toggle reports the whole
 * DOM state they still count as collapsed, i.e. the saved fold survives.
 * Site mode's page-switch reveal behaves the same way.
 *
 * The observer is rebound (sync() inside the script) whenever
 * #dita-content-root's subtree or .site-nav's children change, because a
 * live edit replaces anchor elements and MSG_UPDATE_SIDEBAR replaces every
 * link -- see sync()'s own comment. Anchors with no matching sidebar link
 * (topichead section headings) are never picked as active.
 *
 * Deliberately does not scroll the sidebar itself to reveal the newly-
 * active row: nothing asked for that, and doing it unconditionally could
 * fight a reader who has the sidebar scrolled somewhere on purpose.
 *
 * No-ops entirely (before ever constructing an IntersectionObserver) when
 * `#dita-content-root` or any `[data-book-anchor]` element is missing --
 * the same "book with an empty sidebar" cases getMapWebviewScript's other
 * book-only scripts already have to tolerate (a map of nothing but
 * resource-only entries or childless keydefs) -- and when IntersectionObserver
 * itself isn't defined, which no real target for this extension lacks
 * but keeps this from being the one script that throws first if it ever
 * ran somewhere unexpected.
 */
export function getBookScrollSyncScript(): string {
  return `
  (function() {
    // Mutable so bind() can re-acquire the content root after an in-place mode
    // switch replaces it: #dita-content-root and .site-nav are fresh nodes
    // then, so observers bound to the old ones would watch detached DOM.
    var contentRoot = null;
    var swapObserver = null;

    var anchors = [];
    var visibleIds = [];
    var currentActiveId = null;
    var scrollObserver = null;

    function findNavLink(id) {
      var navLinks = document.querySelectorAll('.site-nav-link');
      for (var j = 0; j < navLinks.length; j++) {
        if (navLinks[j].getAttribute('data-site-target') === id) return navLinks[j];
      }
      return null;
    }

    // Topmost visible anchor THAT HAS A SIDEBAR LINK. renderBookParts also
    // stamps data-book-anchor onto topichead section headings, but a group
    // is a plain label in the sidebar, not a link -- picking one would
    // resolve to no link at all and (as this used to) wipe the highlight
    // every time a group heading was the topmost thing in the band.
    function pickActiveId() {
      for (var i = 0; i < anchors.length; i++) {
        var id = anchors[i].getAttribute('data-book-anchor');
        if (visibleIds.indexOf(id) !== -1 && findNavLink(id)) return id;
      }
      return null;
    }

    // A null pick (nothing with a link is in the band right now) keeps the
    // last-known active link rather than clearing it to nothing.
    function applyActive(id) {
      if (!id || id === currentActiveId) return;
      var navLink = findNavLink(id);
      if (!navLink) return;
      currentActiveId = id;
      var prevActive = document.querySelector('.site-nav-link.active');
      if (prevActive) prevActive.classList.remove('active');
      navLink.classList.add('active');
      var navItem = navLink.closest ? navLink.closest('.site-nav-item') : null;
      // DOM-only: see this function's doc comment (getBookScrollSyncScript).
      if (navItem) expandSiteNavAncestorsOf(navItem);
    }

    function onIntersect(entries) {
      for (var i = 0; i < entries.length; i++) {
        var id = entries[i].target.getAttribute('data-book-anchor');
        var idx = visibleIds.indexOf(id);
        if (entries[i].isIntersecting) {
          if (idx === -1) visibleIds.push(id);
        } else if (idx !== -1) {
          visibleIds.splice(idx, 1);
        }
      }
      applyActive(pickActiveId());
    }

    // (Re)binds the observer to whatever data-book-anchor elements exist
    // right now. Runs once at init and again after every DOM swap below:
    // a live edit replaces anchor elements (MSG_UPDATE_CONTENT swaps all
    // of them, MSG_PATCH_CONTENT the changed ones) and the host's
    // MSG_UPDATE_SIDEBAR replaces every sidebar link -- with the observer
    // bound once at init it would keep watching detached nodes and the
    // highlight would silently stop following the scroll.
    //
    // The previously-active id is re-applied synchronously: the sidebar
    // markup the host sends marks the FIRST link active (it has no idea
    // where the reader is), and waiting for the new observer's first
    // callback would leave that wrong mark on screen until then.
    function sync() {
      var prevActiveId = currentActiveId;
      if (scrollObserver) { scrollObserver.disconnect(); scrollObserver = null; }
      anchors = Array.prototype.slice.call(document.querySelectorAll('[data-book-anchor]'));
      visibleIds = [];
      currentActiveId = null;
      if (!anchors.length) return;
      scrollObserver = new IntersectionObserver(onIntersect, { root: contentRoot, rootMargin: '0px 0px -70% 0px', threshold: 0 });
      for (var k = 0; k < anchors.length; k++) scrollObserver.observe(anchors[k]);
      if (prevActiveId) applyActive(prevActiveId);
    }

    // Binds (or re-binds) to whatever shell is in the DOM right now. An
    // in-place mode switch swaps #dita-content-root/.site-nav for fresh nodes,
    // so the old swap observer is disconnected and a new pair bound to the new
    // nodes. Re-running on first load is just the initial bind.
    function bind() {
      contentRoot = document.getElementById('dita-content-root');
      if (swapObserver) { swapObserver.disconnect(); swapObserver = null; }
      if (!contentRoot || typeof IntersectionObserver === 'undefined') return;

      sync();

      // Self-contained swap detection rather than a call from each message
      // handler in MapViewerProvider.ts: one place owns this script's own
      // lifecycle, and a future third swap path can't forget to call it.
      if (typeof MutationObserver !== 'undefined') {
        swapObserver = new MutationObserver(function() { sync(); });
        swapObserver.observe(contentRoot, { childList: true, subtree: true });
        var siteNav = document.querySelector('.site-nav');
        if (siteNav) swapObserver.observe(siteNav, { childList: true });
      }
    }

    bind();
    // Re-bind after an in-place mode switch (applyModeStage) rebuilds the
    // shell. Window-guarded so the isolated unit tests, which pass only a
    // fake document and no window, keep exercising the immediate bind alone.
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('ditamap:stage', bind);
    }
  })();
`;
}

/**
 * getOutlineSyncScript -- the "on this page" outline column
 * (site-book-templates-plan.md item 4). Site mode only: a template opts in
 * with `"outline": true` in template.json (siteTemplates.ts), and
 * MapViewerProvider.ts then renders an empty `<aside id="__site-outline">`
 * container as the fourth child of .site-frame, after the content pane
 * (templateChrome.ts wrapShell) -- never in book mode, and never for a
 * template that did not ask for it. This script does the rest entirely
 * client-side: it builds the link list itself and keeps it in sync.
 *
 * Deliberately mirrors getBookScrollSyncScript immediately above rather
 * than inventing a second pattern for "highlight whichever thing is
 * topmost on screen right now": same IntersectionObserver with the same
 * top-weighted rootMargin, same visibleIds/topmost-wins tie-break, same
 * MutationObserver-driven rebind on content swap, same re-bind on
 * 'ditamap:stage'. The two real differences: what is tracked (h1-h3
 * headings inside #dita-content-root, not [data-book-anchor] parts) and
 * that this script also BUILDS the sidebar list itself, not just the
 * highlight -- topic/title never emits an id (see baseTypeMap.ts), so
 * headings have nothing stable to scroll to or highlight until this script
 * gives them one. That id is assigned once per heading, the first time it
 * is seen, and left alone after that; a heading that already carries an id
 * for some other reason keeps it.
 *
 * Limited to h1-h3 by design (three levels is enough for a quick-jump
 * list; deeper sections would make the column longer than the content
 * it is next to). A page with fewer than two such headings -- the site
 * home tile page, whose only h1 is decorative chrome, or a short topic
 * that is just its own title with no sections -- hides the column
 * entirely (tpl-outline--empty) rather than showing a one-line list that
 * cannot help navigate anything; sync() re-checks this on every rebuild,
 * so paging from a short topic to a long one un-hides it again.
 *
 * No-ops entirely (before ever constructing an IntersectionObserver) when
 * `#__site-outline` is missing -- the template did not opt in, or this is
 * book mode, where the container is never rendered in the first place --
 * or when `#dita-content-root` or IntersectionObserver itself is missing,
 * matching every other script in this file that tolerates the DOM it
 * expects simply not being there.
 */
export function getOutlineSyncScript(): string {
  return `
  (function() {
    var contentRoot = null;
    var outlineEl = null;
    var outlineInner = null;
    var swapObserver = null;

    var headings = [];
    var visibleIds = [];
    var currentActiveId = null;
    var scrollObserver = null;
    var idCounter = 0;

    function headingLevel(h) {
      return h.tagName.charAt(1);
    }

    // Assigns an id only the first time a given heading is seen; a heading
    // that already has one (from this script's own earlier pass, or from
    // anywhere else) is left untouched. Monotonic across every rebuild in
    // this page's lifetime, so ids from a since-replaced heading are never
    // reused -- irrelevant once that heading is detached, but guarantees no
    // collision with whatever the new content happens to contain.
    function ensureId(h) {
      if (!h.id) h.id = 'outline-h-' + (idCounter++);
      return h.id;
    }

    function findOutlineLink(id) {
      return outlineInner ? outlineInner.querySelector('[data-outline-target="' + id + '"]') : null;
    }

    function pickActiveId() {
      for (var i = 0; i < headings.length; i++) {
        var id = headings[i].id;
        if (visibleIds.indexOf(id) !== -1) return id;
      }
      return null;
    }

    function applyActive(id) {
      if (!id || id === currentActiveId) return;
      var link = findOutlineLink(id);
      if (!link) return;
      currentActiveId = id;
      var prevActive = outlineInner.querySelector('.tpl-outline-link.active');
      if (prevActive) prevActive.classList.remove('active');
      link.classList.add('active');
    }

    function onIntersect(entries) {
      for (var i = 0; i < entries.length; i++) {
        var id = entries[i].target.id;
        var idx = visibleIds.indexOf(id);
        if (entries[i].isIntersecting) {
          if (idx === -1) visibleIds.push(id);
        } else if (idx !== -1) {
          visibleIds.splice(idx, 1);
        }
      }
      applyActive(pickActiveId());
    }

    function onOutlineClick(e) {
      var link = e.target && e.target.closest ? e.target.closest('.tpl-outline-link') : null;
      if (!link) return;
      e.preventDefault();
      var target = document.getElementById(link.getAttribute('data-outline-target'));
      if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // (Re)builds the link list from whatever h1-h3 headings exist right
    // now, and rebinds the observer to them. Runs once at init and again
    // on every content swap below, the same reasons getBookScrollSyncScript's
    // own sync() gives: a live edit or topic switch replaces the heading
    // elements outright, so an observer bound once at init would keep
    // watching detached nodes.
    function sync() {
      if (scrollObserver) { scrollObserver.disconnect(); scrollObserver = null; }
      headings = Array.prototype.slice.call(contentRoot.querySelectorAll('h1,h2,h3'));
      visibleIds = [];
      currentActiveId = null;
      outlineInner.innerHTML = '';

      if (headings.length < 2) {
        outlineEl.classList.add('tpl-outline--empty');
        return;
      }
      outlineEl.classList.remove('tpl-outline--empty');

      for (var i = 0; i < headings.length; i++) {
        var h = headings[i];
        var id = ensureId(h);
        var a = document.createElement('a');
        a.className = 'tpl-outline-link';
        a.href = '#' + id;
        a.setAttribute('data-outline-target', id);
        a.setAttribute('data-outline-level', headingLevel(h));
        a.textContent = h.textContent || '';
        outlineInner.appendChild(a);
      }

      if (typeof IntersectionObserver === 'undefined') return;
      scrollObserver = new IntersectionObserver(onIntersect, { root: contentRoot, rootMargin: '0px 0px -70% 0px', threshold: 0 });
      for (var k = 0; k < headings.length; k++) scrollObserver.observe(headings[k]);
    }

    // Binds (or re-binds) to whatever shell is in the DOM right now -- see
    // getBookScrollSyncScript's own bind() comment; the reasoning is
    // identical, just for #__site-outline instead of .site-nav.
    function bind() {
      contentRoot = document.getElementById('dita-content-root');
      outlineEl = document.getElementById('__site-outline');
      outlineInner = outlineEl ? outlineEl.querySelector('.tpl-outline-inner') : null;
      if (swapObserver) { swapObserver.disconnect(); swapObserver = null; }
      if (!contentRoot || !outlineEl || !outlineInner || typeof IntersectionObserver === 'undefined') return;

      outlineEl.addEventListener('click', onOutlineClick);
      sync();

      if (typeof MutationObserver !== 'undefined') {
        swapObserver = new MutationObserver(function() { sync(); });
        swapObserver.observe(contentRoot, { childList: true, subtree: true });
      }
    }

    bind();
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('ditamap:stage', bind);
    }
  })();
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
