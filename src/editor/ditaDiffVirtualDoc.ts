// In-memory documents backing the diff panel's "Open source diff" button.
//
// The rendered diff view (ditaDiffProvider.ts) is great for reading a change,
// but for a heavily-edited comparison a reviewer wants VS Code's own native
// diff editor over the two raw XML sources. Those sources only exist in memory
// here -- one side may be a git blob (git show) and the other an unsaved working
// copy -- so there are no on-disk files for `vscode.diff` to open. This module
// supplies them through a virtual `dita-diff` scheme: registered as both a
// TextDocumentContentProvider (what the text model shows) and a FileSystemProvider
// (so the diff editor / file service treats the URIs as real, diffable files).
// The canonical VS Code "virtual document" pairing -- the FS provider alone is
// not enough for `vscode.diff`, and the content provider alone is not enough for
// the file-service side.

import * as vscode from 'vscode';

export const DITA_DIFF_SCHEME = 'dita-diff';

export class DitaDiffVirtualDocuments implements vscode.FileSystemProvider, vscode.TextDocumentContentProvider {
  // The two interfaces want different change-event payloads from the same edit:
  // the file system provider signals `FileChangeEvent[]`, the text-document
  // provider signals a bare `Uri`. One emitter each.
  private readonly _fsEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  private readonly _docEmitter = new vscode.EventEmitter<vscode.Uri>();

  readonly onDidCreateFile = this._fsEmitter.event;
  readonly onDidDeleteFile = this._fsEmitter.event;
  readonly onDidChangeFile = this._fsEmitter.event;
  readonly onDidRenameFile = this._fsEmitter.event;
  readonly onDidChange = this._docEmitter.event;

  // Full uri.toString() -> current text. Written by setContent, read by both the
  // content provider and the FS provider's readFile.
  private readonly _files = new Map<string, Uint8Array>();

  /** Write (or rewrite) a virtual file's contents and notify any editor already
   *  showing it, so reopening the source diff refreshes in place instead of
   *  stacking a new tab every click. */
  setContent(uri: vscode.Uri, text: string): void {
    this._files.set(uri.toString(), new TextEncoder().encode(text));
    const change: vscode.FileChangeEvent = { type: vscode.FileChangeType.Changed, uri };
    this._fsEmitter.fire([change]);
    this._docEmitter.fire(uri);
  }

  // ── TextDocumentContentProvider ──
  provideTextDocumentContent(uri: vscode.Uri): string {
    const bytes = this._files.get(uri.toString());
    return bytes ? new TextDecoder().decode(bytes) : '';
  }

  // ── FileSystemProvider ──
  // Backing the same Map so the file service can stat/read the URIs. The diff
  // editor only ever needs the read side; the mutating operations are inert
  // (the comparison is a read-only view of two immutable versions).
  stat(uri: vscode.Uri): vscode.FileStat {
    const bytes = this._files.get(uri.toString());
    if (!bytes) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: bytes.byteLength };
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const bytes = this._files.get(uri.toString());
    if (!bytes) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return bytes;
  }

  writeFile(): void {
    throw vscode.FileSystemError.NoPermissions('Read-only');
  }

  delete(): void {
    /* read-only surface: nothing to delete */
  }

  createDirectory(): void {
    /* no directories in this scheme */
  }

  readDirectory(): [string, vscode.FileType][] {
    return [];
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions('Read-only');
  }

  watch(): vscode.Disposable {
    // The content is only ever changed through setContent, which fires the
    // change events directly; no filesystem watcher to set up.
    return { dispose: () => undefined };
  }

  dispose(): void {
    this._fsEmitter.dispose();
    this._docEmitter.dispose();
  }
}

let instance: DitaDiffVirtualDocuments | undefined;

/** Register the provider once (idempotent) and return the shared instance the
 *  diff panel uses to publish source versions. */
export function ensureDitaDiffVirtualDocuments(context: vscode.ExtensionContext): DitaDiffVirtualDocuments {
  if (instance) return instance;
  instance = new DitaDiffVirtualDocuments();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(DITA_DIFF_SCHEME, instance, { isCaseSensitive: true }),
    vscode.workspace.registerTextDocumentContentProvider(DITA_DIFF_SCHEME, instance),
    { dispose: () => { instance?.dispose(); instance = undefined; } },
  );
  return instance;
}
