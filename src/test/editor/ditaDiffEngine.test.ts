import * as assert from 'assert';
import { DitaNode } from '../../parser/domTypes';
import {
  diffTopics,
  lcsAlign,
  normalizeText,
  tokenizeForDiff,
  diffTokens,
  applyInlineMarksToHtml,
  swapAlignedRows,
  DiffTopicsInput,
} from '../../editor/ditaDiffEngine';

/** A minimal, real renderBlockFactory -- exercises the exact contract
 *  diffTopics calls (root + docDir, once per side, after parsing), without
 *  needing the full webview-rendering RenderContext machinery. This is
 *  deliberately close to what DitaViewerProvider's own renderer produces
 *  (headings wrapped, escaped text) but simplified, since the point of
 *  these tests is diffTopics' own alignment/diffing behavior, not
 *  full-fidelity HTML rendering (that's covered by renderer.test.ts). */
function testRenderBlockFactory(root: DitaNode, _docDir: string) {
  // The factory receiving `root` at all -- and being able to use it -- is
  // the actual regression this test file exists to guard: the diff view
  // shipped with `detectNoteLabels(undefined as any, ...)` called before
  // any document had been parsed, which crashed unconditionally on every
  // use. Touching root.attributes here (the same field that crashed)
  // stands in for that real caller.
  void root.attributes;
  return (node: DitaNode, _parentBaseType: string, _headingLevel: number): string => {
    const text = collectPlainText(node);
    return `<p>${text}</p>`;
  };
}

function collectPlainText(node: DitaNode): string {
  if (node.type === 'text') return node.text || '';
  return (node.children || []).map(collectPlainText).join('');
}

function runDiff(leftXml: string, rightXml: string) {
  const input: DiffTopicsInput = {
    leftXml,
    rightXml,
    leftDocDir: '/tmp/left',
    rightDocDir: '/tmp/right',
    renderBlockFactory: testRenderBlockFactory,
  };
  return diffTopics(input);
}

const TOPIC_A = `<?xml version="1.0"?>
<topic id="t"><title>Title</title><body>
<p>First paragraph.</p>
<p>Second paragraph, unchanged.</p>
<p>Third paragraph, will change.</p>
</body></topic>`;

const TOPIC_B = `<?xml version="1.0"?>
<topic id="t"><title>Title</title><body>
<p>First paragraph.</p>
<p>Second paragraph, unchanged.</p>
<p>Third paragraph, has changed.</p>
<p>Fourth paragraph, newly added.</p>
</body></topic>`;

