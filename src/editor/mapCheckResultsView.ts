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

export interface CompletenessItem {
  file: string;
  line: number;
  severity: 'error' | 'warning' | 'info';
  text: string;
  /** Other places involved (the first definition of a duplicate, …). */
  related?: Array<{ file: string; line: number }>;
}

export interface CompletenessState {
  map: string;
  /** Findings grouped by category, in display order. */
  groups: Array<{ label: string; items: CompletenessItem[] }>;
  errors: number;
  warnings: number;
}

type Node =
  | { kind: 'unreferenced' }
  | { kind: 'group'; label: string; files: string[] }
  | { kind: 'file'; path: string }
  | { kind: 'completeness' }
  | { kind: 'category'; label: string; items: CompletenessItem[] }
  | { kind: 'issue'; item: CompletenessItem };

export class MapChecksView implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private unreferenced: UnreferencedState | undefined;
  private completeness: CompletenessState | undefined;
  private lastUpdated: 'unreferenced' | 'completeness' = 'unreferenced';
  private readonly view: vscode.TreeView<Node>;

  constructor() {
    this.view = vscode.window.createTreeView<Node>(RESULTS_VIEW_ID, { treeDataProvider: this, showCollapseAll: true });
  }

  get lastUnreferenced(): UnreferencedState | undefined {
    return this.unreferenced;
  }

  get lastCompleteness(): CompletenessState | undefined {
    return this.completeness;
  }

  setUnreferenced(state: UnreferencedState): void {
    this.unreferenced = state;
    this.lastUpdated = 'unreferenced';
    this.update();
  }

  setCompleteness(state: CompletenessState): void {
    this.completeness = state;
    this.lastUpdated = 'completeness';
    this.update();
  }

  clear(): void {
    this.unreferenced = undefined;
    this.completeness = undefined;
    this.update();
  }

  /** Brings the view forward (opens the Explorer sidebar section if hidden) on the most recent result. */
  async reveal(): Promise<void> {
    const node: Node = this.lastUpdated === 'completeness' ? { kind: 'completeness' } : { kind: 'unreferenced' };
    if (this.getRootNodes().some((n) => n.kind === node.kind)) {
      await this.view.reveal(node, { focus: false, select: false, expand: true });
    }
  }

  private update(): void {
    const u = this.unreferenced;
    const c = this.completeness;
    void vscode.commands.executeCommand('setContext', 'ditaViewer.mapChecks.hasResults', !!(u || c));
    const total = (u?.files.length ?? 0) + (c ? c.errors + c.warnings : 0);
    this.view.badge = total > 0 ? { value: total, tooltip: vscode.l10n.t('{0} finding(s)', String(total)) } : undefined;
    this.changed.fire(undefined);
  }

  private getRootNodes(): Node[] {
    const roots: Node[] = [];
    if (this.unreferenced) roots.push({ kind: 'unreferenced' });
    if (this.completeness) roots.push({ kind: 'completeness' });
    return roots;
  }

  getParent(): undefined {
    return undefined;
  }

  getChildren(node?: Node): Node[] {
    if (!node) return this.getRootNodes();
    if (node.kind === 'completeness' || node.kind === 'category') return this.getCompletenessChildren(node);
    const u = this.unreferenced;
    if (!u) return [];
    if (node.kind === 'unreferenced') {
      if (u.files.length === 0) return [];
      return groupByFolder(u.files, u.folders).map((g) => ({ kind: 'group', label: g.label, files: g.files }));
    }
    if (node.kind === 'group') return node.files.map((path) => ({ kind: 'file', path }));
    return [];
  }

  private getCompletenessChildren(node: Node): Node[] {
    const c = this.completeness;
    if (!c) return [];
    if (node.kind === 'completeness') return c.groups.map((g) => ({ kind: 'category', label: g.label, items: g.items }));
    if (node.kind === 'category') return node.items.map((item) => ({ kind: 'issue', item }));
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
    const c = this.completeness;
    if (node.kind === 'completeness' && c) {
      const total = c.errors + c.warnings;
      const item = new vscode.TreeItem(
        vscode.l10n.t('Completeness Check'),
        c.groups.length === 0 ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Expanded,
      );
      item.description = total === 0 ? vscode.l10n.t('no problems · {0}', basename(c.map)) : `${total} · ${basename(c.map)}`;
      item.iconPath =
        total === 0
          ? new vscode.ThemeIcon('pass')
          : c.errors > 0
            ? new vscode.ThemeIcon('error', new vscode.ThemeColor('problemsErrorIcon.foreground'))
            : new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
      item.contextValue = 'mapChecks.completeness';
      item.tooltip = new vscode.MarkdownString(
        vscode.l10n.t('{0} error(s), {1} warning(s)', String(c.errors), String(c.warnings)) + `\n\n\`${c.map}\``,
      );
      return item;
    }
    if (node.kind === 'category') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.description = String(node.items.length);
      item.contextValue = 'mapChecks.category';
      return item;
    }
    if (node.kind === 'issue') {
      const i = node.item;
      const item = new vscode.TreeItem(i.text, vscode.TreeItemCollapsibleState.None);
      item.description = `${basename(i.file)}:${i.line}`;
      item.iconPath =
        i.severity === 'error'
          ? new vscode.ThemeIcon('error', new vscode.ThemeColor('problemsErrorIcon.foreground'))
          : i.severity === 'warning'
            ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'))
            : new vscode.ThemeIcon('info', new vscode.ThemeColor('problemsInfoIcon.foreground'));
      const line = Math.max(0, i.line - 1);
      const uri = vscode.Uri.file(i.file);
      item.command = {
        command: 'vscode.open',
        title: vscode.l10n.t('Open'),
        arguments: [uri, { selection: new vscode.Range(line, 0, line, 0), preview: true }],
      };
      const tip = new vscode.MarkdownString(`${i.text}\n\n\`${i.file}:${i.line}\``);
      for (const r of i.related ?? []) tip.appendMarkdown('\n\n' + vscode.l10n.t('First occurrence: {0}', `\`${r.file}:${r.line}\``));
      item.tooltip = tip;
      item.contextValue = 'mapChecks.issue';
      return item;
    }
    return new vscode.TreeItem('');
  }
}

/** Commands that act on a results node (context menu / inline). */
export function registerResultsCommands(context: vscode.ExtensionContext, view: MapChecksView): void {
  const pathOf = (node: unknown): string | undefined => {
    const n = node as { kind?: string; path?: string; item?: CompletenessItem } | undefined;
    if (n?.kind === 'file') return n.path;
    if (n?.kind === 'issue') return n.item?.file;
    return undefined;
  };
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
