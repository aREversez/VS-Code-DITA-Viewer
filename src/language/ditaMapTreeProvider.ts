// Explorer sidebar tree view of the DITA map associated with the active
// editor: keeps the map structure visible while editing any .dita file,
// with click-to-open navigation on every referenced topic.

import * as vscode from 'vscode';
import { existsSync, readFileSync } from 'fs';
import { basename, dirname, resolve } from 'path';
import { DitaNode } from '../parser/domTypes';
import { parseDitamap, preprocessEntities } from '../parser/ditaParser';
import { expandDitamapRefs, decodeHrefPart, makeFileTitleResolver } from '../editor/ditaRenderUtils';
import { acquireDitaFileWatcher, ditaWatchBase } from '../editor/ditaFileWatcher';
import { buildKeyMap, findDitamapFiles } from '../editor/DitaViewerProvider';
import { createBookRoleLabeler, getDisplayNameInfo } from '../render/mapTypeMap';
import { formatLocalizedRole } from './bookRoleL10n';
import { shouldRefreshMapTree } from './mapTreeRefresh';

interface MapTreeNode {
  node: DitaNode;
  mapDir: string;
}

const SHOWN_BASE_TYPES = new Set([
  'map/topicref',
  'map/topichead',
  'map/keydef',
  'map/mapref',
  'map/bookmap-structural',
]);

/** Collects the child nodes to show, flattening pass-through topicgroups. */
function visibleChildren(node: DitaNode): DitaNode[] {
  const result: DitaNode[] = [];
  for (const child of node.children || []) {
    if (child.type !== 'element') continue;
    const bt = child.baseType;
    if (bt && SHOWN_BASE_TYPES.has(bt)) {
      result.push(child);
    } else if (bt === 'map/topicgroup') {
      result.push(...visibleChildren(child));
    } else if (bt === 'map/reltable' || bt === 'map/topicmeta' || bt === 'map/map-title') {
      continue;
    }
  }
  return result;
}

