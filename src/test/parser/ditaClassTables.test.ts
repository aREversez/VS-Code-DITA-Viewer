import * as assert from 'assert';
import { classChain } from '../../editor/ditaClass';
import { MAP_CLASS_DEFAULTS, TOPIC_CLASS_DEFAULTS } from '../../parser/ditaClassDefaults';
import { MAP_STANDARD_TAG_TO_BASETYPE, STANDARD_TAG_TO_BASETYPE } from '@dita-viewer/core';

/**
 * The hand-maintained tag -> base type maps and the generated @class table hold
 * the same fact from two sides: "what kind of element is this tag". They must
 * not drift.
 *
 * The hand map names either
 *   - the first pair of the class chain (the base type, e.g. step -> topic/li),
 *   - or a key of this extension's own renderer for the element, which is
 *     `<side>/<tag>` when the element is a domain specialization rendered on
 *     its own (b -> topic/b while its DTD class is "+ topic/ph hi-d/b "),
 *   - or, for the bookmap lists, the shared `map/bookmap-structural` renderer.
 *
 * Regenerating src/parser/ditaClassDefaults.ts after a DITA-OT upgrade is what
 * breaks this test when the DTD changed its classes: the chain moves and the
 * hand map has to be reviewed with it.
 */

const RENDERER_KEYS_OUTSIDE_THE_CLASS_CHAIN = new Set(['map/bookmap-structural']);

/**
 * Hand entries whose tag has no class chain on their own side, with the reason.
 * The generated tables are bucketed by a chain's first pair, so an element
 * declared with a `topic/*` class never lands in the map table (a map's
 * <title>, <navtitle>, <keywords>) and vice versa (glossref, anchor).
 */
const NO_CHAIN_ON_ITS_SIDE: Readonly<Record<string, string>> = {
  'topic:glossref': 'a map-side element; the topic map keeps its renderer key',
  'topic:anchor': 'a map-side element (DITA 1.2 anchor); the topic map keeps its renderer key',
  'topic:anchorref': 'a map-side element; the topic map keeps its renderer key',
  'map:title': 'carries the topic class (- topic/title); the map map keeps its own title renderer',
  'map:navtitle': 'carries the topic class (- topic/navtitle)',
  'map:keywords': 'carries the topic class (- topic/keywords)',
  'map:keyword': 'carries the topic class (- topic/keyword)',
  'map:booktitle': 'carries the topic class (- topic/title bookmap/booktitle)',
  'map:mainbooktitle': 'carries the topic class (- topic/ph bookmap/mainbooktitle)',
  'map:booktitlealt': 'carries the topic class (- topic/ph bookmap/booktitlealt)',
  'map:subtitle': 'not declared in the scanned DTD modules',
  'map:glossaryref': 'not declared in the scanned DTD modules',
};

const SIDES = [
  {
    side: 'topic' as const,
    hand: STANDARD_TAG_TO_BASETYPE,
    table: TOPIC_CLASS_DEFAULTS,
  },
  {
    side: 'map' as const,
    hand: MAP_STANDARD_TAG_TO_BASETYPE,
    table: MAP_CLASS_DEFAULTS,
  },
];

describe('the hand-written base types and the generated class table agree', () => {
  for (const { side, hand, table } of SIDES) {
    it(`names the base type of every ${side}-side entry`, () => {
      for (const [tag, baseType] of Object.entries(hand)) {
        const chain = classChain(table[tag]);
        if (chain.length === 0) continue;
        const own = `${side}/${tag}`;
        assert.ok(
          baseType === chain[0] || baseType === own || RENDERER_KEYS_OUTSIDE_THE_CLASS_CHAIN.has(baseType),
          `${side}:<${tag}> is '${baseType}' in the hand map, and the DTD class is '${table[tag]}': expected '${chain[0]}', '${own}' or a known shared renderer key`,
        );
      }
    });

    it(`accounts for every ${side}-side entry that has no chain there`, () => {
      const chainless = Object.entries(hand)
        .filter(([tag]) => classChain(table[tag]).length === 0)
        .map(([tag]) => `${side}:${tag}`)
        .sort();
      const listed = Object.keys(NO_CHAIN_ON_ITS_SIDE).filter((k) => k.startsWith(`${side}:`)).sort();
      assert.deepStrictEqual(chainless, listed);
    });
  }

  it('declares the elements that exist on both sides with different chains', () => {
    const both = Object.keys(TOPIC_CLASS_DEFAULTS).filter((tag) => tag in MAP_CLASS_DEFAULTS);
    assert.ok(both.length > 0, 'no element is declared on both sides');
    assert.ok(both.includes('shortdesc'), 'shortdesc is expected on both sides');
    for (const tag of both) {
      assert.notStrictEqual(
        TOPIC_CLASS_DEFAULTS[tag],
        MAP_CLASS_DEFAULTS[tag],
        `<${tag}> cannot carry the same class in both vocabularies`,
      );
    }
  });
});
