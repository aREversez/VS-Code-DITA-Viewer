import * as assert from 'assert';
import * as portable from '../../src/portable';
import { createEngine } from '../../src/engine';
import { PORTABLE_PURE } from '../../src/exportKinds';
import type { Platform } from '../../src/platform';
import { getDefaultRuntime, setDefaultRuntime } from '../../src/runtime';

// DESIGN.md 3.7 item 4. With no runtime installed, and with an engine over a
// platform whose every method throws sitting next to them, every name classified
// as pure must still work. The static analysis in exportKinds.test.ts says none
// of them can reach the runtime; this runs each one to show it does not.
describe('tripwire: every pure export works with no platform', () => {
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
    fs: { readText: boom, readHead: boom, exists: boom, stat: boom, readDir: boom, realPath: boom },
    path: { sep: '/', caseSensitive: true, resolve: boom, join: boom, dirname: boom, relative: boom, isAbsolute: boom, normalize: boom, extname: boom },
  };

  const topicXml = '<topic id="t"><title>T</title><body><p id="p1" audience="a">one <keyword keyref="k">x</keyword></p><note>n</note><indexterm>term</indexterm></body></topic>';
  const mapXml = '<map xml:lang="en"><title>M</title><topicref href="a.dita" navtitle="A" keys="k"/><keydef keys="kk" href="k.dita"/></map>';
  const topic = portable.parseDita(topicXml).root;
  const map = portable.parseDitamap(mapXml).root;
  const filter = { hidden: new Set(['audience:a']), ditaval: portable.parseDitaval('<val><prop att="product" val="b" action="exclude"/></val>') };
  const keys = new Map([['k', 'a.dita']]);

  const calls: Record<string, () => unknown> = {
    parseDita: () => portable.parseDita(topicXml),
    parseDitamap: () => portable.parseDitamap(mapXml),
    preprocessEntities: () => portable.preprocessEntities('<a>&nbsp;&copy;</a>'),
    lookupNamedEntity: () => portable.lookupNamedEntity('nbsp'),
    complete: () =>
      portable.complete('<topic><', 8, { isMap: false, keys: () => keys, files: () => ['a.dita'], idsIn: () => ['x'] }),
    collectIds: () => portable.collectIds(topicXml),
    collectIndextermChips: () => portable.collectIndextermChips(topic),
    collectMapSymbols: () => portable.collectMapSymbols(map),
    collectRefEntries: () => portable.collectRefEntries('<p><xref href="a.dita#x"/></p>'),
    collectText: () => portable.collectText(topic),
    collectTopicSymbols: () => portable.collectTopicSymbols(topic),
    collectUnknownElements: () => portable.collectUnknownElements(topic),
    computeKeyrefSpacing: () => portable.computeKeyrefSpacing(topic.children ?? [], 'topic/p', (k) => keys.get(k)),
    createBookRoleLabeler: () => portable.createBookRoleLabeler(undefined),
    createKeyScopeIndex: () => portable.createKeyScopeIndex(),
    buildTitleMap: () => portable.buildTitleMap(topic),
    decodeHrefPart: () => portable.decodeHrefPart('a%20b.dita'),
    detectDraftCommentLabel: () => portable.detectDraftCommentLabel(topic, 'en'),
    detectDraftCommentMetaLabels: () => portable.detectDraftCommentMetaLabels(topic, 'zh-CN'),
    detectIndexLabel: () => portable.detectIndexLabel(topic, 'en'),
    detectNoteLabels: () => portable.detectNoteLabels(topic, 'en'),
    ditavalAction: () => portable.ditavalAction(filter.ditaval, 'product', 'b'),
    extractText: () => portable.extractText(topic, (k) => keys.get(k)),
    fillRefErrorTemplate: () => portable.fillRefErrorTemplate('{0} {1}', 'a', 'b'),
    findConrefTargetOffset: () => portable.findConrefTargetOffset(topicXml, 't/p1'),
    findEnclosingKeydefKeys: () => portable.findEnclosingKeydefKeys(mapXml, mapXml.indexOf('keydef') + 3),
    findIdAttrAt: () => portable.findIdAttrAt(topicXml, topicXml.indexOf('p1')),
    findKeyDefinitionOffset: () => portable.findKeyDefinitionOffset(mapXml, 'kk'),
    findKeysAttrAt: () => portable.findKeysAttrAt(mapXml, mapXml.indexOf('keys=') + 8),
    findRefAttrAt: () => portable.findRefAttrAt('<xref href="a.dita"/>', 13),
    findTopLevelIndextermsInSubtree: () => portable.findTopLevelIndextermsInSubtree(topic),
    findUnclosedTag: () => portable.findUnclosedTag('<p><b>'),
    getAttributesForTag: () => portable.getAttributesForTag('xref'),
    getAutoCloseTag: () => portable.getAutoCloseTag('<p>', 3),
    getCloseTagCompletion: () => portable.getCloseTagCompletion('<p></', 5),
    getCompletionContext: () => portable.getCompletionContext('<p><', 4),
    getDisplayNameInfo: () => portable.getDisplayNameInfo(map.children?.[1] ?? map, (k) => keys.get(k)),
    getKeyDefs: () => portable.getKeyDefs(keys),
    getKeyScopes: () => portable.getKeyScopes(keys),
    getMapRefName: () => portable.getMapRefName(map),
    getMapTitleText: () => portable.getMapTitleText(map),
    isEmptyFilter: () => portable.isEmptyFilter(filter),
    isExcluded: () => portable.isExcluded({ audience: ['a'] }, filter),
    isExternalRef: () => portable.isExternalRef('https://x.y'),
    isValueExcluded: () => portable.isValueExcluded(filter, 'audience', 'a'),
    lookupNamedEntityAgain: () => portable.lookupNamedEntity('amp'),
    mergeProfilingAttrs: () => portable.mergeProfilingAttrs({ audience: 'a' }, { product: 'b' }),
    needsSpace: () => portable.needsSpace('中', 'a'),
    offsetToLineCol: () => portable.offsetToLineCol('a\nb', 2),
    parseDitaval: () => portable.parseDitaval('<val><prop att="audience" val="a" action="exclude"/></val>'),
    profileGroups: () => portable.profileGroups([{ audience: ['a', 'b'] }], ['audience:a']),
    profileKey: () => portable.profileKey('audience', 'a'),
    profileValuesOf: () => portable.profileValuesOf({ audience: 'a b' }),
    profileValuesOfKeys: () => portable.profileValuesOfKeys('audience:a audience:b'),
    profilingChipsHtml: () => portable.profilingChipsHtml({ audience: 'a' }),
    profilingKeysAttr: () => portable.profilingKeysAttr({ audience: 'a' }),
    pruneExcluded: () => portable.pruneExcluded(portable.parseDita(topicXml).root, filter),
    qualifiedNames: () => portable.qualifiedNames('k', ['s1']),
    qualifiedNamesMulti: () => portable.qualifiedNamesMulti('k', [['s1'], ['s2']]),
    renderMapDocument: () => portable.renderMapDocument(map, { docDir: '/ws', resolveKey: (k) => keys.get(k) }),
    resolveConkeyref: () => portable.resolveConkeyref('k/x', { get: () => undefined } as never, () => undefined),
    resolveKeyInScope: () => portable.resolveKeyInScope('k', [['s1']], new Map([[portable.scopeKeyIndexKey('s1', 'k'), 1]])),
    scopeKeyIndexKey: () => portable.scopeKeyIndexKey('s1', 'k'),
    splitRefFragment: () => portable.splitRefFragment('a.dita#x/y'),
    stripSameDocumentFragmentPrefix: () => portable.stripSameDocumentFragmentPrefix('./x'),
  };

  const portableRecord = portable as unknown as Record<string, unknown>;
  const functions = PORTABLE_PURE.filter((n) => typeof portableRecord[n] === 'function');
  const constants = PORTABLE_PURE.filter((n) => typeof portableRecord[n] !== 'function');

  it('has a call for every pure function, and no call for a name that is not pure', () => {
    const want = new Set<string>(functions);
    const have = Object.keys(calls).filter((n) => n !== 'lookupNamedEntityAgain');
    assert.deepStrictEqual(have.filter((n) => !want.has(n)), []);
    assert.deepStrictEqual(functions.filter((n) => !(n in calls)), [], 'add a call for these');
  });

  it('every pure constant has a value', () => {
    for (const n of constants) assert.notStrictEqual(portableRecord[n], undefined, n);
  });

  for (const [name, call] of Object.entries(calls)) {
    it(`${name} works with no runtime, and with a throwing engine alive`, async () => {
      createEngine(throwingPlatform); // creating an engine touches nothing
      await call();
    });
  }

  it('a runtime-dependent function on the throwing engine fails loudly, not silently', () => {
    assert.throws(() => createEngine(throwingPlatform).sourceStamp('/x'), /platform was touched/);
  });

  it('a runtime-dependent function with no engine and no default runtime says there is no platform', () => {
    assert.throws(() => (require('../../src/editor/sourceText') as typeof import('../../src/editor/sourceText')).sourceStamp('/x'), /no platform/);
  });
});
