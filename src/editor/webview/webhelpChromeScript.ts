// Webview script for the WebHelp-style page's header menu, breadcrumb and
// prev/next links (route B step 6, webhelp-compat-plan.md).
//
// All three are DERIVED from the sidebar tree, the one place that already
// knows the structure and which page is active, and a click on any of them
// is proxied as a click on the matching sidebar link. So switching a page,
// scrolling to a book section and the history stack keep their single
// implementation (siteNavScripts.ts) and this script adds no navigation
// logic of its own. It is inert on every page whose body lacks
// `wh_topic_page`.
//
// The model and markup are pure functions of plain data (tested without a
// DOM); the DOM glue below them only collects rows, writes innerHTML and
// forwards clicks.

export interface WebhelpChromeScriptOptions {
  /** Accessible name of the breadcrumb. */
  crumbLabel: string;
  /** Markup inside the prev / next links (icons); plain arrows by default. */
  prevLabel?: string;
  nextLabel?: string;
  prevTitle?: string;
  nextTitle?: string;
}

export function getWebhelpChromeScript(opts: WebhelpChromeScriptOptions): string {
  const o = JSON.stringify({
    crumbLabel: opts.crumbLabel,
    prevLabel: opts.prevLabel ?? '\u2039',
    nextLabel: opts.nextLabel ?? '\u203a',
    prevTitle: opts.prevTitle ?? '',
    nextTitle: opts.nextTitle ?? '',
  });
  return `
  // ---- webhelp chrome: pure parts ---------------------------------------
  function webhelpChromeEsc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // rows: every sidebar row in document order, { depth, label, linked, active }.
  function webhelpChromeModel(rows) {
    var activeRow = -1;
    var i, j;
    for (i = 0; i < rows.length; i++) { if (rows[i].active) { activeRow = i; break; } }
    function subtreeEnd(k) {
      var e = k + 1;
      while (e < rows.length && rows[e].depth > rows[k].depth) e++;
      return e;
    }
    var topMenu = [];
    for (i = 0; i < rows.length; i++) {
      if (rows[i].depth !== 0) continue;
      var end = subtreeEnd(i);
      var target = -1;
      for (j = i; j < end; j++) { if (rows[j].linked) { target = j; break; } }
      topMenu.push({ row: i, label: rows[i].label, target: target, active: activeRow >= i && activeRow < end });
    }
    var chain = [];
    if (activeRow >= 0) {
      chain.push(activeRow);
      var d = rows[activeRow].depth;
      for (j = activeRow - 1; j >= 0 && d > 0; j--) {
        if (rows[j].depth < d) { chain.unshift(j); d = rows[j].depth; }
      }
    }
    var crumbs = chain.map(function(r) { return { row: r, label: rows[r].label, linked: rows[r].linked }; });
    return { topMenu: topMenu, crumbs: crumbs, activeRow: activeRow };
  }

  function webhelpChromeHtml(model) {
    var menu = model.topMenu.map(function(m) {
      var cls = m.active ? ' class="active"' : '';
      var inner = m.target >= 0
        ? '<a href="#" data-wh-row="' + m.target + '">' + webhelpChromeEsc(m.label) + '</a>'
        : '<span>' + webhelpChromeEsc(m.label) + '</span>';
      return '<li' + cls + '>' + inner + '</li>';
    }).join('');
    var last = model.crumbs.length - 1;
    var crumb = model.crumbs.map(function(c, idx) {
      var text = webhelpChromeEsc(c.label);
      var item;
      if (idx === last) item = '<span class="wh_breadcrumb_item" aria-current="page">' + text + '</span>';
      else if (c.linked) item = '<a class="wh_breadcrumb_item" href="#" data-wh-row="' + c.row + '">' + text + '</a>';
      else item = '<span class="wh_breadcrumb_item">' + text + '</span>';
      return (idx > 0 ? '<span class="wh_breadcrumb_sep" aria-hidden="true">\\u203a</span>' : '') + item;
    }).join('');
    return { menuHtml: menu, crumbHtml: crumb };
  }

  // The row index a data-wh-row attribute names, or -1 for anything that is
  // not a plain non-negative integer below the row count.
  function webhelpChromeClickRow(attr, nLinks) {
    if (typeof attr !== 'string' || !/^[0-9]+$/.test(attr)) return -1;
    var n = parseInt(attr, 10);
    return n < nLinks ? n : -1;
  }

  // ---- webhelp chrome: DOM glue -----------------------------------------
  (function() {
    var opts = ${o};
    if (!document.body || !document.body.classList || !document.body.classList.contains('wh_topic_page')) return;

    var links = [];
    var tocObserver = null;
    var pending = false;

    function ownLink(item) {
      for (var i = 0; i < item.children.length; i++) {
        var c = item.children[i];
        if (c.classList && (c.classList.contains('site-nav-link') || c.classList.contains('site-nav-group-label'))) return c;
      }
      return null;
    }

    function collectRows() {
      var items = document.querySelectorAll('#wh_publication_toc .site-nav-item');
      var rows = [];
      links = [];
      for (var i = 0; i < items.length; i++) {
        var depth = 0;
        var p = items[i].parentElement;
        while (p) {
          if (p.classList && p.classList.contains('site-nav-item')) depth++;
          p = p.parentElement;
        }
        var own = ownLink(items[i]);
        var isLink = !!own && own.classList.contains('site-nav-link');
        var textEl = own && own.querySelector ? own.querySelector('.site-nav-link-text') : null;
        rows.push({
          depth: depth,
          label: textEl ? textEl.textContent : '',
          linked: isLink,
          active: isLink && own.classList.contains('active')
        });
        links.push(isLink ? own : null);
      }
      return rows;
    }

    function update() {
      pending = false;
      var model = webhelpChromeModel(collectRows());
      var html = webhelpChromeHtml(model);
      var menu = document.querySelector('.wh_top_menu');
      var crumb = document.querySelector('.wh_breadcrumb');
      if (menu) menu.innerHTML = html.menuHtml;
      if (crumb) {
        crumb.innerHTML = html.crumbHtml;
        crumb.setAttribute('aria-label', opts.crumbLabel);
      }
      var adjacent = typeof siteAdjacentLinks === 'function' ? siteAdjacentLinks() : { prev: null, next: null };
      var pairs = [['.navprev', adjacent.prev, opts.prevLabel, opts.prevTitle], ['.navnext', adjacent.next, opts.nextLabel, opts.nextTitle]];
      for (var k = 0; k < pairs.length; k++) {
        var a = document.querySelector('.wh_navigation_links ' + pairs[k][0]);
        if (!a) continue;
        a.innerHTML = pairs[k][2];
        a.setAttribute('href', '#');
        a.setAttribute('aria-label', pairs[k][3]);
        a.setAttribute('aria-disabled', pairs[k][1] ? 'false' : 'true');
        a.title = pairs[k][1] ? (pairs[k][1].getAttribute('title') || pairs[k][3]) : pairs[k][3];
      }
    }

    function schedule() {
      if (pending) return;
      pending = true;
      setTimeout(update, 0);
    }

    function watch() {
      if (tocObserver) { tocObserver.disconnect(); tocObserver = null; }
      var toc = document.getElementById('wh_publication_toc_content');
      if (!toc || typeof MutationObserver === 'undefined') return;
      tocObserver = new MutationObserver(schedule);
      tocObserver.observe(toc, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    }

    document.addEventListener('click', function(e) {
      var t = e.target && e.target.closest ? e.target : null;
      if (!t) return;
      var rowEl = t.closest('[data-wh-row]');
      if (rowEl) {
        var idx = webhelpChromeClickRow(rowEl.getAttribute('data-wh-row'), links.length);
        if (idx >= 0 && links[idx]) { e.preventDefault(); links[idx].click(); }
        return;
      }
      var nav = t.closest('.wh_navigation_links a.navprev, .wh_navigation_links a.navnext');
      if (nav) {
        e.preventDefault();
        var adj = typeof siteAdjacentLinks === 'function' ? siteAdjacentLinks() : null;
        var go = adj ? (nav.classList.contains('navprev') ? adj.prev : adj.next) : null;
        if (go) go.click();
      }
    });

    // A mode switch swaps the shell's nodes in place: watch the body's own
    // children and re-bind when they change.
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(function() { watch(); schedule(); }).observe(document.body, { childList: true });
    }
    watch();
    schedule();
  })();
`;
}
