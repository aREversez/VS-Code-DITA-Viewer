import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { renderDocument, RenderContext } from '../../render/renderer';
import { parseDita } from '../../parser/ditaParser';
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

  it('should clamp heading levels to the h1–h6 range', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/title', [makeText('Clamped')]),
    ]);
    const low = renderDocument(doc, { ...defaultCtx, headingLevel: 0 });
    assert.ok(/<h1\b/.test(low), `expected h1 for level 0, got: ${low}`);
    const high = renderDocument(doc, { ...defaultCtx, headingLevel: 9 });
    assert.ok(/<h6\b/.test(high) && high.includes('</h6>'), `expected h6 for level 9, got: ${high}`);
  });

  it('should render shortdesc with class', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/shortdesc', [makeText('A short desc')]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('class="shortdesc"'));
  });

  it('should render itemgroup (task info/stepxmp base type) as a div', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/li', [
        makeEl('topic/ph', [makeText('Do it')], undefined, 'cmd'),
        makeEl('topic/itemgroup', [makeText('details')], undefined, 'info'),
      ], undefined, 'step'),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(/<div\b[^>]*class="itemgroup"[^>]*>details<\/div>/.test(html), `got: ${html}`);
    assert.ok(/<li\b[^>]*>/.test(html), 'step should render as li');
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

  it('should render labels for all 13 DITA 1.3 note/@type values (except other)', () => {
    // Full enumeration per OASIS DITA 1.3 commonElements.mod note.attributes,
    // minus 'other' which is covered separately below (its label comes from
    // @othertype, not a fixed string).
    const expected: Record<string, string> = {
      note: 'Note:', notice: 'Notice:', warning: 'Warning:', danger: 'Danger:',
      important: 'Important:', tip: 'Tip:', restriction: 'Restriction:',
      attention: 'Attention:', caution: 'Caution:', fastpath: 'Fastpath:',
      remember: 'Remember:', trouble: 'Trouble:',
    };
    for (const [type, label] of Object.entries(expected)) {
      const doc = makeEl('topic/topic', [
        makeEl('topic/note', [makeText('x')], { type }),
      ]);
      const html = renderDocument(doc, defaultCtx);
      assert.ok(html.includes(label), `type="${type}" should render label "${label}", got: ${html}`);
    }
  });

  it('should use @othertype as the label when type="other"', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/note', [makeText('x')], { type: 'other', othertype: 'Best Practice' }),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('Best Practice:'));
    assert.ok(!html.includes('>other:'));
  });

  it('should let @spectitle override the label for any note type', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/note', [makeText('x')], { type: 'tip', spectitle: 'Pro Tip' }),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('Pro Tip:'));
    assert.ok(!html.includes('>Tip:'));
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
    assert.ok(/<th\b[^>]*>Header<\/th>/.test(html), `header entry should render as th, got: ${html}`);
    assert.ok(/<td\b[^>]*>Data<\/td>/.test(html), `body entry should render as td, got: ${html}`);
  });

  it('should render simple table header stentry as th and row stentry as td', () => {
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
    assert.ok(/<th\b[^>]*>OS<\/th>/.test(html), `sthead stentry should render as th, got: ${html}`);
    assert.ok(/<td\b[^>]*>Linux<\/td>/.test(html), `strow stentry should render as td, got: ${html}`);
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

  it('should prefer <alt> child element text over the @alt attribute', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/image', [
        makeEl('topic/alt', [makeText('Child alt wins')]),
      ], { href: 'pic.png', alt: 'Attribute alt loses' }),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('alt="Child alt wins"'));
    assert.ok(!html.includes('Attribute alt loses'));
    // Also surfaced as a hover tooltip
    assert.ok(html.includes('title="Child alt wins"'));
  });

  it('should fall back to the @alt attribute when there is no <alt> child', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/image', [], { href: 'pic.png', alt: 'From attribute' }),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('alt="From attribute"'));
    assert.ok(html.includes('title="From attribute"'));
  });

  it('should omit a fabricated alt="" but keep the generic title="image" tooltip when no alt info is provided', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/image', [], { href: 'pic.png' }),
    ]);
    const html = renderDocument(doc, defaultCtx);
    const imgTag = html.slice(html.indexOf('<img'), html.indexOf('>', html.indexOf('<img')) + 1);
    assert.ok(!imgTag.includes('alt='), 'should not fabricate an empty alt="" on the <img> tag');
    // injectAttributes' generic tagName-as-tooltip fallback still applies
    // here since the renderer itself has nothing more specific to offer.
    assert.ok(imgTag.includes('title="image"'));
  });

  it('should not duplicate the title attribute: alt-derived title wins over the generic tagName tooltip', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/image', [], { href: 'pic.png', alt: 'Real description' }),
    ]);
    const html = renderDocument(doc, defaultCtx);
    const imgTag = html.slice(html.indexOf('<img'), html.indexOf('>', html.indexOf('<img')) + 1);
    const titleMatches = imgTag.match(/ title="/g) || [];
    assert.strictEqual(titleMatches.length, 1, 'the <img> tag should carry exactly one title attribute, not two');
    assert.ok(imgTag.includes('title="Real description"'));
  });

  it('should apply @scale as a --dita-scale style hint when width/height are absent', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/image', [], { href: 'pic.png', scale: '70' }),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('style="--dita-scale:0.7"'));
  });

  it('should let explicit width/height override @scale', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/image', [], { href: 'pic.png', scale: '70', width: '300' }),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(!html.includes('--dita-scale'));
    assert.ok(html.includes('width="300"'));
  });

  it('should suppress @scale when @scalefit="yes"', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/image', [], { href: 'pic.png', scale: '70', scalefit: 'yes' }),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(!html.includes('--dita-scale'));
  });

  // ── topic/foreign (DITA <foreign>/<mathml>, this project's svg-container) ──
  // Descendants of <mathml> are raw, non-DITA XML (real MathML markup, not
  // DITA elements), so they have no baseType of their own -- makeRaw below
  // constructs nodes the way the real parser would for genuinely foreign
  // content: an actual tagName, but baseType left undefined.
  function makeRaw(tagName: string, children: DitaNode[], attrs?: Record<string, string>): DitaNode {
    return {
      type: 'element',
      tagName,
      attributes: attrs,
      children,
      sourceRange: { startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
    };
  }

  it('should preserve real MathML structure instead of flattening it to bare text', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/foreign', [
        makeRaw('math', [
          makeRaw('mfrac', [
            makeRaw('mn', [makeText('1')]),
            makeRaw('mn', [makeText('2')]),
          ]),
        ]),
      ], undefined, 'mathml'),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('<math'), 'should emit a live <math> element for the browser to render natively');
    assert.ok(html.includes('<mfrac><mn>1</mn><mn>2</mn></mfrac>'), 'should preserve the fraction structure, not flatten to "12"');
  });

  it('should drop a tag not on the MathML allowlist but keep its text', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/foreign', [
        makeRaw('math', [makeRaw('evil-tag', [makeText('oops')])]),
      ], undefined, 'mathml'),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(!html.includes('<evil-tag'), 'non-MathML tag names must not be emitted as live elements');
    assert.ok(html.includes('oops'), 'text content should still come through even when its wrapping tag is dropped');
  });

  it('should strip event-handler and URL-bearing attributes from MathML elements but keep legitimate ones', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/foreign', [
        makeRaw('math', [
          makeRaw('mi', [makeText('x')], { onerror: 'alert(1)', mathvariant: 'bold', href: 'javascript:alert(1)' }),
        ]),
      ], undefined, 'mathml'),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(!html.includes('onerror'), 'event-handler attributes must be stripped even on an allowlisted tag');
    assert.ok(!html.includes('javascript:'), 'href must be stripped regardless of value');
    assert.ok(html.includes('mathvariant="bold"'), 'legitimate MathML presentation attributes should pass through');
  });

  it('should strip the namespace prefix from namespace-prefixed MathML (Oxygen/MathType export shape) instead of dropping the tags entirely', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/foreign', [
        makeRaw('mml:math', [
          makeRaw('mml:msqrt', [
            makeRaw('mml:mrow', [
              makeRaw('mml:msup', [makeRaw('mml:mi', [makeText('a')]), makeRaw('mml:mn', [makeText('2')])]),
              makeRaw('mml:mo', [makeText('+')]),
              makeRaw('mml:msup', [makeRaw('mml:mi', [makeText('b')]), makeRaw('mml:mn', [makeText('2')])]),
            ]),
          ]),
        ], { 'xmlns:mml': 'http://www.w3.org/1998/Math/MathML' }),
      ], undefined, 'mathml'),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(!html.includes('mml:'), 'prefixed tag/attribute names must not leak into the output -- browsers only recognize bare MathML tags');
    assert.ok(html.includes('<msqrt>'), 'should recognize mml:msqrt as real MathML, not drop it as an unknown tag');
    assert.ok(
      html.includes('<msup><mi>a</mi><mn>2</mn></msup><mo>+</mo><msup><mi>b</mi><mn>2</mn></msup>'),
      'should preserve full nested structure, not flatten to "a 2 + b 2"',
    );
    assert.ok(!html.includes('xmlns'), 'xmlns/xmlns:* declarations are meaningless once the prefix is stripped and should not be carried through');
  });

  it('should preserve namespace-prefixed MathML end-to-end through the real sax parser, not just the unit-level tree builder', () => {
    // mathml_prefixed_test.dita is authored in the mml:-prefixed shape that
    // Oxygen's equation editor / MathType actually export, as opposed to
    // mathml_test.dita's hand-written unprefixed shape. Going through the
    // real parseDita() here (rather than the makeRaw()/makeEl() synthetic
    // tree above) catches any surprises from how sax hands tagNames back,
    // which the unit-level test can't see.
    const fixturePath = join(__dirname, '..', '..', '..', 'test-dita-file', 'topics', 'mathml_prefixed_test.dita');
    const xml = readFileSync(fixturePath, 'utf-8');
    const doc = parseDita(xml);
    const html = renderDocument(doc.root, defaultCtx);
    const foreignStart = html.indexOf('class="foreign-content"');
    const foreignSpan = html.slice(foreignStart, html.indexOf('</span>', foreignStart));
    assert.ok(!foreignSpan.includes('mml:'), 'no prefixed tag/attribute names should leak into the real parser output');
    assert.ok(foreignSpan.includes('<msqrt>'), 'msqrt should survive end-to-end through the real parser, not just the synthetic unit test');
    assert.ok(
      foreignSpan.includes('<msup><mi>a</mi><mn>2</mn></msup>') && foreignSpan.includes('<msup><mi>b</mi><mn>2</mn></msup>'),
      'superscripts should survive end-to-end, not flatten to "a 2 + b 2"',
    );
  });

  // ── <mfenced> -- real MathML 3, but dropped entirely by MathML Core ──
  // (what Chromium/VS Code's webview and every "open in browser" WebHelp
  // reader actually implement). Oxygen's equation editor emits mfenced by
  // default for every parenthesized group and every |...| absolute-value
  // bar, so this is the single most common cause of "brackets/absolute
  // value missing" reports. It must be expanded into <mo> fence characters
  // rather than passed through as a live <mfenced> tag.
  it('should expand mfenced with default open/close into explicit parenthesis <mo> characters (Chromium/MathML Core does not implement <mfenced>)', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/foreign', [
        makeRaw('math', [
          makeRaw('mfenced', [makeRaw('mi', [makeText('x')])]),
        ]),
      ], undefined, 'mathml'),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(!html.includes('<mfenced'), 'mfenced must never reach the output as a live tag -- Chromium silently drops it and everything inside');
    assert.ok(html.includes('<mrow><mo>(</mo><mi>x</mi><mo>)</mo></mrow>'), 'should default to ( and ) per the MathML 3 spec default');
  });

  it('should expand mfenced open/close attributes into matching <mo> fence characters, e.g. |x| for absolute value', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/foreign', [
        makeRaw('math', [
          makeRaw('mfenced', [makeRaw('mi', [makeText('x')])], { open: '|', close: '|' }),
        ]),
      ], undefined, 'mathml'),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('<mrow><mo>|</mo><mi>x</mi><mo>|</mo></mrow>'), 'open="|" close="|" is the standard MathML shape for absolute value and must render as literal | bars');
  });

  it('should join multiple mfenced children with the separators attribute, repeating the last character for extra gaps', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/foreign', [
        makeRaw('math', [
          makeRaw('mfenced', [
            makeRaw('mi', [makeText('a')]),
            makeRaw('mi', [makeText('b')]),
            makeRaw('mi', [makeText('c')]),
          ], { separators: ';' }),
        ]),
      ], undefined, 'mathml'),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(
      html.includes('<mrow><mo>(</mo><mi>a</mi><mo>;</mo><mi>b</mi><mo>;</mo><mi>c</mi><mo>)</mo></mrow>'),
      'a single-character separators value should repeat between every pair of children',
    );
  });

  it('should render the real aspectRatio formula (Oxygen-exported, prefixed mfenced with separators="|") with visible parentheses instead of silently dropping them', () => {
    // This is the exact shape Oxygen's equation editor exported for a real
    // reported bug: <m:mfenced separators="|"> wrapping a single summation
    // term. Before the fix, this rendered with the sum visible but no
    // surrounding parentheses at all -- not wrong parentheses, none.
    const doc = makeEl('topic/topic', [
      makeEl('topic/foreign', [
        makeRaw('m:math', [
          makeRaw('m:mfenced', [
            makeRaw('m:mrow', [
              makeRaw('m:munderover', [
                makeRaw('m:mo', [makeText('∑')]),
                makeRaw('m:mrow', [makeRaw('m:mi', [makeText('j')])]),
                makeRaw('m:mrow', [makeRaw('m:mi', [makeText('N')])]),
              ]),
              makeRaw('m:msub', [makeRaw('m:mi', [makeText('A')]), makeRaw('m:mi', [makeText('j')])]),
            ]),
          ], { separators: '|' }),
        ], { 'xmlns:m': 'http://www.w3.org/1998/Math/MathML' }),
      ], undefined, 'mathml'),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(!html.includes('<mfenced'), 'the prefixed m:mfenced must be expanded, not passed through under any tag name');
    assert.ok(html.includes('<mo>(</mo>') && html.includes('<mo>)</mo>'), 'default open/close parentheses must appear as explicit <mo> characters');
    assert.ok(html.includes('<mo>∑</mo>'), 'the wrapped summation content must still be preserved inside the expansion');
  });

  it('should render the real OrthQual formula absolute-value bars (open="|" close="|" separators="|") instead of dropping them', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/foreign', [
        makeRaw('m:math', [
          makeRaw('m:mfenced', [
            makeRaw('m:msub', [makeRaw('m:mi', [makeText('angle')]), makeRaw('m:mi', [makeText('j')])]),
          ], { close: '|', open: '|', separators: '|' }),
        ], { 'xmlns:m': 'http://www.w3.org/1998/Math/MathML' }),
      ], undefined, 'mathml'),
    ]);
    const html = renderDocument(doc, defaultCtx);
    const barCount = (html.match(/<mo>\|<\/mo>/g) || []).length;
    assert.strictEqual(barCount, 2, 'both the open and close | bars must render as explicit <mo> characters, matching Oxygen\'s absolute-value rendering');
  });

  it('should expand mfenced end-to-end through the real sax parser using the actual reported fixture (aspectRatio + OrthQual)', () => {
    // mathml_mfenced_test.dita reproduces both formulas from the real bug
    // report byte-for-byte (same prefixed m: shape Oxygen exported). Going
    // through parseDita() here, not just the synthetic makeRaw() tree,
    // catches anything the sax parser does differently with mfenced's
    // attributes (e.g. attribute name casing/ordering) that the unit-level
    // tests above can't see.
    const fixturePath = join(__dirname, '..', '..', '..', 'test-dita-file', 'topics', 'mathml_mfenced_test.dita');
    const xml = readFileSync(fixturePath, 'utf-8');
    const doc = parseDita(xml);
    const html = renderDocument(doc.root, defaultCtx);
    assert.ok(!html.includes('<mfenced'), 'no live <mfenced> tag should survive to the real output');
    const parenOpenCount = (html.match(/<mo>\(<\/mo>/g) || []).length;
    const parenCloseCount = (html.match(/<mo>\)<\/mo>/g) || []).length;
    assert.strictEqual(parenOpenCount, 2, 'aspectRatio has two mfenced groups, each should produce one explicit ( <mo>');
    assert.strictEqual(parenCloseCount, 2, 'aspectRatio has two mfenced groups, each should produce one explicit ) <mo>');
    const barCount = (html.match(/<mo>\|<\/mo>/g) || []).length;
    assert.strictEqual(barCount, 2, 'OrthQual\'s open="|" close="|" mfenced should produce exactly two literal | <mo> characters');
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

  it('should stop rendering on circular conref instead of recursing forever', () => {
    // Target's content conrefs back to itself — without the conrefChain
    // guard this recursion never terminates (stack overflow).
    const target = makeEl('topic/p', [
      makeText('cycle-text '),
      makeEl('topic/p', [makeText('inner-fallback')], { conref: 'reuse.dita#r/loop' }),
    ], { id: 'loop' });
    const ctx: RenderContext = {
      ...defaultCtx,
      resolveConref: (_conref: string) => target,
    };
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/p', [], { conref: 'reuse.dita#r/loop' }),
      ]),
    ]);
    const html = renderDocument(doc, ctx);
    assert.ok(html.includes('cycle-text'), 'first-level conref should still resolve');
    assert.ok(html.includes('inner-fallback'), 'cyclic conref should fall back to literal content');
  });

  // ── conrefend range tests (unit-level; see ditaRenderUtils.test.ts for
  // the real-file sibling/parent resolution logic behind resolveConrefRange) ──

  it('should render every element resolveConrefRange returns, not just the first', () => {
    const s1 = makeEl('topic/section', [makeText('One')], { id: 's1' });
    const s2 = makeEl('topic/section', [makeText('Two')], { id: 's2' });
    const ctx: RenderContext = {
      ...defaultCtx,
      resolveConrefRange: (_conref, _conrefend) => [s1, s2],
    };
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/section', [], { conref: 'x.dita#r/s1', conrefend: 'x.dita#r/s2' }),
      ]),
    ]);
    const html = renderDocument(doc, ctx);
    assert.ok(html.includes('One'));
    assert.ok(html.includes('Two'));
  });

  it('should fall back to normal single-target conref when the range cannot be resolved', () => {
    const target = makeEl('topic/section', [makeText('Single target only')], { id: 's1' });
    const ctx: RenderContext = {
      ...defaultCtx,
      // Range resolution fails (e.g. not siblings) -- normal conref should
      // still take over rather than rendering nothing.
      resolveConrefRange: (_conref, _conrefend) => undefined,
      resolveConref: (_conref: string) => target,
    };
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/section', [], { conref: 'x.dita#r/s1', conrefend: 'x.dita#r/s2' }),
      ]),
    ]);
    const html = renderDocument(doc, ctx);
    assert.ok(html.includes('Single target only'), 'should degrade to the single conref target, not render nothing');
  });

  it('should apply the referencing element\'s own attributes only to the first range member', () => {
    const s1 = makeEl('topic/section', [makeText('First')], { id: 's1' });
    const s2 = makeEl('topic/section', [makeText('Second')], { id: 's2' });
    const ctx: RenderContext = {
      ...defaultCtx,
      resolveConrefRange: (_conref, _conrefend) => [s1, s2],
    };
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/section', [], {
          conref: 'x.dita#r/s1',
          conrefend: 'x.dita#r/s2',
          id: 'ref-local-id',
        }),
      ]),
    ]);
    const html = renderDocument(doc, ctx);
    const occurrences = (html.match(/ref-local-id/g) || []).length;
    assert.strictEqual(occurrences, 1, 'referencing element\'s local attribute must not leak onto every range member');
  });

  // ── Profiling / conditional-attribute highlighting ──

  it('should wrap an element carrying a profiling attribute in a highlight box with a labeled chip', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/p', [makeText('Flagged content')], { otherprops: 'only_for_HUBI' }),
      ]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('class="profiled"'), 'should wrap in the highlight box');
    assert.ok(html.includes('Flagged content'), 'original content should still render');
    assert.ok(html.includes('profiling-chip'), 'should include a chip');
    assert.ok(html.includes('Other'), 'otherprops should display as "Other", matching Oxygen\'s convention');
    assert.ok(html.includes('[only_for_HUBI]'), 'should show the actual value');
  });

  it('should not wrap an element with no profiling attributes', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/p', [makeText('Plain content')], {}),
      ]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(!html.includes('class="profiled"'));
    assert.ok(!html.includes('profiling-chip'));
  });

  it('should render one chip per profiling attribute when several are set on the same element', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/p', [makeText('x')], { audience: 'expert', otherprops: 'prop1' }),
      ]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('Audience'));
    assert.ok(html.includes('[expert]'));
    assert.ok(html.includes('Other'));
    assert.ok(html.includes('[prop1]'));
    assert.strictEqual((html.match(/profiling-chip"/g) || []).length, 2);
  });

  it('should render one chip per space-separated value within a single profiling attribute', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/p', [makeText('x')], { otherprops: 'only_for_HUBI only_for_XYZ' }),
      ]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('[only_for_HUBI]'));
    assert.ok(html.includes('[only_for_XYZ]'));
    assert.strictEqual((html.match(/profiling-chip"/g) || []).length, 2);
  });

  it('should use the inline-flavored wrapper for commonly-inline elements, not the full block box', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/p', [
          makeText('Some '),
          makeEl('topic/ph', [makeText('flagged phrase')], { audience: 'expert' }),
          makeText(' inline.'),
        ]),
      ]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('profiled profiled--inline'), 'inline elements should get the inline variant');
  });

  it('should use the block wrapper (no inline variant) for a profiled block-level element', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/p', [makeText('x')], { audience: 'expert' }),
      ]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(html.includes('class="profiled"'));
    assert.ok(!html.includes('profiled--inline'));
  });

  // A profiled <li> can't be wrapped in a synthetic <span class="profiled">
  // the way inline content (ph/b/i/...) is: the browser positions a list
  // marker relative to the li's real containing block (the <ul>/<ol>), and
  // introducing a wrapper element between them makes the wrapper's own
  // padding/border the effective reference point instead -- visually
  // overlapping the marker and leaving a profiled li's indent not matching
  // its plain siblings. The class/data-profile-keys attribute must land on
  // the li's own tag, and the DOM shape must otherwise be identical to an
  // unprofiled li (no extra wrapping element at all).
  it('should apply profiling class/data-attribute directly onto a profiled <li>\'s own tag rather than wrapping it in a synthetic <span>', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/ul', [
          makeEl('topic/li', [makeText('plain')]),
          makeEl('topic/li', [makeText('profiled')], { audience: 'expert' }),
        ]),
      ]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(!html.includes('<span class="profiled"'), 'no synthetic <span> should wrap the profiled <li> -- that would break the browser\'s list-marker positioning for it');
    assert.ok(!/<span class="profiled"[^>]*><li/.test(html), 'the li must not be nested inside a wrapping span');
    const liMatch = html.match(/<li\b[^>]*>profiled/);
    assert.ok(liMatch, 'the li\'s own opening tag should be immediately followed by its text content, not a wrapping element');
    assert.ok(liMatch![0].includes('class="profiled"'), 'class="profiled" must be an attribute on the li\'s own opening tag');
    assert.ok(liMatch![0].includes('data-profile-keys="audience:expert"'), 'data-profile-keys must be an attribute on the li\'s own opening tag');
  });

  it('should insert the profiling label as the last child inside a profiled <li>, closing before the li\'s own closing tag', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/ul', [
          makeEl('topic/li', [makeText('profiled')], { audience: 'expert' }),
        ]),
      ]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    const liOpenEnd = html.indexOf('>', html.indexOf('<li'));
    const liClose = html.indexOf('</li>', liOpenEnd);
    const liInner = html.slice(liOpenEnd + 1, liClose);
    assert.ok(liInner.startsWith('profiled'), 'the li\'s own text content should come first');
    assert.ok(liInner.trim().endsWith('</span>'), 'the profiling-label span should be the very last thing before </li>, not appended after it');
    assert.ok(liInner.includes('class="profiling-label"'));
  });

  it('should still correctly place each label at its own nesting level for a profiled li containing a nested profiled li', () => {
    // Regression case for the "last closing tag" matching logic: a naive
    // implementation could confuse the outer li's closing tag with the
    // inner one, either duplicating a label at the wrong depth or losing
    // one entirely.
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/ol', [
          makeEl('topic/li', [
            makeText('outer'),
            makeEl('topic/ol', [
              makeEl('topic/li', [makeText('inner')], { platform: 'windows' }),
            ]),
          ], { audience: 'expert' }),
        ]),
      ]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    const labelCount = (html.match(/class="profiling-label"/g) || []).length;
    assert.strictEqual(labelCount, 2, 'both the outer and inner profiled li should get exactly one label each');
    assert.ok(html.includes('data-profile-keys="audience:expert"'));
    assert.ok(html.includes('data-profile-keys="platform:windows"'));
    // The inner li's own closing </li> must come before the outer li's
    // label (which belongs to the outer li, appended right before the
    // outer li's own closing tag, after the whole nested <ol> is done).
    const innerLabelIdx = html.indexOf('[windows]');
    const outerLabelIdx = html.indexOf('[expert]');
    assert.ok(innerLabelIdx < outerLabelIdx, 'the inner (nested) li\'s label should appear before the outer li\'s label in document order');
  });

  it('should highlight nested profiled elements independently (parent and child both flagged)', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/section', [
          makeEl('topic/p', [makeText('inner')], { audience: 'novice' }),
        ], { otherprops: 'section_flag' }),
      ]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.strictEqual((html.match(/class="profiled/g) || []).length, 2, 'both the section and the inner p should each get their own highlight wrapper');
  });

  it('should recognize all nine select-atts profiling attributes from the DITA 1.3 spec', () => {
    const attrs = ['props', 'platform', 'product', 'audience', 'otherprops', 'base', 'importance', 'rev', 'status'];
    for (const attr of attrs) {
      const doc = makeEl('topic/topic', [
        makeEl('topic/body', [
          makeEl('topic/p', [makeText('x')], { [attr]: 'somevalue' }),
        ]),
      ]);
      const html = renderDocument(doc, defaultCtx);
      assert.ok(html.includes('class="profiled"'), `${attr} should trigger highlighting`);
    }
  });

  it('should emit a machine-readable data-profile-keys attribute the filter panel can key off of', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/p', [makeText('x')], { audience: 'expert', otherprops: 'prop1' }),
      ]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    const match = html.match(/data-profile-keys="([^"]*)"/);
    assert.ok(match, 'should emit data-profile-keys');
    const keys = match![1].split(',').map((k) => k.split(':').map(decodeURIComponent));
    assert.deepStrictEqual(keys, [['audience', 'expert'], ['otherprops', 'prop1']]);
  });

  it('should URL-encode profiling attribute values in data-profile-keys so ":"/"," in a value can\'t be mistaken for the delimiter', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/p', [makeText('x')], { otherprops: 'weird:value,with-delims' }),
      ]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    const match = html.match(/data-profile-keys="([^"]*)"/);
    assert.ok(match);
    // Raw attribute text must not contain a literal ':' or ',' beyond the
    // one real delimiter -- decoding should still recover the exact value.
    const [attr, encodedValue] = match![1].split(':');
    assert.strictEqual(attr, 'otherprops');
    assert.strictEqual(decodeURIComponent(encodedValue), 'weird:value,with-delims');
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

  it('should prefer local element content over the keyref value', () => {
    const ctx: RenderContext = {
      ...defaultCtx,
      resolveKey: (_key: string) => 'key-value',
    };
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/ph', [makeText('local content')], { keyref: 'product' }),
      ]),
    ]);
    const html = renderDocument(doc, ctx);
    assert.ok(html.includes('local content'), 'element content wins per the DITA spec');
    assert.ok(!html.includes('key-value'), 'key value must not replace existing content');
  });

  it('should escape the resolved img src attribute', () => {
    const ctx: RenderContext = {
      ...defaultCtx,
      asWebviewUri: (p: string) => `vscode-resource:${p}" onerror="alert(1)`,
    };
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/image', [], { href: 'img.png' }),
      ]),
    ]);
    const html = renderDocument(doc, ctx);
    assert.ok(!html.includes('onerror="alert(1)"'), 'src must not break out of its attribute');
    assert.ok(html.includes('&quot;'), 'quote in the URI should be escaped');
  });

  // Reserving the right aspect-ratio box before the browser has actually
  // loaded the image (see readImageDimensions/getImageDimensions in
  // ditaRenderUtils.ts) is what prevents layout shift as lazy-loaded
  // images finish loading -- most pronounced scrolling through Book mode,
  // which composites many topics' worth of images into one long page.
  it('should fill in width/height from getImageDimensions when the DITA source has neither', () => {
    const ctx: RenderContext = {
      ...defaultCtx,
      getImageDimensions: (relPath: string) => (relPath === 'img.png' ? { width: 300, height: 200 } : undefined),
    };
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/image', [], { href: 'img.png' }),
      ]),
    ]);
    const html = renderDocument(doc, ctx);
    assert.ok(html.includes('width="300"'));
    assert.ok(html.includes('height="200"'));
  });

  it('should let an explicit @width/@height on the DITA image element win over getImageDimensions', () => {
    const ctx: RenderContext = {
      ...defaultCtx,
      getImageDimensions: () => ({ width: 300, height: 200 }),
    };
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/image', [], { href: 'img.png', width: '50', height: '50' }),
      ]),
    ]);
    const html = renderDocument(doc, ctx);
    assert.ok(html.includes('width="50"'));
    assert.ok(html.includes('height="50"'));
    assert.ok(!html.includes('300') && !html.includes('200'), 'getImageDimensions must not override an explicit author-specified size');
  });

  it('should render without width/height when getImageDimensions is absent or returns nothing, same as before this feature existed', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/body', [
        makeEl('topic/image', [], { href: 'img.png' }),
      ]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(!html.includes('width='));
    assert.ok(!html.includes('height='));
  });

  // ── Prolog suppression tests ──

  it('should not render prolog metadata content in the body', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/title', [makeText('T')]),
      makeEl('topic/prolog', [
        makeEl('topic/keyword', [makeText('SECRET_KEYWORD_TOKEN')], undefined, 'keyword'),
      ], undefined, 'prolog'),
      makeEl('topic/body', [
        makeEl('topic/p', [makeText('Real body text')]),
      ]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(!html.includes('SECRET_KEYWORD_TOKEN'), 'prolog keyword must not leak into output');
    assert.ok(html.includes('Real body text'), 'body content should still render');
  });

  it('should suppress the entire prolog subtree including nested metadata', () => {
    const doc = makeEl('topic/topic', [
      makeEl('topic/title', [makeText('T')]),
      makeEl('topic/prolog', [
        makeText('Jane Secret Author'),
        makeEl('topic/keyword', [makeText('SECRET_KEYWORD_TOKEN')], undefined, 'keyword'),
      ], undefined, 'prolog'),
      makeEl('topic/body', [
        makeEl('topic/p', [makeText('Visible')]),
      ]),
    ]);
    const html = renderDocument(doc, defaultCtx);
    assert.ok(!html.includes('Jane Secret Author'), 'prolog author text must not leak');
    assert.ok(!html.includes('SECRET_KEYWORD_TOKEN'), 'prolog keyword must not leak');
    assert.ok(!html.includes('class="keyword"'), 'prolog keyword span must not render');
    assert.ok(html.includes('Visible'), 'body content should still render');
  });

  describe('indexterm', () => {
    it('renders a single-level term as a visible chip (was previously invisible)', () => {
      const doc = makeEl('topic/topic', [
        makeEl('topic/body', [
          makeEl('topic/p', [makeText('See the '), makeEl('topic/indexterm', [makeText('glossary')]), makeText(' for more.')]),
        ]),
      ]);
      const html = renderDocument(doc, defaultCtx);
      assert.ok(html.includes('indexterm-chip'), 'expected a visible indexterm chip');
      assert.ok(html.includes('glossary'));
      assert.ok(html.includes('See the '), 'surrounding text must be preserved');
    });

    it('joins nested indexterm levels into one chip (primary, secondary)', () => {
      const doc = makeEl('topic/topic', [
        makeEl('topic/body', [
          makeEl('topic/p', [
            makeEl('topic/indexterm', [makeText('Database'), makeEl('topic/indexterm', [makeText('backup')])]),
          ]),
        ]),
      ]);
      const html = renderDocument(doc, defaultCtx);
      // Exactly one chip -- the intermediate "Database" level alone must
      // NOT also render as its own separate chip (that would be the
      // double-render bug this structure is specifically at risk of).
      const chipCount = (html.match(/indexterm-chip"/g) || []).length;
      assert.strictEqual(chipCount, 1, `expected exactly 1 chip, got ${chipCount} in: ${html}`);
      assert.ok(html.includes('Database'));
      assert.ok(html.includes('backup'));
    });

    it('emits one chip per sibling sub-entry sharing the same prefix', () => {
      const doc = makeEl('topic/topic', [
        makeEl('topic/body', [
          makeEl('topic/p', [
            makeEl('topic/indexterm', [
              makeText('Database'),
              makeEl('topic/indexterm', [makeText('backup')]),
              makeEl('topic/indexterm', [makeText('restore')]),
            ]),
          ]),
        ]),
      ]);
      const html = renderDocument(doc, defaultCtx);
      const chipCount = (html.match(/indexterm-chip"/g) || []).length;
      assert.strictEqual(chipCount, 2, `expected 2 sibling chips, got ${chipCount} in: ${html}`);
      assert.ok(html.includes('backup'));
      assert.ok(html.includes('restore'));
    });

    it('renders an index-see annotation attached to its chip', () => {
      const doc = makeEl('topic/topic', [
        makeEl('topic/body', [
          makeEl('topic/p', [
            makeEl('topic/indexterm', [
              makeText('DB'),
              makeEl('topic/index-see', [makeEl('topic/indexterm', [makeText('Database')])]),
            ]),
          ]),
        ]),
      ]);
      const html = renderDocument(doc, defaultCtx);
      assert.ok(html.includes('see: Database') || html.includes('see:'), `expected a see annotation in: ${html}`);
    });

    it('renders indextermref with its keyref value', () => {
      const doc = makeEl('topic/topic', [
        makeEl('topic/body', [makeEl('topic/indextermref', [], { keyref: 'shared-index-entry' })]),
      ]);
      const html = renderDocument(doc, defaultCtx);
      assert.ok(html.includes('shared-index-entry'));
    });

    it('renders nothing for an indexterm with no text content at all (no crash, no empty chip noise)', () => {
      const doc = makeEl('topic/topic', [
        makeEl('topic/body', [makeEl('topic/p', [makeEl('topic/indexterm', [])])]),
      ]);
      const html = renderDocument(doc, defaultCtx);
      assert.ok(!html.includes('indexterm-chip'), `expected no chip for an empty indexterm, got: ${html}`);
    });

    it('falls back to the English "Index" label when indexLabel is not supplied', () => {
      const doc = makeEl('topic/topic', [
        makeEl('topic/body', [makeEl('topic/p', [makeEl('topic/indexterm', [makeText('term')])])]),
      ]);
      const html = renderDocument(doc, defaultCtx); // no indexLabel in defaultCtx
      assert.ok(html.includes('title="Index:'), `expected default Index label in: ${html}`);
    });

    it('uses the supplied localized indexLabel instead of the default', () => {
      const doc = makeEl('topic/topic', [
        makeEl('topic/body', [makeEl('topic/p', [makeEl('topic/indexterm', [makeText('term')])])]),
      ]);
      const html = renderDocument(doc, { ...defaultCtx, indexLabel: '索引' });
      assert.ok(html.includes('title="索引:'), `expected localized label in: ${html}`);
    });

    it('surfaces indexterm declared inside prolog/metadata/keywords (regression: the whole prolog subtree used to be suppressed unconditionally, silently dropping this very common topic-level index-entry placement)', () => {
      const doc = makeEl('topic/topic', [
        makeEl('topic/title', [makeText('T')]),
        makeEl('topic/prolog', [
          makeEl('topic/metadata', [
            makeEl('topic/keywords', [
              makeEl('topic/indexterm', [makeText('glossary')]),
            ], undefined, 'keywords'),
          ], undefined, 'metadata'),
        ], undefined, 'prolog'),
        makeEl('topic/body', [makeEl('topic/p', [makeText('Body text.')])]),
      ]);
      const html = renderDocument(doc, defaultCtx);
      assert.ok(html.includes('indexterm-chip'), `expected an indexterm chip surfaced from prolog in: ${html}`);
      assert.ok(html.includes('glossary'));
    });

    it('still suppresses every OTHER prolog descendant even when an indexterm is present alongside it', () => {
      const doc = makeEl('topic/topic', [
        makeEl('topic/title', [makeText('T')]),
        makeEl('topic/prolog', [
          makeText('Jane Secret Author'),
          makeEl('topic/keyword', [makeText('SECRET_KEYWORD_TOKEN')], undefined, 'keyword'),
          makeEl('topic/metadata', [
            makeEl('topic/keywords', [
              makeEl('topic/indexterm', [makeText('glossary')]),
            ], undefined, 'keywords'),
          ], undefined, 'metadata'),
        ], undefined, 'prolog'),
        makeEl('topic/body', [makeEl('topic/p', [makeText('Visible')])]),
      ]);
      const html = renderDocument(doc, defaultCtx);
      assert.ok(!html.includes('Jane Secret Author'), 'prolog author text must still not leak');
      assert.ok(!html.includes('SECRET_KEYWORD_TOKEN'), 'prolog keyword must still not leak');
      assert.ok(html.includes('indexterm-chip'), 'indexterm chip should still surface');
      assert.ok(html.includes('Visible'), 'body content should still render');
    });
  });
});
