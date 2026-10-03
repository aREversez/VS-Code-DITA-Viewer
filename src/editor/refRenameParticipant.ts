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
import {
  computeRefEdits,
  mayReferenceRenamed,
  stripBom,
  type RenameEntry,
  type FileInput,
} from './refRenameEdits';
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

// Open file-scheme documents keyed by normalized path
function getOpenDocs(): Map<string, vscode.TextDocument> {
  const open = new Map<string, vscode.TextDocument>();
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.scheme === 'file') {
      open.set(normalizePathForCompare(doc.uri.fsPath, process.platform), doc);
    }
  }
  return open;
}

const READ_CONCURRENCY = 32;
const MAX_FILES = 5000;

async function handleRename(
  event: vscode.FileWillRenameEvent,
  pendingSaveDocs: vscode.TextDocument[],
): Promise<vscode.WorkspaceEdit> {
  const emptyEdit = new vscode.WorkspaceEdit();

  // A previous rename that was skipped or failed never reached onDidRenameFiles
  // for its documents; never carry them over into this one.
  pendingSaveDocs.length = 0;

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

  // Raw fsPaths on purpose: computeRefEdits normalizes for comparison itself,
  // and the new path is written into hrefs, so its casing must be preserved.
  const renames: RenameEntry[] = fileRenames.map((f) => ({
    oldPath: f.oldUri.fsPath,
    newPath: f.newUri.fsPath,
  }));

  // Gather candidate files (real findFiles, honouring the exclude glob and the
  // truncation cap) and compute the reference edits against them.
  const { files, truncated } = await collectCandidates(renames);

  if (files.length === 0) {
    if (truncated) {
      vscode.window.showWarningMessage(
        vscode.l10n.t('Rename reference update exceeded file limit of {0}', String(MAX_FILES)),
      );
    }
    return emptyEdit;
  }

  // Compute edits via the pure function
  const openDocs = getOpenDocs();
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

  // Build ONE WorkspaceEdit covering every affected file, open or closed. This
  // is what lets VS Code bundle the edits with the rename so Skip/undo revert
  // all of them and "Show Preview" displays all of them.
  const workspaceEdit = new vscode.WorkspaceEdit();

  // Offsets were computed against the text we read above, keyed by the file's
  // current (pre-rename) path.
  const textBySource = new Map<string, string>();
  for (const fi of files) {
    textBySource.set(normalizePathForCompare(fi.path, process.platform), fi.text);
  }

  for (const fe of fileEdits) {
    const srcNorm = normalizePathForCompare(fe.sourcePath, process.platform);
    const fileText = textBySource.get(srcNorm);
    if (fileText === undefined) continue;

    // The WorkspaceEdit runs before the rename, so it targets the OLD location
    // even for files that are being moved themselves.
    const targetUri = vscode.Uri.file(fe.sourcePath);
    const openDoc = openDocs.get(srcNorm);
    for (const edit of fe.edits) {
      const range = openDoc
        ? new vscode.Range(openDoc.positionAt(edit.start), openDoc.positionAt(edit.end))
        : new vscode.Range(offsetToPosition(fileText, edit.start), offsetToPosition(fileText, edit.end));
      workspaceEdit.replace(targetUri, range, edit.newText);
    }

    // Auto-save later only documents that were clean before our edit — never
    // flush a user's own unsaved changes as a side effect of a rename. Store
    // the TextDocument (not the URI): VS Code rewrites the URI on rename.
    if (openDoc && !openDoc.isDirty) {
      pendingSaveDocs.push(openDoc);
    }
  }

  // Status bar notice (the setting is only 'always' or 'never'; 'never' returned early)
  vscode.window.setStatusBarMessage(
    vscode.l10n.t('Updated {0} references in {1} files', String(totalEdits), String(fileEdits.length)),
    5000,
  );

  return workspaceEdit;
}

// Collect the .dita/.ditamap files that might reference the renamed targets,
// reading each (preferring an open document's unsaved text, else disk with the
// BOM stripped) and pre-filtering with mayReferenceRenamed. Used both by the
// live participant and by the test seam so the two never drift.
async function collectCandidates(
  renames: RenameEntry[],
): Promise<{ files: FileInput[]; truncated: boolean }> {
  // The exclude glob must start with ** — a bare `node_modules/**` only matches
  // the workspace root, leaving nested node_modules unexcluded.
  const candidateUris = await vscode.workspace.findFiles(
    '**/*.{dita,ditamap}',
    '**/{node_modules,.git}/**',
  );

  let truncated = false;
  let workingUris = candidateUris;
  if (candidateUris.length > MAX_FILES) {
    truncated = true;
    workingUris = candidateUris.slice(0, MAX_FILES);
  }

  // Renamed files stay candidates: a moved file's own relative references may
  // need rewriting (the edit is applied to its current location, before the move).
  const openDocs = getOpenDocs();
  const files: FileInput[] = [];
  const readOne = async (uri: vscode.Uri): Promise<FileInput | undefined> => {
    const normPath = normalizePathForCompare(uri.fsPath, process.platform);
    // Prefer unsaved editor content (VS Code's text has no BOM), else disk.
    const openDoc = openDocs.get(normPath);
    let text: string;
    if (openDoc) {
      text = openDoc.getText();
    } else {
      try {
        text = stripBom(await readFile(uri.fsPath, 'utf8'));
      } catch {
        return undefined;
      }
    }
    if (!mayReferenceRenamed(uri.fsPath, text, renames, process.platform)) return undefined;
    return { path: uri.fsPath, text };
  };
  for (let i = 0; i < workingUris.length; i += READ_CONCURRENCY) {
    const batch = await Promise.all(workingUris.slice(i, i + READ_CONCURRENCY).map(readOne));
    for (const fi of batch) if (fi) files.push(fi);
  }

  return { files, truncated };
}

// Test seam: run the participant's real candidate gathering (vscode.workspace
// .findFiles + disk reads) and edit computation for a rename, and return each
// affected file's content after its edits are applied. This exercises exactly
// what the participant decides to change -- folder-prefix matches, a moved
// file's own outbound references, UTF-8 href encoding, BOM handling, the
// node_modules exclusion -- against a real workspace, without needing VS Code
// to apply a user-initiated rename (which is not reachable from the extension
// API: fs.rename never fires the participant, and applyEdit fires it but drops
// the returned edits).
export async function computeRenameEditsForTesting(
  renames: RenameEntry[],
): Promise<Array<{ sourcePath: string; path: string; newText: string }>> {
  const { files } = await collectCandidates(renames);
  const fileEdits = computeRefEdits({ renames, files, platform: process.platform });
  const textBySource = new Map<string, string>();
  for (const fi of files) {
    textBySource.set(normalizePathForCompare(fi.path, process.platform), fi.text);
  }
  return fileEdits.map((fe) => {
    const src = textBySource.get(normalizePathForCompare(fe.sourcePath, process.platform)) ?? '';
    let out = src;
    for (const edit of [...fe.edits].sort((a, b) => b.start - a.start)) {
      out = out.slice(0, edit.start) + edit.newText + out.slice(edit.end);
    }
    return { sourcePath: fe.sourcePath, path: fe.path, newText: out };
  });
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
