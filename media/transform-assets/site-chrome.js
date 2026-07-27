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
    toggleSections: 'Collapse/expand sections',
    home: 'Back to home',
    prevPage: 'Previous page',
    nextPage: 'Next page',
    onThisPage: 'On this page',
    code: 'code',
    copied: 'Copied',
    backToTop: 'Back to top',
    switchToLight: 'Switch to light mode',
    switchToDark: 'Switch to dark mode',
  },
  zh: {
    toggleSections: '\u6298\u53E0/\u5C55\u5F00\u7AE0\u8282',
    home: '\u56DE\u5230\u4E3B\u9875',
    prevPage: '\u4E0A\u4E00\u9875',
    nextPage: '\u4E0B\u4E00\u9875',
    onThisPage: '\u672C\u9875\u76EE\u5F55',
    code: '\u4EE3\u7801',
    copied: '\u5DF2\u590D\u5236',
    backToTop: '\u56DE\u5230\u9876\u90E8',
    switchToLight: '\u5207\u6362\u5230\u4EAE\u8272\u6A21\u5F0F',
    switchToDark: '\u5207\u6362\u5230\u6697\u8272\u6A21\u5F0F',
  },
};
var T = LABELS[LANG];

function cur() {
  var p = location.pathname;
  return p.substring(p.lastIndexOf('/') + 1) || 'index.html';
}

function isIndex() { return cur() === 'index.html'; }

function rootPrefix() {
  var link = document.querySelector('link[href*="dita-viewer-chrome"]');
  if (!link) return '';
  var href = link.getAttribute('href');
  var idx = href.lastIndexOf('/');
  return idx >= 0 ? href.substring(0, idx + 1) : '';
}

function initNavToolbar() {
  var idx = -1;
  for (var i = 0; i < MANIFEST.length; i++) {
    if (MANIFEST[i].file === cur()) { idx = i; break; }
  }
  var bar = document.createElement('div'); bar.className = 'dv-toolbar';
  var tb = document.createElement('button'); tb.textContent = '\u00A7';
  tb.title = T.toggleSections;
  tb.onclick = function () {
    document.querySelectorAll('section.section').forEach(function (s) {
      s.classList.toggle('dv-collapsed');
    });
  };
  bar.appendChild(tb);
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
  var items = [];
  document.querySelectorAll('section[id]').forEach(function (sec) {
    var titleEl = sec.querySelector('h2.sectiontitle, h3.sectiontitle');
    if (titleEl) items.push({ id: sec.id, text: titleEl.textContent });
  });
  var h1 = document.querySelector('h1[id]');
  if (h1 && items.length > 0) items.unshift({ id: h1.id, text: h1.textContent });
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
  window.addEventListener('scroll', function () {
    btn.classList.toggle('visible', window.scrollY > 400);
  });
  btn.onclick = function () { window.scrollTo({ top: 0, behavior: 'smooth' }); };
  document.body.appendChild(btn);
}

function initDarkMode() {
  var stored = localStorage.getItem('dv-theme');
  var dark = stored !== null ? stored === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (dark) document.documentElement.classList.add('dark');
  var btn = document.createElement('button'); btn.className = 'dv-dark-toggle';
  btn.textContent = dark ? '\u2600' : '\uD83C\uDF19';
  btn.title = dark ? T.switchToLight : T.switchToDark;
  btn.onclick = function () {
    var isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('dv-theme', isDark ? 'dark' : 'light');
    btn.textContent = isDark ? '\u2600' : '\uD83C\uDF19';
    btn.title = isDark ? T.switchToLight : T.switchToDark;
  };
  document.body.appendChild(btn);
}

if (FEATURES.navToolbar) initNavToolbar();
if (FEATURES.sidebar) initSidebar();
if (FEATURES.onPageToc) initOnPageToc();
if (FEATURES.copyCode) initCodeLabels();
if (FEATURES.backToTop) initBackToTop();
if (FEATURES.darkMode) initDarkMode();
