import * as vscode from 'vscode';
import { parseDita, parseDitamap, preprocessEntities } from '../parser/ditaParser';
import { renderDocument } from '../render/renderer';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { dirname, isAbsolute, join, resolve, basename } from 'path';
import { randomBytes } from 'crypto';
import { DitaNode } from '../parser/domTypes';
import { buildTitleMap, expandDitamapRefs, makeConrefResolver, makeConrefRangeResolver, makeFileTitleResolver, getSearchOverlayScript, getProfilingFilterScript, decodeHrefPart, detectNoteLabels, detectIndexLabel, readImageDimensions, clearImageDimensionsCache, FileReader } from './ditaRenderUtils';

// Test-only hook: @vscode/test-electron integration tests can't read a
// webview's rendered HTML directly (VS Code doesn't expose the WebviewPanel
// created for a custom editor back to the caller of `vscode.openWith`), so
// each render stores its output here, keyed by document URI, for the test
// suite to read via the extension's exports. Negligible memory/perf cost;
// has no effect on normal usage.
const lastRenderedHtmlByUri = new Map<string, string>();

export function getLastRenderedHtmlForTesting(uriString: string): string | undefined {
  return lastRenderedHtmlByUri.get(uriString);
}

/**
 * Clears every in-memory cache the extension keeps (the test-only render
 * cache above, the keymap cache below, and the image-dimensions cache in
 * ditaRenderUtils.ts). lastRenderedHtmlByUri entries are already removed
 * individually as each webview panel disposes (see onDidDispose in
 * resolveCustomTextEditor), and keyMapCache/imageDimensionsCache are
 * already bounded by their own caps -- this is a defensive full reset for
 * extension deactivation, not a fix for an actual leak in any of them.
 * Wired into extension.ts's deactivate().
 */
export function clearAllCaches(): void {
  lastRenderedHtmlByUri.clear();
  keyMapCache.clear();
  clearImageDimensionsCache();
}

// Font preferences (size % + serif toggle) are global rather than per-document:
// they describe how the user likes to read, not something tied to one file.
const FONT_PREFS_KEY = 'ditaViewer.fontPrefs';
const DEFAULT_FONT_PREFS = { size: 100, serif: false };

// CSS theme and page-width choices, unlike font prefs, ARE tied to one
// document -- discoverCssFiles() scans relative to each document's own
// directory, so a different file may not even have the same set of custom
// CSS files available. Persisted per-uri rather than globally so opening
// a different project doesn't inherit a selection that might not apply
// (or might silently mean something else) there. Without this, both
// dropdowns silently reset on every re-render: webview.html is reassigned
// wholesale on every edit, which reruns generateHtml() from scratch, and
// discoverCssFiles()'s own always-recomputed default was the only thing
// ever fed back in -- whatever the person had picked at runtime lived
// only in the old page's now-discarded JS state.
const CSS_SELECTION_KEY = 'ditaViewer.cssSelectionByUri';
const WIDTH_SELECTION_KEY = 'ditaViewer.widthSelectionByUri';

