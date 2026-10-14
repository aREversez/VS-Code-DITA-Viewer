import * as assert from 'assert';
import { OXYGEN_FORMATTED_SAMPLE } from './oxygenSample';
import { formatXml, formatXmlRange, minimalEdit, detectLineWidth } from '../../language/xmlFormat';

const fmt = (t: string, o = {}) => {
  const r = formatXml(t, o);
  if (!r.ok) throw new Error(r.message);
  return r.text;
};

describe('formatXml: recursive indentation', () => {
  it('should indent element-only content one level per depth', () => {
    assert.strictEqual(
      fmt('<root><a><y>t</y><z>t</z></a><w><v>t</v></w></root>\n'),
      '<root>\n  <a>\n    <y>t</y>\n    <z>t</z>\n  </a>\n  <w>\n    <v>t</v>\n  </w>\n</root>\n',
    );
  });

  it('should honour indentSize and useTabs', () => {
    assert.strictEqual(fmt('<a><y><z/></y></a>', { indentSize: 4 }), '<a>\n    <y>\n        <z/>\n    </y>\n</a>');
    assert.strictEqual(fmt('<a><y><z/></y></a>', { useTabs: true }), '<a>\n\t<y>\n\t\t<z/>\n\t</y>\n</a>');
  });

  it('should re-indent badly indented input', () => {
    assert.strictEqual(fmt('<a>\n<y>\n      <z/>\n</y>\n</a>'), '<a>\n  <y>\n    <z/>\n  </y>\n</a>');
  });

  it('should keep prolog items on their own lines and drop blank text between them', () => {
    const src = '<?xml version="1.0"?><!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA Topic//EN" "topic.dtd"><!-- c --><topic id="t"><title>T</title></topic>';
    assert.strictEqual(
      fmt(src),
      '<?xml version="1.0"?>\n<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA Topic//EN" "topic.dtd">\n<!-- c -->\n<topic id="t">\n  <title>T</title>\n</topic>',
    );
  });

  it('should keep a comment and a PI inside element-only content on their own lines', () => {
    assert.strictEqual(fmt('<a><!-- x --><y/><?pi y?></a>'), '<a>\n  <!-- x -->\n  <y/>\n  <?pi y?>\n</a>');
  });
});

describe('formatXml: mixed content and line wrapping', () => {
  it('should keep inline elements inline and normalize whitespace runs', () => {
    assert.strictEqual(fmt('<p>Click   <b>Save</b>\n  now.</p>'), '<p>Click <b>Save</b> now.</p>');
  });

  it('should not invent or drop the space between text and an inline element', () => {
    assert.strictEqual(fmt('<p>a<b>x</b> <i>y</i>z</p>'), '<p>a<b>x</b> <i>y</i>z</p>');
  });

  it('should wrap at the line width, continuing one level below the owner', () => {
    const words = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    const out = fmt(`<a><p>${words}</p></a>`, { lineWidth: 40 });
    const lines = out.split('\n');
    assert.ok(lines.length > 4);
    assert.ok(lines[1].startsWith('  <p>word0'));
    for (const l of lines.slice(2, -2)) {
      assert.ok(l.startsWith('    '), `continuation indent: ${JSON.stringify(l)}`);
      assert.ok(l.length <= 40, `width: ${JSON.stringify(l)}`);
    }
    assert.ok(lines[lines.length - 2].endsWith('word29</p>'));
  });

  it('should never break inside a glued run such as </b>, or at an entity', () => {
    const out = fmt('<p>aaaa bbbb<b>cccc</b>,&amp; dddd</p>', { lineWidth: 10 });
    assert.ok(out.includes('bbbb<b>cccc</b>,&amp;'));
  });

  it('should not wrap when lineWidth is 0', () => {
    const words = Array.from({ length: 50 }, () => 'word').join(' ');
    assert.strictEqual(fmt(`<p>${words}</p>`, { lineWidth: 0 }).split('\n').length, 1);
  });

  it('should keep a nested list in the text flow: only its children and end tag get their own lines', () => {
    assert.strictEqual(
      fmt('<li>Intro text<ul><li>one</li></ul>tail</li>'),
      '<li>Intro text<ul>\n    <li>one</li>\n  </ul>tail</li>',
    );
  });

  it('should keep the layout the source has between a multi-line child and the owner end tag', () => {
    // glued stays glued, a line break stays a line break (as Oxygen does)
    assert.strictEqual(
      fmt('<li>Intro: <ul id="u"><li>one</li></ul></li>'),
      '<li>Intro: <ul id="u">\n    <li>one</li>\n  </ul></li>',
    );
    assert.strictEqual(
      fmt('<li>Intro: <ul id="u"><li>one</li></ul>\n</li>'),
      '<li>Intro: <ul id="u">\n    <li>one</li>\n  </ul>\n</li>',
    );
    assert.strictEqual(
      fmt('<li>Intro: <ul id="u"><li>one</li></ul> </li>'),
      '<li>Intro: <ul id="u">\n    <li>one</li>\n  </ul></li>',
    );
  });

  it('should keep a line break behind a multi-line child in front of the text that follows', () => {
    assert.strictEqual(fmt('<li>a <ul><li>x</li></ul>\ntail</li>'), '<li>a <ul>\n    <li>x</li>\n  </ul>\n  tail</li>');
    assert.strictEqual(fmt('<li>a <ul><li>x</li></ul>\n   tail</li>'), fmt('<li>a <ul><li>x</li></ul>\ntail</li>'));
    assert.strictEqual(fmt('<li>a <ul><li>x</li></ul> tail</li>'), '<li>a <ul>\n    <li>x</li>\n  </ul> tail</li>');
  });

  it('should honour breakLineElements by starting those elements on their own line', () => {
    assert.strictEqual(
      fmt('<li>Intro<ul><li>one</li></ul></li>', { breakLineElements: ['ul'] }),
      '<li>Intro\n  <ul>\n    <li>one</li>\n  </ul></li>',
    );
  });
});

