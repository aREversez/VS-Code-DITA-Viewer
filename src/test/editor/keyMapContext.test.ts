import * as assert from 'assert';
import Module = require('module');
import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join, basename } from 'path';
import { setKeyContextMap, onKeyContextMissing } from '../../editor/keyContext';
import { getKeyDefs } from '../../editor/keySpace';

// keyMap.ts imports vscode at module scope (parseDocRoot / Uri), which the
// mocha process does not have. This loads the REAL keyMap.ts against a
// minimal stand-in, so the wiring between the workspace context map and
// buildKeyMap / getKeySourceMaps is tested itself rather than only the pure
// pieces it calls (keySpace.ts).
type Loader = (request: string, ...rest: unknown[]) => unknown;
interface ModuleInternals {
  _load: Loader;
}
type KeyMapModule = typeof import('../../editor/keyMap');
type DocUri = Parameters<KeyMapModule['buildKeyMap']>[0];

describe('buildKeyMap with a context map (real keyMap.ts, vscode stubbed)', () => {
  let root: string;
  let topic: DocUri;
  let brandA: string;
  let brandB: string;
  let keyMap: KeyMapModule;
  const internals = Module as unknown as ModuleInternals;
  const originalLoad = internals._load;

  const kd = (k: string, v: string) =>
    `<keydef keys="${k}"><topicmeta><keywords><keyword>${v}</keyword></keywords></topicmeta></keydef>`;
  const write = (name: string, body: string) => {
    const p = join(root, name);
    writeFileSync(p, `<map>${body}</map>`);
    return p;
  };

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'keymap-ctx-'));
    const vscodeStub = {
      Uri: { file: (p: string) => ({ fsPath: p }) },
      workspace: {
        getWorkspaceFolder: () => ({ uri: { fsPath: root } }),
        workspaceFolders: [{ uri: { fsPath: root } }],
      },
    };
    internals._load = function (request: string, ...rest: unknown[]) {
      return request === 'vscode' ? vscodeStub : originalLoad.call(this, request, ...rest);
    };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    keyMap = require('../../editor/keyMap') as KeyMapModule;
  });

  after(() => {
    internals._load = originalLoad;
    rmSync(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    brandA = write('brandA.ditamap', kd('product', 'Alpha'));
    brandB = write('brandB.ditamap', kd('product', 'Beta'));
    write('common.ditamap', kd('company', 'Acme'));
    topic = { fsPath: join(root, 'topic.dita') } as DocUri;
    keyMap.clearKeyMapCache();
    setKeyContextMap(undefined);
  });

  afterEach(() => {
    setKeyContextMap(undefined);
    for (const f of ['brandA.ditamap', 'brandB.ditamap', 'common.ditamap']) {
      try {
        unlinkSync(join(root, f));
      } catch {
        /* already removed by the test */
      }
    }
  });

  it('hands back the same Map instance conkeyref keys its defs on (WeakMap identity)', () => {
    // conkeyref looks up a key's href through a WeakMap keyed on the exact
    // values-map instance buildKeySpace produced (keySpace.ts: registerKeyDefs).
    // buildKeyMap must hand back that same instance; a defensive copy
    // (`new Map(space.keys)`) or any rewrap on a cache miss would drop the defs
    // and silently disable conkeyref while every *text* keyref kept working --
    // exactly the drift the render-side identity caching cannot see.
    const legal = join(root, 'legal.ditamap');
    writeFileSync(
      legal,
      '<map><keydef keys="legal" href="common/legal.dita"><topicmeta><keywords><keyword>Legal</keyword></keywords></topicmeta></keydef></map>',
    );
    setKeyContextMap(legal);
    const keys = keyMap.buildKeyMap(topic);
    assert.strictEqual(keys.get('legal'), 'Legal');
    const defs = getKeyDefs(keys);
    assert.ok(defs, 'buildKeyMap must return the instance buildKeySpace registered defs against');
    assert.strictEqual(defs.get('legal')?.href, 'common/legal.dita', 'the href a keydef declares must reach conkeyref');
    unlinkSync(legal);
  });

  it('without a context resolves against the ancestor maps (unchanged)', () => {
    const keys = keyMap.buildKeyMap(topic);
    assert.strictEqual(keys.get('company'), 'Acme');
    assert.ok(keys.has('product'));
  });

  it('resolves a key the maps define differently by the chosen context, and hides the other maps', () => {
    setKeyContextMap(brandB);
    const b = keyMap.buildKeyMap(topic);
    assert.strictEqual(b.get('product'), 'Beta');
    assert.strictEqual(b.has('company'), false);
    setKeyContextMap(brandA);
    assert.strictEqual(keyMap.buildKeyMap(topic).get('product'), 'Alpha');
  });

  it('hands out a different Map instance per context, so render caches keyed on identity refresh', () => {
    setKeyContextMap(brandA);
    const a = keyMap.buildKeyMap(topic);
    assert.strictEqual(keyMap.buildKeyMap(topic), a, 'stable while nothing changes');
    setKeyContextMap(brandB);
    const b = keyMap.buildKeyMap(topic);
    assert.notStrictEqual(b, a);
    setKeyContextMap(brandA);
    assert.strictEqual(keyMap.buildKeyMap(topic).get('product'), 'Alpha');
  });

  it('gives every document the same key space under a context, wherever it sits', () => {
    setKeyContextMap(brandB);
    const here = keyMap.buildKeyMap(topic);
    const elsewhere = keyMap.buildKeyMap({ fsPath: join(root, 'deep', 'other.dita') } as DocUri);
    assert.strictEqual(elsewhere, here);
  });

  it('picks up an edit to the context map on disk', () => {
    setKeyContextMap(brandB);
    assert.strictEqual(keyMap.buildKeyMap(topic).get('product'), 'Beta');
    writeFileSync(brandB, `<map>${kd('product', 'Beta, revised')}</map>`);
    assert.strictEqual(keyMap.buildKeyMap(topic).get('product'), 'Beta, revised');
  });

  it('points go-to-definition at the same maps the values come from', () => {
    setKeyContextMap(brandA);
    assert.deepStrictEqual(keyMap.getKeySourceMaps(topic).map((p) => basename(p)), ['brandA.ditamap']);
    setKeyContextMap(undefined);
    assert.ok(keyMap.getKeySourceMaps(topic).length >= 3, 'all ancestor maps without a context');
  });

  it('falls back to the ancestor maps and reports a deleted context once', () => {
    const reported: string[] = [];
    const sub = onKeyContextMissing((p) => reported.push(p));
    setKeyContextMap(brandA);
    unlinkSync(brandA);
    keyMap.clearKeyMapCache();
    assert.strictEqual(keyMap.buildKeyMap(topic).get('company'), 'Acme');
    keyMap.clearKeyMapCache();
    keyMap.buildKeyMap(topic);
    assert.deepStrictEqual(reported, [brandA]);
    sub.dispose();
  });
});