export class DitaMapTreeProvider implements vscode.TreeDataProvider<MapTreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private mapPath: string | undefined;
  private mapRoot: DitaNode | undefined;
  private resolveKey: ((key: string) => string | undefined) | undefined;
  /** Reads a referenced topic's own <title> off disk -- only ever consulted
   *  for entries the map itself never named (see getTreeItem). Rebuilt each
   *  reload so a rename/edit of a topic file is picked up, not stale-cached
   *  across the tree's whole lifetime. */
  private titleResolver: ((href: string) => string | undefined) | undefined;
  /** Numbered book-division labels ("Chapter 1", …) keyed by node, in document order */
  private roleLabels = new WeakMap<DitaNode, string>();
  /** Pending coalesced reload -- see requestRefresh. */
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  /** This tree's share of the folder watcher, and the folder it is on. */
  private watcherSubscription: vscode.Disposable | undefined;
  private watchedBase: string | undefined;
  /**
   * When true, setActiveDocument is a no-op: the user picked a map by hand
   * (selectMap) or asked to keep the current one (pin), so opening other
   * topics -- however deeply cross-referenced the map's own structure is --
   * must not second-guess that choice. Cleared by unpin, which immediately
   * resyncs to whatever's active.
   */
  private pinned = false;

  get isPinned(): boolean {
    return this.pinned;
  }

  /**
   * Re-evaluates which map to show based on the active editor's document.
   * Auto-following only ever crosses a *workspace-folder* boundary -- the
   * common layout where each product/book lives isolated in its own folder,
   * each with its own map. Opening another topic inside the map's own
   * folder never switches the tree: DITA's nested map/topic references make
   * "the" owning map ambiguous within one folder (a topic can be reachable
   * from several maps), so picking one automatically on every keystroke
   * would fight both nested references and a manual choice made moments
   * ago. A topic opened from outside every workspace folder is left alone
   * too -- there's no "project" to have switched into.
   */
  setActiveDocument(uri: vscode.Uri | undefined): void {
    if (!uri) return; // Keep the last map when focus moves to non-file views
    if (this.pinned) return; // Manual choice in force: editor activity never overrides it
    const fsPath = uri.fsPath;
    const lower = fsPath.toLowerCase();
    if (!lower.endsWith('.ditamap') && !lower.endsWith('.dita')) return; // Unrelated file type: keep showing the current map

    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return; // External topic outside any workspace folder: keep the current map

    const currentFolder = this.mapPath
      ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(this.mapPath))
      : undefined;
    if (currentFolder && folder.uri.fsPath === currentFolder.uri.fsPath) return; // Same project folder: not a project switch

    const nextMap = lower.endsWith('.ditamap') ? fsPath : findDitamapFiles(uri)[0];
    if (!nextMap) return;

    // Keep the sidebar view visible even when the user moves on to other files
    vscode.commands.executeCommand('setContext', 'ditaViewer.hasMap', true);
    if (resolve(nextMap) !== (this.mapPath ? resolve(this.mapPath) : undefined)) {
      this.mapPath = nextMap;
      this.reload();
    }
  }

  /** Pins the map currently shown, so further editor activity can't change it. */
  pin(): void {
    if (!this.mapPath) return;
    this.pinned = true;
    vscode.commands.executeCommand('setContext', 'ditaViewer.mapExplorer.pinned', true);
  }

  /** Releases the pin and immediately resyncs to whatever editor is active. */
  unpin(): void {
    this.pinned = false;
    vscode.commands.executeCommand('setContext', 'ditaViewer.mapExplorer.pinned', false);
    this.setActiveDocument(vscode.window.activeTextEditor?.document.uri);
  }

  /**
   * Lets the user hand-pick which map the sidebar shows, independent of
   * whatever's active in the editor -- the escape hatch for a map made of
   * layered/nested references, where no single "owning" map for a given
   * topic is obviously correct. Scoped to the map's own workspace folder
   * when one is already showing (or the active editor's, on first use);
   * falls back to the whole workspace if neither is available. Picking a
   * map pins it, same as pin(), so the choice sticks through further topic
   * navigation.
   */
  async selectMap(): Promise<void> {
    const scopeUri = this.mapPath
      ? vscode.Uri.file(this.mapPath)
      : vscode.window.activeTextEditor?.document.uri;
    const folder = scopeUri ? vscode.workspace.getWorkspaceFolder(scopeUri) : undefined;
    const pattern = folder ? new vscode.RelativePattern(folder, '**/*.ditamap') : '**/*.ditamap';
    const found = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 200);
    if (found.length === 0) {
      vscode.window.showInformationMessage(vscode.l10n.t('No .ditamap files found in this workspace folder.'));
      return;
    }
    const items = found
      .map((u) => ({ label: basename(u.fsPath), description: vscode.workspace.asRelativePath(u), uri: u }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: vscode.l10n.t('Select a DITA map to show'),
    });
    if (!picked) return;
    this.mapPath = picked.uri.fsPath;
    this.pin();
    vscode.commands.executeCommand('setContext', 'ditaViewer.hasMap', true);
    this.reload();
  }

  refresh(): void {
    this.reload();
  }

  /**
   * Coalesced reload for file events. Saving a .ditamap in the editor both
   * fires onDidSaveTextDocument and writes the file where the watcher sees it,
   * and a reload rebuilds the whole tree -- discarding which nodes the user had
   * expanded -- so two reports of one edit must not become two reloads.
   */
  requestRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.reload();
    }, 50);
  }

  private reload(): void {
    this.mapRoot = undefined;
    this.resolveKey = undefined;
    this.titleResolver = undefined;
    this.roleLabels = new WeakMap();
    if (this.mapPath && existsSync(this.mapPath)) {
      try {
        const content = readFileSync(this.mapPath, 'utf-8');
        const doc = parseDitamap(preprocessEntities(content));
        expandDitamapRefs(doc.root, dirname(this.mapPath));
        this.mapRoot = doc.root;
        const keyMap = buildKeyMap(vscode.Uri.file(this.mapPath));
        this.resolveKey = (k: string) => keyMap.get(k);
        this.titleResolver = makeFileTitleResolver(dirname(this.mapPath));
        // Assign numbered division labels per nesting depth
        const roleLabel = createBookRoleLabeler(formatLocalizedRole);
        const labelWalk = (node: DitaNode, depth: number): void => {
          for (const child of node.children || []) {
            if (child.type !== 'element') continue;
            const bt = child.baseType;
            // topicgroup / bookmap-structural are transparent: children stay at same depth
            const childDepth = bt === 'map/topicgroup' || bt === 'map/bookmap-structural' ? depth : depth + 1;
            const label = roleLabel(child.tagName, childDepth);
            if (label) this.roleLabels.set(child, label);
            labelWalk(child, childDepth);
          }
        };
        labelWalk(doc.root, -1);
      } catch {
        this.mapRoot = undefined;
      }
    }
    this.syncWatcher();
    this._onDidChangeTreeData.fire();
  }

  getChildren(element?: MapTreeNode): MapTreeNode[] {
    if (!element) {
      if (!this.mapRoot || !this.mapPath) return [];
      const mapDir = dirname(this.mapPath);
      return visibleChildren(this.mapRoot).map((node) => ({ node, mapDir }));
    }
    return visibleChildren(element.node).map((node) => ({ node, mapDir: element.mapDir }));
  }

  getTreeItem(element: MapTreeNode): vscode.TreeItem {
    const { node, mapDir } = element;
    const baseType = node.baseType;
    const href = node.attributes?.href;
    let label: string;
    if (baseType === 'map/bookmap-structural') {
      label = node.tagName || '(container)';
    } else {
      const nameInfo = getDisplayNameInfo(node, this.resolveKey);
      // A name the map itself never gave (Priority 4/5 in
      // getDisplayNameInfo -- the href's bare filename, or the raw `keys`
      // value) isn't really a title, just the only thing left to call the
      // row: read the referenced topic's own <title> off disk instead, so
      // the tree shows what the topic is actually about rather than its
      // filename. Falls back to the map's own text when the topic can't be
      // read (a broken href, a non-DITA target, a key-only ref).
      label = nameInfo.explicit ? nameInfo.text : this.titleResolver?.(href || '') || nameInfo.text;
    }
    const hasChildren = visibleChildren(node).length > 0;
    const item = new vscode.TreeItem(
      label,
      hasChildren ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
    );

    const role = this.roleLabels.get(node);
    const keys = node.attributes?.keys;
    item.description = role || (baseType === 'map/keydef' ? keys : href) || undefined;
    item.tooltip = href || keys || label;

    if (baseType === 'map/keydef') {
      item.iconPath = new vscode.ThemeIcon('key');
    } else if (baseType === 'map/bookmap-structural' || baseType === 'map/topichead') {
      item.iconPath = new vscode.ThemeIcon('folder');
    } else if (role) {
      item.iconPath = new vscode.ThemeIcon('book');
    } else {
      item.iconPath = new vscode.ThemeIcon('file');
    }

    // Click opens the referenced local file
    if (href && !/^[a-z][a-z0-9+.-]*:/i.test(href) && node.attributes?.scope !== 'external') {
      const filePart = decodeHrefPart(href.split('#')[0]);
      const abs = resolve(mapDir, filePart);
      if (existsSync(abs)) {
        item.command = {
          command: 'vscode.open',
          title: vscode.l10n.t('Open File'),
          arguments: [vscode.Uri.file(abs)],
        };
      }
    }
    return item;
  }

  /**
   * Keeps exactly one watcher on the folder holding the current map, and moves
   * it when the map moves. Shared with the preview panels through
   * acquireDitaFileWatcher, so in the usual layout -- map and topics in one
   * workspace folder -- the tree costs no watcher of its own.
   *
   * This is what makes the sidebar survive a git checkout or pull: those
   * rewrite the .ditamap on disk without anything being saved in an editor, so
   * the onDidSaveTextDocument listener in registerMapTreeView never fires for
   * them, and the tree used to keep showing the previous branch's structure
   * until the user thought to hit refresh.
   */
  private syncWatcher(): void {
    if (!this.mapPath) return;
    const base = ditaWatchBase(vscode.Uri.file(this.mapPath));
    const key = base.toString();
    if (key === this.watchedBase) return;
    this.watcherSubscription?.dispose();
    this.watchedBase = key;
    this.watcherSubscription = acquireDitaFileWatcher(base, (event) => {
      // Not every watched file is this tree's business: a topic's contents
      // change nothing the tree displays, and reloading for it would throw
      // away the user's expansion state. See shouldRefreshMapTree.
      if (!shouldRefreshMapTree(event.uri.fsPath, event.kind, event.fromEditor === true)) return;
      this.requestRefresh();
    });
  }

  /**
   * Releases the pending reload and this tree's share of the folder watcher.
   * Wired into context.subscriptions, so it runs on deactivation.
   *
   * The timer has to be cleared, not just the watcher released: a reload firing
   * after deactivation would rebuild a tree nobody is listening to, and would
   * keep reading the map off disk in a session that is supposed to be over.
   *
   * _onDidChangeTreeData is deliberately NOT disposed. Disposing it would make
   * this depend on how it is ordered against the teardown of
   * registerTreeDataProvider's own disposable, which sits in the same
   * subscriptions array -- and the semantics of unsubscribing from an
   * already-disposed vscode.EventEmitter could not be checked against the
   * shipped bundle, which is minified enough that the Emitter implementation is
   * not readable. What it would reclaim is one object that, once the tree view
   * has been unsubscribed, holds no listeners. Releasing a FileSystemWatcher is
   * worth that uncertainty, because a watch is an OS resource that outlives the
   * extension; releasing an empty emitter is not.
   */
  dispose(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    this.watcherSubscription?.dispose();
    this.watcherSubscription = undefined;
    this.watchedBase = undefined;
  }
}

