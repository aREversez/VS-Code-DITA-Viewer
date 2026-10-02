// Webview script: the Ctrl+F search overlay (search bar, match navigation,
// highlighting). Moved verbatim from ditaRenderUtils.ts (P5 pure refactor).
// It pulls findTextMatches from the searchText leaf and embeds it via
// .toString() -- that leaf dependency is why the engine was extracted first,
// so this module does not import back from the ditaRenderUtils barrel.
import { findTextMatches } from '../searchText';

// ── Webview search overlay (Ctrl+F) ──
// Returns inline JS that creates a floating search bar with text highlighting,
// match navigation, and keyboard shortcuts. Injected into both DITA topic
// and DITA map webview scripts.

export function getSearchOverlayScript(opts: {
  placeholder: string;
  nextMatch: string;
  prevMatch: string;
  close: string;
  matchCase: string;
  useRegex: string;
  invalidRegex: string;
}): string {
  const ph = JSON.stringify(opts.placeholder);
  const next = JSON.stringify(opts.nextMatch);
  const prev = JSON.stringify(opts.prevMatch);
  const cls = JSON.stringify(opts.close);
  const mc = JSON.stringify(opts.matchCase);
  const re = JSON.stringify(opts.useRegex);
  const ir = JSON.stringify(opts.invalidRegex);
  return `
  // ── Search overlay (Ctrl+F) ──
  var searchRanges = [];
  var currentMatch = -1;
  var useRegex = false;
  var caseSensitive = false;

  // CSS Custom Highlight API: matches are Range objects registered here,
  // never DOM elements spliced into the page. Two registrations rather than
  // one plus a per-range class, since Range has no classList -- 'current'
  // is just a second Highlight holding (at most) one of the same Range
  // objects, styled to stand out via ::highlight(dita-search-current)'s
  // higher-priority rule below.
  var searchHighlightAll = new Highlight();
  var searchHighlightCurrent = new Highlight();
  CSS.highlights.set('dita-search-all', searchHighlightAll);
  CSS.highlights.set('dita-search-current', searchHighlightCurrent);

  var sbStyle = 'position:fixed;top:40px;right:8px;z-index:10000;display:none;align-items:center;gap:4px;padding:4px 8px;border-radius:5px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:12px;background:var(--vscode-editor-background,rgba(30,30,30,0.95));border:1px solid var(--vscode-widget-border,rgba(255,255,255,0.12));backdrop-filter:blur(4px);box-shadow:0 2px 8px rgba(0,0,0,0.2);';
  var sbInputStyle = 'width:180px;padding:2px 6px;border-radius:3px;border:1px solid var(--vscode-dropdown-border,var(--vscode-widget-border,#555));background:var(--vscode-dropdown-background,#333);color:var(--vscode-dropdown-foreground,#eee);font-size:12px;outline:none;';
  var sbBtnStyle = 'padding:1px 6px;border-radius:3px;border:1px solid var(--vscode-dropdown-border,var(--vscode-widget-border,#555));background:var(--vscode-dropdown-background,#333);color:var(--vscode-dropdown-foreground,#eee);cursor:pointer;font-size:13px;line-height:1;outline:none;';
  var sbToggleStyleOff = sbBtnStyle + 'font-size:11px;';
  var sbCountStyle = 'min-width:50px;text-align:center;color:var(--vscode-descriptionForeground,#999);font-size:11px;';
  var sbActiveBg = 'var(--vscode-button-background,#0e639c)';
  var sbActiveFg = 'var(--vscode-button-foreground,#fff)';
  var sbInactiveBg = 'var(--vscode-dropdown-background,#333)';
  var sbInactiveFg = 'var(--vscode-dropdown-foreground,#eee)';
  var sbInactiveBd = 'var(--vscode-dropdown-border,var(--vscode-widget-border,#555))';

  var sb = document.createElement('div');
  sb.id = '__search_bar';
  sb.setAttribute('role', 'search');
  sb.style.cssText = sbStyle;

  var searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = ${ph};
  searchInput.setAttribute('aria-label', ${ph});
  searchInput.style.cssText = sbInputStyle;

  var searchCount = document.createElement('span');
  searchCount.style.cssText = sbCountStyle;
  searchCount.textContent = '';
  searchCount.setAttribute('aria-live', 'polite');

  var caseBtn = document.createElement('button');
  caseBtn.textContent = 'Aa';
  caseBtn.title = ${mc};
  caseBtn.setAttribute('aria-label', ${mc});
  caseBtn.style.cssText = sbToggleStyleOff;

  var regexBtn = document.createElement('button');
  regexBtn.textContent = '.*';
  regexBtn.title = ${re};
  regexBtn.setAttribute('aria-label', ${re});
  regexBtn.style.cssText = sbToggleStyleOff + 'font-family:monospace;';

  var searchPrev = document.createElement('button');
  searchPrev.innerHTML = '&uarr;';
  searchPrev.title = ${prev};
  searchPrev.setAttribute('aria-label', ${prev});
  searchPrev.style.cssText = sbBtnStyle;

  var searchNext = document.createElement('button');
  searchNext.innerHTML = '&darr;';
  searchNext.title = ${next};
  searchNext.setAttribute('aria-label', ${next});
  searchNext.style.cssText = sbBtnStyle;

  var searchClose = document.createElement('button');
  searchClose.innerHTML = '&times;';
  searchClose.title = ${cls};
  searchClose.setAttribute('aria-label', ${cls});
  searchClose.style.cssText = sbBtnStyle + 'font-size:16px;';

  sb.appendChild(searchInput);
  sb.appendChild(searchCount);
  sb.appendChild(caseBtn);
  sb.appendChild(regexBtn);
  sb.appendChild(searchPrev);
  sb.appendChild(searchNext);
  sb.appendChild(searchClose);
  document.body.appendChild(sb);

  var searchHlStyle = document.createElement('style');
  searchHlStyle.textContent = '::highlight(dita-search-all){background-color:rgba(255,213,0,0.35);color:inherit;}::highlight(dita-search-current){background-color:rgba(255,165,0,0.6);}';
  document.head.appendChild(searchHlStyle);

  function updateToggleVisual(btn, active) {
    if (active) {
      btn.style.background = sbActiveBg;
      btn.style.color = sbActiveFg;
      btn.style.borderColor = sbActiveBg;
    } else {
      btn.style.background = sbInactiveBg;
      btn.style.color = sbInactiveFg;
      btn.style.borderColor = sbInactiveBd;
    }
  }

  function clearSearchHighlights() {
    searchHighlightAll.clear();
    searchHighlightCurrent.clear();
    searchRanges = [];
    currentMatch = -1;
  }

  // Returns array of {start, end} match positions within a text string.
  // Core implementation is the exported findTextMatches (unit-tested TS),
  // injected here so webview and tests always run the same algorithm.
  var findTextMatchesCore = ${findTextMatches.toString()};
  function findMatchesInText(text, term) {
    return findTextMatchesCore(text, term, useRegex, caseSensitive);
  }

  // Most matches tracked (one Range each, all held in the highlight
  // registry). A one-letter query against a large book would otherwise
  // create hundreds of thousands; past this the counter reads "N/5000+".
  var MAX_SEARCH_MATCHES = 5000;
  var searchCapped = false;

  // preservePosition: this run is a refresh after the DOM changed under an
  // open search (a live edit, a profiling-filter change), not the reader
  // typing or toggling -- keep them on the match they were on, and don't
  // scroll, instead of resetting to the first match and jumping there.
  function performSearch(term, preservePosition) {
    var keepMatch = preservePosition ? currentMatch : -1;
    clearSearchHighlights();
    searchCapped = false;
    searchCount.style.color = '';
    if (!term) { searchCount.textContent = ''; return; }

    // Validate regex early so we can show an error
    if (useRegex) {
      try {
        var testFlags = caseSensitive ? 'g' : 'gi';
        new RegExp(term, testFlags);
      } catch(e) {
        searchCount.textContent = ${ir};
        searchCount.style.color = 'var(--vscode-errorForeground,#f48771)';
        return;
      }
    }

    // Text under display:none (e.g. .profile-filtered-out) has no box: a
    // match there could be counted but never seen, and its rect is all zeros.
    var isRendered = function(el) {
      return typeof el.checkVisibility !== 'function' || el.checkVisibility();
    };

    // Whether an element's text flows into its neighbours' as one string.
    // The page's own layout decides: display:inline (or contents) does, any
    // block/flex/table/inline-block box does not, and <br> ends a line even
    // though it is display:inline. With no layout information available
    // every element is a boundary, i.e. the per-text-node behaviour this
    // replaced. Deliberately the safe default of the full-book index
    // (extractBodyText in bookSearchIndex.ts) too: a spurious boundary only
    // misses a cross-element match, while gluing two blocks would invent
    // matches ("Hello</p><p>World" containing "oW").
    function flowsInline(el) {
      if (el.tagName === 'BR') return false;
      if (typeof window.getComputedStyle !== 'function') return false;
      var d = window.getComputedStyle(el).display;
      return d === 'inline' || d === 'contents';
    }

    // Whether the browser collapses runs of source whitespace in this
    // element's text into a single space. Only known when there is layout
    // information; without it text is taken as it is. white-space is
    // inherited, so the value on an element is the one its text sees.
    function collapsesWhitespace(el) {
      if (typeof window.getComputedStyle !== 'function') return false;
      var ws = window.getComputedStyle(el).whiteSpace;
      return ws !== 'pre' && ws !== 'pre-wrap' && ws !== 'pre-line' && ws !== 'break-spaces';
    }

    function isExcluded(el) {
      var tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE') return true;
      if (el.id === '__toolbar' || el.id === '__search_bar') return true;
      // Docsite mode's sidebar (.site-nav) sits beside #dita-content-root
      // as a sibling under body, not inside it -- without this, Ctrl+F
      // would also match/highlight topic titles and chips in the
      // sidebar, which isn't "the page" the reader is searching.
      return !!(el.classList && el.classList.contains('site-nav'));
    }

    // Collect "runs": maximal stretches of text nodes that read as one
    // string, as the reader sees it -- source whitespace collapsed to single
    // spaces, as the full-book index does, so "Click<newline> <b>OK</b>" is
    // found by "Click OK". segs maps the run's text back onto the raw text
    // nodes: segment k covers text[segs[k].c .. segs[k+1].c) and corresponds
    // one-to-one to node.textContent from offset segs[k].o. A collapsed
    // whitespace run is a one-character segment pointing at the first raw
    // whitespace character.
    var runs = [];
    var run = null;
    function endRun() {
      if (run && run.text.trim()) runs.push(run);
      run = null;
    }
    var WS_OR_TEXT = /[ \\t\\n\\r\\f]+|[^ \\t\\n\\r\\f]+/g;
    function addText(node, collapse) {
      if (!run) run = { segs: [], text: '' };
      var raw = node.textContent;
      if (!collapse) {
        if (raw) run.segs.push({ c: run.text.length, n: node, o: 0 });
        run.text += raw;
        return;
      }
      WS_OR_TEXT.lastIndex = 0;
      var m;
      while ((m = WS_OR_TEXT.exec(raw)) !== null) {
        var chunk = m[0];
        if (chunk.charCodeAt(0) <= 32) {
          // Dropped at the start of a line and after a space already taken.
          if (run.text === '' || run.text.charAt(run.text.length - 1) === ' ') continue;
          chunk = ' ';
        }
        run.segs.push({ c: run.text.length, n: node, o: m.index });
        run.text += chunk;
      }
    }
    function collectRuns(parent, collapse) {
      var kids = parent.childNodes;
      for (var k = 0; k < kids.length; k++) {
        var kid = kids[k];
        if (kid.nodeType === 3) {
          addText(kid, collapse);
        } else if (kid.nodeType === 1) {
          var inline = flowsInline(kid);
          if (isExcluded(kid) || !isRendered(kid)) {
            // Taken out of the flow entirely: text either side of an
            // inline one still joins up, a block one splits it.
            if (!inline) endRun();
            continue;
          }
          if (!inline) endRun();
          collectRuns(kid, collapsesWhitespace(kid));
          if (!inline) endRun();
        }
      }
    }
    collectRuns(document.body, collapsesWhitespace(document.body));
    endRun();

    collect:
    for (var i = 0; i < runs.length; i++) {
      var r = runs[i];
      var matches = findMatchesInText(r.text, term);
      if (!matches || matches.length === 0) continue;

      var si = 0;
      for (var j = 0; j < matches.length; j++) {
        if (searchRanges.length >= MAX_SEARCH_MATCHES) { searchCapped = true; break collect; }
        var st = matches[j].start;
        var last = matches[j].end - 1;
        // Matches ascend, so the start segment only ever moves forward. The
        // end is found from the match's LAST character: a match ending
        // exactly on a node boundary stays in the earlier node rather than
        // opening an empty range in the next.
        while (si + 1 < r.segs.length && r.segs[si + 1].c <= st) si++;
        var ei = si;
        while (ei + 1 < r.segs.length && r.segs[ei + 1].c <= last) ei++;
        var sg = r.segs[si];
        var eg = r.segs[ei];
        var range = document.createRange();
        range.setStart(sg.n, sg.o + (st - sg.c));
        range.setEnd(eg.n, eg.o + (last - eg.c) + 1);
        searchRanges.push(range);
        searchHighlightAll.add(range);
      }
    }

    if (searchRanges.length > 0) {
      if (keepMatch >= 0) {
        currentMatch = Math.min(keepMatch, searchRanges.length - 1);
        updateCurrentMatch(false);
      } else {
        currentMatch = 0;
        updateCurrentMatch();
      }
    } else {
      currentMatch = -1;
      searchCount.textContent = '0/0';
    }
  }

  // Bumped on every navigation so a correction still pending from the
  // previous match (see recenterMatch) never fights the newer one.
  var scrollToken = 0;

  // The nearest ancestor that actually scrolls -- #dita-content-root in
  // site mode and in book mode with a sidebar, where body is overflow:hidden
  // -- or null when the document itself is the scroller.
  function findScroller(el) {
    for (var p = el; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      var oy = window.getComputedStyle(p).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
    }
    return null;
  }

  // Measure where the match actually is and nudge its scroller until it sits
  // at the centre of the visible area. One scrollIntoView is not enough in
  // book mode: entries use content-visibility:auto with a 600px size
  // ESTIMATE until first rendered, so the jump is aimed at estimated layout,
  // the entries near the destination then render at their real heights, and
  // the match lands anywhere from a little off-centre to entirely off-screen.
  // Reading the range's rect forces layout, so each pass sees the real
  // geometry. The passes keep running until a deadline rather than stopping
  // once the match is centred: in a real page the layout can shift again a
  // few frames AFTER the first settle (observed ~70ms later, moving the
  // match 170px), so "centred once" is not "stays centred". Any wheel, touch
  // or pointer press bumps scrollToken and ends the correction, so it never
  // fights a reader who has started scrolling themselves.
  var RECENTER_WINDOW_MS = 800;
  ['wheel', 'touchmove', 'pointerdown'].forEach(function(type) {
    document.addEventListener(type, function() { scrollToken++; }, { passive: true, capture: true });
  });

  function recenterMatch(range, token, deadline) {
    if (token !== scrollToken) return;
    if (typeof window.requestAnimationFrame !== 'function' || typeof window.getComputedStyle !== 'function') return;
    var el = range.startContainer && range.startContainer.parentElement;
    if (!el) return;
    var rect = range.getBoundingClientRect();
    // An all-zero rect means "no layout box" (hidden content), not "at the
    // top of the scroller" -- scrolling toward it would fling the view away.
    if (!rect.width && !rect.height) return;
    var scroller = findScroller(el);
    var boxTop = 0;
    var boxHeight = window.innerHeight;
    if (scroller) {
      var box = scroller.getBoundingClientRect();
      boxTop = box.top;
      boxHeight = box.height;
    }
    var delta = (rect.top + rect.height / 2) - (boxTop + boxHeight / 2);
    if (Math.abs(delta) > 4) {
      if (scroller) scroller.scrollTop += delta;
      else window.scrollBy(0, delta);
    }
    if (Date.now() < deadline) {
      window.requestAnimationFrame(function() { recenterMatch(range, token, deadline); });
    }
  }

  function updateCurrentMatch(scroll) {
    // Only ever holds one Range (or none) -- clear+add is already O(1),
    // there being no marks left to walk is what makes this simpler than the
    // <mark>-based version this replaced.
    searchHighlightCurrent.clear();
    scrollToken++;
    if (currentMatch >= 0 && searchRanges[currentMatch]) {
      var range = searchRanges[currentMatch];
      searchHighlightCurrent.add(range);
      // Range has no scrollIntoView (that's an Element method), so make the
      // coarse jump via the element the match sits in. NOT window.scrollTo:
      // in site mode and book mode with a sidebar, body is height:100vh;
      // overflow:hidden and the real scroller is #dita-content-root (see
      // media/styles.css), where window.scrollTo is a silent no-op.
      // Element.scrollIntoView finds whichever ancestor actually scrolls.
      // 'instant', not 'smooth': a smooth animation is aimed once at the
      // layout of the moment and is not corrected as content-visibility
      // entries render during it (see recenterMatch); the refinement below
      // then puts the match itself, not just its paragraph, at the centre.
      if (scroll !== false) {
        var scrollTarget = range.startContainer && range.startContainer.parentElement;
        if (scrollTarget && scrollTarget.scrollIntoView) {
          scrollTarget.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
        recenterMatch(range, scrollToken, Date.now() + RECENTER_WINDOW_MS);
      }
    }
    searchCount.textContent = (currentMatch + 1) + '/' + searchRanges.length + (searchCapped ? '+' : '');
  }

  function gotoNextMatch() {
    if (searchRanges.length === 0) return;
    currentMatch = (currentMatch + 1) % searchRanges.length;
    updateCurrentMatch();
  }

  function gotoPrevMatch() {
    if (searchRanges.length === 0) return;
    currentMatch = (currentMatch - 1 + searchRanges.length) % searchRanges.length;
    updateCurrentMatch();
  }

  // Re-runs the current search after the page's DOM changed underneath it
  // (a live edit swapped the content, a profiling filter showed/hid some).
  // The Ranges the old run held point into nodes that are gone or
  // hidden, so they must be rebuilt -- but the reader keeps their place.
  function refreshSearchAfterDomChange() {
    if (sb.style.display !== 'none' && searchInput.value) performSearch(searchInput.value, true);
  }

  function openSearchBar() {
    sb.style.display = 'flex';
    searchInput.focus();
    searchInput.select();
  }

  function closeSearchBar() {
    sb.style.display = 'none';
    clearSearchHighlights();
    searchInput.value = '';
    searchCount.textContent = '';
    searchCount.style.color = '';
  }

  var searchDebounce = null;

  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      e.stopPropagation();
      openSearchBar();
      return;
    }
    if (e.key === 'Escape' && sb.style.display !== 'none') {
      e.preventDefault();
      closeSearchBar();
      return;
    }
  });

  searchInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) { gotoPrevMatch(); } else { gotoNextMatch(); }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSearchBar();
      return;
    }
  });

  searchInput.addEventListener('input', function() {
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(function() {
      performSearch(searchInput.value);
    }, 150);
  });

  caseBtn.addEventListener('click', function() {
    caseSensitive = !caseSensitive;
    updateToggleVisual(caseBtn, caseSensitive);
    performSearch(searchInput.value);
  });

  regexBtn.addEventListener('click', function() {
    useRegex = !useRegex;
    updateToggleVisual(regexBtn, useRegex);
    performSearch(searchInput.value);
  });

  searchPrev.addEventListener('click', gotoPrevMatch);
  searchNext.addEventListener('click', gotoNextMatch);
  searchClose.addEventListener('click', closeSearchBar);
`;
}
