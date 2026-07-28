import * as assert from 'assert';
import {
  collectIds,
  collectMapSymbols,
  collectRefEntries,
  collectTopicSymbols,
  findConrefTargetOffset,
  findKeyDefinitionOffset,
  findRefAttrAt,
  findUnclosedTag,
  getAttributesForTag,
  getAutoCloseTag,
  getCloseTagCompletion,
  getCompletionContext,
  getMapRefName,
  isExternalRef,
  offsetToLineCol,
} from '../../language/ditaLanguageUtils';
import { parseDita, parseDitamap } from '../../parser/ditaParser';
import { collectMapEntries, createBookRoleLabeler } from '../../render/mapTypeMap';

describe('ditaLanguageUtils', () => {
  describe('collectRefEntries', () => {
    it('collects href, conref, conkeyref and keyref attributes', () => {
      const text =
        '<xref href="a.dita"/><p conref="b.dita#t/e"/><ph conkeyref="k/el"/><keyword keyref="prod"/>';
      const entries = collectRefEntries(text);
      assert.deepStrictEqual(
        entries.map((e) => [e.attr, e.value, e.tagName]),
        [
          ['href', 'a.dita', 'xref'],
          ['conref', 'b.dita#t/e', 'p'],
          ['conkeyref', 'k/el', 'ph'],
          ['keyref', 'prod', 'keyword'],
        ],
      );
    });

    it('reports exact value offsets', () => {
      const text = '<xref href="topic.dita">x</xref>';
      const [entry] = collectRefEntries(text);
      assert.strictEqual(text.substring(entry.valueStart, entry.valueEnd), 'topic.dita');
    });

    it('captures scope and format from the same tag', () => {
      const text = '<xref href="https://x.com" scope="external" format="html"/>';
      const [entry] = collectRefEntries(text);
      assert.strictEqual(entry.scope, 'external');
      assert.strictEqual(entry.format, 'html');
    });

    it('ignores attributes outside of tags and non-ref attributes', () => {
      const text = '<p id="x">href="fake.dita"</p>';
      assert.strictEqual(collectRefEntries(text).length, 0);
    });

    it('handles multi-line tags', () => {
      const text = '<topicref\n  href="topics/a.dita"\n  keys="a"/>';
      const entries = collectRefEntries(text);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].value, 'topics/a.dita');
    });
  });

  describe('findRefAttrAt', () => {
    it('finds the entry containing the offset', () => {
      const text = '<xref href="topic.dita">x</xref>';
      const inside = text.indexOf('topic.dita') + 3;
      assert.strictEqual(findRefAttrAt(text, inside)?.attr, 'href');
    });

    it('returns undefined outside any ref value', () => {
      const text = '<xref href="topic.dita">x</xref>';
      assert.strictEqual(findRefAttrAt(text, 2), undefined);
    });
  });

  describe('isExternalRef', () => {
    it('flags URL schemes, absolute paths, empty values and external scope', () => {
      assert.strictEqual(isExternalRef('https://a.com'), true);
      assert.strictEqual(isExternalRef('mailto:x@y.com'), true);
      assert.strictEqual(isExternalRef('C:\\x\\y.dita'), true);
      assert.strictEqual(isExternalRef('/etc/x.dita'), true);
      assert.strictEqual(isExternalRef(''), true);
      assert.strictEqual(isExternalRef('a.dita', 'external'), true);
      assert.strictEqual(isExternalRef('a.dita', 'peer'), true);
    });

    it('accepts relative project paths', () => {
      assert.strictEqual(isExternalRef('topics/a.dita'), false);
      assert.strictEqual(isExternalRef('a.dita#id', 'local'), false);
    });
  });

  describe('findKeyDefinitionOffset', () => {
    const mapText = '<map>\n<keydef keys="alpha beta"/>\n<topicref keys="gamma" href="g.dita"/>\n</map>';

    it('finds a key inside a space-separated keys list', () => {
      const off = findKeyDefinitionOffset(mapText, 'beta');
      assert.ok(off >= 0);
      assert.ok(mapText.substring(off).startsWith('keys="alpha beta"'));
    });

    it('finds keys on topicref elements too', () => {
      assert.ok(findKeyDefinitionOffset(mapText, 'gamma') >= 0);
    });

    it('does not match partial key names', () => {
      assert.strictEqual(findKeyDefinitionOffset(mapText, 'alph'), -1);
      assert.strictEqual(findKeyDefinitionOffset(mapText, 'delta'), -1);
    });
  });

  describe('findConrefTargetOffset', () => {
    const text = '<topic id="t1"><body><p id="p1">x</p></body></topic><topic id="t2"><p id="p1">y</p></topic>';

    it('resolves "topicId" to the topic id offset', () => {
      const off = findConrefTargetOffset(text, 't2');
      assert.ok(text.substring(off).startsWith('id="t2"'));
    });

    it('resolves "topicId/elementId" to the element after the topic', () => {
      const off = findConrefTargetOffset(text, 't2/p1');
      assert.ok(off > text.indexOf('id="t2"'));
    });

    it('returns -1 for missing ids', () => {
      assert.strictEqual(findConrefTargetOffset(text, 'missing'), -1);
      assert.strictEqual(findConrefTargetOffset(text, 't1/missing'), -1);
    });
  });

  describe('collectIds / offsetToLineCol', () => {
    it('collects all declared ids', () => {
      assert.deepStrictEqual(collectIds('<topic id="a"><p id="b"/></topic>'), ['a', 'b']);
    });

    it('converts offsets to 0-based line/col', () => {
      const text = 'ab\ncd\nef';
      assert.deepStrictEqual(offsetToLineCol(text, 0), { line: 0, col: 0 });
      assert.deepStrictEqual(offsetToLineCol(text, 4), { line: 1, col: 1 });
      assert.deepStrictEqual(offsetToLineCol(text, 6), { line: 2, col: 0 });
    });
  });

  describe('getCompletionContext', () => {
    it('detects tag-name position after <', () => {
      const ctx = getCompletionContext('<p>text <no', 11);
      assert.strictEqual(ctx.kind, 'tag');
      assert.strictEqual(ctx.prefix, 'no');
    });

    it('detects attribute-name position inside a tag', () => {
      const text = '<xref hr';
      const ctx = getCompletionContext(text, text.length);
      assert.strictEqual(ctx.kind, 'attrName');
      assert.strictEqual(ctx.tagName, 'xref');
      assert.strictEqual(ctx.prefix, 'hr');
    });

    it('detects attribute-value position with prefix and valueStart', () => {
      const text = '<xref href="topics/a';
      const ctx = getCompletionContext(text, text.length);
      assert.strictEqual(ctx.kind, 'attrValue');
      assert.strictEqual(ctx.attrName, 'href');
      assert.strictEqual(ctx.prefix, 'topics/a');
      assert.strictEqual(ctx.valueStart, text.indexOf('topics/a'));
    });

    it('returns none inside text content, comments and closed tags', () => {
      assert.strictEqual(getCompletionContext('<p>hello', 8).kind, 'none');
      const comment = '<!-- note ';
      assert.strictEqual(getCompletionContext(comment, comment.length).kind, 'none');
      const pi = '<?xml version="1.0" ';
      assert.strictEqual(getCompletionContext(pi, pi.length).kind, 'none');
    });

    it('flags closing-tag typing with the closing marker', () => {
      const text = '<p>x</se';
      const ctx = getCompletionContext(text, text.length);
      assert.strictEqual(ctx.kind, 'tag');
      assert.strictEqual(ctx.closing, true);
      assert.strictEqual(ctx.prefix, 'se');
    });
  });

  describe('tag auto-closing', () => {
    it('returns the tag name right after an opening tag is completed', () => {
      const text = '<body><note type="tip">';
      assert.strictEqual(getAutoCloseTag(text, text.length), 'note');
    });

    it('ignores closing, self-closing, comment and PI ">"', () => {
      for (const text of ['</note>', '<image href="a.png"/>', '<!-- c -->', '<?xml version="1.0"?>']) {
        assert.strictEqual(getAutoCloseTag(text, text.length), undefined, text);
      }
    });

    it('ignores ">" typed inside an attribute value', () => {
      const text = '<xref href="a>';
      assert.strictEqual(getAutoCloseTag(text, text.length), undefined);
    });

    it('findUnclosedTag returns the innermost open element', () => {
      assert.strictEqual(findUnclosedTag('<topic><body><p>text'), 'p');
      assert.strictEqual(findUnclosedTag('<topic><body><p>text</p>'), 'body');
      assert.strictEqual(findUnclosedTag('<topic><body/><p>x</p>'), 'topic');
      assert.strictEqual(findUnclosedTag('<p>a</p>'), undefined);
    });

    it('findUnclosedTag skips comments, CDATA and doctype', () => {
      const text = '<!DOCTYPE topic PUBLIC "x" "y"><topic><!-- <fake> --><body>';
      assert.strictEqual(findUnclosedTag(text), 'body');
    });

    it('getCloseTagCompletion completes "</" with the innermost open tag', () => {
      const text = '<topic><body><p>text</';
      assert.strictEqual(getCloseTagCompletion(text, text.length), 'p');
      assert.strictEqual(getCloseTagCompletion('<p>no slash here', 5), undefined);
    });
  });

  describe('getAttributesForTag', () => {
    it('lists tag-specific attributes before universal ones', () => {
      const attrs = getAttributesForTag('xref');
      assert.strictEqual(attrs[0], 'href');
      assert.ok(attrs.includes('id'));
      assert.ok(attrs.includes('keyref'));
    });

    it('falls back to universal attributes for unknown tags', () => {
      const attrs = getAttributesForTag('unknowntag');
      assert.ok(attrs.includes('id'));
      assert.ok(attrs.includes('conref'));
    });
  });

  describe('collectTopicSymbols', () => {
    it('builds a nested outline including the root topic', () => {
      const xml = `<?xml version="1.0"?>
<concept id="c1">
  <title>Root Title</title>
  <conbody>
    <section id="s1"><title>Section One</title><p>x</p></section>
  </conbody>
</concept>`;
      const doc = parseDita(xml);
      const symbols = collectTopicSymbols(doc.root);
      assert.strictEqual(symbols.length, 1);
      assert.strictEqual(symbols[0].name, 'Root Title');
      assert.strictEqual(symbols[0].kind, 'topic');
      assert.strictEqual(symbols[0].children.length, 1);
      assert.strictEqual(symbols[0].children[0].name, 'Section One');
      assert.strictEqual(symbols[0].children[0].kind, 'section');
    });

    it('handles nested topics', () => {
      const xml = `<topic id="t1"><title>Outer</title>
  <topic id="t2"><title>Inner</title><body/></topic>
</topic>`;
      const doc = parseDita(xml);
      const symbols = collectTopicSymbols(doc.root);
      assert.strictEqual(symbols[0].children[0].name, 'Inner');
      assert.strictEqual(symbols[0].children[0].kind, 'topic');
    });
  });

  describe('collectMapSymbols / getMapRefName', () => {
    it('builds the map outline with refs, keydefs, topicheads and bookmap containers', () => {
      const xml = `<?xml version="1.0"?>
<bookmap>
  <booktitle><mainbooktitle>Book</mainbooktitle></booktitle>
  <keydef keys="prod"><topicmeta><keywords><keyword>P</keyword></keywords></topicmeta></keydef>
  <frontmatter>
    <preface href="pre.dita"/>
  </frontmatter>
  <chapter href="ch1.dita" navtitle="Chapter One">
    <topicref href="s1.dita"/>
  </chapter>
  <reltable><relrow/></reltable>
</bookmap>`;
      const doc = parseDitamap(xml);
      const symbols = collectMapSymbols(doc.root);
      const names = symbols.map((s) => [s.kind, s.name]);
      assert.deepStrictEqual(names, [
        ['keydef', 'prod'],
        ['structural', 'frontmatter'],
        ['ref', 'Chapter One'],
      ]);
      assert.strictEqual(symbols[1].children[0].name, 'pre.dita');
      assert.strictEqual(symbols[2].children[0].name, 's1.dita');
    });

    it('prefers navtitle element over href in getMapRefName', () => {
      const xml = `<map><topicref href="a.dita"><topicmeta><navtitle>Nice Name</navtitle></topicmeta></topicref></map>`;
      const doc = parseDitamap(xml);
      const ref = (doc.root.children || []).find((c) => c.baseType === 'map/topicref')!;
      assert.strictEqual(getMapRefName(ref), 'Nice Name');
    });

    it('numbers book divisions in the map outline detail', () => {
      const xml = `<bookmap>
  <chapter href="c1.dita"/>
  <chapter href="c2.dita"/>
  <appendix href="a.dita"/>
</bookmap>`;
      const doc = parseDitamap(xml);
      const symbols = collectMapSymbols(doc.root);
      assert.deepStrictEqual(
        symbols.map((s) => s.detail),
        ['Chapter 1', 'Chapter 2', 'Appendix A'],
      );
    });
  });

  describe('createBookRoleLabeler', () => {
    it('numbers chapters, parts (roman) and appendixes (letters) independently', () => {
      const label = createBookRoleLabeler();
      assert.strictEqual(label('preface'), 'Preface');
      assert.strictEqual(label('part'), 'Part I');
      assert.strictEqual(label('chapter'), 'Chapter 1');
      assert.strictEqual(label('chapter'), 'Chapter 2');
      assert.strictEqual(label('part'), 'Part II');
      assert.strictEqual(label('chapter'), 'Chapter 3');
      assert.strictEqual(label('appendix'), 'Appendix A');
      assert.strictEqual(label('appendix'), 'Appendix B');
      assert.strictEqual(label('topicref'), undefined);
      assert.strictEqual(label(undefined), undefined);
    });

    it('rolls appendix letters past Z', () => {
      const label = createBookRoleLabeler();
      let last = '';
      for (let i = 0; i < 27; i++) last = label('appendix')!;
      assert.strictEqual(last, 'Appendix AA');
    });

    it('threads numbered roles through collectMapEntries', () => {
      const xml = `<bookmap>
  <preface href="p.dita"/>
  <chapter href="c1.dita"><topicref href="s1.dita"/></chapter>
  <chapter href="c2.dita"/>
  <appendix href="a.dita"/>
</bookmap>`;
      const doc = parseDitamap(xml);
      const entries = collectMapEntries(doc.root);
      assert.deepStrictEqual(
        entries.map((e) => e.role),
        ['Preface', 'Chapter 1', undefined, 'Chapter 2', 'Appendix A'],
      );
    });

    it('applies an injected formatter for localized labels', () => {
      const zh = (info: { tagName: string; role: string; ordinal?: string }): string => {
        if (info.tagName === 'chapter') return `第 ${info.ordinal} 章`;
        if (info.tagName === 'part') return `第 ${info.ordinal} 部分`;
        if (info.tagName === 'appendix') return `附录 ${info.ordinal}`;
        return `[${info.role}]`;
      };
      const label = createBookRoleLabeler(zh);
      assert.strictEqual(label('preface'), '[Preface]');
      assert.strictEqual(label('chapter'), '第 1 章');
      assert.strictEqual(label('chapter'), '第 2 章');
      assert.strictEqual(label('part'), '第 I 部分');
      assert.strictEqual(label('appendix'), '附录 A');
    });

    it('threads the formatter through collectMapSymbols and collectMapEntries', () => {
      const xml = `<bookmap>
  <chapter href="c1.dita"/>
  <appendix href="a.dita"/>
</bookmap>`;
      const zh = (info: { tagName: string; role: string; ordinal?: string }): string =>
        info.tagName === 'chapter' ? `第 ${info.ordinal} 章` : `${info.role}!`;
      const doc = parseDitamap(xml);
      const symbols = collectMapSymbols(doc.root, zh);
      assert.deepStrictEqual(
        symbols.map((s) => s.detail),
        ['第 1 章', 'Appendix!'],
      );
      const entries = collectMapEntries(parseDitamap(xml).root, undefined, zh);
      assert.deepStrictEqual(
        entries.map((e) => e.role),
        ['第 1 章', 'Appendix!'],
      );
    });
  });
});
