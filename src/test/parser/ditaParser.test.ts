import * as assert from 'assert';
import { parseDita, preprocessEntities } from '../../parser/ditaParser';
describe('ditaParser', () => {
  it('should parse a minimal topic with title and shortdesc', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA Topic//EN" "topic.dtd">
<topic id="test">
  <title>Test Title</title>
  <shortdesc>A short description.</shortdesc>
</topic>`;
    const doc = parseDita(xml);
    assert.strictEqual(doc.root.tagName, 'topic');
    assert.strictEqual(doc.root.baseType, 'topic/topic');
    const elements = doc.root.children.filter(
      (c) => c.type === 'element',
    );
    assert.strictEqual(elements.length, 2);

    const title = elements[0];
    assert.strictEqual(title.baseType, 'topic/title');
    assert.strictEqual(title.children[0].text, 'Test Title');

    const shortdesc = elements[1];
    assert.strictEqual(shortdesc.baseType, 'topic/shortdesc');
  });

  it('should map tagName to baseType via STANDARD_TAG_TO_BASETYPE', () => {
    const xml = `<topic id="t"><body><p>para</p><note type="warning">note</note></body></topic>`;
    const doc = parseDita(xml);
    const body = doc.root.children[0];
    assert.strictEqual(body.baseType, 'topic/body');
    const p = body.children[0];
    assert.strictEqual(p.baseType, 'topic/p');
    const note = body.children[1];
    assert.strictEqual(note.baseType, 'topic/note');
    assert.strictEqual(note.attributes?.type, 'warning');
  });

  it('should fall back to class attribute when tag is not in standard map', () => {
    const xml = `<topic id="t"><body><customElement class="- topic/p mydomain/myelem ">text</customElement></body></topic>`;
    const doc = parseDita(xml);
    const body = doc.root.children[0];
    const custom = body.children[0];
    assert.strictEqual(custom.tagName, 'customElement');
    assert.strictEqual(custom.baseType, 'topic/p');
    assert.deepStrictEqual(custom.classTokens, ['-', 'topic/p', 'mydomain/myelem']);
  });

  it('should set baseType to undefined for unknown tag without class', () => {
    const xml = `<topic id="t"><body><unknown>text</unknown></body></topic>`;
    const doc = parseDita(xml);
    const body = doc.root.children[0];
    const unknown = body.children[0];
    assert.strictEqual(unknown.tagName, 'unknown');
    assert.strictEqual(unknown.baseType, undefined);
  });

  it('should handle lists properly', () => {
    const xml = `<topic id="t"><body><ol><li>one</li><li>two</li></ol></body></topic>`;
    const doc = parseDita(xml);
    const body = doc.root.children[0];
    const ol = body.children[0];
    assert.strictEqual(ol.baseType, 'topic/ol');
    assert.strictEqual(ol.children.length, 2);
    assert.strictEqual(ol.children[0].baseType, 'topic/li');
  });

  it('should parse CALS table structure', () => {
    const xml = `<topic id="t"><body><table><tgroup cols="2"><colspec colname="c1"/><thead><row><entry>H1</entry></row></thead><tbody><row><entry>D1</entry></row></tbody></tgroup></table></body></topic>`;
    const doc = parseDita(xml);
    const body = doc.root.children[0];
    const table = body.children[0];
    assert.strictEqual(table.baseType, 'topic/table');
    const tgroup = table.children[0];
    assert.strictEqual(tgroup.baseType, 'topic/tgroup');
  });

  it('should preserve sourceRange on elements', () => {
    const xml = `<topic id="t"><title>Hello</title></topic>`;
    const doc = parseDita(xml);
    assert.ok(doc.root.sourceRange.startLine >= 0);
    const title = doc.root.children[0];
    assert.ok(title.sourceRange.startLine >= 0);
    assert.ok(title.sourceRange.endLine >= title.sourceRange.startLine);
  });

  it('should handle inline formatting elements', () => {
    const xml = `<topic id="t"><body><p><b>bold</b> and <i>italic</i></p></body></topic>`;
    const doc = parseDita(xml);
    const body = doc.root.children[0];
    const p = body.children[0];
    assert.strictEqual(p.children[0].baseType, 'topic/b');
    assert.strictEqual(p.children[2].baseType, 'topic/i');
  });

  it('should handle codeblock and pre', () => {
    const xml = `<topic id="t"><body><codeblock>code here</codeblock><pre>pre text</pre></body></topic>`;
    const doc = parseDita(xml);
    const body = doc.root.children[0];
    assert.strictEqual(body.children[0].baseType, 'topic/codeblock');
    assert.strictEqual(body.children[1].baseType, 'topic/pre');
  });

  // ── preprocessEntities tests ──

  it('should strip DOCTYPE with PUBLIC ID and no internal subset', () => {
    const xml = `<?xml version="1.0"?>
<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA Topic//EN" "topic.dtd">
<topic id="t"><title>Test</title></topic>`;
    const processed = preprocessEntities(xml);
    assert.ok(!processed.includes('<!DOCTYPE'), 'DOCTYPE should be stripped');
    assert.ok(processed.includes('<topic'), 'topic element should remain');
    const doc = parseDita(processed);
    assert.strictEqual(doc.root.tagName, 'topic');
  });

  it('should strip DOCTYPE with internal subset and resolve entities', () => {
    const xml = `<?xml version="1.0"?>
<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA Topic//EN" "topic.dtd" [
  <!ENTITY product "MyProduct">
  <!ENTITY version "2.0">
]>
<topic id="t"><title>&product; &version;</title></topic>`;
    const processed = preprocessEntities(xml);
    assert.ok(!processed.includes('<!DOCTYPE'), 'DOCTYPE should be stripped');
    assert.ok(!processed.includes('&product;'), 'entity should be resolved');
    assert.ok(processed.includes('MyProduct'), 'entity value should appear');
    assert.ok(processed.includes('2.0'), 'entity value should appear');
    const doc = parseDita(processed);
    assert.strictEqual(doc.root.tagName, 'topic');
  });

  it('should strip DOCTYPE with only internal subset (no PUBLIC ID)', () => {
    const xml = `<!DOCTYPE topic [
  <!ENTITY foo "bar">
]>
<topic id="t"><p>&foo;</p></topic>`;
    const processed = preprocessEntities(xml);
    assert.ok(!processed.includes('<!DOCTYPE'), 'DOCTYPE should be stripped');
    assert.ok(processed.includes('bar'), 'entity should be resolved');
    const doc = parseDita(processed);
    assert.strictEqual(doc.root.tagName, 'topic');
  });

  it('should remove undeclared entity references to prevent parse errors', () => {
    const xml = `<topic id="t"><p>Text with &undeclared; entity</p></topic>`;
    const processed = preprocessEntities(xml);
    assert.ok(!processed.includes('&undeclared;'), 'undeclared entity should be removed');
    assert.ok(processed.includes('Text with'), 'surrounding text should remain');
    // Should parse without error
    const doc = parseDita(processed);
    assert.strictEqual(doc.root.tagName, 'topic');
  });

  it('should preserve built-in XML entities', () => {
    const xml = `<topic id="t"><p>&lt;tag&gt; &amp; &quot;stuff&quot;</p></topic>`;
    const processed = preprocessEntities(xml);
    assert.ok(processed.includes('&amp;'), 'amp entity should be preserved');
    assert.ok(processed.includes('&lt;'), 'lt entity should be preserved');
    assert.ok(processed.includes('&gt;'), 'gt entity should be preserved');
    assert.ok(processed.includes('&quot;'), 'quot entity should be preserved');
    const doc = parseDita(processed);
    assert.strictEqual(doc.root.tagName, 'topic');
  });

  it('should parse DITA file with DOCTYPE and entity refs used in conref target', () => {
    // Simulates a typical conref target file
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA Topic//EN" "topic.dtd" [
  <!ENTITY prod "SuperApp">
]>
<topic id="conref">
  <title>Reuse</title>
  <body>
    <p id="note_script">Run &prod; with <filepath>.fscript</filepath></p>
  </body>
</topic>`;
    const processed = preprocessEntities(xml);
    const doc = parseDita(processed);
    assert.strictEqual(doc.root.tagName, 'topic');
    // Find element with id="note_script"
    const findEl = (node: typeof doc.root, id: string): typeof doc.root | undefined => {
      if (node.attributes?.id === id) return node;
      for (const child of node.children || []) {
        if (child.type === 'element') {
          const found = findEl(child, id);
          if (found) return found;
        }
      }
      return undefined;
    };
    const el = findEl(doc.root, 'note_script');
    assert.ok(el, 'should find element with id=note_script');
    assert.strictEqual(el!.baseType, 'topic/p');
  });
});
