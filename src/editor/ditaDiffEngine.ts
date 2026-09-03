// Structural diff engine for DITA topics — pure functions, no vscode dependency.
// Compares two parsed topic trees at block level (paragraphs, sections, lists…)
// using LCS alignment, pairs wording-level changes as "modified", and injects
// word-level inline diff marks into rendered HTML.

import { DitaNode, DitaDocument } from '../parser/domTypes';
import { parseDita, preprocessEntities } from '../parser/ditaParser';
import { collectText, escapeHtml } from './ditaRenderUtils';
import { findTopLevelIndextermsInSubtree } from '../render/baseTypeMap';

// ── Public types ──

export type DiffChangeType = 'unchanged' | 'modified' | 'added' | 'removed';

export interface DiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
}

export interface RenderedBlock {
  key: string;
  baseType?: string;
  tagName?: string;
  html: string;
  text: string;
  sourceLine?: number;
  /**
   * The source node this block was built from. Recursing into a modified
   * container's own children (alignSectionChildren) used to re-find this
   * node by searching the tree for a child matching block.baseType + text
   * -- fragile once `text` stopped being raw source text (see makeBlock):
   * anything rendered from a node whose visible text doesn't equal its
   * literal source text (keyref/conref resolution, injected labels) would
   * never match anything during that search, silently breaking recursion
   * for exactly the blocks most likely to need it. Since every
   * RenderedBlock is built directly from a real node to begin with, just
   * keep the reference instead of trying to relocate it later.
   */
  node: DitaNode;
}

export interface AlignedRow {
  left?: RenderedBlock;
  right?: RenderedBlock;
  changeType: DiffChangeType;
  children?: AlignedRow[];
  /** Word-level diff between left.text and right.text, computed only for
   *  'modified' rows. Was read/written throughout this file and by
   *  ditaDiffProvider.ts without ever being declared here -- worked at
   *  runtime purely because JS doesn't enforce object shapes, but nothing
   *  was actually type-checking this file at all until it got added to
   *  tsconfig.test.json (see the note there), which is how this went
   *  unnoticed. */
  inlineDiff?: DiffPart[];
}

export interface TopicDiffResult {
  leftTitle?: string;
  rightTitle?: string;
  rows: AlignedRow[];
  stats: { added: number; removed: number; modified: number };
  errorLeft?: string;
  errorRight?: string;
}

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
]);

function isDiffableContainer(b: RenderedBlock): boolean {
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

function makeBlock(
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
    blocks.push(makeBlock(child, opts, parentBaseType, headingLevel));
  }
  return blocks;
}

export function extractTopicBlocks(root: DitaNode, opts: BlockExtractOptions): RenderedBlock[] {
  const blocks: RenderedBlock[] = [];
  const children = root.children || [];

  for (const child of children) {
    if (child.type !== 'element') continue;
    if (child.baseType === 'topic/title') {
      blocks.push(makeBlock(child, opts, 'topic', 1));
    } else if (child.baseType === 'topic/shortdesc') {
      blocks.push(makeBlock(child, opts, 'topic', 1));
    } else if (child.baseType === 'topic/prolog') {
      const block = makeProlgIndextermBlock(child, opts, 'topic', 1);
      if (block) blocks.push(block);
    }
  }

  const body = children.find((c) => c.type === 'element' && c.baseType === 'topic/body');
  if (body) {
    for (const child of body.children || []) {
      if (child.type !== 'element') continue;
      if (SKIP_BASETYPES.has(child.baseType || '')) continue;
      const hl = child.baseType === 'topic/section' || child.baseType === 'topic/example' ? 2 : 1;
      blocks.push(makeBlock(child, opts, 'topic/body', hl));
    }
  }

  return blocks;
}

// ── LCS alignment ──

interface LcsOp<T> {
  op: 'same' | 'removed' | 'added';
  left?: T;
  right?: T;
}

const LCS_CELL_LIMIT = 4_000_000;

