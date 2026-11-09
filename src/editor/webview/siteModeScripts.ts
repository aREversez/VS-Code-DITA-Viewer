// Site mode's sidebar scripts: the page-switching click handler and the history model it composes.
// Split out of siteNavScripts.ts, which re-exports every name here.

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
    if (prevActive) {
      prevActive.classList.remove('active');
      var prevItem = prevActive.closest ? prevActive.closest('.site-nav-item') : null;
      if (prevItem && prevItem.classList.contains('topicref')) prevItem.classList.remove('active');
    }
    link.classList.add('active');
    // Reveal the row: prev/next and xref jumps can land inside a collapsed
    // branch, leaving the active highlight on an invisible row. DOM-only, not
    // reported to be persisted -- the reader navigated, they did not choose
    // to unfold those branches, and the next render keeps the path to the
    // active page open by itself (renderSiteNavTreeHtml's revealActive).
    var navItem = link.closest ? link.closest('.site-nav-item') : null;
    if (navItem && navItem.classList.contains('topicref')) navItem.classList.add('active');
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

  // In-page anchor xrefs inside rendered content (book and site alike): the
  // content pane (#dita-content-root) is what scrolls, so the same smooth
  // scroll the single-topic preview applies to a.xref clicks applies here --
  // otherwise the click falls through to the browser's own fragment
  // navigation, which fights the content pane's scroll handling. Only the
  // "#..." form is claimed: book-internal cross-topic xrefs carry
  // data-dita-book-xref and href="#" (its own listeners own those clicks),
  // and anything else is left to the webview's built-in link handling.
  document.addEventListener('click', function(e) {
    var a = e.target.closest ? e.target.closest('a.xref') : null;
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) !== '#') return;
    e.preventDefault();
    var id = href.slice(1);
    // href="#" alone (book-xref placeholder) has no id to scroll to;
    // the data-dita-book-xref listener owns that click.
    if (!id) return;
    var el = document.getElementById(id);
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

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
