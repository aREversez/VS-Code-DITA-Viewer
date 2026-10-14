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
      fmt('<root>\n  <a>\n    <y>t</y>\n    <z>t</z>\n  </a>\n  <w>\n    <v>t</v>\n  </w>\n</root>\n'),
      '<root>\n  <a>\n    <y>t</y>\n    <z>t</z>\n  </a>\n  <w>\n    <v>t</v>\n  </w>\n</root>\n',
    );
  });

  it('should honour indentSize and useTabs', () => {
    // A source whose <y> children are glued with zero gap collapses under the
    // Oxygen rule, so break them apart to exercise indentSize and useTabs in
    // isolation.
    assert.strictEqual(
      fmt('<a>\n  <y>\n    <z/>\n    <w/>\n  </y>\n</a>', { indentSize: 4 }),
      '<a>\n    <y>\n        <z/>\n        <w/>\n    </y>\n</a>',
    );
    assert.strictEqual(
      fmt('<a>\n  <y>\n    <z/>\n    <w/>\n  </y>\n</a>', { useTabs: true }),
      '<a>\n\t<y>\n\t\t<z/>\n\t\t<w/>\n\t</y>\n</a>',
    );
  });

  it('should re-indent badly indented input', () => {
    assert.strictEqual(fmt('<a>\n<y>\n      <z/>\n</y>\n</a>'), '<a>\n  <y>\n    <z/>\n  </y>\n</a>');
  });

  it('should keep prolog items on their own lines and drop blank text between them', () => {
    // The `<topic>` in the source has whitespace around `<title>`; if it were
    // glued the collapse rule would keep the pair on one line. The test checks
    // prolog-level line structure, not collapse.
    const src = '<?xml version="1.0"?><!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA Topic//EN" "topic.dtd"><!-- c --><topic id="t">\n  <title>T</title>\n</topic>';
    assert.strictEqual(
      fmt(src),
      '<?xml version="1.0"?>\n<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA Topic//EN" "topic.dtd">\n<!-- c -->\n<topic id="t">\n  <title>T</title>\n</topic>',
    );
  });

  it('should keep a comment and a PI inside element-only content on their own lines', () => {
    assert.strictEqual(fmt('<a><!-- x --><y/><?pi y?></a>'), '<a>\n  <!-- x -->\n  <y/>\n  <?pi y?>\n</a>');
  });

  it('should collapse an element-only parent with a single self-closing child that has no source whitespace around it', () => {
    // Oxygen keeps `<vrmlist><vrm version="1.0"/></vrmlist>` on the line the source had it;
    // `<prodname><keyword keyref="product-name"/></prodname>` likewise, with or without
    // attributes on the parent. A source that already broke them out stays broken out.
    assert.strictEqual(
      fmt('<metadata><prodname><keyword keyref="product-name"/></prodname><vrmlist><vrm version="1.0"/></vrmlist></metadata>'),
      // 96 chars at the top level does not fit width 80, so `<metadata>` stays broken
      // out; its two children each fit and collapse.
      '<metadata>\n  <prodname><keyword keyref="product-name"/></prodname>\n  <vrmlist><vrm version="1.0"/></vrmlist>\n</metadata>',
    );
    assert.strictEqual(
      fmt('<metadata><prodname>\n  <keyword keyref="product-name"/>\n</prodname></metadata>'),
      '<metadata>\n  <prodname>\n    <keyword keyref="product-name"/>\n  </prodname>\n</metadata>',
    );
    // The recursive collapse covers single-child chains and text leaves too:
    // `<a><y><z>t</z></y></a>` (17 chars, zero-gap source) fits width 80 and
    // stays on one line, matching Oxygen's treatment of `<p><codeph>x</codeph></p>`.
    assert.strictEqual(fmt('<a><y><z>t</z></y></a>'), '<a><y><z>t</z></y></a>');
    // A source newline in front of the leaf still refuses collapse (whitespace
    // gap between `<y>` and `<z>` breaks the zero-gap rule).
    assert.strictEqual(fmt('<a><y>\n  <z>t</z>\n</y></a>'), '<a>\n  <y>\n    <z>t</z>\n  </y>\n</a>');
    // no collapse when breakLineBeforeAttribute or expandEmptyElements are on
    assert.ok(fmt('<a id="x"><y n="1"/></a>', { breakLineBeforeAttribute: true }).includes('\n'));
    assert.ok(!fmt('<a id="x"><y n="1"/></a>', { expandEmptyElements: true }).includes('<a id="x"><y n="1"/></a>'));
  });

  it('should glue a comment that had no whitespace behind a real close tag in element-only content', () => {
    // Oxygen keeps `</p><!-- trailing note -->` on the same line when the
    // source glued them, and breaks a comment that stood on its own line.
    assert.strictEqual(
      fmt('<section>\n  <p>a</p><!-- tail -->\n</section>'),
      '<section>\n  <p>a</p><!-- tail -->\n</section>',
    );
    assert.strictEqual(
      fmt('<section>\n  <p>a</p>\n  <!-- own line -->\n</section>'),
      '<section>\n  <p>a</p>\n  <!-- own line -->\n</section>',
    );
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
    // A space there is a gap too: Oxygen puts `</li>` on its own line (seen
    // with a source flattened onto a single line).
    assert.strictEqual(
      fmt('<li>Intro: <ul id="u"><li>one</li></ul> </li>'),
      '<li>Intro: <ul id="u">\n    <li>one</li>\n  </ul>\n</li>',
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
  const legacy = {};

  it('should leave a document Oxygen formatted untouched (zero diff)', () => {
    const detected = detectLineWidth(OXYGEN_FORMATTED_SAMPLE, { indentSize: 4, lineWidth: 80, ...legacy });
    assert.strictEqual(detected, 100);
    assert.strictEqual(fmt(OXYGEN_FORMATTED_SAMPLE, { indentSize: 4, lineWidth: detected as number, ...legacy }), OXYGEN_FORMATTED_SAMPLE);
  });

  it('should leave the same document untouched with every </fig></p>, </ul></li> glued, too', () => {
    // Oxygen keeps whichever layout the source has there; the formatter must not pick one for it.
    const glued = OXYGEN_FORMATTED_SAMPLE.replace(/(<\/(?:fig|ul)>)\n\s*(<\/(?:li|p)>)/g, '$1$2');
    assert.notStrictEqual(glued, OXYGEN_FORMATTED_SAMPLE);
    assert.strictEqual(fmt(glued, { indentSize: 4, lineWidth: 100, ...legacy }), glued);
    // and a mixture of both
    let n = 0;
    const mixed = OXYGEN_FORMATTED_SAMPLE.replace(/(<\/(?:fig|ul)>)\n\s*(<\/(?:li|p)>)/g, (m, a, b) => (n++ % 2 ? m : a + b));
    assert.strictEqual(fmt(mixed, { indentSize: 4, lineWidth: 100, ...legacy }), mixed);
  });

  it('should start a wrapped element-only child at its own depth + 1, the indent of its children', () => {
    const run = 'x'.repeat(70);
    const expected = ['<ol>', `    <li>${run}`, '            <fig id="f">', '            <title>T</title>', '        </fig></li>', '</ol>'].join('\n');
    // too long for the line (a space in front of it) ...
    assert.strictEqual(fmt(`<ol><li>${run} <fig id="f"><title>T</title></fig></li></ol>`, { indentSize: 4, lineWidth: 80, ...legacy }), expected);
    // ... and a line break in the source in front of it is kept even when it would fit
    assert.strictEqual(fmt(`<ol><li>${'x'.repeat(10)}\n<fig id="f"><title>T</title></fig></li></ol>`, { indentSize: 4, lineWidth: 80, ...legacy }).split('\n')[2], '            <fig id="f">');
  });

  it('should count an attribute as fitting when it ends within the width, not the ">" behind it', () => {
    const run = 'x'.repeat(81); // `    <li>` + run + `<fig id="f"` ends at column 100; the `>` is column 101
    const out = fmt(`<ol><li>${run}<fig id="f"><title>T</title></fig></li></ol>`, { indentSize: 4, lineWidth: 100, ...legacy });
    assert.strictEqual(out.split('\n')[1], `    <li>${run}<fig id="f">`);
    const over = fmt(`<ol><li>${run}x<fig id="f"><title>T</title></fig></li></ol>`, { indentSize: 4, lineWidth: 100, ...legacy });
    assert.strictEqual(over.split('\n')[1], `    <li>${run}x<fig`);
  });

  it('should start an inline element that wraps onto a line of its own at its depth + 1, and the text behind it at depth + 1 of the owner', () => {
    assert.strictEqual(
      fmt('<p>aaaa bbbb cccc dddd <uicontrol>x</uicontrol> tail</p>', { indentSize: 4, lineWidth: 30, ...legacy }),
      '<p>aaaa bbbb cccc dddd\n        <uicontrol>x</uicontrol>\n    tail</p>',
    );
  });

  it('should honour the source\'s own indent when an inline start tag follows a line break', () => {
    // Oxygen's real behaviour in a mixed flow: a source that already indented
    // `<sup>` at column 10 keeps it at column 10; a line break at a column
    // shallower than the continuation indent is only whitespace (a source with
    // no indentation at all was formatted by Oxygen onto the same line).
    const p = '<topic id="t"><body><section><p>a <term>t</term>、\n{lead}<sup>s</sup> tail</p></section></body></topic>';
    const withLead = (lead: string) => fmt(p.replace('{lead}', lead), { indentSize: 2, lineWidth: 200 });
    assert.ok(withLead('            ').split('\n').some((l) => /^ {12}<sup>s<\/sup>/.test(l)), 'deep source indent preserved');
    assert.ok(withLead('').split('\n').some((l) => l.includes('、 <sup>s</sup> tail')), 'a col-0 break is joined back up');
    // and the result is idempotent in both cases
    for (const lead of ['            ', '']) {
      const once = withLead(lead);
      assert.strictEqual(fmt(once, { indentSize: 2, lineWidth: 200 }), once);
    }
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
    // a tag that wraps onto a line of its own sits at its own depth + 1, like Oxygen's <uicontrol>
    assert.strictEqual(out, '<p>aaaa bbbb cccc dddd eeee ffff gggg\n        <b>boldtext</b> tail</p>');
  });

  it('should still split a tag that has attributes at its <name', () => {
    const out = fmt('<p>aaaa bbbb cccc dddd eeee ffff <xref href="a_long_target.dita" scope="local">go</xref></p>', { indentSize: 4, lineWidth: 40 });
    assert.ok(out.split('\n').every((l) => l.length <= 40), out);
  });
});

describe('detectLineWidth', () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
  // Detection needs mixed-content reflow on: the whole point of detecting a
  // width is that a document was hard-wrapped at some prose width and re-
  // formatting should reproduce the layout. Modern Oxygen leaves prose on
  // single long lines and only wraps attributes, and there is nothing for
  // detection to lock onto in that shape.
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

describe('formatXml: Oxygen parity from a second stress sample', () => {
  // Each case is a paragraph from an Oxygen-formatted file (line width 100,
  // indent 2). Oxygen counts a line's width in characters (UTF-16 code units),
  // so a CJK character is one column — not two.
  const o = { indentSize: 2, lineWidth: 100 };
  const inSection = (body: string) =>
    `<concept id="c">\n  <conbody>\n    <section>\n${body}\n    </section>\n  </conbody>\n</concept>`;
  const same = (body: string) => assert.strictEqual(fmt(inSection(body), o), inSection(body));

  it('should reserve the whole end tag of the owner when deciding to wrap (101 columns wrap, 100 fit)', () => {
    const p =
      '      <p>属性值内含空格与引号：<q type="quote">"引号内空格"</q>，<parmname dtuse="name">some parm\n' +
      '        name</parmname>。</p>';
    same(p);
    // Re-flowing the same paragraph from a single line lands on the same layout.
    assert.strictEqual(fmt(inSection(p.replace('\n        ', ' ')), o), inSection(p));
    // One column less and the paragraph fits on a line.
    const short = fmt(inSection(p.replace('some parm\n        name', 'some pa\n        name')), o);
    assert.ok(short.includes('some pa name</parmname>。</p>'), short);
  });

  it('should keep a wrapped text line at the source column when that is deeper than the owner + 1', () => {
    same(
      '      <p>实体引用：<b>&amp;&lt;&gt;&quot;&apos;</b>，数字引用：&#x4F60;&#x597D;，Unicode：<tt>αβγδ ΔΘΛΞ ΠΣΦΨΩ\n' +
        '          你好世界 🎉</tt>。</p>',
    );
    const sd =
      '<concept id="c">\n  <title>t</title>\n' +
      '  <shortdesc> 本文是 <ph keyref="product-name"/> 的第二版压力样本，覆盖 nlCols 驱动的 inline 起始标签定位、tailRun 换行、注释\n' +
      '      glue、<codeph>&lt;data&gt;</codeph> 折叠、属性 wrap 与深度嵌套的块级内容。 </shortdesc>\n</concept>';
    assert.strictEqual(fmt(sd, o), sd);
  });

  it('should leave Oxygen\'s own wrapped ">" of an inline start tag untouched', () => {
    same(
      '      <p>下面三段完全等价、只差源码缩进：0 列 / 4 列 / 12 列。Oxygen 会分别落到 cont（=8）、cont（=8）、12 列。 <ph audience="probe"\n' +
        '          >A</ph> 结束。</p>',
    );
    same(
      '      <p>已展开的空元素：<ph id="empty-1"/><ph id="empty-2"/><ph id="empty-3"> </ph><ph id="empty-4"\n' +
        '          >&#x20;</ph>。</p>',
    );
  });

  it('should leave Oxygen\'s own wrapped "/>" of a self-closing tag untouched', () => {
    same(
      '      <p>属性已换行的自闭合：<image href="../images/very/long/path/to/some/deeply/nested/reusable/asset.svg"\n' +
        '          width="640" height="480" placement="break" align="center" scale="70" id="img-a"\n' +
        '        />，图片段落尾随说明。</p>',
    );
  });

  it('should keep a glued run together and wrap only the start tag that does not fit', () => {
    // The chunk `</ph><ph id="empty-4"` counts up to the next tag's `<name`.
    const src = inSection(
      '      <p>已展开的空元素：<ph id="empty-1"/><ph id="empty-2"/><ph id="empty-3"> </ph><ph id="empty-4">&#x20;</ph>。</p>',
    );
    const out = fmt(src, o);
    assert.ok(out.includes('<ph id="empty-3"> </ph><ph id="empty-4"\n'), out);
  });

  it('should write a too-long chain of single children of a mixed-content element as one glued run', () => {
    const chain =
      '      <p><data name="prolog-mirror-c"><data name="prolog-mirror-d"><data name="prolog-mirror-e"\n' +
      '              value="2"/></data></data></p>';
    same(chain);
    assert.strictEqual(
      fmt(inSection(chain.replace('\n              ', ' ')), o),
      inSection(chain),
    );
    // An element that is not mixed by schema still expands one child per line.
    const t = fmt(inSection('<t1><t2><t3><t4 name="prolog-mirror-e-with-a-long-name" value="2222222222222222222222222222222222222"/></t3></t2></t1>'), o);
    assert.ok(t.includes('<t1>\n'), t);
  });
});

describe('formatXml: Oxygen layout of sources that carry no layout', () => {
  // Inputs are one-line (whitespace-flattened) versions of paragraphs of
  // format_indent_stress2.dita; the expectations are what Oxygen wrote for
  // that flattened file (line width 100, indent 2). Nothing in these sources
  // tells the formatter where a line break or an indent column belongs.
  const o = { indentSize: 2, lineWidth: 100 };
  const inSection = (body: string) =>
    `<concept id="c">\n  <conbody>\n    <section>\n${body}\n    </section>\n  </conbody>\n</concept>`;
  const flat = (src: string, expected: string) => assert.strictEqual(fmt(inSection(src), o), inSection(expected));

  it('should put ">" of a wrapped start tag at the tag\'s content level (depth + 1)', () => {
    flat(
      '      <p>下面三段完全等价、只差源码缩进：0 列 / 4 列 / 12 列。Oxygen 会分别落到 cont（=8）、cont（=8）、12 列。 <ph audience="probe">A</ph> 结束。</p>',
      '      <p>下面三段完全等价、只差源码缩进：0 列 / 4 列 / 12 列。Oxygen 会分别落到 cont（=8）、cont（=8）、12 列。 <ph audience="probe"\n' +
        '          >A</ph> 结束。</p>',
    );
    flat(
      '      <p>已展开的空元素：<ph id="empty-1"/><ph id="empty-2"/><ph id="empty-3"> </ph><ph id="empty-4">&#x20;</ph>。</p>',
      '      <p>已展开的空元素：<ph id="empty-1"/><ph id="empty-2"/><ph id="empty-3"> </ph><ph id="empty-4"\n' +
        '          >&#x20;</ph>。</p>',
    );
  });

  it('should put "/>" of a wrapped self-closing tag under its own "<", even after wrapped attributes', () => {
    flat(
      '      <p>属性已换行的自闭合：<image href="../images/very/long/path/to/some/deeply/nested/reusable/asset.svg" width="640" height="480" placement="break" align="center" scale="70" id="img-a"/>，图片段落尾随说明。</p>',
      '      <p>属性已换行的自闭合：<image href="../images/very/long/path/to/some/deeply/nested/reusable/asset.svg"\n' +
        '          width="640" height="480" placement="break" align="center" scale="70" id="img-a"\n' +
        '        />，图片段落尾随说明。</p>',
    );
  });

  it('should start a block after another block on its own line, and end the owner on its own line behind a block', () => {
    flat(
      '      <ol> <li>第一项<ul compact="yes"> <li>1.1 简单项</li> <li>1.2 项内段落<p>段落文本。</p></li> <li>1.3 项内注释与段落<p>说明段。</p> <note type="tip">项内 tip。</note> </li> </ul> </li> <li>第二项</li> </ol>',
      [
        '      <ol>',
        '        <li>第一项<ul compact="yes">',
        '            <li>1.1 简单项</li>',
        '            <li>1.2 项内段落<p>段落文本。</p></li>',
        '            <li>1.3 项内注释与段落<p>说明段。</p>',
        '              <note type="tip">项内 tip。</note>',
        '            </li>',
        '          </ul>',
        '        </li>',
        '        <li>第二项</li>',
        '      </ol>',
      ].join('\n'),
    );
  });

  it('should not move a block that follows plain text onto a line of its own', () => {
    const p = '      <p>段末紧接 <note type="notice">段间提醒，仅一行。</note> 尾文本。</p>';
    flat(p, p);
  });

  it('should join a line break at a shallower column than the continuation indent back up when the tag fits', () => {
    const src =
      '<concept id="c"><conbody><p>等价 <term>t1</term>、 <keyword>k1</keyword> 之后是文本，源码里\n<uicontrol>x</uicontrol> 位于 0 列。</p></conbody></concept>';
    assert.ok(fmt(src, o).includes('源码里 <uicontrol>x</uicontrol> 位于 0 列。</p>'), fmt(src, o));
  });
});
