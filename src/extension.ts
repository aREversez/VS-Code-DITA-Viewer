import * as vscode from 'vscode';
import { DitaViewerProvider } from './editor/DitaViewerProvider';
import { MapViewerProvider } from './editor/MapViewerProvider';

export function activate(context: vscode.ExtensionContext) {
  // DITA topic preview (.dita)
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

  // DITAMAP preview (.ditamap)
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'ditaViewer.mapPreview',
      new MapViewerProvider(context),
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
