import * as vscode from 'vscode';
import { dirname } from 'path';
import { createRefCountedPool } from './refCountedPool';

/**
 * Everything a DITA render can pull in from outside the document being
 * previewed: topics and maps (conref/conrefend/keyref/mapref targets), custom
 * CSS, and the image formats the renderer reads natural dimensions from.
 *
 * Byte-for-byte the glob both providers already watched separately; sharing it
 * is the change here, widening or narrowing it is a separate decision.
 */
export const DITA_FILE_GLOB = '**/*.{dita,ditamap,css,png,jpg,jpeg,gif,svg,webp}';

export type DitaFileEventKind = 'change' | 'create' | 'delete';

export interface DitaFileEvent {
  uri: vscode.Uri;
  /**
   * Which watcher event fired. Both preview providers treat the three alike,
   * since any of them can invalidate a render. Consumers that care about the
   * difference need it though -- see shouldRefreshMapTree, where a .dita being
   * created or deleted changes whether a tree entry can be opened, while its
   * contents changing alters nothing the tree displays.
   */
  kind: DitaFileEventKind;
}

/**
 * One watcher per watched folder, however many consumers ask for it.
 *
 * Both preview providers used to create their own watcher over the same glob
 * and the same workspace folder, so N open panels meant N watchers each
 * matching every file event in that folder and each carrying its own emitter
 * chain -- and the panels that make a big book expensive to re-render are
 * exactly the ones a user is likely to have several of at once. The map tree
 * is now a third consumer of the same folder, which in the common layout
 * (map and topics in one workspace folder) costs no extra watcher at all.
 */
const pool = createRefCountedPool<string, DitaFileEvent>((key, broadcast) => {
  const base = vscode.Uri.parse(key);
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(base, DITA_FILE_GLOB),
  );
  const subscriptions = [
    watcher.onDidChange((uri) => broadcast({ uri, kind: 'change' })),
    watcher.onDidCreate((uri) => broadcast({ uri, kind: 'create' })),
    watcher.onDidDelete((uri) => broadcast({ uri, kind: 'delete' })),
  ];
  return () => {
    for (const s of subscriptions) s.dispose();
    watcher.dispose();
  };
});

/**
 * The folder to watch for a document: the workspace folder containing it, or
 * the directory holding the file when there is none (a .dita opened on its
 * own). Watching the whole folder rather than the document's resolved
 * dependency set is a deliberate tradeoff both providers document at their
 * call site.
 */
export function ditaWatchBase(uri: vscode.Uri): vscode.Uri {
  return vscode.workspace.getWorkspaceFolder(uri)?.uri ?? vscode.Uri.file(dirname(uri.fsPath));
}

/**
 * Subscribes to DITA file events under a folder. Every caller passing the same
 * base shares one underlying watcher; the returned Disposable releases that
 * caller's share and tears the watcher down when it was the last.
 */
export function acquireDitaFileWatcher(
  base: vscode.Uri,
  listener: (event: DitaFileEvent) => void,
): vscode.Disposable {
  return pool.acquire(base.toString(), listener);
}

/** Watched folders and how many consumers each is currently serving. */
export function ditaFileWatcherCounts(): Map<string, number> {
  return pool.counts();
}
