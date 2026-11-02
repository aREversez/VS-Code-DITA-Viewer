// Turns a parsed topic into the flat list of rendered blocks that get aligned and compared.
// Split out of ditaDiffEngine.ts; a pure function module, no vscode dependency.

import {
  DitaNode,
  findTopLevelIndextermsInSubtree,
} from '@dita-viewer/core';
import { scanHtmlSegments } from './diffInlineMarks';
import { RenderedBlock } from './diffTypes';

// ── Block extraction ──

export interface BlockExtractOptions {
  renderBlock: (node: DitaNode, parentBaseType: string, headingLevel: number) => string;
}

const SKIP_BASETYPES = new Set(['topic/prolog', 'topic/title', 'topic/shortdesc']);

// Container types whose children get diffed individually (LCS + recursion)
// rather than the container being treated as one opaque block. Previously
// only topic/section and topic/example recursed this way -- a <parml> or
// <ul> with 20 children and one real edit was compared as a single block,
// so its whole (mostly-unchanged) text just squeaked over the
// SIMILARITY_THRESHOLD and the entire container rendered as one big
// "modified" row instead of 19 unchanged rows + 1 modified row.
const DIFFABLE_CONTAINER_TYPES = new Set([
  'topic/section',
  'topic/example',
  'topic/parml',
  'topic/ul',
  'topic/ol',
  'topic/sl',
  'topic/simpletable',
  'topic/table',
  'topic/tgroup',
  'topic/thead',
  'topic/tbody',
  'topic/row',
  // <simpletable>'s own row element generalizes to 'topic/strow', NOT
  // 'topic/row' (that's CALS <table>'s row type) -- simpletable itself was
  // added here so a single-cell edit no longer marked the whole table
  // "modified", but without its row type also listed, recursion stopped
  // one level too early: extractChildBlocks turns each <strow> into its
  // own block, but isDiffableContainer returned false for it, so a row
  // that scored high enough on diceSimilarity to pair as "modified" against
  // its counterpart was never itself recursed into -- every cell in that
  // row rendered as one flat amber block instead of pinpointing the one
  // <stentry> that actually changed.
  //
  // Recursion down to <row>/<entry> therefore STAYS. The bug was never that
  // the diff went too deep -- it was that the two-column renderer emitted the
  // leaves it got as `<div class="dv-block"><td …>12 Nm</td></div>`. A <td>
  // outside a table is foster-parented away by the HTML parser, so a recursed
  // table reached the panel as bare unsegmented text (measured against the
  // real renderer and a spec-compliant parser: 0 <table>, 0 <tr>, 0 <td>
  // survived, and two adjacent cells with no separator read as "Pressure3
  // bar"). ditaDiffRender.ts now gathers those fragments and re-assembles
  // them inside one real <table> per source table, which is what makes
  // cell-level granularity renderable again.
  'topic/strow',
  // Definition lists had the same coarse-grain problem a <ul>/<ol> used to:
  // a <dl> holding several <dlentry>s was compared as one opaque block, so
  // two edits landing in far-apart entries collapsed into a single
  // "modified" row -- one giant marker plus one connector drawn across the
  // whole screen instead of one per change. Recursing <dl> into its entries
  // (and each <dlentry> into its <dt>/<dd>) lets a distant pair of edits
  // split into independent data-diff-idx blocks, each with its own short
  // connector. Unlike <li>/<note>/<fig>, these wrappers carry no visible
  // bullet/number or "Note:" chrome that recursion would drop, so decomposing
  // them loses nothing a reader relies on.
  'topic/dl',
  'topic/dlentry',
]);

export function isDiffableContainer(b: RenderedBlock): boolean {
  return !!b.baseType && DIFFABLE_CONTAINER_TYPES.has(b.baseType);
}

function blockKey(node: DitaNode, text: string): string {
  const id = node.attributes?.id;
  if (id) return `id:${id}`;
  return `fp:${node.baseType || node.tagName || ''}:${simpleHash(text)}`;
}

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

