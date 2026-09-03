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
  buildQuickCommitChoices,
  arrangeByRecency,
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

    it('surfaces an indexterm newly added to prolog/metadata/keywords as its own diff row (regression: topic/prolog was unconditionally skipped during block extraction, so an added indexterm there produced no row at all)', () => {
      const left = `<?xml version="1.0"?><topic id="t"><title>T</title>
        <prolog><metadata><keywords></keywords></metadata></prolog>
        <body><p>Unrelated body content.</p></body></topic>`;
      const right = `<?xml version="1.0"?><topic id="t"><title>T</title>
        <prolog><metadata><keywords><indexterm>Database</indexterm></keywords></metadata></prolog>
        <body><p>Unrelated body content.</p></body></topic>`;

      const result = runDiff(left, right);
      const prologRows = result.rows.filter((r) => (r.left || r.right)?.baseType === 'topic/prolog');
      assert.strictEqual(prologRows.length, 1, `expected exactly one prolog row, got: ${JSON.stringify(result.rows.map((r) => r.changeType))}`);
      assert.strictEqual(prologRows[0].changeType, 'added');
      assert.strictEqual(prologRows[0].left, undefined, 'left side had no indexterm, so there should be nothing to show there');
    });

    it('does not add a prolog row when prolog changes but contains no indexterm (avoids leaking private prolog content like author/critdates into the diff)', () => {
      const left = `<?xml version="1.0"?><topic id="t"><title>T</title>
        <prolog><author>Alice</author></prolog>
        <body><p>Body.</p></body></topic>`;
      const right = `<?xml version="1.0"?><topic id="t"><title>T</title>
        <prolog><author>Bob</author></prolog>
        <body><p>Body.</p></body></topic>`;

      const result = runDiff(left, right);
      const prologRows = result.rows.filter((r) => (r.left || r.right)?.baseType === 'topic/prolog');
      assert.strictEqual(prologRows.length, 0, `expected no prolog row since neither side has an indexterm, got: ${JSON.stringify(prologRows)}`);
    });

    it('derives block text from the rendered html, not the raw source node, so renderer-injected content (keyref/conref substitution, note labels, footnote markers) shows up in the diff text instead of silently diverging from what is actually shown (regression: text used to come from collectText(node) on the raw source node, which cannot see anything the renderer adds)', () => {
      const decoratingFactory = (root: DitaNode, _docDir: string) => {
        void root.attributes;
        return (node: DitaNode, _parentBaseType: string, _headingLevel: number): string => {
          const text = collectPlainText(node);
          // Simulate a renderer decoration the source node doesn't
          // literally contain, e.g. an injected note-type label.
          if (node.baseType === 'topic/p') return `<p>Note ${text}</p>`;
          return `<p>${text}</p>`;
        };
      };

      const xml = `<?xml version="1.0"?><topic id="t"><title>T</title><body><p>please save your work</p></body></topic>`;
      const input: DiffTopicsInput = {
        leftXml: xml,
        rightXml: xml,
        leftDocDir: '/tmp/left',
        rightDocDir: '/tmp/right',
        renderBlockFactory: decoratingFactory,
      };
      const result = diffTopics(input);
      const pRow = result.rows.find((r) => r.left?.baseType === 'topic/p');
      assert.ok(pRow, 'expected a <p> row');
      assert.strictEqual(
        pRow!.left!.text,
        'Note please save your work',
        'expected block text to reflect what the renderer actually produced, including the injected "Note " prefix -- not just the raw source text',
      );
    });

    it('classifies a lightly-edited Chinese paragraph as "modified" with word-level highlighting, not a full delete+insert (regression: the similarity check used to decide "modified" vs "delete+insert" tokenized by splitting on ASCII whitespace, which treats an entire Chinese sentence -- no whitespace between characters -- as a single token; any two non-identical Chinese sentences therefore always scored 0% similarity and were always treated as a full delete+insert, with no word-level highlighting, even for a one-character edit)', () => {
      const left = `<?xml version="1.0"?><topic id="t" xml:lang="zh-CN"><title>T</title><body><p>请先保存工作，然后再继续执行下一步操作。</p></body></topic>`;
      const right = `<?xml version="1.0"?><topic id="t" xml:lang="zh-CN"><title>T</title><body><p>请先保存工作，然后再执行下一步骤操作。</p></body></topic>`;

      const result = runDiff(left, right);
      const pRow = result.rows.find((r) => (r.left || r.right)?.baseType === 'topic/p');
      assert.ok(pRow, 'expected a <p> row');
      assert.strictEqual(
        pRow!.changeType,
        'modified',
        `expected a "modified" row with word-level highlighting for a two-character edit, not a full delete+insert; got: ${pRow!.changeType}`,
      );
      assert.ok(pRow!.inlineDiff, 'expected inline diff parts for the modified row');
    });

    it('recurses into a changed full CALS <table> down to the actual changed <entry>, leaving unrelated rows and cells unchanged (regression: only simpletable was in the diffable-container list; a full DITA <table><tgroup><tbody><row><entry> -- the common case in real documents -- was always compared as one opaque block, so any single-cell edit marked the entire table "modified")', () => {
      const mkTopic = (cell: string) => `<?xml version="1.0"?><topic id="t"><title>T</title><body><table><tgroup cols="2"><tbody>
        <row><entry>Row1Col1</entry><entry>Row1Col2</entry></row>
        <row><entry>Row2Col1</entry><entry>${cell}</entry></row>
        <row><entry>Row3Col1</entry><entry>Row3Col2</entry></row>
      </tbody></tgroup></table></body></topic>`;

      const result = runDiff(mkTopic('Old value here'), mkTopic('New value here'));
      const tableRow = result.rows.find((r) => (r.left || r.right)?.baseType === 'topic/table');
      assert.ok(tableRow, 'expected a table row');
      assert.strictEqual(tableRow!.changeType, 'modified');

      // Walk down through tgroup -> tbody -> row to the single changed entry.
      let node = tableRow;
      const path: string[] = [];
      while (node?.children) {
        const changed = node.children.find((r) => r.changeType !== 'unchanged');
        assert.ok(changed, `expected exactly one changed child at depth ${path.length}, found none among: ${JSON.stringify(node.children.map((r) => r.changeType))}`);
        const unchangedCount = node.children.filter((r) => r.changeType === 'unchanged').length;
        if (path.length === 2) {
          // At the row level: 2 of 3 rows should be unchanged.
          assert.strictEqual(unchangedCount, 2, `expected 2 unchanged rows, got ${unchangedCount}`);
        }
        path.push((changed!.left || changed!.right)!.baseType!);
        node = changed;
      }
      assert.deepStrictEqual(path, ['topic/tgroup', 'topic/tbody', 'topic/row', 'topic/entry']);
    });

    it('recurses into a changed <simpletable> down to the actual changed <stentry>, leaving unrelated rows and cells unchanged (regression: topic/simpletable was in the diffable-container list, but its own row type -- topic/strow, distinct from CALS <table>\'s topic/row -- was not, so recursion stopped one level too early: a one-cell edit still marked the whole <strow> "modified", highlighting every stentry in that row instead of just the one that changed)', () => {
      const mkTopic = (cell: string) => `<?xml version="1.0"?><topic id="t"><title>T</title><body><simpletable>
        <strow><stentry>Row1Col1</stentry><stentry>Row1Col2</stentry></strow>
        <strow><stentry>Row2Col1</stentry><stentry>${cell}</stentry></strow>
        <strow><stentry>Row3Col1</stentry><stentry>Row3Col2</stentry></strow>
      </simpletable></body></topic>`;

      const result = runDiff(mkTopic('Old value here'), mkTopic('New value here'));
      const tableRow = result.rows.find((r) => (r.left || r.right)?.baseType === 'topic/simpletable');
      assert.ok(tableRow, 'expected a simpletable row');
      assert.strictEqual(tableRow!.changeType, 'modified');

      const rowChanges = (tableRow!.children || []).map((r) => r.changeType);
      assert.strictEqual(
        rowChanges.filter((c) => c === 'unchanged').length,
        2,
        `expected 2 unchanged strow rows, got: ${JSON.stringify(rowChanges)}`,
      );
      const changedRow = tableRow!.children?.find((r) => r.changeType === 'modified');
      assert.ok(changedRow, `expected exactly one modified strow, found: ${JSON.stringify(rowChanges)}`);

      const cellChanges = (changedRow!.children || []).map((r) => r.changeType);
      assert.deepStrictEqual(
        cellChanges,
        ['unchanged', 'modified'],
        `expected only the second stentry to be modified, not the whole row, got: ${JSON.stringify(cellChanges)}`,
      );
    });

    it('recurses into a changed <parml> to show only the actually-changed <plentry> as modified, leaving unrelated entries unchanged (regression: only topic/section and topic/example recursed, so any other change inside a large parml/list marked the WHOLE container "modified")', () => {
      const left = `<?xml version="1.0"?><topic id="t"><title>T</title><body>
        <section><title>Sec</title>
          <parml>
            <plentry><pt>Alpha</pt><pd>First definition, unchanged.</pd></plentry>
            <plentry><pt>Beta</pt><pd>Second definition, will change.</pd></plentry>
            <plentry><pt>Gamma</pt><pd>Third definition, unchanged.</pd></plentry>
          </parml>
        </section>
      </body></topic>`;
      const right = `<?xml version="1.0"?><topic id="t"><title>T</title><body>
        <section><title>Sec</title>
          <parml>
            <plentry><pt>Alpha</pt><pd>First definition, unchanged.</pd></plentry>
            <plentry><pt>Beta</pt><pd>Second definition, has changed.</pd></plentry>
            <plentry><pt>Gamma</pt><pd>Third definition, unchanged.</pd></plentry>
          </parml>
        </section>
      </body></topic>`;

      const result = runDiff(left, right);
      const sectionRow = result.rows.find((r) => r.left?.baseType === 'topic/section');
      assert.ok(sectionRow, 'expected a section row');
      assert.strictEqual(sectionRow!.changeType, 'modified');
      const parmlRow = sectionRow!.children?.find((r) => r.left?.baseType === 'topic/parml');
      assert.ok(parmlRow, `expected a recursed parml row among section children: ${JSON.stringify(sectionRow!.children?.map((r) => r.changeType))}`);
      const plentryTypes = (parmlRow!.children || []).map((r) => r.changeType);
      assert.deepStrictEqual(plentryTypes, ['unchanged', 'modified', 'unchanged'], `expected only the middle plentry to be modified, got: ${plentryTypes.join(',')}`);
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
    it('reconstructs a sentence with ordinary punctuation exactly, with no spurious inserted spaces (regression: tokenizeForDiff discarded whitespace and mergePart re-synthesized exactly one space after every token, so any punctuation directly touching a word -- "Note:", a sentence-ending period, contractions, hyphens -- came back with a phantom inserted space, breaking the exact-match this relies on for virtually any real sentence)', () => {
      const parts = diffTokens(
        tokenizeForDiff('Please save your work before continuing.'),
        tokenizeForDiff('Please save your work before proceeding.'),
      );
      const reconstructedRight = parts.filter((p) => !p.removed).map((p) => p.value).join('');
      assert.strictEqual(reconstructedRight, 'Please save your work before proceeding.');
    });

    it('highlights the correct word when a removed/added part is followed by unchanged trailing text (regression: the html-walking loop advanced past removed/added parts as if they existed on BOTH sides, shifting every mark after them by that part\'s length -- e.g. "...before continuing." -> "...before proceeding." highlighted the trailing "." instead of "proceeding")', () => {
      const html = '<p>Please save your work before proceeding.</p>';
      const parts = diffTokens(tokenizeForDiff('Please save your work before continuing.'), tokenizeForDiff('Please save your work before proceeding.'));
      const marked = applyInlineMarksToHtml(html, parts, 'right');
      assert.strictEqual(marked, '<p>Please save your work before <span class="diff-inline-add">proceeding</span>.</p>');
    });

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

    it('places marks on the actually-changed word, not on unrelated whitespace, when the html has pretty-printed indentation/newlines the block text does not (regression: word-level parts are tokenized from the NORMALIZED block text -- whitespace runs collapsed to one space -- but the position-walk assumed 1 normalized character == 1 raw html character; a real DITA source\'s indentation between inline elements is exactly this kind of multi-character whitespace run, so on any realistically-formatted document every mark after the first one silently drifted onto unrelated text while the actual edit went unmarked)', () => {
      // Mirrors what the real renderer actually produces for a pretty-
      // printed <p> with a nested <b> and a later CJK edit: raw newlines +
      // indentation between "工作，" and "然后再", something the earlier,
      // whitespace-naive tests (single-line, no nested tags) never
      // exercised. leftText/rightText are derived from the html itself
      // (stripping tags), not hand-typed separately, so they stay exactly
      // consistent with it the same way makeBlock's real
      // normalizeText(htmlToPlainText(html)) always is.
      const leftHtml = '<p>\n    请先<strong>保存</strong>工作，\n    然后再继续执行下一步操作。\n</p>';
      const rightHtml = '<p>\n    请先<strong>保存</strong>工作，\n    然后再执行下一步骤操作。\n</p>';
      const leftText = normalizeText(leftHtml.replace(/<[^>]+>/g, ''));
      const rightText = normalizeText(rightHtml.replace(/<[^>]+>/g, ''));
      const parts = diffTokens(tokenizeForDiff(leftText), tokenizeForDiff(rightText));

      const markedLeft = applyInlineMarksToHtml(leftHtml, parts, 'left');
      const markedRight = applyInlineMarksToHtml(rightHtml, parts, 'right');
      assert.ok(
        markedLeft.includes('<span class="diff-inline-del">继续</span>'),
        `expected the removed word "继续" to be marked on the left, got: ${markedLeft}`,
      );
      assert.ok(
        markedRight.includes('<span class="diff-inline-add">骤</span>'),
        `expected the added word "骤" to be marked on the right, got: ${markedRight}`,
      );
      // Nothing outside the actually-changed word should be wrapped -- the
      // pre-fix drift wrapped unrelated whitespace/punctuation instead.
      assert.ok(
        !markedLeft.includes('<span class="diff-inline-del">，') && !markedLeft.includes('<span class="diff-inline-del">\n'),
        `expected no spurious mark on the whitespace/punctuation before the real edit, got: ${markedLeft}`,
      );
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

  describe('arrangeByRecency', () => {
    it('puts the newer version on the right no matter which one is passed first (regression: ditaDiffProvider.ts used to place whichever version the user picked first on the left, so picking "Working copy" -- always the newest -- as the first QuickPick answer put new content on the left and old on the right)', () => {
      const older = { order: 3, label: 'older' };
      const newer = { order: -1, label: 'Working copy' };

      const pickedOlderFirst = arrangeByRecency(older, newer);
      assert.strictEqual(pickedOlderFirst.left.label, 'older');
      assert.strictEqual(pickedOlderFirst.right.label, 'Working copy');

      const pickedNewerFirst = arrangeByRecency(newer, older);
      assert.strictEqual(pickedNewerFirst.left.label, 'older');
      assert.strictEqual(pickedNewerFirst.right.label, 'Working copy');
    });
  });

  describe('buildQuickCommitChoices', () => {
    it('returns empty for a file with no commit history', () => {
      assert.deepStrictEqual(buildQuickCommitChoices([]), []);
    });

    it('returns just the one shortcut for a file with exactly one commit', () => {
      const commits = [{ hash: 'aaaa1111', shortHash: 'aaaa111', subject: 'Initial' }];
      const choices = buildQuickCommitChoices(commits);
      assert.strictEqual(choices.length, 1);
      assert.strictEqual(choices[0].refHash, 'aaaa1111');
    });

    it('the refHash for each shortcut is the SAME commit its own subject/shortHash describes (regression: labels used to describe one commit while the content came from an unrelated repo-wide HEAD/HEAD~1 ref)', () => {
      const commits = [
        { hash: 'full-hash-of-most-recent', shortHash: 'recent1', subject: 'Most recent edit to this file' },
        { hash: 'full-hash-of-second-most-recent', shortHash: 'older22', subject: 'Second most recent edit' },
        { hash: 'full-hash-of-third', shortHash: 'oldest3', subject: 'Should not appear -- only first 2 are shortcuts' },
      ];
      const choices = buildQuickCommitChoices(commits);
      assert.strictEqual(choices.length, 2);

      assert.strictEqual(choices[0].refHash, 'full-hash-of-most-recent');
      assert.strictEqual(choices[0].shortHash, 'recent1');
      assert.strictEqual(choices[0].subject, 'Most recent edit to this file');

      assert.strictEqual(choices[1].refHash, 'full-hash-of-second-most-recent');
      assert.strictEqual(choices[1].shortHash, 'older22');
      assert.strictEqual(choices[1].subject, 'Second most recent edit');

      // Neither shortcut should ever silently point at a third, later
      // commit's hash -- each one's content source must match its own
      // label, not drift to some other entry in the list.
      assert.notStrictEqual(choices[0].refHash, choices[1].refHash);
      assert.ok(!choices.some((c) => c.refHash === 'full-hash-of-third'));
    });
  });
});
