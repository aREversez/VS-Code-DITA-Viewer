var MANIFEST = /* __DV_MANIFEST__ */;
var FEATURES = /* __DV_FEATURES__ */;

// This script ships inside the static DITA-OT output itself (viewed in any
// browser by anyone reading the published docs, entirely outside VS Code),
// so VS Code's own localization APIs don't apply here. Instead, pick a
// label set based on the output's own document language — DITA-OT's html5
// transtype sets <html lang="..."> from the source topic's xml:lang — the
// same signal this extension's own preview renderer already uses to choose
// EN/ZH note labels (see the `noteLabels` lookup in DitaViewerProvider.ts).
var LANG = ((document.documentElement.lang || navigator.language || 'en') + '').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
var LABELS = {
  en: {
    collapseAllSections: 'Collapse all sections',
    expandAllSections: 'Expand all sections',
    home: 'Back to home',
    prevPage: 'Previous page',
    nextPage: 'Next page',
    onThisPage: 'On this page',
    code: 'code',
    copied: 'Copied',
    backToTop: 'Back to top',
    switchToLight: 'Switch to light mode',
    switchToDark: 'Switch to dark mode',
    theme: 'Colour theme',
    themeClassic: 'Classic',
    themeAurora: 'Aurora',
    themeReader: 'Reader',
    layout: 'Homepage layout',
    layoutTree: 'List',
    layoutTile: 'Tiles',
  },
  zh: {
    collapseAllSections: '\u6298\u53E0\u5168\u90E8\u7AE0\u8282',
    expandAllSections: '\u5C55\u5F00\u5168\u90E8\u7AE0\u8282',
    home: '\u56DE\u5230\u4E3B\u9875',
    prevPage: '\u4E0A\u4E00\u9875',
    nextPage: '\u4E0B\u4E00\u9875',
    onThisPage: '\u672C\u9875\u76EE\u5F55',
    code: '\u4EE3\u7801',
    copied: '\u5DF2\u590D\u5236',
    backToTop: '\u56DE\u5230\u9876\u90E8',
    switchToLight: '\u5207\u6362\u5230\u4EAE\u8272\u6A21\u5F0F',
    switchToDark: '\u5207\u6362\u5230\u6697\u8272\u6A21\u5F0F',
    theme: '\u914D\u8272\u4E3B\u9898',
    themeClassic: '\u7ECF\u5178',
    themeAurora: '\u6781\u5149',
    themeReader: '\u9605\u8BFB',
    layout: '\u9996\u9875\u7248\u5F0F',
    layoutTree: '\u5217\u8868',
    layoutTile: '\u5361\u7247',
  },
};
var T = LABELS[LANG];

function cur() {
  var p = location.pathname;
  return p.substring(p.lastIndexOf('/') + 1) || 'index.html';
}

function isIndex() { return cur() === 'index.html'; }

function rootPrefix() {
  // The site assets (css links, the chrome <script>) all live at the site
  // root and are referenced with the same '../'-repeat depth prefix from any
  // page, so any one of them yields the path back to the root. Legacy pages
  // carry a 'dita-viewer-chrome.css' link; template-shell pages instead load
  // 'dita-viewer-site-shell.css' / the deferred 'dita-viewer-chrome.js'.
  var el = document.querySelector(
    'link[href*="dita-viewer-chrome"], link[href*="dita-viewer-site-shell"], script[src*="dita-viewer-chrome"]',
  );
  if (!el) return '';
  var href = el.getAttribute('href') || el.getAttribute('src') || '';
  var idx = href.lastIndexOf('/');
  return idx >= 0 ? href.substring(0, idx + 1) : '';
}

// ── Section collapse: shared state, persistence, anchor reveal ──

// One selector, one owner: every collapse read/write in this file goes
// through these two, so the toolbar button, the stored preference, the
// <head> bootstrap's class and the anchor-reveal path can't drift onto
// different definitions of "a collapsible section".
function getCollapsibleSections() {
  return document.querySelectorAll('section.section');
}

