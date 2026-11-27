import * as assert from 'assert';
import * as path from 'path';
import * as api from '../src/api';
import { PORTABLE_PURE, ROOT_ONLY, RUNTIME_DEPENDENT } from '../src/exportKinds';
import { analyseRuntimeReach } from './helpers/reachesRuntime';

const coreRoot = path.resolve(__dirname, '..', '..');

describe('export classification (src/exportKinds.ts)', function () {
  this.timeout(60000);
  const all = Object.keys(api).sort();
  const lists = { PORTABLE_PURE, RUNTIME_DEPENDENT, ROOT_ONLY };

  it('puts every runtime export of api.ts in exactly one list', () => {
    const seen = new Map<string, string>();
    for (const [listName, names] of Object.entries(lists)) {
      for (const n of names) {
        assert.ok(!seen.has(n), `${n} is in both ${seen.get(n)} and ${listName}`);
        seen.set(n, listName);
      }
    }
    assert.deepStrictEqual([...seen.keys()].sort(), all);
  });

  const reach = analyseRuntimeReach(coreRoot, 'src/api.ts');

  it('static analysis: nothing classified as pure can reach the runtime', () => {
    const bad = PORTABLE_PURE.filter((n) => reach.reaching.has(n));
    assert.deepStrictEqual(bad, [], `these can reach rt(), so they cannot be called without a platform: ${bad.join(', ')}`);
  });

  it('static analysis: everything that can reach the runtime is an engine method or root-only', () => {
    const allowed = new Set<string>([...RUNTIME_DEPENDENT, ...ROOT_ONLY]);
    const missing = [...reach.reaching].filter((n) => !allowed.has(n));
    assert.deepStrictEqual(missing, [], `classify these: ${missing.join(', ')}`);
  });

  it('static analysis: every engine method really can reach the runtime (the list stays minimal)', () => {
    const unneeded = RUNTIME_DEPENDENT.filter((n) => !reach.reaching.has(n));
    assert.deepStrictEqual(unneeded, [], `these never reach the runtime; move them to PORTABLE_PURE: ${unneeded.join(', ')}`);
  });

  it('engine methods are all functions', () => {
    for (const n of RUNTIME_DEPENDENT) assert.strictEqual(typeof (api as Record<string, unknown>)[n], 'function', n);
  });
});
