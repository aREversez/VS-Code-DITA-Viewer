// Explorer sidebar tree view of the DITA map associated with the active
// editor: keeps the map structure visible while editing any .dita file,
// with click-to-open navigation on every referenced topic.
//
// The tree's shape mirrors Oxygen's DITA Maps Manager: the main map itself
// is the single root row (its title, not a bare list of its children),
// branches start collapsed -- including frontmatter and keydef entries,
// which are listed again now that nothing auto-expands them -- and
// expand-all/collapse-all act on the selected node's subtree, with the
// resulting expansion state persisted per map.
//
// Each row's context menu (also Oxygen-DITA-Maps-Manager-flavored) offers
// Open with Oxygen, Reveal in Explorer, Export as HTML, and Copy
// Title/Href for rows with the right shape (see getTreeItem's
// contextValue), plus Find Unreferenced Resources on the root row. All of
// it hangs off resolveNodeFsPath, the one place a row's file gets
// resolved.

import * as vscode from 'vscode';
import { existsSync, readFileSync } from 'fs';
import { basename, dirname, relative, resolve } from 'path';
import { DitaNode } from '../parser/domTypes';
import { parseDitamap, preprocessEntities } from '../parser/ditaParser';
import { expandDitamapRefs, decodeHrefPart, makeFileTitleResolver, makeFileTopicTypeResolver } from '../editor/ditaRenderUtils';
import { acquireDitaFileWatcher, ditaWatchBase } from '../editor/ditaFileWatcher';
import { buildKeyMap, findDitamapFiles } from '../editor/DitaViewerProvider';
import { createBookRoleLabeler, collectMapEntries } from '../render/mapTypeMap';
import { isDitamapRef } from '../render/mapTypeMap';
import { resolveLocalHrefPath, computeUnreferencedFiles } from '../editor/mapReferenceTools';
import { formatLocalizedRole } from './bookRoleL10n';
import { shouldRefreshMapTree } from './mapTreeRefresh';
import { mapTreeLabel, mapTreeIconId } from './mapTreePresentation';
import {
  ROOT_NODE_ID,
  ExpansionDeviations,
  expansionFor,
  markExpanded,
  markCollapsed,
  nodeIdFor,
  nodeSegment,
  parseExpansionDeviations,
  pruneExpansionDeviations,
  treeItemId,
} from './mapExpansionState';

interface MapTreeNode {
  node: DitaNode;
  mapDir: string;
}

// What shows as a row. keydef is back in the list: it was dropped when the
// tree expanded everything by default, where a bookmap's worth of
// key-defining rows swamped the topic outline. Now that every branch below
// the root map starts collapsed and expand-all is scoped to the selection,
// a keydef row costs one collapsed line until the user asks for it, and
// keydefs (a software manual's product names and version numbers, and the
// maps that define them) are real, navigable content in their own right.
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

/** workspaceState-backed persistence for the tree's expansion state. */
export interface MapExpansionStorage {
  get(): unknown;
  update(value: unknown): Thenable<void>;
}

const EXPANSION_STORAGE_KEY = 'ditaViewer.mapExplorer.expansionByMap';

