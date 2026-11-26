import * as assert from 'assert';
import { createMemoryFileSystem } from '../src/memoryFileSystem';
import { posixPath } from '../src/posixPath';
import { createRuntime, getDefaultRuntime, rt, setDefaultRuntime, withRuntime } from '../src/runtime';

describe('runtime', () => {
  const a = createRuntime({ fs: createMemoryFileSystem(), path: posixPath });
  const b = createRuntime({ fs: createMemoryFileSystem(), path: posixPath });
  let saved: ReturnType<typeof getDefaultRuntime>;
  beforeEach(() => {
    saved = getDefaultRuntime();
    setDefaultRuntime(undefined);
  });
  afterEach(() => setDefaultRuntime(saved));

  it('rt() throws a clear error when there is neither an active nor a default runtime', () => {
    assert.throws(() => rt(), /no platform/);
  });

  it('withRuntime activates a runtime for the call and restores afterwards', () => {
    assert.strictEqual(
      withRuntime(a, () => rt()),
      a,
    );
    assert.throws(() => rt(), /no platform/);
  });

  it('nests, and restores the outer runtime when the inner call ends', () => {
    withRuntime(a, () => {
      assert.strictEqual(rt(), a);
      withRuntime(b, () => assert.strictEqual(rt(), b));
      assert.strictEqual(rt(), a);
    });
  });

  it('restores the previous runtime when the call throws', () => {
    withRuntime(a, () => {
      assert.throws(() =>
        withRuntime(b, () => {
          throw new Error('boom');
        }),
      );
      assert.strictEqual(rt(), a);
    });
    assert.throws(() => rt(), /no platform/);
  });

  it('falls back to the default runtime outside withRuntime, and the active one wins inside', () => {
    setDefaultRuntime(a);
    assert.strictEqual(rt(), a);
    assert.strictEqual(
      withRuntime(b, () => rt()),
      b,
    );
    assert.strictEqual(rt(), a);
  });

  it('returns what the callback returns', () => {
    assert.strictEqual(
      withRuntime(a, () => 42),
      42,
    );
  });
});
