// Aligns a run of changed blocks: scored pairing, moved blocks, and recursion into containers.
// Split out of ditaDiffEngine.ts; a pure function module, no vscode dependency.

import {
  DitaNode,
} from '@dita-viewer/core';
import { BlockExtractOptions, extractChildBlocks, isDiffableContainer, makeBlock } from './diffBlocks';
import { LcsOp, increasingPairs, lcsAlign } from './diffLcs';
import { applyInline, charBigrams, computeInline, tokenize } from './diffSimilarity';
import { AlignedRow, RenderedBlock } from './diffTypes';

// ── Aligning one change run ──
//
// A "change run" is a maximal stretch of removed blocks followed by added
// blocks (the LCS found no exact match for any of them). Pairing them purely
// by position was fine for a one-for-one edit but collapsed on big diffs: one
// inserted or deleted block shifted every later pair by one, so each old block
// was drawn against the NEXT new block -- a cascade of wrong connectors that
// read as a total rewrite. Instead the run is aligned with a small
// order-preserving dynamic program that maximizes total pair score, where a
// pair is only possible between blocks of the same baseType.
//
//   score = PAIR_BASE + text similarity (+ ID_BONUS for an identical id: key)
//
// PAIR_BASE is positive on purpose: a same-type pair always beats leaving both
// sides unmatched, so a cross-lingual rewrite (similarity ~0 everywhere) still
// pairs one-for-one in order, exactly as before; similarity only decides WHICH
// blocks pair when the two sides have different shapes.

const PAIR_BASE = 0.3;
const ID_BONUS = 2;
const REF_BONUS = 0.5;
// Above this many (removed x added) cells the full scored table is replaced by a
// band around the diagonal (scoredMatch), or by alignChangeRunByAnchors when even
// the band would be too narrow to be useful. The per-cell cost is not the table itself but
// pairScore's bag-dice over two token/gram bags (~6us/cell for real paragraphs,
// measured), so 250k cells meant a multi-second synchronous stall in the
// extension host. Dropping the ceiling only shrinks how often scoring runs; it
// no longer costs correctness, because the fallback below still pairs by id.
const PAIR_DP_CELL_LIMIT = 40_000;

interface PairFeat {
  tokens: Map<string, number>;
  nTokens: number;
  grams: Map<string, number>;
  nGrams: number;
  /** href / keyref / conref targets inside the block. Unlike the prose they
   *  survive a rewrite or a translation, and the visible text never shows them,
   *  so the dice scores cannot see them at all. Lowercased. */
  refs: Set<string>;
}

const REF_ATTRS = ['href', 'keyref', 'conref', 'conkeyref'];
const REF_WALK_CAP = 400;

function collectRefs(node: DitaNode): Set<string> {
  const refs = new Set<string>();
  let seen = 0;
  const walk = (n: DitaNode): void => {
    if (seen++ > REF_WALK_CAP) return;
    if (n.type === 'element') {
      for (const attr of REF_ATTRS) {
        const v = n.attributes?.[attr];
        if (v) refs.add(v.trim().toLowerCase());
      }
    }
    for (const c of n.children || []) walk(c);
  };
  walk(node);
  return refs;
}

function countShared(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const v of a) if (b.has(v)) n++;
  return n;
}

function bagOf(items: string[]): Map<string, number> {
  const bag = new Map<string, number>();
  for (const it of items) bag.set(it, (bag.get(it) || 0) + 1);
  return bag;
}

function pairFeat(block: RenderedBlock): PairFeat {
  const tokens = tokenize(block.text);
  const grams = charBigrams(block.text);
  return {
    tokens: bagOf(tokens),
    nTokens: tokens.length,
    grams: bagOf(grams),
    nGrams: grams.length,
    refs: collectRefs(block.node),
  };
}

function bagDice(a: Map<string, number>, nA: number, b: Map<string, number>, nB: number): number {
  if (nA === 0 && nB === 0) return 1;
  if (nA === 0 || nB === 0) return 0;
  let inter = 0;
  for (const [k, ca] of a) inter += Math.min(ca, b.get(k) || 0);
  return (2 * inter) / (nA + nB);
}