// Stored site-wide under one key, mirroring 'dv-theme': every page of the
// export shares the same collapse preference. Only the button writes it --
// an anchor auto-expanding one section is the reader navigating, not the
// reader choosing a new default, and persisting that would silently undo
// their collapse-everything choice one page at a time.
function getSectionPref() {
  try { return localStorage.getItem('dv-section-collapse'); } catch (e) { return null; }
}
function setSectionPref(collapsed) {
  try { localStorage.setItem('dv-section-collapse', collapsed ? '1' : '0'); } catch (e) {}
}

// Collapsing marks TOP-LEVEL sections only; expanding clears every section
// (including any straggler a nested marking could have left behind, and
// matching the <head> bootstrap's own top-level stamping). site-chrome.css
// hides a collapsed section's non-heading children wholesale, so a nested
// section inside a collapsed parent needs no class of its own: the CSS
// cascade hides it, expandCollapsedAncestors' ancestor walk un-hides it, and
// neither pass has to know it exists. Marking nested sections too would strand
// one invisible next to an un-hidden parent, unreachable by any control.
function applyAllSectionsCollapse(collapsed) {
  if (collapsed) {
    getCollapsibleSections().forEach(function (s) {
      var p = s.parentElement;
      if (p && p.closest && p.closest('section.section')) return;
      s.classList.add('dv-collapsed');
    });
  } else {
    getCollapsibleSections().forEach(function (s) {
      s.classList.remove('dv-collapsed');
    });
  }
}

// The toolbar button's live two-state view. `anyCollapsed` is the state the
// glyph/title/aria-pressed claim, so it is always recomputed from the DOM
// rather than tracked on its own -- an anchor-revealed section breaks the
// all-or-nothing picture, and the button should show what it will actually
// do (collapse the still-visible ones).
var anyCollapsed = false;
// The toolbar button, module-scoped next to the state it renders: assigned
// by initNavToolbar, but syncSectionToggleState tolerates it being absent
// (a void expression, not a reference) so the load-time reveal path below
// can run before the toolbar exists.
var sectionToggle = null;
function syncSectionToggleState() {
  anyCollapsed = !!document.querySelector('section.section.dv-collapsed');
  if (!sectionToggle) return;
  sectionToggle.textContent = anyCollapsed ? '\u229F' : '\u229E';
  sectionToggle.title = anyCollapsed ? T.expandAllSections : T.collapseAllSections;
  sectionToggle.setAttribute('aria-pressed', anyCollapsed ? 'true' : 'false');
}

function hasHashTarget() {
  return location.hash.length > 1;
}

function findHashTarget() {
  var id;
  try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) { id = location.hash.slice(1); }
  if (!id) return null;
  var el = document.getElementById(id);
  // Map-level links into a section come in as "topicid/sectionid" (and
  // DITA-OT's own idiom wraps those as id="__topicid/sectionid") -- try the
  // trailing part before giving up.
  if (!el && id.indexOf('/') >= 0) el = document.getElementById(id.substring(id.lastIndexOf('/') + 1));
  if (!el && id.indexOf('/') >= 0) el = document.getElementById('__' + id);
  return el;
}

function revealElement(el) {
  if (!el) return;
  try { el.scrollIntoView(); } catch (e) {}
}

// Walk up from an anchor target and un-collapse every collapsed ancestor
// section (nested sections included -- an outer <section> hide blanks its
// inner ones via the CSS child rule regardless of their own class),
// returning how many it actually opened. DOM-only: no preference write, on
// purpose (see setSectionPref's comment).
function expandCollapsedAncestors(el) {
  var changed = 0;
  var n = el && el.closest ? el.closest('section.section') : null;
  while (n) {
    if (n.classList.contains('dv-collapsed')) {
      n.classList.remove('dv-collapsed');
      changed++;
    }
    var parent = n.parentElement ? n.parentElement.closest('section.section') : null;
    n = parent && n !== parent ? parent : null;
  }
  return changed;
}

function initSectionCollapsePreference() {
  if (getSectionPref() === '1') applyAllSectionsCollapse(true);
  // A stored collapse-everything preference must never win against a link
  // that names a specific section -- the reader asked for that section,
  // exactly the preview's nav-auto-expanded-for-the-active-row rule.
  if (hasHashTarget()) {
    var changed = expandCollapsedAncestors(findHashTarget());
    if (changed) syncSectionToggleState();
  }
}

