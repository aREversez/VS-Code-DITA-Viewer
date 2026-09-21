import * as vscode from 'vscode';
import { chooseSourcePlacement, touchRecent } from './sourceEditorPlacement';

// The VS Code API does not expose the order in which tab groups were last
// active (tabGroups.all is left-to-right), so it is tracked here from the
// moment the extension activates. Most recent first.
let recentGroups: vscode.TabGroup[] = [];

export function registerSourceEditorTracker(context: vscode.ExtensionContext): void {
  const active = vscode.window.tabGroups.activeTabGroup;
  if (active) recentGroups = [active];
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabGroups((e) => {
      for (const g of e.closed) recentGroups = recentGroups.filter((r) => r !== g);
      const nowActive = vscode.window.tabGroups.activeTabGroup;
      if (nowActive) recentGroups = touchRecent(recentGroups, nowActive);
    }),
  );
}

/**
 * Opens `uri` in the plain text editor, in a tab group other than the
 * preview's (`previewColumn` is the preview panel's own column).
 * Explicitly the 'default' editor -- a plain showTextDocument could be routed
 * back into the preview custom editor.
 */
export async function openSourceBesidePreview(uri: vscode.Uri, previewColumn: vscode.ViewColumn | undefined): Promise<void> {
  const groups = vscode.window.tabGroups.all;
  const previewGroup = groups.find((g) => g.viewColumn === previewColumn);
  const placement = chooseSourcePlacement(
    groups.map((g) => ({
      key: g,
      textUris: g.tabs.flatMap((t) => (t.input instanceof vscode.TabInputText ? [t.input.uri.toString()] : [])),
    })),
    previewGroup,
    recentGroups,
    uri.toString(),
  );
  const viewColumn = placement.kind === 'group' ? placement.key.viewColumn : vscode.ViewColumn.Beside;
  try {
    await vscode.commands.executeCommand('vscode.openWith', uri, 'default', { viewColumn, preview: false });
  } catch (err) {
    void vscode.window.showErrorMessage(vscode.l10n.t('Could not open {0}: {1}', uri.fsPath, String(err)));
  }
}
