// The "Map Checks" view in the Explorer: results of Find Unreferenced
// Resources (and, in a later change, the completeness check) as a native
// tree, in the same spot and style as Search or Problems results -- click to
// open, inline Run Again, a welcome panel with buttons before anything ran.

import * as vscode from 'vscode';
import { basename } from 'path';
import { groupByFolder } from './mapCheckResultsModel';

export const RESULTS_VIEW_ID = 'ditaViewer.mapChecks';

export interface UnreferencedState {
  maps: string[];
  folders: string[];
  scanned: number;
  files: string[];
  /** Referenced files that could not be read/parsed; what they reference is unknown. */
  unreadable: number;
}

type Node =
  | { kind: 'unreferenced' }
  | { kind: 'group'; label: string; files: string[] }
  | { kind: 'file'; path: string };

export class MapChecksView implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private unreferenced: UnreferencedState | undefined;
  private readonly view: vscode.TreeView<Node>;

  constructor() {
    this.view = vscode.window.createTreeView<Node>(RESULTS_VIEW_ID, { treeDataProvider: this, showCollapseAll: true });
  }

  get lastUnreferenced(): UnreferencedState | undefined {
    return this.unreferenced;
  }

  setUnreferenced(state: UnreferencedState): void {
    this.unreferenced = state;
    this.update();
    this.changed.fire(undefined);
  }

  clear(): void {
    this.unreferenced = undefined;
    this.update();
    this.changed.fire(undefined);
  }

  /** Brings the view forward (opens the Explorer sidebar section if hidden). */
  async reveal(): Promise<void> {
    const first = this.getRootNodes()[0];
    if (first) await this.view.reveal(first, { focus: false, select: false, expand: true });
  }

  private update(): void {
    const u = this.unreferenced;
    void vscode.commands.executeCommand('setContext', 'ditaViewer.mapChecks.hasResults', !!u);
    this.view.badge = u && u.files.length > 0 ? { value: u.files.length, tooltip: vscode.l10n.t('{0} unreferenced resource(s)', String(u.files.length)) } : undefined;
    this.view.message = undefined;
  }

  private getRootNodes(): Node[] {
    return this.unreferenced ? [{ kind: 'unreferenced' }] : [];
  }

  getParent(node: Node): Node | undefined {
    if (node.kind === 'unreferenced') return undefined;
    return this.unreferenced ? { kind: 'unreferenced' } : undefined;
  }

  getChildren(node?: Node): Node[] {
    if (!node) return this.getRootNodes();
    const u = this.unreferenced;
    if (!u) return [];
    if (node.kind === 'unreferenced') {
      if (u.files.length === 0) return [];
      return groupByFolder(u.files, u.folders).map((g) => ({ kind: 'group', label: g.label, files: g.files }));
    }
    if (node.kind === 'group') return node.files.map((path) => ({ kind: 'file', path }));
    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    const u = this.unreferenced;
    if (node.kind === 'unreferenced' && u) {
      const item = new vscode.TreeItem(
        vscode.l10n.t('Unreferenced Resources'),
        u.files.length === 0 ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Expanded,
      );
      const mapNames = u.maps.map((m) => basename(m)).join(', ');
      item.description = u.files.length === 0 ? vscode.l10n.t('none · {0}', mapNames) : `${u.files.length} · ${mapNames}`;
      item.iconPath = new vscode.ThemeIcon(u.files.length === 0 ? 'pass' : 'files');
      item.contextValue = 'mapChecks.unreferenced';
      const tip = new vscode.MarkdownString();
      tip.appendMarkdown(
        vscode.l10n.t('{0} unreferenced of {1} file(s) checked', String(u.files.length), String(u.scanned)) +
          '\n\n' +
          u.maps.map((m) => `- \`${m}\``).join('\n') +
          '\n\n' +
          u.folders.map((f) => `- \`${f}\``).join('\n'),
      );
      if (u.unreadable > 0) {
        tip.appendMarkdown(
          '\n\n' +
            vscode.l10n.t('{0} referenced file(s) could not be read or parsed, so what they reference may be reported as unreferenced.', String(u.unreadable)),
        );
      }
      item.tooltip = tip;
      return item;
    }
    if (node.kind === 'group') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.description = String(node.files.length);
      item.iconPath = vscode.ThemeIcon.Folder;
      item.contextValue = 'mapChecks.group';
      return item;
    }
    if (node.kind === 'file') {
      const uri = vscode.Uri.file(node.path);
      const item = new vscode.TreeItem(uri, vscode.TreeItemCollapsibleState.None);
      item.command = { command: 'vscode.open', title: vscode.l10n.t('Open'), arguments: [uri, { preview: true }] };
      item.contextValue = 'mapChecks.file';
      item.tooltip = node.path;
      return item;
    }
    return new vscode.TreeItem('');
  }
}

/** Commands that act on a results node (context menu / inline). */
export function registerResultsCommands(context: vscode.ExtensionContext, view: MapChecksView): void {
  const pathOf = (node: unknown): string | undefined =>
    node && typeof node === 'object' && (node as { kind?: string }).kind === 'file' ? (node as { path: string }).path : undefined;
  context.subscriptions.push(
    vscode.commands.registerCommand('ditaViewer.mapChecks.clear', () => view.clear()),
    vscode.commands.registerCommand('ditaViewer.mapChecks.reveal', (node: unknown) => {
      const p = pathOf(node);
      if (p) return vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(p));
    }),
    vscode.commands.registerCommand('ditaViewer.mapChecks.copyPath', async (node: unknown) => {
      const p = pathOf(node);
      if (p) await vscode.env.clipboard.writeText(p);
    }),
  );
}
