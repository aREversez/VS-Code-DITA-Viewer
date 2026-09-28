import * as assert from 'assert';
import {
  getWrapTagCandidates,
  filterWrapCandidates,
  orderCandidatesWithMru,
  pushMruTag,
  wrapTextWithTag,
} from '../../editor/wrapSelectionTags';

describe('getWrapTagCandidates', () => {
  it('should return distinct, alphabetically sorted topic tags', () => {
    const candidates = getWrapTagCandidates(false);
    const tags = candidates.map((c) => c.tag);
    assert.deepStrictEqual(tags, [...new Set(tags)].sort((a, b) => a.localeCompare(b)));
    assert.ok(tags.includes('p'));
    assert.ok(tags.includes('xref'));
    assert.ok(tags.includes('b'));
  });

  it('should return map tags, not topic tags, when isMap is true', () => {
    const mapTags = getWrapTagCandidates(true).map((c) => c.tag);
    assert.ok(mapTags.includes('topicref'));
    assert.ok(mapTags.includes('chapter'));
    // "xref" is a topic-only inline element, never used directly in a map
    assert.ok(!mapTags.includes('xref'));
  });

  it('should pair each tag with its basetype', () => {
    const candidates = getWrapTagCandidates(false);
    const p = candidates.find((c) => c.tag === 'p');
    assert.strictEqual(p?.basetype, 'topic/p');
  });
});

describe('wrapTextWithTag', () => {
  it('should wrap plain text in open/close tags', () => {
    assert.strictEqual(wrapTextWithTag('hello', 'b'), '<b>hello</b>');
  });

  it('should wrap multi-line text as-is, without reindentation', () => {
    assert.strictEqual(
      wrapTextWithTag('line one\nline two', 'note'),
      '<note>line one\nline two</note>',
    );
  });

  it('should wrap empty text into an empty element pair', () => {
    assert.strictEqual(wrapTextWithTag('', 'ph'), '<ph></ph>');
  });
});

describe('pushMruTag', () => {
  it('should prepend a new tag to an empty MRU list', () => {
    assert.deepStrictEqual(pushMruTag([], 'p'), ['p']);
  });

  it('should move an existing tag to the front instead of duplicating it', () => {
    assert.deepStrictEqual(pushMruTag(['b', 'p', 'i'], 'p'), ['p', 'b', 'i']);
  });

  it('should cap the list at max entries, dropping the oldest', () => {
    const mru = ['a', 'b', 'c'];
    assert.deepStrictEqual(pushMruTag(mru, 'd', 3), ['d', 'a', 'b']);
  });
});

describe('orderCandidatesWithMru', () => {
  const candidates = getWrapTagCandidates(false);

  it('should place MRU tags first, in MRU order', () => {
    const ordered = orderCandidatesWithMru(candidates, ['xref', 'b']);
    assert.strictEqual(ordered[0].tag, 'xref');
    assert.strictEqual(ordered[1].tag, 'b');
  });

  it('should keep the remaining candidates in their original order after the MRU head', () => {
    const ordered = orderCandidatesWithMru(candidates, ['xref']);
    const withoutXref = candidates.filter((c) => c.tag !== 'xref');
    assert.deepStrictEqual(ordered.slice(1), withoutXref);
  });

  it('should silently drop MRU entries that are not valid candidates for this doc type', () => {
    const ordered = orderCandidatesWithMru(candidates, ['not-a-real-tag', 'p']);
    assert.strictEqual(ordered[0].tag, 'p');
    assert.ok(!ordered.some((c) => c.tag === 'not-a-real-tag'));
  });

  it('should not duplicate a tag if it somehow appears twice in the MRU list', () => {
    const ordered = orderCandidatesWithMru(candidates, ['p', 'p']);
    assert.strictEqual(ordered.filter((c) => c.tag === 'p').length, 1);
  });
});

describe('filterWrapCandidates', () => {
  const candidates = getWrapTagCandidates(false);

  it('should match by tag-name prefix only, not by substring', () => {
    const tags = filterWrapCandidates(candidates, 'ui').map((c) => c.tag);
    assert.ok(tags.includes('uicontrol'));
    assert.ok(tags.every((t) => t.startsWith('ui')));
    assert.ok(!tags.includes('required-cleanup'));
    assert.ok(!tags.includes('supequip'));
  });

  it('should be case-insensitive and ignore a leading "<" and whitespace', () => {
    const a = filterWrapCandidates(candidates, ' <UI ').map((c) => c.tag);
    assert.deepStrictEqual(a, filterWrapCandidates(candidates, 'ui').map((c) => c.tag));
  });

  it('should return everything for an empty query, preserving order', () => {
    assert.deepStrictEqual(filterWrapCandidates(candidates, ''), candidates);
  });

  it('should return nothing (no custom-tag fallback) when no tag matches', () => {
    assert.deepStrictEqual(filterWrapCandidates(candidates, 'zzzz'), []);
  });
});
