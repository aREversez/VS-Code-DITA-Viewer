import * as assert from 'assert';
import { DitaNode } from '../../parser/domTypes';
import { KeyHrefDef } from '../../editor/keySpace';
import { resolveConkeyref } from '../../editor/conkeyref';

const RANGE = { startLine: 0, startCol: 0, endLine: 0, endCol: 0 };

function el(tagName: string, attributes: Record<string, string> = {}, children: DitaNode[] = []): DitaNode {
  return { type: 'element', tagName, baseType: `topic/${tagName}`, attributes, children, sourceRange: RANGE };
}
function txt(text: string): DitaNode {
  return { type: 'text', text, children: [], sourceRange: RANGE };
}

// A target topic: <topic id="theTopic"><body><p id="shared">Reuse me</p></body></topic>
function targetTopic(): DitaNode {
  return el('topic', { id: 'theTopic' }, [
    el('body', {}, [el('p', { id: 'shared' }, [txt('Reuse me')])]),
  ]);
}

// loadTopic that serves one canned root for the "shared.dita" href and nothing
// for any other file, so "target file missing" is exercised deterministically
// without touching the filesystem.
function loaderFor(byHref: Record<string, DitaNode | undefined>) {
  return (_baseDir: string, href: string): DitaNode | undefined => byHref[href];
}

describe('resolveConkeyref', () => {
  const defs = new Map<string, KeyHrefDef>([
    ['brand', { href: 'shared.dita', baseDir: '/maps' }],
    ['textonly', { baseDir: '/maps' }], // defined, no resource
  ]);
  const load = loaderFor({ 'shared.dita': targetTopic() });

  it('resolves key/elementid to the addressed element', () => {
    const node = resolveConkeyref('brand/shared', defs, load);
    assert.strictEqual(node?.tagName, 'p');
    assert.strictEqual(node?.attributes?.id, 'shared');
  });

  it('resolves the key/topicid/elementid form to the element id', () => {
    const node = resolveConkeyref('brand/theTopic/shared', defs, load);
    assert.strictEqual(node?.attributes?.id, 'shared');
  });

  it('resolves a bare key to the whole target topic', () => {
    const node = resolveConkeyref('brand', defs, load);
    assert.strictEqual(node?.tagName, 'topic');
    assert.strictEqual(node?.attributes?.id, 'theTopic');
  });

  it('returns undefined when the key is not defined', () => {
    assert.strictEqual(resolveConkeyref('nosuch/shared', defs, load), undefined);
  });

  it('returns undefined when the key is defined but has no href', () => {
    assert.strictEqual(resolveConkeyref('textonly/shared', defs, load), undefined);
  });

  it('returns undefined when the addressed id is not in the target', () => {
    assert.strictEqual(resolveConkeyref('brand/missing', defs, load), undefined);
  });

  it('returns undefined when the target file cannot be loaded', () => {
    const defs2 = new Map<string, KeyHrefDef>([['gone', { href: 'nope.dita', baseDir: '/maps' }]]);
    assert.strictEqual(resolveConkeyref('gone/shared', defs2, load), undefined);
  });

  it('terminates a self-cycle: a conkeyref already visited resolves to nothing', () => {
    const visited = new Set(['brand/shared']);
    assert.strictEqual(resolveConkeyref('brand/shared', defs, load, visited), undefined);
  });

  it('resolves a two-document A <-> B cycle by stopping at the revisited link', () => {
    // A's <p conkeyref="b/pInB"> resolves into B; B's <p conkeyref="a/pInA">
    // would point back into A. A render walking the chain adds each resolved
    // conkeyref to `visited`, so re-entering "a/pInA" must return undefined
    // rather than recurse forever.
    const cycleDefs = new Map<string, KeyHrefDef>([
      ['a', { href: 'a.dita', baseDir: '/maps' }],
      ['b', { href: 'b.dita', baseDir: '/maps' }],
    ]);
    const topicA = el('topic', { id: 'aT' }, [el('p', { id: 'pInA', conkeyref: 'b/pInB' }, [txt('A')])]);
    const topicB = el('topic', { id: 'bT' }, [el('p', { id: 'pInB', conkeyref: 'a/pInA' }, [txt('B')])]);
    const cycleLoad = loaderFor({ 'a.dita': topicA, 'b.dita': topicB });

    const first = resolveConkeyref('a/pInA', cycleDefs, cycleLoad);
    assert.strictEqual(first?.attributes?.id, 'pInA');
    // Following the chain: after resolving a/pInA then b/pInB, the reference
    // back to a/pInA is guarded.
    const visited = new Set(['a/pInA', 'b/pInB']);
    assert.strictEqual(resolveConkeyref('a/pInA', cycleDefs, cycleLoad, visited), undefined);
  });

  it('returns undefined for an empty value', () => {
    assert.strictEqual(resolveConkeyref('', defs, load), undefined);
  });
});
