// Webview script: the jump button on conref'd content.
//
// The renderer (renderer.ts, markConrefContent) stamps content pulled in by
// conref / conkeyref / conrefend with data-conref="block|inline|cell" plus
// data-conref-file / -line / -col, and styles.css paints the tint and a small
// icon as *background layers* of that element (not as a pseudo-element or a
// child: profiling already owns the pseudos on some of the same elements, and
// a real child under li/tr/table is invalid markup). A background has no
// events of its own, so the click and the hover are hit-tested here against
// the same geometry the stylesheet draws -- keep the two in step.
//
// Clicking posts `${openMsgType}` {file, line, col} to the extension host,
// which opens that file's source beside the preview at the referenced
// element. Delegated from `document`, so it survives the content swaps both
// previews do. Dependency-free: reads only `document`, `getComputedStyle` and
// `vscode`, defines functions and listeners, runs nothing else.
export function getConrefJumpScript(opts: { openMsgType: string; title: string }): string {
  const openMsgType = JSON.stringify(opts.openMsgType);
  // The caller hands over the already-localized string as a value (same
  // convention as getImageMapSupportScript's message type); quote it here.
  const title = JSON.stringify(opts.title);
  return `
  (function() {
    if (typeof vscode === 'undefined' || !vscode) return;
    var openMsgType = ${openMsgType};
    var jumpTitle = ${title};
    var root = document.documentElement;
    var titledEl = null;
    var titledPrev = null;

    function px(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }

    // Is the point inside this element's jump icon? The numbers mirror the
    // background-position/size rules in styles.css, measured from the padding
    // box (background-origin's default), i.e. inside the border.
    function inIconZone(el, x, y) {
      var kind = el.getAttribute('data-conref');
      var rects = el.getClientRects();
      if (!rects.length) return false;
      var cs = getComputedStyle(el);
      var slop = 2;
      if (kind === 'inline') {
        // Icon sits at the right edge of the LAST line box: for text that
        // wraps, that is where the element visually ends.
        var last = rects[rects.length - 1];
        return x >= last.right - 15 - slop && x <= last.right + slop &&
               y >= last.top - slop && y <= last.bottom + slop;
      }
      var r = rects[0];
      var left = r.left + px(cs.borderLeftWidth);
      var top = r.top + px(cs.borderTopWidth);
      var off = kind === 'cell' ? 2 : 3;
      var size = kind === 'cell' ? 14 : 16;
      return x >= left + off - slop && x <= left + off + size + slop &&
             y >= top + off - slop && y <= top + off + size + slop;
    }

    // The conref'd element whose icon is under the point, or null. Walks
    // outward: a nested conref's own icon is tested first, and when the point
    // is not on it the enclosing conref (whose icon may be the thing hit,
    // since the inner content starts below it) gets its turn.
    function findHit(target, x, y) {
      var el = target && target.closest ? target.closest('[data-conref]') : null;
      while (el) {
        if (inIconZone(el, x, y)) return el;
        el = el.parentElement ? el.parentElement.closest('[data-conref]') : null;
      }
      return null;
    }

    function clearTitle() {
      if (!titledEl) return;
      if (titledPrev === null) titledEl.removeAttribute('title');
      else titledEl.setAttribute('title', titledPrev);
      titledEl = null;
      titledPrev = null;
    }

    document.addEventListener('mousemove', function(e) {
      var hit = findHit(e.target, e.clientX, e.clientY);
      root.classList.toggle('dv-conref-hot', !!hit);
      if (hit === titledEl) return;
      clearTitle();
      if (hit) {
        // Borrow the native tooltip, then give back whatever title the
        // element had (the Tags toggle promotes data-dita-tagname to one).
        titledEl = hit;
        titledPrev = hit.getAttribute('title');
        hit.setAttribute('title', jumpTitle);
      }
    });

    document.addEventListener('mouseleave', function() {
      root.classList.remove('dv-conref-hot');
      clearTitle();
    });

    document.addEventListener('click', function(e) {
      if (e.button !== 0) return;
      var hit = findHit(e.target, e.clientX, e.clientY);
      if (!hit) return;
      var file = hit.getAttribute('data-conref-file');
      var line = parseInt(hit.getAttribute('data-conref-line'), 10);
      var col = parseInt(hit.getAttribute('data-conref-col'), 10);
      if (!file || isNaN(line)) return;
      e.preventDefault();
      e.stopPropagation();
      vscode.postMessage({ type: openMsgType, file: file, line: line, col: isNaN(col) ? 0 : col });
    }, true);
  })();
`;
}
