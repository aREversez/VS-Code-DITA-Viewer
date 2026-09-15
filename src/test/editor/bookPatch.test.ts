import * as assert from 'assert';
import { diffBookParts, BookPart, BookPatch } from '../../editor/bookPatch';

/**
 * The decision behind book mode's incremental update: after re-rendering a
 * map, what does the webview actually need? Worth pinning on its own because
 * both of its failure modes are silent and visual rather than loud --
 * classifying a content edit as structural merely loses the optimisation,
 * while classifying a structural edit as content writes entries into the
 * wrong positions and corrupts a document the author is reading.
 */
describe('diffBookParts', () => {
  const part = (key: string, html: string): BookPart => ({ key, html });

  /** A book of n entries whose bodies are all the same, so a test can change exactly one. */
  function book(n: number, mutate?: (i: number) => string): BookPart[] {
    return Array.from({ length: n }, (_, i) => part(`topic:/docs/t${i}.dita`, `<div class="book-entry">body ${mutate ? mutate(i) : i}</div>`));
  }

  it('falls back to a full document when there is no baseline to diff against', () => {
    // A freshly resolved panel or a restarted extension host: the provider has
    // no record of what is on screen, so the webview's child order cannot be
    // assumed to match, and indices would be guesses.
    assert.deepStrictEqual(diffBookParts(undefined, book(3)), { kind: 'full' });
  });

  it('answers "nothing to send" when both renders are identical', () => {
    const prev = book(3);

    assert.deepStrictEqual(diffBookParts(prev, book(3)), { kind: 'none' });
  });

  it('returns none rather than an empty patch, since an empty patch would still cost a message and a full re-run of the webview post-swap setup', () => {
    const result = diffBookParts(book(2), book(2));

    assert.strictEqual(result.kind, 'none');
    assert.ok(!('updates' in result), 'no updates array at all, so a caller cannot send it by accident');
  });

  it('patches only the entry whose HTML changed, addressed by its position', () => {
    const prev = book(4);
    const next = book(4, (i) => (i === 2 ? 'edited' : String(i)));

    const result = diffBookParts(prev, next);

    assert.deepStrictEqual(result, {
      kind: 'patch',
      updates: [{ index: 2, html: '<div class="book-entry">body edited</div>' }],
    });
  });

  it('carries the new HTML, not the old, and never lists an entry that did not change', () => {
    const prev = book(5);
    const next = book(5, (i) => (i === 0 ? 'first' : i === 4 ? 'last' : String(i)));

    const result = diffBookParts(prev, next);
    assert.strictEqual(result.kind, 'patch');
    if (result.kind !== 'patch') return;

    assert.deepStrictEqual(
      result.updates.map((u) => u.index),
      [0, 4],
      'ascending, and the three unchanged entries in between are absent',
    );
    assert.ok(result.updates.every((u) => u.html.includes('body')));
    assert.ok(result.updates[0].html.includes('first') && !result.updates[0].html.includes('body 0'));
  });

  it('goes full when an entry is added', () => {
    assert.deepStrictEqual(diffBookParts(book(3), book(4)), { kind: 'full' });
  });

  it('goes full when an entry is removed', () => {
    assert.deepStrictEqual(diffBookParts(book(4), book(3)), { kind: 'full' });
  });

  it('goes full when the entry count is unchanged but one key differs, which is an href edit rather than a content edit', () => {
    const prev = book(3);
    const next = book(3);
    next[1] = part('topic:/docs/renamed.dita', next[1].html);

    assert.deepStrictEqual(diffBookParts(prev, next), { kind: 'full' });
  });

  it('goes full when the same entries are reordered', () => {
    const prev = book(3);
    const next = [prev[1], prev[0], prev[2]];

    // Positions are what a patch addresses, so a reorder is not expressible as
    // one: index 0 now means a different entry than it did in the baseline.
    assert.deepStrictEqual(diffBookParts(prev, next), { kind: 'full' });
  });

  it('goes full when a key differs even if that entry HTML differs too, so a structural change is never mistaken for a content change', () => {
    const prev = book(2);
    const next = book(2, () => 'edited');
    next[0] = part('topic:/docs/other.dita', next[0].html);

    const result: BookPatch = diffBookParts(prev, next);

    assert.strictEqual(result.kind, 'full', 'patching here would write the wrong topic into position 0');
  });

  it('treats two empty renders as no change', () => {
    assert.deepStrictEqual(diffBookParts([], []), { kind: 'none' });
  });

  it('goes full from an empty baseline to a non-empty one', () => {
    // [] is a real baseline -- a map whose every entry failed to collect --
    // and is deliberately not confused with undefined, which means "unknown".
    assert.deepStrictEqual(diffBookParts([], book(1)), { kind: 'full' });
  });

  it('leaves both input lists untouched', () => {
    const prev = book(3);
    const next = book(3, (i) => (i === 1 ? 'edited' : String(i)));
    const prevCopy = JSON.parse(JSON.stringify(prev));
    const nextCopy = JSON.parse(JSON.stringify(next));

    diffBookParts(prev, next);

    // The caller keeps `next` as its new baseline, so a diff that mutated
    // either list would corrupt every later comparison.
    assert.deepStrictEqual(prev, prevCopy);
    assert.deepStrictEqual(next, nextCopy);
  });

  it('stays a single update on a large book, which is the case the whole optimisation exists for', () => {
    const size = 2000;
    const prev = book(size);
    const next = book(size, (i) => (i === 1337 ? 'edited' : String(i)));

    const result = diffBookParts(prev, next);

    assert.strictEqual(result.kind, 'patch');
    if (result.kind !== 'patch') return;
    assert.strictEqual(result.updates.length, 1, 'one keystroke in one topic is one entry, not 2000');
    assert.strictEqual(result.updates[0].index, 1337);
  });
});
