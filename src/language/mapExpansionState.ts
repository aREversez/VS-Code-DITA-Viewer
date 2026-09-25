/**
 * The Explorer map tree's expansion state: which branch nodes are expanded
 * and collapsed, how that outlives a reload (and a VS Code restart), and the
 * ids both are keyed by.
 *
 * Pure of the vscode module so the decisions worth pinning down -- what a
 * stored value is trusted to mean, what an id is stable against, what the
 * TreeItem id has to encode, and which rows a scoped collapse-all folds --
 * can be unit-tested. The wiring (tree view events, workspaceState
 * reads/writes) is in ditaMapTreeProvider.ts.
 *
 * Why ids at all: the tree collapses every branch by default except the
 * root map row, and what the user then expands has to survive two very
 * different resets. A map edit reloads the whole tree from disk (new
 * wrapper objects), and VS Code restarts with an empty view. The provider
 * keeps its own deviations-from-default record to re-apply in getTreeItem,
 * persisted per map in workspaceState, and keyed by structural node ids
 * built here.
 */
import { DitaNode } from '../parser/domTypes';

/**
 * The main map row is expanded by default (so a fresh tree shows the map's
 * own top-level divisions); everything under it starts collapsed -- a
 * ditamap carries dozens of topicrefs and keydefs, and pre-expanding the
 * whole outline was the noise the collapsed-by-default design exists to
 * avoid. Only deviations from these defaults are recorded.
 */
export const ROOT_NODE_ID = 'root';

export type ExpansionMark = 'e' | 'c';

/** Recorded deviations from the defaults, keyed by structural node id. */
export type ExpansionDeviations = Record<string, ExpansionMark>;

export function isExpandedByDefault(nodeId: string): boolean {
  return nodeId === ROOT_NODE_ID;
}

/** The state a branch renders with: the recorded deviation, else the default. */
export function expansionFor(deviations: ExpansionDeviations, nodeId: string): ExpansionMark {
  const mark = deviations[nodeId];
  if (mark === 'e' || mark === 'c') return mark;
  return isExpandedByDefault(nodeId) ? 'e' : 'c';
}

export function markExpanded(deviations: ExpansionDeviations, nodeId: string): void {
  if (isExpandedByDefault(nodeId)) delete deviations[nodeId];
  else deviations[nodeId] = 'e';
}

export function markCollapsed(deviations: ExpansionDeviations, nodeId: string): void {
  if (isExpandedByDefault(nodeId)) deviations[nodeId] = 'c';
  else delete deviations[nodeId];
}

/**
 * The ids a scoped collapse-all marks: every branch under the target (the
 * provider's collectBranchIds output) plus the target row itself.
 *
 * The invoked row is part of the fold because that is what "Collapse All"
 * means in every other tree -- and because on the standard chapter shape
 * it is the only fold there is: a topichead whose children are all leaf
 * topicrefs, which is how each chapter of a manual's map is written,
 * contributes no descendant branch at all, so a descendants-only
 * collapse-all marked nothing and read as dead on exactly the rows users
 * try it on.
 *
 * The main map row is the one exception, named for what it is rather than
 * inferred from the expansion defaults: it anchors the tree, so collapsing
 * from it lands on the one-level outline a fresh tree starts at instead of
 * a single bare row -- and a map whose top level is all leaf rows
 * accordingly has nothing to do. An undefined target id is a row from
 * before a reload re-parsed the map, which records nothing (same stance as
 * noteExpansion).
 */
export function collapseAllIds(
  targetId: string | undefined,
  descendantBranchIds: readonly string[],
): string[] {
  const ids = [...descendantBranchIds];
  if (targetId !== undefined && targetId !== ROOT_NODE_ID) ids.push(targetId);
  return ids;
}

/**
 * workspaceState can be hand-edited and survives extension upgrades, so a
 * stored record is only trusted as far as it checks out: an object whose
 * values are exactly 'e' or 'c', everything else dropped key by key.
 */
