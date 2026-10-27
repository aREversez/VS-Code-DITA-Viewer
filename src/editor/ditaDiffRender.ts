// HTML assembly for the rendered diff panel — pure string functions, no vscode
// dependency (that is what makes it unit-testable from src/test, which cannot
// import any module that imports 'vscode'; ditaDiffProvider.ts's own comment
// about the diff-webview.js extraction says the same thing from the other side).
//
// The diff engine (ditaDiffEngine.ts) produces structured AlignedRows; this
// module turns them into the two independent column flows the webview shows.
// It is the render half of what ditaDiffProvider.ts used to do inline.
//
// Independent two-column layout: each side flows as its own continuous
// document. A block present on only one side (added / removed) is emitted into
// that column alone -- no full-height empty placeholder stretches the other
// column to match, which is what broke the reading flow in the old aligned-row
// model. Change type is carried by a thin edge marker (see .dv-block--* in
// diff-styles.css) plus word-level inline marks. Both sides of one change share
// a data-diff-idx so the webview's next/prev navigation can highlight the pair
// together even though the columns are no longer row-for-row aligned.
//
// TABLE FRAGMENTS are the exception to "wrap the block in a div". Recursing a
// <table> yields blocks whose html is a fragment -- `<tr …>`, `<thead …>` or
// the bare `<colgroup>…<tbody>…` a <tgroup> returns -- not standalone markup.
// Dropped into a plain <div>, the HTML parser foster-parents them: every tag
// except the cell TEXT is discarded, so a recursed table arrived in the panel
// as bare unsegmented text (measured against the real renderer and a
// spec-compliant parser: 0 <table>, 0 <tr>, 0 <td> survived; two adjacent
// cells with no separator read as one run "Pressure3 bar"). Fragments are
// therefore gathered and emitted inside <table> wrappers:
//
//   - COMPLETE fragments (a <tgroup>'s output) already contain their own
//     colgroup/thead/tbody structure, so they need no grouping with their
//     neighbours and take the change marker on the wrapper div;
//   - PARTIAL fragments (rows, row groups, cells) are GROUPED: consecutive
//     partials join ONE table, so their columns share widths and a row still
//     reads as part of its table rather than as a standalone one-row table.
//     Their change class and data-diff-idx ride on the fragment's own opening
//     tag, so navigation, hover-linking and the gutter connectors still address
//     individual rows and cells (the connector code selects by
//     [data-diff-idx] and hit-tests with closest(), both of which work from
//     inside a table).
//
// Fragments carry `dv-frag dv-frag--<type>` rather than `dv-block dv-block--
// <type>`: .dv-block's block-level padding would override a <td>'s own cell
// padding (a class beats styles.css's `table td` selector), and the div
// markers' 3px gutter border would draw a stray vertical bar through the
// middle of the grid. The table rules in diff-styles.css mark fragments
// instead by tinting the collapsed grid edges of the cells themselves.
//
// A recursed table's own <title> follows the same rule, with one difference: the
// PREVIEW renders a table title as a heading (that is the extension's existing
// markup, and the diff panel must not restyle it), and inside the re-assembled
// <table> here that heading would be foster-parented out of it again -- while a
// <caption> emitted in the group buffer would be deleted outright (measured:
// 0 <caption> survives outside a table). So the title row is buffered per group
// and converted to a <caption> when it is attached to that group's first emitted
// table, ahead of everything else in it. The conversion is the diff panel's own
// layout decision, scoped to the panel; nothing in src/render changes.
//
// This is string surgery on markup, so two rules keep it honest: only a heading
// sitting in a <table>'s own caption slot is rewritten (never one that merely
// looks like a title), and the tag scan skips quoted attribute values, so a `<`
// inside an attribute can't be mistaken for the start of a tag. Sample markup in
// a <codeblock>/<pre> is escaped by the renderer, so it never reads as a tag here.

import { AlignedRow, RenderedBlock, applyInlineMarksToHtml } from './ditaDiffEngine';