// Same-document #id links -- the sidebar (links into THIS page's sections)
// and DITA-OT's own cross-references -- land on a display:none element when
// the target's section is collapsed, and the browser silently scrolls to top
// instead. A capture-phase listener sees the click before any page-local
// handler (the on-page TOC's own onclick) and restores a jumpable target.
function initAnchorReveal() {
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (href.charAt(0) !== '#' || href.length < 2) return;
    var target = document.getElementById(href.slice(1));
    if (!target) return;
    // Visible already: stay out of the way entirely and let the browser's
    // native jump (and hash update) happen.
    if (target.offsetParent) return;
    e.preventDefault();
    if (expandCollapsedAncestors(target)) syncSectionToggleState();
    revealElement(target);
  }, true);
  // A hash change within the loaded page (native jump, or a link whose
  // target only became reachable after an expand) -- expand so the browser's
  // layout includes the target, then re-jump by resetting the hash.
  window.addEventListener('hashchange', function () {
    var target = findHashTarget();
    if (!target) return;
    if (expandCollapsedAncestors(target)) {
      syncSectionToggleState();
      revealElement(target);
    } else if (!target.offsetParent) {
      // Still hidden, and nothing to expand: the target itself sits inside
      // content hidden by something outside our collapse machinery (or the
      // browser's jump predated the expand) -- nudge it into view.
      revealElement(target);
    }
  });
}

function initNavToolbar() {
  var idx = -1;
  for (var i = 0; i < MANIFEST.length; i++) {
    if (MANIFEST[i].file === cur()) { idx = i; break; }
  }
  var bar = document.createElement('div'); bar.className = 'dv-toolbar';
  // All-sections toggle, two-state like the extension preview's collapse
  // bookkeeping: the glyph, title and aria-pressed all describe the *current
  // state* (\u229F = sections are collapsed, pressing expands), so the
  // button never claims "collapse" while everything already is. The state
  // itself lives at module scope (syncSectionToggleState) so the anchor-
  // reveal paths can keep the button honest when they open a section behind
  // the reader's back -- literally, since initSectionCollapsePreference has
  // already run by the time this button first renders its state.
  sectionToggle = document.createElement('button');
  sectionToggle.onclick = function () {
    // One direction for the whole page (classList.toggle's second-argument
    // form), not a per-section flip -- a lockstep toggle would invert the
    // reader's partly-collapsed mix into a different partly-collapsed mix
    // instead of collapsing/expanding everything.
    var target = !anyCollapsed;
    applyAllSectionsCollapse(target);
    setSectionPref(target);
    syncSectionToggleState();
  };
  syncSectionToggleState();
  bar.appendChild(sectionToggle);
  if (!isIndex()) {
    var homeBtn = document.createElement('button'); homeBtn.textContent = '\u2302';
    homeBtn.title = T.home;
    homeBtn.onclick = function () { location.href = rootPrefix() + 'index.html'; };
    bar.appendChild(homeBtn);
  }
  if (idx > 0) {
    var pb = document.createElement('button'); pb.textContent = '\u2039'; pb.title = T.prevPage;
    pb.onclick = function () { location.href = MANIFEST[idx - 1].file; };
    bar.appendChild(pb);
  }
  if (idx >= 0 && idx < MANIFEST.length - 1) {
    var nb = document.createElement('button'); nb.textContent = '\u203A'; nb.title = T.nextPage;
    nb.onclick = function () { location.href = MANIFEST[idx + 1].file; };
    bar.appendChild(nb);
  }
  var THEMES = [['classic', T.themeClassic], ['aurora', T.themeAurora], ['reader', T.themeReader]];
  var sel = document.createElement('select'); sel.title = T.theme;
  THEMES.forEach(function (t) {
    var opt = document.createElement('option'); opt.value = t[0]; opt.textContent = t[1];
    sel.appendChild(opt);
  });
  // buildThemeBootstrapScript() already applied any stored theme to <html>
  // before this script ran (avoids a flash of the wrong accent colour); read
  // it back here just to initialise the control's displayed value.
  sel.value = document.documentElement.getAttribute('data-dv-theme') || 'classic';
  sel.onchange = function () {
    if (sel.value === 'classic') {
      document.documentElement.removeAttribute('data-dv-theme');
      localStorage.setItem('dv-chrome-theme', '');
    } else {
      document.documentElement.setAttribute('data-dv-theme', sel.value);
      localStorage.setItem('dv-chrome-theme', sel.value);
    }
  };
  bar.appendChild(sel);
  // Homepage layout (tree vs tile) only means anything on the index page --
  // a topic page has no ul.map to lay out, so the control would be dead
  // weight (and confusing) everywhere else.
  if (isIndex()) {
    var LAYOUTS = [['tree', T.layoutTree], ['tile', T.layoutTile]];
    var layoutSel = document.createElement('select'); layoutSel.title = T.layout;
    LAYOUTS.forEach(function (l) {
      var opt = document.createElement('option'); opt.value = l[0]; opt.textContent = l[1];
      layoutSel.appendChild(opt);
    });
    // buildThemeBootstrapScript() already applied any stored layout to <html>
    // before this script ran (avoids a flash of the wrong layout); read it
    // back here just to initialise the control's displayed value.
    layoutSel.value = document.documentElement.getAttribute('data-dv-index-layout') || 'tree';
    layoutSel.onchange = function () {
      if (layoutSel.value === 'tree') {
        document.documentElement.removeAttribute('data-dv-index-layout');
        localStorage.setItem('dv-index-layout', '');
      } else {
        document.documentElement.setAttribute('data-dv-index-layout', layoutSel.value);
        localStorage.setItem('dv-index-layout', layoutSel.value);
      }
    };
    bar.appendChild(layoutSel);
  }
  document.body.appendChild(bar);
}

