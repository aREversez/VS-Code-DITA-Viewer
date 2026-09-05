// Which file-system events should make the Explorer's DITA map tree reload.
//
// Its own module for one reason: ditaMapTreeProvider imports vscode, so
// nothing written inside it can be reached from the plain-mocha unit tests,
// and this policy is worth pinning down -- it is the difference between a
// sidebar that goes stale after a git checkout and one that discards the
// user's expansion state every time they save a topic.

// Type-only: erased at compile time, so this module still loads without the
// vscode API present (which the unit tests run without).
import type { DitaFileEventKind } from '../editor/ditaFileWatcher';

/**
 * True when a file event should reload the map tree.
 *
 * Everything the tree displays comes out of the map file itself: getDisplayName
 * reads topicmeta navtitle, then linktext, then shortdesc, then a keyword, and
 * falls back to the href's filename and the keys attribute -- it never opens
 * the referenced topic. So editing a .dita cannot change any label, icon or
 * description in the tree, and reloading for one would only rebuild the whole
 * tree, which fires onDidChangeTreeData with no argument and so collapses the
 * user's expansion state back to the provider's defaults.
 *
 * What a .dita CAN change is whether an entry is clickable: getTreeItem sets
 * item.command only when existsSync() says the href resolves, and that check
 * runs during the reload. Creating or deleting a topic file therefore does
 * need one; changing a topic's contents does not.
 *
 * A .ditamap is the tree's entire input -- structure, labels, keys, and the
 * sub-maps expandDitamapRefs inlines -- so any event on one reloads. Note this
 * is what covers a git checkout or pull rewriting the map on disk, which the
 * onDidSaveTextDocument listener in registerMapTreeView never sees because
 * nothing was saved in an editor.
 *
 * Other watched extensions (css, images) affect a rendered preview but nothing
 * the tree shows.
 */
export function shouldRefreshMapTree(fsPath: string, kind: DitaFileEventKind): boolean {
  const lower = fsPath.toLowerCase();
  if (lower.endsWith('.ditamap')) return true;
  if (lower.endsWith('.dita')) return kind !== 'change';
  return false;
}