/** Complete: renders its own <colgroup>/<thead>/<tbody> children inside. */
const COMPLETE_TABLE_FRAGMENT = new Set(['topic/tgroup']);
/** Partials: need a surrounding <table> (and group with their neighbours). */
const PARTIAL_TABLE_FRAGMENT = new Set([
  'topic/thead',
  'topic/sthead',
  'topic/tbody',
  'topic/row',
  'topic/strow',
  'topic/entry',
  'topic/stentry',
]);
/**
 * Partials that can be RECURSED, so the assembly has to rebuild their own tag
 * around whatever comes out of them. A recursed row contributes nothing but its
 * cells, and the parser keeps an implicit <tr> open until an explicit </tr> --
 * two adjacent recursed rows therefore land as ONE row of double the columns. A
 * recursed <thead>/<tbody> emits complete <tr>s, which do nest, but they would
 * all join the table's implicit <tbody>, silently moving header rows out of the
 * header (and its styling) whenever a header row itself recursed.
 */
const RECURSABLE_TABLE_FRAGMENT = new Set([
  'topic/thead',
  'topic/sthead',
  'topic/tbody',
  'topic/row',
  'topic/strow',
]);

function fragmentKind(block: RenderedBlock): 'complete' | 'partial' | undefined {
  const bt = block.baseType || '';
  if (COMPLETE_TABLE_FRAGMENT.has(bt)) return 'complete';
  if (PARTIAL_TABLE_FRAGMENT.has(bt)) return 'partial';
  return undefined;
}

interface ColumnSink {
  left: string[];
  right: string[];
  changeCount: number;
  /** moveId -> data-diff-idx, so the two halves of a moved block (one in each
   *  column, at different positions) share one change index and one connector. */
  moveIdx: Map<number, number>;
  /** Consecutive partial fragments awaiting one shared <table> wrapper. */
  pendingLeft: string[];
  pendingRight: string[];
  /** How many of those buffered pieces are actual content (a row or a cell),
   *  per side. The <colgroup> carry and a recursed container's own skeleton
   *  tags are not content, so a side whose rows all live on the other side can
   *  be recognised as empty at flush time. */
  pendingLeftContent: number;
  pendingRightContent: number;
  /** The current table group's caption, marked and ready to drop into the
   *  first <table> that group emits. Cleared once consumed or when the group
   *  ends, so a caption can never attach to the NEXT table. */
  captionLeft?: PendingCaption;
  captionRight?: PendingCaption;
  /** Classes of the <table> the current pending group belongs to, per side. */
  tableClsLeft: string;
  tableClsRight: string;
}

const DEFAULT_TABLE_CLS = 'table cals-table';

/** A buffered caption. `changed` is what makes an unchanged caption droppable:
 *  a side whose table lost all its rows draws nothing at all (see
 *  flushPartials), and only a caption that is itself the change has to force a
 *  table into existence to be visible in. */
interface PendingCaption {
  html: string;
  changed: boolean;
}

export function renderDiffColumns(rows: AlignedRow[]): { left: string; right: string; changeCount: number } {
  const sink: ColumnSink = {
    left: [],
    right: [],
    changeCount: 0,
    moveIdx: new Map(),
    pendingLeft: [],
    pendingRight: [],
    pendingLeftContent: 0,
    pendingRightContent: 0,
    tableClsLeft: DEFAULT_TABLE_CLS,
    tableClsRight: DEFAULT_TABLE_CLS,
  };
  collectColumns(rows, sink, false);
  // A table ending the document leaves its fragments buffered.
  endTableGroup(sink);
  return {
    left: captionTablesIn(sink.left.join('\n')),
    right: captionTablesIn(sink.right.join('\n')),
    changeCount: sink.changeCount,
  };
}

// The wrapper a set of partial fragments is assembled into must be exactly one
// source table, so fragments are grouped by the table they came from rather
// than merely "consecutive". Recursing a table walks <table> -> <tgroup> ->
// <thead>/<tbody> -> <row>, and flushing at every one of those boundaries
// would put each row in its own <table>: column widths, the header row and the
// body rows would stop sharing a grid, which is precisely the alignment a table
// needs. Entering a <table>/<simpletable> container therefore starts a new
// group; everything until the next one joins that group.
const TABLE_ROOT_BASETYPES = new Set(['topic/table', 'topic/simpletable']);

