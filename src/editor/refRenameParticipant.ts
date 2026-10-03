// VS Code integration layer for rename reference updates. Wraps the pure
// computeRefEdits function from refRenameEdits.ts and registers a
// FileRenameParticipant that updates href/conref references when DITA files
// are renamed or moved in the Explorer.
//
// Every edit is returned from onWillRenameFiles inside a single WorkspaceEdit,
// on purpose. That makes VS Code treat "rename + reference edits" as one
// refactor operation, which is what buys us three things at once:
//   - "Show Preview" lists every reference change (the notification the user
//     needs to know the update happened and what it touched);
//   - "Skip Changes" discards all of them, not just the ones on open files;
//   - undoing / discarding the rename reverts the reference edits with it,
//     because they live in the same undo group.
// The cost is that while VS Code's refactor dialog is up, the Explorer renders
// the row being renamed with a blank label. That is VS Code's own File Explorer
// behaviour — an extension cannot override a File Explorer label — so it is
// accepted here in exchange for the correct undo/preview semantics above.

import * as vscode from 'vscode';
import { readFile } from 'fs/promises';
import { basename } from 'path';
import { computeRefEdits, type RenameEntry, type FileInput } from './refRenameEdits';
import { normalizePathForCompare } from './mapReferenceTools';

export function registerRefRenameParticipant(context: vscode.ExtensionContext): void {
  // Open documents touched by the refactor are left dirty by VS Code once the
  // rename is accepted; onDidRenameFiles saves them. Stored as TextDocument
  // references (not URIs) because VS Code rewrites a document's URI when its
  // file is renamed, so a URI lookup after the rename would miss. Closed files
  // need no tracking — VS Code persists them as part of applying the edit.
  let pendingSaveDocs: vscode.TextDocument[] = [];

  context.subscriptions.push(
    vscode.workspace.onWillRenameFiles((event) => {
      event.waitUntil(handleRename(event, pendingSaveDocs));
    }),
  );

  // Auto-save the open documents the refactor left dirty. onDidRenameFiles
  // fires whether the user accepted or skipped, so the isDirty guard is what
  // keeps a skipped refactor from writing anything to disk.
  context.subscriptions.push(
    vscode.workspace.onDidRenameFiles(async () => {
      if (pendingSaveDocs.length > 0) {
        const docsToSave = pendingSaveDocs;
        pendingSaveDocs = [];
        for (const doc of docsToSave) {
          if (doc.isDirty) {
            await doc.save();
          }
        }
      }
    }),
  );
}

// Set of normalized paths for documents currently open in the editor
function getOpenDocPaths(): Set<string> {
  const open = new Set<string>();
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.scheme === 'file') {
      open.add(normalizePathForCompare(doc.uri.fsPath, process.platform));
    }
  }
  return open;
}

