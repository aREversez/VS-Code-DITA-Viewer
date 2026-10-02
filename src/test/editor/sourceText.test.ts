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
  trackSourceReads,
  noteSourceDependencies,
  dependsOn,
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

describe('tracking which sources a render read', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dita-track-'));
    clearAllSourceOverlays();
  });
  afterEach(() => {
    clearAllSourceOverlays();
    rmSync(dir, { recursive: true, force: true });
  });
  const mk = (name: string): string => {
    const f = join(dir, name);
    writeFileSync(f, name);
    return f;
  };

  it('collects every file read inside the callback, overlaid or not, and returns the callback\'s result', () => {
    const a = mk('a.dita');
    const b = mk('b.dita');
    setSourceOverlay(b, 'unsaved');
    const { result, files } = trackSourceReads(() => readSourceText(a) + '+' + readSourceText(b));
    assert.strictEqual(result, 'a.dita+unsaved');
    assert.ok(dependsOn(files, a) && dependsOn(files, b));
    assert.strictEqual(files.size, 2);
  });

  it('matches a file however its path is spelled', () => {
    const a = mk('a.dita');
    const { files } = trackSourceReads(() => readSourceText(a));
    assert.ok(dependsOn(files, join(dir, 'x', '..', 'a.dita')));
    assert.ok(!dependsOn(files, join(dir, 'b.dita')));
  });

  it('records nothing outside a tracker', () => {
    const a = mk('a.dita');
    readSourceText(a);
    const { files } = trackSourceReads(() => undefined);
    assert.strictEqual(files.size, 0);
  });

  it('lets a cache hit report the files its entry stands for', () => {
    const a = mk('a.dita');
    const b = mk('b.dita');
    const { files } = trackSourceReads(() => noteSourceDependencies([a, b]));
    assert.ok(dependsOn(files, a) && dependsOn(files, b));
  });

  it('nests: an inner tracker gets its own files, the outer one gets them too, and the outer keeps tracking afterwards', () => {
    const a = mk('a.dita');
    const b = mk('b.dita');
    const c = mk('c.dita');
    const outer = trackSourceReads(() => {
      readSourceText(a);
      const inner = trackSourceReads(() => readSourceText(b));
      assert.strictEqual(inner.files.size, 1);
      assert.ok(dependsOn(inner.files, b) && !dependsOn(inner.files, a));
      readSourceText(c);
    });
    assert.strictEqual(outer.files.size, 3);
  });

  it('stops tracking when the callback throws, so later reads are not attributed to it', () => {
    const a = mk('a.dita');
    assert.throws(() => trackSourceReads(() => { throw new Error('boom'); }), /boom/);
    const { files } = trackSourceReads(() => readSourceText(a));
    assert.strictEqual(files.size, 1);
  });
});
