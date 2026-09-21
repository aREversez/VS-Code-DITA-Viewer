import * as assert from 'assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { discoverTemplates, parseTemplateJson, parseTemplateOpt, resolveInside, templateDisplayName } from '../../editor/siteTemplates';

const OPT = `<?xml version="1.0" encoding="UTF-8"?>
<publishing-template>
  <name>Sample &amp; Red</name>
  <webhelp>
    <tags>
      <tag type="layout">tiles</tag>
      <tag type="color">red</tag>
      <tag type="color">dark</tag>
    </tags>
    <preview-image file="thumb.png"/>
    <online-preview-url>https://example.com/</online-preview-url>
    <!-- <css file="commented-out.css"/> -->
    <resources>
      <css file="main.css"/>
      <css file="notes.css"/>
      <fileset><include name="resources/**/*"/></fileset>
    </resources>
    <parameters>
      <parameter name="webhelp.show.main.page.tiles" value="yes"/>
    </parameters>
  </webhelp>
</publishing-template>`;

describe('parseTemplateOpt', () => {
  it('reads name, tags, preview image and the css list in order, ignoring comments and parameters', () => {
    const r = parseTemplateOpt(OPT);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.strictEqual(r.descriptor.names[''], 'Sample & Red');
    assert.strictEqual(r.descriptor.layout, 'tiles');
    assert.strictEqual(r.descriptor.defaultDark, true);
    assert.deepStrictEqual(r.descriptor.css, ['main.css', 'notes.css']);
    assert.strictEqual(r.descriptor.thumbnail, 'thumb.png');
  });

  it('a light template is not dark', () => {
    const r = parseTemplateOpt('<publishing-template><webhelp><tags><tag type="color">light</tag></tags><resources><css file="a.css"/></resources></webhelp></publishing-template>');
    assert.ok(r.ok && !r.descriptor.defaultDark);
  });

  it('rejects other XML and a template without css', () => {
    assert.strictEqual(parseTemplateOpt('<foo/>').ok, false);
    assert.strictEqual(parseTemplateOpt('<publishing-template><name>x</name></publishing-template>').ok, false);
  });
});

describe('parseTemplateJson', () => {
  it('accepts a plain or per-language name and requires css', () => {
    const a = parseTemplateJson('{"name":"A","css":["a.css"]}');
    assert.ok(a.ok && a.descriptor.names[''] === 'A');
    const b = parseTemplateJson('{"name":{"en":"A","zh-CN":"甲"},"css":["a.css"],"defaultDark":true,"layout":"topbar"}');
    assert.ok(b.ok && b.descriptor.names['zh-cn'] === '甲' && b.descriptor.defaultDark && b.descriptor.layout === 'topbar');
    assert.strictEqual(parseTemplateJson('{"name":"A"}').ok, false);
    assert.strictEqual(parseTemplateJson('{"name":"A","css":[]}').ok, false);
    assert.strictEqual(parseTemplateJson('not json').ok, false);
    assert.strictEqual(parseTemplateJson('[]').ok, false);
  });
});

describe('resolveInside', () => {
  it('keeps paths inside the folder and rejects escapes and absolute paths', () => {
    const dir = join(tmpdir(), 'tpl');
    assert.strictEqual(resolveInside(dir, 'a.css'), join(dir, 'a.css'));
    assert.strictEqual(resolveInside(dir, 'res/x/../a.css'), join(dir, 'res', 'a.css'));
    assert.strictEqual(resolveInside(dir, '../a.css'), undefined);
    assert.strictEqual(resolveInside(dir, 'res/../../a.css'), undefined);
    assert.strictEqual(resolveInside(dir, dir), undefined);
    assert.strictEqual(resolveInside(dir, ''), undefined);
    assert.strictEqual(resolveInside(dir, '.'), undefined);
  });
});