describe('ditaDiffEngine', () => {
  describe('diffTopics', () => {
    it('does not throw given real parsed documents on both sides (regression: renderBlockFactory used to receive an undefined root and crash unconditionally)', () => {
      assert.doesNotThrow(() => runDiff(TOPIC_A, TOPIC_B));
    });

    it('gives each side its own actual parsed root, not a shared placeholder', () => {
      // xml:lang differs between the two sides -- if the factory were ever
      // called with the wrong side's root (or no root at all), this
      // wouldn't be distinguishable. Confirms the two calls are genuinely
      // independent, not an artifact of one shared closure.
      const seenLangs: (string | undefined)[] = [];
      const input: DiffTopicsInput = {
        leftXml: '<topic id="t" xml:lang="en"><title>T</title><body><p>Hello</p></body></topic>',
        rightXml: '<topic id="t" xml:lang="zh-cn"><title>T</title><body><p>你好</p></body></topic>',
        leftDocDir: '/tmp/left',
        rightDocDir: '/tmp/right',
        renderBlockFactory: (root) => {
          seenLangs.push(root.attributes?.['xml:lang']);
          return (node) => collectPlainText(node);
        },
      };
      diffTopics(input);
      assert.deepStrictEqual(seenLangs.sort(), ['en', 'zh-cn']);
    });

    it('marks unchanged, modified, and added rows correctly', () => {
      const result = runDiff(TOPIC_A, TOPIC_B);
      const types = result.rows.map((r) => r.changeType);
      assert.ok(types.includes('unchanged'), `expected an unchanged row in: ${types.join(',')}`);
      assert.ok(types.includes('modified'), `expected a modified row in: ${types.join(',')}`);
      assert.ok(types.includes('added'), `expected an added row in: ${types.join(',')}`);
      assert.strictEqual(result.stats.added, 1);
      assert.strictEqual(result.stats.modified, 1);
      assert.strictEqual(result.stats.removed, 0);
    });

    it('reports a per-side parse error without throwing when one side is malformed', () => {
      const result = runDiff(TOPIC_A, '<topic><unclosed></topic>');
      assert.ok(result.errorRight, 'expected errorRight to be set for malformed XML');
      assert.strictEqual(result.errorLeft, undefined);
    });

    it('handles both sides malformed without throwing', () => {
      assert.doesNotThrow(() => {
        const result = runDiff('<topic><unclosed>', '<topic><also-unclosed>');
        assert.ok(result.errorLeft);
        assert.ok(result.errorRight);
        assert.deepStrictEqual(result.rows, []);
      });
    });

    it('treats a brand-new file (no left side) as entirely added', () => {
      const result = runDiff('', TOPIC_B);
      assert.ok(result.rows.every((r) => r.changeType === 'added'));
      assert.strictEqual(result.stats.removed, 0);
    });

    it('treats a deleted file (no right side) as entirely removed', () => {
      const result = runDiff(TOPIC_A, '');
      assert.ok(result.rows.every((r) => r.changeType === 'removed'));
      assert.strictEqual(result.stats.added, 0);
    });

    it('recurses into matched sections with their own per-side render calls (regression: alignSectionChildren used to share one side\'s renderBlock for both sides)', () => {
      const left = `<?xml version="1.0"?><topic id="t"><title>T</title><body>
        <section><title>Sec</title><p>the quick brown fox jumps over left-marker-AAA the lazy dog</p></section>
      </body></topic>`;
      const right = `<?xml version="1.0"?><topic id="t"><title>T</title><body>
        <section><title>Sec</title><p>the quick brown fox jumps over right-marker-BBB the lazy dog</p></section>
      </body></topic>`;

      const seenTexts: string[] = [];
      const input: DiffTopicsInput = {
        leftXml: left,
        rightXml: right,
        leftDocDir: '/tmp/left',
        rightDocDir: '/tmp/right',
        renderBlockFactory: () => (node) => {
          const text = collectPlainText(node);
          seenTexts.push(text);
          return text;
        },
      };
      const result = diffTopics(input);
      // Both sides' distinct child content must actually have been visited
      // -- if the two-arg alignSectionChildren fix regressed back to a
      // single shared renderBlock, one side's marker would be missing or
      // rendered as if it came from the other side's context.
      const joined = seenTexts.join(' ');
      assert.ok(joined.includes('AAA'), `expected left marker among renders: ${joined}`);
      assert.ok(joined.includes('BBB'), `expected right marker among renders: ${joined}`);
      const sectionRow = result.rows.find((r) => r.left?.baseType === 'topic/section');
      assert.ok(sectionRow?.children && sectionRow.children.length > 0, 'expected recursed section children');
    });
  });

  describe('normalizeText', () => {
    it('collapses whitespace and trims', () => {
      assert.strictEqual(normalizeText('  a   b\n\tc  '), 'a b c');
    });
  });

  describe('lcsAlign', () => {
    it('aligns identical sequences as all "same"', () => {
      const a = [{ key: '1', v: 'a' }, { key: '2', v: 'b' }];
      const ops = lcsAlign(a, a, (x, y) => x.v === y.v, (item) => item.key);
      assert.ok(ops.every((o) => o.op === 'same'));
    });

    it('detects a pure insertion', () => {
      const a = [{ key: '1', v: 'a' }];
      const b = [{ key: '1', v: 'a' }, { key: '2', v: 'b' }];
      const ops = lcsAlign(a, b, (x, y) => x.v === y.v, (item) => item.key);
      assert.strictEqual(ops.filter((o) => o.op === 'added').length, 1);
    });

    it('detects a pure removal', () => {
      const a = [{ key: '1', v: 'a' }, { key: '2', v: 'b' }];
      const b = [{ key: '1', v: 'a' }];
      const ops = lcsAlign(a, b, (x, y) => x.v === y.v, (item) => item.key);
      assert.strictEqual(ops.filter((o) => o.op === 'removed').length, 1);
    });
  });

  describe('tokenizeForDiff / diffTokens', () => {
    it('produces no diff parts for identical text', () => {
      const tokens = tokenizeForDiff('the quick fox');
      const parts = diffTokens(tokens, tokens);
      assert.ok(parts.every((p) => !p.added && !p.removed));
    });

    it('marks a single changed word as removed+added, not the whole sentence', () => {
      const parts = diffTokens(tokenizeForDiff('the quick fox'), tokenizeForDiff('the slow fox'));
      const removed = parts.filter((p) => p.removed).map((p) => p.value).join('');
      const added = parts.filter((p) => p.added).map((p) => p.value).join('');
      assert.ok(removed.includes('quick'), `expected 'quick' removed, got: ${removed}`);
      assert.ok(added.includes('slow'), `expected 'slow' added, got: ${added}`);
      assert.ok(parts.some((p) => !p.added && !p.removed && p.value.includes('the')), 'expected unchanged "the" preserved');
    });
  });

  describe('applyInlineMarksToHtml', () => {
    it('wraps the diffed portion of matching plain text in a mark span', () => {
      const html = '<p>the quick fox</p>';
      const parts = diffTokens(tokenizeForDiff('the quick fox'), tokenizeForDiff('the slow fox'));
      const marked = applyInlineMarksToHtml(html, parts, 'left');
      assert.ok(marked.includes('quick'));
    });

    it('falls back to the original html untouched if the diff text does not reconcile with it', () => {
      const html = '<p>completely different content</p>';
      const parts = diffTokens(tokenizeForDiff('the quick fox'), tokenizeForDiff('the slow fox'));
      const result = applyInlineMarksToHtml(html, parts, 'left');
      assert.strictEqual(result, html, 'expected safe fallback to original html on mismatch, not corrupted markup');
    });
  });

  describe('swapAlignedRows', () => {
    it('swaps left and right on every row', () => {
      const result = runDiff(TOPIC_A, TOPIC_B);
      const swapped = swapAlignedRows(result.rows);
      for (let i = 0; i < result.rows.length; i++) {
        assert.strictEqual(swapped[i].left, result.rows[i].right);
        assert.strictEqual(swapped[i].right, result.rows[i].left);
      }
    });

    it('flips added/removed change types but leaves modified/unchanged alone', () => {
      const result = runDiff(TOPIC_A, TOPIC_B);
      const swapped = swapAlignedRows(result.rows);
      for (let i = 0; i < result.rows.length; i++) {
        const original = result.rows[i].changeType;
        const flipped = swapped[i].changeType;
        if (original === 'added') assert.strictEqual(flipped, 'removed');
        else if (original === 'removed') assert.strictEqual(flipped, 'added');
        else assert.strictEqual(flipped, original);
      }
    });
  });
});