function initSidebar() {
  if (isIndex()) { document.body.classList.add('dv-index'); return; }
  var nav = document.querySelector('nav');
  if (!nav) return;
  nav.classList.add('dv-sidebar');
  var cf = cur();
  var matched = false;
  nav.querySelectorAll('a').forEach(function (a) {
    var href = a.getAttribute('href');
    if (!href) return;
    var base = href.substring(href.lastIndexOf('/') + 1).split('#')[0];
    if (base === cf) {
      a.classList.add('active');
      if (!matched) {
        try { a.scrollIntoView({ block: 'center' }); } catch (e) {}
        matched = true;
      }
    }
  });
  var main = document.querySelector('main');
  if (main) main.classList.add('dv-has-sidebar');
}

function initOnPageToc() {
  if (isIndex()) return;
  var counter = 0;
  function ensureId(el) {
    // Real DITA-OT html5 output never puts an id on <section> or on its
    // h2.sectiontitle/h3.sectiontitle -- only <h1> reliably gets one. Without
    // this, the loops below always find zero section-level items and the
    // on-page TOC silently never renders, regardless of how many headings
    // the page actually has.
    if (!el.id) el.id = 'dv-toc-' + (counter++);
    return el.id;
  }
  var items = [];
  document.querySelectorAll('section').forEach(function (sec) {
    var titleEl = sec.querySelector('h2.sectiontitle, h3.sectiontitle');
    if (titleEl) items.push({ id: ensureId(titleEl), text: titleEl.textContent });
  });
  var h1 = document.querySelector('h1');
  if (h1 && items.length > 0) items.unshift({ id: ensureId(h1), text: h1.textContent });
  if (items.length < 2) return;
  var container = document.createElement('div'); container.className = 'dv-page-toc';
  var title = document.createElement('div'); title.className = 'dv-page-toc-title';
  title.textContent = T.onThisPage;
  container.appendChild(title);
  var list = document.createElement('ul');
  items.forEach(function (it) {
    var li = document.createElement('li');
    var a = document.createElement('a'); a.href = '#' + it.id; a.textContent = it.text;
    a.onclick = function (e) {
      e.preventDefault();
      var el = document.getElementById(it.id);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    };
    li.appendChild(a);
    list.appendChild(li);
  });
  container.appendChild(list);
  document.body.appendChild(container);
}

