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
    assert.ok(html.includes('title="title"'));
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
    assert.ok(html.includes('title="p"'));
    assert.ok(html.includes('Hello world'));
  });

  it('should render note with type-specific class', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/note', [makeText('Watch out!')], { type: 'warning' }),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('class="note note--warning"'));
    assert.ok(html.includes('Warning:'));
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
    assert.ok(html.includes('title="ul"'));
    assert.ok(html.includes('title="ol"'));
    assert.ok(html.includes('title="li"'));
    assert.ok(html.includes('>A<'));
    assert.ok(html.includes('>1<'));
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
    assert.ok(html.includes('title="dl"'));
    assert.ok(html.includes('title="dt"'));
    assert.ok(html.includes('title="dd"'));
    assert.ok(html.includes('>term<'));
    assert.ok(html.includes('>definition<'));
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
    assert.ok(html.includes('title="stentry"'));
    assert.ok(html.includes('>OS<'));
    assert.ok(html.includes('>Linux<'));
  });

  it('should render CALS table with colspan from namest/nameend', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/table', [
        makeEl('topic/tgroup', [
          makeEl('topic/colspec', [], { colname: 'c1' }),
          makeEl('topic/colspec', [], { colname: 'c2' }),
          makeEl('topic/colspec', [], { colname: 'c3' }),
          makeEl('topic/thead', [
            makeEl('topic/row', [
              makeEl('topic/entry', [makeText('Header')], { namest: 'c1', nameend: 'c3' }),
            ]),
          ]),
          makeEl('topic/tbody', [
            makeEl('topic/row', [
              makeEl('topic/entry', [makeText('A')]),
              makeEl('topic/entry', [makeText('B')]),
              makeEl('topic/entry', [makeText('C')]),
            ]),
          ]),
        ]),
      ]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('colspan="3"'), 'should have colspan=3 for merged header cell');
  });

  it('should render CALS table with rowspan from morerows', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/table', [
        makeEl('topic/tgroup', [
          makeEl('topic/colspec', [], { colname: 'c1' }),
          makeEl('topic/colspec', [], { colname: 'c2' }),
          makeEl('topic/tbody', [
            makeEl('topic/row', [
              makeEl('topic/entry', [makeText('Merged')], { morerows: '1' }),
              makeEl('topic/entry', [makeText('B')]),
            ]),
            makeEl('topic/row', [
              makeEl('topic/entry', [makeText('D')]),
            ]),
          ]),
        ]),
      ]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('rowspan="2"'), 'should have rowspan=2 for merged cell (morerows=1 → rowspan=2)');
  });

  it('should render CALS table with colgroup from colspec colwidth', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/table', [
        makeEl('topic/tgroup', [
          makeEl('topic/colspec', [], { colname: 'c1', colwidth: '5*' }),
          makeEl('topic/colspec', [], { colname: 'c2', colwidth: '3*' }),
          makeEl('topic/tbody', [
            makeEl('topic/row', [
              makeEl('topic/entry', [makeText('A')]),
              makeEl('topic/entry', [makeText('B')]),
            ]),
          ]),
        ]),
      ]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('<colgroup>'), 'should generate colgroup');
    assert.ok(html.includes('62.50'), '5* out of 8* total = 62.5%');
    assert.ok(html.includes('37.50'), '3* out of 8* total = 37.5%');
  });

  it('should render CALS table with decimal proportional colwidth', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/table', [
        makeEl('topic/tgroup', [
          makeEl('topic/colspec', [], { colname: 'c1', colwidth: '1.5*' }),
          makeEl('topic/colspec', [], { colname: 'c2', colwidth: '1*' }),
          makeEl('topic/tbody', [
            makeEl('topic/row', [
              makeEl('topic/entry', [makeText('A')]),
              makeEl('topic/entry', [makeText('B')]),
            ]),
          ]),
        ]),
      ]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('60.00'), '1.5* out of 2.5* total = 60%');
    assert.ok(html.includes('40.00'), '1* out of 2.5* total = 40%');
  });

  it('should render CALS table with bare-number colwidth as px', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/table', [
        makeEl('topic/tgroup', [
          makeEl('topic/colspec', [], { colname: 'c1', colwidth: '200' }),
          makeEl('topic/colspec', [], { colname: 'c2', colwidth: '100' }),
          makeEl('topic/tbody', [
            makeEl('topic/row', [
              makeEl('topic/entry', [makeText('A')]),
              makeEl('topic/entry', [makeText('B')]),
            ]),
          ]),
        ]),
      ]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('width: 200px'), 'bare number 200 should become 200px');
    assert.ok(html.includes('width: 100px'), 'bare number 100 should become 100px');
  });

  it('should render CALS table with both colspan and rowspan', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/table', [
        makeEl('topic/tgroup', [
          makeEl('topic/colspec', [], { colname: 'c1' }),
          makeEl('topic/colspec', [], { colname: 'c2' }),
          makeEl('topic/colspec', [], { colname: 'c3' }),
          makeEl('topic/tbody', [
            makeEl('topic/row', [
              makeEl('topic/entry', [makeText('Big')], { namest: 'c1', nameend: 'c2', morerows: '1' }),
              makeEl('topic/entry', [makeText('C')]),
            ]),
            makeEl('topic/row', [
              makeEl('topic/entry', [makeText('F')]),
            ]),
          ]),
        ]),
      ]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('colspan="2"'), 'should have colspan=2');
    assert.ok(html.includes('rowspan="2"'), 'should have rowspan=2');
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
    assert.ok(html.includes('title="xref"'));
    assert.ok(html.includes('href="#section1"'));
    assert.ok(html.includes('see section'));
  });

  it('should render external xref showing the href when resolveTitle is unavailable', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/xref', [], { href: 'other.dita#topic1' }),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('other.dita#topic1'));
  });

  it('should render external xref without fragment showing the href when resolveTitle is unavailable', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/xref', [], { href: 'other.dita' }),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('other.dita'));
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
    assert.ok(html.includes('title="b"'));
    assert.ok(html.includes('title="i"'));
    assert.ok(html.includes('title="u"'));
    assert.ok(html.includes('title="tt"'));
    assert.ok(html.includes('title="sup"'));
    assert.ok(html.includes('title="sub"'));
    assert.ok(html.includes('>bold<'));
    assert.ok(html.includes('>italic<'));
    assert.ok(html.includes('>underline<'));
    assert.ok(html.includes('>mono<'));
    assert.ok(html.includes('>sup<'));
    assert.ok(html.includes('>sub<'));
  });

  it('should render quotes and blockquotes', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/q', [makeText('inline quote')]),
      makeEl('topic/lq', [makeText('block quote')]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('title="q"'));
    assert.ok(html.includes('title="lq"'));
    assert.ok(html.includes('>inline quote<'));
    assert.ok(html.includes('>block quote<'));
  });

  it('should render keyword and term with spans', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/keyword', [makeText('kw')]),
      makeEl('topic/term', [makeText('term')]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('title="keyword"'));
    assert.ok(html.includes('title="term"'));
    assert.ok(html.includes('class="keyword"'));
    assert.ok(html.includes('class="term"'));
    assert.ok(html.includes('>kw<'));
    assert.ok(html.includes('>term<'));
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

  it('should escape resolveTitle content to prevent HTML injection', () => {
    const ctx: RenderContext = {
      ...defaultCtx,
      resolveTitle: () => 'A <img src=x onerror="alert(1)"> title',
    };
    const doc = makeEl('topic/topic', [
      makeEl('topic/xref', [], { href: '#topic/sec1' }),
    ]);
    const html = renderDocument(doc, ctx);
    assert.ok(html.includes('A &lt;img src=x onerror=&quot;alert(1)&quot;&gt; title'));
    assert.ok(!html.includes('<img'));
  });

  it('should resolve cross-file xref title without fragment via resolveTitle', () => {
    const ctx: RenderContext = {
      ...defaultCtx,
      resolveTitle: (id: string) => (id === 'other.dita' ? 'Other Topic Title' : undefined),
    };
    const doc = makeEl('topic/topic', [
      makeEl('topic/xref', [], { href: 'other.dita' }),
    ]);
    const html = renderDocument(doc, ctx);
    assert.ok(html.includes('Other Topic Title'), 'should show resolved title');
    assert.ok(!html.includes('>other.dita<'), 'should not show raw href as content');
  });

  it('should resolve cross-file xref title with fragment via resolveTitle', () => {
    const ctx: RenderContext = {
      ...defaultCtx,
      resolveTitle: (id: string) => (id === 'other.dita#topic1' ? 'Cross-File Topic' : undefined),
    };
    const doc = makeEl('topic/topic', [
      makeEl('topic/xref', [], { href: 'other.dita#topic1' }),
    ]);
    const html = renderDocument(doc, ctx);
    assert.ok(html.includes('Cross-File Topic'), 'should show resolved title');
  });

  it('should fall back to raw href when resolveTitle returns undefined for cross-file xref', () => {
    const ctx: RenderContext = {
      ...defaultCtx,
      resolveTitle: () => undefined,
    };
    const doc = makeEl('topic/topic', [
      makeEl('topic/xref', [], { href: 'missing.dita' }),
    ]);
    const html = renderDocument(doc, ctx);
    assert.ok(html.includes('missing.dita'), 'should fall back to raw href');
  });

  it('should prefer xref text content over resolveTitle', () => {
    const ctx: RenderContext = {
      ...defaultCtx,
      resolveTitle: () => 'Resolved Title',
    };
    const doc = makeEl('topic/topic', [
      makeEl('topic/xref', [makeText('Custom Link Text')], { href: 'other.dita' }),
    ]);
    const html = renderDocument(doc, ctx);
    assert.ok(html.includes('Custom Link Text'), 'should show custom text');
    assert.ok(!html.includes('Resolved Title'), 'should not show resolved title when custom text exists');
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

  it('should escape id attribute to prevent XSS', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/section', [makeText('ok')], { id: 'x"><img src=x onerror="alert(1)">' }),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(!html.includes('<img '), 'should not contain raw img tag');
    assert.ok(html.includes('&gt;&lt;img'), 'should have escaped angle brackets');
    assert.ok(html.includes('&quot;'), 'should have escaped quotes');
  });

  it('should escape note type attribute to prevent XSS', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/note', [makeText('ok')], { type: 'x"><img src=x onerror="alert(1)">' }),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(!html.includes('<img '));
    assert.ok(html.includes('note--x'));
    assert.ok(html.includes('&gt;&lt;img'));
    assert.ok(html.includes('&quot;'));
  });

  it('should escape xref href and prevent tag injection in fallback content', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/xref', [], { href: '#x"><img src=x onerror="alert(1)">' }),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(!html.includes('<img '), 'should not contain raw img tag');
    assert.ok(html.includes('&gt;&lt;img'), 'angle brackets in fallback content should be escaped');
    assert.ok(html.includes('&quot;'), 'quotes should be escaped');
  });

  it('should escape image alt attribute to prevent XSS', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/image', [], { href: 'test.png', alt: 'x"><img src=x onerror="alert(1)">' }),
    ]);
    const html = renderDocument(doc, defaultCtx);
    // The page's own <img> tag is fine; check the injected payload doesn't create a SECOND img
    const firstImg = html.indexOf('<img');
    const secondImg = html.indexOf('<img', firstImg + 1);
    assert.ok(secondImg === -1, 'should not contain a second raw img tag from injection');
    assert.ok(html.includes('&gt;&lt;img'), 'angle brackets should be escaped');
    assert.ok(html.includes('&quot;'), 'quotes should be escaped');
  });

  it('should not double-escape ampersand in attributes', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/section', [makeText('ok')], { id: 'A&B "test"' }),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('A&amp;B &quot;test&quot;'), 'should escape once');
    assert.ok(!html.includes('&amp;amp;'), 'should not double-escape');
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
    assert.ok(html.includes('title="title"'));
    assert.ok(html.includes('>Main<'));
    assert.ok(/<h1[\s>]/.test(html));
    assert.ok(/<h2[\s>]/.test(html));
    assert.ok(html.includes('>Section<'));
  });

  // ── Conref resolution tests ──

  it('should resolve ph conref with same-type target preserving children', () => {
    // Target is a <ph> (same baseType as referencing <ph>)
    const target = makeEl('topic/ph', [
      makeEl('topic/b', [makeText('Important')]),
      makeText(' note text'),
    ], { id: 'ph_note' });
    const ctx: RenderContext = {
      ...defaultCtx,
      resolveConref: (_conref: string) => target,
    };
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/ph', [], { conref: 'reuse.dita#r/ph_note' }),
      ]),
    ]);
    const html = renderDocument(doc, ctx);
    assert.ok(html.includes('Important'), 'should contain resolved child element text');
    assert.ok(html.includes('note text'), 'should contain resolved child text');
    assert.ok(!html.includes('conref'), 'should strip conref attribute after resolution');
  });

  it('should resolve ph conref with cross-type target preserving target tag', () => {
    // Target is a <filepath> (different baseType from referencing <ph>)
    const target = makeEl('topic/filepath', [makeText('.fscript')], { id: 'fp_1' });
    const ctx: RenderContext = {
      ...defaultCtx,
      resolveConref: (_conref: string) => target,
    };
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/p', [
          makeEl('topic/ph', [], { conref: 'reuse.dita#r/fp_1' }),
        ]),
      ]),
    ]);
    const html = renderDocument(doc, ctx);
    assert.ok(html.includes('class="filepath"'), 'filepath span should be rendered (target tag preserved)');
    assert.ok(html.includes('.fscript'), 'filepath text should be present');
    assert.ok(!html.includes('conref'), 'should strip conref attribute');
  });

  it('should resolve plentry conref preserving pt/pd structure', () => {
    // Target is a <plentry> (same baseType) with pt/pd children
    const target = makeEl('topic/plentry', [
      makeEl('topic/pt', [makeText('Parameter A')]),
      makeEl('topic/pd', [makeText('Value A')]),
    ], { id: 'plentry_1' });
    const ctx: RenderContext = {
      ...defaultCtx,
      resolveConref: (_conref: string) => target,
    };
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/parml', [
          makeEl('topic/plentry', [], { conref: 'reuse.dita#r/plentry_1' }),
        ]),
      ]),
    ]);
    const html = renderDocument(doc, ctx);
    assert.ok(html.includes('class="plentry"'), 'plentry container should be rendered');
    assert.ok(html.includes('class="pt"'), 'pt element should be rendered as dt');
    assert.ok(html.includes('Parameter A'), 'pt text should be preserved');
    assert.ok(html.includes('class="pd"'), 'pd element should be rendered as dd');
    assert.ok(html.includes('Value A'), 'pd text should be preserved');
  });

  it('should leave node unchanged when conref is unresolved (undefined)', () => {
    const ctx: RenderContext = {
      ...defaultCtx,
      resolveConref: (_conref: string) => undefined,
    };
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/ph', [makeText('fallback')], { conref: 'missing.dita#r/ph_1' }),
      ]),
    ]);
    const html = renderDocument(doc, ctx);
    assert.ok(html.includes('fallback'), 'should keep original children when conref is unresolved');
  });

  // ── Keyref resolution tests ──

  it('should resolve varname keyref to key value', () => {
    const ctx: RenderContext = {
      ...defaultCtx,
      resolveKey: (key: string) => key === 'product_install_path' ? '/opt/product' : undefined,
    };
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/p', [
          makeText('Install to '),
          makeEl('topic/varname', [], { keyref: 'product_install_path' }),
          makeText('.'),
        ]),
      ]),
    ]);
    const html = renderDocument(doc, ctx);
    assert.ok(html.includes('/opt/product'), 'should contain resolved key value');
    assert.ok(html.includes('class="varname"'), 'varname span should be rendered');
    assert.ok(!html.includes('keyref'), 'keyref attribute should be stripped after resolution');
  });

  it('should resolve keyword keyref to key value', () => {
    const ctx: RenderContext = {
      ...defaultCtx,
      resolveKey: (key: string) => key === 'version' ? '2.0' : undefined,
    };
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/keyword', [], { keyref: 'version' }),
      ]),
    ]);
    const html = renderDocument(doc, ctx);
    assert.ok(html.includes('2.0'), 'should contain resolved key value');
    assert.ok(html.includes('class="keyword"'), 'keyword span should be rendered');
  });

  it('should leave node unchanged when keyref is unresolved', () => {
    const ctx: RenderContext = {
      ...defaultCtx,
      resolveKey: (_key: string) => undefined,
    };
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/varname', [makeText('fallback')], { keyref: 'missing_key' }),
      ]),
    ]);
    const html = renderDocument(doc, ctx);
    assert.ok(html.includes('fallback'), 'should keep fallback content when keyref is unresolved');
  });

  it('should resolve ph keyref to key value (generic handler)', () => {
    const ctx: RenderContext = {
      ...defaultCtx,
      resolveKey: (key: string) => key === 'product' ? 'MyApp Pro' : undefined,
    };
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/ph', [], { keyref: 'product' }),
      ]),
    ]);
    const html = renderDocument(doc, ctx);
    assert.ok(html.includes('MyApp Pro'), 'should contain resolved key value');
    assert.ok(html.includes('class="ph"'), 'ph span should be rendered');
    assert.ok(!html.includes('keyref'), 'keyref attribute should be stripped after resolution');
  });
});
