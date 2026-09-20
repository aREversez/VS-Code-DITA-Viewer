import * as assert from 'assert';
import { mkdtempSync, writeFileSync, utimesSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { sourceStamp } from '../../editor/sourceText';
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