export function lcsAlign<T>(
  a: T[],
  b: T[],
  equals: (x: T, y: T) => boolean,
  keyOf: (item: T) => string,
): LcsOp<T>[] {
  const m = a.length;
  const n = b.length;

  if (m * n > LCS_CELL_LIMIT) {
    return idOnlyAlign(a, b, equals, keyOf);
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (equals(a[i - 1], b[j - 1])) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const ops: LcsOp<T>[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && equals(a[i - 1], b[j - 1])) {
      ops.push({ op: 'same', left: a[i - 1], right: b[j - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ op: 'added', right: b[j - 1] });
      j--;
    } else {
      ops.push({ op: 'removed', left: a[i - 1] });
      i--;
    }
  }
  ops.reverse();
  return ops;
}

/**
 * O(n) fallback for when the full O(mn) DP table (above) would exceed
 * LCS_CELL_LIMIT -- matches items by an identity key instead of a full
 * alignment, so it's less precise about *where* an unmatched item sits
 * relative to others, but doesn't blow up memory on huge documents.
 *
 * Takes an explicit keyOf function rather than requiring T to structurally
 * have a .key field: lcsAlign is called with RenderedBlock[] (which does
 * have .key) AND with plain string[] token arrays from diffTokens (which
 * don't and can't reasonably be forced to) -- a `T extends { key: string }`
 * constraint on lcsAlign itself would reject that second, entirely
 * legitimate caller. This was actually broken by an earlier version of
 * this fix that added exactly that constraint without checking every call
 * site first; caught by actually running tsc against this file rather
 * than assuming a plausible-looking type change was correct.
 */
function idOnlyAlign<T>(
  a: T[],
  b: T[],
  equals: (x: T, y: T) => boolean,
  keyOf: (item: T) => string,
): LcsOp<T>[] {
  const bByKey = new Map<string, T>();
  for (const item of b) {
    bByKey.set(keyOf(item), item);
  }
  const ops: LcsOp<T>[] = [];
  const usedB = new Set<string>();

  for (const itemA of a) {
    const key = keyOf(itemA);
    const match = bByKey.get(key);
    if (match && !usedB.has(key) && equals(itemA, match)) {
      ops.push({ op: 'same', left: itemA, right: match });
      usedB.add(key);
      continue;
    }
    ops.push({ op: 'removed', left: itemA });
  }

  for (const itemB of b) {
    if (!usedB.has(keyOf(itemB))) {
      ops.push({ op: 'added', right: itemB });
    }
  }

  return ops;
}

// ── Similarity ──

// Similarity scoring reuses tokenizeForDiff's proper CJK/word/punctuation
// segmentation, not a naive whitespace split. Chinese (and other
// no-whitespace-between-words text) has essentially zero ASCII whitespace,
// so `s.split(/\s+/)` treated an ENTIRE Chinese sentence as a single
// indivisible "word" -- any two non-identical Chinese sentences (even a
// one-character edit) shared zero tokens, scored similarity 0, and were
// always classified as a full delete + a full insert instead of one
// "modified" row with word-level highlighting. Worse, since this same
// function decides whether a changed container's children are even
// examined (pairAdjacentChanges only recurses into 'modified' pairs), it
// silently defeated the container-recursion fix for any mostly-Chinese
// section/parml/list too -- the pair never got classified 'modified' in
// the first place, so recursion into it never even ran.
function tokenize(s: string): string[] {
  return tokenizeForDiff(s).filter((t) => !/^\s+$/.test(t));
}

function diceSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.length === 0 && tokensB.length === 0) return 1;
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const bagA = new Map<string, number>();
  for (const t of tokensA) bagA.set(t, (bagA.get(t) || 0) + 1);
  const bagB = new Map<string, number>();
  for (const t of tokensB) bagB.set(t, (bagB.get(t) || 0) + 1);

  let intersection = 0;
  for (const [t, countA] of bagA) {
    const countB = bagB.get(t) || 0;
    intersection += Math.min(countA, countB);
  }
  return (2 * intersection) / (tokensA.length + tokensB.length);
}

