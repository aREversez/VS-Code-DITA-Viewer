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

// With a platform whose every method throws, whatever is classified as pure still works.
describe('tripwire: pure exports need no platform', () => {
  let saved: ReturnType<typeof getDefaultRuntime>;
  beforeEach(() => {
    saved = getDefaultRuntime();
    setDefaultRuntime(undefined);
  });
  afterEach(() => setDefaultRuntime(saved));

  const boom = () => {
    throw new Error('the platform was touched');
  };
  const throwingPlatform: Platform = {
    fs: { readText: boom, readHead: boom, exists: boom, stat: boom, readDir: boom },
    path: { sep: '/', caseSensitive: true, resolve: boom, join: boom, dirname: boom, relative: boom, isAbsolute: boom, normalize: boom, extname: boom },
  };
  const topic = '<topic id="t"><title>T</title><body><p id="p1">one <ph audience="a">two</ph></p><note>n</note></body></topic>';
  const map = '<map><title>M</title><topicref href="a.dita" navtitle="A"/><keydef keys="k" href="k.dita"/></map>';

  const calls: Record<string, () => unknown> = {
    parseDita: () => portable.parseDita(topic),
    parseDitamap: () => portable.parseDitamap(map),
    preprocessEntities: () => portable.preprocessEntities('<a>&nbsp;</a>'),
    lookupNamedEntity: () => portable.lookupNamedEntity('nbsp'),
    getCompletionContext: () => portable.getCompletionContext('<p><', 4),
    complete: () => typeof portable.complete,
    collectIds: () => portable.collectIds(topic),
    collectRefEntries: () => portable.collectRefEntries('<p><xref href="a.dita#x"/></p>'),
    splitRefFragment: () => portable.splitRefFragment('a.dita#x/y'),
    decodeHrefPart: () => portable.decodeHrefPart('a%20b.dita'),
    offsetToLineCol: () => portable.offsetToLineCol('a\nb', 2),
    isExternalRef: () => portable.isExternalRef('https://x.y'),
    findUnclosedTag: () => portable.findUnclosedTag('<p><b>'),
    parseDitaval: () => portable.parseDitaval('<val><prop att="audience" val="a" action="exclude"/></val>'),
    profileValuesOf: () => portable.profileValuesOf({ audience: 'a' }),
    computeKeyrefSpacing: () => portable.computeKeyrefSpacing,
    fillRefErrorTemplate: () => portable.fillRefErrorTemplate('{0} {1}', 'a', 'b'),
    collectText: () => typeof portable.collectText,
    getMapRefName: () => portable.getMapRefName(portable.parseDitamap(map).root),
    collectTopicSymbols: () => portable.collectTopicSymbols(portable.parseDita(topic).root),
    renderMapDocument: () => typeof portable.renderMapDocument,
    createBookRoleLabeler: () => portable.createBookRoleLabeler(undefined),
    resolveKeyInScope: () => typeof portable.resolveKeyInScope,
  };

  for (const [name, call] of Object.entries(calls)) {
    it(`${name} works with no runtime`, () => {
      assert.doesNotThrow(call);
    });
  }

  it('the same calls still work when an engine over the throwing platform exists', () => {
    createEngine(throwingPlatform); // creating an engine touches nothing
    for (const call of Object.values(calls)) assert.doesNotThrow(call);
  });

  it('a runtime-dependent function with no runtime fails loudly, not silently', () => {
    assert.throws(() => createEngine(throwingPlatform).sourceStamp('/x'), /platform was touched/);
  });
});
