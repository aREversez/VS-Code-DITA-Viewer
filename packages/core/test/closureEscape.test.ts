import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as api from '../src/api';
import { createEngine, type Engine } from '../src/engine';
import { RUNTIME_DEPENDENT } from '../src/exportKinds';
import { createMemoryFileSystem } from '../src/memoryFileSystem';
import { posixPath } from '../src/posixPath';
import { parseDita } from '../src/parser/ditaParser';
import { bindRuntime, getDefaultRuntime, setDefaultRuntime } from '../src/runtime';
import { analyseCallableReturns } from './helpers/returnsCallable';

// A function an engine hands out is called later, after the engine call has
// returned. It must still read through that engine's platform, whatever runtime
// is active when it is called: none (the portable shape), the default Node one,
// or another engine's. See bindRuntime in src/runtime.ts.

const coreRoot = path.resolve(__dirname, '..', '..');

/** Every export that returns a function (or an object of them), and the test below that exercises it. */
const HANDS_OUT_FUNCTIONS = ['buildRenderContext', 'makeConrefRangeResolver', 'makeConrefResolver', 'makeFileCache', 'makeFileTitleResolver', 'makeIsInCurrentBook', 'makeRefErrorResolver'];

const files = {
  '/p/a.dita': '<topic id="a"><title>Title A</title><body><p id="x">one</p><p id="y">two</p></body></topic>',
};

const ownRoot = parseDita(files['/p/a.dita']).root;
const engineOnMemory = (): Engine => createEngine({ fs: createMemoryFileSystem(files), path: posixPath });
const text = (n: { children?: { type: string; text?: string }[] } | undefined): string => (n?.children ?? []).map((c) => c.text ?? '').join('');

/** Everything the engine's functions give back, used after the engine call has returned. */
function useWhatTheEngineHandsOut(engine: Engine): void {
  const cache = engine.makeFileCache('/p');
  assert.strictEqual(cache.loadAbsPath('/p/a.dita')?.attributes?.id, 'a', 'makeFileCache: loadAbsPath');
  assert.strictEqual(cache.loadFile('a.dita')?.attributes?.id, 'a', 'makeFileCache: loadFile');
  assert.deepStrictEqual(cache.touchedFiles(), ['/p/a.dita'], 'makeFileCache: touchedFiles');

  assert.strictEqual(text(engine.makeConrefResolver('/p')('a.dita#a/x')), 'one', 'makeConrefResolver');
  assert.strictEqual(engine.makeConrefRangeResolver('/p')('a.dita#a/x', 'a.dita#a/y')?.length, 2, 'makeConrefRangeResolver');
  assert.strictEqual(engine.makeFileTitleResolver('/p')('a.dita'), 'Title A', 'makeFileTitleResolver');
  assert.strictEqual(engine.makeIsInCurrentBook('/p', new Set(['/p/a.dita']))('a.dita'), '/p/a.dita', 'makeIsInCurrentBook');
  const refError = engine.makeRefErrorResolver('/p');
  assert.ok(refError('nope.dita#a/x'), 'makeRefErrorResolver: a missing file is reported');
  assert.strictEqual(refError('a.dita#a/x'), undefined, 'makeRefErrorResolver: a present target is not');

  const asWebviewUri = (p: string): string => p;
  const { ctx } = engine.buildRenderContext({ docDir: '/p', ownRoot, titleMap: new Map(), keyMap: new Map(), asWebviewUri, headingLevel: 1, refErrors: true, docFile: '/p/a.dita' });
  assert.strictEqual(ctx.asWebviewUri, asWebviewUri, 'the host\'s own callback keeps its identity');
  assert.strictEqual(text(ctx.resolveConref?.('a.dita#a/x')), 'one', 'buildRenderContext: resolveConref');
  assert.strictEqual(ctx.resolveTitle?.('a.dita'), 'Title A', 'buildRenderContext: resolveTitle');
  assert.ok(ctx.refError?.('nope.dita#a/x'), 'buildRenderContext: refError');
  assert.strictEqual(ctx.getImageDimensions?.('nope.png'), undefined, 'buildRenderContext: getImageDimensions');
}

describe('functions an engine hands out keep the engine\'s runtime', () => {
  it('with no default runtime (the portable shape)', () => {
    const saved = getDefaultRuntime();
    setDefaultRuntime(undefined);
    try {
      useWhatTheEngineHandsOut(engineOnMemory());
    } finally {
      setDefaultRuntime(saved);
    }
  });

  it('with the default Node runtime installed: they do not fall back to the real file system', () => {
    useWhatTheEngineHandsOut(engineOnMemory());
  });

  it('while another engine is running a call', () => {
    const a = engineOnMemory();
    const other = createEngine({ fs: createMemoryFileSystem({ '/p/a.dita': '<topic id="b"><title>Other</title></topic>' }), path: posixPath });
    const cache = a.makeFileCache('/p');
    const seen = other.trackSourceReads(() => cache.loadAbsPath('/p/a.dita')?.attributes?.id);
    assert.strictEqual(seen.result, 'a', 'read from the engine that made the cache, not the one running');
    assert.strictEqual(seen.files.size, 0, 'and not recorded as a read of the running engine');
  });

  it('on the default runtime: a resolver made at top level is not captured by an engine call that happens to be running', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-closure-'));
    try {
      const file = path.join(dir, 'real.dita');
      fs.writeFileSync(file, '<topic id="real"><title>On disk</title></topic>');
      const cache = api.makeFileCache(dir);
      const running = engineOnMemory();
      const loaded = running.trackSourceReads(() => cache.loadAbsPath(file));
      assert.strictEqual(loaded.result?.attributes?.id, 'real', 'the resolver made on the Node runtime still reads the real file');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('binding is idempotent, and a no-runtime call leaves the function as it was', () => {
    const once = bindRuntime(() => 1);
    assert.strictEqual(bindRuntime(once), once);
    const saved = getDefaultRuntime();
    setDefaultRuntime(undefined);
    try {
      const fn = (): number => 2;
      assert.strictEqual(bindRuntime(fn), fn, 'with no runtime there is nothing to bind to');
    } finally {
      setDefaultRuntime(saved);
    }
  });

  it('is the list of exports that hand out functions complete? (static analysis of the return types)', function () {
    this.timeout(60000);
    const found = [...analyseCallableReturns(coreRoot, 'src/api.ts')].filter((n) => (RUNTIME_DEPENDENT as readonly string[]).includes(n)).sort();
    assert.deepStrictEqual(found, [...HANDS_OUT_FUNCTIONS].sort(), 'a new export returns a function: bind it with bindRuntime, test it above, and add its name to HANDS_OUT_FUNCTIONS');
  });

});
