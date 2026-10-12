(function() {
  const vscode = acquireVsCodeApi();
  const body = document.body;
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  const btnSwap = document.getElementById('btn-swap');
  const btnInline = document.getElementById('btn-inline');
  const btnSource = document.getElementById('btn-source');
  const counter = document.getElementById('nav-counter');
  const gutter = document.getElementById('diff-gutter');
  const svg = document.getElementById('align-svg');
  const columns = document.querySelector('.diff-columns');
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // The two columns are independent flows, no longer row-for-row aligned, so
  // navigation keys off a change index rather than a paired row: both sides of
  // one change carry the same data-diff-idx, and jumping to a change
  // highlights every block with that index (so old + new light up together).
  function getChangeIdxs() {
    const set = new Set();
    document.querySelectorAll('[data-diff-idx]').forEach(function (el) {
      set.add(parseInt(el.getAttribute('data-diff-idx'), 10));
    });
    return Array.from(set).sort(function (a, b) { return a - b; });
  }

  let currentIdx = -1;

  function updateCounter() {
    const idxs = getChangeIdxs();
    if (idxs.length === 0) {
      counter.value = '0 / 0';
      return;
    }
    counter.value = (currentIdx + 1) + ' / ' + idxs.length;
  }

  function navigateTo(idx) {
    const idxs = getChangeIdxs();
    if (idxs.length === 0) return;
    document.querySelectorAll('.__diff_current').forEach(function (r) { r.classList.remove('__diff_current'); });
    currentIdx = ((idx % idxs.length) + idxs.length) % idxs.length;
    const els = document.querySelectorAll('[data-diff-idx="' + idxs[currentIdx] + '"]');
    els.forEach(function (el) { el.classList.add('__diff_current'); });
    if (els.length > 0) els[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
    updateCounter();
  }

  btnPrev.addEventListener('click', function() { navigateTo(currentIdx - 1); });
  btnNext.addEventListener('click', function() { navigateTo(currentIdx === -1 ? 0 : currentIdx + 1); });

  // The counter doubles as a jump box: type the number of the change you want
  // and press Enter to go straight there, instead of hammering next/prev past
  // every intermediate one. Enter reads the first integer in the field -- so a
  // bare "3" and the "3 / 12" the navigation writes back both parse -- clamps
  // it into range, and jumps. Escape abandons the edit and restores the
  // current / total readout.
  counter.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const idxs = getChangeIdxs();
      if (idxs.length === 0) return;
      const m = counter.value.match(/\d+/);
      if (!m) { updateCounter(); return; }
      const target = Math.min(Math.max(parseInt(m[0], 10), 1), idxs.length);
      navigateTo(target - 1);
      counter.select();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      updateCounter();
      counter.blur();
    }
  });

  btnSwap.addEventListener('click', function() {
    vscode.postMessage({ type: 'swapSides' });
  });

  btnInline.addEventListener('click', function() {
    body.classList.toggle('show-inline');
    btnInline.setAttribute('aria-pressed', body.classList.contains('show-inline'));
    scheduleDraw();
  });

  // Hand the exact two versions this panel is showing to the extension, which
  // publishes them as in-memory documents and opens VS Code's own diff editor
  // over the raw source. The reverse jump (source -> this rendered view) lives
  // on the editor/title bar of the native diff, not here.
  btnSource.addEventListener('click', function() {
    vscode.postMessage({ type: 'openSourceDiff' });
  });

  document.addEventListener('keydown', function(e) {
    if (e.target === counter) return;
    if (e.key === 'F7' && !e.shiftKey) {
      e.preventDefault();
      navigateTo(currentIdx === -1 ? 0 : currentIdx + 1);
    } else if (e.key === 'F7' && e.shiftKey) {
      e.preventDefault();
      navigateTo(currentIdx - 1);
    }
  });

  // ── Alignment connectors (Trados-style) ──
  //
  // The two columns are independent flows, so a change's two sides can drift
  // apart vertically. A thin line drawn across the center gutter re-joins them:
  // one connector per change. Only changed blocks carry a data-diff-idx, so
  // unchanged content stays connector-free rather than turning the gutter into
  // a fan of lines. A modified pair gets a curve joining left to right; an
  // added / removed block has no counterpart, so it gets a short stub with a
  // dot -- which is also what visually explains the drift below it.
  //
  // The SVG lives inside the scroll content, so it scrolls for free; we only
  // recompute when the layout width changes or the page finishes loading.
  function pickSide(els, colClass) {
    for (let i = 0; i < els.length; i++) {
      if (els[i].closest('.' + colClass)) return els[i];
    }
    return null;
  }

  function midY(el, rect) {
    const r = el.getBoundingClientRect();
    return r.top + r.height / 2 - rect.top;
  }

  // Where a connector should land on one side of a change. A modified block
  // carries word-level marks; pointing at the first mark (the wording that
  // actually changed) rather than the block's geometric center keeps the line
  // anchored to "this bit" instead of "somewhere in this tall paragraph". Added
  // / removed blocks have no marks, so this falls back to the block midpoint.
  function anchorY(el, rect) {
    const mark = el.querySelector('.diff-inline-del, .diff-inline-add');
    return midY(mark || el, rect);
  }

  function makeCurve(x1, y1, x2, y2, key) {
    const p = document.createElementNS(SVG_NS, 'path');
    const mx = (x1 + x2) / 2;
    const d = 'M ' + x1 + ' ' + y1 + ' C ' + mx + ' ' + y1 + ', ' + mx + ' ' + y2 + ', ' + x2 + ' ' + y2;
    p.setAttribute('d', d);
    p.setAttribute('class', 'align-line align-line--modified');
    p.setAttribute('data-align-idx', key);
    return p;
  }

  function makeStub(x1, y1, x2, kind, key) {
    const g = document.createElementNS(SVG_NS, 'g');
    const line = document.createElementNS(SVG_NS, 'path');
    line.setAttribute('d', 'M ' + x1 + ' ' + y1 + ' L ' + x2 + ' ' + y1);
    line.setAttribute('class', 'align-line align-line--stub align-line--' + kind);
    line.setAttribute('data-align-idx', key);
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', String(x2));
    dot.setAttribute('cy', String(y1));
    dot.setAttribute('r', '4');
    dot.setAttribute('class', 'align-dot align-dot--' + kind);
    g.appendChild(line);
    g.appendChild(dot);
    return g;
  }

  // A modified pair whose two sides have drifted more than half a screen apart
  // would need a curve that visually crosses the whole viewport -- that reads
  // as noise, not as an alignment cue. Instead of the full-span curve, draw a
  // short faded dashed stub with a dot on each side, pointing into the gutter:
  // it still says "these two go together" and lights up on hover, without the
  // eye-straining diagonal.
  function makeFadedPair(gw, y1, y2, key) {
    const g = document.createElementNS(SVG_NS, 'g');
    const mk = (x, y, dir) => {
      const line = document.createElementNS(SVG_NS, 'path');
      line.setAttribute('d', 'M ' + x + ' ' + y + ' L ' + (x + dir) + ' ' + y);
      line.setAttribute('class', 'align-line align-line--stub align-line--modified align-line--faded');
      line.setAttribute('data-align-idx', key);
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', String(x + dir));
      dot.setAttribute('cy', String(y));
      dot.setAttribute('r', '3');
      dot.setAttribute('class', 'align-dot align-dot--modified align-dot--faded');
      dot.setAttribute('data-align-idx', key);
      g.appendChild(line);
      g.appendChild(dot);
    };
    mk(0, y1, gw * 0.4);
    mk(gw, y2, -gw * 0.4);
    return g;
  }

  function drawConnectors() {
    if (!svg || !gutter) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    // Hidden in the stacked narrow layout: there is no side-by-side to join.
    if (gutter.offsetParent === null) return;
    const rect = gutter.getBoundingClientRect();
    const gw = rect.width;
    if (gw === 0) return;
    const groups = new Map();
    document.querySelectorAll('[data-diff-idx]').forEach(function (el) {
      const key = el.getAttribute('data-diff-idx');
      let arr = groups.get(key);
      if (!arr) { arr = []; groups.set(key, arr); }
      arr.push(el);
    });
    groups.forEach(function (els, key) {
      const left = pickSide(els, 'diff-col--left');
      const right = pickSide(els, 'diff-col--right');
      if (left && right) {
        const y1 = anchorY(left, rect);
        const y2 = anchorY(right, rect);
        if (Math.abs(y1 - y2) > window.innerHeight * 0.5) {
          svg.appendChild(makeFadedPair(gw, y1, y2, key));
        } else {
          svg.appendChild(makeCurve(0, y1, gw, y2, key));
        }
      } else if (left) {
        svg.appendChild(makeStub(0, anchorY(left, rect), gw * 0.5, 'removed', key));
      } else if (right) {
        svg.appendChild(makeStub(gw, anchorY(right, rect), gw * 0.5, 'added', key));
      }
    });
  }

  // Coalesced: a burst of resize notifications (or a toggle landing in the same
  // frame as one) redraws once, not once per notification.
  let drawPending = false;
  function scheduleDraw() {
    if (drawPending) return;
    drawPending = true;
    requestAnimationFrame(function () {
      drawPending = false;
      drawConnectors();
    });
  }

  // Hovering either side of a change lights up its connector and both blocks,
  // so the reader can confirm what maps to what. Deliberately no click-to-scroll
  // the other column: that would yank the far side around mid-read and fight
  // text selection.
  let hoverIdx = null;

  function setLinked(idx, on) {
    document.querySelectorAll('[data-align-idx="' + idx + '"]').forEach(function (n) {
      n.classList.toggle('__align_active', on);
    });
    document.querySelectorAll('[data-diff-idx="' + idx + '"]').forEach(function (b) {
      b.classList.toggle('dv-block--linked', on);
    });
  }

  if (columns) {
    columns.addEventListener('mouseover', function (e) {
      const block = e.target && e.target.closest ? e.target.closest('[data-diff-idx]') : null;
      const idx = block ? block.getAttribute('data-diff-idx') : null;
      if (idx === hoverIdx) return;
      if (hoverIdx !== null) setLinked(hoverIdx, false);
      hoverIdx = idx;
      if (idx !== null) setLinked(idx, true);
    });
    columns.addEventListener('mouseleave', function () {
      if (hoverIdx !== null) { setLinked(hoverIdx, false); hoverIdx = null; }
    });
  }

  scheduleDraw();
  window.addEventListener('load', drawConnectors);
  window.addEventListener('resize', drawConnectors);
  // Connector endpoints are measured block midpoints, so anything that changes
  // either column's height after first paint (an image finishing its load, a
  // web font swapping in, content that grows later) leaves them stale. Watching
  // the columns container catches all of those; drawing only edits the SVG, so
  // it cannot feed back into this observer.
  if (columns && typeof ResizeObserver === 'function') {
    new ResizeObserver(scheduleDraw).observe(columns);
  }

  updateCounter();
})();
