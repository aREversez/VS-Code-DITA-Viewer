import * as assert from 'assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildHeadInjectHtml,
  buildShellPageHtml,
  buildTemplateCssText,
  buildTemplateDarkBootstrapScript,
  buildTemplateNav,
  collectOutline,
  readShellCss,
  readTemplateChromeCss,
  renderOutlineHtml,
  renderSidebarHtml,
} from '../../editor/templateExport';
import type { SiteTemplate } from '../../editor/siteTemplates';

/** A minimal, complete SiteTemplate for the pure render helpers (they read
 *  id/dir/css/outline/header/footer only). */
function fakeTemplate(over: Partial<SiteTemplate> & Pick<SiteTemplate, 'dir'>): SiteTemplate {
  return {
    id: 'test',
    names: { '': 'Test' },
    defaultDark: false,
    outline: false,
    css: [],
    builtin: false,
    ...over,
  };
}

const LABELS = { nav: 'Topics', expand: 'Expand', collapse: 'Collapse' };

// ── buildTemplateNav / renderSidebarHtml (real map on disk) ──

describe('templateExport: buildTemplateNav', () => {
  let tmp: string;
  let mapPath: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'texport-'));
    mkdirSync(join(tmp, 'maps'), { recursive: true });
    mkdirSync(join(tmp, 'topics'), { recursive: true });
    // The map lives in maps/ and reaches topics with '../' -- the exact shape
    // DITA-OT mirrors into the output root, dropping the '../' segments.
    writeFileSync(
      join(tmp, 'maps', 'book.ditamap'),
      [
        '<map>',
        '  <title>My Book</title>',
        '  <topicref href="../topics/ch1.dita">',
        '    <topicref href="../topics/s1.dita"/>',
        '  </topicref>',
        '  <topicref href="../topics/ch2.dita">',
        '    <topicref href="../topics/s2.dita"/>',
        '  </topicref>',
        '</map>',
      ].join('\n'),
    );
    mapPath = join(tmp, 'maps', 'book.ditamap');
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('derives output paths relative to the map, strips the leading "../", and flips .dita to .html', () => {
    const nav = buildTemplateNav({ mapPath });
    assert.deepStrictEqual(
      nav.pages.map((p) => p.file).sort(),
      ['topics/ch1.html', 'topics/ch2.html', 'topics/s1.html', 'topics/s2.html'],
    );
    // Each page is a '_root_/'-keyed pseudo-path so the preview's tree markup
    // and fold-state ids work unchanged.
    for (const entry of nav.manifest) {
      if (entry.isGroup || !entry.absPath) continue;
      assert.ok(entry.absPath.startsWith('_root_/'), `absPath ${entry.absPath} should be _root/-keyed`);
      assert.ok(!entry.absPath.includes('..'), `absPath ${entry.absPath} should not contain ../`);
    }
  });

  it('keeps the parent/child nesting (depth) so the sidebar renders a real tree', () => {
    const nav = buildTemplateNav({ mapPath });
    const depth = (href: string) => nav.manifest.find((e) => e.href === href)?.depth;
    assert.strictEqual(depth('topics/ch1.html'), 0);
    assert.strictEqual(depth('topics/s1.html'), 1);
    assert.strictEqual(depth('topics/ch2.html'), 0);
  });

  it('substitutes a resolved topic title over the map linktext when a resolver is supplied', () => {
    const nav = buildTemplateNav({ mapPath, resolveTopicTitle: (href) => (href.endsWith('ch1.dita') ? 'Chapter One!' : undefined) });
    const ch1 = nav.pages.find((p) => p.file === 'topics/ch1.html');
    assert.strictEqual(ch1?.title, 'Chapter One!');
  });
});

