// Webview script: click-to-enlarge lightbox + image copy context menu.
// Moved verbatim from ditaRenderUtils.ts (P5 pure refactor); a dependency-
// free leaf -- every host value it embeds comes from opts (raw strings quoted
// here internally).

// ── Click-to-enlarge lightbox + image copy affordances ──
//
// Both previews render <img data-dita-src> content, and media/styles.css
// gives every such image `cursor: zoom-in` -- a promise that clicking will
// enlarge it. That promise was only kept in the single-topic preview, whose
// inline script carried the lightbox; the map preview (book/site/tree) never
// injected any of this, so its images showed the magnifying-glass cursor but
// clicking did nothing. Extracting the whole image surface here (error
// marking, lightbox, clipboard copy, right-click menu) lets both providers
// embed the identical behavior and keeps them from drifting apart again --
// the same reasoning that moved the search overlay and the profiling filter
// into this file.
//
// Content-swap safe by construction: every listener here is registered on
// `document` (delegation), never on the images themselves, so replacing
// #dita-content-root's HTML -- or book mode's per-entry outerHTML patches --
// never orphans them and nothing needs re-running from afterContentSwap /
// the topic viewer's own updateContent handler. lightboxCandidates()
// re-queries the DOM on every open, so a lightbox always steps through
// whatever content is currently on screen.
//
// Deliberately NOT here: the per-image zoom toolbar (enhanceImages/
// setImgZoom). That stays a single-topic-preview affordance -- the map
// preview's design keeps images at their natural rendered size -- but its
// maximize button calls openLightbox(), which is a hoisted function
// declaration inside each provider's IIFE, so embedding this chunk anywhere
// in the script keeps that call working.
//
// All six strings are raw values, quoted here internally -- same convention
// as getSearchOverlayScript/getProfilingFilterScript: sharedWebviewStrings()
// hands them out for both providers to pass into this call, so they belong
// to the raw-string group, not the pre-JSON.stringify'd group (see the
// comment on sharedWebviewStrings() itself for why the two groups aren't
// interchangeable).
export function getImageLightboxScript(opts: {
  copyMenuItem: string;
  copyDoneLabel: string;
  copyFailedLabel: string;
  copyUnsupportedLabel: string;
  copyToastDone: string;
  copyToastFailed: string;
}): string {
  const copyMenuItem = JSON.stringify(opts.copyMenuItem);
  const copyDone = JSON.stringify(opts.copyDoneLabel);
  const copyFailed = JSON.stringify(opts.copyFailedLabel);
  const copyUnsupported = JSON.stringify(opts.copyUnsupportedLabel);
  const toastDone = JSON.stringify(opts.copyToastDone);
  const toastFailed = JSON.stringify(opts.copyToastFailed);
  return `
  // Image error handling (event delegation, nonce-safe). Marks broken
  // images with data-load-error, which the lightbox and its candidates
  // below exclude -- without this, a broken image would open an empty
  // overlay. Also styles media/styles.css's img[data-load-error] rule
  // (cursor back to default) from the script side.
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

  // Click-to-enlarge lightbox. The whole image is a click target
  // (cursor:zoom-in from styles.css hints this). Broken images are
  // excluded. While the lightbox is open, ←/→ step through every
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
    // Ctrl+C / Cmd+C copies the currently-displayed image, mirroring what a
    // user would expect from any other "enlarged preview" surface — there's
    // no text selection to steal focus from inside the lightbox, so this
    // doesn't collide with a real copy-text intent the way it might
    // elsewhere on the page.
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      if (!lightboxBigImg) return;
      copyImageToClipboard(lightboxBigImg).then(function(ok) {
        showCenteredToast(ok ? ${toastDone} : ${toastFailed});
      });
      return;
    }
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
    big.className = 'dita-lightbox-img';
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

  // Copies the rendered image to the system clipboard. Chromium's Async
  // Clipboard API only reliably accepts image/png for image writes, so
  // anything else (jpg/gif/webp/svg/bmp) is decoded and re-encoded to PNG
  // first. Decoding goes through createImageBitmap() on the bytes fetched
  // directly from img.src -- NOT by drawing the existing <img> element onto
  // a canvas -- because a canvas fed from a cross-origin-flagged <img> (the
  // webview-resource: scheme this project's images load through) can come
  // back "tainted", throwing on toBlob/getImageData; a canvas built from
  // bytes the page fetched itself isn't subject to that. Resolves to
  // true/false rather than throwing, so every caller (right-click menu,
  // lightbox Ctrl+C) can show its own success/failure feedback without its
  // own try/catch.
  function copyImageToClipboard(img) {
    if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) {
      return Promise.resolve(false);
    }
    return fetch(img.currentSrc || img.src)
      .then(function(resp) { return resp.blob(); })
      .then(function(sourceBlob) {
        if (sourceBlob.type === 'image/png') return sourceBlob;
        return createImageBitmap(sourceBlob).then(function(bitmap) {
          var canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          canvas.getContext('2d').drawImage(bitmap, 0, 0);
          return new Promise(function(resolve, reject) {
            canvas.toBlob(function(pngBlob) {
              if (pngBlob) resolve(pngBlob); else reject(new Error('toBlob failed'));
            }, 'image/png');
          });
        });
      })
      .then(function(pngBlob) {
        return navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      })
      .then(function() { return true; })
      .catch(function() { return false; });
  }

  // Small floating pill used for feedback that isn't anchored to a
  // still-open menu item (the lightbox Ctrl+C copy path has no menu to
  // update), fixed at the bottom-center of the viewport so it reads fine
  // whether or not the lightbox overlay is open. Auto-removes itself; never
  // accumulates if fired repeatedly, since each call removes any toast
  // still showing before adding its own.
  function showCenteredToast(text, opts) {
    var existing = document.querySelector('.dita-img-toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.className = 'dita-img-toast' + (opts && opts.top ? ' dita-img-toast--top' : '');
    toast.textContent = text;
    document.body.appendChild(toast);
    setTimeout(function() { toast.remove(); }, (opts && opts.duration) || 1200);
  }

  // Custom right-click "Copy Image" menu for both the inline preview images
  // and the lightbox's enlarged image. A real browser/Electron context menu
  // isn't used here because VS Code webviews don't reliably expose a native
  // "Copy Image" item across every host (desktop Electron vs. vscode.dev's
  // browser-hosted iframe), so this reimplements just the one item needed,
  // reusing the exact same copyImageToClipboard() as the lightbox's Ctrl+C.
  var imgCtxMenu = null;

  function closeImgCtxMenu() {
    if (!imgCtxMenu) return;
    imgCtxMenu.remove();
    imgCtxMenu = null;
  }

  function openImgCtxMenu(img, x, y) {
    closeImgCtxMenu();
    var menu = document.createElement('div');
    menu.className = 'dita-img-ctxmenu';
    var item = document.createElement('button');
    item.type = 'button';
    item.className = 'dita-img-ctxmenu-item';
    item.textContent = ${copyMenuItem};
    item.addEventListener('click', function(e) {
      e.stopPropagation();
      if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) {
        item.textContent = ${copyUnsupported};
        setTimeout(closeImgCtxMenu, 900);
        return;
      }
      item.disabled = true;
      copyImageToClipboard(img).then(function(ok) {
        item.textContent = ok ? ${copyDone} : ${copyFailed};
        setTimeout(closeImgCtxMenu, 700);
      });
    });
    menu.appendChild(item);
    document.body.appendChild(menu);
    // Positioned and clamped after insertion, once its real size is known
    // (offsetWidth/Height are 0 before the element is in the DOM) -- clamped
    // to the viewport so a right-click near the right/bottom edge doesn't
    // open a menu that's partly cut off screen.
    var menuW = menu.offsetWidth, menuH = menu.offsetHeight;
    menu.style.left = Math.min(x, window.innerWidth - menuW - 4) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - menuH - 4) + 'px';
    imgCtxMenu = menu;
  }

  document.addEventListener('contextmenu', function(e) {
    var img = e.target.closest
      ? e.target.closest('img[data-dita-src]:not([data-load-error]), img.dita-lightbox-img')
      : null;
    if (!img) { closeImgCtxMenu(); return; }
    e.preventDefault();
    openImgCtxMenu(img, e.clientX, e.clientY);
  });
  document.addEventListener('click', function(e) {
    if (imgCtxMenu && !imgCtxMenu.contains(e.target)) closeImgCtxMenu();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeImgCtxMenu();
  });
`;
}