export class DitaMapTreeProvider implements vscode.TreeDataProvider<MapTreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private mapPath: string | undefined;
  /** Normalized mapPath -- the key expansion state is persisted under. */
  private mapKey: string | undefined;
  private mapRoot: DitaNode | undefined;
  private resolveKey: ((key: string) => string | undefined) | undefined;
  /** Reads a referenced topic's own <title> off disk -- only ever consulted
   *  for entries the map itself never named (see getTreeItem). Rebuilt each
   *  reload so a rename/edit of a topic file is picked up, not stale-cached
   *  across the tree's whole lifetime. */
  private titleResolver: ((href: string) => string | undefined) | undefined;
  /** Root tag of a referenced topic's file ("task", "concept", ...) for the
   *  row's type icon; bounded-read and cached per file, same policy as the
   *  docsite sidebar's type chips. */
  private topicTypeResolver: ((href: string) => string | undefined) | undefined;
  /** Numbered book-division labels ("Chapter 1", …) keyed by node, in document order */
  private roleLabels = new WeakMap<DitaNode, string>();
  /** Parent pointers over the visible tree structure -- see getParent. */
  private parentOf = new WeakMap<DitaNode, DitaNode>();
  /** Structural ids over the same visible structure -- see mapExpansionState.ts. */
  private nodeIds = new WeakMap<DitaNode, string>();
  /** Every id the current tree contains, to prune persisted state against. */
  private knownIds = new Set<string>();
  /** One-off id counter for stale pre-reload rows the view may still render. */
  private staleIdSeq = 0;
  /** Expansion deviations per map, loaded once from storage and written back
   *  debounced -- the slice for the map currently shown is what getTreeItem,
   *  the expand/collapse commands and the chevron event handlers all touch. */
  private deviationsByMap: Record<string, ExpansionDeviations> | undefined;
  private storage: MapExpansionStorage | undefined;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  /** Set by attachTreeView once registerMapTreeView creates it -- see expandAll. */
  private treeView: vscode.TreeView<MapTreeNode> | undefined;
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

  attachStorage(storage: MapExpansionStorage): void {
    this.storage = storage;
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
   * and a reload rebuilds the whole tree, so two reports of one edit must not
   * become two reloads. Which branches were expanded survives the rebuild:
   * rows are re-created with the state recorded per node id, not reset.
   */
  requestRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.reload();
    }, 50);
  }

  private reload(): void {
    this.mapKey = this.mapPath ? resolve(this.mapPath) : undefined;
    this.mapRoot = undefined;
    this.resolveKey = undefined;
    this.titleResolver = undefined;
    this.topicTypeResolver = undefined;
    this.roleLabels = new WeakMap();
    this.parentOf = new WeakMap();
    this.nodeIds = new WeakMap();
    this.knownIds = new Set();
    if (this.mapPath && existsSync(this.mapPath)) {
      try {
        const content = readFileSync(this.mapPath, 'utf-8');
        const doc = parseDitamap(preprocessEntities(content));
        expandDitamapRefs(doc.root, dirname(this.mapPath));
        this.mapRoot = doc.root;
        const keyMap = buildKeyMap(vscode.Uri.file(this.mapPath));
        this.resolveKey = (k: string) => keyMap.get(k);
        this.titleResolver = makeFileTitleResolver(dirname(this.mapPath), undefined, this.resolveKey);
        this.topicTypeResolver = makeFileTopicTypeResolver(dirname(this.mapPath));
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
        // Parent pointers and structural ids over the same *visible*
        // structure getChildren exposes (visibleChildren, not raw
        // node.children -- a topicgroup's children point through it to its
        // own parent, since the topicgroup itself never appears as a tree
        // row). Needed for TreeView.reveal, which requires getParent to
        // walk anything below the top level, and to key expansion state by
        // something that survives a reload.
        const parentWalk = (node: DitaNode): void => {
          const seen = new Map<string, number>();
          for (const child of visibleChildren(node)) {
            const id = nodeIdFor(this.nodeIds.get(node) || ROOT_NODE_ID, child, seen);
            seen.set(nodeSegment(child), (seen.get(nodeSegment(child)) || 0) + 1);
            this.nodeIds.set(child, id);
            this.knownIds.add(id);
            this.parentOf.set(child, node);
            parentWalk(child);
          }
        };
        this.nodeIds.set(doc.root, ROOT_NODE_ID);
        this.knownIds.add(ROOT_NODE_ID);
        parentWalk(doc.root);
      } catch {
        this.mapRoot = undefined;
      }
    }
    this.syncWatcher();
    this._onDidChangeTreeData.fire();
  }

  getParent(element: MapTreeNode): MapTreeNode | null {
    const parentNode = this.parentOf.get(element.node);
    // No parent pointer: the main map's own row (the root), or a stale
    // element from before a reload. Either way there is no row above it.
    if (!parentNode || !this.mapPath) return null;
    return { node: parentNode, mapDir: element.mapDir };
  }

  /** Set once by registerMapTreeView, after the TreeView itself exists. */
  attachTreeView(view: vscode.TreeView<MapTreeNode>): void {
    this.treeView = view;
  }

  /**
   * The node an expand-all/collapse-all acts on, matching Oxygen's DITA
   * Maps Manager: the invoked row when the command comes from its context
   * menu, else the current selection, else the main map -- expanding a
   * whole ditamap in one go is rarely what anyone wants, so with nothing
   * selected the root (one collapsed outline of top-level divisions) is
   * the most useful target, not a reason to refuse.
   */
  private expansionTarget(element: MapTreeNode | undefined): MapTreeNode | undefined {
    if (element && this.nodeIds.get(element.node) !== undefined) return element;
    const selection = this.treeView?.selection || [];
    for (const sel of selection) {
      if (this.nodeIds.get(sel.node) !== undefined) return sel;
    }
    return this.getChildren(undefined)[0];
  }

  private collectBranchIds(node: DitaNode, includeSelf: boolean): string[] {
    const ids: string[] = [];
    const walk = (n: DitaNode, self: boolean): void => {
      const children = visibleChildren(n);
      if (children.length === 0) return;
      if (self) {
        const id = this.nodeIds.get(n);
        if (id !== undefined) ids.push(id);
      }
      for (const child of children) walk(child, true);
    };
    walk(node, includeSelf);
    return ids;
  }

  /**
   * Expands every branch under the target (the target included). The
   * recorded state is what the rows render from -- getTreeItem -- so
   * expanding is: record, fire one data change, and re-anchor the view on
   * the target. That single refresh replaces every row whose state changed
   * (its TreeItem id encodes the state, see mapExpansionState.ts) and
   * leaves every other row untouched, so nothing scrolls: rows above the
   * target never change, and the reveal also restores the selection the
   * row replacement drops. The old implementation walked the subtree
   * calling reveal() on every branch, each reveal scrolling it into view,
   * which is why the view used to end up slid to the end of the map.
   */
  async expandAll(element?: MapTreeNode): Promise<void> {
    const target = this.expansionTarget(element);
    if (!target) return;
    const deviations = this.currentDeviations();
    for (const id of this.collectBranchIds(target.node, true)) markExpanded(deviations, id);
    this.schedulePersist();
    this._onDidChangeTreeData.fire();
    await this.revealTarget(target);
  }

  /**
   * Collapses every branch under the target, the target itself excepted --
   * the row the command was invoked on stays open with its children
   * folded, so "collapse all" on a submap reads as "fold this submap up",
   * not "make my own row a leaf". Collapsing the whole map from the root
   * row lands on the one-level outline a fresh tree starts at.
   */
  async collapseAll(element?: MapTreeNode): Promise<void> {
    const target = this.expansionTarget(element);
    if (!target) return;
    const deviations = this.currentDeviations();
    for (const id of this.collectBranchIds(target.node, false)) markCollapsed(deviations, id);
    this.schedulePersist();
    this._onDidChangeTreeData.fire();
    await this.revealTarget(target);
  }

  /** Re-anchor the view on the node an expand/collapse-all acted on. */
  private async revealTarget(target: MapTreeNode): Promise<void> {
    if (!this.treeView) return;
    try {
      await this.treeView.reveal(target, { select: true, focus: false });
    } catch {
      // A concurrent data refresh can make the resolve race; the rows
      // themselves are already in their recorded state, so losing the
      // re-anchor is cosmetic and not worth surfacing.
    }
  }

  /** Chevron event: record the row's new state so it outlives reloads. */
  noteExpanded(element: MapTreeNode): void {
    this.noteExpansion(element, markExpanded);
  }

  noteCollapsed(element: MapTreeNode): void {
    this.noteExpansion(element, markCollapsed);
  }

  private noteExpansion(
    element: MapTreeNode,
    mark: (deviations: ExpansionDeviations, nodeId: string) => void,
  ): void {
    // Events also arrive for elements of a previous tree generation (a
    // reload re-parses the map); those carry no id and record nothing.
    const id = this.nodeIds.get(element.node);
    if (id === undefined) return;
    const deviations = this.currentDeviations();
    const before = deviations[id];
    mark(deviations, id);
    // Rows are also re-created expanded by the refreshes expand-all
    // triggers; the event that follows confirms the recorded state rather
    // than changing it, and needs no workspaceState write.
    if (deviations[id] === before) return;
    this.schedulePersist();
  }

  private ensureDeviationsRecord(): Record<string, ExpansionDeviations> {
    if (!this.deviationsByMap) {
      const record: Record<string, ExpansionDeviations> = {};
      const raw = this.storage?.get();
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [map, deviations] of Object.entries(raw as Record<string, unknown>)) {
          record[map] = parseExpansionDeviations(deviations);
        }
      }
      this.deviationsByMap = record;
    }
    return this.deviationsByMap;
  }

  /** The recorded expansion deviations of the map currently shown. */
  private currentDeviations(): ExpansionDeviations {
    const record = this.ensureDeviationsRecord();
    const key = this.mapKey || '';
    let slice = record[key];
    if (!slice) {
      slice = {};
      record[key] = slice;
    }
    return slice;
  }

  private schedulePersist(): void {
    if (!this.storage || !this.mapKey) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    // Debounced: expanding a subtree records one id per branch, and a
    // chevron-click burst must not become one workspaceState write each.
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      this.persistNow();
    }, 400);
  }

  private persistNow(): void {
    if (!this.storage || !this.mapKey) return;
    const record = this.ensureDeviationsRecord();
    record[this.mapKey] = pruneExpansionDeviations(this.currentDeviations(), this.knownIds);
    void this.storage.update({ ...record });
  }

  getChildren(element?: MapTreeNode): MapTreeNode[] {
    if (!element) {
      // The main map itself is the single root row: its title (not just
      // its children), the file behind it one click away, and one thing to
      // expand/collapse-all on when nothing is selected.
      if (!this.mapRoot || !this.mapPath) return [];
      const mapDir = dirname(this.mapPath);
      return [{ node: this.mapRoot, mapDir }];
    }
    return visibleChildren(element.node).map((node) => ({ node, mapDir: element.mapDir }));
  }

  getTreeItem(element: MapTreeNode): vscode.TreeItem {
    const { node } = element;
    const isRoot = node === this.mapRoot;
    // A row the view still holds from before a reload re-parses the map:
    // it carries no structural id. Rare (the refresh replaces rows from
    // the top down), transient, and renderable -- but its id must still be
    // unique per row, so it gets a one-off sequence instead of a shared
    // empty string two stale rows would collide on.
    const nodeId = this.nodeIds.get(node) ?? (isRoot ? ROOT_NODE_ID : `stale-${this.staleIdSeq++}`);
    const baseType = node.baseType;
    const href = node.attributes?.href;
    const label = this.labelFor(element);

    const hasChildren = visibleChildren(node).length > 0;
    const mark = hasChildren ? expansionFor(this.currentDeviations(), nodeId) : undefined;
    const item = new vscode.TreeItem(
      label,
      mark === 'e'
        ? vscode.TreeItemCollapsibleState.Expanded
        : mark === 'c'
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
    );
    // The id makes expansion survive reloads (VS Code matches rows by id)
    // and makes a recorded state change re-create the row in that state
    // (the id encodes the state; see mapExpansionState.ts). mapKey in the
    // prefix keeps rows of different maps from ever matching each other.
    item.id = treeItemId(this.mapKey ?? '', nodeId, mark);

    const role = this.roleLabels.get(node);
    const keys = node.attributes?.keys;
    // The main map's row carries the file name next to the title -- which
    // map is showing is the one thing the title itself never says. Below
    // it, only the book-division role label (Chapter 1, Appendix A, ...)
    // earns a permanent spot next to the title, since it's information the
    // title itself never carries; the raw href/keys reference is one hover
    // away via the tooltip.
    item.description = isRoot
      ? this.mapPath
        ? basename(this.mapPath)
        : undefined
      : role || undefined;
    item.tooltip = isRoot ? this.mapPath : href || keys || label;

    const isMapRef = isDitamapRef(node);
    let topicType: string | undefined;
    if (!isRoot && !isMapRef && baseType === 'map/topicref' && href) {
      topicType = this.topicTypeResolver?.(href);
    }
    item.iconPath = new vscode.ThemeIcon(
      mapTreeIconId({ isRoot, isMapRef, baseType, topicType, hasRole: !!role }),
    );

    // Drives which context-menu items a row offers (package.json's
    // view/item/context "viewItem =~ /…/" clauses): "fileRef" rows have a
    // real file on disk behind them -- Oxygen, reveal-in-Explorer and
    // export all need one -- while "hasHref" is broader and also covers a
    // href/keys reference that *didn't* resolve, since copying the raw
    // text is most useful exactly when a link is broken.
    const fsPath = this.resolveNodeFsPath(element);
    item.contextValue = [
      isRoot ? 'root' : 'child',
      fsPath ? 'fileRef' : 'noFile',
      !isRoot && (href || keys) ? 'hasHref' : 'noHref',
    ].join(' ');

    // Click opens the referenced local file
    if (fsPath) {
      item.command = {
        command: 'vscode.open',
        title: vscode.l10n.t('Open File'),
        arguments: [vscode.Uri.file(fsPath)],
      };
    }
    return item;
  }

  /**
   * The absolute on-disk path a row represents: the map file itself for the
   * root row, else the href it resolves to -- or undefined for a row with
   * no href, an external/out-of-scope href, or a href that resolves to a
   * file no longer on disk. Shared by the click-to-open command above and
   * every "act on this row's file" context-menu command below (Oxygen,
   * reveal in Explorer, export, and revealPath's reverse lookup).
   */
  private resolveNodeFsPath(element: MapTreeNode): string | undefined {
    const { node, mapDir } = element;
    if (node === this.mapRoot) {
      return this.mapPath && existsSync(this.mapPath) ? this.mapPath : undefined;
    }
    const href = node.attributes?.href;
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || node.attributes?.scope === 'external') return undefined;
    const filePart = decodeHrefPart(href.split('#')[0]);
    const abs = resolve(mapDir, filePart);
    return existsSync(abs) ? abs : undefined;
  }

  /** The row's rendered title -- same computation getTreeItem's label uses,
   *  factored out so "Copy Title" copies exactly what the row shows. */
  private labelFor(element: MapTreeNode): string {
    const isRoot = element.node === this.mapRoot;
    return mapTreeLabel(element.node, {
      isRoot,
      resolveKey: this.resolveKey,
      readTitle: this.titleResolver ?? (() => undefined),
      rootFallback: this.mapPath ? basename(this.mapPath).replace(/\.ditamap$/i, '') : '',
    });
  }

  /** Row backing this.mapRoot's own href/keys attributes are meaningless
   *  (the root shows the *map*, not one of its own topicrefs), so "Copy
   *  Href" and its "hasHref" contextValue both stay off the root row. */
  private hrefOrKeysFor(element: MapTreeNode): string | undefined {
    if (element.node === this.mapRoot) return undefined;
    return element.node.attributes?.href || element.node.attributes?.keys;
  }

  /** "Open with Oxygen" from a row's context menu: resolve the row to a
   *  file and delegate to the shared command (same one the Explorer and
   *  editor context menus use), so detection/error-handling lives in one
   *  place (oxygenLauncher.ts). */
  async openWithOxygen(element?: MapTreeNode): Promise<void> {
    const fsPath = element && this.resolveNodeFsPath(element);
    if (!fsPath) return;
    await vscode.commands.executeCommand('ditaViewer.openWithOxygen', vscode.Uri.file(fsPath));
  }

  /** "Reveal in Explorer": the mapExplorer-to-file-Explorer direction of
   *  the pair completed by revealPath below (file-Explorer-to-mapExplorer). */
  async revealInExplorer(element?: MapTreeNode): Promise<void> {
    const fsPath = element && this.resolveNodeFsPath(element);
    if (!fsPath) return;
    await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(fsPath));
  }

  /** "Export as HTML" for one row: delegates to the same command the
   *  Explorer/editor context menus use, with the row's own file as the
   *  export root -- the whole map for the root row, or just that
   *  topic/submap for anything else (see resolveNodeFsPath). */
  async exportHtml(element?: MapTreeNode): Promise<void> {
    const fsPath = element && this.resolveNodeFsPath(element);
    if (!fsPath) return;
    await vscode.commands.executeCommand('ditaViewer.exportHtml', vscode.Uri.file(fsPath));
  }

  async copyHref(element?: MapTreeNode): Promise<void> {
    const value = element && this.hrefOrKeysFor(element);
    if (!value) return;
    await vscode.env.clipboard.writeText(value);
  }

  async copyTitle(element?: MapTreeNode): Promise<void> {
    if (!element) return;
    await vscode.env.clipboard.writeText(this.labelFor(element));
  }

  /**
   * "Find Unreferenced Resources": every .dita file under the current
   * map's own folder that no href in this map (at any depth, including
   * spliced-in submaps -- this.mapRoot already has expandDitamapRefs
   * applied, see reload()) resolves to. Scoped to the map's folder rather
   * than the whole workspace, matching Oxygen's DITA Maps Manager, where
   * this is a per-project action, not a workspace-wide one.
   */
  async findUnreferencedResources(): Promise<void> {
    if (!this.mapPath || !this.mapRoot) return;
    const mapDir = dirname(this.mapPath);

    const entries = collectMapEntries(this.mapRoot, this.resolveKey, formatLocalizedRole);
    const referenced: string[] = [];
    for (const entry of entries) {
      const abs = resolveLocalHrefPath(mapDir, entry.href);
      if (abs) referenced.push(abs);
    }

    const found = await vscode.workspace.findFiles(
      new vscode.RelativePattern(mapDir, '**/*.dita'),
      '**/node_modules/**',
      2000,
    );
    const unreferenced = computeUnreferencedFiles(found.map((u) => u.fsPath), referenced, process.platform)
      .map((p) => ({ label: basename(p), description: relative(mapDir, p), fsPath: p }))
      .sort((a, b) => a.label.localeCompare(b.label));

    if (unreferenced.length === 0) {
      vscode.window.showInformationMessage(
        vscode.l10n.t('No unreferenced .dita topics found under {0}.', basename(mapDir)),
      );
      return;
    }
    const picked = await vscode.window.showQuickPick(unreferenced, {
      placeHolder: vscode.l10n.t('{0} unreferenced .dita topic(s) found — select one to open', String(unreferenced.length)),
    });
    if (picked) await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(picked.fsPath));
  }

  /**
   * The file-Explorer-to-mapExplorer direction: reveals and selects the row
   * whose file is fsPath, if the currently shown map has one. Returns
   * false (rather than switching maps or searching the rest of the
   * workspace) when it doesn't -- the caller's job, not this one, to decide
   * what "not part of the current map" should tell the user.
   */
  async revealPath(fsPath: string): Promise<boolean> {
    if (!this.mapRoot || !this.mapPath || !this.treeView) return false;
    const targetAbs = resolve(fsPath);
    const mapDir = dirname(this.mapPath);

    const target =
      resolve(this.mapPath) === targetAbs
        ? { node: this.mapRoot, mapDir }
        : this.findNodeForPath(this.mapRoot, mapDir, targetAbs);
    if (!target) return false;

    try {
      await this.treeView.reveal(target, { select: true, focus: true, expand: true });
    } catch {
      return false; // A concurrent reload raced the reveal; nothing to surface to the user.
    }
    return true;
  }

  /** Depth-first search over the *visible* tree (visibleChildren, matching
   *  everything else keyed by nodeIds/parentOf) for the first row whose
   *  resolveNodeFsPath equals targetAbs. First occurrence in document order
   *  wins when a conref'd topic is reachable through more than one row. */
  private findNodeForPath(node: DitaNode, mapDir: string, targetAbs: string): MapTreeNode | undefined {
    for (const child of visibleChildren(node)) {
      const element = { node: child, mapDir };
      const abs = this.resolveNodeFsPath(element);
      if (abs && resolve(abs) === targetAbs) return element;
      const nested = this.findNodeForPath(child, mapDir, targetAbs);
      if (nested) return nested;
    }
    return undefined;
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
   * Releases the pending reload, the pending persist and this tree's share
   * of the folder watcher. Wired into context.subscriptions, so it runs on
   * deactivation.
   *
   * The timers have to be cleared, not just the watcher released: a reload
   * or a workspaceState write firing after deactivation would rebuild a
   * tree nobody is listening to, and would keep reading the map off disk
   * in a session that is supposed to be over.
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
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = undefined;
    this.persistNow();
    this.watcherSubscription?.dispose();
    this.watcherSubscription = undefined;
    this.watchedBase = undefined;
  }
}

