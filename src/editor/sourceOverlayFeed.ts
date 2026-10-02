import * as vscode from 'vscode';
import { syncDocumentToOverlay } from './sourceOverlaySync';

/**
 * Fires, after the overlay has been updated, for every DITA document whose
 * source (as sourceText.ts sees it) just changed because of the editor: text
 * typed, then reverted, saved or discarded. ditaFileWatcher.ts forwards these
 * to the panels of the folder they are in.
 *
 * Its own emitter rather than the raw onDidChangeTextDocument, so a listener
 * can never run before the overlay it is about to render from is current.
 */
const changed = new vscode.EventEmitter<vscode.Uri>();
export const onDidChangeSourceText = changed.event;

function sync(doc: vscode.TextDocument, closed = false): void {
  const didChange = syncDocumentToOverlay({
    fsPath: doc.uri.fsPath,
    scheme: doc.uri.scheme,
    isDirty: doc.isDirty,
    isClosed: closed,
    getText: () => doc.getText(),
  });
  if (didChange) changed.fire(doc.uri);
}

export function registerSourceOverlay(context: vscode.ExtensionContext): void {
  // Documents that were already open and modified when the extension
  // activated (a window reload restores dirty buffers).
  for (const doc of vscode.workspace.textDocuments) sync(doc);
  context.subscriptions.push(
    changed,
    vscode.workspace.onDidOpenTextDocument((doc) => sync(doc)),
    vscode.workspace.onDidChangeTextDocument((e) => sync(e.document)),
    vscode.workspace.onDidSaveTextDocument((doc) => sync(doc)),
    vscode.workspace.onDidCloseTextDocument((doc) => sync(doc, true)),
  );
}
