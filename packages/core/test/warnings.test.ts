import * as assert from 'assert';
import { createMemoryFileSystem } from '../src/memoryFileSystem';
import { createRuntime, withRuntime } from '../src/runtime';
import { posixPath } from '../src/posixPath';
import { collectDitamapFilesUpward } from '../src/editor/topicRender';
import { collectReferenceableFiles } from '../src/language/referenceableFiles';
import type { AnalysisWarning } from '../src/warnings';

/** Fails the test if anything writes to the console while fn runs: core reports through a sink, never the console. */
async function noConsole<T>(fn: () => Promise<T> | T): Promise<T> {
  const original = { warn: console.warn, log: console.log, error: console.error };
  const seen: string[] = [];
  console.warn = console.log = console.error = (...args: unknown[]): void => {
    seen.push(args.map(String).join(' '));
  };
  try {
    return await fn();
  } finally {
    Object.assign(console, original);
    assert.deepStrictEqual(seen, [], 'core wrote to the console');
  }
}

describe('warning sink', () => {
  const unreadable = (): never => {
    throw new Error('EACCES');
  };

  describe('collectReferenceableFiles', () => {
    it('reports an unreadable directory to onWarning and keeps the rest', async () => {
      const warnings: AnalysisWarning[] = [];
      const result = await noConsole(() => collectReferenceableFiles('/ws', async () => unreadable(), { onWarning: (w) => warnings.push(w) }));
      assert.deepStrictEqual(result, []);
      assert.strictEqual(warnings.length, 1);
      assert.strictEqual(warnings[0].code, 'directory-unreadable');
      assert.strictEqual(warnings[0].path, '/ws');
      assert.match(warnings[0].message, /EACCES/);
    });

    it('is silent without a sink', async () => {
      const result = await noConsole(() => collectReferenceableFiles('/ws', async () => unreadable()));
      assert.deepStrictEqual(result, []);
    });
  });

  describe('collectDitamapFilesUpward', () => {
    const throwingFs = (): ReturnType<typeof createRuntime> => {
      const fs = { ...createMemoryFileSystem({ '/ws/a.ditamap': '' }), readDir: unreadable };
      return createRuntime({ fs, path: posixPath });
    };

    it('reports an unreadable directory to onWarning', async () => {
      const warnings: AnalysisWarning[] = [];
      const found = await noConsole(() => withRuntime(throwingFs(), () => collectDitamapFilesUpward('/ws', '/ws', false, (w) => warnings.push(w))));
      assert.deepStrictEqual(found, []);
      assert.deepStrictEqual(
        warnings.map((w) => [w.code, w.path]),
        [['directory-unreadable', '/ws']],
      );
    });

    it('is silent without a sink', async () => {
      await noConsole(() => withRuntime(throwingFs(), () => collectDitamapFilesUpward('/ws', '/ws', false)));
    });
  });
});