export function parseExpansionDeviations(raw: unknown): ExpansionDeviations {
  const result: ExpansionDeviations = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return result;
  for (const [id, mark] of Object.entries(raw as Record<string, unknown>)) {
    if (mark === 'e' || mark === 'c') result[id] = mark;
  }
  return result;
}

/**
 * Drops ids the current tree no longer contains. Map edits rename, move and
 * delete topicrefs; without this, a record only ever grows across a session
 * (and across restarts, since it is persisted), holding state for nodes
 * that will never come back.
 */
export function pruneExpansionDeviations(
  deviations: ExpansionDeviations,
  knownIds: ReadonlySet<string>,
): ExpansionDeviations {
  const result: ExpansionDeviations = {};
  for (const [id, mark] of Object.entries(deviations)) {
    if (knownIds.has(id)) result[id] = mark;
  }
  return result;
}

/**
 * One id segment per visible tree node, derived from what the node itself
 * references rather than its position among its siblings: the href (minus
 * any fragment), the keys, the navtitle, and only then the tag name. An
 * id built from child indices would shift for every node below a point
 * where one topicref is inserted -- resetting the recorded expansion of a
 * whole subtree that did not structurally change -- while a href-keyed id
 * survives edits elsewhere in the same parent. Genuine duplicates (the
 * same href referenced twice) are disambiguated by an occurrence suffix,
 * see nodeIdFor.
 */
export function nodeSegment(node: DitaNode): string {
  const attrs = node.attributes;
  if (attrs?.href) return attrs.href.split('#')[0] || attrs.href;
  if (attrs?.keys) return `${node.tagName || 'ref'}:keys=${attrs.keys}`;
  if (attrs?.navtitle) return `${node.tagName || 'ref'}:${attrs.navtitle}`;
  return node.tagName || 'ref';
}

/**
 * The structural id of a visible node: its segment appended to its parent's
 * id, with `~2`, `~3`, ... added only when the same segment has already
 * appeared among earlier siblings (two topicrefs to one topic are legal and
 * common enough to need a stable disambiguator that does not renumber the
 * first occurrence).
 */
export function nodeIdFor(
  parentId: string,
  node: DitaNode,
  earlierSiblingSegments: ReadonlyMap<string, number>,
): string {
  const segment = nodeSegment(node);
  const seen = earlierSiblingSegments.get(segment) || 0;
  return seen === 0 ? `${parentId}/${segment}` : `${parentId}/${segment}~${seen + 1}`;
}

/**
 * The TreeItem id handed to VS Code. Two properties are load-bearing:
 *
 * - It includes the map's path, so switching maps can never let a node of
 *   the new map match a still-rendered node of the old one (ids are unique
 *   per view, and "root" exists in every map).
 * - It includes the node's expansion mark. VS Code matches tree nodes
 *   across a data refresh by TreeItem id and preserves each matched node's
 *   collapsed/expanded state -- the TreeView API has no way to collapse a
 *   rendered node, and reveal() only expands. But when the id changes, the
 *   rendered node is a different node: the refresh replaces it and applies
 *   the collapsibleState getTreeItem returned. Encoding the mark in the id
 *   is therefore the one mechanism that makes a scoped collapse-all (or
 *   expand-all) able to act on nodes that are already on screen: change
 *   the recorded state, fire the data change, and every node whose state
 *   changed is rebuilt in the new state. Nodes whose state did not change
 *   keep their id and ride through the refresh untouched.
 *
 * `state` is optional for rows that cannot expand (leaf rows) -- a plain
 * stable id still keeps their row (and selection) matched across refreshes.
 */
export function treeItemId(mapKey: string, nodeId: string, state?: ExpansionMark): string {
  return state === undefined ? `${mapKey}|${nodeId}` : `${mapKey}|${nodeId}|${state}`;
}
