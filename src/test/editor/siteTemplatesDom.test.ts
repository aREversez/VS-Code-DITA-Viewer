import * as assert from 'assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { discoverTemplates, parseTemplateJson, parseTemplateOpt } from '../../editor/siteTemplates';

// Route B step 1: the template descriptor says which DOM its css was written
// for ('own' = this extension's DOM, 'webhelp' = the WebHelp-style class
// contract), and an .opt also names a logo and favicon. Every fixture here is
// written for this test; none is taken from any third-party template.

const OPT_FULL = `<?xml version="1.0" encoding="UTF-8"?>
<publishing-template>
  <name>Fixture</name>
  <description>A fixture &amp; nothing more</description>
  <webhelp>
    <resources>
      <css file="a.css"/>
      <logo file="img/logo.png"/>
      <favicon file="img/fav.png"/>
    </resources>
  </webhelp>
  <pdf>
    <resources>
      <css file="pdf.css"/>
      <logo file="img/pdf-logo.png"/>
    </resources>
  </pdf>
</publishing-template>`;

const JSON_BASE = { name: 'x', css: ['a.css'] };

describe('template descriptor: dom', () => {
  it('an .opt descriptor defaults to the webhelp DOM', () => {
    const r = parseTemplateOpt(OPT_FULL);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.strictEqual(r.descriptor.dom, 'webhelp');
  });

  it('template.json defaults to our own DOM', () => {
    const r = parseTemplateJson(JSON.stringify(JSON_BASE));
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.strictEqual(r.descriptor.dom, 'own');
  });

  it('template.json can opt in to the webhelp DOM, or say "own" explicitly', () => {
    const web = parseTemplateJson(JSON.stringify({ ...JSON_BASE, dom: 'webhelp' }));
    const own = parseTemplateJson(JSON.stringify({ ...JSON_BASE, dom: 'own' }));
    assert.ok(web.ok && own.ok);
    if (!web.ok || !own.ok) return;
    assert.strictEqual(web.descriptor.dom, 'webhelp');
    assert.strictEqual(own.descriptor.dom, 'own');
  });

  it('an unknown dom value falls back to own and says so', () => {
    const r = parseTemplateJson(JSON.stringify({ ...JSON_BASE, dom: 'bootstrap' }));
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.strictEqual(r.descriptor.dom, 'own');
    assert.ok(r.warnings.some((w) => /dom/.test(w)), r.warnings.join('|'));
  });
});

describe('.opt logo, favicon and description', () => {
  it('reads <description> and the webhelp section\'s <logo> and <favicon>', () => {
    const r = parseTemplateOpt(OPT_FULL);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.strictEqual(r.descriptor.description, 'A fixture & nothing more');
    assert.strictEqual(r.descriptor.logo, 'img/logo.png');
    assert.strictEqual(r.descriptor.favicon, 'img/fav.png');
  });

  it('does not pick up a logo that only the <pdf> section names', () => {
    const r = parseTemplateOpt(
      '<publishing-template><webhelp><resources><css file="a.css"/></resources></webhelp>' +
        '<pdf><resources><logo file="pdf-logo.png"/></resources></pdf></publishing-template>',
    );
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.strictEqual(r.descriptor.logo, undefined);
  });

  it('logo and favicon are absent when the descriptor names none', () => {
    const r = parseTemplateOpt('<publishing-template><webhelp><resources><css file="a.css"/></resources></webhelp></publishing-template>');
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.strictEqual(r.descriptor.logo, undefined);
    assert.strictEqual(r.descriptor.favicon, undefined);
    assert.strictEqual(r.descriptor.description, undefined);
  });
});

describe('discoverTemplates: dom, logo and favicon', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'tpldom-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  function put(rel: string, text = ''): void {
    const p = join(root, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, text);
  }

  it('resolves an .opt template\'s logo and favicon to absolute paths inside its folder', () => {
    put('t/t.opt', OPT_FULL);
    put('t/a.css', 'x{}');
    put('t/pdf.css', 'x{}');
    put('t/img/logo.png');
    put('t/img/fav.png');
    const { templates, diagnostics } = discoverTemplates([{ dir: root, builtin: false }]);
    assert.deepStrictEqual(diagnostics, []);
    const t = templates[0];
    assert.strictEqual(t.dom, 'webhelp');
    assert.strictEqual(t.logo, join(root, 't', 'img', 'logo.png'));
    assert.strictEqual(t.favicon, join(root, 't', 'img', 'fav.png'));
  });

  it('drops a missing logo with a diagnostic instead of skipping the template', () => {
    put('t/t.opt', OPT_FULL);
    put('t/a.css', 'x{}');
    const { templates, diagnostics } = discoverTemplates([{ dir: root, builtin: false }]);
    assert.strictEqual(templates.length, 1);
    assert.strictEqual(templates[0].logo, undefined);
    assert.ok(diagnostics.some((d) => /logo/.test(d.message)), JSON.stringify(diagnostics));
  });

  it('refuses a logo that escapes the template folder', () => {
    put('t/t.opt', OPT_FULL.replace('img/logo.png', '../outside.png'));
    put('t/a.css', 'x{}');
    put('outside.png');
    const { templates, diagnostics } = discoverTemplates([{ dir: root, builtin: false }]);
    assert.strictEqual(templates[0].logo, undefined);
    assert.ok(diagnostics.some((d) => /outside the template folder/.test(d.message)), JSON.stringify(diagnostics));
  });

  it('template.json with dom "own" keeps our DOM even next to an .opt', () => {
    put('t/template.json', JSON.stringify({ ...JSON_BASE, dom: 'own' }));
    put('t/t.opt', OPT_FULL);
    put('t/a.css', 'x{}');
    const { templates } = discoverTemplates([{ dir: root, builtin: false }]);
    assert.strictEqual(templates[0].dom, 'own');
  });

  it('every built-in template keeps our own DOM', () => {
    const { templates } = discoverTemplates([{ dir: join(__dirname, '..', '..', '..', 'media', 'templates'), builtin: true }]);
    assert.ok(templates.length >= 7, `found ${templates.length}`);
    for (const t of templates) assert.strictEqual(t.dom, 'own', t.id);
  });
});