function getWebviewScript(): string {
  const L = {
    previewToolbar: JSON.stringify(vscode.l10n.t('Preview toolbar')),
    selectThemeCss: JSON.stringify(vscode.l10n.t('Select theme CSS')),
    decreaseFontSize: JSON.stringify(vscode.l10n.t('Decrease font size')),
    increaseFontSize: JSON.stringify(vscode.l10n.t('Increase font size')),
    fontSans: JSON.stringify(vscode.l10n.t('Sans')),
    fontSerif: JSON.stringify(vscode.l10n.t('Serif')),
    fontCurrentSans: JSON.stringify(vscode.l10n.t('Current: Sans-serif. Click to switch to Serif')),
    fontCurrentSerif: JSON.stringify(vscode.l10n.t('Current: Serif. Click to switch to Sans-serif')),
    resetFont: JSON.stringify(vscode.l10n.t('Reset font size and family to default')),
    imgZoomOutTitle: JSON.stringify(vscode.l10n.t('Zoom out this image (preview only)')),
    imgZoomInTitle: JSON.stringify(vscode.l10n.t('Zoom in this image (preview only)')),
    imgMaximizeTitle: JSON.stringify(vscode.l10n.t('View full-screen (use ←/→ to switch images)')),
    profilingLabel: JSON.stringify(vscode.l10n.t('Flags')),
    profilingOnTitle: JSON.stringify(vscode.l10n.t('Profiling attributes (props/otherprops/audience/...) are highlighted. Click to hide the highlighting.')),
    profilingOffTitle: JSON.stringify(vscode.l10n.t('Profiling attribute highlighting is hidden. Click to show which content is flagged and with what.')),
    pageWidth: JSON.stringify(vscode.l10n.t('Page width')),
    widthAuto: JSON.stringify(vscode.l10n.t('Auto')),
    widthFull: JSON.stringify(vscode.l10n.t('Full')),
    widthWide: JSON.stringify(vscode.l10n.t('Wide')),
    widthDesktop: JSON.stringify(vscode.l10n.t('Desktop')),
    widthNarrow: JSON.stringify(vscode.l10n.t('Narrow')),
    reloadContent: JSON.stringify(vscode.l10n.t('Reload DITA content')),
    searchPlaceholder: vscode.l10n.t('Search'),
    searchNext: vscode.l10n.t('Next match'),
    searchPrev: vscode.l10n.t('Previous match'),
    searchClose: vscode.l10n.t('Close search'),
    searchMatchCase: vscode.l10n.t('Match case'),
    searchUseRegex: vscode.l10n.t('Use regex'),
    searchInvalidRegex: vscode.l10n.t('Invalid regex'),
    filterLabel: vscode.l10n.t('Filter'),
    filterTitle: vscode.l10n.t('Show/hide content by profiling attribute value (actually hides matching content, unlike the Flags toggle which only shows/hides the highlight)'),
    filterClose: vscode.l10n.t('Close'),
    filterEmpty: vscode.l10n.t('No profiling attributes in this document'),
  };
  return `
(function() {
  var vscode = acquireVsCodeApi();
  var scrollTimer = null;

  function findClosest(line) {
    var els = document.querySelectorAll('[data-line]');
    var best = null;
    var bestDiff = Infinity;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var l = parseInt(el.getAttribute('data-line'), 10);
      var d = Math.abs(l - line);
      if (d < bestDiff) { bestDiff = d; best = el; }
    }
    return best;
  }

  // Finds the smallest (most specific / deepest) element whose full source
  // range actually contains the given (line, col) position, rather than
  // just picking whichever element's *start* line happens to be numerically
  // closest. This correctly distinguishes plain text that is a direct child
  // of a coarse ancestor (e.g. <p>) from an inline tag (e.g. <uicontrol>)
  // that shares the same source line but only covers a narrower column range.
  function findContaining(line, col) {
    var els = document.querySelectorAll('[data-line]');
    var best = null;
    var bestSpan = Infinity;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var sl = parseInt(el.getAttribute('data-line'), 10);
      var el2 = parseInt(el.getAttribute('data-end-line'), 10);
      var sc = parseInt(el.getAttribute('data-start-col'), 10);
      var ec = parseInt(el.getAttribute('data-end-col'), 10);
      if (isNaN(sl) || isNaN(el2) || isNaN(sc) || isNaN(ec)) continue;
      var afterStart = line > sl || (line === sl && col >= sc);
      var beforeEnd = line < el2 || (line === el2 && col <= ec);
      if (!afterStart || !beforeEnd) continue;
      var span = (el2 - sl) * 100000 + (ec - sc);
      if (span < bestSpan) { bestSpan = span; best = el; }
    }
    return best || findClosest(line);
  }

  function onScrollEnd() {
    // A scroll that we ourselves triggered (revealLine / highlightLine
    // below) must not be echoed back out as 'scrollSync', or every source
    // edit that causes the extension to reveal a line in the preview loops
    // straight back into the extension moving the *editor's* cursor —
    // which corrupts whatever the user is mid-typing. Only genuine
    // user-driven scrolling in the preview should ever reach the extension.
    if (programmaticScroll) return;
    try {
      var els = document.querySelectorAll('[data-line]');
      if (!els.length) return;
      var best = els[0], bestDist = Math.abs(els[0].getBoundingClientRect().top);
      for (var i = 1; i < els.length; i++) {
        var dist = Math.abs(els[i].getBoundingClientRect().top);
        if (dist < bestDist) { bestDist = dist; best = els[i]; }
      }
      var line = best.getAttribute('data-line');
      if (line !== null) vscode.postMessage({ type: 'scrollSync', line: parseInt(line, 10) });
    } catch(e) {}
  }

  // Whether the scroll currently in progress (or about to start) was
  // commanded by us (scrollToLine / the top-of-doc case below) rather than
  // the person's own mouse/trackpad/keyboard. A programmatic smooth-scroll
  // over a long distance (e.g. clicking near the end of a long source file
  // while the preview happens to be scrolled near the top) can run well
  // past a fixed guess at "how long should this take" -- scrollend fires
  // exactly when the browser itself considers scrolling (including easing/
  // momentum) to have actually settled, so there's no duration to guess at
  // all. This replaced an earlier fixed ~700ms suppression window: on a
  // long enough programmatic scroll, that window could expire before the
  // animation visually finished, letting an intermediate (not yet final)
  // scroll position leak out as a real 'scrollSync' -- which the extension
  // would act on by force-revealing that line in the *source* editor,
  // visibly snapping the source's viewport out from under a click that had
  // nothing to do with scrolling in the first place.
  var programmaticScroll = false;
  var programmaticScrollFallbackTimer = null;
  var supportsScrollend = 'onscrollend' in window;
  function beginProgrammaticScroll() {
    programmaticScroll = true;
    if (!supportsScrollend) {
      // Old-webview fallback only -- current VS Code's Chromium has
      // supported scrollend since well before this was written. Generous
      // on purpose, since the only failure mode of guessing too long here
      // is a brief window where a genuine user scroll right on the heels
      // of a programmatic one doesn't get reported -- much less disruptive
      // than the AtTop-reveal jump guessing too short used to cause.
      if (programmaticScrollFallbackTimer) clearTimeout(programmaticScrollFallbackTimer);
      programmaticScrollFallbackTimer = setTimeout(function() { programmaticScroll = false; }, 2000);
    }
  }
  if (supportsScrollend) {
    window.addEventListener('scrollend', function() {
      // Checked and cleared together, synchronously, in the one place that
      // both this flag and the resulting report are decided -- no separate
      // timer racing against the real scroll to get the order wrong.
      if (programmaticScroll) { programmaticScroll = false; return; }
      onScrollEnd();
    });
  }

  function scrollToLine(targetLine, instant) {
    var behavior = instant ? 'auto' : 'smooth';
    if (targetLine <= 0) { beginProgrammaticScroll(); window.scrollTo({ top: 0, behavior: behavior }); return; }
    var best = findClosest(targetLine);
    if (!best) return;
    var rect = best.getBoundingClientRect();
    if (rect.top < -5 || rect.top > 5) {
      beginProgrammaticScroll();
      best.scrollIntoView({ block: 'start', behavior: behavior });
    }
  }

  var fontPrefs = window.__fontPrefs || { size: 100, serif: false };
  var fontSize = typeof fontPrefs.size === 'number' ? fontPrefs.size : 100;
  var isSerif = fontPrefs.serif === true;
  var SERIF_STACK = "Georgia,'Times New Roman','Noto Serif SC','Songti SC',STSong,SimSun,serif";

  function applyFontPrefs() {
    document.body.style.fontSize = fontSize + '%';
    document.body.style.fontFamily = isSerif ? SERIF_STACK : '';
  }
  applyFontPrefs();

  function saveFontPrefs() {
    vscode.postMessage({ type: 'setFontPrefs', size: fontSize, serif: isSerif });
  }

  // Static highlight (no animation)
  var hlStyle = document.createElement('style');
  hlStyle.textContent = '.__hl{outline:2px solid var(--vscode-textLink-foreground,#4a90d9);outline-offset:2px;border-radius:3px;background:color-mix(in srgb,var(--vscode-textLink-foreground,#4a90d9) 12%,transparent);}';
  document.head.appendChild(hlStyle);

  // Image error handling (event delegation, nonce-safe)
  document.addEventListener('error', function(e) {
    var img = e.target;
    if (img.tagName !== 'IMG' || !img.hasAttribute('data-dita-src')) return;
    var src = img.getAttribute('data-dita-src') || 'unknown';
    var msg = 'Image fail: ' + src;
    // Only use the failure text as alt if the author never supplied one —
    // a real DITA <alt>/@alt is more useful than a load-failure string and
    // shouldn't be overwritten by it. The failure is still surfaced via
    // title (hover) and the red outline either way.
    if (!img.getAttribute('alt')) img.alt = msg;
    img.title = msg;
    img.setAttribute('data-load-error', 'true');
    img.style.outline = '3px solid red';
    img.style.outlineOffset = '-1px';
  }, true);

  // Click-to-enlarge lightbox. The whole image is still a click target
  // (cursor:zoom-in hints this) in addition to the per-image maximize
  // button below — either way opens the same lightbox. Broken images are
  // excluded from both. While the lightbox is open, ←/→ step through every
  // eligible image on the page in document order without closing the
  // overlay, so browsing a page of screenshots doesn't require reopening
  // the lightbox for each one.
  var lightboxOverlay = null;
  var lightboxBigImg = null;
  var lightboxImgs = [];
  var lightboxIdx = -1;

  function lightboxCandidates() {
    return Array.prototype.slice.call(document.querySelectorAll('img[data-dita-src]:not([data-load-error])'));
  }

  function onLightboxKeydown(e) {
    if (e.key === 'Escape') { closeLightbox(); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); lightboxStep(-1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); lightboxStep(1); return; }
  }

  function closeLightbox() {
    if (!lightboxOverlay) return;
    lightboxOverlay.remove();
    lightboxOverlay = null;
    lightboxBigImg = null;
    lightboxImgs = [];
    lightboxIdx = -1;
    document.removeEventListener('keydown', onLightboxKeydown);
  }

  function showLightboxImage() {
    if (!lightboxBigImg || lightboxIdx < 0 || lightboxIdx >= lightboxImgs.length) return;
    var img = lightboxImgs[lightboxIdx];
    lightboxBigImg.src = img.src;
    lightboxBigImg.alt = img.alt || '';
  }

  function lightboxStep(delta) {
    if (lightboxImgs.length < 2) return;
    lightboxIdx = (lightboxIdx + delta + lightboxImgs.length) % lightboxImgs.length;
    showLightboxImage();
  }

  function openLightbox(img) {
    closeLightbox();
    lightboxImgs = lightboxCandidates();
    lightboxIdx = lightboxImgs.indexOf(img);
    if (lightboxIdx === -1) { lightboxImgs = [img]; lightboxIdx = 0; }
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
    var big = document.createElement('img');
    big.style.cssText = 'max-width:92vw;max-height:92vh;object-fit:contain;box-shadow:0 4px 24px rgba(0,0,0,0.5);border-radius:4px;';
    overlay.appendChild(big);
    overlay.addEventListener('click', closeLightbox);
    document.addEventListener('keydown', onLightboxKeydown);
    document.body.appendChild(overlay);
    lightboxOverlay = overlay;
    lightboxBigImg = big;
    showLightboxImage();
  }
  document.addEventListener('click', function(e) {
    var img = e.target.closest ? e.target.closest('img[data-dita-src]') : null;
    if (!img || img.getAttribute('data-load-error') === 'true') return;
    openLightbox(img);
  });

  // Per-image zoom controls: a small hover toolbar pinned to each image's
  // own top-right corner (−, +, maximize), replacing the old page-wide
  // toolbar zoom control — each image now scales independently instead of
  // all images shrinking together. "100%" here means the image's own
  // CSS-natural on-screen width (after @scale, container constraints,
  // etc.), captured lazily on first use rather than assumed to be the
  // image's raw pixel width, since that's what "zoom in/out from here"
  // should mean to someone looking at the rendered page.
  //
  // Includes steps below 100 so "−" actually shrinks the image (previously
  // 100 was the floor, so − was a no-op at the default zoom level — the
  // reported "clicking shrink does nothing" bug). DEFAULT_ZOOM_IDX is the
  // index new/never-zoomed images implicitly start at (100%, i.e. no
  // zoom-idx attribute yet) — the click handlers below fall back to this
  // instead of a bare 0 now that index 0 no longer means 100%.
  var IMG_ZOOM_STEPS = [50, 75, 100, 125, 150, 175, 200];
  var DEFAULT_ZOOM_IDX = IMG_ZOOM_STEPS.indexOf(100);

  function imgBaseWidth(img) {
    var cached = img.getAttribute('data-dita-base-width');
    if (cached) return parseFloat(cached);
    var prevWidth = img.style.width, prevMaxWidth = img.style.maxWidth;
    img.style.width = '';
    img.style.maxWidth = '';
    var w = img.getBoundingClientRect().width || img.naturalWidth || 300;
    img.style.width = prevWidth;
    img.style.maxWidth = prevMaxWidth;
    // Only cache once the image has actually finished loading. DITA
    // <image> renders as loading="lazy" with no @width/@height reserved
    // in the common case (source doesn't specify them), so a zoom click
    // that lands before the image has decoded can measure a near-zero (or
    // the "|| 300" fallback) box. Caching that permanently -- this
    // attribute is never otherwise invalidated -- would lock every later
    // zoom step to that bogus baseline, so clicking "+" would shrink the
    // image to a fraction of what was already on screen instead of
    // enlarging it. Leaving it uncached means the next call re-measures,
    // picking up the real size once the image has loaded.
    if (img.complete && img.naturalWidth > 0) {
      img.setAttribute('data-dita-base-width', String(w));
    }
    return w;
  }

  // Reads the image's current zoom-level index, defaulting to
  // DEFAULT_ZOOM_IDX (100%) for a never-zoomed image rather than a bare 0
  // -- index 0 is now the 50% step, not 100%, now that IMG_ZOOM_STEPS has
  // shrink steps below it.
  function currentZoomIdx(img) {
    var raw = img.getAttribute('data-dita-zoom-idx');
    if (raw === null) return DEFAULT_ZOOM_IDX;
    var idx = parseInt(raw, 10);
    return isNaN(idx) ? DEFAULT_ZOOM_IDX : idx;
  }

  function setImgZoom(img, idx) {
    idx = Math.max(0, Math.min(IMG_ZOOM_STEPS.length - 1, idx));
    img.setAttribute('data-dita-zoom-idx', String(idx));
    var pct = IMG_ZOOM_STEPS[idx];
    var wrap = img.closest('.dita-img-wrap');
    if (pct === 100) {
      img.style.width = '';
      img.style.maxWidth = '';
      if (wrap) wrap.style.overflow = '';
    } else {
      var base = imgBaseWidth(img);
      img.style.width = Math.round(base * pct / 100) + 'px';
      img.style.maxWidth = 'none';
      if (wrap) wrap.style.overflow = 'auto';
    }
  }

  function makeImgToolbarBtn(label, title, onClick) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dita-img-btn';
    btn.textContent = label;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.addEventListener('click', function(e) {
      // Buttons sit inside the same wrapper as the image but are not
      // themselves the image, so the document-level click-to-lightbox
      // delegation above wouldn't fire for them anyway — stopPropagation
      // here is just future-proofing against any other ancestor click
      // handler, not strictly required by the current listener.
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  // Wraps each <img data-dita-src> in a positioning container with its own
  // hover toolbar. Runs once per image (data-dita-enhanced guards against
  // re-wrapping); safe to call again after content is re-rendered since
  // webview.html is replaced wholesale on document changes, which reruns
  // this whole script from scratch against a fresh, unmarked DOM.
  function enhanceImages() {
    var imgs = document.querySelectorAll('img[data-dita-src]:not([data-dita-enhanced])');
    for (var i = 0; i < imgs.length; i++) {
      enhanceOneImage(imgs[i]);
    }
  }

  // Split out of enhanceImages() as its own function (rather than an inline
  // loop body) specifically so each image gets its own function scope for
  // 'img' — a 'var img = imgs[i]' declared directly inside the for-loop
  // body would be a single variable shared by every iteration's closures,
  // so all three buttons on every image would end up operating on
  // whichever image happened to be enhanced last.
  function enhanceOneImage(img) {
    img.setAttribute('data-dita-enhanced', '1');
    if (img.getAttribute('data-load-error') === 'true' || !img.parentNode) return;

    var wrap = document.createElement('span');
    wrap.className = 'dita-img-wrap';
    img.parentNode.insertBefore(wrap, img);
    wrap.appendChild(img);

    // If a zoom button gets clicked while this image is still loading
    // (loading="lazy", usually no @width/@height reserved), imgBaseWidth()
    // won't have cached a base yet (see the img.complete guard there), so
    // the click applies a size computed from an unreliable in-flight
    // measurement. Once the image actually finishes loading, snap it to
    // whatever zoom level is currently set so it settles on the correct
    // size instead of staying at that first, unreliable guess.
    img.addEventListener('load', function() {
      var idx = currentZoomIdx(img);
      if (idx !== DEFAULT_ZOOM_IDX) setImgZoom(img, idx);
    });

    var tb = document.createElement('span');
    tb.className = 'dita-img-toolbar';
    tb.appendChild(makeImgToolbarBtn('\u2212', ${L.imgZoomOutTitle}, function() {
      var i2 = currentZoomIdx(img);
      setImgZoom(img, i2 - 1);
    }));
    tb.appendChild(makeImgToolbarBtn('+', ${L.imgZoomInTitle}, function() {
      var i2 = currentZoomIdx(img);
      setImgZoom(img, i2 + 1);
    }));
    tb.appendChild(makeImgToolbarBtn('\u2922', ${L.imgMaximizeTitle}, function() {
      openLightbox(img);
    }));
    wrap.appendChild(tb);
  }
  enhanceImages();
  // Images that error out asynchronously (after enhanceImages already ran)
  // should lose their now-pointless zoom/maximize toolbar rather than
  // leave working-looking controls on a broken image.
  document.addEventListener('error', function(e) {
    var img = e.target;
    if (img.tagName !== 'IMG' || !img.hasAttribute('data-dita-src')) return;
    var tb = img.closest('.dita-img-wrap') && img.closest('.dita-img-wrap').querySelector('.dita-img-toolbar');
    if (tb) tb.remove();
  }, true);

  function highlightElement(el) {
    if (!el) return;
    var prev = document.querySelector('.__hl');
    if (prev) prev.classList.remove('__hl');
    el.classList.add('__hl');
  }

  function isElementVisible(el) {
    var rect = el.getBoundingClientRect();
    return rect.top < window.innerHeight && rect.bottom > 0;
  }

  // Only needed as the fallback debounce for environments without
  // scrollend support (see beginProgrammaticScroll above) -- when scrollend
  // is available, onScrollEnd is invoked directly from that listener
  // instead, so this generic scroll+timeout guess isn't in the loop at all
  // for the common case.
  if (!supportsScrollend) {
    window.addEventListener('scroll', function() {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(onScrollEnd, 150);
    });
  }

  window.addEventListener('click', function(e) {
    var a = e.target.closest ? e.target.closest('a.xref') : null;
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) !== '#') return;
    e.preventDefault();
    var id = href.slice(1);
    var el = document.getElementById(id);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });

  window.addEventListener('dblclick', function(e) {
    var el = e.target.closest ? e.target.closest('[data-line]') : null;
    if (!el) return;
    var line = parseInt(el.getAttribute('data-line'), 10);
    if (!isNaN(line)) vscode.postMessage({ type: 'navigateToLine', line: line });
  });

  // Tracked so a content swap (updateContent below) that lands mid-flight
  // of an in-progress highlight/scroll can re-apply it against the fresh
  // DOM, instead of abandoning it. The scrollIntoView triggered here can
  // still be animating when the very next edit's debounced content update
  // arrives (300ms is often shorter than a long smooth-scroll across a
  // large document) -- replacing #dita-content-root's contents mid-
  // animation orphans whatever element the browser was interpolating
  // toward, since it's a brand new DOM node after the swap, not the one
  // the animation was actually tracking. Without re-applying it here, that
  // looked like the preview overshooting past the edit position and only
  // correcting itself on the *next* keystroke's highlightLine, rather than
  // the same one settling smoothly -- most visible on a source edit far
  // from wherever the preview happened to already be scrolled, since
  // that's when the initial scroll has the most distance (and time) left
  // to still be animating when the first content update lands.
  var lastHighlightLine = null;
  var lastHighlightCol = 0;
  function applyHighlightLine(line, col) {
    var best = findContaining(line, col || 0);
    if (best) {
      highlightElement(best);
      if (!isElementVisible(best)) {
        beginProgrammaticScroll();
        best.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }

  window.addEventListener('message', function(e) {
    if (e.data.type === 'revealLine') scrollToLine(e.data.line);
    if (e.data.type === 'highlightLine') {
      lastHighlightLine = e.data.line;
      lastHighlightCol = e.data.col || 0;
      applyHighlightLine(lastHighlightLine, lastHighlightCol);
    }
    if (e.data.type === 'updateContent') {
      var contentRoot = document.getElementById('dita-content-root');
      if (contentRoot) {
        // No page reload happened -- window.scrollY is left exactly where
        // it was by the browser automatically, the same as any other
        // in-place DOM update, with nothing here to explicitly restore.
        // Whatever depends on the *previous* content's DOM needs a nudge
        // to pick up the new one, though:
        contentRoot.innerHTML = e.data.html;
        enhanceImages(); // per-image zoom toolbars -- idempotent, only wraps images not already wrapped
        if (typeof pfApplyFilter === 'function') pfApplyFilter(); // re-apply the current filter selection to the new content's [data-profile-keys] elements
        if (typeof pfPanel !== 'undefined' && pfPanel) { // filter panel was open -- refresh its checkbox list against the new content rather than leaving it showing stale attribute/value options
          pfPanel.remove();
          pfPanel = pfBuildPanel();
          document.body.appendChild(pfPanel);
        }
        if (typeof sb !== 'undefined' && sb.style.display !== 'none' && searchInput.value) { // search was active -- old marks were just wiped out along with the content that contained them
          performSearch(searchInput.value);
        }
        if (lastHighlightLine !== null) {
          // Re-target the still-current cursor position against the new
          // DOM. If the earlier scroll had already settled and the spot
          // is still on screen, applyHighlightLine's own isElementVisible
          // check is a no-op here -- this only actually re-scrolls when
          // there was real unfinished business to pick back up.
          applyHighlightLine(lastHighlightLine, lastHighlightCol);
        }
      }
    }
  });

  // Toolbar
  var tbStyle = 'position:fixed;top:4px;right:8px;z-index:9999;display:flex;align-items:center;gap:4px;padding:3px 6px;border-radius:5px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:12px;background:var(--vscode-editor-background,rgba(30,30,30,0.88));border:1px solid var(--vscode-widget-border,rgba(255,255,255,0.12));backdrop-filter:blur(4px);opacity:0.75;transition:opacity 0.15s;';
  var ddStyle = 'padding:1px 4px;border-radius:3px;border:1px solid var(--vscode-dropdown-border,var(--vscode-widget-border,#555));background:var(--vscode-dropdown-background,#333);color:var(--vscode-dropdown-foreground,#eee);font-size:11px;outline:none;cursor:pointer;';
  var btnStyle = 'padding:1px 5px;border-radius:3px;border:1px solid var(--vscode-dropdown-border,var(--vscode-widget-border,#555));background:var(--vscode-dropdown-background,#333);color:var(--vscode-dropdown-foreground,#eee);cursor:pointer;font-size:13px;line-height:1;outline:none;display:flex;align-items:center;';

  var toolbar = document.createElement('div');
  toolbar.id = '__toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', ${L.previewToolbar});
  toolbar.style.cssText = tbStyle;
  toolbar.addEventListener('mouseenter', function() { toolbar.style.opacity = '1'; });
  toolbar.addEventListener('mouseleave', function() { toolbar.style.opacity = '0.75'; });

  // Theme CSS dropdown
  var cssFiles = window.__cssFiles || {};
  var defaultCss = window.__defaultCss || '';
  var cssKeys = Object.keys(cssFiles);
  if (cssKeys.length > 0) {
    var styleEl = document.createElement('style');
    styleEl.id = '__custom_css';
    styleEl.textContent = cssFiles[defaultCss] || '';
    document.head.appendChild(styleEl);
    var sel = document.createElement('select');
    sel.title = ${L.selectThemeCss};
    sel.setAttribute('aria-label', ${L.selectThemeCss});
    sel.style.cssText = 'max-width:130px;' + ddStyle;
    for (var i = 0; i < cssKeys.length; i++) {
      var opt = document.createElement('option');
      opt.value = cssKeys[i];
      opt.textContent = cssKeys[i].replace(/\\.css$/,'');
      if (cssKeys[i] === defaultCss) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', function() {
      styleEl.textContent = cssFiles[sel.value] || '';
      vscode.postMessage({ type: 'setCssSelection', value: sel.value });
    });
    toolbar.appendChild(sel);
  }

  // Font size controls
  var fsDown = document.createElement('button');
  fsDown.innerHTML = 'A−';
  fsDown.title = ${L.decreaseFontSize};
  fsDown.setAttribute('aria-label', ${L.decreaseFontSize});
  fsDown.style.cssText = btnStyle;
  fsDown.addEventListener('click', function() {
    fontSize = Math.max(60, fontSize - 10);
    document.body.style.fontSize = fontSize + '%';
    saveFontPrefs();
  });
  toolbar.appendChild(fsDown);

  var fsUp = document.createElement('button');
  fsUp.innerHTML = 'A+';
  fsUp.title = ${L.increaseFontSize};
  fsUp.setAttribute('aria-label', ${L.increaseFontSize});
  fsUp.style.cssText = btnStyle;
  fsUp.addEventListener('click', function() {
    fontSize = Math.min(200, fontSize + 10);
    document.body.style.fontSize = fontSize + '%';
    saveFontPrefs();
  });
  toolbar.appendChild(fsUp);

  // Font toggle (serif / sans-serif) — reflects the persisted state on open
  var fontBtn = document.createElement('button');
  fontBtn.textContent = isSerif ? ${L.fontSerif} : ${L.fontSans};
  fontBtn.title = isSerif ? ${L.fontCurrentSerif} : ${L.fontCurrentSans};
  fontBtn.setAttribute('aria-label', isSerif ? ${L.fontCurrentSerif} : ${L.fontCurrentSans});
  fontBtn.style.cssText = btnStyle + 'font-size:11px;';
  fontBtn.addEventListener('click', function() {
    isSerif = !isSerif;
    fontBtn.textContent = isSerif ? ${L.fontSerif} : ${L.fontSans};
    fontBtn.title = isSerif ? ${L.fontCurrentSerif} : ${L.fontCurrentSans};
    fontBtn.setAttribute('aria-label', isSerif ? ${L.fontCurrentSerif} : ${L.fontCurrentSans});
    document.body.style.fontFamily = isSerif ? SERIF_STACK : '';
    saveFontPrefs();
  });
  toolbar.appendChild(fontBtn);

  // Reset font size + family to default in one click
  var fontResetBtn = document.createElement('button');
  fontResetBtn.innerHTML = '&#8635;';
  fontResetBtn.title = ${L.resetFont};
  fontResetBtn.setAttribute('aria-label', ${L.resetFont});
  fontResetBtn.style.cssText = btnStyle + 'font-size:12px;';
  fontResetBtn.addEventListener('click', function() {
    fontSize = 100;
    isSerif = false;
    applyFontPrefs();
    fontBtn.textContent = ${L.fontSans};
    fontBtn.title = ${L.fontCurrentSans};
    fontBtn.setAttribute('aria-label', ${L.fontCurrentSans});
    saveFontPrefs();
  });
  toolbar.appendChild(fontResetBtn);

  // Image display zoom is no longer a page-wide toolbar control — see
  // enhanceImages()/setImgZoom() above, which attach a per-image hover
  // toolbar (−/+/maximize) directly to each <img> instead.

  // Profiling / conditional-attribute highlight toggle. Purely a CSS class
  // flip (body.hide-profiling, see styles.css) -- the highlight markup is
  // always present in the rendered HTML, so toggling is instant and needs
  // no message round-trip to the extension or re-render. Defaults on: the
  // point of this feature is surfacing profiled content, so it should be
  // visible without the user having to discover the toggle first.
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

  // Filter button goes immediately next to Flags -- "show me what's
  // flagged" and "actually hide what's flagged" are closely related
  // controls and read as a pair, so they sit adjacent in the toolbar
  // rather than being separated by the width/refresh controls.
  ${getProfilingFilterScript({
    buttonLabel: L.filterLabel,
    buttonTitle: L.filterTitle,
    closeLabel: L.filterClose,
    emptyLabel: L.filterEmpty,
  })}

  // Page width dropdown
  var widths = [
    { label: ${L.widthAuto}, value: '' },
    { label: ${L.widthFull}, value: '100%' },
    { label: ${L.widthWide}, value: '1400px' },
    { label: ${L.widthDesktop}, value: '1280px' },
    { label: ${L.widthNarrow}, value: '720px' },
  ];
  var wSel = document.createElement('select');
  wSel.title = ${L.pageWidth};
  wSel.setAttribute('aria-label', ${L.pageWidth});
  wSel.style.cssText = 'max-width:72px;' + ddStyle;
  var restoredWidth = window.__widthSelection || '';
  for (var i = 0; i < widths.length; i++) {
    var opt = document.createElement('option');
    opt.value = widths[i].value;
    opt.textContent = widths[i].label;
    if (widths[i].value === restoredWidth) opt.selected = true;
    wSel.appendChild(opt);
  }
  function applyWidth(value) {
    document.body.style.maxWidth = value;
    document.body.style.margin = value ? '0 auto' : '';
  }
  if (restoredWidth) applyWidth(restoredWidth);
  wSel.addEventListener('change', function() {
    applyWidth(wSel.value);
    vscode.postMessage({ type: 'setWidthSelection', value: wSel.value });
  });
  toolbar.appendChild(wSel);

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

  // Restores whatever the source editor's scroll position was at the
  // moment this HTML was generated (see updateWebview -- every re-render
  // reassigns webview.html wholesale, which is a full page reload and
  // resets scroll to 0). Baking the target line into the page and jumping
  // there instantly, before the person ever sees the reset frame, replaces
  // the old "reset to top, then 200ms later animate back down" round trip
  // -- which was the actual visible jump on every pause while typing --
  // with a single non-animated correction. window.__initialScrollLine is
  // set in the small inline script in <head>, ahead of this one.
  if (typeof window.__initialScrollLine === 'number') {
    scrollToLine(window.__initialScrollLine, true);
  }
})();
`;
}