describe('formatXml: preserved and verbatim content', () => {
  it('should copy codeblock content verbatim', () => {
    const cb = '<codeblock>  a\n    b   c\n</codeblock>';
    assert.strictEqual(fmt(`<a><body>${cb}</body></a>`), `<a>\n  <body>\n    ${cb}\n  </body>\n</a>`);
  });

  it('should honour xml:space="preserve" and user-listed preserve elements', () => {
    assert.ok(fmt('<a><x xml:space="preserve">  q  </x></a>').includes('<x xml:space="preserve">  q  </x>'));
    assert.ok(fmt('<a><my>  q  </my></a>', { preserveSpaceElements: ['my'] }).includes('<my>  q  </my>'));
  });

  it('should keep CDATA, comments and entities untouched', () => {
    assert.strictEqual(fmt('<p>a <![CDATA[ x  y ]]> &nbsp;&#160; <!-- c  d --> z</p>'), '<p>a <![CDATA[ x  y ]]> &nbsp;&#160; <!-- c  d --> z</p>');
  });
});

describe('formatXml: empty elements and attributes', () => {
  it('should collapse or expand empty elements per option', () => {
    assert.strictEqual(fmt('<a><y></y><z> </z><w/></a>'), '<a>\n  <y/>\n  <z/>\n  <w/>\n</a>');
    assert.strictEqual(fmt('<a><y/></a>', { expandEmptyElements: true }), '<a>\n  <y></y>\n</a>');
  });

  it('should normalize attribute spacing but keep values and quote style', () => {
    assert.strictEqual(fmt(`<a   x = "1 > 2"   y='q' ></a>`), `<a x="1 > 2" y='q'/>`);
  });

  it('should put every attribute one level below the element when breakLineBeforeAttribute is on', () => {
    assert.strictEqual(
      fmt('<root><img href="a.png" id="i" alt="x"/></root>', { breakLineBeforeAttribute: true }),
      '<root>\n  <img\n    href="a.png"\n    id="i"\n    alt="x"/>\n</root>',
    );
  });

  it('should fill attributes up to the line width, continuing one level below the element', () => {
    const src = '<root><a href="aaaaaaaaaa" id="bbbbbbbbbb" scope="local" format="dita" type="topic" x="1"/><a x="1"/></root>';
    const out = fmt(src, { lineWidth: 40 });
    assert.ok(out.includes('<a href="aaaaaaaaaa" id="bbbbbbbbbb"\n    scope="local" format="dita"\n    type="topic" x="1"/>'), out);
    assert.ok(out.includes('<a x="1"/>'));
    for (const l of out.split('\n')) assert.ok(l.length <= 40, l);
    assert.ok(!fmt(src, { lineWidth: 40, breakLongAttributes: false }).includes('\n    scope='));
  });
});

