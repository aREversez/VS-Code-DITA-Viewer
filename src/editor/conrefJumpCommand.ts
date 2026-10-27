import * as vscode from 'vscode';
import { ConrefJumpTarget } from './conrefJump';
import { openSourceBesidePreview } from './sourceEditorOpener';

/**
 * Opens a conref target's source beside the preview with the cursor on the
 * referenced element. Clamped to the file's current length: the target may
 * have been edited since the preview rendered.
 */
export async function openConrefTarget(
  target: ConrefJumpTarget,
  previewColumn: vscode.ViewColumn | undefined,
): Promise<void> {
  const uri = vscode.Uri.file(target.file);
  let line = target.line;
  let col = target.col;
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    line = Math.min(line, Math.max(0, doc.lineCount - 1));
    col = Math.min(col, doc.lineAt(line).text.length);
  } catch {
    // Unreadable or missing: openSourceBesidePreview reports it.
  }
  const pos = new vscode.Position(line, col);
  await openSourceBesidePreview(uri, previewColumn, new vscode.Range(pos, pos));
}
