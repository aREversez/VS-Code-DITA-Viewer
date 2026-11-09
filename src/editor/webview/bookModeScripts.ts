// Book mode's sidebar scripts: scroll-to-anchor clicks, scroll sync and the outline column.
// Split out of siteNavScripts.ts, which re-exports every name here.

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
    if (prevActive) {
      prevActive.classList.remove('active');
      var prevItem = prevActive.closest ? prevActive.closest('.site-nav-item') : null;
      if (prevItem && prevItem.classList.contains('topicref')) prevItem.classList.remove('active');
    }
    link.classList.add('active');
    var clickedItem = link.closest ? link.closest('.site-nav-item') : null;
    if (clickedItem && clickedItem.classList.contains('topicref')) clickedItem.classList.add('active');
    if (el.scrollIntoView) el.scrollIntoView();
  });

  // Book-internal cross-topic xref: the site-mode listener below only acts
  // while site mode is showing, so in book mode a data-dita-book-xref click
  // used to fall through to the link's href="#" placeholder -- the page
  // jumped to the top and the promised navigation never happened. The
  // renderer only ever emits the attribute for a target it already confirmed
  // is part of this book (RenderContext.isInCurrentBook), and book mode
  // holds every topic's content in the DOM, so a click only needs to scroll:
  // to the target topic's [data-book-anchor] part first, then to the exact
  // element inside it when the xref carried an id fragment. The sidebar's
  // active highlight follows the same treatment a sidebar click gets above,
  // so the tree keeps pointing at the topic the reader just jumped into.
  document.addEventListener('click', function(e) {
    if (typeof currentMode !== 'undefined' && currentMode !== 'book') return;
    var xrefLink = e.target.closest ? e.target.closest('[data-dita-book-xref]') : null;
    if (!xrefLink) return;
    e.preventDefault();
    var raw = xrefLink.getAttribute('data-dita-book-xref');
    if (!raw) return;
    var hashIdx = raw.indexOf('#');
    var targetPath = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
    var anchorId = hashIdx >= 0 ? raw.slice(hashIdx + 1) : '';
    var el = findBookAnchor(targetPath);
    if (!el) return; // the manifest and the render pass disagree; do nothing rather than throw
    if (el.scrollIntoView) el.scrollIntoView();
    if (anchorId) {
      var anchorEl = document.getElementById(anchorId);
      if (anchorEl && anchorEl.scrollIntoView) anchorEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    // Flip the sidebar's active row, the way a click on that row would.
    var navLinks = document.querySelectorAll('.site-nav-link');
    for (var j = 0; j < navLinks.length; j++) {
      if (navLinks[j].getAttribute('data-site-target') !== targetPath) continue;
      var prevActive = document.querySelector('.site-nav-link.active');
      if (prevActive) {
        prevActive.classList.remove('active');
        var prevItem = prevActive.closest ? prevActive.closest('.site-nav-item') : null;
        if (prevItem && prevItem.classList.contains('topicref')) prevItem.classList.remove('active');
      }
      navLinks[j].classList.add('active');
      var navItem = navLinks[j].closest ? navLinks[j].closest('.site-nav-item') : null;
      if (navItem && navItem.classList.contains('topicref')) navItem.classList.add('active');
      break;
    }
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
      if (prevActive) {
        prevActive.classList.remove('active');
        var prevItem = prevActive.closest ? prevActive.closest('.site-nav-item') : null;
        if (prevItem && prevItem.classList.contains('topicref')) prevItem.classList.remove('active');
      }
      navLink.classList.add('active');
      var navItem = navLink.closest ? navLink.closest('.site-nav-item') : null;
      if (navItem && navItem.classList.contains('topicref')) navItem.classList.add('active');
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