describe('formatXml: layout verified against Oxygen output', () => {
  const o = { indentSize: 4, lineWidth: 80 };

  it('should keep <fig> in the text line, wrap its attribute when the line is already full, and keep </p> where the source had it', () => {
    const text = 'x'.repeat(66);
    const src = `<topic id="123"><body><p>${text}<fig id="fig_oyb_3zh_rjc"><title>T</title><image placement="break" href="../images/_1.png" scale="70" id="image_pyb_3zh_rjc"/></fig></p></body></topic>`;
    assert.strictEqual(
      fmt(src, o),
      [
        '<topic id="123">',
        '    <body>',
        `        <p>${text}<fig`,
        '                id="fig_oyb_3zh_rjc">',
        '                <title>T</title>',
        '                <image placement="break" href="../images/_1.png" scale="70"',
        '                    id="image_pyb_3zh_rjc"/>',
        '            </fig></p>',
        '    </body>',
        '</topic>',
      ].join('\n'),
    );
  });

  it('should wrap an <image> tag at width 80 (79 columns fit, 90 do not), as in the Oxygen sample', () => {
    const names = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'];
    const open = names.map((n) => `<${n}>`).join('');
    const close = [...names].reverse().map((n) => `</${n}>`).join('');
    const out = fmt(`${open}<image placement="break" href="../images/_2.png" scale="70" id="image_fcr_sgj_rjc"/>${close}`, o);
    assert.ok(out.includes(`\n${' '.repeat(32)}<image placement="break" href="../images/_2.png"\n${' '.repeat(36)}scale="70" id="image_fcr_sgj_rjc"/>\n`), out);
  });

  it('should keep a list in the item text, children one level deeper, </li> glued as in the source', () => {
    const src = '<ol id="o"><li>head: <ul id="u"><li><b>b1</b>: one</li><li><b>b2</b>: two</li></ul></li></ol>';
    assert.strictEqual(
      fmt(src, o),
      [
        '<ol id="o">',
        '    <li>head: <ul id="u">',
        '            <li><b>b1</b>: one</li>',
        '            <li><b>b2</b>: two</li>',
        '        </ul></li>',
        '</ol>',
      ].join('\n'),
    );
  });
});

