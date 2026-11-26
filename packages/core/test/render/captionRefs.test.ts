import * as assert from 'assert';
import { parseDita, preprocessEntities } from '../../src/parser/ditaParser';
import { DitaNode } from '../../src/parser/domTypes';
import { renderDocument, RenderContext } from '../../src/render/renderer';

// A caption title pulled in by conref/conkeyref/keyref is empty in the SOURCE
// (the reference fires during dispatch, not before it), so the fig/table
// renderers must judge the title by what it renders, not by its source
// children. Judging the source dropped fig/imagemap captions outright and gave
// a titled-plus-desc table two captions (the browser keeps only the first).
// These tests wire real resolvers, which the plain tableCaption tests do not.

function makeText(text: string): DitaNode {
  return {
    type: 'text',
    text,
    children: [],
    sourceRange: { startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
  };
}

function makeEl(baseType: string, children: DitaNode[], attrs?: Record<string, string>): DitaNode {
  return {
    type: 'element',
    tagName: baseType.replace('topic/', ''),
    baseType,
    attributes: attrs,
    children,
    sourceRange: { startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
  };
}

const baseCtx: RenderContext = {
  headingLevel: 1,
  asWebviewUri: (p: string) => p,
  documentDir: '/test',
};

function render(body: string, ctx: RenderContext = baseCtx): string {
  const doc = parseDita(preprocessEntities(`<topic id="t"><title>T</title><body>${body}</body></topic>`));
  return renderDocument(doc.root, ctx);
}

const CALS = (head: string) => `<table>${head}<tgroup cols="1"><tbody><row><entry>x</entry></row></tbody></tgroup></table>`;
const tableOf = (html: string) => /<table\b[\s\S]*<\/table>/.exec(html)![0];
const captionCount = (table: string) => (table.match(/<caption\b/g) || []).length;

// The reuse target: a <title id="cap"> holding the caption text.
const target = makeEl('topic/title', [makeText('Pulled caption')], { id: 'cap' });
const conrefCtx: RenderContext = {
  ...baseCtx,
  resolveConref: (ref: string) => (ref === 'reuse.dita#r/cap' ? target : undefined),
};
const keyrefCtx: RenderContext = {
  ...baseCtx,
  resolveKey: (key: string) => (key === 'cap-key' ? 'Key caption' : undefined),
};

describe('a fig title pulled in by reference keeps its figcaption', () => {
  it('conref: the resolved text lands in the figcaption', () => {
    const html = render('<fig><title conref="reuse.dita#r/cap"/><image href="a.png"/></fig>', conrefCtx);
    assert.ok(/<figcaption[^>]*><span\b[^>]*class="figtitle"[^>]*>Pulled caption<\/span><\/figcaption>/.test(html), html);
  });

  it('conkeyref: same shape, resolved through the key space', () => {
    const ctx: RenderContext = { ...baseCtx, resolveConkeyref: (ref) => (ref === 'reuse/cap' ? target : undefined) };
    const html = render('<fig><title conkeyref="reuse/cap"/><image href="a.png"/></fig>', ctx);
    assert.ok(/<figcaption[^>]*><span\b[^>]*class="figtitle"[^>]*>Pulled caption<\/span><\/figcaption>/.test(html), html);
  });

  it('keyref: the key text lands in the figcaption', () => {
    const html = render('<fig><title keyref="cap-key"/><image href="a.png"/></fig>', keyrefCtx);
    assert.ok(/<figcaption[^>]*><span\b[^>]*class="figtitle"[^>]*>Key caption<\/span><\/figcaption>/.test(html), html);
  });

  it('inline markup in the conref target survives inside the figcaption', () => {
    const rich = makeEl('topic/title', [makeEl('topic/b', [makeText('Bold')]), makeText(' tail')], { id: 'cap' });
    const ctx: RenderContext = { ...baseCtx, resolveConref: () => rich };
    const html = render('<fig><title conref="reuse.dita#r/cap"/><image href="a.png"/></fig>', ctx);
    assert.ok(/<figcaption[^>]*><span\b[^>]*class="figtitle"[^>]*><strong\b[^>]*>Bold<\/strong> tail<\/span><\/figcaption>/.test(html), html);
  });

  it('imagemap behaves the same', () => {
    const html = render(
      '<imagemap><title conref="reuse.dita#r/cap"/><image href="m.png"/><area><shape>rect</shape><coords>0,0,1,1</coords><xref href="a.dita">A</xref></area></imagemap>',
      conrefCtx,
    );
    assert.ok(/<figcaption[^>]*><span\b[^>]*class="figtitle"[^>]*>Pulled caption<\/span><\/figcaption>/.test(html), html);
  });

  it('an unresolvable conref title still gets no figcaption (and no number)', () => {
    const ctx: RenderContext = { ...baseCtx, resolveConref: () => undefined };
    const html = render('<fig><title conref="reuse.dita#r/cap"/><image href="a.png"/></fig>', ctx);
    assert.ok(html.includes('<figure'), html);
    assert.ok(!html.includes('<figcaption'), html);
  });

  it('a conref title resolving to whitespace gets no figcaption either', () => {
    const empty = makeEl('topic/title', [makeText('   ')], { id: 'cap' });
    const ctx: RenderContext = { ...baseCtx, resolveConref: () => empty };
    const html = render('<fig><title conref="reuse.dita#r/cap"/><image href="a.png"/></fig>', ctx);
    assert.ok(!html.includes('<figcaption'), html);
  });
});

describe('a table title pulled in by reference keeps exactly one caption', () => {
  it('conref title + desc: one tabletitle caption holding both, desc after the title', () => {
    const table = tableOf(render(CALS('<title conref="reuse.dita#r/cap"/><desc>At 20 C</desc>'), conrefCtx));
    assert.strictEqual(captionCount(table), 1, table);
    assert.ok(
      /<caption\b[^>]*class="title tabletitle"[^>]*>Pulled caption <span\b[^>]*class="desc"[^>]*>At 20 C<\/span><\/caption>/.test(table),
      table,
    );
  });

  it('keyref title + desc: same single-caption shape', () => {
    const table = tableOf(render(CALS('<title keyref="cap-key"/><desc>At 20 C</desc>'), keyrefCtx));
    assert.strictEqual(captionCount(table), 1, table);
    assert.ok(/<caption\b[^>]*tabletitle[^>]*>Key caption <span\b[^>]*class="desc"[^>]*>At 20 C<\/span><\/caption>/.test(table), table);
  });

  it('a simpletable does the same', () => {
    const table = tableOf(
      render('<simpletable><title conref="reuse.dita#r/cap"/><desc>In mm</desc><strow><stentry>y</stentry></strow></simpletable>', conrefCtx),
    );
    assert.strictEqual(captionCount(table), 1, table);
    assert.ok(/<caption\b[^>]*tabletitle[^>]*>Pulled caption <span\b[^>]*class="desc"[^>]*>In mm<\/span><\/caption>/.test(table), table);
  });

  it('a conref title without a desc renders its caption normally', () => {
    const table = tableOf(render(CALS('<title conref="reuse.dita#r/cap"/>'), conrefCtx));
    assert.strictEqual(captionCount(table), 1, table);
    assert.ok(/<caption\b[^>]*tabletitle[^>]*>Pulled caption<\/caption>/.test(table), table);
  });

  it('an empty source title with a desc still yields a single unnumbered tabledesc', () => {
    const table = tableOf(render(CALS('<title/><desc>At 20 C</desc>'), conrefCtx));
    assert.strictEqual(captionCount(table), 1, table);
    assert.ok(/<caption\b[^>]*class="tabledesc"[^>]*>/.test(table), table);
    assert.ok(!/tabletitle/.test(table), table);
  });

  it('an unresolvable conref title with a desc keeps the desc in one unnumbered caption', () => {
    const ctx: RenderContext = { ...baseCtx, resolveConref: () => undefined };
    const table = tableOf(render(CALS('<title conref="reuse.dita#r/cap"/><desc>At 20 C</desc>'), ctx));
    assert.strictEqual(captionCount(table), 1, table);
    assert.ok(/tabledesc/.test(table) && !/tabletitle/.test(table), table);
    assert.ok(/At 20 C/.test(table), table);
  });
});