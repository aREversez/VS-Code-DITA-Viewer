import * as assert from 'assert';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import {
  getKeyContextMap,
  setKeyContextMap,
  onKeyContextChanged,
  reportKeyContextMissing,
  onKeyContextMissing,
} from '../../editor/keyContext';
import { keySourceMaps, isKeyContextAvailable } from '../../editor/keySpace';

describe('keyContext state', () => {
  afterEach(() => {
    setKeyContextMap(undefined);
  });

  it('starts unset, stores a resolved path, and clears with undefined', () => {
    assert.strictEqual(getKeyContextMap(), undefined);
    setKeyContextMap('some/dir/../brand.ditamap');
    assert.strictEqual(getKeyContextMap(), resolve('some/brand.ditamap'));
    setKeyContextMap(undefined);
    assert.strictEqual(getKeyContextMap(), undefined);
  });

  it('notifies listeners only when the value really changes', () => {
    let calls = 0;
    const sub = onKeyContextChanged(() => calls++);
    setKeyContextMap(resolve('a.ditamap'));
    setKeyContextMap(resolve('a.ditamap'));
    assert.strictEqual(calls, 1);
    setKeyContextMap(undefined);
    assert.strictEqual(calls, 2);
    sub.dispose();
    setKeyContextMap(resolve('b.ditamap'));
    assert.strictEqual(calls, 2, 'a disposed listener is not called');
  });

  it('reports a missing context once per path until the context is set again', () => {
    const seen: string[] = [];
    const sub = onKeyContextMissing((p) => seen.push(p));
    reportKeyContextMissing('/x/a.ditamap');
    reportKeyContextMissing('/x/a.ditamap');
    reportKeyContextMissing('/x/b.ditamap');
    assert.deepStrictEqual(seen, ['/x/a.ditamap', '/x/b.ditamap']);
    setKeyContextMap(resolve('c.ditamap'));
    reportKeyContextMissing('/x/a.ditamap');
    assert.strictEqual(seen.length, 3);
    sub.dispose();
  });
});

describe('keySourceMaps', () => {
  let root: string;
  let ctx: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'keysrc-'));
    ctx = join(root, 'ctx.ditamap');
    writeFileSync(ctx, '<map/>');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('is the ancestor maps when no context is set', () => {
    assert.deepStrictEqual(keySourceMaps(undefined, () => ['/a', '/b']), ['/a', '/b']);
  });

  it('is only the context map when it exists, without walking the ancestors', () => {
    let walked = false;
    const out = keySourceMaps(ctx, () => {
      walked = true;
      return ['/a'];
    });
    assert.deepStrictEqual(out, [ctx]);
    assert.strictEqual(walked, false);
  });

  it('is the ancestor maps when the context file is gone', () => {
    const gone = join(root, 'gone.ditamap');
    assert.strictEqual(isKeyContextAvailable(gone), false);
    assert.deepStrictEqual(keySourceMaps(gone, () => ['/a']), ['/a']);
  });
});
