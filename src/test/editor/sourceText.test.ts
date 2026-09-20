import * as assert from 'assert';
import { mkdtempSync, writeFileSync, utimesSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  sourceStamp,
  readSourceText,
  setSourceOverlay,
  clearSourceOverlay,
  clearAllSourceOverlays,
  sourceOverlaySize,
} from '../../editor/sourceText';
import { stampFiles } from '../../editor/ditaRenderUtils';

describe('source stamps (disk)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dita-stamp-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const T = new Date('2026-01-01T00:00:00Z');

  it('changes when the content changes size even though the mtime did not', () => {
    // Editors, git checkouts and copy tools can leave an mtime equal to the
    // previous one (coarse timestamps, restored times); mtime alone then
    // says "unchanged" for a file that is not.
    const f = join(dir, 'a.dita');
    writeFileSync(f, '<topic id="a"/>');
    utimesSync(f, T, T);
    const before = sourceStamp(f);
    writeFileSync(f, '<topic id="a"><title>longer</title></topic>');
    utimesSync(f, T, T);
    assert.notStrictEqual(sourceStamp(f), before);
    assert.match(before, /^\d+(\.\d+)?:15$/);
  });

  it('is stable for an untouched file and marks a missing one with ?', () => {
    const f = join(dir, 'a.dita');
    writeFileSync(f, 'x');
    assert.strictEqual(sourceStamp(f), sourceStamp(f));
    assert.strictEqual(sourceStamp(join(dir, 'nope.dita')), '?');
  });

  it('stampFiles joins one stamp per file, so the size difference invalidates a whole set', () => {
    const f = join(dir, 'a.dita');
    const g = join(dir, 'b.dita');
    writeFileSync(f, 'one');
    writeFileSync(g, 'two');
    utimesSync(f, T, T);
    utimesSync(g, T, T);
    const before = stampFiles([f, g, join(dir, 'missing.dita')]);
    assert.strictEqual(before.split('|').length, 3);
    writeFileSync(g, 'three');
    utimesSync(g, T, T);
    assert.notStrictEqual(stampFiles([f, g, join(dir, 'missing.dita')]), before);
  });
});

describe('source overlay (unsaved editor text)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dita-overlay-'));
    clearAllSourceOverlays();
  });
  afterEach(() => {
    clearAllSourceOverlays();
    rmSync(dir, { recursive: true, force: true });
  });

  function disk(name: string, text: string): string {
    const f = join(dir, name);
    writeFileSync(f, text);
    return f;
  }

  it('reads the disk until an overlay is set, the overlay while it is, and the disk again once it is cleared', () => {
    const f = disk('a.dita', 'on disk');
    assert.strictEqual(readSourceText(f), 'on disk');
    setSourceOverlay(f, 'in the editor');
    assert.strictEqual(readSourceText(f), 'in the editor');
    clearSourceOverlay(f);
    assert.strictEqual(readSourceText(f), 'on disk');
  });

  it('stamps an overlaid file dirty:<rev>, replacing the disk stamp, and goes back to the disk stamp when cleared', () => {
    const f = disk('a.dita', 'on disk');
    const onDisk = sourceStamp(f);
    setSourceOverlay(f, 'v1');
    assert.match(sourceStamp(f), /^dirty:\d+$/);
    clearSourceOverlay(f);
    assert.strictEqual(sourceStamp(f), onDisk);
  });

  it('moves the stamp on every real change, and leaves it alone when the text is the same', () => {
    const f = disk('a.dita', 'x');
    setSourceOverlay(f, 'v1');
    const s1 = sourceStamp(f);
    setSourceOverlay(f, 'v1');
    assert.strictEqual(sourceStamp(f), s1, 're-syncing identical text must not invalidate every cache built from it');
    setSourceOverlay(f, 'v2');
    assert.notStrictEqual(sourceStamp(f), s1);
  });

  it('never hands out the same stamp twice, even for the same text after a clear (a document closed and reopened)', () => {
    // document.version restarts at 1 when a document is reopened; the
    // overlay's own counter must not, or a cache entry built from the first
    // lifetime would answer for different text in the second.
    const f = disk('a.dita', 'x');
    setSourceOverlay(f, 'same text');
    const first = sourceStamp(f);
    clearSourceOverlay(f);
    setSourceOverlay(f, 'same text');
    assert.notStrictEqual(sourceStamp(f), first);
  });

  it('keeps files independent and matches a path however it is spelled', () => {
    const a = disk('a.dita', 'a');
    const b = disk('b.dita', 'b');
    setSourceOverlay(a, 'A!');
    assert.strictEqual(readSourceText(b), 'b');
    assert.strictEqual(readSourceText(join(dir, 'sub', '..', 'a.dita')), 'A!');
    clearSourceOverlay(join(dir, '.', 'a.dita'));
    assert.strictEqual(readSourceText(a), 'a');
  });

  it('clearAllSourceOverlays drops everything', () => {
    const a = disk('a.dita', 'a');
    setSourceOverlay(a, 'A!');
    clearAllSourceOverlays();
    assert.strictEqual(readSourceText(a), 'a');
    assert.strictEqual(sourceOverlaySize(), 0);
  });
});
