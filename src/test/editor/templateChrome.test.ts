import * as assert from 'assert';
import { join } from 'path';
import { cssUrlSafe, fillPlaceholders, mapTitleFromXml, renderChrome, renderTemplateFooter, renderTemplateHeader, wrapShell } from '../../editor/templateChrome';
import { discoverTemplates, isSafeLinkHref, parseTemplateJson } from '../../editor/siteTemplates';

const ctx = { title: 'My <Book>', year: 2026 };
const toUri = (p: string) => `vscode-webview://x${p}`;

describe('renderTemplateHeader / renderTemplateFooter', () => {
  it('renders logo, title, tagline and links, escaping every value', () => {
    const html = renderTemplateHeader(
      { logo: '/t/logo.svg', title: '{title} <docs>', tagline: 'v{year} & more', links: [{ label: 'A "quoted" <b>', href: 'https://e.com/?a=1&b=2' }] },
      ctx,
      toUri,
    );
    assert.ok(html.includes('src="vscode-webview://x/t/logo.svg"'));
    assert.ok(html.includes('My &lt;Book&gt; &lt;docs&gt;'));
    assert.ok(html.includes('v2026 &amp; more'));
    assert.ok(html.includes('A "quoted" &lt;b&gt;'));
    assert.ok(html.includes('href="https://e.com/?a=1&amp;b=2"'));
    assert.ok(!html.includes('<b>') && !html.includes('<docs>'));
  });

  it('the title defaults to the map title, and may be blanked with an empty string', () => {
    assert.ok(renderTemplateHeader({ links: [] }, ctx, toUri).includes('My &lt;Book&gt;'));
    assert.ok(!renderTemplateHeader({ title: '', links: [] }, ctx, toUri).includes('tpl-title'));
  });

  it('a banner becomes a background image whose URL cannot break out of the style attribute', () => {
    const html = renderTemplateHeader({ banner: '/t/a"b\')c.svg', links: [] }, ctx, toUri);
    assert.ok(html.includes('tpl-header--banner'));
    const style = /style="([^"]*)"/.exec(html);
    assert.ok(style, 'exactly one well-formed style attribute');
    assert.ok(!/[)'"]/.test(style![1].replace(/^background-image:url\(&quot;/, '').replace(/&quot;\)$/, '')));
  });

  it('the footer renders text and links', () => {
    const html = renderTemplateFooter({ text: '© {year} {title}', links: [{ label: 'Mail', href: 'mailto:a@b.c' }] }, ctx, toUri);
    assert.ok(html.includes('© 2026 My &lt;Book&gt;'));
    assert.ok(html.includes('href="mailto:a@b.c"'));
  });

  it('renderChrome gives nothing without a template, and only the parts a template has', () => {
    assert.deepStrictEqual(renderChrome(undefined, ctx, toUri), {});
    const c = renderChrome({ id: 'x', names: {}, defaultDark: false, css: [], dir: '/t', builtin: false, footer: { links: [] } }, ctx, toUri);
    assert.strictEqual(c.headerHtml, undefined);
    assert.ok(c.footerHtml?.startsWith('<footer'));
  });
});

describe('fillPlaceholders / cssUrlSafe / mapTitleFromXml', () => {
  it('fills only {title} and {year}', () => {
    assert.strictEqual(fillPlaceholders('{title} {year} {other}', ctx), 'My <Book> 2026 {other}');
  });
  it('percent-encodes what could end a css url()', () => {
    assert.strictEqual(cssUrlSafe('a b"c\'d(e)f'), 'a%20b%22c%27d%28e%29f');
  });
  it('takes the bookmap title, then the first title, then the file name', () => {
    assert.strictEqual(mapTitleFromXml('<bookmap><booktitle><mainbooktitle>The <i>Book</i> &amp; Co</mainbooktitle></booktitle></bookmap>', 'a.ditamap'), 'The Book & Co');
    assert.strictEqual(mapTitleFromXml('<map><title>Guide</title></map>', 'a.ditamap'), 'Guide');
    assert.strictEqual(mapTitleFromXml('<map/>', '/x/y/user-guide.ditamap'), 'user-guide');
  });
});

