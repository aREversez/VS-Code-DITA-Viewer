import * as assert from 'assert';
import {
  computeRefEdits,
  encodeHrefPart,
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
});