const SIMILARITY_THRESHOLD = 0.45;

// ── Pairing adjacent removed+added as "modified" ──

function pairAdjacentChanges<T extends RenderedBlock>(ops: LcsOp<T>[]): AlignedRow[] {
  const rows: AlignedRow[] = [];
  let idx = 0;

  while (idx < ops.length) {
    const op = ops[idx];

    if (op.op === 'same') {
      rows.push({ left: op.left, right: op.right, changeType: 'unchanged' });
      idx++;
      continue;
    }

    if (op.op === 'removed') {
      const removedRun: T[] = [];
      while (idx < ops.length && ops[idx].op === 'removed') {
        removedRun.push(ops[idx].left!);
        idx++;
      }
      const addedRun: T[] = [];
      while (idx < ops.length && ops[idx].op === 'added') {
        addedRun.push(ops[idx].right!);
        idx++;
      }

      const pairCount = Math.min(removedRun.length, addedRun.length);
      for (let p = 0; p < pairCount; p++) {
        const left = removedRun[p];
        const right = addedRun[p];
        if (
          left.baseType === right.baseType &&
          diceSimilarity(left.text, right.text) >= SIMILARITY_THRESHOLD
        ) {
          rows.push({ left, right, changeType: 'modified' });
        } else {
          rows.push({ left, changeType: 'removed' });
          rows.push({ right, changeType: 'added' });
        }
      }
      for (let p = pairCount; p < removedRun.length; p++) {
        rows.push({ left: removedRun[p], changeType: 'removed' });
      }
      for (let p = pairCount; p < addedRun.length; p++) {
        rows.push({ right: addedRun[p], changeType: 'added' });
      }
      continue;
    }

    if (op.op === 'added') {
      rows.push({ right: op.right, changeType: 'added' });
      idx++;
    }
  }

  return rows;
}

// ── Section recursion ──

function alignSectionChildren(
  leftParent: DitaNode,
  rightParent: DitaNode,
  leftOpts: BlockExtractOptions,
  rightOpts: BlockExtractOptions,
  headingLevel: number,
): AlignedRow[] {
  const leftBlocks = extractChildBlocks(leftParent, leftOpts, 'topic/section', headingLevel);
  const rightBlocks = extractChildBlocks(rightParent, rightOpts, 'topic/section', headingLevel);

  const ops = lcsAlign(leftBlocks, rightBlocks, (a, b) => a.key === b.key && a.text === b.text, (item) => item.key);
  const rows = pairAdjacentChanges(ops);

  for (const row of rows) {
    if (row.changeType === 'modified' && row.left && row.right) {
      row.inlineDiff = diffTokens(tokenizeForDiff(row.left.text), tokenizeForDiff(row.right.text));

      // Recurse for as many levels as the document actually nests diffable
      // containers (a <parml> inside a <section>, a <ul> inside a
      // <parml>...), not just one level below the topic body -- see
      // DIFFABLE_CONTAINER_TYPES above.
      if (
        isDiffableContainer(row.left) &&
        isDiffableContainer(row.right) &&
        row.left.baseType === row.right.baseType
      ) {
        row.children = alignSectionChildren(row.left.node, row.right.node, leftOpts, rightOpts, headingLevel);
      }
    }
  }

  return rows;
}

// ── Inline word-level diff ──

const CJK_RANGES = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/;

