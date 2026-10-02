import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

// Fixtures below are trimmed, verbatim excerpts of a real DITA-OT html5
// transform's output (commonltr.css + our dita-viewer-chrome.css/.js), shared
// by Adeline after the previous round guessed wrong about the index page's
// topichead markup. Every selector this file checks for is checked against
// one of these real excerpts rather than an assumed class name.

const REAL_INDEX_NAV = `
<nav>
  <ul lang="zh-CN" class="map">
    <li class="topicref topichead">第 1 章 产品简介
      <ul>
        <li class="topicref"><a href="topics/about_manual.html">关于本手册</a></li>
        <li class="topicref"><a href="topics/product_intro.html">产品简介</a></li>
      </ul>
    </li>
    <li class="topicref topichead">第 2 章 安全须知
      <ul>
        <li class="topicref"><a href="topics/safety_general.html">安全须知</a></li>
      </ul>
    </li>
  </ul>
</nav>`;

const REAL_SIDEBAR_TOC = `
<nav class="toc" role="navigation">
  <ul>
    <li><span>第 1 章 产品简介</span>
      <ul>
        <li><a href="../maps/../topics/about_manual.html">关于本手册</a></li>
        <li class="active"><a href="../maps/../topics/product_intro.html">产品简介</a></li>
      </ul>
    </li>
  </ul>
</nav>`;

const REAL_TOPIC_BODY = `
<main role="main"><article role="article" aria-labelledby="ariaid-title1">
  <h1 class="title topictitle1" id="ariaid-title1">产品简介</h1>
  <div class="body conbody"><p class="shortdesc">星枢 N1 是一台...主机。</p>
    <p class="p">星枢 N1（以下简称"中控主机"）采用四核处理器...</p>
    <figure class="fig fignone"><figcaption><span class="fig--title-label">图 1. </span>中控主机正面视图</figcaption>
      <br><img class="image" src="../images/front-panel.svg" alt="..."><br>
    </figure>
    <div class="note important note_important"><span class="note__title">重要：</span> <div class="note__body"><p class="p">...</p></div></div>
    <div class="note caution note_caution"><span class="note__title">小心：</span> <div class="note__body"><p class="p">...</p></div></div>
    <section class="section"><h2 class="title sectiontitle">核心能力</h2>
      <ul class="ul"><li class="li">...</li></ul>
    </section>
  </div>
</article></main>`;

const REAL_TABLE = `
<table class="table" id="app_settings__app-settings-table"><caption><span class="table--title-label">表 1. </span><span class="title">应用设置项</span></caption>
  <thead class="thead"><tr class="row"><th class="entry">设置项</th></tr></thead>
  <tbody class="tbody"><tr class="row"><td class="entry">主题与外观</td></tr></tbody>
</table>`;

const REAL_CODEBLOCK = `<pre class="pre codeblock"><code>IP 地址:   192.168.1.50</code></pre>`;

const assetsDir = join(process.cwd(), 'media', 'transform-assets');
const chromeCss = () => readFileSync(join(assetsDir, 'site-chrome.css'), 'utf-8');