function pairScore(
  left: RenderedBlock,
  right: RenderedBlock,
  lf: PairFeat,
  rf: PairFeat,
): number | undefined {
  if (left.baseType !== right.baseType) return undefined;
  const sim = Math.max(
    bagDice(lf.tokens, lf.nTokens, rf.tokens, rf.nTokens),
    bagDice(lf.grams, lf.nGrams, rf.grams, rf.nGrams),
  );
  const sameId = left.key === right.key && left.key.startsWith('id:');
  const sharedRef = countShared(lf.refs, rf.refs) > 0;
  return PAIR_BASE + sim + (sharedRef ? REF_BONUS : 0) + (sameId ? ID_BONUS : 0);
}

/**
 * Fallback pairing for a run too large for the scored DP.
 *
 * The version this replaces paired purely by index (`removedRun[p]` with
 * `addedRun[p]` when the baseTypes matched). That reintroduces exactly the
 * failure the DP above exists to fix: one inserted or deleted block inside a
 * big rewritten run shifts EVERY later index pair by one, so each old block is
 * drawn against its neighbour's replacement -- hundreds of wrong connectors
 * (measured: 299 of 600 pairs wrong for 600 paragraphs + 1 insertion).
 *
 * Identity is what actually survives a large rewrite, so this pass pairs by
 * `id:` key first, in document order, then falls back to index only for the
 * blocks that have no id to offer. A stable id is a declaration that two
 * blocks are the same element, so it needs no DP to find it -- this is both
 * cheaper (O(k+m) plus a LIS over the matches) and right more often than the
 * scored table on the "every paragraph was touched" documents that trip the
 * limit in the first place. Unpaired blocks are emitted by position around the
 * anchors, which keeps the old behaviour for id-less documents.
 */
function alignChangeRunByAnchors<T extends RenderedBlock>(removedRun: T[], addedRun: T[]): number[] {
  const k = removedRun.length;
  const m = addedRun.length;
  const match = new Array<number>(k).fill(-1);

  const addedById = new Map<string, number[]>();
  addedRun.forEach((b, j) => {
    if (!b.key.startsWith('id:')) return;
    const list = addedById.get(b.key);
    if (list) list.push(j);
    else addedById.set(b.key, [j]);
  });
  const idMatches: Array<[number, number]> = [];
  for (let i = 0; i < k; i++) {
    const b = removedRun[i];
    if (!b.key.startsWith('id:') || !b.baseType) continue;
    const list = addedById.get(b.key);
    if (!list) continue;
    // Same id implies the same element, so its baseType is the same by
    // construction -- checked anyway to mirror what pairScore requires.
    const at = list.findIndex((j) => addedRun[j].baseType === b.baseType);
    if (at !== -1) idMatches.push([i, list[at]]);
  }
  // Only keep order-preserving matches; a block whose id appears out of order
  // has genuinely moved, which markMoves handles, not pairing.
  const anchors = increasingPairs(idMatches);
  for (const [i, j] of anchors) match[i] = j;

  // Whatever the anchors left unmatched pairs by position -- but only WITHIN
  // the gap between two neighbouring anchors, on both sides at once. Pairing
  // leftovers globally by index would put a j outside its i's bracket (or reuse
  // one an anchor already holds), and alignChangeRun emits rows assuming
  // `match` is strictly increasing: a non-monotonic match re-emits an
  // already-consumed added block as a duplicate row.
  const usedJ = new Set<number>(anchors.map(([, j]) => j));
  const pairGap = (iLo: number, iHi: number, jLo: number, jHi: number): void => {
    const li: number[] = [];
    const rj: number[] = [];
    for (let i = iLo; i < iHi; i++) if (match[i] < 0) li.push(i);
    for (let j = jLo; j < jHi; j++) if (!usedJ.has(j)) rj.push(j);
    for (let p = 0; p < Math.min(li.length, rj.length); p++) {
      if (removedRun[li[p]].baseType === addedRun[rj[p]].baseType) {
        match[li[p]] = rj[p];
        usedJ.add(rj[p]);
      }
    }
  };
  let pi = -1;
  let pj = -1;
  for (const [i, j] of anchors) {
    pairGap(pi + 1, i, pj + 1, j);
    pi = i;
    pj = j;
  }
  pairGap(pi + 1, k, pj + 1, m);
  return match;
}