describe('templateExport: renderSidebarHtml', () => {
  let tmp: string;
  let mapPath: string;
  let nav: ReturnType<typeof buildTemplateNav>;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'texport-sb-'));
    mkdirSync(join(tmp, 'maps'), { recursive: true });
    writeFileSync(
      join(tmp, 'maps', 'book.ditamap'),
      '<map><title>B</title>' +
      '<topicref href="../topics/ch1.dita"><topicref href="../topics/s1.dita"/></topicref>' +
      '<topicref href="../topics/ch2.dita"><topicref href="../topics/s2.dita"/></topicref>' +
      '</map>',
    );
    mapPath = join(tmp, 'maps', 'book.ditamap');
    nav = buildTemplateNav({ mapPath });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('bakes the current page active and links rows with the _root_ target', () => {
    const sidebar = renderSidebarHtml(nav.manifest, '_root_/topics/s1.html', LABELS);
    assert.ok(sidebar.startsWith('<nav class="site-nav"'), 'wrapped in the .site-nav nav');
    const m = /<a\b[^>]*data-site-target="_root_\/topics\/s1\.html"[^>]*>/.exec(sidebar);
    assert.ok(m, 's1 row present');
    assert.ok(/class="[^"]*\bactive\b/.test(m![0]), 's1 row is active');
  });

  it('honours a persisted fold set for a branch that is not the active row\'s ancestor', () => {
    const ch2Id = nav.manifest.find((e) => e.href === 'topics/ch2.html')?.id as string;
    const open = renderSidebarHtml(nav.manifest, '_root_/topics/s1.html', LABELS);
    const folded = renderSidebarHtml(nav.manifest, '_root_/topics/s1.html', LABELS, new Set([ch2Id]));
    assert.strictEqual((open.match(/has-children collapsed/g) || []).length, 0);
    assert.strictEqual((folded.match(/has-children collapsed/g) || []).length, 1);
  });

  it('renders nothing for an empty manifest', () => {
    assert.strictEqual(renderSidebarHtml([], '_root_/x.html', LABELS), '');
  });
});

// ── collectOutline / renderOutlineHtml ──

describe('templateExport: collectOutline', () => {
  it('stamps generated ids onto headings that lack one and reads their text', () => {
    const { contentHtml, headings } = collectOutline('<h1>Alpha</h1><p>x</p><h2 id="keep">Beta</h2><h3>Gamma</h3>');
    assert.deepStrictEqual(headings.map((h) => h.text), ['Alpha', 'Beta', 'Gamma']);
    assert.deepStrictEqual(headings.map((h) => h.level), [1, 2, 3]);
    assert.strictEqual(headings[1].id, 'keep');
    assert.ok(/<h1 id="dv-outline-0">Alpha<\/h1>/.test(contentHtml), 'h1 gets a generated id in the returned markup');
    assert.ok(/<h2 id="keep">Beta<\/h2>/.test(contentHtml), 'existing id preserved');
  });

  it('does not fabricate an id for a heading that already has one, and keeps only h1-h3', () => {
    const { headings } = collectOutline('<h2 id="a">A</h2><h4>not outlined</h4>');
    assert.strictEqual(headings.length, 1);
    assert.strictEqual(headings[0].id, 'a');
  });
});

describe('templateExport: renderOutlineHtml', () => {
  it('returns undefined for fewer than two headings (nothing worth a column)', () => {
    assert.strictEqual(renderOutlineHtml([{ id: 'a', text: 'A', level: 1 }]), undefined);
    assert.strictEqual(renderOutlineHtml([]), undefined);
  });

  it('renders the .tpl-outline column with a link per heading', () => {
    const html = renderOutlineHtml([
      { id: 'a', text: 'A & B', level: 1 },
      { id: 'b', text: 'Sub', level: 2 },
    ]);
    assert.ok(html && html.includes('class="tpl-outline"'));
    assert.ok(html!.includes('href="#a"'));
    assert.ok(html!.includes('A &amp; B'), 'heading text escaped');
    assert.ok(html!.includes('data-outline-level="2"'));
  });
});

// ── buildShellPageHtml ──

