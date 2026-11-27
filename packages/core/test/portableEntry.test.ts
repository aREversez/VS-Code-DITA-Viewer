import * as assert from 'assert';
import * as portable from '../src/portable';
import { createEngine } from '../src/engine';
import { PORTABLE_PURE, RUNTIME_DEPENDENT } from '../src/exportKinds';
import { createMemoryFileSystem } from '../src/memoryFileSystem';
import { posixPath } from '../src/posixPath';
import { getDefaultRuntime, setDefaultRuntime } from '../src/runtime';
import type { Platform } from '../src/platform';

describe('portable entry', () => {
  let saved: ReturnType<typeof getDefaultRuntime>;
  beforeEach(() => {
    saved = getDefaultRuntime();
    setDefaultRuntime(undefined); // a portable host has no default runtime
  });
  afterEach(() => setDefaultRuntime(saved));

  it('exports the pure names, the engine and the in-memory platform pieces, and nothing else', () => {
    assert.deepStrictEqual(Object.keys(portable).sort(), [...PORTABLE_PURE, 'createEngine', 'createMemoryFileSystem', 'posixPath'].sort());
  });

  it('does not export a runtime-dependent name at top level', () => {
    for (const n of RUNTIME_DEPENDENT) assert.ok(!(n in portable), n);
  });

  it('an engine has every runtime-dependent method and its platform', () => {
    const platform: Platform = { fs: createMemoryFileSystem(), path: posixPath };
    const engine = createEngine(platform);
    assert.strictEqual(engine.platform, platform);
    for (const n of RUNTIME_DEPENDENT) assert.strictEqual(typeof engine[n], 'function', n);
  });

  it('renders through an engine with no default runtime installed', () => {
    const engine = createEngine({ fs: createMemoryFileSystem({ '/ws/other.dita': '<topic id="o"><title>Other</title></topic>' }), path: posixPath });
    const html = engine.renderTopicXml({
      xml: '<topic id="t"><title>Hello</title><body><p>text <xref href="other.dita"/></p></body></topic>',
      docDir: '/ws',
      keyMap: new Map(),
      asWebviewUri: (p) => p,
      headingLevel: 1,
    }).html;
    assert.match(html, /Hello/);
    assert.match(html, /Other/, 'the xref text came from the memory file system');
  });
});