function collectColumns(rows: AlignedRow[], sink: ColumnSink, inTableGroup: boolean): void {
  for (const row of rows) {
    // A modified container (section / list / table) recurses into its children;
    // the container itself contributes no block of its own, matching the
    // aligned-row renderer, which only ever showed the recursed children.
    if (row.children && row.children.length > 0) {
      let children = row.children;
      const isTableRoot =
        !!row.left && TABLE_ROOT_BASETYPES.has(row.left.baseType || '') ||
        !!row.right && TABLE_ROOT_BASETYPES.has(row.right.baseType || '');
      if (isTableRoot) {
        // The previous table's group is complete: its fragments and its
        // caption have to be emitted before anything of THIS table appears.
        endTableGroup(sink);
        // The assembled wrapper must carry the SOURCE table's own classes.
        // Hardcoding the CALS ones instead silently restyled every recursed
        // simpletable (styles.css's .simple-table: lighter cell padding,
        // transparent header background, heavier rule under the header), and
        // dropped .cals-table--fixed-layout, which is what makes <colspec>
        // widths authoritative rather than a hint.
        sink.tableClsLeft = (row.left && tableClasses(row.left.html)) || DEFAULT_TABLE_CLS;
        sink.tableClsRight = (row.right && tableClasses(row.right.html)) || DEFAULT_TABLE_CLS;
        // A recursed table's own <title> is surfaced by the engine as this
        // group's FIRST row (alignSectionChildren). Buffer it rather than
        // flowing it: a <caption> only survives in its own table's caption
        // slot, and it has to precede the <colgroup> the tgroup below carries
        // in, which plain document order would not guarantee.
        if (isCaptionRow(children[0])) {
          bufferCaption(children[0], sink);
          children = children.slice(1);
        }
      }
      // A recursed <tgroup> contributes no block of its own, so the <colgroup>
      // the tgroup RENDERER synthesizes from its <colspec> children (the only
      // source of column widths) would be lost with it. Carry that leading
      // <colgroup>…</colgroup> over into the table being assembled, so a
      // recursed table keeps the widths the preview gives it.
      if (isColumnWidthCarrier(row)) {
        const lc = row.left && colgroupPrefix(row.left.html);
        const rc = row.right && colgroupPrefix(row.right.html);
        if (lc) sink.pendingLeft.push(lc);
        if (rc) sink.pendingRight.push(rc);
      }
      // Re-open this fragment's own tag around its recursed children (see
      // RECURSABLE_TABLE_FRAGMENT). The tag carries no change class and no
      // data-diff-idx: the leaves below it are the changed blocks -- countStats
      // counts drawn leaves -- so marking the container as well would
      // double-count the change and draw two connectors for one edit.
      const skeleton = fragmentSkeleton(row);
      if (skeleton.left) sink.pendingLeft.push(skeleton.left[0]);
      if (skeleton.right) sink.pendingRight.push(skeleton.right[0]);
      collectColumns(children, sink, isTableRoot || inTableGroup);
      if (skeleton.left) sink.pendingLeft.push(skeleton.left[1]);
      if (skeleton.right) sink.pendingRight.push(skeleton.right[1]);
      continue;
    }

    // A caption that reaches the flow inside a table group (the engine put it
    // somewhere other than the group's first row) still belongs to that group's
    // table, not to a div -- bufferCaption allocates its change index.
    if (inTableGroup && isCaptionRow(row)) {
      bufferCaption(row, sink);
      continue;
    }

    const idxAttr = takeIdxAttr(row, sink);

    // A row is paired by baseType, so one side's fragment kind is the other's;
    // a one-sided added/removed row only has one side to ask.
    const kind = (row.left && fragmentKind(row.left)) || (row.right && fragmentKind(row.right)) || undefined;
    if (kind === 'complete') {
      // A <tgroup>'s html is already a whole under-<table> structure (colgroup
      // + thead + tbody…): it gets its own wrapper, and the change marker rides
      // on that wrapper div -- the structure itself has no single element that
      // could carry it, and its <colgroup> is the only thing to inject onto,
      // which paints no border at all.
      flushPartials(sink);
      if (row.left) {
        sink.left.push(
          wrapInTable(
            takeCaption(sink, 'left') + applyInlineDiff(row.left.html, row, 'left'),
            sink.tableClsLeft,
            wrapperClass(row),
            idxAttr,
          ),
        );
      }
      if (row.right) {
        sink.right.push(
          wrapInTable(
            takeCaption(sink, 'right') + applyInlineDiff(row.right.html, row, 'right'),
            sink.tableClsRight,
            wrapperClass(row),
            idxAttr,
          ),
        );
      }
      continue;
    }
    if (kind === 'partial') {
      // Inline marks apply here too, exactly as they do for a div block: the
      // recursed leaf of a table change is a cell, and a one-word edit inside
      // it still has to show which word. applyInlineMarksToHtml re-walks the
      // fragment's own text nodes, so the surrounding <td> markup is untouched.
      const cls = `dv-frag dv-frag--${row.changeType}` + fragFlags(row);
      if (row.left) {
        sink.pendingLeft.push(injectFragmentAttrs(applyInlineDiff(row.left.html, row, 'left'), cls, idxAttr));
        sink.pendingLeftContent++;
      }
      if (row.right) {
        sink.pendingRight.push(injectFragmentAttrs(applyInlineDiff(row.right.html, row, 'right'), cls, idxAttr));
        sink.pendingRightContent++;
      }
      continue;
    }

    // Leaving the table (a following paragraph, list or section): the group's
    // table has to close before this block can open, and a caption that never
    // got a table of its own must still be drawn -- it is a change.
    endTableGroup(sink);
    const cls = `dv-block dv-block--${row.changeType}` + blockFlags(row);
    if (row.left) {
      sink.left.push(`<div class="${cls}"${idxAttr}>${applyInlineDiff(row.left.html, row, 'left')}</div>`);
    }
    if (row.right) {
      sink.right.push(`<div class="${cls}"${idxAttr}>${applyInlineDiff(row.right.html, row, 'right')}</div>`);
    }
  }
}