describe('formatXml: Oxygen attribute/tag wrap parity (real samples)', () => {
  // Reproduced byte-for-byte from Oxygen "Format and Indent" output
  // (test-dita-file/manual/topics/lang-properties.dita and product_intro.dita,
  // both at line width 100). A start tag in mixed content is never relocated as
  // a whole: `<name` stays where it is, attributes fill and wrap one level below
  // the tag, and a closing bracket glued to an unbreakable run drops to a
  // continuation line together with that run.
  const wrap = { lineWidth: 100 };

  it('should keep <xref after the leading text and wrap its attributes one level below', () => {
    const src = '<concept id="x"><title>t</title><conbody><p>See <xref href="some_quite_long_target_topic_name.dita" format="dita" scope="peer" type="topic" keyref="product-name" id="xref_probe_001"/> for details.</p></conbody></concept>';
    assert.strictEqual(
      fmt(src, { indentSize: 4, ...wrap }),
      [
        '<concept id="x">',
        '    <title>t</title>',
        '    <conbody>',
        '        <p>See <xref href="some_quite_long_target_topic_name.dita" format="dita" scope="peer"',
        '                type="topic" keyref="product-name" id="xref_probe_001"/> for details.</p>',
        '    </conbody>',
        '</concept>',
      ].join('\n'),
    );
  });

  it('should glue the trailing <xref name to the text and drop only its attribute', () => {
    const src = '<concept id="x"><title>t</title><conbody><p>混排中文引导 <xref href="feature_alpha.dita" format="dita" scope="peer" type="topic"/> 与 <xref href="feature_beta.dita" format="dita" scope="peer" type="topic"/> 两段。</p></conbody></concept>';
    assert.strictEqual(
      fmt(src, { indentSize: 4, ...wrap }),
      [
        '<concept id="x">',
        '    <title>t</title>',
        '    <conbody>',
        '        <p>混排中文引导 <xref href="feature_alpha.dita" format="dita" scope="peer" type="topic"/> 与 <xref',
        '                href="feature_beta.dita" format="dita" scope="peer" type="topic"/> 两段。</p>',
        '    </conbody>',
        '</concept>',
      ].join('\n'),
    );
  });

  it('should drop an inline self-closing tag\'s bracket with the glued run that follows it', () => {
    const run =
      '（以下简称"中控主机"）采用四核处理器与本地场景引擎，即使外网中断，已配置的自动化场景依然可以在局域网内正常运行。主机正面配备触摸屏与环形氛围灯，背面提供千兆网口、USB 与电源接口。';
    const src = `<concept id="x"><title>t</title><conbody><p><ph keyref="product-name"/>${run}</p></conbody></concept>`;
    assert.strictEqual(
      fmt(src, { indentSize: 2, ...wrap }),
      [
        '<concept id="x">',
        '  <title>t</title>',
        '  <conbody>',
        '    <p><ph keyref="product-name"',
        '      />（以下简称"中控主机"）采用四核处理器与本地场景引擎，即使外网中断，已配置的自动化场景依然可以在局域网内正常运行。主机正面配备触摸屏与环形氛围灯，背面提供千兆网口、USB',
        '      与电源接口。</p>',
        '  </conbody>',
        '</concept>',
      ].join('\n'),
    );
  });

  it('should wrap an inline <xref attribute past the width and glue its closer', () => {
    const src = '<concept id="x"><title>t</title><conbody><ul><li><b>统一接入</b>：支持 Zigbee 3.0、红外与 Wi-Fi 设备接入，详见 <xref href="feature_zigbee.dita"/> 与 <xref href="feature_ir.dita"/>。</li></ul></conbody></concept>';
    assert.strictEqual(
      fmt(src, { indentSize: 2, ...wrap }),
      [
        '<concept id="x">',
        '  <title>t</title>',
        '  <conbody>',
        '    <ul>',
        '      <li><b>统一接入</b>：支持 Zigbee 3.0、红外与 Wi-Fi 设备接入，详见 <xref href="feature_zigbee.dita"/> 与 <xref',
        '          href="feature_ir.dita"/>。</li>',
        '    </ul>',
        '  </conbody>',
        '</concept>',
      ].join('\n'),
    );
  });

  it('should be idempotent for the wrapped inline tags', () => {
    const src = '<concept id="x"><title>t</title><conbody><p>See <xref href="some_quite_long_target_topic_name.dita" format="dita" scope="peer" type="topic" keyref="product-name" id="xref_probe_001"/> for details.</p></conbody></concept>';
    const once = fmt(src, { indentSize: 4, ...wrap });
    assert.strictEqual(fmt(once, { indentSize: 4, ...wrap }), once);
  });
});

describe('formatXml: Oxygen-formatted document', () => {
  it('should leave a document Oxygen formatted untouched (zero diff)', () => {
    const detected = detectLineWidth(OXYGEN_FORMATTED_SAMPLE, { indentSize: 4, lineWidth: 80 });
    assert.strictEqual(detected, 100);
    assert.strictEqual(fmt(OXYGEN_FORMATTED_SAMPLE, { indentSize: 4, lineWidth: detected as number }), OXYGEN_FORMATTED_SAMPLE);
  });

  it('should leave the same document untouched with every </fig></p>, </ul></li> glued, too', () => {
    // Oxygen keeps whichever layout the source has there; the formatter must not pick one for it.
    const glued = OXYGEN_FORMATTED_SAMPLE.replace(/(<\/(?:fig|ul)>)\n\s*(<\/(?:li|p)>)/g, '$1$2');
    assert.notStrictEqual(glued, OXYGEN_FORMATTED_SAMPLE);
    assert.strictEqual(fmt(glued, { indentSize: 4, lineWidth: 100 }), glued);
    // and a mixture of both
    let n = 0;
    const mixed = OXYGEN_FORMATTED_SAMPLE.replace(/(<\/(?:fig|ul)>)\n\s*(<\/(?:li|p)>)/g, (m, a, b) => (n++ % 2 ? m : a + b));
    assert.strictEqual(fmt(mixed, { indentSize: 4, lineWidth: 100 }), mixed);
  });

  it('should start a wrapped element-only child at its own depth + 1, the indent of its children', () => {
    const run = 'x'.repeat(70);
    const expected = ['<ol>', `    <li>${run}`, '            <fig id="f">', '            <title>T</title>', '        </fig></li>', '</ol>'].join('\n');
    // too long for the line (a space in front of it) ...
    assert.strictEqual(fmt(`<ol><li>${run} <fig id="f"><title>T</title></fig></li></ol>`, { indentSize: 4, lineWidth: 80 }), expected);
    // ... and a line break in the source in front of it is kept even when it would fit
    assert.strictEqual(fmt(`<ol><li>${'x'.repeat(10)}\n<fig id="f"><title>T</title></fig></li></ol>`, { indentSize: 4, lineWidth: 80 }).split('\n')[2], '            <fig id="f">');
  });

  it('should keep <ph .../> and the run behind it whole when only the <fig name follows in the line (width 100)', () => {
    const run = 'a'.repeat(38);
    const src = `<topic id="t"><body><p><ph keyref="product_name"/>${run}<fig id="fig_oyb_3zh_rjc"><title>T</title></fig></p></body></topic>`;
    const out = fmt(src, { indentSize: 4, lineWidth: 100 });
    assert.ok(out.includes(`        <p><ph keyref="product_name"/>${run}<fig\n                id="fig_oyb_3zh_rjc">\n`), out);
  });

  it('should keep the owner end tag glued after text, and after an inline element', () => {
    assert.strictEqual(fmt('<p>a <b>b</b> c</p>'), '<p>a <b>b</b> c</p>');
  });
});

