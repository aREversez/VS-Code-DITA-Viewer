// Whether the Explorer's DITA map tree should follow the editor the user just
// switched to, and how.
//
// Its own module for the same reason mapTreeRefresh.ts is: ditaMapTreeProvider
// imports vscode, so nothing written inside it is reachable from the
// plain-mocha unit tests, and this rule is what decides whether the tree
// tracks the map on screen or sits on a stale one.

export type MapFollowDecision =
  /** Leave the tree alone. */
  | 'ignore'
  /** The active document is itself a map: show it. */
  | 'map'
  /** The active document is a topic: show a map found beside it. */
  | 'topic-owner';

/**
 * A .ditamap is unambiguous -- it IS the map the user is looking at -- so the
 * tree follows it even between two maps in the same workspace folder (a book
 * folder commonly holds a main map plus sub-maps and a keydef map, and
 * flipping between their tabs, source or preview, is exactly when the tree
 * should change with them). A .dita topic is not: it can be reachable from
 * several maps, and picking one whenever a topic gets focus would fight both
 * nested references and a manual choice made moments ago, so a topic only
 * triggers a switch when it crosses into a different workspace folder.
 *
 * Anything else (other file types, or a file outside every workspace folder
 * -- there is no project to have switched into) leaves the tree where it is.
 */
export function decideMapFollow(
  fsPath: string,
  ctx: { inWorkspaceFolder: boolean; sameFolderAsCurrentMap: boolean },
): MapFollowDecision {
  const lower = fsPath.toLowerCase();
  const isMap = lower.endsWith('.ditamap');
  if (!isMap && !lower.endsWith('.dita')) return 'ignore';
  if (!ctx.inWorkspaceFolder) return 'ignore';
  if (isMap) return 'map';
  return ctx.sameFolderAsCurrentMap ? 'ignore' : 'topic-owner';
}
