import assert from 'node:assert/strict';
import { renderTopicXml } from '../../editor/ditaRenderUtils';

// M2-9: align body-content class names with the org.dita.html5 output scheme the
// WebHelp templates key on. Ground truth is the project's own real-DITA-OT fixture
// in siteChromeContent.test.ts (REAL_TOPIC_BODY): titles carry `title topictitleN`
// / `title sectiontitle`, notes carry `{type} note_{type}` + `.note__title` +
// `.note__body`, plain paragraphs carry `p`. Everything here is ADDITIVE (plan §2.4:
// only add classes, never remove) -- the existing own-mode classes (note--x,
// note__label) stay so the 7 built-in templates and diff/export are untouched.

const render = (xml: string, headingLevel = 1) =>
  renderTopicXml({
    xml,
    docDir: process.cwd(),
    keyMap: new Map(),
    asWebviewUri: (p) => p,
    headingLevel,
    uiLanguage: 'en',
  }).html;

describe('body content carries org.dita.html5 class names (additive)', () => {
  it('topic title carries title + topictitle{level}', () => {
    const html = render(`<topic id="t1"><title>Root</title><body><p>x</p></body></topic>`);
    assert.ok(html.includes('class="title topictitle1"'), html);
  });

  it('nested-topic title bumps the topictitle number with heading level', () => {
    const html = render(`<topic id="t1"><title>Root</title><body><p>x</p></body></topic>`, 3);
    assert.ok(html.includes('class="title topictitle3"'), html);
  });

  it('section title carries title + sectiontitle (not topictitle)', () => {
    const html = render(
      `<topic id="t1"><title>Root</title><body><section id="s"><title>Sec</title><p>x</p></section></body></topic>`,
    );
    assert.ok(html.includes('class="title sectiontitle"'), html);
    assert.ok(html.includes('<section'), html);
    assert.ok(html.includes('class="section"'), html);
  });

  it('example title carries title + sectiontitle', () => {
    const html = render(
      `<topic id="t1"><title>Root</title><body><example id="e"><title>Ex</title><p>x</p></example></body></topic>`,
    );
    assert.ok(html.includes('class="title sectiontitle"'), html);
  });

  it('plain paragraph carries class p', () => {
    const html = render(`<topic id="t1"><title>R</title><body><p>hello</p></body></topic>`);
    assert.ok(html.includes('class="p"'), html);
  });

  it('note keeps own classes and adds html5 type class, note__title and note__body', () => {
    const html = render(
      `<topic id="t1"><title>R</title><body><note type="warning">careful</note></body></topic>`,
    );
    // own-mode classes preserved (never removed)
    assert.ok(html.includes('note--warning'), html);
    assert.ok(html.includes('note__label'), html);
    // html5 target classes added
    assert.ok(html.includes('note_warning'), html);
    assert.ok(/class="[^"]*\bwarning\b[^"]*"/.test(html), 'bare type token present');
    assert.ok(html.includes('note__title'), html);
    assert.ok(html.includes('<div class="note__body">'), html);
  });

  it('note of default type still gets note_note and note__body', () => {
    const html = render(`<topic id="t1"><title>R</title><body><note>plain</note></body></topic>`);
    assert.ok(html.includes('note_note'), html);
    assert.ok(html.includes('<div class="note__body">'), html);
  });

  it('figure carries class fig', () => {
    const html = render(
      `<topic id="t1"><title>R</title><body><fig id="f"><title>FT</title><p>x</p></fig></body></topic>`,
    );
    assert.ok(html.includes('class="fig"'), html);
  });

  it('list, image, table and code content carry the org.dita.html5 region classes', () => {
    const html = render(
      `<topic id="t1"><title>R</title><body>` +
        `<ul><li>a</li></ul><ol><li>b</li></ol>` +
        `<image href="a.png" placement="break"/>` +
        `<table><tgroup><thead><row><entry>h</entry></row></thead><tbody><row><entry>c</entry></row></tbody></tgroup></table>` +
        `<codeblock>x=1</codeblock>` +
        `</body></topic>`,
    );
    assert.ok(html.includes('class="ul"'), html);
    assert.ok(html.includes('class="li"'), html);
    assert.ok(html.includes('class="ol"'), html);
    assert.ok(/<img[^>]*class="image\b/.test(html), 'image class');
    assert.ok(html.includes('class="table cals-table'), html);
    assert.ok(html.includes('class="thead"'), html);
    assert.ok(html.includes('class="tbody"'), html);
    assert.ok(html.includes('class="row"'), html);
    assert.ok(/<t[hd][^>]*class="entry"/.test(html), 'entry class');
    assert.ok(html.includes('class="pre codeblock'), html);
  });
});

// Body-class table (scripts/webhelp-body-class-diff.md, corrected against the
// org.dita.html5 XSLT): with args.html5.classattr=yes the class is the DITA @class
// ancestor chain (module prefix dropped) plus a few hard-coded default tokens.
// Still additive: our own tokens (simple-list, body-div, ...) stay.
describe('body content carries the html5 ancestor-chain tokens (additive)', () => {
  const body = (inner: string): string => render(`<topic id="t1"><title>R</title><body>${inner}</body></topic>`);
  const tokens = (html: string, tag: string): string[] => {
    const m = new RegExp(`<${tag}\\b[^>]*\\bclass="([^"]*)"`).exec(html);
    return m ? m[1].split(/\s+/) : [];
  };

  it('highlight-domain elements are ph specialisations: ph + their own name', () => {
    const cases: Array<[string, string, string]> = [
      ['b', 'strong', 'b'], ['i', 'em', 'i'], ['u', 'u', 'u'], ['tt', 'code', 'tt'],
      ['sup', 'sup', 'sup'], ['sub', 'sub', 'sub'], ['line-through', 's', 'line-through'],
    ];
    for (const [el, tag, name] of cases) {
      const html = body(`<p><${el}>x</${el}></p>`);
      const t = tokens(html, tag);
      assert.ok(t.includes('ph') && t.includes(name), `${el}: ${html}`);
    }
  });

  it('dl family: dl, dt dlterm, dd, plus the existing dlentry', () => {
    const html = body(`<dl><dlentry><dt>t</dt><dd>d</dd></dlentry></dl>`);
    assert.deepStrictEqual(tokens(html, 'dl'), ['dl']);
    assert.deepStrictEqual(tokens(html, 'dt'), ['dt', 'dlterm']);
    assert.deepStrictEqual(tokens(html, 'dd'), ['dd']);
    assert.ok(html.includes('class="dlentry"'), html);
  });

  it('q, lq and cite carry their own name', () => {
    const html = body(`<p><q>a</q><cite>c</cite></p><lq>b</lq>`);
    assert.deepStrictEqual(tokens(html, 'q'), ['q']);
    assert.deepStrictEqual(tokens(html, 'cite'), ['cite']);
    assert.deepStrictEqual(tokens(html, 'blockquote'), ['lq']);
  });

  it('msgblock is a pre specialisation: pre msgblock', () => {
    assert.deepStrictEqual(tokens(body(`<msgblock>m</msgblock>`), 'pre'), ['pre', 'msgblock']);
  });

  it('synblk is a figgroup specialisation, not a pre one', () => {
    const html = body(`<synblk>s</synblk>`);
    // element stays <pre> to keep whitespace; the class must not claim the pre family
    const t = tokens(html, 'pre');
    assert.deepStrictEqual(t, ['figgroup', 'synblk'], html);
  });

  it('sl / sli / simpletable family keep own tokens and gain the html5 ones', () => {
    const html = body(
      `<sl><sli>a</sli></sl>` +
        `<simpletable><sthead><stentry>h</stentry></sthead><strow><stentry>c</stentry></strow></simpletable>`,
    );
    const ul = tokens(html, 'ul');
    assert.ok(ul.includes('simple-list') && ul.includes('sl'), html);
    const li = tokens(html, 'li');
    assert.ok(li.includes('li') && li.includes('sli'), html);
    const table = tokens(html, 'table');
    assert.ok(table.includes('simple-table') && table.includes('simpletable'), html);
    assert.ok(/<thead[^>]*class="[^"]*\bsthead\b/.test(html), html);
    assert.ok(/<tr[^>]*class="[^"]*\bstrow\b/.test(html), html);
    assert.ok(/<th[^>]*class="[^"]*\bstentry\b/.test(html), html);
    assert.ok(/<td[^>]*class="[^"]*\bstentry\b/.test(html), html);
  });

  it('div / bodydiv / sectiondiv / object keep own tokens and gain the html5 one', () => {
    const html = body(
      `<div>a</div><section><sectiondiv>b</sectiondiv></section><bodydiv>c</bodydiv>` +
        `<object data="x.swf"><param name="n" value="v"/></object>`,
    );
    assert.ok(/class="body-div div"/.test(html), html);
    assert.ok(/class="section-div sectiondiv"/.test(html), html);
    assert.ok(/class="body-div bodydiv"/.test(html), html);
    assert.ok(/<object[^>]*class="dita-object object"/.test(html), html);
  });

  it('the span.ph from a real <ph> is unchanged', () => {
    const html = body(`<p><ph>x</ph></p>`);
    assert.ok(/<span[^>]*class="ph"[^>]*>x<\/span>/.test(html), html);
  });
});
