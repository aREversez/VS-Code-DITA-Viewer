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
