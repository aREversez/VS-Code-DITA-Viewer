import * as vscode from 'vscode';

/**
 * Finds the folder that bounds an upward directory walk from a document --
 * the workspace folder that actually contains it in a multi-root workspace,
 * the first workspace folder if there's exactly one workspace but the
 * document sits outside all of its folders, or the filesystem root with no
 * workspace open at all. Shared between CSS discovery (cssDiscovery.ts) and
 * ditamap discovery (keyMap.ts), both of which walk upward from a
 * document's directory looking for files and need the same stopping point
 * so neither silently walks past the workspace boundary into unrelated
 * parent folders.
 */
export function parseDocRoot(dir: string): string {
  const owner = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(dir));
  if (owner) return owner.uri.fsPath;
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) return folders[0].uri.fsPath;
  const sep = dir.includes('/') ? '/' : '\\';
  const parts = dir.split(/[\\/]/);
  // POSIX: root is "/", Windows: root is "C:\"
  if (sep === '/') return '/' + parts.slice(1, 2).join('/');
  return parts.length > 2 ? parts.slice(0, 2).join('\\') : dir;
}
