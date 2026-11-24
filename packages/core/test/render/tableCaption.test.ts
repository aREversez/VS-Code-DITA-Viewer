import * as assert from 'assert';
import { parseDita, preprocessEntities } from '../../src/parser/ditaParser';
import { renderDocument, RenderContext } from '../../src/render/renderer';

const ctx: RenderContext = {
  headingLevel: 1,
  asWebviewUri: (p: string) => p,
  documentDir: '/test',
};

function render(body: string): string {
  const doc = parseDita(preprocessEntities(`<topic id="t"><title>T</title><body>${body}</body></topic>`));
  return renderDocument(doc.root, ctx);
}

// A heading element directly inside <table> is not valid table content: the
// HTML parser foster-parents it out in front of the table, so the "title"
// became a full-size <h1> with its own margins and rule, detached from the
// table by a wide gap, and the table could not be numbered. A table title is
// a <caption>, which is also the only element that can carry "Table N".
describe('table titles render as a caption', () => {
  it('a CALS table title is a <caption class="title tabletitle"> inside the table, not a heading', () => {
    const html = render(
      '<table><title>Torque</title><tgroup cols="1"><tbody><row><entry>x</entry></row></tbody></tgroup></table>',
    );
    const table = /<table\b[\s\S]*<\/table>/.exec(html)![0];
    assert.ok(/<caption\b[^>]*class="title tabletitle"[^>]*>Torque<\/caption>/.test(table), table);
    assert.ok(!/<h[1-6]\b/.test(table), `no heading inside the table, got: ${table}`);
  });

  it('a simpletable title is a caption too', () => {
    const html = render('<simpletable><title>Sizes</title><strow><stentry>y</stentry></strow></simpletable>');
    const table = /<table\b[\s\S]*<\/table>/.exec(html)![0];
    assert.ok(/<caption\b[^>]*class="title tabletitle"[^>]*>Sizes<\/caption>/.test(table), table);
    assert.ok(!/<h[1-6]\b/.test(table), table);
  });

  it('the caption is the first child of the table, the only slot a browser keeps', () => {
    const html = render(
      '<table><title>Torque</title><tgroup cols="1"><tbody><row><entry>x</entry></row></tbody></tgroup></table>',
    );
    assert.ok(/<table\b[^>]*>\s*<caption\b/.test(html), html);
  });

  it('topic and section titles are still headings', () => {
    const html = render('<section><title>Setup</title><p>x</p></section>');
    assert.ok(/<h1\b[^>]*class="title topictitle1"[^>]*>T<\/h1>/.test(html), html);
    assert.ok(/<h2\b[^>]*class="title sectiontitle"[^>]*>Setup<\/h2>/.test(html), html);
  });

  it('a table without a title gets no caption', () => {
    const html = render('<table><tgroup cols="1"><tbody><row><entry>x</entry></row></tbody></tgroup></table>');
    assert.ok(!html.includes('<caption'), html);
  });
});

// The "Figure "/"Table " label words are chosen by :lang(), and the host page
// declares one fixed language, so the topic has to carry its own.
describe('topic language', () => {
  it('<article> carries lang from xml:lang', () => {
    const doc = parseDita(preprocessEntities('<topic id="t" xml:lang="zh-CN"><title>T</title><body/></topic>'));
    assert.ok(/<article\b[^>]*\blang="zh-CN"/.test(renderDocument(doc.root, ctx)));
  });

  it('no xml:lang, no lang attribute', () => {
    assert.ok(!/<article\b[^>]*\blang=/.test(render('<p>x</p>')));
  });
});