/** Allocate this row's change index, or '' for an unchanged row. */
function takeIdxAttr(row: AlignedRow, sink: ColumnSink): string {
  if (row.changeType === 'unchanged') return '';
  if (row.moveId !== undefined && sink.moveIdx.has(row.moveId)) {
    return ` data-diff-idx="${sink.moveIdx.get(row.moveId)}"`;
  }
  const idx = sink.changeCount++;
  if (row.moveId !== undefined) sink.moveIdx.set(row.moveId, idx);
  return ` data-diff-idx="${idx}"`;
}

/** ` dv-frag--moved`/` dv-frag--replaced` suffixes for fragment leaves. */
function fragFlags(row: AlignedRow): string {
  return (row.moveId !== undefined ? ' dv-frag--moved' : '') + (row.replaced ? ' dv-frag--replaced' : '');
}

/** The same two flags in the div-block naming scheme, which the existing
 *  diff-styles.css rules already style. */
function blockFlags(row: AlignedRow): string {
  return (row.moveId !== undefined ? ' dv-block--moved' : '') + (row.replaced ? ' dv-block--replaced' : '');
}

function wrapperClass(row: AlignedRow): string {
  return 'dv-block dv-block--table' + ` dv-block--${row.changeType}` + blockFlags(row);
}

/**
 * A block that is a table's own title, i.e. the current group's caption.
 *
 * The test is the group position plus the baseType, not the rendered markup:
 * within a re-assembled table, 'topic/title' can only be that table's title --
 * DITA allows no other title below <table>, and a SECTION's own title row is
 * emitted before its table group opens, so it never reaches here as a group
 * member. Keying on markup instead (a leading <caption>) would tie the panel to
 * a preview change that does not exist: baseTypeMap keeps rendering a table
 * title as <h{level} class="title topictitle{N}">, which is exactly why
 * headingToCaption below converts it here.
 */
function isCaptionRow(row: AlignedRow | undefined): boolean {
  if (!row) return false;
  const side = row.left || row.right;
  return !!side && side.baseType === 'topic/title';
}