// Tokens must partition `text` exactly -- tokens.join('') === text always --
// with nothing dropped and nothing synthesized. This used to skip over
// whitespace entirely (discarding it) and let mergePart glue a single
// synthetic space after every token instead. That coincidentally
// round-tripped single-word-then-single-space runs, but broke the instant
// any punctuation touched a word with no space -- "Note:", "e.g.", "isn't",
// "well-known", or simply a period at the end of a sentence all came back
// with a spurious inserted space ("Note :", "isn ' t", "fox ."). Since
// applyInlineMarksToHtml requires its reconstructed text to exactly equal
// the rendered html's plain text (see makeBlock/htmlToPlainText), that
// spurious-space drift silently discarded the inline highlighting for
// almost any real sentence, leaving "modified" rows a flat, undifferentiated
// amber block with no visible red/green pinpointing which words actually
// changed.
export function tokenizeForDiff(text: string): string[] {
  const tokens: string[] = [];
  const chars = [...text];
  let i = 0;

  while (i < chars.length) {
    const ch = chars[i];
    if (/\s/.test(ch)) {
      let ws = '';
      while (i < chars.length && /\s/.test(chars[i])) {
        ws += chars[i];
        i++;
      }
      tokens.push(ws);
    } else if (CJK_RANGES.test(ch)) {
      tokens.push(ch);
      i++;
    } else if (/[a-zA-Z0-9\u00c0-\u024f]/.test(ch)) {
      let word = '';
      while (i < chars.length && /[a-zA-Z0-9\u00c0-\u024f]/.test(chars[i])) {
        word += chars[i];
        i++;
      }
      tokens.push(word);
    } else {
      tokens.push(ch);
      i++;
    }
  }
  return tokens;
}

const INLINE_TOKEN_CAP = 2000;

export function diffTokens(oldTokens: string[], newTokens: string[]): DiffPart[] {
  if (oldTokens.length > INLINE_TOKEN_CAP || newTokens.length > INLINE_TOKEN_CAP) {
    return [];
  }

  const ops = lcsAlign(oldTokens, newTokens, (a, b) => a === b, (item) => item);
  const parts: DiffPart[] = [];

  for (const op of ops) {
    if (op.op === 'same') {
      mergePart(parts, op.left!, false, false);
    } else if (op.op === 'removed') {
      mergePart(parts, op.left!, false, true);
    } else {
      mergePart(parts, op.right!, true, false);
    }
  }

  return parts;
}

// No synthetic separators -- tokens (including whitespace-run tokens) are
// concatenated verbatim, so the concatenation of a side's selected parts
// exactly reconstructs that side's original (post-normalizeText) text.
function mergePart(parts: DiffPart[], value: string, added: boolean, removed: boolean): void {
  const last = parts[parts.length - 1];
  if (last && last.added === added && last.removed === removed) {
    last.value += value;
  } else {
    parts.push({ value, added: added || undefined, removed: removed || undefined });
  }
}

// ── Inline mark injection into rendered HTML ──

const XML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};
const XML_ENTITY_RE = /&(?:amp|lt|gt|quot|apos);/g;

function unescapeXml(s: string): string {
  return s.replace(XML_ENTITY_RE, (m) => XML_ENTITY_MAP[m] || m);
}

interface HtmlSegment {
  kind: 'tag' | 'text';
  raw: string;
  decoded?: string;
}

function scanHtmlSegments(html: string): HtmlSegment[] {
  const segments: HtmlSegment[] = [];
  let i = 0;

  while (i < html.length) {
    if (html[i] === '<') {
      let end = i + 1;
      let inQuote: string | null = null;
      while (end < html.length) {
        const ch = html[end];
        if (inQuote) {
          if (ch === inQuote) inQuote = null;
        } else if (ch === '"' || ch === "'") {
          inQuote = ch;
        } else if (ch === '>') {
          break;
        }
        end++;
      }
      end = Math.min(end + 1, html.length);
      segments.push({ kind: 'tag', raw: html.slice(i, end) });
      i = end;
    } else {
      let end = html.indexOf('<', i);
      if (end === -1) end = html.length;
      const raw = html.slice(i, end);
      segments.push({ kind: 'text', raw, decoded: unescapeXml(raw) });
      i = end;
    }
  }
  return segments;
}

