// Structural diff engine for DITA topics — pure functions, no vscode dependency.
// Compares two parsed topic trees at block level (paragraphs, sections, lists…)
// using LCS alignment, pairs wording-level changes as "modified", and injects
// word-level inline diff marks into rendered HTML.

// The engine is split by concern under ./diff/; this file keeps the top-level entry
// (diffTopics), side swapping and the commit-choice helpers, and re-exports every name it
// has always exported, so importers of this path are unaffected.

import {
  DitaNode,
  DitaDocument,
  parseDita,
  preprocessEntities,
} from '@dita-viewer/core';
import { collectText } from './ditaRenderUtils';
import { alignSectionChildren, pairAdjacentChanges } from './diff/diffAlign';
import { extractTopicBlocks, isDiffableContainer } from './diff/diffBlocks';
import { lcsAlign } from './diff/diffLcs';
import { applyInline } from './diff/diffSimilarity';
import { AlignedRow, RenderedBlock, TopicDiffResult } from './diff/diffTypes';

export type { BlockExtractOptions } from './diff/diffBlocks';
export { extractChildBlocks, extractTopicBlocks, normalizeText } from './diff/diffBlocks';
export { applyInlineMarksToHtml } from './diff/diffInlineMarks';
export { lcsAlign } from './diff/diffLcs';
export { coalesceDiffParts } from './diff/diffSimilarity';
export { diffTokens, tokenizeForDiff } from './diff/diffTokens';
export type { AlignedRow, DiffChangeType, DiffPart, RenderedBlock, TopicDiffResult } from './diff/diffTypes';

// ── Swap helper ──

// A whole-result swap: the rows turn around AND the stats are recounted from
// them. swapAlignedRows flips every added/removed row, so recounting is what
// swaps the chip's numbers; reusing the old ones left the chip contradicting
// the view (an insertion-only diff showing "+1 −0" over a lone deletion).
// This is the only place that flips the numbers; the renderer shows them as is.
export function swapDiffResult<T extends { rows: AlignedRow[]; stats: { added: number; removed: number; modified: number } }>(result: T): T {
  const rows = swapAlignedRows(result.rows);
  return { ...result, rows, stats: computeRowStats(rows) };
}

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
    if (row.replaced) swapped.replaced = true;
    if (row.moveId !== undefined) {
      swapped.moveId = row.moveId;
      // Both halves of a move carry the same left->right parts; flipping the
      // sides flips what counts as removed and added.
      swapped.inlineDiff = row.inlineDiff?.map((p) => ({
        value: p.value,
        added: p.removed,
        removed: p.added,
      }));
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
      applyInline(row);

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
    // A recursed container (section / list / table) is never drawn itself --
    // only its children are -- so counting it as well double-counted every
    // change inside it and disagreed with the view's next/prev counter.
    if (row.children && row.children.length > 0) {
      countStats(row.children, stats);
      continue;
    }
    // A move is one change drawn as two blocks: count it once, as modified.
    if (row.moveId !== undefined) {
      if (row.changeType === 'added') stats.modified++;
    } else if (row.changeType === 'added') stats.added++;
    else if (row.changeType === 'removed') stats.removed++;
    else if (row.changeType === 'modified') stats.modified++;
  }
}

/**
 * The toolbar's `+n −n ~n` chip, recomputed from a set of rows.
 *
 * Needed after swapAlignedRows: that helper flips every row's changeType, so a
 * result whose stats said `+1 −0` now draws one ADDED-side block where the
 * count still claims an insertion. Counting from the rows themselves rather
 * than swapping `stats.added`/`stats.removed` by hand keeps the chip honest for
 * the cases a plain swap would get wrong -- moves, where each half is a
 * different type and the pair must still count once as modified, and recursed
 * containers, which contribute their children's counts only.
 */
export function computeRowStats(rows: AlignedRow[]): TopicDiffResult['stats'] {
  const stats = { added: 0, removed: 0, modified: 0 };
  countStats(rows, stats);
  return stats;
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
