import * as assert from 'assert';
import { load } from 'cheerio';
import { DitaNode } from '../../parser/domTypes';
import { RenderContext, renderElement } from '../../render/renderer';
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

// The minimum the renderers actually read (renderer.test.ts uses the same
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