export function applyInlineMarksToHtml(
  html: string,
  parts: DiffPart[],
  side: 'left' | 'right',
): string {
  if (!parts.length) return html;

  const segments = scanHtmlSegments(html);
  const textSegments = segments.filter((s) => s.kind === 'text');
  const fullText = textSegments.map((s) => s.decoded || '').join('');

  const projection = parts
    .filter((p) => side === 'left' ? !p.added : !p.removed)
    .map((p) => p.value)
    .join('');

  if (normalizeText(projection) !== normalizeText(fullText)) {
    return html;
  }

  const className = side === 'left' ? 'diff-inline-del' : 'diff-inline-add';
  let offset = 0;
  const partIdx = { i: 0, charInPart: 0 };

  for (const seg of segments) {
    if (seg.kind !== 'text') continue;
    const segStart = offset;
    const segLen = (seg.decoded || '').length;
    const segEnd = segStart + segLen;

    const marks: Array<{ start: number; end: number }> = [];
    let pos = segStart;

    while (pos < segEnd && partIdx.i < parts.length) {
      const part = parts[partIdx.i];

      // A part not belonging to this side (removed, when rendering the
      // right side; added, when rendering the left) contributes NOTHING to
      // this side's text -- it must be skipped over entirely, not treated
      // as consuming characters from the segment. It previously fell
      // through to the same span-consuming code below as every other part,
      // silently shifting every mark position after it by that part's
      // length (or, if the removed/added part was long enough, consuming
      // the rest of the segment outright and leaving NO marks at all):
      // e.g. diffing "...before continuing." -> "...before proceeding."
      // correctly identified "continuing" as removed and "proceeding" as
      // added, but rendering the right side walked past "continuing" as if
      // those characters existed in the right html too, desyncing every
      // position after it.
      const belongsToSide = side === 'left' ? !part.added : !part.removed;
      if (!belongsToSide) {
        partIdx.i++;
        partIdx.charInPart = 0;
        continue;
      }

      const isHighlight = side === 'left' ? part.removed : part.added;
      const partLen = part.value.length;
      const remainingInPart = partLen - partIdx.charInPart;
      const remainingInSeg = segEnd - pos;
      const span = Math.min(remainingInPart, remainingInSeg);

      if (isHighlight) {
        if (marks.length > 0 && marks[marks.length - 1].end === pos) {
          marks[marks.length - 1].end = pos + span;
        } else {
          marks.push({ start: pos, end: pos + span });
        }
      }

      pos += span;
      partIdx.charInPart += span;
      if (partIdx.charInPart >= partLen) {
        partIdx.i++;
        partIdx.charInPart = 0;
      }
    }

    if (marks.length > 0) {
      const decoded = seg.decoded!;
      let newRaw = '';
      let cursor = 0;
      for (const mark of marks) {
        const mStart = mark.start - segStart;
        const mEnd = mark.end - segStart;
        newRaw += decoded.slice(cursor, mStart);
        newRaw += `<span class="${className}">${escapeHtml(decoded.slice(mStart, mEnd))}</span>`;
        cursor = mEnd;
      }
      newRaw += decoded.slice(cursor);
      seg.raw = newRaw;
    }

    offset = segEnd;
  }

  return segments.map((s) => s.raw).join('');
}

// ── Swap helper ──

export function swapAlignedRows(rows: AlignedRow[]): AlignedRow[] {
  return rows.map((row) => {
    const swapped: AlignedRow = {
      left: row.right,
      right: row.left,
      changeType: row.changeType === 'added' ? 'removed'
        : row.changeType === 'removed' ? 'added'
        : row.changeType,
    };
    if (row.children) {
      swapped.children = swapAlignedRows(row.children);
    }
    if (swapped.left && swapped.right && row.changeType === 'modified') {
      swapped.inlineDiff = row.inlineDiff?.map((p) => ({
        value: p.value,
        added: p.removed,
        removed: p.added,
      }));
    }
    return swapped;
  });
}

// ── Recency-based left/right placement ──

