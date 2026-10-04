// Webview script of the single-topic preview (DitaViewerProvider): scroll sync,
// highlight, the per-image zoom toolbar and the toolbar assembly. Moved verbatim
// out of DitaViewerProvider.ts so the provider holds host logic only; the output
// is byte-identical (checked against the pre-move generated script).
//
// The map preview's counterpart is mapScript.ts. What the two share lives in
// the other files in this folder and in sharedWebviewStrings().

import * as vscode from 'vscode';
import { getProfilingToggleScript } from './profilingToggleScript';
import { getSearchOverlayScript, getProfilingFilterScript, getImageLightboxScript, getImageMapSupportScript, getToolbarScaffoldScript, getFontPrefsScript, getToolbarFontWidthTagTooltipsButtonsScript, getRefreshButtonScript } from '../ditaRenderUtils';
import { sharedWebviewStrings } from '../webviewL10n';

export function getWebviewScript(): string {
  const L = {
    // Everything the map preview's toolbar says too: the toolbar label, the
    // font and page-width controls, the Flags toggle, and the option sets for
    // both overlays. Kept in one table so the two previews cannot drift apart
    // on a control they share -- see webviewL10n.ts. What follows is wording
    // that exists only here.
    ...sharedWebviewStrings(),
    selectThemeCss: JSON.stringify(vscode.l10n.t('Select theme CSS')),
    resetFont: vscode.l10n.t('Reset font size and family to default'),
    // Only the per-image zoom toolbar's own tooltips stay local now: the map
    // preview deliberately has no −/+/maximize controls (its images stay at
    // natural rendered size), so there is nothing there to label. The
    // lightbox and copy strings this table used to carry moved into
    // sharedWebviewStrings() -- both previews show the same lightbox now
    // (see getImageLightboxScript), and one table for both is the whole
    // point of webviewL10n.ts.
    imgZoomOutTitle: JSON.stringify(vscode.l10n.t('Zoom out this image (preview only)')),
    imgZoomInTitle: JSON.stringify(vscode.l10n.t('Zoom in this image (preview only)')),
    imgMaximizeTitle: JSON.stringify(vscode.l10n.t('View full-screen (use ←/→ to switch images)')),
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

  ${getFontPrefsScript({ setFontPrefsMsgType: 'setFontPrefs' })}

  // Highlight box, with a fade-out transition -- highlightElement() above
  // adds '__hl-fade' shortly before removing '__hl' entirely, so the box
  // eases out instead of just vanishing or (the actual bug) never going
  // away at all.
  var hlStyle = document.createElement('style');
  hlStyle.textContent = '.__hl{outline:2px solid var(--vscode-textLink-foreground,#4a90d9);outline-offset:2px;border-radius:3px;background:color-mix(in srgb,var(--vscode-textLink-foreground,#4a90d9) 12%,transparent);transition:outline-color 0.6s ease,background-color 0.6s ease;}.__hl.__hl-fade{outline-color:transparent;background-color:transparent;}';
  document.head.appendChild(hlStyle);

  // Image error handling, click-to-enlarge lightbox, clipboard copy and the
  // right-click "Copy Image" menu: shared verbatim with the map preview --
  // both webviews render <img data-dita-src> and both keep styles.css's
  // cursor:zoom-in promise on them, so neither may show the magnifying-glass
  // cursor without the behavior behind it. Document-level delegation
  // throughout, so content-only updates never orphan the listeners, and
  // openLightbox() below stays callable from the maximize button via normal
  // function-declaration hoisting. See getImageLightboxScript in
  // ditaRenderUtils.ts.
  ${getImageLightboxScript({
    copyMenuItem: L.imgCopyMenuItem,
    copyDoneLabel: L.imgCopyDoneLabel,
    copyFailedLabel: L.imgCopyFailedLabel,
    copyUnsupportedLabel: L.imgCopyUnsupportedLabel,
    copyToastDone: L.imgCopyToastDone,
    copyToastFailed: L.imgCopyToastFailed,
  })}

  // Image-map hotspots: keeps <area> hit regions aligned with the rendered
  // image size (Chromium hit-tests coords against the natural pixel space,
  // so any max-width clamping or zoom-toolbar resize would otherwise point
  // every hotspot at the wrong region) and routes non-fragment hotspot
  // clicks to the extension host instead of letting the webview navigate
  // itself to a vscode-webview:// 404 (the white page). Shared with the
  // map viewer; see getImageMapSupportScript in ditaRenderUtils.ts.
  ${getImageMapSupportScript({ openMsgType: 'openImagemapLink' })}

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

  // Applies the default preview-size reduction (marked server-side via
  // data-dita-default-scale, see topic/image in baseTypeMap.ts) once the
  // image's real dimensions are known. This deliberately reuses setImgZoom
  // / imgBaseWidth -- the same rendered, already-max-width-clamped size the
  // toolbar's own "100%" means -- rather than a CSS 'zoom' relative to the
  // image's own natural pixel size. A 'zoom' scales the image relative to
  // ITSELF: a large image already being clamped down to the container's
  // width by img{max-width:100%} stays clamped to that same width after
  // zoom<1 too (natural-size * zoom can still exceed the container), so it
  // visibly does nothing for exactly the oversized images this is meant to
  // shrink -- only images whose natural size was already small enough to
  // escape the clamp would visibly change. Sizing off imgBaseWidth() (a
  // getBoundingClientRect() measurement taken after the clamp) fixes that:
  // the reduction is always relative to how large the image currently
  // renders on the page, regardless of its file resolution.
  //
  // Skips images that already have an explicit zoom-idx (a real user zoom
  // click landed before this ran) so it never clobbers deliberate input,
  // and is idempotent per image (checks isn't re-run after its own
  // setImgZoom call sets data-dita-zoom-idx).
  function applyDefaultPreviewScale(img) {
    if (img.getAttribute('data-dita-default-scale') !== '1') return;
    if (img.getAttribute('data-dita-zoom-idx') !== null) return;
    if (!(img.naturalWidth > 0)) return;
    var isPortrait = img.naturalHeight > img.naturalWidth;
    var idx = IMG_ZOOM_STEPS.indexOf(isPortrait ? 50 : 75);
    if (idx !== -1) setImgZoom(img, idx);
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
    // size instead of staying at that first, unreliable guess. The default
    // preview scale (see applyDefaultPreviewScale) needs the same real
    // dimensions, so it's applied here too, before that reapply -- it's a
    // no-op once a real zoom-idx exists, from either source.
    img.addEventListener('load', function() {
      applyDefaultPreviewScale(img);
      var idx = currentZoomIdx(img);
      if (idx !== DEFAULT_ZOOM_IDX) setImgZoom(img, idx);
    });
    // Images already decoded by the time this script runs (cached/data-URI
    // images commonly don't fire 'load' again for a freshly created <img>
    // in some engines) still need the same treatment immediately.
    if (img.complete && img.naturalWidth > 0) applyDefaultPreviewScale(img);

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

  // A highlight is meant to be a momentary "here's where the cursor is"
  // cue, not a permanent marker -- previously nothing ever removed the
  // '__hl' class except a *later* highlight replacing it, so if the user
  // stopped moving the source cursor (or switched away from the editor)
  // the box stayed on screen indefinitely. hlClearTimer/hlFadeTimer below
  // give it a lifetime: it sits fully visible briefly, then CSS-fades out
  // over HL_FADE_MS, then the class is removed entirely so a stale
  // reference to el isn't left sitting in a closure.
  var HL_VISIBLE_MS = 1500;
  var HL_FADE_MS = 600;
  var hlFadeTimer = null;
  var hlClearTimer = null;
  function highlightElement(el) {
    if (!el) return;
    if (hlFadeTimer) { clearTimeout(hlFadeTimer); hlFadeTimer = null; }
    if (hlClearTimer) { clearTimeout(hlClearTimer); hlClearTimer = null; }
    var prev = document.querySelector('.__hl');
    if (prev) { prev.classList.remove('__hl'); prev.classList.remove('__hl-fade'); }
    el.classList.remove('__hl-fade');
    el.classList.add('__hl');
    hlFadeTimer = setTimeout(function() {
      el.classList.add('__hl-fade');
      hlClearTimer = setTimeout(function() {
        el.classList.remove('__hl');
        el.classList.remove('__hl-fade');
      }, HL_FADE_MS);
    }, HL_VISIBLE_MS);
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
    // 'area[href]' covers image-map hotspots (topic/imagemap in
    // baseTypeMap.ts): a click on a mapped region targets the <area>
    // element itself, so the same in-page anchor smooth-scroll that
    // a.xref gets applies to clicking a hotspot that points at an
    // element in this same topic (the spec's href="#inline" case).
    // Non-fragment hrefs are left to the browser: book-internal
    // cross-topic areas carry data-dita-book-xref and are handled by
    // the site/book click scripts, external http(s) links go through
    // the webview's own link handling.
    var a = e.target.closest ? e.target.closest('a.xref, area[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) !== '#') return;
    e.preventDefault();
    var id = href.slice(1);
    // href="#" alone (book-xref placeholder) has no id to scroll to;
    // the data-dita-book-xref listener owns that click.
    if (!id) return;
    var el = document.getElementById(id);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });

  window.addEventListener('dblclick', function(e) {
    var el = e.target.closest ? e.target.closest('[data-line]') : null;
    if (!el) return;
    var line = parseInt(el.getAttribute('data-line'), 10);
    if (isNaN(line)) return;
    // el is already the innermost [data-line] element under the cursor
    // (closest() searches from the click target outward), so its own
    // data-start-col is exactly where its content begins on that line --
    // e.g. an inline <uicontrol> nested in a <p> that starts on the same
    // source line. Without this, the source cursor always lands at column
    // 0, which for a same-line inline element falls *before* its column
    // range -- so the highlightLine echo that follows (see
    // onDidChangeTextEditorSelection below) picks the <p> back up instead
    // of the <uicontrol> that was actually double-clicked.
    var col = parseInt(el.getAttribute('data-start-col'), 10);
    if (isNaN(col)) col = 0;
    vscode.postMessage({ type: 'navigateToLine', line: line, col: col });
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
        // Off (the default) needs no walk here: fresh HTML only ever carries
        // data-dita-tagname, never a stray title= from this feature, so
        // there is nothing to remove. On is the one case a walk is needed,
        // to promote the new content's data attributes the same way the
        // old content's already were.
        if (tagTooltipsOn) applyTagTooltips();
        if (typeof pfApplyFilter === 'function') pfApplyFilter(); // re-apply the current filter selection to the new content's [data-profile-keys] elements
        if (typeof pfPanel !== 'undefined' && pfPanel) { // filter panel was open -- refresh its checkbox list against the new content rather than leaving it showing stale attribute/value options
          pfPanel.remove();
          pfPanel = pfBuildPanel();
          document.body.appendChild(pfPanel);
        }
        if (typeof refreshSearchAfterDomChange === 'function') refreshSearchAfterDomChange(); // search was active -- the old ranges pointed into content that was just replaced
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
  ${getToolbarScaffoldScript({ previewToolbar: L.previewToolbar })}

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

  ${getToolbarFontWidthTagTooltipsButtonsScript({
    decreaseFontSize: L.decreaseFontSize,
    increaseFontSize: L.increaseFontSize,
    fontSans: L.fontSans,
    fontSerif: L.fontSerif,
    fontCurrentSans: L.fontCurrentSans,
    fontCurrentSerif: L.fontCurrentSerif,
    fontSizeButtonExtraStyle: '',
    includeFontReset: true,
    resetFont: L.resetFont,
    widthAuto: L.widthAuto,
    widthFull: L.widthFull,
    widthWide: L.widthWide,
    widthDesktop: L.widthDesktop,
    widthNarrow: L.widthNarrow,
    widthTooNarrow: L.widthTooNarrow,
    pageWidth: L.pageWidth,
    setWidthSelectionMsgType: 'setWidthSelection',
    tagTooltipsLabel: L.tagTooltipsLabel,
    tagTooltipsOnTitle: L.tagTooltipsOnTitle,
    tagTooltipsOffTitle: L.tagTooltipsOffTitle,
    setTagTooltipsMsgType: 'setTagTooltips',
  })}
  toolbar.appendChild(fsDown);
  toolbar.appendChild(fsUp);
  toolbar.appendChild(fontBtn);
  toolbar.appendChild(fontResetBtn);

  // Image display zoom is no longer a page-wide toolbar control — see
  // enhanceImages()/setImgZoom() above, which attach a per-image hover
  // toolbar (−/+/maximize) directly to each <img> instead.

  ${getProfilingToggleScript({ label: L.profilingLabel, onTitle: L.profilingOnTitle, offTitle: L.profilingOffTitle })}

  // Tag-name tooltip toggle. injectAttributes() in renderer.ts already puts
  // the tag name on every element without a more specific title of its own
  // as data-dita-tagname -- see the constant's own comment in
  // DitaViewerProvider.ts for why a data attribute and not title= directly.
  // Off by default: useful while learning DITA's vocabulary, otherwise a
  // native browser tooltip firing on every hover, everywhere, is just
  // noise. Persisted like font prefs, since it is the same kind of
  // preference -- how the reader wants to read, not something tied to
  // this one file.
  toolbar.appendChild(tagTooltipsBtn);

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

  toolbar.appendChild(wSel);

  ${getRefreshButtonScript({ title: L.reloadContent })}
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
