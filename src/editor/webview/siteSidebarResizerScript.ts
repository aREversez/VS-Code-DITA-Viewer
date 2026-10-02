// Webview script: the docsite sidebar resize handle, plus the pure width
// clamp it injects via clampSidebarWidth.toString(). Moved verbatim from
// ditaRenderUtils.ts (P5 pure refactor). clampSidebarWidth has no host-side
// consumers -- this script is its only one -- so the two travel together as a
// dependency-free leaf (no imports); clampSidebarWidth stays exported so the
// barrel can re-export it for the byte-check harness and any future use.

/**
 * Clamps a docsite-mode sidebar width (px) a drag gesture produced to a
 * sane range. Pure and exported so the clamping math itself is unit
 * tested; the drag wiring around it (getSiteSidebarResizerScript below)
 * has no DOM in this test suite to actually drag through, same situation
 * as findTextMatches above -- this is the
 * piece of that feature that can be tested directly, so it is.
 */
export function clampSidebarWidth(width: number, min = 160, max = 560): number {
  if (width < min) return min;
  if (width > max) return max;
  return width;
}

/**
 * Docsite mode's sidebar resize handle -- lets a reader drag the sidebar
 * wider or narrower than its 240px default. A self-contained IIFE rather
 * than something that needs appending to a toolbar: #__site-nav-resizer is
 * already sitting in the page markup as a sibling of .site-nav (see
 * MapViewerProvider.ts's body markup), one per docsite-mode page, so this
 * only needs to find it and wire it up -- same "no-op if the element isn't
 * there" safety the other docsite scripts get from their own id lookups,
 * which is what makes it safe to always emit this call regardless of mode
 * (tree/book pages never have #__site-nav-resizer in the DOM at all).
 * Widens via el.style.flexBasis rather than a fixed width: .site-nav's own
 * `flex: 0 0 240px` rule already fixes flex-grow/flex-shrink at 0, so only
 * the flex-basis longhand needs an inline override to resize without also
 * fighting the flex layout on every other axis.
 * Keyboard support (ArrowLeft/ArrowRight nudge by 20px) comes from the
 * element's own role="separator" tabindex="0" in the markup -- a
 * mouse-only drag target with that role and no keyboard handler would be
 * reachable by keyboard but do nothing once focused, which is worse than
 * not being focusable at all.
 */
export function getSiteSidebarResizerScript(): string {
  return `
  // Bound as a named function rather than a one-shot IIFE so it can be re-run
  // after an in-place mode switch rebuilds the shell (MapViewerProvider.ts's
  // applyModeStage): the handle and the sidebar are fresh nodes then, so the
  // mousedown/keydown wiring has to be re-attached. Re-running is safe because
  // the old handle is gone with the old shell -- no duplicate listeners on a
  // live element. The re-listen is window-guarded so the isolated unit tests,
  // which pass only a fake document, keep exercising the immediate bind alone.
  function bindSiteSidebarResizer() {
    var resizer = document.getElementById('__site-nav-resizer');
    var nav = document.querySelector('.site-nav');
    if (!resizer || !nav) return;
    var clampSidebarWidth = ${clampSidebarWidth.toString()};
    var startX = 0;
    var startWidth = 0;
    function onMouseMove(e) {
      nav.style.flexBasis = clampSidebarWidth(startWidth + (e.clientX - startX)) + 'px';
    }
    function onMouseUp() {
      resizer.classList.remove('resizing');
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }
    resizer.addEventListener('mousedown', function(e) {
      startX = e.clientX;
      startWidth = nav.getBoundingClientRect().width;
      resizer.classList.add('resizing');
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
    });
    resizer.addEventListener('keydown', function(e) {
      var current = nav.getBoundingClientRect().width;
      if (e.key === 'ArrowLeft') {
        nav.style.flexBasis = clampSidebarWidth(current - 20) + 'px';
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        nav.style.flexBasis = clampSidebarWidth(current + 20) + 'px';
        e.preventDefault();
      }
    });
  }
  bindSiteSidebarResizer();
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('ditamap:stage', bindSiteSidebarResizer);
  }
`;
}