export function registerMapTreeView(context: vscode.ExtensionContext): void {
  const provider = new DitaMapTreeProvider();
  vscode.commands.executeCommand('setContext', 'ditaViewer.mapExplorer.pinned', false);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('ditaViewer.mapExplorer', provider),
    vscode.commands.registerCommand('ditaViewer.mapExplorer.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('ditaViewer.mapExplorer.selectMap', () => provider.selectMap()),
    vscode.commands.registerCommand('ditaViewer.mapExplorer.pin', () => provider.pin()),
    vscode.commands.registerCommand('ditaViewer.mapExplorer.unpin', () => provider.unpin()),
    vscode.window.onDidChangeActiveTextEditor((editor) =>
      provider.setActiveDocument(editor?.document.uri),
    ),
    // Kept alongside the provider's own watcher rather than replaced by it:
    // this still covers a map saved in an editor when that map lives outside
    // every workspace folder, where the watcher's base is the map's own
    // directory and a keydef map saved elsewhere would not be seen. Both
    // routes funnel into requestRefresh, so one save is still one reload.
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.uri.fsPath.toLowerCase().endsWith('.ditamap')) provider.requestRefresh();
    }),
    new vscode.Disposable(() => provider.dispose()),
  );
  provider.setActiveDocument(vscode.window.activeTextEditor?.document.uri);
}
