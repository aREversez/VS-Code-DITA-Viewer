// Explorer sidebar tree view of the DITA map associated with the active
// editor: keeps the map structure visible while editing any .dita file,
// with click-to-open navigation on every referenced topic.

import * as vscode from 'vscode';
import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { DitaNode } from '../parser/domTypes';
import { parseDitamap, preprocessEntities } from '../parser/ditaParser';
import { expandDitamapRefs } from '../editor/ditaRenderUtils';
import { buildKeyMap, findDitamapFiles } from '../editor/DitaViewerProvider';
import { createBookRoleLabeler, getDisplayName } from '../render/mapTypeMap';
import { formatLocalizedRole } from './bookRoleL10n';

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
  /** Numbered book-division labels ("Chapter 1", …) keyed by node, in document order */
  private roleLabels = new WeakMap<DitaNode, string>();

  /** Re-evaluates which map to show based on the active editor's document. */
  setActiveDocument(uri: vscode.Uri | undefined): void {
    if (!uri) return; // Keep the last map when focus moves to non-file views
    const fsPath = uri.fsPath;
    let nextMap: string | undefined;
    if (fsPath.toLowerCase().endsWith('.ditamap')) {
      nextMap = fsPath;
    } else if (fsPath.toLowerCase().endsWith('.dita')) {
      nextMap = findDitamapFiles(uri)[0];
    } else {
      return; // Unrelated file type: keep showing the current map
    }
    // Keep the sidebar view visible even when the user moves on to other files
    vscode.commands.executeCommand('setContext', 'ditaViewer.hasMap', true);
    if (nextMap && resolve(nextMap) !== (this.mapPath ? resolve(this.mapPath) : undefined)) {
      this.mapPath = nextMap;
      this.reload();
    } else if (!this.mapRoot && nextMap) {
      this.mapPath = nextMap;
      this.reload();
    }
  }

  refresh(): void {
    this.reload();
  }

  private reload(): void {
    this.mapRoot = undefined;
    this.resolveKey = undefined;
    this.roleLabels = new WeakMap();
    if (this.mapPath && existsSync(this.mapPath)) {
      try {
        const content = readFileSync(this.mapPath, 'utf-8');
        const doc = parseDitamap(preprocessEntities(content));
        expandDitamapRefs(doc.root, dirname(this.mapPath));
        this.mapRoot = doc.root;
        const keyMap = buildKeyMap(vscode.Uri.file(this.mapPath));
        this.resolveKey = (k: string) => keyMap.get(k);
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
    const label =
      baseType === 'map/bookmap-structural'
        ? node.tagName || '(container)'
        : getDisplayName(node, this.resolveKey);
    const hasChildren = visibleChildren(node).length > 0;
    const item = new vscode.TreeItem(
      label,
      hasChildren ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
    );

    const role = this.roleLabels.get(node);
    const href = node.attributes?.href;
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
      const filePart = href.split('#')[0];
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
}

export function registerMapTreeView(context: vscode.ExtensionContext): void {
  const provider = new DitaMapTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('ditaViewer.mapExplorer', provider),
    vscode.commands.registerCommand('ditaViewer.mapExplorer.refresh', () => provider.refresh()),
    vscode.window.onDidChangeActiveTextEditor((editor) =>
      provider.setActiveDocument(editor?.document.uri),
    ),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.uri.fsPath.toLowerCase().endsWith('.ditamap')) provider.refresh();
    }),
  );
  provider.setActiveDocument(vscode.window.activeTextEditor?.document.uri);
}