// Narrowest half-width worth scoring. Below this the band could not follow even
// a handful of insertions, so the id-anchor fallback is the better tool.
const PAIR_MIN_HALF_BAND = 8;

/**
 * The scored, order-preserving alignment of one change run, optionally
 * restricted to a band around the run's diagonal.
 *
 * A run too big for the full (k x m) table used to drop to alignChangeRunByAnchors,
 * which pairs by id and otherwise by index -- and DITA paragraphs mostly have no
 * id, so the "every paragraph touched + one insertion" document (the case the DP
 * exists for) came back as a cascade of wrong pairs again (measured: 150 of 300).
 * An insertion or deletion only moves the true alignment a little off the
 * diagonal, so scoring just the cells within `halfBand` of the line j = i*m/k
 * finds it at the cost of k*(2*halfBand+1) cells instead of k*m.
 *
 * Cells outside the band are unreachable (-Infinity); row/column 0 are the
 * free-gap boundary, as in the full table.
 */
function scoredMatch<T extends RenderedBlock>(removedRun: T[], addedRun: T[], halfBand: number): number[] {
  const k = removedRun.length;
  const m = addedRun.length;
  const match = new Array<number>(k).fill(-1);
  const lf = removedRun.map((b) => pairFeat(b));
  const rf = addedRun.map((b) => pairFeat(b));

  const lo = new Int32Array(k + 1);
  const hi = new Int32Array(k + 1);
  const base = new Int32Array(k + 2);
  for (let i = 1; i <= k; i++) {
    const c = Math.round((i * m) / k);
    lo[i] = Math.max(1, c - halfBand);
    hi[i] = Math.min(m, c + halfBand);
    base[i + 1] = base[i] + Math.max(0, hi[i] - lo[i] + 1);
  }
  const dp = new Float64Array(base[k + 1]);
  const get = (i: number, j: number): number => {
    if (i === 0 || j === 0) return 0;
    if (j < lo[i] || j > hi[i]) return -Infinity;
    return dp[base[i] + j - lo[i]];
  };

  for (let i = 1; i <= k; i++) {
    for (let j = lo[i]; j <= hi[i]; j++) {
      let best = Math.max(get(i - 1, j), get(i, j - 1));
      const sc = pairScore(removedRun[i - 1], addedRun[j - 1], lf[i - 1], rf[j - 1]);
      if (sc !== undefined) best = Math.max(best, get(i - 1, j - 1) + sc);
      dp[base[i] + j - lo[i]] = best;
    }
  }
  let i = k;
  let j = m;
  while (i > 0 && j > 0) {
    const sc = pairScore(removedRun[i - 1], addedRun[j - 1], lf[i - 1], rf[j - 1]);
    const here = get(i, j);
    // Prefer the diagonal on ties so equal-shape runs keep pairing in order.
    if (sc !== undefined && here === get(i - 1, j - 1) + sc) {
      match[i - 1] = j - 1;
      i--;
      j--;
    } else if (here === get(i - 1, j)) {
      i--;
    } else {
      j--;
    }
  }
  return match;
}