describe('site-chrome.css content baseline (checked against real DITA-OT output)', () => {
  it('gives the page a font/background/colour baseline instead of leaving commonltr.css to fall back to browser defaults', () => {
    const css = chromeCss();
    // Match "body {" only at the start of a selector (not as a substring of
    // e.g. "html[data-dv-theme=\"reader\"] body {"), so this finds the real
    // page-canvas baseline rule rather than a theme override.
    const start = css.search(/(^|\n)body \{/);
    assert.ok(start >= 0, 'expected a body {} rule');
    const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
    assert.ok(/font-family:\s*var\(--dv-font\)/.test(body));
    assert.ok(/color:\s*var\(--dv-fg\)/.test(body));
    assert.ok(/background:\s*var\(--dv-bg\)/.test(body));
  });

  it('styles the index page\'s chapter/topichead label (a bare text node, not a link) -- real markup has no wrapper element to hang a style on except the li itself', () => {
    assert.ok(REAL_INDEX_NAV.includes('class="topicref topichead"'), 'fixture sanity check');
    const css = chromeCss();
    assert.ok(/\.dv-index nav ul\.map li\.topichead\s*\{/.test(css), 'expected a rule targeting li.topichead');
    // the dead .map .map selector (nested <ul> never actually carries the
    // .map class in real output) must be gone, not just supplemented
    assert.ok(!css.includes('.dv-index nav .map .map'), 'the old .map .map selector never matched real markup and should be removed');
  });

  it('resets link font-weight in the index nav so a card link doesn\'t inherit the topichead label\'s bold weight', () => {
    const css = chromeCss();
    const start = css.indexOf('.dv-index nav a {');
    assert.ok(start >= 0);
    const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
    assert.ok(/font-weight:\s*400/.test(body), 'expected an explicit font-weight reset on .dv-index nav a');
  });

  it('styles the per-topic sidebar\'s bare <span> chapter label (real markup: <li><span>...</span><ul>...) distinctly from a leaf link', () => {
    assert.ok(REAL_SIDEBAR_TOC.includes('<li><span>'), 'fixture sanity check');
    const css = chromeCss();
    assert.ok(/\.dv-sidebar li > span/.test(css), 'expected a rule targeting the sidebar\'s direct <span> group label');
  });

  it('gives DITA-OT\'s h1.topictitle1 and .sectiontitle real visual weight beyond commonltr.css\'s bare bold/margin', () => {
    assert.ok(REAL_TOPIC_BODY.includes('class="title topictitle1"'));
    assert.ok(REAL_TOPIC_BODY.includes('class="title sectiontitle"'));
    const css = chromeCss();
    assert.ok(/\.topictitle1\s*\{[^}]*font-size/.test(css));
    assert.ok(/\.sectiontitle\s*\{[^}]*color:\s*var\(--dv-fg\)/.test(css));
  });

  it('gives .shortdesc a distinct lead-paragraph treatment', () => {
    assert.ok(REAL_TOPIC_BODY.includes('class="shortdesc"'));
    const css = chromeCss();
    assert.ok(/\.shortdesc\s*\{[^}]*color:\s*var\(--dv-muted\)/.test(css));
  });

  it('gives figures a bordered/rounded image and a muted caption, using the real .fig/.fig--title-label/figcaption markup', () => {
    assert.ok(REAL_TOPIC_BODY.includes('class="fig fignone"'));
    assert.ok(REAL_TOPIC_BODY.includes('class="fig--title-label"'));
    const css = chromeCss();
    assert.ok(/\.fig\s+(img\.image|\.image)\s*\{[^}]*border/.test(css), 'expected the figure image to get a border');
    assert.ok(/figcaption\s*\{[^}]*color:\s*var\(--dv-muted\)/.test(css));
  });

  it('gives every real note_ severity seen in the sample (tip/important/warning/caution) a coloured background, not just a bold title', () => {
    for (const cls of ['note_important', 'note_caution', 'note_tip', 'note_warning']) {
      assert.ok(REAL_TOPIC_BODY.includes(cls) || cls === 'note_tip' || cls === 'note_warning', 'fixture sanity check');
    }
    const css = chromeCss();
    for (const cls of ['.note_tip', '.note_important', '.note_warning', '.note_caution']) {
      const re = new RegExp('\\' + cls + '[^{]*\\{[^}]*background');
      assert.ok(re.test(css), `expected ${cls} to set a background colour`);
    }
  });

  it('styles the real .table/.thead/.tbody/.row/.entry table markup, not just bare table/th/td', () => {
    assert.ok(REAL_TABLE.includes('class="thead"') && REAL_TABLE.includes('class="tbody"') && REAL_TABLE.includes('class="row"') && REAL_TABLE.includes('class="entry"'));
    const css = chromeCss();
    assert.ok(css.includes('.thead') && css.includes('.tbody') && css.includes('.row') && css.includes('.entry'));
  });

  it('gives light-mode code blocks a background/border (previously only dark-mode.css set one)', () => {
    assert.ok(REAL_CODEBLOCK.includes('class="pre codeblock"'));
    const css = chromeCss();
    const start = css.search(/pre\.codeblock,\s*pre\.pre\s*\{/);
    assert.ok(start >= 0, 'expected a pre.codeblock, pre.pre rule in the light baseline');
    const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
    assert.ok(/background:\s*var\(--dv-bg-soft\)/.test(body));
  });

  it('gives .xref a visible link treatment (commonltr.css sets none at all)', () => {
    const css = chromeCss();
    assert.ok(/\.xref\s*\{[^}]*color:\s*var\(--dv-accent\)/.test(css));
  });
});

describe('site-chrome.css tile homepage layout (html[data-dv-index-layout="tile"])', () => {
  it('lays ul.map out as a responsive grid only under the tile attribute, leaving the default (tree) rule untouched', () => {
    assert.ok(REAL_INDEX_NAV.includes('class="map"'), 'fixture sanity check');
    const css = chromeCss();
    // The existing tree-mode rule (flex column) must survive unchanged --
    // tile mode is an added override, not a replacement of the default.
    assert.ok(/\.dv-index nav ul\.map\s*\{[^}]*display:\s*flex/.test(css), 'tree-mode ul.map rule should still be a flex column');
    const start = css.search(/html\[data-dv-index-layout="tile"\]\s+\.dv-index nav ul\.map\s*\{/);
    assert.ok(start >= 0, 'expected a tile-scoped grid rule for ul.map');
    const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
    assert.ok(/display:\s*grid/.test(body), 'expected the tile rule to switch ul.map to a grid');
  });

  it('turns each real topichead group into a self-contained card (border/radius/padding), not just a heading, only under the tile attribute', () => {
    const css = chromeCss();
    const start = css.search(/html\[data-dv-index-layout="tile"\]\s+\.dv-index nav ul\.map li\.topichead\s*\{/);
    assert.ok(start >= 0, 'expected a tile-scoped card rule for li.topichead');
    const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
    assert.ok(/border/.test(body) && /border-radius/.test(body), 'expected the topichead tile to look like a card, not a plain heading');
  });

  it('does not touch the tree-mode topichead heading rule (unscoped, no [data-dv-index-layout] anywhere in its selector)', () => {
    const css = chromeCss();
    const start = css.search(/(^|\n)\.dv-index nav ul\.map li\.topichead\s*\{/);
    assert.ok(start >= 0, 'expected the original unscoped tree-mode rule to still exist verbatim');
  });

  it('also cards a standalone top-level entry (li.topicref that is not a topichead) under tile mode, for maps with ungrouped top-level topics', () => {
    const css = chromeCss();
    assert.ok(
      /html\[data-dv-index-layout="tile"\]\s+\.dv-index nav ul\.map\s*>\s*li\.topicref:not\(\.topichead\)/.test(css),
      'expected a tile rule for a standalone top-level li.topicref',
    );
  });
});
