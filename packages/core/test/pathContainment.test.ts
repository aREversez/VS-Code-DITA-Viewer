import * as assert from 'assert';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { isInsideAny, isPathInside } from '../src/pathContainment';

describe('isPathInside', () => {
  const root = resolve('/ws/project');
  it('accepts the root itself and anything below it', () => {
    assert.ok(isPathInside(root, root));
    assert.ok(isPathInside(root, join(root, 'a', 'b.dita')));
    assert.ok(isPathInside(root, resolve(root, 'a/../b.dita')));
  });
  it('rejects a sibling, a parent, and a ../ escape', () => {
    assert.ok(!isPathInside(root, resolve('/ws/other/a.dita')));
    assert.ok(!isPathInside(root, resolve('/ws')));
    assert.ok(!isPathInside(root, resolve(root, '../../etc/hosts')));
  });
  it('a sibling that merely shares the name prefix is outside', () => {
    assert.ok(!isPathInside(root, resolve('/ws/project-extra/a.dita')));
  });
  it('a folder named "..hidden" is inside', () => {
    assert.ok(isPathInside(root, join(root, '..hidden', 'a.dita')));
  });
  it('follows a symlink that leaves the root', function () {
    const base = mkdtempSync(join(tmpdir(), 'contain-'));
    try {
      const inside = join(base, 'ws');
      const outside = join(base, 'secret');
      mkdirSync(inside);
      mkdirSync(outside);
      writeFileSync(join(outside, 'k.txt'), 'x');
      try {
        symlinkSync(outside, join(inside, 'link'), 'dir');
      } catch {
        this.skip(); // no symlink permission (Windows without developer mode)
      }
      assert.ok(!isPathInside(inside, join(inside, 'link', 'k.txt')));
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('isInsideAny', () => {
  it('is true when one root contains it, false for none', () => {
    const a = resolve('/ws/a');
    const b = resolve('/ws/b');
    assert.ok(isInsideAny([a, b], join(b, 'x.dita')));
    assert.ok(!isInsideAny([a, b], resolve('/ws/c/x.dita')));
    assert.ok(!isInsideAny([], join(a, 'x.dita')));
  });
});
