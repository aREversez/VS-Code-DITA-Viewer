// Keeps the reference resolvers inside the workspace.
//
// conref / conkeyref / title lookups read the file an author's href names. With
// `href="../../../somewhere/else.dita"` (or an absolute path) that is any XML
// file on the machine, and an export would carry its content. @dita-viewer/core
// has a process-wide read boundary for this (setReadRoots); this keeps it equal
// to the open workspace folders, and lifts it when no folder is open, where
// there is no workspace to be inside of.

import * as vscode from 'vscode';
import { setReadRoots } from '@dita-viewer/core';

export function currentWorkspaceRoots(): string[] {
  return (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
}

export function registerReadBoundary(context: vscode.ExtensionContext): void {
  const apply = (): void => setReadRoots(currentWorkspaceRoots());
  apply();
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(apply),
    { dispose: () => setReadRoots(undefined) },
  );
}
