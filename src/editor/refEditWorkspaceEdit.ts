// Turns the pure computeRefEdits() result into the one WorkspaceEdit both
// reference-updating features apply: the rename participant returns it from
// onWillRenameFiles, and "Fix Broken References…" awaits workspace.applyEdit.
//
// The invariant this module exists to keep is "one edit, one undo step", plus
// the rule that decides which open documents may be saved afterwards: only the
// ones that were clean before the edit, so a user's own unsaved work is never
// flushed as a side effect of updating references.

import * as vscode from 'vscode';
import { FileEdit } from './refRenameEdits';
import { normalizePathForCompare } from './mapReferenceTools';

/** Open file-scheme documents keyed by normalized path. */
export function openFileDocuments(): Map<string, vscode.TextDocument> {
  const open = new Map<string, vscode.TextDocument>();
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.scheme === 'file') {
      open.set(normalizePathForCompare(doc.uri.fsPath, process.platform), doc);
    }
  }
  return open;
}

export interface RefEditApplication {
  edit: vscode.WorkspaceEdit;
  /** Documents that were open and clean: they are saved after the edit lands. */
  toSave: vscode.TextDocument[];
  /** References rewritten. */
  replacements: number;
  /** Files that carry at least one rewrite. */
  fileCount: number;
}

/**
 * Builds the WorkspaceEdit for `fileEdits`. Edits are targeted at each file's
 * `sourcePath` -- where it lives now -- because the rename participant's edit
 * runs before the move, and a repair never moves anything at all.
 */
export function workspaceEditForRefEdits(opts: {
  fileEdits: FileEdit[];
  /** The text each FileEdit was computed against, keyed by the file's own path. */
  textBySource: Map<string, string>;
  openDocs: Map<string, vscode.TextDocument>;
}): RefEditApplication {
  const { fileEdits, textBySource, openDocs } = opts;
  const edit = new vscode.WorkspaceEdit();
  const toSave: vscode.TextDocument[] = [];
  let replacements = 0;

  for (const fe of fileEdits) {
    const srcNorm = normalizePathForCompare(fe.sourcePath, process.platform);
    const fileText = textBySource.get(srcNorm);
    if (fileText === undefined) continue;

    const targetUri = vscode.Uri.file(fe.sourcePath);
    const openDoc = openDocs.get(srcNorm);
    for (const change of fe.edits) {
      const range = openDoc
        ? new vscode.Range(openDoc.positionAt(change.start), openDoc.positionAt(change.end))
        : new vscode.Range(offsetToPosition(fileText, change.start), offsetToPosition(fileText, change.end));
      edit.replace(targetUri, range, change.newText);
      replacements++;
    }

    // Store the TextDocument (not the URI): VS Code rewrites a document's URI
    // when its file is renamed.
    if (openDoc && !openDoc.isDirty) toSave.push(openDoc);
  }

  return { edit, toSave, replacements, fileCount: fileEdits.length };
}

export function offsetToPosition(text: string, offset: number): vscode.Position {
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