async function handleRename(
  event: vscode.FileWillRenameEvent,
  pendingSaveDocs: vscode.TextDocument[],
): Promise<vscode.WorkspaceEdit> {
  const emptyEdit = new vscode.WorkspaceEdit();

  // Read setting — default to 'always'
  const setting = vscode.workspace
    .getConfiguration('dita-viewer')
    .get<string>('updateReferencesOnRename', 'always');

  if (setting === 'never') {
    return emptyEdit;
  }

  // Filter to file-scheme URIs only
  const fileRenames = event.files.filter(
    (f) => f.oldUri.scheme === 'file' && f.newUri.scheme === 'file',
  );
  if (fileRenames.length === 0) {
    return emptyEdit;
  }

  // Build RenameEntry[]
  const renames: RenameEntry[] = fileRenames.map((f) => ({
    oldPath: normalizePathForCompare(f.oldUri.fsPath, process.platform),
    newPath: normalizePathForCompare(f.newUri.fsPath, process.platform),
  }));

  // Find candidate files that might contain references
  const candidateUris = await vscode.workspace.findFiles(
    '**/*.{dita,ditamap}',
    '{node_modules,.git}/**',
  );

  const MAX_FILES = 5000;
  let truncated = false;
  let workingUris = candidateUris;
  if (candidateUris.length > MAX_FILES) {
    truncated = true;
    workingUris = candidateUris.slice(0, MAX_FILES);
  }

  // Build a set of normalized renamed paths for quick lookup
  const renamedPaths = new Set<string>();
  for (const r of renames) {
    renamedPaths.add(normalizePathForCompare(r.oldPath, process.platform));
    renamedPaths.add(normalizePathForCompare(r.newPath, process.platform));
  }

  // Pre-compute old basenames and their encoded forms for quick pre-filter
  const oldNames: Array<{ plain: string; encoded: string }> = renames.map((r) => {
    const name = basename(r.oldPath);
    return { plain: name, encoded: encodeURIComponent(name) };
  });

  // Collect FileInput[] — skip renamed files themselves, pre-filter by name
  const files: FileInput[] = [];
  for (const uri of workingUris) {
    const normPath = normalizePathForCompare(uri.fsPath, process.platform);
    if (renamedPaths.has(normPath)) continue;

    // Get text: prefer unsaved editor content, fall back to disk
    let text: string | undefined;
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme === 'file' && normalizePathForCompare(doc.uri.fsPath, process.platform) === normPath) {
        text = doc.getText();
        break;
      }
    }
    if (text === undefined) {
      try {
        text = await readFile(uri.fsPath, 'utf8');
      } catch {
        continue;
      }
    }

    // Quick pre-filter: at least one old name must appear in the text
    const hasMatch = oldNames.some(
      (n) => text!.includes(n.plain) || text!.includes(n.encoded),
    );
    if (!hasMatch) continue;

    files.push({ path: uri.fsPath, text });
  }

  if (files.length === 0) {
    if (truncated) {
      vscode.window.showWarningMessage(
        vscode.l10n.t('Rename reference update exceeded file limit of {0}', String(MAX_FILES)),
      );
    }
    return emptyEdit;
  }

  // Compute edits via the pure function
  const fileEdits = computeRefEdits({ renames, files, platform: process.platform });

  if (truncated) {
    vscode.window.showWarningMessage(
      vscode.l10n.t('Rename reference update exceeded file limit of {0}', String(MAX_FILES)),
    );
  }

  // Count total edits and affected files
  let totalEdits = 0;
  for (const fe of fileEdits) {
    totalEdits += fe.edits.length;
  }

  if (totalEdits === 0) {
    return emptyEdit;
  }

  // For 'prompt' mode, ask the user before applying
  if (setting === 'prompt') {
    const affectedFiles = fileEdits.length;
    const yesLabel = vscode.l10n.t('Yes');
    const noLabel = vscode.l10n.t('No');
    const choice = await vscode.window.showInformationMessage(
      vscode.l10n.t('Update {0} references in {1} files?', String(totalEdits), String(affectedFiles)),
      yesLabel,
      noLabel,
    );
    if (choice !== yesLabel) {
      return emptyEdit;
    }
  }

  // Which files are open in the editor — their documents are left dirty by
  // VS Code once the refactor is accepted and are saved in onDidRenameFiles.
  const openDocPaths = getOpenDocPaths();
  pendingSaveDocs.length = 0;

  // Build ONE WorkspaceEdit covering every affected file, open or closed. This
  // is what lets VS Code bundle the edits with the rename so Skip/undo revert
  // all of them and "Show Preview" displays all of them.
  const workspaceEdit = new vscode.WorkspaceEdit();

  // We need file text to convert offsets to positions. Reuse the content we
  // already read (keyed by the pre-rename path computeRefEdits was given).
  const textCache = new Map<string, string>();
  for (const fi of files) {
    textCache.set(normalizePathForCompare(fi.path, process.platform), fi.text);
  }

  for (const fe of fileEdits) {
    const normPath = normalizePathForCompare(fe.path, process.platform);

    // Get text for offset-to-position conversion
    let fileText = textCache.get(normPath);
    if (fileText === undefined) {
      // The file may have been renamed — read from the new path
      try {
        fileText = await readFile(fe.path, 'utf8');
      } catch {
        continue;
      }
    }

    const targetUri = vscode.Uri.file(fe.path);
    for (const edit of fe.edits) {
      const startPos = offsetToPosition(fileText, edit.start);
      const endPos = offsetToPosition(fileText, edit.end);
      const range = new vscode.Range(startPos, endPos);
      workspaceEdit.replace(targetUri, range, edit.newText);
    }

    // Track open documents so onDidRenameFiles can save them after the
    // rename. Store the TextDocument (not the URI) — VS Code rewrites the
    // document's URI when the file moves, so a URI lookup later would miss it.
    if (openDocPaths.has(normPath)) {
      const doc = vscode.workspace.textDocuments.find(
        (d) => d.uri.scheme === 'file' && normalizePathForCompare(d.uri.fsPath, process.platform) === normPath,
      );
      if (doc) {
        pendingSaveDocs.push(doc);
      }
    }
  }

  // Show status bar message for 'always' mode
  if (setting === 'always') {
    const affectedFiles = fileEdits.length;
    vscode.window.setStatusBarMessage(
      vscode.l10n.t('Updated {0} references in {1} files', String(totalEdits), String(affectedFiles)),
      5000,
    );
  }

  return workspaceEdit;
}

function offsetToPosition(text: string, offset: number): vscode.Position {
  let line = 0;
  let character = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      character = 0;
    } else {
      character++;
    }
  }
  return new vscode.Position(line, character);
}