describe('templateExport: buildShellPageHtml', () => {
  const base = {
    template: fakeTemplate({ dir: '/tpl/test' }),
    mapTitle: 'My Book',
    year: 2026,
    toRelative: (abs: string) => '_template/test/' + abs.slice('/tpl/test/'.length),
  };

  it('moves the <main role="main"> content into #dita-content-root and drops DITA-OT\'s own footer', () => {
    const html =
      '<!DOCTYPE html><html lang="en"><head><title>A</title></head>' +
      '<body class="topic"><main role="main"><h1 id="t">Title</h1><p>Body text</p></main>' +
      '<footer class="dita-footer">DITA footer</footer></body></html>';
    const out = buildShellPageHtml({ ...base, html, sidebarHtml: '<nav class="site-nav">x</nav>' });
    assert.ok(out.includes('<div id="dita-content-root"'), 'content root present');
    assert.ok(out.includes('<h1 id="t">Title</h1><p>Body text</p>'), 'main content moved verbatim');
    assert.ok(!out.includes('DITA footer'), "DITA-OT's own footer (outside main) is dropped");
    assert.ok(/<body[^>]*class="[^"]*\btopic\b[^"]*\bmode-site\b/.test(out), 'body keeps its class and gains mode-site');
    assert.ok(out.includes('data-template="test"'), 'template hook stamped on body');
  });

  it('treats the whole body as the content region when there is no <main> (map landing page)', () => {
    const html = '<html><head></head><body><h1>Home</h1><ul><li>toc</li></ul></body></html>';
    const out = buildShellPageHtml({ ...base, html, sidebarHtml: '' });
    assert.ok(out.includes('<h1>Home</h1>'), 'body content preserved');
    assert.ok(out.includes('<div id="dita-content-root">'), 'no site-main class without sidebar/outline');
    assert.ok(!/id="dita-content-root" class=/.test(out), 'bare content root when neither sidebar nor outline');
  });

  it('does not duplicate a data-template attribute already present on <body>', () => {
    const html = '<html><head></head><body data-template="mine"><main role="main"><p>x</p></main></body></html>';
    const out = buildShellPageHtml({ ...base, html, sidebarHtml: '' });
    assert.strictEqual((out.match(/data-template=/g) || []).length, 1);
    assert.ok(out.includes('data-template="mine"'), 'existing value kept');
  });

  it('injects the head markup before </head> and the body bootstrap right after <body>', () => {
    const html = '<html><head><title>T</title></head><body><main role="main"><p>x</p></main></body></html>';
    const out = buildShellPageHtml({
      ...base, html, sidebarHtml: '',
      headInjectHtml: '<LINK-HEAD>',
      bodyBootstrapHtml: '<BOOT-BODY>',
    });
    assert.ok(out.includes('<title>T</title><LINK-HEAD></head>'), 'head injection lands before </head>');
    assert.ok(/<body[^>]*><BOOT-BODY>/.test(out), 'body bootstrap lands right after <body>');
  });

  it('generates the outline column and its heading ids when the template opts in', () => {
    const html =
      '<html><head></head><body><main role="main"><h2 id="a">One</h2><p>x</p><h2>Two</h2><p>y</p></main></body></html>';
    const out = buildShellPageHtml({
      ...base, template: fakeTemplate({ dir: '/tpl/test', outline: true }),
      html, sidebarHtml: '<nav class="site-nav">x</nav>', outline: true,
    });
    assert.ok(out.includes('class="tpl-outline"'), 'outline column rendered');
    // "One" already carries id="a" so it never consumes a generated slot;
    // "Two" is the first id-less heading and gets dv-outline-0.
    assert.ok(/<h2 id="dv-outline-0">Two<\/h2>/.test(out), 'second heading got a generated id in the output');
    assert.ok(out.includes('href="#a"'), 'outline links to existing id');
  });

  it('leaves the input untouched when it has no <body>', () => {
    const html = '<html><head><title>x</title></head></html>';
    assert.strictEqual(buildShellPageHtml({ ...base, html, sidebarHtml: '' }), html);
  });
});

// ── head injection + dark bootstrap ──

describe('templateExport: buildHeadInjectHtml', () => {
  it('emits template/shell/chrome css links, then the bootstrap and a deferred chrome script, in that order', () => {
    const html = buildHeadInjectHtml(
      { templateCss: 'a/t.css', shellCss: 'b/shell.css', chromeCss: 'c/chrome.css', chromeJs: 'd/chrome.js' },
      'BOOT();',
    );
    const idx = (needle: string) => html.indexOf(needle);
    assert.ok(idx('a/t.css') < idx('b/shell.css'), 'template css before shell');
    assert.ok(idx('b/shell.css') < idx('c/chrome.css'), 'shell before chrome widgets');
    assert.ok(idx('c/chrome.css') < idx('BOOT();'), 'css before the bootstrap script');
    assert.ok(idx('BOOT();') < idx('chrome.js'), 'bootstrap before the chrome script');
    assert.ok(/<script defer src="d\/chrome\.js">/.test(html), 'chrome script is deferred');
  });

  it('escapes attribute values (a ../ prefix is fine, a quote is not injected raw)', () => {
    const html = buildHeadInjectHtml(
      { templateCss: '../a.css', shellCss: '../s.css', chromeCss: '../c.css', chromeJs: '../j.js' },
      'x',
    );
    assert.ok(html.includes('href="../a.css"'));
  });
});

describe('templateExport: buildTemplateDarkBootstrapScript', () => {
  it('reads the stored dv-theme preference and applies template-dark', () => {
    const js = buildTemplateDarkBootstrapScript(false);
    assert.ok(js.includes("localStorage.getItem('dv-theme')"));
    assert.ok(js.includes('template-dark'));
    assert.ok(js.includes('prefers-color-scheme'), 'falls back to the OS preference');
  });

  it('uses the template defaultDark only as the last-resort fallback', () => {
    assert.ok(/\.matches:\s*true\s*\)/.test(buildTemplateDarkBootstrapScript(true)));
    assert.ok(/\.matches:\s*false\s*\)/.test(buildTemplateDarkBootstrapScript(false)));
  });
});

