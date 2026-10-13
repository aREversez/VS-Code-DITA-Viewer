import * as assert from 'assert';
import { formatXml, formatXmlRange, minimalEdit } from '../../language/xmlFormat';

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

  it('should put a block child of mixed content on its own line', () => {
    assert.strictEqual(
      fmt('<li>Intro text<ul><li>one</li></ul>tail</li>'),
      '<li>Intro text\n  <ul>\n    <li>one</li>\n  </ul>\n  tail</li>',
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

  it('should break attributes one per line, aligned, when asked', () => {
    assert.strictEqual(
      fmt('<root><img href="a.png" id="i" alt="x"/></root>', { breakLineBeforeAttribute: true }),
      '<root>\n  <img href="a.png"\n       id="i"\n       alt="x"/>\n</root>',
    );
  });

  it('should break only a start tag that exceeds the width when breakLongAttributes is on', () => {
    const src = '<root><a href="aaaaaaaaaa" id="bbbbbbbbbb"/><a x="1"/></root>';
    const out = fmt(src, { lineWidth: 30 });
    assert.ok(out.includes('<a href="aaaaaaaaaa"\n     id="bbbbbbbbbb"/>'));
    assert.ok(out.includes('<a x="1"/>'));
    assert.ok(!fmt(src, { lineWidth: 30, breakLongAttributes: false }).includes('\n     id='));
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
