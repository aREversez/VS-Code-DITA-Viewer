// The DITA file the user is working on: the active text editor when it holds a
// .dita / .ditamap, otherwise the active custom-editor tab (a reading view).
//
// Its own module because it is needed all over (commands, the completeness
// checks, the diff provider) and used to live in exportHtml.ts, which imports
// the preview provider; anything that wanted this one function then closed an
// import cycle back to the provider.

import * as vscode from 'vscode';

export function getActiveDitaUri(): vscode.Uri | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor && /\.(dita|ditamap)$/i.test(editor.document.uri.fsPath)) {
    return editor.document.uri;
  }
  // Also works while a reading-view (custom editor) tab is active
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (tab?.input instanceof vscode.TabInputCustom && /\.(dita|ditamap)$/i.test(tab.input.uri.fsPath)) {
    return tab.input.uri;
  }
  return undefined;
}