/**
 * Convert a title heading that starts at `at` into a <caption>, returning the
 * replacement text and the index just past the heading's own close tag.
 *
 * Only the element name and the title class change; every other attribute the
 * preview put on the heading (data-dita-tagname, data-line, data-start-col) is
 * kept, so clicking the caption still jumps to the source line.
 *
 * The guard is `topictitle{N}` -- the class baseTypeMap gives a title whose owner
 * is neither section nor example, which is what a DITA title directly under
 * <table>/<simpletable> always is. A section heading that happens to lead a
 * cell's content (`class="title sectiontitle"`) therefore stays a heading, and so
 * does anything that is not a titled heading: no fabricated <caption> that the
 * markup cannot close.
 *
 * The close tag is matched by the heading's OWN level, and taken as the FIRST
 * such tag after the open: a heading never nests a heading of its own level, so
 * the first one closes this one -- a title can carry inline markup (a real
 * <keyword>/<ph>, or the spans applyInlineDiff just inserted), and a greedy or
 * last-index scan would run past the end of a following sibling heading.
 */
function captionAt(html: string, at: number): { text: string; after: number } | undefined {
  const open = /^<h([1-6])\b/i.exec(html.slice(at));
  if (!open) return undefined;
  const end = tagEndAt(html, at);
  if (end < 0) return undefined;

  let tag = html.slice(at, end);
  const classMatch = /\sclass="([^"]*)"/.exec(tag);
  if (!classMatch || !/\btopictitle\d+\b/.test(classMatch[1])) return undefined;

  tag = tag.replace(/^<h[1-6]/i, '<caption');
  // topictitle{N} is the class a table title gets because <table> is not a
  // section/example; in the caption slot the DITA name is tabletitle.
  tag = tag.replace(/\sclass="[^"]*"/, ` class="${classMatch[1].replace(/\btopictitle\d+\b/g, 'tabletitle')}"`);

  const body = html.slice(end + 1);
  const close = `</h${open[1]}>`;
  const closeAt = body.indexOf(close);
  if (closeAt === -1) return undefined;
  return { text: `${tag}>${body.slice(0, closeAt)}</caption>`, after: end + 1 + closeAt + close.length };
}

/** Convert a block that IS a table title heading; anything else passes through. */
function headingToCaption(html: string): string {
  const hit = captionAt(html, 0);
  return hit ? hit.text + html.slice(hit.after) : html;
}

/**
 * The same conversion wherever a table appears INSIDE a block's html.
 *
 * A table the diff did not recurse arrives as the preview's own markup -- and so
 * does a table nested in a cell or inside an opaque <section>/<div> block, which
 * is how most titled tables in a real book reach the panel. Their title is an
 * `<h{N} class="title topictitle{N}">` in table scope, which the HTML parser
 * hoists ABOVE the table: the caption text lands outside its table and the table
 * reads as untitled. Without this the panel contradicts itself -- a recursed
 * table gets a caption (bufferCaption) while the identical table next to it keeps
 * a heading, so editing one table's title restyles its untouched neighbour too.
 *
 * Runs over the finished column strings, after assembly, so it reaches every path
 * a table can arrive by. It converts only a heading sitting in the caption slot
 * (directly after the table's own open tag), which is also the only slot a
 * browser accepts, so a document that puts <title> after its <tgroup> keeps its
 * previous layout instead of gaining a caption the parser would discard. Idempotent
 * as well: the captions written here carry `tabletitle`, which the guard above
 * does not match. This is the panel's markup only -- src/render is untouched.
 */
function captionTablesIn(html: string): string {
  if (!/<(table|simpletable)\b/i.test(html)) return html;

  let out = '';
  let i = 0;
  for (;;) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, lt);
    const end = tagEndAt(html, lt);
    if (end < 0) {
      out += html.slice(lt);
      break;
    }
    const tag = html.slice(lt, end + 1);
    out += tag;
    i = end + 1;
    if (!/^<(?:simple)?table\b/i.test(tag)) continue;
    const gap = /^\s*/.exec(html.slice(i))![0];
    const hit = captionAt(html, i + gap.length);
    if (!hit) continue;
    out += gap + hit.text;
    i = hit.after;
  }
  return out;
}

