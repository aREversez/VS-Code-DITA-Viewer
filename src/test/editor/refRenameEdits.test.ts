import * as assert from 'assert';
import {
  computeRefEdits,
  encodeHrefPart,
  escapeHrefSpecials,
  mayReferenceRenamed,
  stripBom,
  FileInput,
  RenameEntry,
  FileEdit,
} from '../../editor/refRenameEdits';

function makeFile(path: string, text: string): FileInput {
  return { path, text };
}
function makeRename(oldPath: string, newPath: string): RenameEntry {
  return { oldPath, newPath };
}

/** Apply edits to text, returning the transformed string. */
function applyEdits(text: string, edits: FileEdit['edits']): string {
  // Sort edits in reverse order so offsets remain valid.
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let result = text;
  for (const e of sorted) {
    result = result.slice(0, e.start) + e.newText + result.slice(e.end);
  }
  return result;
}

describe('refRenameEdits', () => {
  describe('encodeHrefPart', () => {
    it('encodes spaces', () => {
      assert.strictEqual(encodeHrefPart('hello world'), 'hello%20world');
    });
    it('leaves normal filenames unchanged', () => {
      assert.strictEqual(encodeHrefPart('normal.dita'), 'normal.dita');
    });
    it('preserves forward slashes', () => {
      assert.strictEqual(encodeHrefPart('a/b/c.dita'), 'a/b/c.dita');
    });
  });

  describe('computeRefEdits — basic renames', () => {
    it('updates same-dir topicref href', () => {
      const text = '<topicref href="old.dita"/>';
      const edits = computeRefEdits({
        renames: [makeRename('/project/old.dita', '/project/new.dita')],
        files: [makeFile('/project/map.ditamap', text)],
        platform: 'linux',
      });
      assert.strictEqual(edits.length, 1);
      assert.strictEqual(edits[0].edits.length, 1);
      const result = applyEdits(text, edits[0].edits);
      assert.strictEqual(result, '<topicref href="new.dita"/>');
    });

    it('updates same-dir xref href', () => {
      const text = '<xref href="old.dita">link</xref>';
      const edits = computeRefEdits({
        renames: [makeRename('/project/old.dita', '/project/new.dita')],
        files: [makeFile('/project/map.ditamap', text)],
        platform: 'linux',
      });
      assert.strictEqual(edits.length, 1);
      const result = applyEdits(text, edits[0].edits);
      assert.strictEqual(result, '<xref href="new.dita">link</xref>');
    });

    it('updates conref with fragment', () => {
      const text = '<ph conref="old.dita#topic/elem"/>';
      const edits = computeRefEdits({
        renames: [makeRename('/project/old.dita', '/project/new.dita')],
        files: [makeFile('/project/map.ditamap', text)],
        platform: 'linux',
      });
      assert.strictEqual(edits.length, 1);
      const result = applyEdits(text, edits[0].edits);
      assert.strictEqual(result, '<ph conref="new.dita#topic/elem"/>');
    });

    it('handles single-quote href', () => {
      const text = "<topicref href='old.dita'/>";
      const edits = computeRefEdits({
        renames: [makeRename('/project/old.dita', '/project/new.dita')],
        files: [makeFile('/project/map.ditamap', text)],
        platform: 'linux',
      });
      assert.strictEqual(edits.length, 1);
      const result = applyEdits(text, edits[0].edits);
      assert.strictEqual(result, "<topicref href='new.dita'/>");
    });

    it('preserves %20 encoding when target has spaces', () => {
      const text = '<topicref href="my%20file.dita"/>';
      const edits = computeRefEdits({
        renames: [makeRename('/project/my file.dita', '/project/my new file.dita')],
        files: [makeFile('/project/map.ditamap', text)],
        platform: 'linux',
      });
      assert.strictEqual(edits.length, 1);
      const result = applyEdits(text, edits[0].edits);
      assert.strictEqual(result, '<topicref href="my%20new%20file.dita"/>');
    });

    it('preserves ./ prefix', () => {
      const text = '<topicref href="./old.dita"/>';
      const edits = computeRefEdits({
        renames: [makeRename('/project/old.dita', '/project/new.dita')],
        files: [makeFile('/project/map.ditamap', text)],
        platform: 'linux',
      });
      assert.strictEqual(edits.length, 1);
      const result = applyEdits(text, edits[0].edits);
      assert.strictEqual(result, '<topicref href="./new.dita"/>');
    });
  });

  describe('computeRefEdits — cross-dir moves', () => {
    it('updates inbound ref when target file moves to another dir', () => {
      const text = '<topicref href="old.dita"/>';
      const edits = computeRefEdits({
        renames: [makeRename('/a/old.dita', '/b/old.dita')],
        files: [makeFile('/a/map.ditamap', text)],
        platform: 'linux',
      });
      assert.strictEqual(edits.length, 1);
      const result = applyEdits(text, edits[0].edits);
      assert.strictEqual(result, '<topicref href="../b/old.dita"/>');
    });

    it('updates outbound ref when the referencing file moves', () => {
      const text = '<topicref href="topic.dita"/>';
      const edits = computeRefEdits({
        renames: [makeRename('/a/map.ditamap', '/b/map.ditamap')],
        files: [makeFile('/a/map.ditamap', text)],
        platform: 'linux',
      });
      assert.strictEqual(edits.length, 1);
      const result = applyEdits(text, edits[0].edits);
      assert.strictEqual(result, '<topicref href="../a/topic.dita"/>');
    });
  });

  describe('computeRefEdits — folder renames', () => {
    it('keeps intra-folder refs unchanged', () => {
      const text = '<topicref href="b.dita"/>';
      const edits = computeRefEdits({
        renames: [makeRename('/dir', '/dir2')],
        files: [makeFile('/dir/a.dita', text)],
        platform: 'linux',
      });
      // b.dita resolves to /dir/b.dita → folder rename maps to /dir2/b.dita
      // file moves from /dir/a.dita to /dir2/a.dita, relative to /dir2 → b.dita
      // Same value, no edit emitted.
      assert.strictEqual(edits.length, 0);
    });

    it('updates external refs pointing into renamed folder', () => {
      const text = '<topicref href="../dir/a.dita"/>';
      const edits = computeRefEdits({
        renames: [makeRename('/dir', '/dir2')],
        files: [makeFile('/other/map.ditamap', text)],
        platform: 'linux',
      });
      assert.strictEqual(edits.length, 1);
      const result = applyEdits(text, edits[0].edits);
      assert.strictEqual(result, '<topicref href="../dir2/a.dita"/>');
    });
  });

  describe('computeRefEdits — skip conditions', () => {
    it('does not change scope=external refs', () => {
      const text = '<topicref href="old.dita" scope="external"/>';
      const edits = computeRefEdits({
        renames: [makeRename('/project/old.dita', '/project/new.dita')],
        files: [makeFile('/project/map.ditamap', text)],
        platform: 'linux',
      });
      assert.strictEqual(edits.length, 0);
    });

    it('does not change https:// refs', () => {
      const text = '<xref href="https://example.com">link</xref>';
      const edits = computeRefEdits({
        renames: [makeRename('/project/old.dita', '/project/new.dita')],
        files: [makeFile('/project/map.ditamap', text)],
        platform: 'linux',
      });
      assert.strictEqual(edits.length, 0);
    });

    it('does not change bare #fragment refs', () => {
      const text = '<xref href="#topicid">link</xref>';
      const edits = computeRefEdits({
        renames: [makeRename('/project/old.dita', '/project/new.dita')],
        files: [makeFile('/project/map.ditamap', text)],
        platform: 'linux',
      });
      assert.strictEqual(edits.length, 0);
    });

    it('does not change refs containing &', () => {
      const text = '<topicref href="file.dita?key=val&amp;x=y"/>';
      const edits = computeRefEdits({
        renames: [makeRename('/project/file.dita', '/project/renamed.dita')],
        files: [makeFile('/project/map.ditamap', text)],
        platform: 'linux',
      });
      assert.strictEqual(edits.length, 0);
    });
  });

  describe('computeRefEdits — win32', () => {
    it('matches case-insensitively on win32', () => {
      const text = '<topicref href="Old.Dita"/>';
      const edits = computeRefEdits({
        renames: [makeRename('C:\\project\\Old.Dita', 'C:\\project\\New.Dita')],
        files: [makeFile('C:\\project\\map.ditamap', text)],
        platform: 'win32',
      });
      assert.strictEqual(edits.length, 1);
      const result = applyEdits(text, edits[0].edits);
      assert.strictEqual(result, '<topicref href="New.Dita"/>');
    });
  });

  describe('computeRefEdits — misc', () => {
    it('preserves CRLF line endings', () => {
      const text = '<map>\r\n  <topicref href="old.dita"/>\r\n</map>';
      const edits = computeRefEdits({
        renames: [makeRename('/project/old.dita', '/project/new.dita')],
        files: [makeFile('/project/map.ditamap', text)],
        platform: 'linux',
      });
      assert.strictEqual(edits.length, 1);
      const result = applyEdits(text, edits[0].edits);
      assert.ok(result.includes('\r\n'));
      assert.strictEqual(result, '<map>\r\n  <topicref href="new.dita"/>\r\n</map>');
    });

    it('is idempotent — no edits when old equals new', () => {
      const text = '<topicref href="file.dita"/>';
      const edits = computeRefEdits({
        renames: [makeRename('/project/file.dita', '/project/file.dita')],
        files: [makeFile('/project/map.ditamap', text)],
        platform: 'linux',
      });
      assert.strictEqual(edits.length, 0);
    });

    it('updates multiple refs in the same file', () => {
      const text = '<map><topicref href="old.dita"/><topicref href="old.dita"/></map>';
      const edits = computeRefEdits({
        renames: [makeRename('/project/old.dita', '/project/new.dita')],
        files: [makeFile('/project/map.ditamap', text)],
        platform: 'linux',
      });
      assert.strictEqual(edits.length, 1);
      assert.strictEqual(edits[0].edits.length, 2);
      const result = applyEdits(text, edits[0].edits);
      assert.strictEqual(result, '<map><topicref href="new.dita"/><topicref href="new.dita"/></map>');
    });

    it('updates href but not keyref', () => {
      const text = '<topicref keys="k" href="old.dita"/><topicref keyref="someKey"/>';
      const edits = computeRefEdits({
        renames: [makeRename('/project/old.dita', '/project/new.dita')],
        files: [makeFile('/project/map.ditamap', text)],
        platform: 'linux',
      });
      assert.strictEqual(edits.length, 1);
      // Only one edit — the href, not the keyref
      assert.strictEqual(edits[0].edits.length, 1);
      const result = applyEdits(text, edits[0].edits);
      assert.strictEqual(result, '<topicref keys="k" href="new.dita"/><topicref keyref="someKey"/>');
    });

    it('does not update conkeyref', () => {
      const text = '<ph conkeyref="someKey"/>';
      const edits = computeRefEdits({
        renames: [makeRename('/project/old.dita', '/project/new.dita')],
        files: [makeFile('/project/map.ditamap', text)],
        platform: 'linux',
      });
      assert.strictEqual(edits.length, 0);
    });
  });

  describe('review fixes — kill tests', () => {
    it('encodeHrefPart emits UTF-8 percent-encoding for non-ASCII', () => {
      assert.strictEqual(encodeHrefPart('中文 a.dita'), '%E4%B8%AD%E6%96%87%20a.dita');
      assert.strictEqual(encodeHrefPart('a/é.dita'), 'a/%C3%A9.dita');
    });

    it('re-encodes a CJK target when the original href used %20', () => {
      const text = '<topicref href="old%20x.dita"/>';
      const edits = computeRefEdits({
        renames: [makeRename('/p/old x.dita', '/p/新 x.dita')],
        files: [makeFile('/p/map.ditamap', text)],
        platform: 'linux',
      });
      assert.strictEqual(
        applyEdits(text, edits[0].edits),
        '<topicref href="%E6%96%B0%20x.dita"/>',
      );
    });

    it('reports the pre-rename path as sourcePath for files inside a renamed folder', () => {
      const text = '<xref href="../outside.dita"/>';
      const edits = computeRefEdits({
        renames: [makeRename('/p/dir', '/p/sub/dir')],
        files: [makeFile('/p/dir/a.dita', text)],
        platform: 'linux',
      });
      assert.strictEqual(edits.length, 1);
      assert.strictEqual(edits[0].sourcePath, '/p/dir/a.dita');
      assert.strictEqual(edits[0].path, '/p/sub/dir/a.dita');
      assert.strictEqual(applyEdits(text, edits[0].edits), '<xref href="../../outside.dita"/>');
    });

    it('keeps the casing of the new name on win32', () => {
      const text = '<topicref href="old.dita"/>';
      const edits = computeRefEdits({
        renames: [makeRename('C:\\Proj\\old.dita', 'C:\\Proj\\MyTopic.dita')],
        files: [makeFile('C:\\Proj\\map.ditamap', text)],
        platform: 'win32',
      });
      assert.strictEqual(applyEdits(text, edits[0].edits), '<topicref href="MyTopic.dita"/>');
    });

    it('mayReferenceRenamed: name mention (plain or encoded) passes', () => {
      const r = [makeRename('/p/old name.dita', '/p/new.dita')];
      assert.strictEqual(mayReferenceRenamed('/p/m.ditamap', 'href="old name.dita"', r, 'linux'), true);
      assert.strictEqual(mayReferenceRenamed('/p/m.ditamap', 'href="old%20name.dita"', r, 'linux'), true);
      assert.strictEqual(mayReferenceRenamed('/p/m.ditamap', 'href="other.dita"', r, 'linux'), false);
    });

    it('mayReferenceRenamed: files inside a renamed path always pass', () => {
      const r = [makeRename('/p/dir', '/p/sub/dir')];
      assert.strictEqual(mayReferenceRenamed('/p/dir/a.dita', 'href="../x.dita"', r, 'linux'), true);
      assert.strictEqual(mayReferenceRenamed('/p/dir2/a.dita', 'href="../x.dita"', r, 'linux'), false);
      const f = [makeRename('/p/a.dita', '/q/a.dita')];
      assert.strictEqual(mayReferenceRenamed('/p/a.dita', 'href="../x.dita"', f, 'linux'), true);
    });

    it('stripBom removes a leading BOM only', () => {
      assert.strictEqual(stripBom('\uFEFF<a/>'), '<a/>');
      assert.strictEqual(stripBom('<a/>\uFEFF'), '<a/>\uFEFF');
    });
  });
  describe('computeRefEdits — attributes beyond href/conref', () => {
    const renamed = [makeRename('/p/b.dita', '/p/sub/b.dita')];
    const rewrite = (text: string, renames: RenameEntry[] = renamed, path = '/p/a.dita'): string => {
      const edits = computeRefEdits({ renames, files: [makeFile(path, text)], platform: 'linux' });
      return edits.length ? applyEdits(text, edits[0].edits) : text;
    };

    it('updates the conrefend that closes a conref range, not just the conref', () => {
      assert.strictEqual(
        rewrite('<p conref="b.dita#t/p1" conrefend="b.dita#t/p3"/>'),
        '<p conref="sub/b.dita#t/p1" conrefend="sub/b.dita#t/p3"/>',
      );
    });

    it('leaves a same-file conrefend alone', () => {
      const text = '<p conref="b.dita#t/p1" conrefend="#t/p3"/>';
      assert.strictEqual(rewrite(text), '<p conref="sub/b.dita#t/p1" conrefend="#t/p3"/>');
    });

    it('updates object @data and image @longdescref', () => {
      assert.strictEqual(rewrite('<object data="b.dita"/>'), '<object data="sub/b.dita"/>');
      assert.strictEqual(rewrite('<image href="i.png" longdescref="b.dita"/>'), '<image href="i.png" longdescref="sub/b.dita"/>');
    });

    it('re-relativizes copy-to when the map that holds it moves', () => {
      const text = '<topicref href="x.dita" copy-to="x2.dita"/>';
      const out = rewrite(text, [makeRename('/p/m.ditamap', '/p/sub/m.ditamap')], '/p/m.ditamap');
      assert.strictEqual(out, '<topicref href="../x.dita" copy-to="../x2.dita"/>');
    });

    it('does not touch keyref / conkeyref', () => {
      const text = '<ph keyref="b.dita" conkeyref="b.dita/x"/>';
      assert.strictEqual(rewrite(text), text);
    });
  });

  describe('computeRefEdits — new names that are not safe to write raw', () => {
    const toName = (name: string, text = '<xref href="b.dita"/>'): string => {
      const edits = computeRefEdits({
        renames: [makeRename('/p/b.dita', '/p/' + name)],
        files: [makeFile('/p/a.dita', text)],
        platform: 'linux',
      });
      return applyEdits(text, edits[0].edits);
    };

    it('escapes # so the name is not read back as a fragment', () => {
      assert.strictEqual(toName('b#1.dita'), '<xref href="b%231.dita"/>');
    });
    it('escapes ? and %', () => {
      assert.strictEqual(toName('b?x.dita'), '<xref href="b%3Fx.dita"/>');
      assert.strictEqual(toName('b%20x.dita'), '<xref href="b%2520x.dita"/>');
    });
    it('escapes a space and the characters that break the attribute', () => {
      assert.strictEqual(toName('b 1.dita'), '<xref href="b%201.dita"/>');
      assert.strictEqual(toName('b&c.dita'), '<xref href="b%26c.dita"/>');
    });
    it('keeps the fragment, which is not part of the file name', () => {
      assert.strictEqual(toName('b#1.dita', '<xref href="b.dita#t/x"/>'), '<xref href="b%231.dita#t/x"/>');
    });
    it('leaves non-ASCII and ordinary names exactly as before', () => {
      assert.strictEqual(toName('中文.dita'), '<xref href="中文.dita"/>');
      assert.strictEqual(toName('new-name_2.dita'), '<xref href="new-name_2.dita"/>');
    });
    it('escapeHrefSpecials keeps / and does not double-encode other text', () => {
      assert.strictEqual(escapeHrefSpecials('a/b c/d.dita'), 'a/b%20c/d.dita');
    });
  });

  describe('computeRefEdits — references that are not live markup', () => {
    const rewrite = (text: string): string => {
      const edits = computeRefEdits({
        renames: [makeRename('/p/b.dita', '/p/c.dita')],
        files: [makeFile('/p/a.dita', text)],
        platform: 'linux',
      });
      return edits.length ? applyEdits(text, edits[0].edits) : text;
    };

    it('leaves an href in a CDATA code sample alone and updates the live one', () => {
      const text = '<codeblock><![CDATA[<xref href="b.dita"/>]]></codeblock><xref href="b.dita"/>';
      assert.strictEqual(
        rewrite(text),
        '<codeblock><![CDATA[<xref href="b.dita"/>]]></codeblock><xref href="c.dita"/>',
      );
    });

    it('leaves a commented-out reference and a processing-instruction one alone', () => {
      const text = '<!-- <xref href="b.dita"/> --><?pi <xref href="b.dita"/> ?>';
      assert.strictEqual(rewrite(text), text);
    });

    it('still rewrites the references after an unclosed comment', () => {
      const text = '<xref href="b.dita"/><!-- never closed <xref href="b.dita"/>';
      assert.strictEqual(rewrite(text), '<xref href="c.dita"/><!-- never closed <xref href="c.dita"/>');
    });
  });
});
