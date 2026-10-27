import * as assert from 'assert';
import { load } from 'cheerio';
import { parseDita, DitaNode, RenderContext, renderElement } from '@dita-viewer/core';
import { diffTopics, DiffTopicsInput, swapAlignedRows } from '../../editor/ditaDiffEngine';
import { renderDiffColumns, injectFragmentAttrs } from '../../editor/ditaDiffRender';

/**
 * These tests run the diff panel's REAL two-stage pipeline -- the actual
 * preview renderer (src/render) plus the actual column assembly -- and then
 * hand the emitted HTML to a spec-compliant parser (cheerio/parse5, the same
 * foster-parenting rules a browser applies) and assert on the parsed result.
 *
 * That end-to-end shape is the point. Every engine test in
 * ditaDiffEngine.test.ts renders through a `<p>` stub factory, so the engine
 * was verified to find the right changes at the right depth while the panel
 * still showed garbage: a recursed table's fragments were dumped into plain
 * `<div class="dv-block">` wrappers, the parser discarded <table>/<tr>/<td>
 * entirely, and the "regression fixed" tables arrived as unsegmented text
 * ("Pressure3 bar"). Only a test that renders, assembles AND parses can see
 * that class of breakage, which is why this file exists next to the engine's.
 */

// The minimum the renderers actually read (packages/core/test/render/renderer.test.ts uses the same
// shape): heading level, asset URIs, the document directory.
const ctx0: RenderContext = {
  headingLevel: 1,
  asWebviewUri: (p: string) => p,
  documentDir: '/tmp',
};

/** The provider's own factory shape: real preview rendering, per side. */
function realRenderFactory(root: DitaNode, _docDir: string) {
  void root.attributes;
  return (node: DitaNode, parentBaseType: string, headingLevel: number): string =>
    renderElement(node, { ...ctx0, headingLevel, parentBaseType });
}

function runDiff(leftXml: string, rightXml: string) {
  const input: DiffTopicsInput = {
    leftXml,
    rightXml,
    leftDocDir: '/tmp',
    rightDocDir: '/tmp',
    renderBlockFactory: realRenderFactory,
  };
  return diffTopics(input);
}

/** Assemble the columns and let the HTML parser have its way with them. */
function parseColumn(html: string, side: 'left' | 'right') {
  return load(`<div class="diff-col diff-col--${side}">${html}</div>`);
}

const CALS = (torque: string) => `<?xml version="1.0"?>
<topic id="t"><title>Spec</title><body>
<table id="tb1"><tgroup cols="2"><colspec colname="c1" colwidth="1*"/><colspec colname="c2" colwidth="2*"/><thead><row><entry>Metric</entry><entry>Value</entry></row></thead><tbody><row><entry>Torque</entry><entry>${torque}</entry></row><row><entry>Pressure</entry><entry>3 bar</entry></row></tbody></tgroup></table>
</body></topic>`;