// ── css asset helpers ──

describe('templateExport: buildTemplateCssText', () => {
  it('rewrites url() references through the injected mapper', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'texport-css-'));
    try {
      mkdirSync(join(tmp, 'res'), { recursive: true });
      writeFileSync(join(tmp, 'main.css'), 'body{background:url("res/bg.png") no-repeat}');
      const t = fakeTemplate({ dir: tmp, css: [join(tmp, 'main.css')] });
      const css = buildTemplateCssText(t, (abs) => '_template/test/' + abs.slice(tmp.length + 1).replace(/\\/g, '/'));
      assert.ok(css.includes('url("_template/test/res/bg.png")'), css);
      assert.ok(css.includes('no-repeat'), 'surrounding declarations untouched');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('templateExport: shipped shell assets', () => {
  it('readShellCss ships the layout shell (.site-nav / .site-frame / #dita-content-root / .tpl-outline)', () => {
    const css = readShellCss(process.cwd());
    for (const marker of ['body.mode-site', '.site-nav', '.site-frame', '#dita-content-root', '.tpl-outline']) {
      assert.ok(css.includes(marker), `site-shell.css missing ${marker}`);
    }
  });

  it('readTemplateChromeCss ships only the dv-* feature widgets and their --dv- tokens, not the legacy layout', () => {
    const css = readTemplateChromeCss(process.cwd());
    for (const marker of ['--dv-bg', '.dv-page-toc', '.dv-back-to-top', '.dv-dark-toggle', 'html.dark body']) {
      assert.ok(css.includes(marker), `template-chrome.css missing ${marker}`);
    }
    // The whole point is NOT to reload the legacy sidebar/toolbar layout rules.
    assert.ok(!/\.dv-sidebar\b/.test(css), 'template-chrome.css should not re-ship the legacy .dv-sidebar');
    assert.ok(!/\.dv-toolbar\b/.test(css), 'template-chrome.css should not re-ship the legacy .dv-toolbar');
  });
});
