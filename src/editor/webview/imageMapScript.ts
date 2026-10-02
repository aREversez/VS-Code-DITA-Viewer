// Webview script builder for native image maps (<img usemap> + <map>/<area>).
// Moved verbatim from ditaRenderUtils.ts (P5 pure refactor). This module is a
// dependency-free leaf -- the returned webview string's only host input is
// opts.openMsgType -- which is why it is the first thing to move into webview/.

// ── Image-map support: hotspot coordinate rescaling + click routing ──
//
// <imagemap> (topic/imagemap in baseTypeMap.ts) renders a native
// <img usemap> + <map>/<area> pair. Two Chromium realities (the engine
// every VS Code webview runs on, both verified against it) need handling:
//
// 1. Hit-testing keeps <area> coordinates in the image's NATURAL pixel
//    space even when CSS resizes the element -- max-width:100% clamping
//    (styles.css) and the per-image zoom toolbar's style.width both
//    shrink the rendered image while its hotspots keep firing at
//    natural-size positions, so hovering the "Section 1" rectangle
//    reports whatever region happens to sit at that offset in the
//    unscaled coordinate space (the hit regions even extend past the
//    visible image). CSS `zoom` (--dita-scale) is the one scaling
//    mechanism Chromium DOES compensate for by itself, so a zoomed image
//    must be left alone here -- rescaling it as well would apply the
//    factor twice. The rescaler rewrites each area's coords by the ratio
//    of rendered to natural size, caching the author's original coords
//    in data-dita-coords so re-runs and the back-at-100% case restore
//    exactly, with no rounding drift. Every input to that ratio can
//    change independently, so it re-runs on image load (capture-phase
//    load listener also catches images swapped in later), element resize
//    (ResizeObserver -- zoom toolbar steps, width-mode changes, pane
//    resizes), content swaps (MutationObserver -- preview updateContent,
//    site/book page switches) and window resize.
//
// 2. An <area> with a bare relative href navigates the webview itself,
//    which lands on a vscode-webview:// 404 -- the white page. Ordinary
//    xrefs can't hit this because topic/xref renders non-book targets as
//    non-clickable hint spans, but a hotspot can't do that: an <area>
//    without a usable href is a dead region, and the DITA element's
//    whole purpose is a clickable link. So the click guard below
//    preventDefaults those clicks and hands the raw href to the
//    extension host (${openMsgType} -> openHrefTarget), which resolves
//    it like the map tree's openTopic handler does. Book-internal
//    hotspots keep data-dita-book-xref and stay owned by the site/book
//    click handlers (preventDefault doesn't block sibling listeners);
//    same-page fragments keep the browser's anchor jump -- the topic
//    preview additionally smooth-scrolls them through its own
//    a.xref/area[href] handler.
export function getImageMapSupportScript(opts: { openMsgType: string }): string {
  const openMsgType = JSON.stringify(opts.openMsgType);
  return `
  (function() {
    if (typeof vscode === 'undefined' || !vscode) return;
    var openMsgType = ${openMsgType};

    function mapForImg(img) {
      var usemap = img.getAttribute('usemap') || '';
      if (usemap.charAt(0) !== '#' || usemap.length < 2) return null;
      var map = document.getElementById(usemap.slice(1));
      return (map && map.tagName === 'MAP') ? map : null;
    }

    // rect/poly coordinate lists are (x,y) pairs; circle is cx,cy,r --
    // its lone radius scales by the mean of the two axis ratios, exact
    // for uniform scaling and a fair ellipse-fit approximation for the
    // distorted case (which the preview's height:auto CSS avoids).
    function rescaleArea(area, sx, sy) {
      var original = area.getAttribute('data-dita-coords');
      if (original === null) {
        original = area.getAttribute('coords') || '';
        if (original) area.setAttribute('data-dita-coords', original);
      }
      if (!original) return;
      var parts = original.split(/[\\s,]+/);
      var nums = [];
      for (var i = 0; i < parts.length; i++) {
        if (parts[i] !== '') nums.push(parseFloat(parts[i]));
      }
      var valid = nums.length > 0;
      for (var j = 0; j < nums.length; j++) {
        if (isNaN(nums[j])) valid = false;
      }
      if (!valid) {
        area.setAttribute('coords', original);
        return;
      }
      var out = [];
      var p = 0;
      while (p + 1 < nums.length) {
        out.push(Math.round(nums[p] * sx) + ',' + Math.round(nums[p + 1] * sy));
        p += 2;
      }
      if (p < nums.length) out.push(String(Math.round(nums[p] * (sx + sy) / 2)));
      area.setAttribute('coords', out.join(','));
    }

    function rescaleImageMap(img) {
      if (!(img.naturalWidth > 0) || !(img.naturalHeight > 0)) return;
      var map = mapForImg(img);
      if (!map) return;
      var zoom = parseFloat(window.getComputedStyle(img).zoom);
      if (isNaN(zoom)) zoom = 1;
      // zoom normalizes hit-testing by itself -- rescaling on top would
      // apply the factor twice.
      if (zoom !== 1) return;
      var rect = img.getBoundingClientRect();
      if (!(rect.width > 0) || !(rect.height > 0)) return;
      var sx = rect.width / img.naturalWidth;
      var sy = rect.height / img.naturalHeight;
      var atNatural = Math.abs(sx - 1) < 0.005 && Math.abs(sy - 1) < 0.005;
      var areas = map.getElementsByTagName('AREA');
      for (var i = 0; i < areas.length; i++) {
        var area = areas[i];
        if (atNatural) {
          // Back at the image's own size: restore the author's coords
          // verbatim so toggling zoom steps never accumulates drift.
          var original = area.getAttribute('data-dita-coords');
          if (original !== null && area.getAttribute('coords') !== original) {
            area.setAttribute('coords', original);
          }
          continue;
        }
        rescaleArea(area, sx, sy);
      }
    }

    var rescaleTimer = null;
    function scheduleRescale() {
      if (rescaleTimer) return;
      rescaleTimer = setTimeout(function() {
        rescaleTimer = null;
        if (typeof wireObservers === 'function') wireObservers();
        var imgs = document.querySelectorAll('img[usemap]');
        for (var i = 0; i < imgs.length; i++) rescaleImageMap(imgs[i]);
      }, 50);
    }

    // ResizeObserver handles every layout-driven size change (zoom
    // toolbar, width modes, pane resize); imgs added later are wired by
    // the scheduled re-run, not just this initial pass.
    var mapImgObserver = null;
    function wireObservers() {
      if (!mapImgObserver) return;
      var imgs = document.querySelectorAll('img[usemap]:not([data-dita-map-wired])');
      for (var i = 0; i < imgs.length; i++) {
        imgs[i].setAttribute('data-dita-map-wired', '1');
        mapImgObserver.observe(imgs[i]);
      }
    }
    if (typeof ResizeObserver === 'function') {
      mapImgObserver = new ResizeObserver(scheduleRescale);
    }

    document.addEventListener('load', function(e) {
      var t = e.target;
      if (t && t.tagName === 'IMG' && t.hasAttribute('usemap')) scheduleRescale();
    }, true);
    window.addEventListener('resize', scheduleRescale);
    if (typeof MutationObserver === 'function') {
      new MutationObserver(scheduleRescale).observe(document.documentElement, { childList: true, subtree: true });
    }
    scheduleRescale();

    // Click guard: never let a hotspot's non-fragment href navigate this
    // webview (that navigation is the white page). data-dita-book-xref
    // areas belong to the site/book handlers, which observe this same
    // event; fragments keep the browser's own anchor behavior.
    document.addEventListener('click', function(e) {
      var area = e.target.closest ? e.target.closest('area[href]') : null;
      if (!area) return;
      var href = area.getAttribute('href') || '';
      if (!href || href.charAt(0) === '#') return;
      if (area.hasAttribute('data-dita-book-xref')) return;
      e.preventDefault();
      vscode.postMessage({ type: openMsgType, href: href });
    });
  })();
`;
}