describe('discoverTemplates', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'tplroot-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  const put = (root: string, rel: string, text: string) => {
    const p = join(root, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, text);
  };

  it('finds json and .opt templates, one per sub-folder, and skips folders without a descriptor', () => {
    const root = join(tmp, 'r');
    put(root, 'one/template.json', '{"name":"One","css":["one.css"]}');
    put(root, 'one/one.css', 'a{}');
    put(root, 'two/two.opt', OPT);
    put(root, 'two/main.css', 'a{}');
    put(root, 'two/notes.css', 'a{}');
    put(root, 'two/thumb.png', 'x');
    put(root, 'plain/readme.txt', 'not a template');
    put(root, 'stray-file.txt', 'x');
    const { templates, diagnostics } = discoverTemplates([{ dir: root, builtin: false }]);
    assert.deepStrictEqual(templates.map((t) => t.id), ['one', 'two']);
    const two = templates[1];
    assert.strictEqual(two.css.length, 2);
    assert.ok(two.thumbnail && two.thumbnail.endsWith('thumb.png'));
    assert.strictEqual(two.defaultDark, true);
    assert.deepStrictEqual(diagnostics, []);
  });

  it('drops missing and escaping files with a diagnostic, and skips a template left with no css', () => {
    const root = join(tmp, 'r');
    put(root, 'a/template.json', '{"name":"A","css":["a.css","missing.css","../secret.css"],"header":"nope.html"}');
    put(root, 'a/a.css', 'a{}');
    put(root, 'b/template.json', '{"name":"B","css":["../secret.css"]}');
    put(root, 'secret.css', 'x');
    const { templates, diagnostics } = discoverTemplates([{ dir: root, builtin: false }]);
    assert.deepStrictEqual(templates.map((t) => t.id), ['a']);
    assert.strictEqual(templates[0].css.length, 1);
    assert.strictEqual(templates[0].header, undefined);
    assert.ok(diagnostics.some((d) => d.message.includes('missing.css')));
    assert.ok(diagnostics.some((d) => d.message.includes('outside the template folder')));
    assert.ok(diagnostics.some((d) => d.message.includes('template skipped')));
  });

  it('reports a broken descriptor and keeps going', () => {
    const root = join(tmp, 'r');
    put(root, 'bad/template.json', '{oops');
    put(root, 'ok/template.json', '{"name":"Ok","css":["o.css"]}');
    put(root, 'ok/o.css', 'a{}');
    const { templates, diagnostics } = discoverTemplates([{ dir: root, builtin: false }]);
    assert.deepStrictEqual(templates.map((t) => t.id), ['ok']);
    assert.strictEqual(diagnostics.length, 1);
  });

  it('template.json wins over an .opt in the same folder', () => {
    const root = join(tmp, 'r');
    put(root, 'x/template.json', '{"name":"FromJson","css":["j.css"]}');
    put(root, 'x/j.css', 'a{}');
    put(root, 'x/x.opt', OPT);
    put(root, 'x/main.css', 'a{}');
    const { templates } = discoverTemplates([{ dir: root, builtin: false }]);
    assert.strictEqual(templateDisplayName(templates[0], 'en'), 'FromJson');
  });

  it('a later root overrides an earlier template of the same id, and says so', () => {
    const builtin = join(tmp, 'b');
    const user = join(tmp, 'u');
    put(builtin, 'same/template.json', '{"name":"Built-in","css":["a.css"]}');
    put(builtin, 'same/a.css', 'a{}');
    put(user, 'same/template.json', '{"name":"Mine","css":["a.css"]}');
    put(user, 'same/a.css', 'a{}');
    const { templates, diagnostics } = discoverTemplates([{ dir: builtin, builtin: true }, { dir: user, builtin: false }]);
    assert.strictEqual(templates.length, 1);
    assert.strictEqual(templates[0].names[''], 'Mine');
    assert.strictEqual(templates[0].builtin, false);
    assert.ok(diagnostics.some((d) => d.message.includes('replaces')));
  });

  it('a missing root is not an error', () => {
    assert.deepStrictEqual(discoverTemplates([{ dir: join(tmp, 'nope'), builtin: false }]), { templates: [], diagnostics: [] });
  });
});

describe('templateDisplayName', () => {
  it('prefers the exact language, then the base language, then the neutral name, then the id', () => {
    const t = { id: 'x', names: { '': 'Neutral', 'zh-cn': '甲', en: 'Eng' } } as never;
    assert.strictEqual(templateDisplayName(t, 'zh-CN'), '甲');
    assert.strictEqual(templateDisplayName(t, 'en-US'), 'Eng');
    assert.strictEqual(templateDisplayName(t, 'fr'), 'Neutral');
    assert.strictEqual(templateDisplayName({ id: 'x', names: {} } as never, 'fr'), 'x');
  });
});

describe('the templates shipped in the repository', () => {
  const root = process.cwd();

  it('built-in templates all load without diagnostics, each with usable css', () => {
    const { templates, diagnostics } = discoverTemplates([{ dir: join(root, 'media', 'templates'), builtin: true }]);
    assert.deepStrictEqual(diagnostics, []);
    assert.ok(templates.some((t) => t.id === 'classic-docs'));
    for (const t of templates) assert.ok(t.css.length > 0 && templateDisplayName(t, 'en') !== t.id, t.id);
  });

  it('the manual-test samples load, including the one described by an .opt', () => {
    const { templates, diagnostics } = discoverTemplates([{ dir: join(root, 'test-dita-file', 'manual', 'templates'), builtin: false }]);
    assert.deepStrictEqual(diagnostics, []);
    const opt = templates.find((t) => t.id === 'sample-opt');
    assert.ok(opt);
    assert.strictEqual(opt?.names[''], 'Sample (.opt)');
  });
});