describe('formatXml: a tag without attributes moves as a whole', () => {
  it('should wrap before <b>boldtext</b> instead of overflowing the line', () => {
    const out = fmt('<p>aaaa bbbb cccc dddd eeee ffff gggg <b>boldtext</b> tail</p>', { indentSize: 4, lineWidth: 40 });
    assert.strictEqual(out, '<p>aaaa bbbb cccc dddd eeee ffff gggg\n    <b>boldtext</b> tail</p>');
  });

  it('should still split a tag that has attributes at its <name', () => {
    const out = fmt('<p>aaaa bbbb cccc dddd eeee ffff <xref href="a_long_target.dita" scope="local">go</xref></p>', { indentSize: 4, lineWidth: 40 });
    assert.ok(out.split('\n').every((l) => l.length <= 40), out);
  });
});

describe('detectLineWidth', () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
  const base = { indentSize: 4, lineWidth: 80 };
  const doc = (paras: string[]) => `<topic id="t"><title>T</title><body>${paras.map((x) => `<p>${x}</p>`).join('')}</body></topic>\n`;

  it('should find the width an already wrapped document uses, so re-formatting is a no-op', () => {
    const wrapped = fmt(doc([words(60), words(45)]), { ...base, lineWidth: 100 });
    const detected = detectLineWidth(wrapped, base);
    assert.notStrictEqual(detected, null);
    assert.strictEqual(fmt(wrapped, { ...base, lineWidth: detected as number }), wrapped);
    assert.notStrictEqual(fmt(wrapped, base), wrapped, 'precondition: the configured width would reflow it');
  });

  it('should not be fooled by unbreakable runs longer than the width', () => {
    const wrapped = fmt(doc([words(60), '乙'.repeat(150), '甲'.repeat(140), words(30)]), { ...base, lineWidth: 100 });
    const detected = detectLineWidth(wrapped, base);
    assert.notStrictEqual(detected, null);
    assert.strictEqual(fmt(wrapped, { ...base, lineWidth: detected as number }), wrapped);
  });

  it('should measure tab indentation the way the formatter does', () => {
    const tabs = { indentSize: 4, useTabs: true };
    const wrapped = fmt('<a><b2><c2><d2><p>' + words(40) + '</p></d2></c2></b2></a>\n', { ...tabs, lineWidth: 60 });
    const detected = detectLineWidth(wrapped, { ...tabs, lineWidth: 80 });
    assert.notStrictEqual(detected, null);
    assert.strictEqual(fmt(wrapped, { ...tabs, lineWidth: detected as number }), wrapped);
  });

  it('should keep the configured width when the document is already stable at it', () => {
    assert.strictEqual(detectLineWidth(fmt(doc([words(60)]), base), base), null);
  });

  it('should keep the configured width for a hand-written document with one long line per paragraph', () => {
    const handWritten = `<topic id="t">\n    <body>\n        <p>${words(25)}</p>\n        <p>${words(25)}</p>\n    </body>\n</topic>\n`;
    assert.strictEqual(detectLineWidth(handWritten, base), null);
  });

  it('should return null for malformed, empty, or never-wrap input', () => {
    assert.strictEqual(detectLineWidth('<a><b></a>', base), null);
    assert.strictEqual(detectLineWidth('', base), null);
    assert.strictEqual(detectLineWidth(fmt(doc([words(60)]), { ...base, lineWidth: 100 }), { ...base, lineWidth: 0 }), null);
  });

  it('should cope with a very large document without throwing', () => {
    const big = '<a>\n' + Array.from({ length: 300000 }, () => '<b2/>').join('\n') + '\n</a>\n';
    assert.strictEqual(detectLineWidth(big, base), null);
  });

  it('should also detect in a CRLF document', () => {
    const wrapped = fmt(doc([words(60)]), { ...base, lineWidth: 100 }).replace(/\n/g, '\r\n');
    const detected = detectLineWidth(wrapped, base);
    assert.notStrictEqual(detected, null);
    const r = formatXml(wrapped, { ...base, lineWidth: detected as number }, '\r\n');
    assert.ok(r.ok && r.text === wrapped);
  });
});