/**
 * Arranges two resolved versions so the older one is always `left` and the
 * newer one is always `right`, regardless of which one the caller picked
 * first. `order` is a recency rank where lower = newer (e.g. -1 for the
 * ever-current "Working copy", 0/1/2... for commits by how far back they
 * are in `git log`).
 *
 * ditaDiffProvider.ts's "Compare with Git Version" flow used to place
 * whichever version the user picked *first* on the left and the second on
 * the right, on the assumption the first QuickPick ("base (older)
 * version") would naturally be the older one. In practice Working copy is
 * both the newest version and the most natural first pick (it's the file
 * already open), so picking it first put the newest content on the left
 * and an older commit on the right -- backwards from the original/modified
 * convention every other diff view (VS Code's own included) uses. This
 * removes that dependency on pick order entirely.
 */
export function arrangeByRecency<T extends { order: number }>(a: T, b: T): { left: T; right: T } {
  return a.order >= b.order ? { left: a, right: b } : { left: b, right: a };
}

// ── Top-level entry ──

export interface DiffTopicsInput {
  leftXml: string;
  rightXml: string;
  leftDocDir: string;
  rightDocDir: string;
  /**
   * Factory rather than a single pre-built function: note-label (and any
   * other document-language-derived) resolution needs the actual parsed
   * root of EACH side, and left/right can in principle come from different
   * directories (leftDocDir/rightDocDir are already separate fields) or --
   * across git history -- have different xml:lang declarations. Building
   * one renderBlock closure up front, before either side is parsed, was
   * the root cause of a real crash here previously: there was no parsed
   * root yet at that point, so note-label detection was passed a fake
   * placeholder root and threw. Calling the factory once per side, after
   * parsing, with that side's own root and docDir removes the possibility
   * of that class of bug rather than just patching the one symptom.
   */
  renderBlockFactory: (root: DitaNode, docDir: string) => (node: DitaNode, parentBaseType: string, headingLevel: number) => string;
}

export function diffTopics(input: DiffTopicsInput): TopicDiffResult {
  const { leftXml, rightXml, leftDocDir, rightDocDir, renderBlockFactory } = input;

  let leftDoc: DitaDocument | undefined;
  let rightDoc: DitaDocument | undefined;
  let errorLeft: string | undefined;
  let errorRight: string | undefined;

  try {
    leftDoc = parseDita(preprocessEntities(leftXml));
  } catch (err) {
    errorLeft = err instanceof Error ? err.message : String(err);
  }

  try {
    rightDoc = parseDita(preprocessEntities(rightXml));
  } catch (err) {
    errorRight = err instanceof Error ? err.message : String(err);
  }

  if (!leftDoc && !rightDoc) {
    return { rows: [], stats: { added: 0, removed: 0, modified: 0 }, errorLeft, errorRight };
  }

  if (!leftDoc) {
    const renderBlock = renderBlockFactory(rightDoc!.root, rightDocDir);
    const rightBlocks = extractTopicBlocks(rightDoc!.root, { renderBlock });
    return {
      rightTitle: extractTitle(rightDoc!),
      rows: rightBlocks.map((b) => ({ right: b, changeType: 'added' as const })),
      stats: { added: rightBlocks.length, removed: 0, modified: 0 },
      errorLeft,
    };
  }

  if (!rightDoc) {
    const renderBlock = renderBlockFactory(leftDoc.root, leftDocDir);
    const leftBlocks = extractTopicBlocks(leftDoc.root, { renderBlock });
    return {
      leftTitle: extractTitle(leftDoc),
      rows: leftBlocks.map((b) => ({ left: b, changeType: 'removed' as const })),
      stats: { added: 0, removed: leftBlocks.length, modified: 0 },
      errorRight,
    };
  }

  const leftRenderBlock = renderBlockFactory(leftDoc.root, leftDocDir);
  const rightRenderBlock = renderBlockFactory(rightDoc.root, rightDocDir);
  const leftBlocks = extractTopicBlocks(leftDoc.root, { renderBlock: leftRenderBlock });
  const rightBlocks = extractTopicBlocks(rightDoc.root, { renderBlock: rightRenderBlock });

  const equals = (a: RenderedBlock, b: RenderedBlock) =>
    a.key === b.key && a.text === b.text;
  const ops = lcsAlign(leftBlocks, rightBlocks, equals, (item) => item.key);
  const rows = pairAdjacentChanges(ops);

  for (const row of rows) {
    if (row.changeType === 'modified' && row.left && row.right) {
      row.inlineDiff = diffTokens(tokenizeForDiff(row.left.text), tokenizeForDiff(row.right.text));

      if (
        isDiffableContainer(row.left) &&
        isDiffableContainer(row.right) &&
        row.left.baseType === row.right.baseType
      ) {
        row.children = alignSectionChildren(
          row.left.node,
          row.right.node,
          { renderBlock: leftRenderBlock },
          { renderBlock: rightRenderBlock },
          2,
        );
      }
    }
  }

  const stats = { added: 0, removed: 0, modified: 0 };
  countStats(rows, stats);

  return {
    leftTitle: extractTitle(leftDoc),
    rightTitle: extractTitle(rightDoc),
    rows,
    stats,
  };
}