function alignChangeRun<T extends RenderedBlock>(removedRun: T[], addedRun: T[]): AlignedRow[] {
  const k = removedRun.length;
  const m = addedRun.length;
  // match[i] = index in addedRun that removedRun[i] pairs with, or -1.
  let match: number[];

  if (k * m <= PAIR_DP_CELL_LIMIT) {
    match = scoredMatch(removedRun, addedRun, m);
  } else {
    const halfBand = Math.floor((PAIR_DP_CELL_LIMIT / k - 1) / 2);
    match =
      halfBand >= PAIR_MIN_HALF_BAND
        ? scoredMatch(removedRun, addedRun, halfBand)
        : alignChangeRunByAnchors(removedRun, addedRun);
  }

  const rows: AlignedRow[] = [];
  let nextAdded = 0;
  const flushAddedUpTo = (limit: number): void => {
    while (nextAdded < limit) rows.push({ right: addedRun[nextAdded++], changeType: 'added' });
  };
  for (let i = 0; i < k; i++) {
    if (match[i] < 0) {
      rows.push({ left: removedRun[i], changeType: 'removed' });
      continue;
    }
    flushAddedUpTo(match[i]);
    rows.push({ left: removedRun[i], right: addedRun[match[i]], changeType: 'modified' });
    nextAdded = match[i] + 1;
  }
  flushAddedUpTo(m);
  return rows;
}

// ── Pairing adjacent removed+added within a change run ──

export function pairAdjacentChanges<T extends RenderedBlock>(ops: LcsOp<T>[]): AlignedRow[] {
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

      for (const row of alignChangeRun(removedRun, addedRun)) rows.push(row);
      continue;
    }

    if (op.op === 'added') {
      rows.push({ right: op.right, changeType: 'added' });
      idx++;
    }
  }

  return markMoves(rows);
}

// ── Moved blocks ──
//
// A block that moved shows up as a removed row at its old position and an added
// row at its new one -- two unrelated-looking changes, two navigation stops,
// and a gutter stub each. Pair them up and give both rows one moveId so the
// renderer joins them with a single connector.
//
// Two ways to be "the same block": byte-identical rendered HTML under the same
// key, or the same explicit id (unique among the unpaired rows of this level)
// with edited content -- moved AND edited, which gets a word-level diff too.

let nextMoveId = 1;

function markMoves(rows: AlignedRow[]): AlignedRow[] {
  const removedRows = rows.filter((r) => r.changeType === 'removed' && r.left);
  const addedRows = rows.filter((r) => r.changeType === 'added' && r.right);
  if (removedRows.length === 0 || addedRows.length === 0) return rows;

  const link = (from: AlignedRow, to: AlignedRow): void => {
    const id = nextMoveId++;
    from.moveId = id;
    to.moveId = id;
  };

  const exact = new Map<string, AlignedRow[]>();
  for (const r of addedRows) {
    const k = `${r.right!.key}\u0000${r.right!.html}`;
    const list = exact.get(k);
    if (list) list.push(r);
    else exact.set(k, [r]);
  }
  const unmatchedRemoved: AlignedRow[] = [];
  for (const r of removedRows) {
    const list = exact.get(`${r.left!.key}\u0000${r.left!.html}`);
    const target = list && list.shift();
    if (target) link(r, target);
    else unmatchedRemoved.push(r);
  }

  const idCount = (rs: AlignedRow[], side: 'left' | 'right'): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const r of rs) {
      const k = r[side]!.key;
      if (r.moveId === undefined && k.startsWith('id:')) counts.set(k, (counts.get(k) || 0) + 1);
    }
    return counts;
  };
  const leftIds = idCount(unmatchedRemoved, 'left');
  const rightIds = idCount(addedRows, 'right');
  const addedById = new Map<string, AlignedRow>();
  for (const r of addedRows) {
    if (r.moveId === undefined && r.right!.key.startsWith('id:')) addedById.set(r.right!.key, r);
  }
  for (const r of unmatchedRemoved) {
    const k = r.left!.key;
    const target = addedById.get(k);
    if (
      target &&
      leftIds.get(k) === 1 &&
      rightIds.get(k) === 1 &&
      r.left!.baseType === target.right!.baseType
    ) {
      link(r, target);
      const { parts } = computeInline(r.left!.text, target.right!.text);
      r.inlineDiff = parts;
      target.inlineDiff = parts;
    }
  }
  return rows;
}