describe('formatXml: invariants', () => {
  const samples = [
    '<topic id="t"><title>Hello <ph>wor<b>ld</b></ph></title><body><p>Some text with <xref href="a.dita">a link</xref>, and <codeph>code</codeph>.</p><ul><li>One</li><li>Two <b>bold</b><ul><li>nested</li></ul></li></ul><table><tgroup cols="2"><tbody><row><entry>a</entry><entry><p>b</p></entry></row></tbody></tgroup></table></body></topic>',
    '<map><title>M</title><topicref href="a.dita"><topicref href="b.dita"/></topicref><!-- c --></map>',
    '<p>   lead and trail   </p>',
  ];
  const widths = [0, 20, 60, 100];

  for (const [idx, s] of samples.entries()) {
    for (const lineWidth of widths) {
      it(`should be idempotent (sample ${idx}, width ${lineWidth})`, () => {
        const once = fmt(s, { lineWidth });
        assert.strictEqual(fmt(once, { lineWidth }), once);
      });
      it(`should preserve tags and whitespace-normalized text (sample ${idx}, width ${lineWidth})`, () => {
        const strip = (t: string) => t.replace(/\s+/g, '');
        assert.strictEqual(strip(fmt(s, { lineWidth })), strip(s).replace(/<(\w+)([^>/]*)><\/\1>/g, '<$1$2/>'));
      });
    }
  }

  it('should refuse a document that is not well-formed, never repair it', () => {
    const r = formatXml('<a><b></a>');
    assert.strictEqual(r.ok, false);
  });

  it('should use the requested line terminator and keep CRLF input stable', () => {
    const r = formatXml('<a>\r\n<y>t</y>\r\n</a>\r\n', {}, '\r\n');
    assert.ok(r.ok && r.text === '<a>\r\n  <y>t</y>\r\n</a>\r\n');
  });
});

describe('formatXmlRange', () => {
  const doc = '<a>\n<y>\n<z>t</z>\n</y>\n<w><v/></w>\n</a>\n';

  it('should format only the selected element, at its own depth', () => {
    const s = doc.indexOf('<y>');
    const e = doc.indexOf('</y>') + 4;
    const r = formatXmlRange(doc, s, e);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.strictEqual(r.edits.length, 1);
    const applied = doc.slice(0, r.edits[0].start) + r.edits[0].newText + doc.slice(r.edits[0].end);
    assert.strictEqual(applied, '<a>\n  <y>\n    <z>t</z>\n  </y>\n<w><v/></w>\n</a>\n');
  });

  it('should widen a selected inline element to the paragraph that owns the flow', () => {
    const d = '<a>\n<p>one   <y>two</y>   three</p>\n</a>\n';
    const s = d.indexOf('<y>');
    const r = formatXmlRange(d, s, s + 8);
    assert.ok(r.ok);
    if (!r.ok) return;
    const applied = d.slice(0, r.edits[0].start) + r.edits[0].newText + d.slice(r.edits[0].end);
    assert.strictEqual(applied, '<a>\n  <p>one <y>two</y> three</p>\n</a>\n');
  });

  it('should report malformed documents', () => {
    assert.strictEqual(formatXmlRange('<a><y></a>', 0, 3).ok, false);
  });
});

describe('minimalEdit', () => {
  it('should return null for equal text and the smallest span otherwise', () => {
    assert.strictEqual(minimalEdit('abc', 'abc'), null);
    assert.deepStrictEqual(minimalEdit('<a>x</a>', '<a>yy</a>'), { start: 3, end: 4, newText: 'yy' });
  });
});
