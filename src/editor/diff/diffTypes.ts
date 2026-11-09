// The diff engine's public data types: blocks, aligned rows and the result of diffing two topics.
// Split out of ditaDiffEngine.ts; a pure function module, no vscode dependency.

import {
  DitaNode,
} from '@dita-viewer/core';

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
  /** Set on a 'modified' row whose two sides were paired by type/position but
   *  share (almost) no wording -- a wholesale replacement. The renderer draws
   *  its edge marker dashed so "rewritten" reads differently from "edited". */
  replaced?: boolean;
  /** Set on a removed row and its added counterpart when the same block moved
   *  (exactly, or by identical id with edits). Both rows carry the same value;
   *  the renderer gives them one data-diff-idx so one connector joins them. */
  moveId?: number;
}

export interface TopicDiffResult {
  leftTitle?: string;
  rightTitle?: string;
  rows: AlignedRow[];
  stats: { added: number; removed: number; modified: number };
  errorLeft?: string;
  errorRight?: string;
}
