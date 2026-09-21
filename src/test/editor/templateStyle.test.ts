import * as assert from 'assert';
import { join } from 'path';
import { rewriteCssUrls, buildTemplateStyle, templateBodyAttrs } from '../../editor/templateStyle';
import { parseTemplateSelection, withTemplate, pickTemplate } from '../../editor/templateSelection';
import type { SiteTemplate } from '../../editor/siteTemplates';

const dir = join('/tpl', 'red');
const toUri = (p: string) => `vscode-webview://x${p.replace(/\\/g, '/')}`;
const tpl = (over: Partial<SiteTemplate> = {}): SiteTemplate => ({ id: 'red', names: {}, defaultDark: false, css: [join(dir, 'a.css')], dir, builtin: false, ...over });

describe('rewriteCssUrls', () => {
  it('rewrites url() relative to the css file, keeping query/hash', () => {
    const out = rewriteCssUrls('a{background:url(img/x.png?v=2)} @font-face{src:url("fonts/f.ttf#i")}', join(dir, 'a.css'), dir, toUri);
    assert.ok(out.includes('url("vscode-webview://x/tpl/red/img/x.png?v=2")'));
    assert.ok(out.includes('url("vscode-webview://x/tpl/red/fonts/f.ttf#i")'));
  });

  it('resolves against the css file\'s own folder, not the template root', () => {
    const out = rewriteCssUrls('a{background:url(../img/x.png)}', join(dir, 'css', 'a.css'), dir, toUri);
    assert.ok(out.includes('url("vscode-webview://x/tpl/red/img/x.png")'));
  });

  it('blanks anything that escapes the template folder or is external, keeps data: URIs', () => {
    const out = rewriteCssUrls('a{background:url(../../etc/x.png)} b{background:url(https://e.com/x.png)} c{background:url(//e.com/x)} d{background:url(data:image/png;base64,AAA)} e{background:url(/abs/x.png)} f{background:url(file:///x)}', join(dir, 'a.css'), dir, toUri);
    assert.strictEqual((out.match(/url\(""\)/g) ?? []).length, 5);
    assert.ok(out.includes('url("data:image/png;base64,AAA")'));
  });

  it('drops @import', () => {
    const out = rewriteCssUrls('@import url("https://e.com/x.css");\n@import "y.css";\na{color:red}', join(dir, 'a.css'), dir, toUri);
    assert.ok(!out.includes('@import'));
    assert.ok(out.includes('a{color:red}'));
  });
});

describe('buildTemplateStyle', () => {
  it('joins the css files in order and cannot be broken out of with </style>', () => {
    const t = tpl({ css: [join(dir, 'a.css'), join(dir, 'b.css')] });
    const files: Record<string, string> = { [join(dir, 'a.css')]: 'a{x:1}', [join(dir, 'b.css')]: 'b{x:2} /* </style><script>alert(1)</script> */' };
    const html = buildTemplateStyle(t, (p) => files[p], toUri);
    assert.ok(html.indexOf('a{x:1}') < html.indexOf('b{x:2}'));
    assert.ok(!/<\/style>[\s\S]*<script>/i.test(html));
    assert.strictEqual((html.match(/<\/style>/gi) ?? []).length, 1);
  });

  it('skips a css file that can no longer be read', () => {
    const t = tpl({ css: [join(dir, 'gone.css'), join(dir, 'b.css')] });
    const html = buildTemplateStyle(t, (p) => { if (p.endsWith('gone.css')) throw new Error('ENOENT'); return 'b{}'; }, toUri);
    assert.ok(html.includes('b{}'));
  });
});

describe('templateBodyAttrs', () => {
  it('gives a sanitised data-template hook and a dark marker', () => {
    assert.deepStrictEqual(templateBodyAttrs(undefined), { className: '', attrs: '' });
    assert.deepStrictEqual(templateBodyAttrs(tpl({ id: 'a"b c', defaultDark: true })), { className: ' template-dark', attrs: ' data-template="a_b_c"' });
  });
});

describe('template selection', () => {
  it('parses only known modes with non-empty string ids', () => {
    assert.deepStrictEqual(parseTemplateSelection({ site: 'a', book: '', tree: 'x', extra: 1 }), { site: 'a' });
    assert.deepStrictEqual(parseTemplateSelection(null), {});
    assert.deepStrictEqual(parseTemplateSelection([]), {});
  });

  it('sets and clears one mode without touching the other or the input', () => {
    const before = { site: 'a', book: 'b' };
    assert.deepStrictEqual(withTemplate(before, 'site', 'c'), { site: 'c', book: 'b' });
    assert.deepStrictEqual(withTemplate(before, 'book', ''), { site: 'a' });
    assert.deepStrictEqual(before, { site: 'a', book: 'b' });
  });

  it('picks per mode, never in tree mode, and ignores a template that has gone', () => {
    const ts = [tpl({ id: 'a' }), tpl({ id: 'b' })];
    assert.strictEqual(pickTemplate({ site: 'a', book: 'b' }, 'site', ts)?.id, 'a');
    assert.strictEqual(pickTemplate({ site: 'a', book: 'b' }, 'book', ts)?.id, 'b');
    assert.strictEqual(pickTemplate({ site: 'a' }, 'tree', ts), undefined);
    assert.strictEqual(pickTemplate({ site: 'zzz' }, 'site', ts), undefined);
    assert.strictEqual(pickTemplate({}, 'site', ts), undefined);
  });
});
