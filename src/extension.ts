import * as vscode from 'vscode';
import { DitaViewerProvider } from './editor/DitaViewerProvider';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'ditaViewer.preview',
      new DitaViewerProvider(context),
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      },
    ),
  );

  const showRenderedCommand = vscode.commands.registerCommand(
    'ditaViewer.showRendered',
    () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      vscode.commands.executeCommand(
        'vscode.openWith',
        editor.document.uri,
        'ditaViewer.preview',
          vscode.ViewColumn.Beside,
      );
    },
  );

  context.subscriptions.push(showRenderedCommand);
}