function initCodeLabels() {
  document.querySelectorAll('pre.codeblock, pre.pre').forEach(function (pre) {
    var classes = pre.className.split(/\s+/);
    var lang = '';
    for (var j = 0; j < classes.length; j++) {
      if (classes[j].indexOf('language-') === 0) { lang = classes[j].substring(9); break; }
    }
    if (!lang) lang = T.code;
    var label = document.createElement('span'); label.className = 'dv-code-lang';
    label.textContent = lang;
    pre.style.position = 'relative';
    pre.appendChild(label);
    label.onclick = function () {
      var text = pre.textContent;
      var done = function () {
        label.textContent = T.copied;
        setTimeout(function () { label.textContent = lang; }, 2000);
      };
      var fallback = function () {
        try {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed'; ta.style.left = '-9999px';
          document.body.appendChild(ta); ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          done();
        } catch (e) {}
      };
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(done).catch(fallback);
      } else {
        fallback();
      }
    };
  });
}

function initBackToTop() {
  var btn = document.createElement('button'); btn.className = 'dv-back-to-top';
  btn.textContent = '\u2191'; btn.title = T.backToTop;
  // In a template-shell page the body never scrolls -- #dita-content-root
  // owns the vertical scrollbar (site-shell.css), so watch and scroll that
  // pane instead of the window (which would never move past its first
  // viewport of a long topic).
  var pane = FEATURES.siteShell ? shellScroller() : null;
  var watch = pane || window;
  var pos = function () { return pane ? pane.scrollTop : window.scrollY; };
  watch.addEventListener('scroll', function () {
    btn.classList.toggle('visible', pos() > 400);
  });
  btn.onclick = function () {
    if (pane && pane.scrollTo) { pane.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  document.body.appendChild(btn);
}

function initDarkMode() {
  // The html.dark class is already on <html> by the time this runs: the
  // extension injects a tiny inline bootstrap script in <head> (before any
  // body paint) that reads the same preference and applies it, so a dark-mode
  // reader never sees DITA-OT's light default flash while navigating between
  // topics. Reading the class here keeps the button in sync with what's on
  // screen rather than recomputing (which could disagree with the bootstrap).
  var dark = document.documentElement.classList.contains('dark');
  var btn = document.createElement('button'); btn.className = 'dv-dark-toggle';
  btn.textContent = dark ? '\u2600' : '\uD83C\uDF19';
  btn.title = dark ? T.switchToLight : T.switchToDark;
  btn.onclick = function () {
    var isDark = document.documentElement.classList.toggle('dark');
    try { localStorage.setItem('dv-theme', isDark ? 'dark' : 'light'); } catch (e) {}
    // In a template-shell page the template's own palette is keyed on
    // body.template-dark (see templateExport.ts's body bootstrap); keep it
    // in step with html.dark so one button drives both layers.
    if (FEATURES.siteShell) syncTemplateDark();
    btn.textContent = isDark ? '\u2600' : '\uD83C\uDF19';
    btn.title = isDark ? T.switchToLight : T.switchToDark;
  };
  document.body.appendChild(btn);
}

// Reconciles body.template-dark with the html.dark class the toggle (and
// the <head> bootstrap) owns. The inline body bootstrap already stamped
// the class before paint; this only ever runs after a toggle click, and
// keeps both markers telling the same story.
function syncTemplateDark() {
  var dark = document.documentElement.classList.contains('dark');
  var b = document.body;
  if (!b) return;
  var has = (' ' + b.className + ' ').indexOf(' template-dark ') >= 0;
  if (dark && !has) b.className += (b.className ? ' ' : '') + 'template-dark';
  if (!dark && has) b.className = b.className.replace(/\s*\btemplate-dark\b/, '');
}

// ── Template shell (site mode export) wiring ──
//
// When the export was rebuilt around a media/templates/* template
// (injectTemplateChrome in extension.ts), the sidebar is real nested
// markup with real page links and a build-time `active` row -- the legacy
// dv-toolbar/dv-sidebar never load here (their feature flags stay off),
// and only three small behaviors need JS: clicking a row navigates,
// the fold toggles work and persist, and back-to-top scrolls the
// #dita-content-root pane instead of the window.

function shellScroller() {
  return document.getElementById('dita-content-root');
}

// Sidebar links carry their destination in data-site-target (the '_root_/'
// pseudo-path shared with the preview's markup); href stays "#" so the
// roving-tabindex keyboard model and the middle-click story don't fight
// each other. Rewriting them happens once at load.
function initTemplateNavLinks() {
  var nav = document.querySelector('.site-nav');
  if (!nav) return;
  var links = nav.querySelectorAll('.site-nav-link[data-site-target]');
  for (var i = 0; i < links.length; i++) {
    var a = links[i];
    var target = a.getAttribute('data-site-target');
    if (!target || target.indexOf('_root_/') !== 0) continue;
    a.setAttribute('href', rootPrefix() + target.substring('_root_/'.length));
  }
  // Bring the reader's own row into sight inside the scrollable sidebar --
  // the preview does this when it swaps pages; here the row is already
  // active in the markup, only the scroll position needs a nudge.
  var active = nav.querySelector('.site-nav-link.active');
  if (active && active.scrollIntoView) {
    try { active.scrollIntoView({ block: 'center' }); } catch (e) {}
  }
}

function setShellNavItemCollapsed(item, collapsed) {
  if (!item || !item.classList) return;
  if (collapsed) item.classList.add('collapsed');
  else item.classList.remove('collapsed');
  item.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  var toggle = item.querySelector(':scope > .site-nav-toggle');
  if (toggle) {
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggle.setAttribute('aria-label', collapsed ? (toggle.getAttribute('data-expand-label') || 'Expand') : (toggle.getAttribute('data-collapse-label') || 'Collapse'));
  }
}

function reportShellNavCollapseState() {
  try {
    var ids = [];
    var nav = document.querySelector('.site-nav');
    var active = nav ? nav.querySelector('.site-nav-link.active') : null;
    var items = document.querySelectorAll('.site-nav-item.has-children');
    for (var i = 0; i < items.length; i++) {
      var id = items[i].getAttribute('data-nav-id');
      // The ancestors of the active row are the build-time revealed path
      // to the current page: they always arrive expanded and stay out of
      // the stored set, so a stored fold can never strand the reader's own
      // row (the same exemption renderSiteNavTreeHtml's revealActive gives
      // them at render time).
      var isActiveAncestor = active && items[i].contains(active);
      if (id && items[i].classList.contains('collapsed') && !isActiveAncestor) ids.push(id);
    }
    localStorage.setItem('dv-site-nav-collapsed', JSON.stringify(ids));
  } catch (e) {}
}

function initTemplateNavFolds() {
  var nav = document.querySelector('.site-nav');
  if (!nav) return;
  // Restore the stored folds first (skipping the active row's ancestors,
  // which the build already revealed), then wire the toggles.
  try {
    var stored = JSON.parse(localStorage.getItem('dv-site-nav-collapsed') || '[]');
    if (stored && stored.length) {
      var active = nav.querySelector('.site-nav-link.active');
      var wanted = {};
      for (var s = 0; s < stored.length; s++) wanted[stored[s]] = true;
      var items = nav.querySelectorAll('.site-nav-item.has-children[data-nav-id]');
      for (var i = 0; i < items.length; i++) {
        var isActiveAncestor = active && items[i].contains(active);
        if (wanted[items[i].getAttribute('data-nav-id')] && !isActiveAncestor) {
          setShellNavItemCollapsed(items[i], true);
        }
      }
    }
  } catch (e) {}
  nav.addEventListener('click', function (e) {
    var toggle = e.target && e.target.closest ? e.target.closest('.site-nav-toggle') : null;
    if (!toggle) return;
    e.preventDefault();
    var item = toggle.closest ? toggle.closest('.site-nav-item') : null;
    if (!item) return;
    setShellNavItemCollapsed(item, !item.classList.contains('collapsed'));
    reportShellNavCollapseState();
  });
}

if (FEATURES.siteShell) {
  initTemplateNavLinks();
  initTemplateNavFolds();
}
if (FEATURES.navToolbar) {
  // Preference first: the page may already carry a hash (opened straight
  // onto one section), and the toolbar's initial glyph must reflect the
  // DOM the reveal path just adjusted.
  initSectionCollapsePreference();
  initAnchorReveal();
  initNavToolbar();
}
if (FEATURES.sidebar) initSidebar();
if (FEATURES.onPageToc) initOnPageToc();
if (FEATURES.copyCode) initCodeLabels();
if (FEATURES.backToTop) initBackToTop();
if (FEATURES.darkMode) initDarkMode();