// ── Section recursion ──

export function alignSectionChildren(
  leftParent: DitaNode,
  rightParent: DitaNode,
  leftOpts: BlockExtractOptions,
  rightOpts: BlockExtractOptions,
  headingLevel: number,
): AlignedRow[] {
  const rows: AlignedRow[] = [];

  // A container's own <title> is in SKIP_BASETYPES, so extractChildBlocks below
  // never turns it into a block: a recursed (modified) container rendered its
  // changed children but silently lost its heading, which read as orphaned body
  // text with no context -- and for a <table>, whose title is its caption, it
  // meant an edited caption was not a change at all (measured: changing only
  // "Performance figures" gave stats {added:0, removed:0, modified:0}).
  //
  // Tables/simpletables are included on the same terms sections already were:
  // the row goes out as the group's FIRST row, and ditaDiffRender.ts buffers a
  // title inside that group and re-writes it into the assembled <table>'s
  // caption slot rather than flowing it beside the table -- an <h1> inside
  // <table> is foster-parented out of it by the parser, and a <caption> emitted
  // anywhere but that slot is deleted outright. The panel does that conversion
  // itself from the preview's own heading markup; src/render is untouched.
  const parentType = leftParent.baseType || rightParent.baseType || '';
  if (
    parentType === 'topic/section' ||
    parentType === 'topic/example' ||
    parentType === 'topic/table' ||
    parentType === 'topic/simpletable'
  ) {
    const titleRow = alignTitleRow(leftParent, rightParent, leftOpts, rightOpts, parentType, headingLevel);
    if (titleRow) rows.push(titleRow);
  }

  const leftBlocks = extractChildBlocks(leftParent, leftOpts, 'topic/section', headingLevel);
  const rightBlocks = extractChildBlocks(rightParent, rightOpts, 'topic/section', headingLevel);

  const ops = lcsAlign(leftBlocks, rightBlocks, (a, b) => a.key === b.key && a.text === b.text, (item) => item.key);
  const childRows = pairAdjacentChanges(ops);

  for (const row of childRows) {
    if (row.changeType === 'modified' && row.left && row.right) {
      applyInline(row);

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

  return rows.concat(childRows);
}

// The section/example heading, surfaced as its own row when the section
// recurses (see alignSectionChildren). Pairs unchanged unless the heading text
// itself was edited; a one-sided title (section gained/lost its heading) shows
// as added/removed. `headingLevel` is the level the section node was rendered
// at; its own container renderer bumps it by one before the title, so add that
// one back to land on the same h-level the title has inside the whole-section
// block.
function alignTitleRow(
  leftParent: DitaNode,
  rightParent: DitaNode,
  leftOpts: BlockExtractOptions,
  rightOpts: BlockExtractOptions,
  parentType: string,
  headingLevel: number,
): AlignedRow | undefined {
  const findTitle = (parent: DitaNode): DitaNode | undefined =>
    (parent.children || []).find((c) => c.type === 'element' && c.baseType === 'topic/title');
  const leftTitle = findTitle(leftParent);
  const rightTitle = findTitle(rightParent);
  const level = headingLevel + 1;

  if (leftTitle && rightTitle) {
    const left = makeBlock(leftTitle, leftOpts, parentType, level);
    const right = makeBlock(rightTitle, rightOpts, parentType, level);
    if (left.key === right.key && left.text === right.text) {
      return { left, right, changeType: 'unchanged' };
    }
    const titleRow: AlignedRow = { left, right, changeType: 'modified' };
    applyInline(titleRow);
    return titleRow;
  }
  if (leftTitle) {
    return { left: makeBlock(leftTitle, leftOpts, parentType, level), changeType: 'removed' };
  }
  if (rightTitle) {
    return { right: makeBlock(rightTitle, rightOpts, parentType, level), changeType: 'added' };
  }
  return undefined;
}