/** Mark a caption like any other fragment and hold it for this table group. */
function bufferCaption(row: AlignedRow, sink: ColumnSink): void {
  const cls = `dv-frag dv-frag--${row.changeType}` + fragFlags(row);
  const idxAttr = takeIdxAttr(row, sink);
  const changed = row.changeType !== 'unchanged';
  if (row.left) {
    sink.captionLeft = {
      html: injectFragmentAttrs(headingToCaption(applyInlineDiff(row.left.html, row, 'left')), cls, idxAttr),
      changed,
    };
  }
  if (row.right) {
    sink.captionRight = {
      html: injectFragmentAttrs(headingToCaption(applyInlineDiff(row.right.html, row, 'right')), cls, idxAttr),
      changed,
    };
  }
}

/**
 * Hand a side's buffered caption to the table being emitted for it, and
 * consume it -- the caption belongs to exactly one table, and the next one
 * either has its own or has none.
 */
function takeCaption(sink: ColumnSink, side: 'left' | 'right'): string {
  const caption = side === 'left' ? sink.captionLeft : sink.captionRight;
  if (side === 'left') sink.captionLeft = undefined;
  else sink.captionRight = undefined;
  return caption ? caption.html : '';
}

/**
 * Close the current table group: emit the table it assembled, then draw any
 * caption that never found a table to sit in -- a table whose rows all live on
 * the other column still has to show that its title was edited or deleted.
 * A caption that did not change is dropped with them: on that side it is not a
 * change, and inventing a rowless table to hold it is the empty-shell artifact
 * flushPartials already refuses to draw.
 */
function endTableGroup(sink: ColumnSink): void {
  flushPartials(sink);
  for (const side of ['left', 'right'] as const) {
    const caption = side === 'left' ? sink.captionLeft : sink.captionRight;
    if (side === 'left') sink.captionLeft = undefined;
    else sink.captionRight = undefined;
    if (!caption || !caption.changed) continue;
    (side === 'left' ? sink.left : sink.right).push(
      wrapInTable(caption.html, side === 'left' ? sink.tableClsLeft : sink.tableClsRight),
    );
  }
}

/**
 * `<tbody …>` / `</tbody>` (or `<tr …>` / `</tr>`) for a recursed fragment, taken from its own rendered
 * opening tag so the attributes the preview relies on (class, data-line,
 * data-dita-tagname) survive. Undefined when the html doesn't start with a
 * usable tag, in which case the cells go out ungrouped rather than behind a
 * fabricated row tag.
 */
function fragmentSkeleton(row: AlignedRow): { left?: [string, string]; right?: [string, string] } {
  const side = (b?: RenderedBlock): [string, string] | undefined => {
    if (!b || !RECURSABLE_TABLE_FRAGMENT.has(b.baseType || '')) return undefined;
    const name = /^<([a-zA-Z][^\s/>]*)/.exec(b.html);
    const end = firstTagEnd(b.html);
    if (!name || end < 0) return undefined;
    return [b.html.slice(0, end + 1), `</${name[1]}>`];
  };
  return { left: side(row.left), right: side(row.right) };
}

function flushPartials(sink: ColumnSink): void {
  // A side whose table lost every row to the other column still has buffered
  // pieces: the <colgroup> carry and the recursed containers' skeleton tags.
  // Those assemble into a rowless <table> shell, which reads as a real empty
  // table on that side of the diff -- with the wrong column widths, since the
  // colgroup came from the side that no longer has the table's content. Only
  // rows and cells count as content, so the buffer is dropped for an empty side.
  if (sink.pendingLeftContent > 0) {
    sink.left.push(wrapInTable(takeCaption(sink, 'left') + sink.pendingLeft.join(''), sink.tableClsLeft));
  }
  if (sink.pendingRightContent > 0) {
    sink.right.push(wrapInTable(takeCaption(sink, 'right') + sink.pendingRight.join(''), sink.tableClsRight));
  }
  sink.pendingLeft = [];
  sink.pendingRight = [];
  sink.pendingLeftContent = 0;
  sink.pendingRightContent = 0;
}

/**
 * `inner` is the assembled under-<table> markup; `tableCls` is the source
 * table's own class list (see ColumnSink.tableClsLeft), so the assembly is
 * styled by the same rules the preview applies to that table.
 */