export class DitaViewerProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const documentRoot = vscode.Uri.file(dirname(document.uri.fsPath));

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(this.context.extensionPath),
        documentRoot,
        ...(vscode.workspace.workspaceFolders || []).map((f) => f.uri),
      ],
    };

    const findSourceEditor = () =>
      vscode.window.visibleTextEditors.find(
        (e) => e.document.uri.toString() === document.uri.toString(),
      );

    // The toggle command (and "Reopen Editor With") can dispose this panel
    // while sync timers are still pending — guard every deferred webview
    // access so nothing posts to a disposed webview.
    let disposed = false;

    const postRevealLine = (line: number) => {
      if (disposed) return;
      webviewPanel.webview.postMessage({ type: 'revealLine', line });
    };

    let skipVisibleUntil = 0;

    webviewPanel.webview.onDidReceiveMessage((message) => {
      if (message.type === 'refresh') {
        updateWebview();
      } else if (message.type === 'scrollSync') {
        // Reveal the matching source line as the user scrolls the preview,
        // but deliberately do NOT move editor.selection here — unlike
        // navigateToLine (an explicit double-click, i.e. real navigation
        // intent), continuous scroll-follow shouldn't relocate the actual
        // typing cursor. Besides being surprising on its own, it's also
        // what made the webview-echo race above so damaging: it wasn't
        // just the preview flickering, it was the *editor selection*
        // jumping mid-keystroke.
        const editor = findSourceEditor();
        if (editor) {
          const currentTopLine = editor.visibleRanges[0]?.start.line;
          if (currentTopLine !== undefined) {
            const diff = Math.abs(message.line - currentTopLine);
            if (diff >= 2) {
              skipVisibleUntil = Date.now() + 250;
              const line = Math.max(0, Math.min(message.line, document.lineCount - 1));
              editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.AtTop);
            }
          }
        }
      } else if (message.type === 'navigateToLine') {
        // Preview double-click → highlight in source, only scroll if not visible
        const editor = findSourceEditor();
        if (editor) {
          const line = Math.max(0, Math.min(message.line, document.lineCount - 1));
          const inView = editor.visibleRanges.some(r => line >= r.start.line && line <= r.end.line);
          if (!inView) {
            editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.AtTop);
          }
          editor.selection = new vscode.Selection(new vscode.Position(line, 0), new vscode.Position(line, 0));
        }
      } else if (message.type === 'setFontPrefs') {
        // Persist across webview reopens/reloads — same size/family applies
        // to every DITA file the user previews, not per-document.
        const size = typeof message.size === 'number' ? message.size : DEFAULT_FONT_PREFS.size;
        const serif = message.serif === true;
        this.context.globalState.update(FONT_PREFS_KEY, { size, serif });
      } else if (message.type === 'setCssSelection') {
        // Persisted per-document (see CSS_SELECTION_KEY above) so the next
        // re-render (every edit reassigns webview.html wholesale, which
        // otherwise silently reset this back to discoverCssFiles()'s own
        // always-recomputed default) picks the same file back up.
        if (typeof message.value === 'string') {
          const map = this.context.globalState.get<Record<string, string>>(CSS_SELECTION_KEY, {});
          map[document.uri.toString()] = message.value;
          this.context.globalState.update(CSS_SELECTION_KEY, map);
        }
      } else if (message.type === 'setWidthSelection') {
        if (typeof message.value === 'string') {
          const map = this.context.globalState.get<Record<string, string>>(WIDTH_SELECTION_KEY, {});
          map[document.uri.toString()] = message.value;
          this.context.globalState.update(WIDTH_SELECTION_KEY, map);
        }
      }
    });

    // Source click → preview: highlight + scroll if not visible
    const selectionSub = vscode.window.onDidChangeTextEditorSelection((e) => {
      if (e.textEditor.document.uri.toString() !== document.uri.toString()) return;
      if (Date.now() < skipVisibleUntil) return;
      const sel = e.selections[0];
      if (!sel || sel.start.line !== sel.end.line) return;
      // Moving the cursor somewhere not currently on screen (e.g. clicking
      // near the end of a long file while the editor happens to be
      // scrolled elsewhere) very often also moves the editor's own visible
      // range as a side effect -- VS Code reveals the cursor into view on
      // its own. That would otherwise fire editorSub below shortly after
      // this, telling the preview to align a *different* line (the
      // editor's new visible-range top, from simple continuous scroll-
      // follow) at the *top* of its viewport, fighting the highlightLine
      // this posts, which centers the exact cursor line instead -- visibly
      // the preview correctly centering the edit position, then abruptly
      // sliding to a completely different alignment for what was actually
      // the same underlying cursor move, before a later correction snaps
      // it back. Suppressing editorSub for a beat after a selection change
      // lets highlightLine's centering stand uncontested for what's almost
      // always the same event; a genuine independent source scroll (mouse
      // wheel, no cursor movement) never touches this path at all, since
      // it never fires onDidChangeTextEditorSelection to begin with.
      skipVisibleUntil = Date.now() + 400;
      webviewPanel.webview.postMessage({ type: 'highlightLine', line: sel.start.line, col: sel.start.character });
    });

    let visibleRangeTimer: ReturnType<typeof setTimeout> | undefined;
    const editorSub = vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (e.textEditor.document.uri.toString() !== document.uri.toString()) return;
      if (Date.now() < skipVisibleUntil) return;
      if (visibleRangeTimer) clearTimeout(visibleRangeTimer);
      visibleRangeTimer = setTimeout(() => {
        if (Date.now() < skipVisibleUntil) return;
        const topLine = e.textEditor.visibleRanges[0]?.start.line;
        if (topLine !== undefined) postRevealLine(topLine);
      }, 120);
    });

    let renderDebounceTimer: ReturnType<typeof setTimeout> | undefined;
    const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
      renderDebounceTimer = setTimeout(() => {
        postContentUpdate();
      }, 300);
    });

    // Refresh on changes to files this topic may reference (conref/keyref
    // targets, other .dita/.ditamap files, images, custom CSS) that live
    // outside this document and therefore never fire onDidChangeTextDocument
    // above -- previously the only way to pick these up was the manual
    // reload button. This intentionally watches the whole containing
    // workspace folder rather than precisely tracking this document's own
    // resolved dependency set: the renderer doesn't currently surface which
    // files a given render actually touched, and workspace-wide DITA
    // projects commonly pull conrefs/keydefs from ancestor or sibling
    // directories, so a scoped watch would risk silently missing exactly
    // the cross-folder references this is meant to catch. The tradeoff is
    // a refresh check firing for edits unrelated to this document; that's
    // a cheap no-op for a single topic, though for a large open book-mode
    // map it re-runs the same full-book render the reload button already
    // did on demand (see the book-mode render cost note in
    // scripts/bench-book-render.js) -- worth revisiting with real
    // dependency tracking if that proves noisy in practice.
    const watchBase =
      vscode.workspace.getWorkspaceFolder(document.uri)?.uri ??
      vscode.Uri.file(dirname(document.uri.fsPath));
    const referencedFilesWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(watchBase, '**/*.{dita,ditamap,css,png,jpg,jpeg,gif,svg,webp}'),
    );
    const onReferencedFileChanged = (uri: vscode.Uri) => {
      if (disposed) return;
      if (uri.toString() === document.uri.toString()) return; // already handled above
      if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
      renderDebounceTimer = setTimeout(() => {
        postContentUpdate();
      }, 300);
    };
    referencedFilesWatcher.onDidChange(onReferencedFileChanged);
    referencedFilesWatcher.onDidCreate(onReferencedFileChanged);
    referencedFilesWatcher.onDidDelete(onReferencedFileChanged);

    // Re-render on theme switch so the manually-computed light/dark class
    // (used for DITA-specific colors that have no direct VS Code theme
    // equivalent, e.g. note backgrounds) never goes stale relative to the
    // actual active theme. A genuine full reload, unlike postContentUpdate
    // below -- the CSS class lives on <html>, outside the content div a
    // content-only update touches.
    const themeSubscription = vscode.window.onDidChangeActiveColorTheme(() => {
      updateWebview();
    });

    const updateWebview = () => {
      if (disposed) return;
      // Every re-render replaces webview.html wholesale (a full page
      // reload), which resets scroll to 0 -- baking in the source editor's
      // current top line lets the fresh page jump there instantly on load
      // instead of the extension separately posting a scroll correction
      // afterward (which visibly showed as "reset to top, then animate
      // back down" on every re-render while typing). Reserved now for the
      // genuinely-rare cases that need a real reload (initial open, theme
      // switch, manual refresh) -- see postContentUpdate for the common
      // case of a regular source edit, which no longer reloads at all.
      const editor = findSourceEditor();
      const initialScrollLine = editor?.visibleRanges[0]?.start.line;
      const html = this.generateHtml(document, webviewPanel.webview, initialScrollLine);
      webviewPanel.webview.html = html;
      lastRenderedHtmlByUri.set(document.uri.toString(), html);
    };

    // The common case: a regular source edit. Sends just the freshly
    // rendered DITA content as a message instead of reassigning
    // webview.html -- the page itself is never destroyed and recreated,
    // so there's no reload to visibly flash/reset, no scroll position to
    // restore (the browser preserves it automatically, the same way it
    // would for any other in-place DOM update), and no window for a
    // scroll-correction message from an unrelated cause (a source click,
    // the editor's own visible-range-follow, ...) to race an in-flight
    // page reload and land on the wrong content -- the exact failure mode
    // reported ("jumps to the right spot, then immediately somewhere
    // else"), since there is no longer a reload for anything to race
    // against. Falls back to a full reload only if rendering itself
    // failed (malformed XML mid-edit, etc.), to show the error page --
    // an error has no "content" to patch in.
    const postContentUpdate = () => {
      if (disposed) return;
      const result = this.renderTopicContent(document, webviewPanel.webview);
      if (result.error !== undefined) {
        updateWebview();
        return;
      }
      webviewPanel.webview.postMessage({ type: 'updateContent', html: result.html });
    };

    updateWebview();

    webviewPanel.onDidDispose(() => {
      disposed = true;
      if (visibleRangeTimer) clearTimeout(visibleRangeTimer);
      if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
      changeSubscription.dispose();
      referencedFilesWatcher.dispose();
      editorSub.dispose();
      selectionSub.dispose();
      themeSubscription.dispose();
      lastRenderedHtmlByUri.delete(document.uri.toString());
    });
  }

  /**
   * Renders just the DITA content (not the surrounding page chrome) --
   * shared by generateHtml (full page, used for initial load/theme switch/
   * refresh) and the incremental content-only update path used for every
   * regular source edit. Pulled out specifically so a content edit no
   * longer needs webview.html reassigned wholesale (a full page reload)
   * just to get fresh content onto the page -- see postContentUpdate.
   */
  private renderTopicContent(
    document: vscode.TextDocument,
    webview: vscode.Webview,
  ): { html: string; error?: undefined } | { html?: undefined; error: string } {
    const docRootDir = dirname(document.uri.fsPath);
    const docRoot = vscode.Uri.file(docRootDir);
    const asWebviewUri = (relPath: string): string => {
      try {
        const resolvedPath = resolve(docRootDir, decodeHrefPart(relPath));
        return webview.asWebviewUri(vscode.Uri.file(resolvedPath)).toString();
      } catch (e) {
        // The empty src still surfaces as a visibly broken image (the
        // webview script's document-level error listener marks it); log
        // the cause so path-resolution failures are debuggable.
        console.warn(`Failed to resolve webview URI for ${relPath}:`, e instanceof Error ? e.message : e);
        return '';
      }
    };

    try {
      const rawXml = document.getText();
      const preprocessedXml = preprocessEntities(rawXml);
      const ditaDoc = parseDita(preprocessedXml);
      const titleMap = buildTitleMap(ditaDoc.root);

      // Note-type labels (Warning/Attention/...): prefer the topic's own
      // xml:lang, but most individual topic files don't repeat it on every
      // file (commonly set once at the map/bookmap level and left implicit
      // on topics), so fall back to the editor's own display language
      // rather than leaving those topics stuck in English regardless of
      // locale. Uses the shared, complete (all 13 DITA note/@type values)
      // implementation from ditaRenderUtils.ts instead of the separate,
      // partial (7 of 13 types) local copy this used to carry.
      const noteLabels = detectNoteLabels(ditaDoc.root, vscode.env.language);
      const indexLabel = detectIndexLabel(ditaDoc.root, vscode.env.language);

      // Build key map from DITAMAP
      const keyMap = buildKeyMap(document.uri);

      // Build conref resolver
      const conrefResolver = makeConrefResolver(docRootDir);
      const conrefRangeResolver = makeConrefRangeResolver(docRootDir);
      const fileTitleResolver = makeFileTitleResolver(docRootDir);

      const resolveTitle = (id: string): string | undefined => {
        // Local id match first
        const local = titleMap.get(id);
        if (local) return local;
        // Cross-file: id may be "file.dita#topicId" or just "file.dita"
        return fileTitleResolver(id);
      };

      const content = renderDocument(ditaDoc.root, {
        headingLevel: 1,
        asWebviewUri,
        documentDir: docRoot.fsPath,
        resolveTitle,
        resolveKey: (key: string) => keyMap.get(key),
        resolveConref: (conref: string) => conrefResolver(conref),
        resolveConrefRange: (conref: string, conrefend: string) => conrefRangeResolver(conref, conrefend),
        noteLabels,
        indexLabel,
        getImageDimensions: (relPath: string) => {
          try {
            return readImageDimensions(resolve(docRootDir, decodeHrefPart(relPath)));
          } catch {
            return undefined;
          }
        },
      });

      return { html: content };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: message };
    }
  }

  private generateHtml(
    document: vscode.TextDocument,
    webview: vscode.Webview,
    initialScrollLine?: number,
  ): string {
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.file(join(this.context.extensionPath, 'media', 'styles.css')),
    );

    const result = this.renderTopicContent(document, webview);
    if (result.error !== undefined) {
      const message = result.error;
      return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Error</title></head>
<body>
<div style="padding:2rem;color:#c0392b;">
<h2>Render Error</h2>
<pre>${escapeHtml(message)}</pre>
</div>
</body>
</html>`;
    }
    const content = result.html;

    try {
      const { files, defaultName: discoveredDefaultName } = discoverCssFiles(document.uri);
      // A previously-selected CSS file (persisted per-document, see
      // CSS_SELECTION_KEY above) takes priority over discoverCssFiles()'s
      // own always-recomputed default, but only if that file still exists
      // in this document's discovered set -- it may not (e.g. the file
      // was deleted, or this is actually a different document that
      // happens to reuse a stale uri-keyed entry).
      const persistedCssSelection = this.context.globalState.get<Record<string, string>>(CSS_SELECTION_KEY, {})[document.uri.toString()];
      const defaultName = persistedCssSelection && files[persistedCssSelection] ? persistedCssSelection : discoveredDefaultName;
      const defaultContent = files[defaultName] || '';
      const widthSelection = this.context.globalState.get<Record<string, string>>(WIDTH_SELECTION_KEY, {})[document.uri.toString()] || '';

      const theme = vscode.window.activeColorTheme;
      const isDark = theme.kind === vscode.ColorThemeKind.Dark || theme.kind === vscode.ColorThemeKind.HighContrast;

      const script = getWebviewScript();
      const cssFilesJson = escapeJson(JSON.stringify(files));
      const defaultNameJson = escapeJson(JSON.stringify(defaultName));
      const widthSelectionJson = escapeJson(JSON.stringify(widthSelection));
      const fontPrefs = this.context.globalState.get(FONT_PREFS_KEY, DEFAULT_FONT_PREFS);
      const fontPrefsJson = escapeJson(JSON.stringify(fontPrefs));
      const initialScrollLineJs = typeof initialScrollLine === 'number' && Number.isFinite(initialScrollLine)
        ? String(Math.max(0, Math.floor(initialScrollLine)))
        : 'null';

      // CSP nonce for defense-in-depth against XSS
      const nonce = randomBytes(16).toString('base64');

      return `<!DOCTYPE html>
<html lang="en"${isDark ? ' class="vscode-dark"' : ''}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none';">
<link rel="stylesheet" href="${stylesUri}">
${defaultContent ? `<style>\n${defaultContent}\n</style>` : ''}
<title>${escapeHtml(document.fileName)}</title>
<script nonce="${nonce}">window.__cssFiles=${cssFilesJson};window.__defaultCss=${defaultNameJson};window.__widthSelection=${widthSelectionJson};window.__fontPrefs=${fontPrefsJson};window.__initialScrollLine=${initialScrollLineJs};</script>
</head>
<body>
<div id="dita-content-root">${content}</div>
<script nonce="${nonce}">${script}</script>
</body>
</html>`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Error</title></head>
<body>
<div style="padding:2rem;color:#c0392b;">
<h2>Render Error</h2>
<pre>${escapeHtml(message)}</pre>
</div>
</body>
</html>`;
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeJson(text: string): string {
  return text.replace(/<\/script>/gi, '<\\/script>');
}

// ── Keyref: parse DITAMAP for key→value mappings ──

export function findDitamapFiles(docUri: vscode.Uri, stopAtFirstMatch = true): string[] {
  const results: string[] = [];
  const docDir = dirname(docUri.fsPath);
  const root = parseDocRoot(docDir);
  let dir = docDir;
  while (dir.length >= root.length) {
    try {
      for (const entry of readdirSync(dir)) {
        if (entry.toLowerCase().endsWith('.ditamap')) results.push(join(dir, entry));
      }
    } catch (e) {
      console.warn(`Failed to read directory ${dir}:`, e instanceof Error ? e.message : e);
    }
    if (stopAtFirstMatch && results.length > 0) return results;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return results;
}

function extractTextFromNode(node: DitaNode): string {
  if (node.type === 'text') return node.text || '';
  return (node.children || []).map(extractTextFromNode).join('');
}

function getNodeValue(node: DitaNode, childBaseTypes: string[]): string | undefined {
  for (const bt of childBaseTypes) {
    const child = (node.children || []).find(
      (c) => c.type === 'element' && c.baseType === bt,
    );
    if (child) {
      const text = extractTextFromNode(child).trim();
      if (text) return text;
    }
    // DITA wraps <keyword> inside <keywords>; also search inside known wrappers
    const wrapper = (node.children || []).find(
      (c) => c.type === 'element' && (c.baseType === 'map/keywords'),
    );
    if (wrapper) {
      const inner = (wrapper.children || []).find(
        (c) => c.type === 'element' && c.baseType === bt,
      );
      if (inner) {
        const text = extractTextFromNode(inner).trim();
        if (text) return text;
      }
    }
  }
  return undefined;
}

function getKeyValueFromRef(node: DitaNode): string | undefined {
  // Priority: keyword > linktext > navtitle > shortdesc > indexterm
  const topicmeta = (node.children || []).find(
    (c) => c.type === 'element' && (c.baseType === 'map/topicmeta'),
  );
  if (!topicmeta) return undefined; // No topicmeta, no value
  return getNodeValue(topicmeta, [
    'map/keyword',
    'map/linktext',
    'map/navtitle',
    'map/shortdesc',
  ]);
}

// buildKeyMap sits on hot paths (preview re-render, completion, diagnostics,
// map tree) and used to re-read and re-parse every ancestor ditamap each
// call. Cache per document directory; invalidated when the set of ancestor
// maps changes or any involved file's mtime changes (including maps pulled
// in via expandDitamapRefs, tracked through the recording reader).
interface KeyMapCacheEntry {
  mapFilesKey: string;
  stamps: string;
  files: string[];
  map: Map<string, string>;
}
const keyMapCache = new Map<string, KeyMapCacheEntry>();
// One entry per document directory; bound it so long sessions touching many
// folders cannot grow the cache without limit (evicts oldest-inserted first).
const KEY_MAP_CACHE_MAX = 50;

function stampFiles(files: string[]): string {
  return files
    .map((f) => {
      try {
        return String(statSync(f).mtimeMs);
      } catch {
        return '?';
      }
    })
    .join('|');
}

export function buildKeyMap(docUri: vscode.Uri): Map<string, string> {
  const docDir = dirname(docUri.fsPath);
  // Scan all ancestor folders (not just the nearest one with a map) so keydef
  // maps living in outer folders are still picked up; maps referenced from any
  // scanned map are followed via expandDitamapRefs regardless of location.
  const mapFiles = findDitamapFiles(docUri, false);
  const mapFilesKey = mapFiles.join('|');

  const cached = keyMapCache.get(docDir);
  if (cached && cached.mapFilesKey === mapFilesKey && stampFiles(cached.files) === cached.stamps) {
    return cached.map;
  }

  const map = new Map<string, string>();
  const involvedFiles = [...mapFiles];
  const recordingRead: FileReader = (path, encoding) => {
    involvedFiles.push(path);
    return readFileSync(path, encoding);
  };
  for (const mf of mapFiles) {
    try {
      const content = readFileSync(mf, 'utf-8');
      const doc = parseDitamap(preprocessEntities(content));
      const mapRoot = doc.root;
      // Expand referenced ditamaps so keydefs from included maps are visible
      expandDitamapRefs(mapRoot, dirname(mf), recordingRead);
      function walk(node: DitaNode) {
        if (node.type !== 'element') return;
        const baseType = node.baseType;
        if ((baseType === 'map/topicref' || baseType === 'map/keydef') && node.attributes?.keys) {
          const keys = node.attributes.keys;
          const value = getKeyValueFromRef(node);
          // First definition wins (DITA precedence; nearest map scanned first)
          if (!map.has(keys)) map.set(keys, value || keys);
        }
        for (const child of node.children || []) walk(child);
      }
      for (const child of mapRoot.children || []) walk(child);
    } catch (e) {
      console.warn(`Failed to parse keymap from ${mf}:`, e instanceof Error ? e.message : e);
    }
  }

  if (keyMapCache.size >= KEY_MAP_CACHE_MAX && !keyMapCache.has(docDir)) {
    const oldest = keyMapCache.keys().next().value;
    if (oldest !== undefined) keyMapCache.delete(oldest);
  }
  keyMapCache.set(docDir, {
    mapFilesKey,
    stamps: stampFiles(involvedFiles),
    files: involvedFiles,
    map,
  });
  return map;
}

// (cross-file helpers now in ditaRenderUtils.ts)

// ── CSS file discovery ──

function discoverCssFiles(docUri: vscode.Uri): { files: Record<string, string>; defaultName: string } {
  const files: Record<string, string> = {};
  const loadedNames = new Set<string>();

  const addFile = (filePath: string) => {
    const name = basename(filePath);
    if (!loadedNames.has(name) && existsSync(filePath)) {
      try {
        files[name] = readFileSync(filePath, 'utf-8');
        loadedNames.add(name);
      } catch (e) {
        console.warn(`Failed to load file ${filePath}:`, e instanceof Error ? e.message : e);
      }
    }
  };

  const docDir = dirname(docUri.fsPath);
  const root = parseDocRoot(docDir);
  const cssDir = findCustomCssDir(docDir);

  // Scan directories for .css files
  const scanDirs = new Set<string>();
  scanDirs.add(cssDir);
  if (root !== cssDir) scanDirs.add(root);
  // Add configured CSS directories
  try {
    const config = vscode.workspace.getConfiguration('dita-viewer');
    const cssDirConfigs: string[] | undefined = config.get('cssDirectory');
    if (cssDirConfigs) {
      for (const dir of cssDirConfigs) {
        const resolvedDir = resolveDirectoryPath(dir, docDir);
        if (resolvedDir && existsSync(resolvedDir) && !scanDirs.has(resolvedDir)) {
          scanDirs.add(resolvedDir);
        }
      }
    }
  } catch (e) {
    console.warn('Failed to read CSS directory configuration:', e instanceof Error ? e.message : e);
  }

  for (const sd of scanDirs) {
    try {
      for (const entry of readdirSync(sd)) {
        if (entry.toLowerCase().endsWith('.css')) addFile(join(sd, entry));
      }
    } catch (e) {
      console.warn(`Failed to read CSS directory ${sd}:`, e instanceof Error ? e.message : e);
    }
  }

  // Add explicitly configured CSS files
  try {
    const config = vscode.workspace.getConfiguration('dita-viewer');
    const paths: string[] | undefined = config.get('customCss');
    if (paths) {
      for (const p of paths) {
        const resolvedPath = resolveCssFilePath(p, docDir);
        if (resolvedPath) addFile(resolvedPath);
      }
    }
  } catch (e) {
    console.warn('Failed to read custom CSS configuration:', e instanceof Error ? e.message : e);
  }

  const defaultName = files['custom.css'] ? 'custom.css' : (Object.keys(files)[0] || '');
  return { files, defaultName };
}

function findCustomCssDir(docDir: string): string {
  const root = parseDocRoot(docDir);
  let dir = docDir;
  while (dir.length >= root.length) {
    if (existsSync(join(dir, 'custom.css'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return docDir;
}

function parseDocRoot(dir: string): string {
  // Multi-root workspaces: bound upward walks by the folder that actually
  // contains the document, not always the first folder.
  const owner = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(dir));
  if (owner) return owner.uri.fsPath;
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) return folders[0].uri.fsPath;
  const sep = dir.includes('/') ? '/' : '\\';
  const parts = dir.split(/[\\/]/);
  // POSIX: root is "/", Windows: root is "C:\"
  if (sep === '/') return '/' + parts.slice(1, 2).join('/');
  return parts.length > 2 ? parts.slice(0, 2).join('\\') : dir;
}

function resolveCssFilePath(cssPath: string, docDir: string): string | undefined {
  if (isAbsolute(cssPath) && existsSync(cssPath)) {
    return cssPath;
  }
  const resolved = resolve(docDir, cssPath);
  if (existsSync(resolved)) return resolved;
  const folders = vscode.workspace.workspaceFolders;
  if (folders) {
    for (const f of folders) {
      const wsPath = resolve(f.uri.fsPath, cssPath);
      if (existsSync(wsPath)) return wsPath;
    }
  }
  return undefined;
}

function resolveDirectoryPath(dirPath: string, docDir: string): string | undefined {
  // Absolute path
  if (isAbsolute(dirPath)) {
    return existsSync(dirPath) ? dirPath : undefined;
  }
  // Relative to doc directory
  const fromDoc = resolve(docDir, dirPath);
  if (existsSync(fromDoc)) return fromDoc;
  // Relative to workspace root
  const folders = vscode.workspace.workspaceFolders;
  if (folders) {
    for (const f of folders) {
      const wsPath = resolve(f.uri.fsPath, dirPath);
      if (existsSync(wsPath)) return wsPath;
    }
  }
  return undefined;
}