/** What registerMapTreeView hands back to extension.ts -- just enough to
 *  wire the Explorer-side "Reveal in Map Navigator" command
 *  (ditaViewer.revealInMapExplorer) without exposing the provider itself. */
export interface MapTreeViewHandle {
  revealPath(fsPath: string): Promise<boolean>;
}

export function registerMapTreeView(context: vscode.ExtensionContext): MapTreeViewHandle {
  const provider = new DitaMapTreeProvider();
  vscode.commands.executeCommand('setContext', 'ditaViewer.mapExplorer.pinned', false);
  // createTreeView (rather than the plain registerTreeDataProvider) because
  // the returned TreeView is what expand/collapse-all and the chevron event
  // handlers need. showCollapseAll is deliberately off: the native button
  // collapses the whole tree from a fixed slot at the far end of the title
  // bar -- it can't sit next to Expand All, and it can't act on the
  // selection like the rest of the pair.
  const treeView = vscode.window.createTreeView('ditaViewer.mapExplorer', {
    treeDataProvider: provider,
  });
  provider.attachTreeView(treeView);
  provider.attachStorage({
    get: () => context.workspaceState.get(EXPANSION_STORAGE_KEY),
    update: (value) => context.workspaceState.update(EXPANSION_STORAGE_KEY, value),
  });
  context.subscriptions.push(
    treeView,
    vscode.commands.registerCommand('ditaViewer.mapExplorer.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('ditaViewer.mapExplorer.selectMap', () => provider.selectMap()),
    vscode.commands.registerCommand('ditaViewer.mapExplorer.pin', () => provider.pin()),
    vscode.commands.registerCommand('ditaViewer.mapExplorer.unpin', () => provider.unpin()),
    // The element argument arrives when the command is invoked from a row's
    // context menu; from the title bar buttons it is undefined and the
    // provider falls back to the selection, then the main map.
    vscode.commands.registerCommand('ditaViewer.mapExplorer.expandAll', (node?: MapTreeNode) =>
      provider.expandAll(node),
    ),
    vscode.commands.registerCommand('ditaViewer.mapExplorer.collapseAll', (node?: MapTreeNode) =>
      provider.collapseAll(node),
    ),
    // Row context-menu commands. Each takes the row's element (passed by
    // VS Code from view/item/context) and delegates to the provider method
    // of the same name.
    vscode.commands.registerCommand('ditaViewer.mapExplorer.openWithOxygen', (node?: MapTreeNode) =>
      provider.openWithOxygen(node),
    ),
    vscode.commands.registerCommand('ditaViewer.mapExplorer.revealInExplorer', (node?: MapTreeNode) =>
      provider.revealInExplorer(node),
    ),
    vscode.commands.registerCommand('ditaViewer.mapExplorer.exportHtml', (node?: MapTreeNode) =>
      provider.exportHtml(node),
    ),
    vscode.commands.registerCommand('ditaViewer.mapExplorer.copyHref', (node?: MapTreeNode) =>
      provider.copyHref(node),
    ),
    vscode.commands.registerCommand('ditaViewer.mapExplorer.copyTitle', (node?: MapTreeNode) =>
      provider.copyTitle(node),
    ),
    vscode.commands.registerCommand('ditaViewer.mapExplorer.findUnreferenced', () =>
      provider.findUnreferencedResources(),
    ),
    // Chevron clicks (and the row replacements a data change performs)
    // report their element; recording the resulting state is what makes it
    // survive the next reload and the next session.
    treeView.onDidExpandElement((e) => provider.noteExpanded(e.element)),
    treeView.onDidCollapseElement((e) => provider.noteCollapsed(e.element)),
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
  return { revealPath: (fsPath: string) => provider.revealPath(fsPath) };
}
