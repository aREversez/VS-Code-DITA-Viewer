import * as assert from 'assert';
import { posix } from 'path';
import { posixPath } from '../../src/posixPath';

// posixPath must agree with Node's path.posix: a portable host and a Node host
// have to turn the same href into the same file.
const PATHS = [
  '', '.', '..', '/', '//', '/a', '/a/', '/a/b', '/a/b/', '/a//b', '/a/./b', '/a/../b', '/a/b/..', '/a/b/../..', '/../a', '/a/../../b',
  'a', 'a/', 'a/b', './a', '../a', 'a/..', 'a/../..', '../../a', 'a/./b/../c', './', '../', 'a//', '.hidden', 'a/.hidden', '/a/b.dita',
  'a/b.tar.gz', 'a/.', 'a/..', '/.dita', 'a.', 'a..', '...', 'a/b.', 'x.y/z', 'x.y/', '//a', '//a//b',
];

describe('posixPath (agrees with path.posix)', () => {
  it('is POSIX and case-sensitive', () => {
    assert.strictEqual(posixPath.sep, '/');
    assert.strictEqual(posixPath.caseSensitive, true);
  });

  for (const fn of ['normalize', 'dirname', 'extname', 'isAbsolute'] as const) {
    it(`${fn} on a table of paths`, () => {
      for (const p of PATHS) {
        assert.strictEqual(posixPath[fn](p), posix[fn](p), `${fn}(${JSON.stringify(p)})`);
      }
    });
  }

  it('join on a table of segment lists', () => {
    const cases: string[][] = [
      [], [''], ['', ''], ['a'], ['a', 'b'], ['/a', 'b'], ['a/', '/b'], ['a', '..', 'b'], ['a', '../..'], ['', 'a'], ['a', ''], ['/', 'a'],
      ['/a/b', '../c'], ['.', 'a'], ['a', '.'], ['../a', '../b'], ['a/', ''], ['/a', '/b'], ['//a', 'b'],
    ];
    for (const c of cases) assert.strictEqual(posixPath.join(...c), posix.join(...c), `join(${JSON.stringify(c)})`);
  });

  it('resolve on a table of segment lists (absolute ones only: there is no working directory)', () => {
    const cases: string[][] = [
      ['/'], ['/a'], ['/a/'], ['/a', 'b'], ['/a', '/b'], ['/a', 'b', '/c', 'd'], ['/a/b', '..'], ['/a/b', '../..'], ['/a/b', '../../..'],
      ['/a', '', 'b'], ['/a', './b'], ['/a', 'b/'], ['/a/./b/../c'], ['x', '/a'], ['x', 'y', '/a/b', 'c/../d'], ['/a', '..', '..'],
    ];
    for (const c of cases) assert.strictEqual(posixPath.resolve(...c), posix.resolve(...c), `resolve(${JSON.stringify(c)})`);
  });

  it('resolve with no absolute segment anchors at the root', () => {
    assert.strictEqual(posixPath.resolve('a', 'b'), '/a/b');
    assert.strictEqual(posixPath.resolve('a/../..'), '/');
    assert.strictEqual(posixPath.resolve(), '/');
    assert.strictEqual(posixPath.resolve('', ''), '/');
  });

  it('relative on a table of pairs', () => {
    const cases: [string, string][] = [
      ['/a/b', '/a/b'], ['/a/b', '/a/c'], ['/a/b', '/a/b/c/d'], ['/a/b/c', '/a'], ['/a', '/b'], ['/', '/a/b'], ['/a/b', '/'], ['/a/b/', '/a/b/c'],
      ['/a/./b', '/a/c/../b/d'], ['/a/b', '/a/bc'], ['/a/bc', '/a/b'], ['/x/y/../z', '/x/z/w'], ['/', '/'],
    ];
    for (const [a, b] of cases) assert.strictEqual(posixPath.relative(a, b), posix.relative(a, b), `relative(${a}, ${b})`);
  });
});