describe('ditaDiffRender (rendered-diff column assembly)', () => {
  describe('recursed tables survive the HTML parser', () => {
    it('keeps table, rows, cells, header cells and column widths in the parsed output (regression: a recursed table emitted `<td>`/`<tr>` fragments inside `<div class="dv-block">`, the parser foster-parented them away, and the panel showed 0 tables / 0 rows / 0 cells -- just the concatenated cell text "Pressure3 bar")', () => {
      const result = renderDiffColumns(runDiff(CALS('12 Nm'), CALS('15 Nm')).rows);

      for (const [side, html] of [
        ['left', result.left],
        ['right', result.right],
      ] as const) {
        const $ = parseColumn(html, side);
        assert.strictEqual($('.diff-col table').length, 1, `${side}: expected one real <table> to survive parsing`);
        assert.strictEqual($('tr').length, 3, `${side}: expected header + 2 body rows`);
        assert.strictEqual($('td, th').length, 6, `${side}: expected 6 cells`);
        assert.strictEqual($('thead th').length, 2, `${side}: header row must stay inside <thead> as <th>s`);
        assert.strictEqual($('col').length, 2, `${side}: <colspec> widths must reach the assembled table`);
        // The regression symptom itself: cells running together as one text run.
        assert.ok(
          /3\s?bar/.test($('td, th').toArray().map((n) => $(n).text()).join('|')),
          `${side}: the unchanged cell must still be its own cell`,
        );
      }
    });

    it('gives each source table exactly one <table> wrapper instead of one per fragment (regression: flushing the fragment buffer at every container boundary put each <tr> in its own table, so columns, the header and the body stopped sharing a grid)', () => {
      const left = `<?xml version="1.0"?>
<topic id="t"><title>Spec</title><body>
<table id="tb1"><tgroup cols="2"><colspec colname="c1" colwidth="1*"/><colspec colname="c2" colwidth="2*"/><thead><row><entry>Metric</entry><entry>Value</entry></row></thead><tbody><row><entry>Torque</entry><entry>12 Nm</entry></row><row><entry>Pressure</entry><entry>3 bar</entry></row></tbody></tgroup></table>
<simpletable><sthead><stentry>Part</stentry><stentry>No.</stentry></sthead><strow><stentry>O-ring</stentry><stentry>77</stentry></strow><strow><stentry>Bolt</stentry><stentry>4</stentry></strow></simpletable>
<table id="tb2"><tgroup cols="1"><tbody><row><entry>second table cell</entry></row></tbody></tgroup></table>
<p>tail paragraph, changed here.</p>
</body></topic>`;
      const right = left
        .replace('12 Nm', '15 Nm')
        .replace('<stentry>77</stentry>', '<stentry>78</stentry>')
        .replace('second table cell', 'second table CELL')
        .replace('changed here', 'changed HERE');

      const result = renderDiffColumns(runDiff(left, right).rows);
      const $ = parseColumn(result.left, 'left');
      assert.strictEqual($('table.dv-table').length, 3, 'three source tables => three parsed tables');
      // And they stayed separate: no table grew rows from its neighbour, and
      // every row kept the source table's own column count.
      assert.deepStrictEqual(
        $('table.dv-table')
          .toArray()
          .map((t) => {
            const rows = $(t).find('tr').toArray();
            return [rows.length, Math.max(...rows.map((r) => $(r).find('> td, > th').length))];
          }),
        [[3, 2], [3, 2], [1, 1]],
      );
      assert.strictEqual($('thead').length, 2, 'the two header rows stay in their own tables\' <thead>');
    });

    it('keeps two adjacent recursed rows as two rows (regression: a recursed <row> contributed only its bare <td>s, and the parser keeps an implicit <tr> open until an explicit </tr>, so two decomposed rows landed as ONE row of double the columns)', () => {
      // Both rows differ from the other side, so both recurse into cells.
      const left = CALS('12 Nm').replace('<entry>Pressure</entry>', '<entry>Pressure (old)</entry>');
      const right = CALS('15 Nm').replace('<entry>Pressure</entry>', '<entry>Pressure (new)</entry>');
      const $ = parseColumn(renderDiffColumns(runDiff(left, right).rows).left, 'left');

      const bodyRows = $('tbody tr');
      assert.strictEqual(bodyRows.length, 2, 'two recursed rows must stay two rows');
      bodyRows.each((i, tr) => {
        assert.strictEqual($(tr).find('> td, > th').length, 2, `row ${i} must have the table's 2 columns, not 4`);
      });
    });

    it('marks changed cells with a fragment class and a navigation index, without reusing .dv-block (which would override the cell padding and draw a 3px gutter bar through the grid)', () => {
      const $ = parseColumn(renderDiffColumns(runDiff(CALS('12 Nm'), CALS('15 Nm')).rows).left, 'left');
      const marked = $('.dv-frag--modified');
      assert.strictEqual(marked.length, 1, 'exactly the changed cell is marked');
      assert.strictEqual(marked.text(), '12 Nm');
      assert.ok(marked.attr('class')!.includes('entry'), 'the renderer\'s own cell classes are kept');
      assert.ok(marked.attr('data-diff-idx') !== undefined, 'navigable by change index');
      assert.ok(!marked.attr('class')!.includes('dv-block'), 'a table fragment must not carry .dv-block');
      // One change => one connector on each side.
      assert.strictEqual($('[data-diff-idx]').length, 1);
    });

    it('applies word-level inline marks inside a recursed cell (regression: the fragment path shipped the raw html, so a one-word cell edit lost its red/green pinpointing even though the engine had computed it)', () => {
      const cols = renderDiffColumns(runDiff(CALS('12 Nm'), CALS('15 Nm')).rows);
      const left = parseColumn(cols.left, 'left');
      const right = parseColumn(cols.right, 'right');
      assert.strictEqual(left('.diff-inline-del').length, 1, 'left cell marks the removed word');
      assert.strictEqual(right('.diff-inline-add').length, 1, 'right cell marks the added word');
      assert.strictEqual(left('.diff-inline-del').text(), '12');
      assert.ok(left('td').text().includes('Nm'), 'unchanged words in the cell stay unmarked');
    });

    it('emits a whole added or removed <tgroup> as its own table, so its <colgroup> is never orphaned (a multi-tgroup table losing one tgroup leaves the other as the emitted leaf, and its html starts with <colgroup> — markup a bare <div> cannot hold)', () => {
      const tgroup = (label: string) =>
        `<tgroup cols="1"><colspec colname="c1" colwidth="1*"/><tbody><row><entry>${label}</entry></row></tbody></tgroup>`;
      const left = `<?xml version="1.0"?><topic id="t"><title>T</title><body>
<table id="tb">${tgroup('first group')}${tgroup('second group')}</table>
</body></topic>`;
      const right = `<?xml version="1.0"?><topic id="t"><title>T</title><body>
<table id="tb">${tgroup('first group')}</table>
</body></topic>`;

      const cols = renderDiffColumns(runDiff(left, right).rows);
      const $ = parseColumn(cols.left, 'left');
      assert.ok($('table').length >= 1, 'the removed tgroup must still arrive as a table');
      assert.strictEqual($('colgroup').length, $('table').length, 'one colgroup per table, never foster-parented out');
      assert.ok($('tbody tr td').length >= 1, 'and its row and cell survive too');
      assert.strictEqual($('.dv-block--table').length, $('table').length, 'a whole-structure fragment is marked on its wrapper div');
    });

    it("restyles nothing the source table already decided: the assembled <table> carries the SOURCE element's own classes (regression: the wrapper hardcoded the CALS classes, so every recursed simpletable silently gained CALS cell padding and a filled header background, and every CALS table with colspec widths lost .cals-table--fixed-layout, the rule that makes <colspec> widths authoritative instead of a hint)", () => {
      const left = `<?xml version="1.0"?>
<topic id="t"><title>T</title><body>
<table id="tb1"><tgroup cols="2"><colspec colname="c1" colwidth="1*"/><colspec colname="c2" colwidth="2*"/><tbody><row><entry>A</entry><entry>old</entry></row></tbody></tgroup></table>
<simpletable><sthead><stentry>P</stentry><stentry>N</stentry></sthead><strow><stentry>x</stentry><stentry>77</stentry></strow></simpletable>
</body></topic>`;
      const right = left.replace('old', 'new').replace('77', '78');
      const $ = parseColumn(renderDiffColumns(runDiff(left, right).rows).left, 'left');
      const cls = $('table.dv-table').toArray().map((t) => $(t).attr('class') || '');
      assert.strictEqual(cls.length, 2);
      assert.ok(cls[0].includes('cals-table--fixed-layout'), `CALS widths must survive, got: ${cls[0]}`);
      assert.ok(cls[1].includes('simple-table'), `simpletable typography must survive, got: ${cls[1]}`);
    });

    it('emits an added or removed ROW as a fragment inside the same table, marked on the <tr> itself', () => {
      const base = (rows: string) => `<?xml version="1.0"?>
<topic id="t"><title>Spec</title><body>
<table id="tb1"><tgroup cols="2"><colspec colname="c1" colwidth="1*"/><colspec colname="c2" colwidth="2*"/><tbody>${rows}</tbody></tgroup></table>
</body></topic>`;
      const left = base('<row><entry>A</entry><entry>1</entry></row><row><entry>B</entry><entry>2</entry></row>');
      const right = base('<row><entry>A</entry><entry>1</entry></row><row><entry>B</entry><entry>2</entry></row><row><entry>C</entry><entry>3</entry></row>');
      const cols = renderDiffColumns(runDiff(left, right).rows);

      // The unchanged side has no fragment marker at all...
      const l$ = parseColumn(cols.left, 'left');
      assert.strictEqual(l$('[data-diff-idx]').length, 0);
      assert.strictEqual(l$('tr').length, 2, 'left really has two rows');

      // ...and the inserted row belongs to the same table rather than a second one.
      const r$ = parseColumn(cols.right, 'right');
      assert.strictEqual(r$('table.dv-table').length, 1, 'an added row must not spawn its own table');
      assert.strictEqual(r$('tr').length, 3);
      const added = r$('.dv-frag--added');
      assert.strictEqual(added.length, 1);
      assert.strictEqual(added.get(0)!.tagName, 'tr', 'a whole added row is marked on the <tr>');
      assert.strictEqual(r$('[data-diff-idx]').length, 1, 'one change, one index');
    });

    it('does not leave a rowless <table> shell on the side that lost every row (regression: the <colgroup> carry and the recursed containers\' skeleton tags were flushed even when a side had no rows, so deleting a one-row table drew an empty bordered table with the other side\'s column widths next to the removal)', () => {
      const withRows = (rows: string) => `<?xml version="1.0"?>
<topic id="t"><title>T</title><body>
<table id="tb"><tgroup cols="1"><colspec colname="c" colwidth="1*"/><tbody>${rows}</tbody></tgroup></table>
<p id="p">shared paragraph</p>
</body></topic>`;
      const oneRow = '<row><entry>only left row</entry></row>';
      const cols = renderDiffColumns(runDiff(withRows(oneRow), withRows('')).rows);

      const l$ = parseColumn(cols.left, 'left');
      assert.strictEqual(l$('table.dv-table').length, 1, 'the side with the row keeps its table');
      assert.strictEqual(l$('tbody tr td').text(), 'only left row');

      const r$ = parseColumn(cols.right, 'right');
      assert.strictEqual(r$('table').length, 0, 'the side with no rows must emit no table at all');
      assert.strictEqual(r$('.dv-block--table').length, 0, 'nor the wrapper box around one');
      assert.strictEqual(r$('.dv-frag').length, 0);
      assert.ok(r$('p').text().includes('shared paragraph'), 'the rest of the column is unaffected');

      // Same rule after a side swap: the emptiness follows the column, not the
      // original document (the swap handler re-renders from swapped rows).
      const swapped = renderDiffColumns(swapAlignedRows(runDiff(withRows(oneRow), withRows('')).rows));
      const sLeft$ = parseColumn(swapped.left, 'left');
      assert.strictEqual(sLeft$('table').length, 0, 'swapped: the emptied side still emits no shell');
      const sRight$ = parseColumn(swapped.right, 'right');
      assert.strictEqual(sRight$('table.dv-table').length, 1, 'swapped: the content side keeps exactly one table');
      assert.strictEqual(sRight$('tbody tr td').text(), 'only left row');
    });

    it('keeps every change counted exactly once across the wrapper/fragment split (the panel\'s next/prev total and the toolbar chip have to agree)', () => {
      const left = `<?xml version="1.0"?><topic id="t"><title>T</title><body>
<table id="tb"><tgroup cols="1"><tbody><row><entry>alpha</entry></row></tbody></tgroup></table>
<p id="p">a plain paragraph</p>
</body></topic>`;
      const right = left.replace('alpha', 'alphabetic').replace('a plain paragraph', 'a changed paragraph');
      const result = runDiff(left, right);
      const cols = renderDiffColumns(result.rows);
      for (const [side, html] of [
        ['left', cols.left],
        ['right', cols.right],
      ] as const) {
        const $ = parseColumn(html, side);
        assert.strictEqual(
          $('[data-diff-idx]').length,
          cols.changeCount,
          `${side}: one element per change index, no duplicate or missing markers`,
        );
      }
      assert.strictEqual(cols.changeCount, 2);
    });
  });

  describe('a recursed table keeps its caption', () => {
    const titled = (caption: string, rows: string) => `<?xml version="1.0"?>
<topic id="t"><title>Spec</title><body>
<table id="tb">${caption}<tgroup cols="1"><colspec colname="c" colwidth="1*"/><tbody>${rows}</tbody></tgroup></table>
<p id="p">tail paragraph</p>
</body></topic>`;
    const CAP = '<title>Performance figures</title>';
    const ROWS = '<row><entry>12 Nm</entry></row>';

    it('converts the preview heading into a caption without changing the preview (the panel owns this markup: baseTypeMap still renders a table title as <h{level} class="title topictitle{N}">, so the conversion cannot be a shared-renderer change, and a heading left in table scope is foster-parented out of the re-assembled table)', () => {
      const doc = parseDita(titled(CAP, ROWS));
      const find = (n: DitaNode): DitaNode | undefined => {
        if (n.baseType === 'topic/table') return n;
        for (const c of n.children || []) {
          const hit = find(c);
          if (hit) return hit;
        }
        return undefined;
      };
      // The preview, untouched: a heading inside the table, and no caption.
      const preview = renderElement(find(doc.root)!, { ...ctx0, headingLevel: 1, parentBaseType: 'topic/body' });
      assert.ok(
        /<h1[^>]*class="title topictitle1"[^>]*>Performance figures<\/h1>/.test(preview),
        `preview keeps its own heading markup, got: ${preview}`,
      );
      assert.ok(!preview.includes('<caption'), 'the preview is not restyled by the diff panel');

      // The panel, from the same source: caption markup, heading attributes kept.
      const cols = renderDiffColumns(runDiff(titled(CAP, ROWS), titled('<title>Torque</title>', ROWS)).rows);
      const cap = parseColumn(cols.left, 'left')('caption');
      assert.strictEqual(cap.length, 1);
      assert.ok(/\btitle\b/.test(cap.attr('class')!) && /\btabletitle\b/.test(cap.attr('class')!), 'topictitleN became tabletitle');
      assert.ok(!/topictitle/.test(cap.attr('class')!), 'and the heading-level class is gone');
      assert.strictEqual(cap.attr('data-dita-tagname'), 'title', 'the source-jump attributes survive the rename');
      assert.notStrictEqual(cap.attr('data-line'), undefined, 'including the line number');
    });

    it('captions a table the diff did NOT recurse, so one edit does not restyle its untouched neighbour (an added/removed/unchanged table arrives as the preview markup, whose heading the parser hoists ABOVE the table -- while the recursed sibling beside it gets a caption)', () => {
      const two = (capA: string, capB: string) => `<?xml version="1.0"?>
<topic id="t"><title>S</title><body>
<table id="a">${capA}<tgroup cols="1"><colspec colname="c" colwidth="1*"/><tbody><row><entry>a1</entry></row></tbody></tgroup></table>
<table id="b">${capB}<tgroup cols="1"><colspec colname="c" colwidth="1*"/><tbody><row><entry>b1</entry></row></tbody></tgroup></table>
</body></topic>`;
      // Only the SECOND caption changes, so only the second table recurses.
      const cols = renderDiffColumns(
        runDiff(two('<title>First</title>', '<title>Second</title>'), two('<title>First</title>', '<title>Secunda</title>')).rows,
      );
      const $ = parseColumn(cols.left, 'left');
      assert.strictEqual($('table').length, 2, 'one opaque, one re-assembled');
      assert.strictEqual($('table > caption').length, 2, 'and both caption their own table');
      assert.strictEqual($('table:not(.dv-table) > caption').text(), 'First', 'the opaque table keeps ITS title, as a caption');
      assert.ok(!$('table:not(.dv-table) > caption').attr('class')!.includes('dv-frag'), 'unchanged, so unmarked');
      // The heading must not have been hoisted out into the block wrapper.
      assert.strictEqual($('div.dv-block > h1, div.dv-block > h2').length, 1, 'only the topic title is a heading');
      assert.strictEqual($('div.dv-block > h1').text(), 'S');
    });

    it('captions a titled table that reaches the panel inside an opaque block (a table inside an UNCHANGED section is never recursed, so it goes out as the preview\'s own markup -- and its <h3 class="title topictitle3"> in table scope is hoisted ABOVE the table by the parser, leaving the table reading as untitled)', () => {
      const doc = (word: string) => `<?xml version="1.0"?>
<topic id="t"><title>S</title><body>
<section id="sec"><title>Setup</title>
<table id="tb"><title>Inner table</title><tgroup cols="1"><colspec colname="c" colwidth="1*"/><tbody><row><entry>12 Nm</entry></row></tbody></tgroup></table>
</section>
<p id="p">${word}</p>
</body></topic>`;
      // Only the paragraph outside the section changes: the section, and the table
      // inside it, stay one opaque block.
      const cols = renderDiffColumns(runDiff(doc('one'), doc('two')).rows);
      const $ = parseColumn(cols.left, 'left');
      assert.strictEqual($('table > caption').length, 1, 'the nested table is captioned');
      assert.strictEqual($('table > caption').text(), 'Inner table');
      assert.ok(!$('table > caption').attr('class')!.includes('dv-frag'), 'not a change, so unmarked');
      assert.strictEqual($('table h1, table h2, table h3, table h4').length, 0, 'no heading left inside the table');
      assert.strictEqual($('tbody tr td').text(), '12 Nm', 'the table itself is intact');
      assert.ok($('h1, h2, h3').text().includes('Setup'), 'the section keeps its own heading');
    });

    it('captions a table nested in a cell while leaving the section heading beside it a heading (the guard is the topictitleN class, so only a table title converts)', () => {
      const doc = (word: string) => `<?xml version="1.0"?>
<topic id="t"><title>S</title><body>
<table id="outer"><tgroup cols="1"><colspec colname="c" colwidth="1*"/><tbody><row><entry><section id="s"><title>Inner section</title><table id="inner"><title>Inner table</title><tgroup cols="1"><tbody><row><entry>${word}</entry></row></tbody></tgroup></table></section></entry></row></tbody></tgroup></table>
</body></topic>`;
      const cols = renderDiffColumns(runDiff(doc('one'), doc('two')).rows);
      const $ = parseColumn(cols.left, 'left');
      assert.strictEqual($('table').length, 2, 'outer and inner tables');
      assert.strictEqual($('table > caption').length, 1, 'only the table that HAS a title is captioned');
      assert.strictEqual($('table > caption').text(), 'Inner table');
      assert.ok(
        $('td h3').text().includes('Inner section'),
        'a section title leading a cell\'s content stays a heading, not a caption',
      );
      assert.strictEqual($('tbody tr td').last().text().includes('one'), true, 'the inner cell is intact');
    });

    it("surfaces the caption inside its own table (regression: SKIP_BASETYPES drops topic/title from a recursed container, so a table's caption was drawn on neither side and editing ONLY the caption was not a change at all -- measured as stats {added:0, removed:0, modified:0})", () => {
      const result = runDiff(titled(CAP, ROWS), titled(CAP, ROWS));
      assert.deepStrictEqual(result.stats, { added: 0, removed: 0, modified: 0 });
      const cols = renderDiffColumns(result.rows);
      for (const [side, html] of [
        ['left', cols.left],
        ['right', cols.right],
      ] as const) {
        const $ = parseColumn(html, side);
        assert.strictEqual($('caption').length, 1, `${side}: the caption is drawn`);
        assert.strictEqual($('caption').text(), 'Performance figures');
        assert.strictEqual(
          $('caption').parent().get(0)!.tagName,
          'table',
          `${side}: a caption belongs to its table, and one emitted beside a <div> is deleted by the parser`,
        );
        assert.strictEqual($('caption')[0]!.attribs['data-diff-idx'], undefined, 'unchanged, so not navigable');
        // The caption must not steal the table's structure or widths.
        assert.strictEqual($('tbody tr td').text(), '12 Nm');
        assert.strictEqual($('col').length, 1, 'the colgroup widths still arrive');
      }
    });

    it('counts an edited caption as one change and marks it on the caption itself, with word-level highlights', () => {
      const result = runDiff(titled(CAP, ROWS), titled('<title>Torque figures</title>', ROWS));
      assert.strictEqual(result.stats.modified, 1, 'the caption edit is a change');
      const cols = renderDiffColumns(result.rows);
      const l$ = parseColumn(cols.left, 'left');
      const r$ = parseColumn(cols.right, 'right');
      assert.strictEqual(l$('caption.dv-frag--modified').length, 1);
      assert.strictEqual(l$('caption').attr('data-diff-idx'), r$('caption').attr('data-diff-idx'), 'both halves share one index');
      assert.strictEqual(l$('.diff-inline-del').text(), 'Performance', 'the changed word is pinpointed');
      assert.strictEqual(r$('.diff-inline-add').text(), 'Torque');
      assert.strictEqual(l$('[data-diff-idx]').length, 1, 'and nothing else in the table is marked');
      assert.strictEqual(l$('td.dv-frag').length, 0);
    });

    it('draws a caption that only exists on one side, on that side only', () => {
      const added = renderDiffColumns(runDiff(titled('', ROWS), titled(CAP, ROWS)).rows);
      assert.strictEqual(parseColumn(added.left, 'left')('caption').length, 0, 'no caption to invent');
      const r$ = parseColumn(added.right, 'right');
      assert.strictEqual(r$('caption.dv-frag--added').length, 1);
      assert.strictEqual(r$('caption').parent().get(0)!.tagName, 'table');
      assert.strictEqual(r$('tbody tr td').length, 1, 'the unchanged rows are still there');

      const removed = renderDiffColumns(runDiff(titled(CAP, ROWS), titled('', ROWS)).rows);
      assert.strictEqual(parseColumn(removed.left, 'left')('caption.dv-frag--removed').length, 1);
      assert.strictEqual(parseColumn(removed.right, 'right')('caption').length, 0);
    });

    it('attaches a caption to the table it titles, never to the next one (two tables in a row: editing the second caption must not mark the first table)', () => {
      const two = (capA: string, capB: string) => `<?xml version="1.0"?>
<topic id="t"><title>S</title><body>
<table id="a">${capA}<tgroup cols="1"><colspec colname="c" colwidth="1*"/><tbody><row><entry>a1</entry></row></tbody></tgroup></table>
<table id="b">${capB}<tgroup cols="1"><colspec colname="c" colwidth="1*"/><tbody><row><entry>b1</entry></row></tbody></tgroup></table>
</body></topic>`;
      const cols = renderDiffColumns(
        runDiff(two('<title>First</title>', '<title>Second</title>'), two('<title>First</title>', '<title>Secunda</title>')).rows,
      );
      const $ = parseColumn(cols.left, 'left');
      assert.strictEqual($('caption').length, 2, 'both captions are drawn');
      // The first table is unchanged, so it stays one opaque block; the second
      // recurses, and only ITS caption carries the marker.
      const recursed = $('table.dv-table');
      assert.strictEqual(recursed.length, 1, 'only the changed table is re-assembled');
      assert.strictEqual(recursed.find('> caption').text(), 'Second');
      assert.ok(recursed.find('> caption').attr('class')!.includes('dv-frag--modified'));
      assert.strictEqual(recursed.find('> caption').attr('data-diff-idx'), '0');
      assert.strictEqual(cols.changeCount, 1, 'one caption edit, one change');
      assert.ok($('table:not(.dv-table) > caption').text().startsWith('First'), 'the untouched table keeps its own caption unmarked');
    });

    it('keeps a table caption inside the table even when the table sits in a section, without swallowing the section heading', () => {
      const inSection = (cap: string) => `<?xml version="1.0"?>
<topic id="t"><title>S</title><body><section id="s"><title>My section</title>
<table id="tb">${cap}<tgroup cols="1"><tbody><row><entry>12 Nm</entry></row></tbody></tgroup></table>
</section></body></topic>`;
      const cols = renderDiffColumns(runDiff(inSection('<title>Cap</title>'), inSection('<title>Cap edited</title>')).rows);
      const l$ = parseColumn(cols.left, 'left');
      assert.strictEqual(l$('caption').length, 1, 'the caption is drawn inside the table');
      assert.strictEqual(l$('caption').parent().get(0)!.tagName, 'table');
      assert.strictEqual(l$('caption').text(), 'Cap', 'the section title is a heading, not a caption');
      assert.ok(l$('h1, h2, h3').text().includes('My section'), 'and the section keeps its own heading');
      // A section heading edit and a caption edit are two separate changes.
      const both = renderDiffColumns(
        runDiff(inSection('<title>Cap</title>').replace('My section', 'Mine'), inSection('<title>Cap edited</title>').replace('My section', 'Yours')).rows,
      );
      assert.strictEqual(both.changeCount, 2, 'section title + table caption are two changes');
    });

    it('draws one caption per table when the whole table is added or removed (its caption rides inside the whole-table block, so it must not also surface as a separate row)', () => {
      const added = renderDiffColumns(runDiff(titled('', ''), titled(CAP, ROWS)).rows);
      const a$ = parseColumn(added.right, 'right');
      assert.strictEqual(a$('caption').length, 1, 'the added table has exactly one caption');
      assert.strictEqual(a$('caption').parents('table').length, 1, 'inside its table');
      assert.strictEqual(a$('tbody tr td').text(), '12 Nm', 'and its rows');

      const removed = renderDiffColumns(runDiff(titled(CAP, ROWS), titled('', '')).rows);
      const r$ = parseColumn(removed.left, 'left');
      assert.strictEqual(r$('caption').length, 1);
      assert.strictEqual(r$('caption').parents('table').length, 1);
    });

    it('still shows a CHANGED caption on the side that lost every row, and shows nothing on the side whose caption did not change (a caption needs a <table> to sit in, but inventing a rowless shell for an unchanged one is the empty-table artifact)', () => {
      const both = renderDiffColumns(runDiff(titled(CAP, ROWS), titled('<title>Torque figures</title>', '')).rows);
      const b$ = parseColumn(both.right, 'right');
      assert.strictEqual(b$('caption').text(), 'Torque figures', 'the edited caption survives its table losing all rows');
      assert.strictEqual(b$('tr').length, 0, 'and no rows are invented');

      const same = renderDiffColumns(runDiff(titled(CAP, ROWS), titled(CAP, '')).rows);
      const s$ = parseColumn(same.right, 'right');
      assert.strictEqual(s$('table').length, 0, 'an unchanged caption on an emptied side draws no shell');
      assert.strictEqual(s$('caption').length, 0);
    });

    it('survives a side swap without orphaning the caption', () => {
      const result = runDiff(titled(CAP, ROWS), titled('<title>Torque figures</title>', ROWS));
      const swapped = renderDiffColumns(swapAlignedRows(result.rows));
      const sw$ = parseColumn(swapped.left, 'left');
      assert.strictEqual(sw$('caption').length, 1, 'the swapped column still captions its table');
      assert.strictEqual(sw$('caption').parent().get(0)!.tagName, 'table');
      assert.strictEqual(sw$('caption').text(), 'Torque figures', 'the swapped side shows its own caption text');
    });
  });

  describe('blocks that render nothing are not blocks', () => {
    it("emits no empty ghost row per <colspec> (regression: topic/colspec renders '' by design -- it feeds the tgroup's <colgroup> -- yet each one became an empty `<div class=\"dv-block\">`, a visible ~40px gap, so a 4-column table grew 4 phantom rows)", () => {
      const cols = renderDiffColumns(runDiff(CALS('12 Nm'), CALS('15 Nm')).rows);
      for (const [side, html] of [
        ['left', cols.left],
        ['right', cols.right],
      ] as const) {
        const $ = parseColumn(html, side);
        assert.strictEqual($('[class~="dv-block"]:empty').length, 0, `${side}: no empty ghost blocks`);
      }
      assert.ok(!/colspec/i.test(cols.left), 'colspec contributes no markup of its own');
    });

    it('drops an authoring-only element whose renderer emits empty, and keeps one that renders', () => {
      const left = `<?xml version="1.0"?><topic id="t"><title>T</title><body>
<p>before</p>
<p>after</p>
</body></topic>`;
      // An <area> in a <fig> renders as part of the imagemap machinery, but a
      // bare authoring element under <body> that renders empty must not appear.
      const withEmpty = left.replace('<p>before</p>', '<p>before</p><publisher><publishername>x</publishername></publisher>');
      const cols = renderDiffColumns(runDiff(withEmpty, withEmpty.replace('after', 'AFTER')).rows);
      assert.ok(cols.left.includes('before'), 'real content still emitted');
      const $ = parseColumn(cols.left, 'left');
      assert.strictEqual($('[class~="dv-block"]:empty').length, 0, 'the empty-rendered element added no block');
    });
  });

  describe('injectFragmentAttrs', () => {
    const cls = 'dv-frag dv-frag--modified';
    const idx = ' data-diff-idx="3"';

    it('merges into an existing class attribute instead of adding a second one (HTML keeps the first class= and drops later ones)', () => {
      const out = injectFragmentAttrs('<td class="entry">A</td>', cls, idx);
      assert.strictEqual(out, '<td class="entry dv-frag dv-frag--modified" data-diff-idx="3">A</td>');
      assert.strictEqual((out.match(/class="/g) || []).length, 1, 'exactly one class attribute');
    });

    it('inserts class after the tag name when the fragment has none', () => {
      assert.strictEqual(
        injectFragmentAttrs('<tr>…</tr>', cls, ''),
        `<tr class="${cls}">…</tr>`,
      );
    });

    it('ignores a > inside a quoted attribute value when finding the end of the opening tag', () => {
      const out = injectFragmentAttrs('<td title="a>b" class="entry">A</td>', cls, idx);
      assert.ok(out.startsWith('<td title="a>b" class="entry dv-frag dv-frag--modified" data-diff-idx="3">'), out);
      assert.ok(out.endsWith('>A</td>'), out);
    });

    it('preserves a self-closing fragment', () => {
      assert.strictEqual(injectFragmentAttrs('<col />', cls, idx), `<col class="${cls}"${idx} />`);
    });

    it('falls back to a marked <span> for html that is not a tag, rather than corrupting it', () => {
      assert.strictEqual(injectFragmentAttrs('plain text', cls, idx), `<span class="${cls}"${idx}>plain text</span>`);
      assert.strictEqual(injectFragmentAttrs('<tr unclosed', cls, idx), `<span class="${cls}"${idx}><tr unclosed</span>`);
    });

    it('leaves the parsed fragment structurally valid for every leaf kind the engine can emit', () => {
      for (const frag of ['<td class="entry">A</td>', '<tr class="row"><td>B</td></tr>', '<thead class="thead"><tr><th>H</th></tr></thead>']) {
        const $ = load(`<div><table>${injectFragmentAttrs(frag, cls, idx)}</table></div>`);
        assert.ok($('[data-diff-idx="3"]').length === 1, frag);
      }
    });
  });

  describe('non-table blocks keep their previous rendering', () => {
    it('still wraps a changed paragraph in a .dv-block div with the change class and index', () => {
      const left = `<?xml version="1.0"?><topic id="t"><title>T</title><body>
<p id="p1">Turn the dial to the left before use.</p></body></topic>`;
      const right = left.replace('to the left', 'to the right');
      const cols = renderDiffColumns(runDiff(left, right).rows);
      const $ = parseColumn(cols.left, 'left');
      const block = $('.dv-block--modified');
      assert.strictEqual(block.length, 1);
      assert.ok(block.attr('data-diff-idx') !== undefined);
      assert.strictEqual(block.find('.diff-inline-del').text(), 'left');
    });

    it('numbers every change once, so the next/prev counter and the connectors agree', () => {
      const left = `<?xml version="1.0"?><topic id="t"><title>T</title><body>
<p id="a">one</p><p id="b">two</p>
<table id="tb"><tgroup cols="1"><tbody><row><entry>cell old</entry></row></tbody></tgroup></table>
</body></topic>`;
      const right = left.replace('one', 'ONE').replace('two', 'TWO').replace('cell old', 'cell new');
      const cols = renderDiffColumns(runDiff(left, right).rows);
      assert.strictEqual(cols.changeCount, 3);
      const $ = parseColumn(cols.left, 'left');
      assert.deepStrictEqual(
        $('[data-diff-idx]').toArray().map((n) => $(n).attr('data-diff-idx')).sort(),
        ['0', '1', '2'],
      );
    });
  });
});