describe('mapTitleFromXml with keyref titles', () => {
  const keys = new Map([['prod', 'Acme Cloud']]);
  const resolve = (k: string) => keys.get(k);

  it('resolves a keyref inside <title> (the template header and the top-left title read this)', () => {
    assert.strictEqual(mapTitleFromXml('<map><title><ph keyref="prod"/></title></map>', 'a.ditamap', resolve), 'Acme Cloud');
    assert.strictEqual(mapTitleFromXml('<map><title>Guide for <ph keyref="prod"/></title></map>', 'a.ditamap', resolve), 'Guide for Acme Cloud');
  });
  it('resolves a keyref on the title element itself', () => {
    assert.strictEqual(mapTitleFromXml('<map><title keyref="prod"/></map>', 'a.ditamap', resolve), 'Acme Cloud');
  });
  it('resolves a keyref in a bookmap main title', () => {
    assert.strictEqual(mapTitleFromXml('<bookmap><booktitle><mainbooktitle keyref="prod"/></booktitle></bookmap>', 'a.ditamap', resolve), 'Acme Cloud');
  });
  it('falls back to the file name when the key does not resolve or no resolver is given', () => {
    assert.strictEqual(mapTitleFromXml('<map><title keyref="nope"/></map>', '/x/guide.ditamap', resolve), 'guide');
    assert.strictEqual(mapTitleFromXml('<map><title keyref="prod"/></map>', '/x/guide.ditamap'), 'guide');
  });
  it('element content wins over the keyref, like the outline heading', () => {
    assert.strictEqual(mapTitleFromXml('<map><title keyref="prod">Own</title></map>', 'a.ditamap', resolve), 'Own');
  });
});

describe('wrapShell', () => {
  const parts = { sidebarHtml: '<nav/>', resizerHtml: '<div r/>', contentRootHtml: '<main/>' };
  it('a page with a sidebar is a column: header, frame (sidebar, resizer, content), footer', () => {
    const r = wrapShell({ ...parts, headerHtml: '<header/>', footerHtml: '<footer/>' });
    assert.strictEqual(r.bodyClass, ' site-shell');
    const at = (s: string) => r.html.indexOf(s);
    assert.ok(at('<header/>') < at('site-frame') && at('site-frame') < at('<nav/>'));
    assert.ok(at('<nav/>') < at('<div r/>') && at('<div r/>') < at('<main/>') && at('<main/>') < at('<footer/>'));
  });
  it('header and footer are optional: without a template the frame stands alone', () => {
    const r = wrapShell(parts);
    assert.strictEqual(r.bodyClass, ' site-shell');
    assert.ok(r.html.includes('site-frame') && r.html.includes('<nav/>') && r.html.includes('<main/>'));
    assert.ok(!r.html.includes('<header') && !r.html.includes('<footer'));
  });
  it('a page without a sidebar stays three plain siblings and gets no shell class or chrome', () => {
    const r = wrapShell({ ...parts, sidebarHtml: '', headerHtml: '<header/>' });
    assert.strictEqual(r.bodyClass, '');
    assert.ok(!r.html.includes('<header/>') && !r.html.includes('site-frame'));
  });
});

describe('template.json header/footer parsing', () => {
  const base = { name: 'T', css: ['a.css'] };
  it('keeps valid links and drops javascript:, data:, file: and relative hrefs with a warning', () => {
    const r = parseTemplateJson(JSON.stringify({ ...base, header: { links: [
      { label: 'ok', href: 'https://e.com' }, { label: 'mail', href: 'mailto:a@b.c' },
      { label: 'js', href: 'javascript:alert(1)' }, { label: 'data', href: 'data:text/html,x' },
      { label: 'file', href: 'file:///etc/passwd' }, { label: 'rel', href: '../x.html' }, { label: '', href: 'https://e.com' },
    ] } }));
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.deepStrictEqual(r.descriptor.header?.links.map((l) => l.label), ['ok', 'mail']);
    assert.strictEqual(r.warnings.length, 5);
  });
  it('caps the number of links and the length of texts', () => {
    const links = Array.from({ length: 12 }, (_v, i) => ({ label: `l${i}`, href: 'https://e.com' }));
    const r = parseTemplateJson(JSON.stringify({ ...base, footer: { text: 'x'.repeat(400), links } }));
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.strictEqual(r.descriptor.footer?.links.length, 8);
    assert.strictEqual(r.descriptor.footer?.text, undefined);
  });
  it('isSafeLinkHref allows only http(s) and mailto without quote or space characters', () => {
    assert.ok(isSafeLinkHref('http://a.b/c?d=1'));
    assert.ok(!isSafeLinkHref('https://a.b/"onmouseover=x'));
    assert.ok(!isSafeLinkHref('https://a.b/ c'));
    assert.ok(!isSafeLinkHref('//a.b'));
  });
});

