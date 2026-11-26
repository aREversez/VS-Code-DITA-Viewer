import * as assert from 'assert';
import { createMemoryFileSystem } from '../../src/memoryFileSystem';

describe('createMemoryFileSystem', () => {
  const make = () =>
    createMemoryFileSystem({
      '/ws/a.dita': '<topic id="a"/>',
      '/ws/sub/b.dita': 'bé',
      '/ws/sub/deep/c.xml': '<c/>',
      '/ws/img.png': new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]),
    });

  it('reads text back, UTF-8', () => {
    const fs = make();
    assert.strictEqual(fs.readText('/ws/a.dita'), '<topic id="a"/>');
    assert.strictEqual(fs.readText('/ws/sub/b.dita'), 'bé');
  });

  it('resolves paths the way posixPath does', () => {
    const fs = make();
    assert.strictEqual(fs.readText('/ws/sub/../a.dita'), '<topic id="a"/>');
    assert.ok(fs.exists('/ws/./sub//b.dita'));
  });

  it('readText throws for a missing file and for a directory', () => {
    const fs = make();
    assert.throws(() => fs.readText('/ws/nope.dita'), /ENOENT/);
    assert.throws(() => fs.readText('/ws/sub'), /EISDIR/);
  });

  it('readHead returns at most maxBytes from the start, and throws when unreadable', () => {
    const fs = make();
    assert.deepStrictEqual([...fs.readHead('/ws/img.png', 4)], [137, 80, 78, 71]);
    assert.strictEqual(fs.readHead('/ws/img.png', 1000).length, 12);
    assert.strictEqual(fs.readHead('/ws/a.dita', 0).length, 0);
    assert.throws(() => fs.readHead('/ws/nope.png', 4), /ENOENT/);
    assert.throws(() => fs.readHead('/ws/sub', 4), /EISDIR/);
  });

  it('readHead hands out a copy', () => {
    const fs = make();
    fs.readHead('/ws/img.png', 4)[0] = 0;
    assert.strictEqual(fs.readHead('/ws/img.png', 1)[0], 137);
  });

  it('exists is true for files and for the directories they imply, including the root', () => {
    const fs = make();
    for (const p of ['/', '/ws', '/ws/sub', '/ws/sub/deep', '/ws/a.dita']) assert.ok(fs.exists(p), p);
    for (const p of ['/ws/x', '/other', '/ws/su']) assert.ok(!fs.exists(p), p);
  });

  it('stat gives size in bytes, and undefined for what is not there', () => {
    const fs = make();
    assert.strictEqual(fs.stat('/ws/sub/b.dita')?.size, 3); // "bé" is 3 bytes in UTF-8
    assert.strictEqual(fs.stat('/ws/img.png')?.size, 12);
    assert.strictEqual(fs.stat('/ws/nope'), undefined);
    assert.ok(fs.stat('/ws/sub'));
  });

  it('stat versions: every set takes a new mtimeMs, so a stamp changes with the content', () => {
    const fs = make();
    const seen = new Set(['/ws/a.dita', '/ws/sub/b.dita', '/ws/sub/deep/c.xml', '/ws/img.png'].map((p) => fs.stat(p)?.mtimeMs));
    assert.strictEqual(seen.size, 4, 'distinct files get distinct versions');
    const before = fs.stat('/ws/a.dita')!;
    fs.set('/ws/a.dita', '<topic id="a"/>'); // same content, still a new write
    const same = fs.stat('/ws/a.dita')!;
    assert.ok(same.mtimeMs > before.mtimeMs);
    fs.set('/ws/a.dita', '<topic id="a2"/>');
    const changed = fs.stat('/ws/a.dita')!;
    assert.ok(changed.mtimeMs > same.mtimeMs);
    assert.strictEqual(changed.size, '<topic id="a2"/>'.length);
  });

  it('delete then set again gives a version no earlier call produced', () => {
    const fs = make();
    const v = fs.stat('/ws/a.dita')!.mtimeMs;
    assert.strictEqual(fs.delete('/ws/a.dita'), true);
    assert.strictEqual(fs.delete('/ws/a.dita'), false);
    assert.ok(!fs.exists('/ws/a.dita'));
    fs.set('/ws/a.dita', 'x');
    assert.ok(fs.stat('/ws/a.dita')!.mtimeMs > v);
  });

  it('readDir lists direct children, sorted, with directories marked', () => {
    const fs = make();
    assert.deepStrictEqual(fs.readDir('/ws'), [
      { name: 'a.dita', isDirectory: false },
      { name: 'img.png', isDirectory: false },
      { name: 'sub', isDirectory: true },
    ]);
    assert.deepStrictEqual(fs.readDir('/ws/sub'), [
      { name: 'b.dita', isDirectory: false },
      { name: 'deep', isDirectory: true },
    ]);
    assert.deepStrictEqual(fs.readDir('/'), [{ name: 'ws', isDirectory: true }]);
  });

  it('readDir throws for a missing directory and for a file', () => {
    const fs = make();
    assert.throws(() => fs.readDir('/ws/nope'), /ENOENT/);
    assert.throws(() => fs.readDir('/ws/a.dita'), /ENOTDIR/);
  });

  it('an empty file system still has a root', () => {
    const fs = createMemoryFileSystem();
    assert.ok(fs.exists('/'));
    assert.deepStrictEqual(fs.readDir('/'), []);
  });

  it('has no realPath, so a path is its own real path', () => {
    assert.strictEqual(make().realPath, undefined);
  });

  it('copies bytes in, so a later change to the caller\'s array does not leak in', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const fs = createMemoryFileSystem({ '/b.bin': bytes });
    bytes[0] = 9;
    assert.strictEqual(fs.readHead('/b.bin', 1)[0], 1);
  });
});