function extractTitle(doc: DitaDocument): string | undefined {
  const titleNode = (doc.root.children || []).find(
    (c) => c.type === 'element' && c.baseType === 'topic/title',
  );
  return titleNode ? collectText(titleNode) : undefined;
}

function countStats(rows: AlignedRow[], stats: { added: number; removed: number; modified: number }): void {
  for (const row of rows) {
    if (row.changeType === 'added') stats.added++;
    else if (row.changeType === 'removed') stats.removed++;
    else if (row.changeType === 'modified') stats.modified++;
    if (row.children) countStats(row.children, stats);
  }
}

// ── Quick commit-choice descriptors (for the "Compare with Git Version"
// QuickPick's built-in shortcuts) ──

/** Minimal shape this needs from a commit -- matches ditaGitUtils.ts's
 *  GitCommitInfo without importing that file's vscode-touching runtime
 *  code, just its data shape. */
export interface CommitLike {
  hash: string;
  shortHash: string;
  subject: string;
}

export interface QuickCommitChoice {
  /** Full hash to actually fetch file content at (git show <hash>:path). */
  refHash: string;
  /** Short hash, for compact display. */
  shortHash: string;
  /** Commit subject line, for display. */
  subject: string;
}

/**
 * Builds the "last commit to this file" / "previous commit to this file"
 * shortcut descriptors from a file's own commit history.
 *
 * Regression this guards: an earlier version labeled these shortcuts
 * "HEAD" / "HEAD~1" using commits[0]/commits[1] (this FILE's own most
 * recent modifying commits) for the LABEL, but fetched content using the
 * literal git refs 'HEAD' / 'HEAD~1' (the repository's overall most
 * recent commits, regardless of whether they touched this file at all).
 * Those only coincide when this file happened to be touched in the
 * single most recent commit to the whole repo -- otherwise the label and
 * the actual diffed content silently disagreed, which is exactly the
 * kind of thing that looks like "the diff doesn't seem right" without an
 * obvious cause. This function's job is narrow: given this file's own
 * commit list, return descriptors whose refHash is the SAME commit the
 * label describes, so there's no way for the two to drift apart again.
 */
export function buildQuickCommitChoices(commits: CommitLike[]): QuickCommitChoice[] {
  const choices: QuickCommitChoice[] = [];
  if (commits.length > 0) {
    choices.push({ refHash: commits[0].hash, shortHash: commits[0].shortHash, subject: commits[0].subject });
  }
  if (commits.length > 1) {
    choices.push({ refHash: commits[1].hash, shortHash: commits[1].shortHash, subject: commits[1].subject });
  }
  return choices;
}
