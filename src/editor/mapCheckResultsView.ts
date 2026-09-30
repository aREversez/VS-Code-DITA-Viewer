// The "Map Checks" view in the Explorer: results of Validate and Check for
// Completeness as a native tree -- click a finding to jump to its line.

import * as vscode from 'vscode';
import { basename } from 'path';

export const RESULTS_VIEW_ID = 'ditaViewer.mapChecks';

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
  | { kind: 'completeness' }
  | { kind: 'category'; label: string; items: CompletenessItem[] }
  | { kind: 'issue'; item: CompletenessItem };

export class MapChecksView implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private completeness: CompletenessState | undefined;
  private readonly view: vscode.TreeView<Node>;

  constructor() {
    this.view = vscode.window.createTreeView<Node>(RESULTS_VIEW_ID, { treeDataProvider: this, showCollapseAll: true });
  }

  get lastCompleteness(): CompletenessState | undefined {
    return this.completeness;
  }

  setCompleteness(state: CompletenessState): void {
    this.completeness = state;
    this.update();
  }

  clear(): void {
    this.completeness = undefined;
    this.update();
  }

  /** Brings the view forward (opens the Explorer sidebar section if hidden). */
  async reveal(): Promise<void> {
    if (this.completeness) await this.view.reveal({ kind: 'completeness' }, { focus: false, select: false, expand: true });
  }

  private update(): void {
    const c = this.completeness;
    void vscode.commands.executeCommand('setContext', 'ditaViewer.mapChecks.hasResults', !!c);
    const total = c ? c.errors + c.warnings : 0;
    this.view.badge = total > 0 ? { value: total, tooltip: vscode.l10n.t('{0} finding(s)', String(total)) } : undefined;
    this.changed.fire(undefined);
  }

  getParent(): undefined {
    return undefined;
  }

  getChildren(node?: Node): Node[] {
    const c = this.completeness;
    if (!c) return [];
    if (!node) return [{ kind: 'completeness' }];
    if (node.kind === 'completeness') return c.groups.map((g) => ({ kind: 'category', label: g.label, items: g.items }));
    if (node.kind === 'category') return node.items.map((item) => ({ kind: 'issue', item }));
    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
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
  const fileOf = (node: unknown): string | undefined => {
    const n = node as { kind?: string; item?: CompletenessItem } | undefined;
    return n?.kind === 'issue' ? n.item?.file : undefined;
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('ditaViewer.mapChecks.clear', () => view.clear()),
    vscode.commands.registerCommand('ditaViewer.mapChecks.reveal', (node: unknown) => {
      const p = fileOf(node);
      if (p) return vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(p));
    }),
    vscode.commands.registerCommand('ditaViewer.mapChecks.copyPath', async (node: unknown) => {
      const p = fileOf(node);
      if (p) await vscode.env.clipboard.writeText(p);
    }),
  );
}