/**
 * MapRenderStage.shellHtml (MapViewerProvider.ts's generateHtml) is exactly
 * wrapShell(...).html, and it is inserted into the live document with
 * insertAdjacentHTML (applyModeStage, the in-place mode-switch work) rather
 * than assigned through innerHTML on a fresh page load -- insertAdjacentHTML
 * silently drops any <script> tag in the string instead of running or even
 * erroring on it. wrapShell itself is plain concatenation, so a stray
 * <script> could only get into its output through one of the pieces it
 * assembles -- the parts most likely to vary (and so most likely to grow one
 * by accident later) are a template's own header/footer, which is exactly
 * what renderChrome/renderTemplateHeader/renderTemplateFooter build. This
 * tripwire renders every built-in template's chrome for real, through the
 * actual assembly function that produces shellHtml, and fails loudly if a
 * <script> tag ever ends up in it -- catching in a test run what a webview's
 * CSP would otherwise only fail at silently, with no error anywhere.
 */
describe('wrapShell output never contains a <script> tag (in-place mode-switch tripwire)', () => {
  const root = join(process.cwd(), 'media', 'templates');
  const { templates, diagnostics } = discoverTemplates([{ dir: root, builtin: true }]);

  it('loads the built-in templates cleanly (precondition for the checks below)', () => {
    assert.deepStrictEqual(diagnostics, []);
    assert.ok(templates.length > 0);
  });

  it('every built-in template\'s rendered header/footer is free of <script>', () => {
    for (const t of templates) {
      const { headerHtml, footerHtml } = renderChrome(t, ctx, toUri);
      assert.ok(!/<script[\s>]/i.test(headerHtml ?? ''), `${t.id} header contains <script>`);
      assert.ok(!/<script[\s>]/i.test(footerHtml ?? ''), `${t.id} footer contains <script>`);
    }
  });

  it('wrapShell\'s assembled html is free of <script>, with or without a sidebar, for every built-in template', () => {
    const sidebarHtml = '<nav class="site-nav">...</nav>';
    const resizerHtml = '<div class="site-nav-resizer"></div>';
    const contentRootHtml = '<div id="dita-content-root" class="site-main">...</div>';
    for (const t of templates) {
      const { headerHtml, footerHtml } = renderChrome(t, ctx, toUri);
      const withSidebar = wrapShell({ sidebarHtml, resizerHtml, contentRootHtml, headerHtml, footerHtml });
      const withoutSidebar = wrapShell({ sidebarHtml: '', resizerHtml: '', contentRootHtml, headerHtml, footerHtml });
      assert.ok(!/<script[\s>]/i.test(withSidebar.html), `${t.id} shell (with sidebar) contains <script>`);
      assert.ok(!/<script[\s>]/i.test(withoutSidebar.html), `${t.id} shell (without sidebar) contains <script>`);
    }
  });

  it('a hostile title/tagline/text containing a literal <script> tag is escaped, not passed through', () => {
    const hostileCtx = { title: '<script>alert(1)</script>', year: 2026 };
    const header = renderTemplateHeader({ title: '{title}', tagline: undefined, links: [] }, hostileCtx, toUri);
    const footer = renderTemplateFooter({ text: '{title}', links: [] }, hostileCtx, toUri);
    assert.ok(!/<script[\s>]/i.test(header));
    assert.ok(!/<script[\s>]/i.test(footer));
    const shell = wrapShell({ sidebarHtml: '', resizerHtml: '', contentRootHtml: '<div></div>', headerHtml: header, footerHtml: footer });
    assert.ok(!/<script[\s>]/i.test(shell.html));
  });
});
