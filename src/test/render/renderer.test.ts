import * as assert from 'assert';
import { renderDocument, RenderContext } from '../../render/renderer';
import { DitaNode } from '../../parser/domTypes';

function makeText(text: string): DitaNode {
  return {
    type: 'text',
    text,
    children: [],
    sourceRange: { startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
  };
}

function makeEl(
  baseType: string,
  children: DitaNode[],
  attrs?: Record<string, string>,
  tagName?: string,
): DitaNode {
  return {
    type: 'element',
    tagName: tagName || baseType.replace('topic/', ''),
    baseType,
    attributes: attrs,
    children,
    sourceRange: { startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
  };
}

const defaultCtx: RenderContext = {
  headingLevel: 1,
  asWebviewUri: (p: string) => `vscode-resource:${p}`,
  documentDir: '/test',
};

describe('renderer', () => {
  it('should render a topic with title as h1', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/title', [makeText('My Title')]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('<h1 title="title">'));
    assert.ok(html.includes('My Title'));
    assert.ok(html.includes('</h1>'));
  });

  it('should render shortdesc with class', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/shortdesc', [makeText('A short desc')]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('class="shortdesc"'));
  });

  it('should render paragraphs', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/p', [makeText('Hello world')]),
      ]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('<p title="p">Hello world</p>'));
  });

  it('should render note with type-specific class', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/note', [makeText('Watch out!')], { type: 'warning' }),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('class="note note--warning"'));
    assert.ok(html.includes('warning:'));
  });

  it('should render ordered and unordered lists', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/ul', [
          makeEl('topic/li', [makeText('A')]),
          makeEl('topic/li', [makeText('B')]),
        ]),
        makeEl('topic/ol', [
          makeEl('topic/li', [makeText('1')]),
        ]),
      ]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('<ul title="ul">'));
    assert.ok(html.includes('<ol title="ol">'));
    assert.ok(html.includes('<li title="li">A</li>'));
    assert.ok(html.includes('<li title="li">1</li>'));
  });

  it('should render definition list', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/dl', [
        makeEl('topic/dlentry', [
          makeEl('topic/dt', [makeText('term')]),
          makeEl('topic/dd', [makeText('definition')]),
        ]),
      ]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('<dl title="dl">'));
    assert.ok(html.includes('<dt title="dt">term</dt>'));
    assert.ok(html.includes('<dd title="dd">definition</dd>'));
  });

  it('should render CALS table', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/table', [
        makeEl('topic/tgroup', [
          makeEl('topic/colspec', [], { colname: 'c1' }),
          makeEl('topic/thead', [
            makeEl('topic/row', [
              makeEl('topic/entry', [makeText('Header')]),
            ]),
          ]),
          makeEl('topic/tbody', [
            makeEl('topic/row', [
              makeEl('topic/entry', [makeText('Data')]),
            ]),
          ]),
        ]),
      ]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('class="cals-table"'));
    assert.ok(html.includes('<th'));
    assert.ok(html.includes('<td'));
  });

  it('should render simple table', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/simpletable', [
        makeEl('topic/sthead', [
          makeEl('topic/stentry', [makeText('OS')]),
        ]),
        makeEl('topic/strow', [
          makeEl('topic/stentry', [makeText('Linux')]),
        ]),
      ]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('class="simple-table"'));
    assert.ok(html.includes('<td title="stentry">OS</td>'));
    assert.ok(html.includes('<td title="stentry">Linux</td>'));
  });

  it('should render image with asWebviewUri', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/image', [], { href: 'images/pic.png', alt: 'A picture' }),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('src="vscode-resource:images/pic.png"'));
    assert.ok(html.includes('alt="A picture"'));
  });

  it('should render fig with figcaption', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/fig', [
        makeEl('topic/title', [makeText('Figure 1')]),
        makeEl('topic/image', [], { href: 'img.png' }),
      ]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('<figure'));
    assert.ok(html.includes('<figcaption>Figure 1</figcaption>'));
  });

  it('should render local xref as clickable anchor', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/xref', [makeText('see section')], { href: '#section1' }),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('<a title="xref" href="#section1"'));
    assert.ok(html.includes('see section'));
  });

  it('should render external xref as placeholder text', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/xref', [], { href: 'other.dita#topic1' }),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('Phase 2'));
  });

  it('should render inline formatting', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/b', [makeText('bold')]),
      makeEl('topic/i', [makeText('italic')]),
      makeEl('topic/u', [makeText('underline')]),
      makeEl('topic/tt', [makeText('mono')]),
      makeEl('topic/sup', [makeText('sup')]),
      makeEl('topic/sub', [makeText('sub')]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('<strong title="b">bold</strong>'));
    assert.ok(html.includes('<em title="i">italic</em>'));
    assert.ok(html.includes('<u title="u">underline</u>'));
    assert.ok(html.includes('<code title="tt">mono</code>'));
    assert.ok(html.includes('<sup title="sup">sup</sup>'));
    assert.ok(html.includes('<sub title="sub">sub</sub>'));
  });

  it('should render quotes and blockquotes', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/q', [makeText('inline quote')]),
      makeEl('topic/lq', [makeText('block quote')]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('<q title="q">inline quote</q>'));
    assert.ok(html.includes('<blockquote title="lq">block quote</blockquote>'));
  });

  it('should render keyword and term with spans', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/keyword', [makeText('kw')]),
      makeEl('topic/term', [makeText('term')]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('<span title="keyword" class="keyword">kw</span>'));
    assert.ok(html.includes('<span title="term" class="term">term</span>'));
  });

  it('should escape HTML in text nodes', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/p', [makeText('<hello & world>')]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('&lt;hello &amp; world&gt;'));
  });

  it('should not crash on unknown baseType', () => {
    const doc = makeEl('topic/topic', [
      makeEl('unknown/type', [makeText('content')]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('content'));
  });

  it('should resolve xref title from resolveTitle function', () => {
    const ctx: RenderContext = {
      ...defaultCtx,
      resolveTitle: (id: string) => (id === 'sec1' ? '目标章节标题' : undefined),
    };
    const doc = makeEl('topic/topic', [
      makeEl('topic/xref', [], { href: '#topic/sec1' }),
    ]);
    const html = renderDocument(doc, ctx);
    assert.ok(html.includes('目标章节标题'));
    assert.ok(html.includes('href="#sec1"'));
  });

  it('should add language label to codeblock with outputclass', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/codeblock', [makeText('code')], { outputclass: 'language-cpp' }),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('class="codeblock-lang"'));
    assert.ok(html.includes('cpp'));
    assert.ok(html.includes('class="codeblock language-cpp"'));
  });

  it('should increase heading level inside sections', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/title', [makeText('Main')]),
      makeEl('topic/body', [
        makeEl('topic/section', [
          makeEl('topic/title', [makeText('Section')]),
        ]),
      ]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('<h1 title="title">Main</h1>'));
    assert.ok(html.includes('<h2 title="title">Section</h2>'));
  });
});
