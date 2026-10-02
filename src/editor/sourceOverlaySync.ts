/**
 * The rules for turning editor documents into sourceText.ts overlay entries,
 * kept free of the vscode module (SyncableDocument is the slice of
 * TextDocument used) so they can be unit-tested. sourceOverlayFeed.ts calls
 * this from the real editor events.
 */
import { normalize } from 'path';
import { setSourceOverlay, clearSourceOverlay, sourceStamp, dependsOn } from './sourceText';

export interface SyncableDocument {
  fsPath: string;
  scheme: string;
  isDirty: boolean;
  /** True on the close event: the document is going away, so whatever it held unsaved is discarded. */
  isClosed?: boolean;
  getText(): string;
}

/** A DITA source text, as opposed to an image, a stylesheet or anything else a preview may depend on. */
export function isSourceFile(fsPath: string): boolean {
  return /\.(dita|ditamap|xml)$/i.test(fsPath);
}

/** DITA sources that exist on disk. Untitled buffers and git/scm views have no file the previews could be reading. */
export function isOverlayCandidate(scheme: string, fsPath: string): boolean {
  return scheme === 'file' && isSourceFile(fsPath);
}

/**
 * Brings the overlay in line with one document: unsaved text is overlaid,
 * anything else (saved, reverted, closed) drops the entry so the disk is the
 * truth again. A clean document is never overlaid -- its text IS the disk
 * copy, and overlaying it would only hide a later change made on disk (git
 * checkout, another tool) behind a stale copy.
 *
 * Returns whether the file's source, as the caches see it, changed -- the
 * caller's cue that previews built from it are now out of date. Compared by
 * stamp rather than by whether an entry was touched, because setting
 * identical text (an editor event that changed nothing) is not a change, and
 * dropping an entry after an undo back to the saved text is.
 */
export function syncDocumentToOverlay(doc: SyncableDocument): boolean {
  if (!isOverlayCandidate(doc.scheme, doc.fsPath)) return false;
  const before = sourceStamp(doc.fsPath);
  if (doc.isDirty && !doc.isClosed) setSourceOverlay(doc.fsPath, doc.getText());
  else clearSourceOverlay(doc.fsPath);
  return sourceStamp(doc.fsPath) !== before;
}

// '/' throughout, same as sourceText.ts's key() -- normalize() alone leaves
// '/' vs '\' unresolved (and rewrites '/' to '\' on win32), so folder/filePath
// spelled with the other separator would otherwise compare unequal.
function comparable(p: string): string {
  const n = normalize(p).replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? n.toLowerCase() : n;
}

/** Whether `filePath` is `folder` itself or inside it, at any depth. A sibling merely sharing a name prefix ("/w" vs "/wx") is not. */
export function isPathUnder(folder: string, filePath: string): boolean {
  const base = comparable(folder);
  const file = comparable(filePath);
  return file === base || file.startsWith(base + '/');
}

/**
 * Whether a file event can affect a panel, given the files its last render
 * read (`dependencies`, from trackSourceReads).
 *
 * The folder watcher covers a whole workspace, so without this every save of
 * every DITA file in it -- another map's topics, an unrelated book in the
 * same repository -- re-renders every open preview. A change to a source text
 * the last render did not read cannot change what that render would produce,
 * so it is dropped. (An edit that ADDS a reference is to a file the last
 * render did read: the panel's own document or one of its dependencies, and
 * re-rendering recomputes the set.)
 *
 * Deliberately NOT narrowed:
 *  - create and delete. A new file may be exactly what a dangling reference
 *    was waiting for, which the files read before it existed cannot say; a
 *    delete is the mirror case. Both are rare.
 *  - changes to anything that is not a source text. The dependency set covers
 *    the sources a render reads, not images and stylesheets.
 * With no render yet there is nothing to compare against, so nothing is ruled
 * out.
 */
export function affectsPanel(
  event: { kind: 'create' | 'change' | 'delete'; fromEditor?: boolean },
  fsPath: string,
  dependencies: ReadonlySet<string> | undefined,
): boolean {
  if (event.kind !== 'change') return true;
  if (!event.fromEditor && !isSourceFile(fsPath)) return true;
  return dependencies === undefined || dependsOn(dependencies, fsPath);
}
