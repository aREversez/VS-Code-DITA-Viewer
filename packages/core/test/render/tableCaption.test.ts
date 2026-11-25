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

  // The CSS counter bumps on every caption, so an empty one would print a bare
  // "Table 2. " and shift every number after it.
  it('an empty, whitespace-only or comment-only title gets no caption either', () => {
    for (const title of ['<title/>', '<title></title>', '<title>  \n </title>', '<title><!-- later --></title>']) {
      const cals = render(`<table>${title}<tgroup cols="1"><tbody><row><entry>x</entry></row></tbody></tgroup></table>`);
      assert.ok(!cals.includes('<caption'), `${title}: ${cals}`);
      const simple = render(`<simpletable>${title}<strow><stentry>y</stentry></strow></simpletable>`);
      assert.ok(!simple.includes('<caption'), `${title}: ${simple}`);
    }
  });

  it('a title that holds only an element still gets its caption', () => {
    const html = render(
      '<table><title><ph>Torque</ph></title><tgroup cols="1"><tbody><row><entry>x</entry></row></tbody></tgroup></table>',
    );
    assert.ok(/<caption\b[^>]*>[\s\S]*Torque[\s\S]*<\/caption>/.test(html), html);
  });
});

// org.dita.html5 puts a table's <desc> in its <caption>. As a <span> directly
// under <table> the HTML parser lifts it out in front of the table, above the
// caption, away from what it describes.
describe('a table desc lives in the caption', () => {
  const CALS = (head: string) => `<table>${head}<tgroup cols="1"><tbody><row><entry>x</entry></row></tbody></tgroup></table>`;
  const outsideCaption = (table: string) => table.replace(/<caption\b[\s\S]*?<\/caption>/, '');

  it('a titled table puts its desc inside the title caption, after the title', () => {
    const html = render(CALS('<title>Torque</title><desc>At 20 C</desc>'));
    const table = /<table\b[\s\S]*<\/table>/.exec(html)![0];
    assert.ok(
      /<caption\b[^>]*class="title tabletitle"[^>]*>Torque <span\b[^>]*class="desc"[^>]*>At 20 C<\/span><\/caption>/.test(table),
      table,
    );
    assert.ok(!/class="desc"/.test(outsideCaption(table)), `no desc left directly in the table: ${table}`);
    assert.ok(/<table\b[^>]*>\s*<caption\b/.test(table), 'and the caption is still the first child');
  });

  it('a simpletable does the same', () => {
    const html = render('<simpletable><title>Sizes</title><desc>In mm</desc><strow><stentry>y</stentry></strow></simpletable>');
    const table = /<table\b[\s\S]*<\/table>/.exec(html)![0];
    assert.ok(/<caption\b[^>]*tabletitle[^>]*>Sizes <span\b[^>]*class="desc"[^>]*>In mm<\/span><\/caption>/.test(table), table);
  });

  it('a desc with no title gets a caption of its own that is not a tabletitle, so it is never numbered', () => {
    const table = /<table\b[\s\S]*<\/table>/.exec(render(CALS('<desc>At 20 C</desc>')))![0];
    assert.ok(/<caption\b[^>]*class="tabledesc"[^>]*>\s*<span\b[^>]*class="desc"[^>]*>At 20 C<\/span><\/caption>/.test(table), table);
    assert.ok(!/tabletitle/.test(table), table);
    assert.ok(!/class="desc"/.test(outsideCaption(table)), table);
  });

  it('an empty desc is dropped; an empty title still yields no tabletitle', () => {
    const empty = /<table\b[\s\S]*<\/table>/.exec(render(CALS('<title>Torque</title><desc>  </desc>')))![0];
    assert.ok(!/class="desc"/.test(empty), empty);
    assert.ok(/<caption\b[^>]*tabletitle[^>]*>Torque<\/caption>/.test(empty), empty);
    const noTitle = /<table\b[\s\S]*<\/table>/.exec(render(CALS('<title/><desc>At 20 C</desc>')))![0];
    assert.ok(!/tabletitle/.test(noTitle) && /tabledesc/.test(noTitle), noTitle);
  });

  it('a table nested in a cell keeps its own caption and desc apart from its parent\'s', () => {
    const inner = '<table><title>Inner</title><desc>inner desc</desc><tgroup cols="1"><tbody><row><entry>y</entry></row></tbody></tgroup></table>';
    const html = render(
      `<table><title>Outer</title><desc>outer desc</desc><tgroup cols="1"><tbody><row><entry>${inner}</entry></row></tbody></tgroup></table>`,
    );
    assert.ok(/<caption\b[^>]*>Outer <span\b[^>]*>outer desc<\/span><\/caption>/.test(html), html);
    assert.ok(/<caption\b[^>]*>Inner <span\b[^>]*>inner desc<\/span><\/caption>/.test(html), html);
  });

  it('a table without a desc renders exactly as before', () => {
    const table = /<table\b[\s\S]*<\/table>/.exec(render(CALS('<title>Torque</title>')))![0];
    assert.ok(/<caption\b[^>]*tabletitle[^>]*>Torque<\/caption>/.test(table), table);
  });
});

describe('figure titles', () => {
  it('a fig with an empty or whitespace-only title gets no figcaption', () => {
    for (const title of ['<title/>', '<title>   </title>', '<title><!-- later --></title>']) {
      const html = render(`<fig>${title}<image href="a.png"/></fig>`);
      assert.ok(html.includes('<figure'), html);
      assert.ok(!html.includes('<figcaption'), `${title}: ${html}`);
    }
  });

  it('a fig with a titled caption still gets one', () => {
    const html = render('<fig><title>Layout</title><image href="a.png"/></fig>');
    assert.ok(/<figcaption>Layout<\/figcaption>/.test(html), html);
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
