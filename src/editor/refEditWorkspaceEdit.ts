// Turns the pure computeRefEdits() result into the one WorkspaceEdit both
// reference-updating features apply: the rename participant returns it from
// onWillRenameFiles, and "Fix Broken References…" awaits workspace.applyEdit.
//
// The invariant this module exists to keep is "one edit, one undo step", plus
// the rule that decides which open documents may be saved afterwards: the ones
// the edit itself made dirty, and never one that had unsaved work of the user's
// in it, so a user's own changes are never flushed as a side effect of updating
// references.

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

/** The open file documents that already hold unsaved work, by normalized path. */
export function dirtyFileDocuments(): Set<string> {
  const dirty = new Set<string>();
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.scheme === 'file' && doc.isDirty) {
      dirty.add(normalizePathForCompare(doc.uri.fsPath, process.platform));
    }
  }
  return dirty;
}

/**
 * Saves the files an applied edit made dirty, after the fact.
 *
 * A file the edit had to open in order to write it comes back as a dirty model
 * that is not in any editor, and nothing persists it -- the rewrite would sit in
 * a buffer while the file on disk keeps the old path. Such a file cannot hold
 * unsaved work, and neither can a file that was clean before the edit; a file
 * that was already dirty is the user's own work and is left alone. The rename
 * participant does not use this: the file operation that follows it saves.
 */
export async function saveRefEdits(opts: {
  fileEdits: FileEdit[];
  /** `dirtyFileDocuments()` taken before the edit was applied. */
  dirtyBefore: Set<string>;
}): Promise<void> {
  const touched = new Set(
    opts.fileEdits.map((fe) => normalizePathForCompare(fe.sourcePath, process.platform)),
  );
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.scheme !== 'file' || !doc.isDirty) continue;
    const key = normalizePathForCompare(doc.uri.fsPath, process.platform);
    if (!touched.has(key) || opts.dirtyBefore.has(key)) continue;
    await doc.save();
  }
}