function wrapInTable(inner: string, tableCls: string, cls = 'dv-block dv-block--table', idxAttr = ''): string {
  // The outer div keeps the assembly in the same box model as every other
  // block (padding, the stacked narrow layout) and carries the change marker;
  // the table itself reuses styles.css's existing table typography (borders,
  // th background, fixed layout) so a diff table looks like a preview table.
  return `<div class="${cls}"${idxAttr}><table class="${tableCls} dv-table">${inner}</table></div>`;
}

/** The class attribute of a rendered <table> element, if it has one. */
function tableClasses(html: string): string | undefined {
  const m = /^<[a-zA-Z][^>]*\sclass="([^"]*)"/.exec(html);
  return m ? m[1] : undefined;
}

/**
 * Add the change class and data-diff-idx to a fragment's FIRST opening tag
 * (`<tr …>`, `<thead …>`, `<colgroup>`), merging into an existing class
 * attribute rather than adding a second one (HTML keeps the first class= and
 * drops later ones -- see injectAttributes in renderer.ts for the same rule).
 *
 * The tag scan tracks quoted attribute values, so a `>` inside a quoted
 * attribute can't end the tag early -- the same quoting rule
 * scanHtmlSegments/applyInlineMarksToHtml uses. An html that doesn't start
 * with `<`, or with no closing `>` at all, falls back to a marked <span>
 * instead of fabricating or corrupting a tag.
 */
export function injectFragmentAttrs(html: string, cls: string, idxAttr: string): string {
  const end = firstTagEnd(html);
  if (html[0] !== '<' || end < 0) {
    return `<span class="${cls}"${idxAttr}>${html}</span>`;
  }

  let tag = html.slice(0, end);
  const selfClosing = tag.endsWith('/');
  // Drop the `/` (and the space that usually precedes it, so the attributes
  // appended below don't land on a double space) and re-add it at the end.
  if (selfClosing) tag = tag.slice(0, -1).replace(/\s+$/, '');

  const classMatch = /\sclass="([^"]*)"/.exec(tag);
  let withClass: string;
  if (classMatch) {
    withClass = tag.replace(/\sclass="[^"]*"/, ` class="${classMatch[1]} ${cls}"`);
  } else {
    const nameEnd = tag.search(/\s/);
    withClass = nameEnd === -1 ? `${tag} class="${cls}"` : `${tag.slice(0, nameEnd)} class="${cls}"${tag.slice(nameEnd)}`;
  }
  return `${withClass}${idxAttr}${selfClosing ? ' /' : ''}>${html.slice(end + 1)}`;
}

/** Index of the `>` that closes the first opening tag, or -1 if there is none. */
function firstTagEnd(html: string): number {
  return html[0] === '<' ? tagEndAt(html, 0) : -1;
}

/**
 * The same scan starting at `at`, which must be the index of a `<`. Returns the
 * index of the `>` that closes the tag, or -1 when the tag is never closed.
 * Quoted attribute values are skipped, so a `>` inside a title attribute (or
 * inside the inline-diff spans injected above) cannot end the tag early.
 */
function tagEndAt(html: string, at: number): number {
  let inQuote: string | null = null;
  for (let i = at + 1; i < html.length; i++) {
    const ch = html[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

function applyInlineDiff(html: string, row: AlignedRow, side: 'left' | 'right'): string {
  if (!row.inlineDiff || (row.changeType !== 'modified' && row.moveId === undefined)) return html;
  return applyInlineMarksToHtml(html, row.inlineDiff, side);
}

// Only <tgroup> synthesizes a leading <colgroup> (baseTypeMap.ts's
// 'topic/tgroup' renderer); the check is by baseType, not by "html starts with
// <colgroup>", so a table whose tgroup was itself not recursed can't double it.
function isColumnWidthCarrier(row: AlignedRow): boolean {
  if (row.left?.baseType === 'topic/tgroup') return true;
  return row.right?.baseType === 'topic/tgroup';
}

function colgroupPrefix(html: string): string | undefined {
  const m = /^<colgroup\b[^>]*>[\s\S]*?<\/colgroup>/.exec(html);
  return m ? m[0] : undefined;
}
