import * as assert from 'assert';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as nodePath from 'path';
import { nodePlatform } from '../../src/node/nodePlatform';

describe('nodePlatform', () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(nodePath.join(tmpdir(), 'node-platform-'));
    writeFileSync(nodePath.join(dir, 'a.dita'), 'héllo');
    mkdirSync(nodePath.join(dir, 'sub'));
    writeFileSync(nodePath.join(dir, 'big.bin'), Buffer.alloc(100, 7));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('reads text as UTF-8', () => {
    assert.strictEqual(nodePlatform.fs.readText(nodePath.join(dir, 'a.dita')), 'héllo');
    assert.throws(() => nodePlatform.fs.readText(nodePath.join(dir, 'nope')));
  });

  it('readHead reads at most maxBytes and throws when unreadable', () => {
    assert.strictEqual(nodePlatform.fs.readHead(nodePath.join(dir, 'big.bin'), 10).length, 10);
    assert.strictEqual(nodePlatform.fs.readHead(nodePath.join(dir, 'a.dita'), 1000).length, 6);
    assert.throws(() => nodePlatform.fs.readHead(nodePath.join(dir, 'nope'), 10));
  });

  it('stat gives size and mtimeMs, undefined when missing', () => {
    const st = nodePlatform.fs.stat(nodePath.join(dir, 'a.dita'));
    assert.strictEqual(st?.size, 6);
    assert.strictEqual(typeof st?.mtimeMs, 'number');
    assert.strictEqual(nodePlatform.fs.stat(nodePath.join(dir, 'nope')), undefined);
  });

  it('exists and readDir', () => {
    assert.ok(nodePlatform.fs.exists(dir));
    assert.ok(!nodePlatform.fs.exists(nodePath.join(dir, 'nope')));
    const entries = nodePlatform.fs.readDir(dir).sort((a, b) => a.name.localeCompare(b.name));
    assert.deepStrictEqual(entries, [
      { name: 'a.dita', isDirectory: false },
      { name: 'big.bin', isDirectory: false },
      { name: 'sub', isDirectory: true },
    ]);
    assert.throws(() => nodePlatform.fs.readDir(nodePath.join(dir, 'nope')));
  });

  it('realPath follows a symlink', function () {
    const link = nodePath.join(dir, 'link');
    try {
      symlinkSync(nodePath.join(dir, 'sub'), link, 'dir');
    } catch {
      this.skip(); // no symlink permission (Windows without developer mode)
    }
    assert.strictEqual(nodePlatform.fs.realPath?.(link), nodePlatform.fs.realPath?.(nodePath.join(dir, 'sub')));
  });

  it('path is the platform\'s own path module', () => {
    assert.strictEqual(nodePlatform.path.sep, nodePath.sep);
    assert.strictEqual(nodePlatform.path.join('a', 'b'), nodePath.join('a', 'b'));
    assert.strictEqual(nodePlatform.path.caseSensitive, process.platform !== 'win32');
  });
});