export function normalizeText(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

// Diff text must come from the SAME rendered HTML that's actually shown,
// not from the raw source node (as collectText does) -- see makeBlock.
function htmlToPlainText(html: string): string {
  return scanHtmlSegments(html)
    .filter((s) => s.kind === 'text')
    .map((s) => s.decoded || '')
    .join('');
}

export function makeBlock(
  node: DitaNode,
  opts: BlockExtractOptions,
  parentBaseType: string,
  headingLevel: number,
): RenderedBlock {
  const html = opts.renderBlock(node, parentBaseType, headingLevel);
  // Derived from the rendered `html`, not collectText(node) on the raw
  // source. Rendering can add or substitute visible text that isn't in the
  // source node itself: keyref/conref resolution fills in content the
  // source element doesn't literally contain, note/section-type labels get
  // injected ("Note: ", localized equivalents, etc.), footnote markers are
  // added, and so on. When `text` came from raw source, any of these made
  // it diverge from the plain text `html` actually renders. That mismatch
  // silently broke word-level highlighting: applyInlineMarksToHtml
  // requires its reconstructed text to exactly equal the html's plain
  // text, and bails out -- with no highlighting at all, not even an
  // approximation -- the moment they disagree. In real documents (notes,
  // keyword/keyref use, cross-references) that was common enough that
  // most "modified" rows rendered as a flat, undifferentiated amber block
  // instead of pinpointing the actual changed words in red/green.
  // Deriving text from html instead guarantees the two always agree by
  // construction.
  const text = normalizeText(htmlToPlainText(html));
  return {
    key: blockKey(node, text),
    baseType: node.baseType,
    tagName: node.tagName,
    html,
    text,
    sourceLine: node.sourceRange?.startLine,
    node,
  };
}

// <prolog> is otherwise fully skipped (SKIP_BASETYPES) since almost all of
// it -- author, critdates, permissions -- is non-visible bookkeeping that
// shouldn't ever show up in a rendered diff. But topic/prolog's own
// renderer (baseTypeMap.ts) carves out one exception: indexterm entries
// nested under <prolog><metadata><keywords> DO render, as chips. This diff
// engine's skip-list was never updated to match that exception, so an
// indexterm added there had nothing to extract into a block and silently
// never appeared in the diff. `idxNodes` is only used as a cheap existence
// check (skip building a block at all when there's nothing to show);
// text/key come from the rendered chip html itself (see makeBlock's
// htmlToPlainText for why), not from collectText over the source
// indexterm nodes, so an unrelated prolog edit -- e.g. author name --
// doesn't make this block spuriously look "modified" when the
// actually-rendered chip content hasn't changed.
function makeProlgIndextermBlock(
  node: DitaNode,
  opts: BlockExtractOptions,
  parentBaseType: string,
  headingLevel: number,
): RenderedBlock | undefined {
  const idxNodes = findTopLevelIndextermsInSubtree(node);
  if (idxNodes.length === 0) return undefined;
  const html = opts.renderBlock(node, parentBaseType, headingLevel);
  const text = normalizeText(htmlToPlainText(html));
  return {
    key: `fp:topic/prolog-indexterm:${simpleHash(text)}`,
    baseType: node.baseType,
    tagName: node.tagName,
    html,
    text,
    sourceLine: node.sourceRange?.startLine,
    node,
  };
}

export function extractChildBlocks(
  scope: DitaNode,
  opts: BlockExtractOptions,
  parentBaseType: string,
  headingLevel: number,
): RenderedBlock[] {
  const blocks: RenderedBlock[] = [];
  for (const child of scope.children || []) {
    if (child.type !== 'element') continue;
    if (SKIP_BASETYPES.has(child.baseType || '')) continue;
    pushBlock(blocks, child, opts, parentBaseType, headingLevel);
  }
  return blocks;
}

/**
 * makeBlock, plus the one filter both extraction paths need: an element whose
 * renderer emits NOTHING is not a block. Several do by design --
 * topic/colspec ('') feeds the tgroup's <colgroup> rather than rendering
 * itself, and area/shape/coords, the index-* keywords, param, publisher,
 * metadata and friends are authoring-only. As blocks each produced an empty
 * `<div class="dv-block">`: a visible ~40px gap in the column, one per
 * colspec, so a 4-column table grew 4 phantom rows. The same applies to any
 * element that renders empty for another reason (a conditions-filtered
 * subtree). No pixels, no block.
 */
function pushBlock(
  blocks: RenderedBlock[],
  child: DitaNode,
  opts: BlockExtractOptions,
  parentBaseType: string,
  headingLevel: number,
): void {
  const block = makeBlock(child, opts, parentBaseType, headingLevel);
  if (block.html.trim() === '') return;
  blocks.push(block);
}

export function extractTopicBlocks(root: DitaNode, opts: BlockExtractOptions): RenderedBlock[] {
  const blocks: RenderedBlock[] = [];
  const children = root.children || [];

  for (const child of children) {
    if (child.type !== 'element') continue;
    if (child.baseType === 'topic/title') {
      pushBlock(blocks, child, opts, 'topic', 1);
    } else if (child.baseType === 'topic/shortdesc') {
      pushBlock(blocks, child, opts, 'topic', 1);
    } else if (child.baseType === 'topic/prolog') {
      const block = makeProlgIndextermBlock(child, opts, 'topic', 1);
      // Same filter as pushBlock: an indexterm subtree that renders nothing
      // (entries with no text content) would otherwise be a ghost row.
      if (block && block.html.trim() !== '') blocks.push(block);
    }
  }

  const body = children.find((c) => c.type === 'element' && c.baseType === 'topic/body');
  if (body) {
    for (const child of body.children || []) {
      if (child.type !== 'element') continue;
      if (SKIP_BASETYPES.has(child.baseType || '')) continue;
      const hl = child.baseType === 'topic/section' || child.baseType === 'topic/example' ? 2 : 1;
      pushBlock(blocks, child, opts, 'topic/body', hl);
    }
  }

  return blocks;
}
