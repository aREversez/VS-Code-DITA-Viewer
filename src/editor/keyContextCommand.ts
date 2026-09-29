// ── "Select Key Context Map" command, status bar item and persistence ──
//
// The vscode side of keyContext.ts: restores the choice for this workspace,
// stores it whenever it changes, lets the user pick it, and shows what is in
// force. Refreshing the previews, map tree and diagnostics is done by each of
// them subscribing to onKeyContextChanged, not from here.

import * as vscode from 'vscode';
import { basename } from 'path';
import { getKeyContextMap, setKeyContextMap, onKeyContextChanged, onKeyContextMissing } from './keyContext';
import { buildContextPickItems, contextStatusText, shouldShowContextStatus } from './keyContextPicker';

export const SELECT_KEY_CONTEXT_CMD = 'ditaViewer.selectContextMap';

/** workspaceState key: absolute path of this workspace's context map. */
const KEY_CONTEXT_STATE_KEY = 'ditaViewer.keyContextMap';

const MAP_SEARCH_LIMIT = 500;

/**
 * The file in front of the user. A preview is a custom editor, not a text
 * editor, so window.activeTextEditor is empty while one is active; the active
 * tab's input covers both.
 */
function activeDitaFilePath(): string | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) return input.uri.fsPath;
  return vscode.window.activeTextEditor?.document.uri.fsPath;
}

export function registerKeyContextCommand(context: vscode.ExtensionContext): void {
  const stored = context.workspaceState.get<string>(KEY_CONTEXT_STATE_KEY);
  if (typeof stored === 'string' && stored) setKeyContextMap(stored);

  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  item.command = SELECT_KEY_CONTEXT_CMD;

  const updateItem = () => {
    const current = getKeyContextMap();
    item.text = contextStatusText(current, vscode.l10n.t('Keys: auto'));
    item.tooltip = current
      ? vscode.l10n.t('Key context map: {0}\nEvery keyref resolves against this map. Click to change.', current)
      : vscode.l10n.t('No key context map: keys come from the maps around each file. Click to choose one.');
    // Only where it is relevant: a DITA file (source or preview) is in front
    // of the user, or a context is in force (which then must stay visible and
    // clearable).
    if (shouldShowContextStatus(activeDitaFilePath(), current !== undefined)) item.show();
    else item.hide();
  };
  updateItem();

  context.subscriptions.push(
    item,
    vscode.window.onDidChangeActiveTextEditor(updateItem),
    vscode.window.tabGroups.onDidChangeTabs(updateItem),
    vscode.window.tabGroups.onDidChangeTabGroups(updateItem),
    onKeyContextChanged(() => {
      void context.workspaceState.update(KEY_CONTEXT_STATE_KEY, getKeyContextMap());
      updateItem();
    }),
    // The chosen file was deleted or renamed: drop the choice (the key map
    // has already fallen back to the surrounding maps) and say so once.
    onKeyContextMissing((path) => {
      // Reported from inside buildKeyMap, i.e. in the middle of a render:
      // clearing synchronously would make every subscriber re-render from
      // within it. Defer, and only clear if that is still the chosen map (the
      // user may have picked another in the meantime).
      setTimeout(() => {
        if (getKeyContextMap() === path) setKeyContextMap(undefined);
      }, 0);
      void vscode.window.showInformationMessage(
        vscode.l10n.t(
          'The key context map {0} no longer exists. Keys are resolved from the surrounding maps again.',
          basename(path),
        ),
      );
    }),
    vscode.commands.registerCommand(SELECT_KEY_CONTEXT_CMD, async () => {
      const found = await vscode.workspace.findFiles('**/*.ditamap', '**/node_modules/**', MAP_SEARCH_LIMIT);
      const items = buildContextPickItems(
        found.map((u) => u.fsPath),
        getKeyContextMap(),
        vscode.l10n.t('No context (resolve keys from the maps around each file)'),
        (p) => vscode.workspace.asRelativePath(p),
      );
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: vscode.l10n.t('Select the map that every keyref resolves against'),
        matchOnDescription: true,
      });
      if (!picked) return;
      setKeyContextMap(picked.path);
    }),
  );
}
