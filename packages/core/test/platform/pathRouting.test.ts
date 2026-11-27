import * as assert from 'assert';
import { nodePlatform } from '../../src/node/nodePlatform';
import { isPathInside } from '../../src/pathContainment';
import { toRelativeHref } from '../../src/language/referenceableFiles';
import type { PathOps } from '../../src/platform';
import { createRuntime, withRuntime } from '../../src/runtime';

// Core's path arithmetic must follow the active runtime, not Node's `path`.
describe('path arithmetic goes through the active runtime', () => {
  const withPath = (path: Partial<PathOps>) => createRuntime({ fs: nodePlatform.fs, path: { ...nodePlatform.path, ...path } });

  it('isPathInside asks the active PathOps (and its separator), not Node\'s', () => {
    const calls: string[] = [];
    const rt = withPath({
      resolve: (...s) => (calls.push('resolve'), nodePlatform.path.resolve(...s)),
      relative: (a, b) => (calls.push('relative'), nodePlatform.path.relative(a, b)),
      isAbsolute: (p) => (calls.push('isAbsolute'), nodePlatform.path.isAbsolute(p)),
    });
    assert.ok(withRuntime(rt, () => isPathInside('/ws/project', '/ws/project/a.dita')));
    for (const name of ['resolve', 'relative', 'isAbsolute']) assert.ok(calls.includes(name), `${name} was not called`);
  });

  it('the separator is the active platform\'s: a backslash flavour sees "..\\\\x" as an escape, a slash flavour does not', () => {
    const rel = (sep: string) => withPath({ sep, relative: () => '..\\x' });
    assert.strictEqual(withRuntime(rel('\\'), () => isPathInside('/a', '/b')), false);
    assert.strictEqual(withRuntime(rel('/'), () => isPathInside('/a', '/b')), true);
  });

  it('referenceable-file hrefs use the active relative/normalize/join', () => {
    const rt = withPath({ relative: () => 'from-the-fake-platform.dita', normalize: (p) => p });
    assert.ok(withRuntime(rt, () => toRelativeHref('/ws/a', '/ws/b.dita')).includes('from-the-fake-platform.dita'));
  });
});
