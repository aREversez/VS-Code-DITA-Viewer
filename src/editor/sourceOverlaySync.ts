/**
 * The rules for turning editor documents into sourceText.ts overlay entries,
 * kept free of the vscode module (SyncableDocument is the slice of
 * TextDocument used) so they can be unit-tested. sourceOverlayFeed.ts calls
 * this from the real editor events.
 */
import { normalize, sep } from 'path';
import { setSourceOverlay, clearSourceOverlay, sourceStamp, dependsOn } from './sourceText';

export interface SyncableDocument {
  fsPath: string;
  scheme: string;
  isDirty: boolean;
  /** True on the close event: the document is going away, so whatever it held unsaved is discarded. */
  isClosed?: boolean;
  getText(): string;
}

/** DITA sources that exist on disk. Untitled buffers and git/scm views have no file the previews could be reading. */
export function isOverlayCandidate(scheme: string, fsPath: string): boolean {
  return scheme === 'file' && /\.(dita|ditamap|xml)$/i.test(fsPath);
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

function comparable(p: string): string {
  const n = normalize(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? n.toLowerCase() : n;
}

/** Whether `filePath` is `folder` itself or inside it, at any depth. A sibling merely sharing a name prefix ("/w" vs "/wx") is not. */
export function isPathUnder(folder: string, filePath: string): boolean {
  const base = comparable(folder);
  const file = comparable(filePath);
  return file === base || file.startsWith(base + sep);
}

/**
 * Whether a change event can affect a panel, given the files its last render
 * read (`dependencies`, from trackSourceReads).
 *
 * Only unsaved-edit events are narrowed. A disk event always goes through:
 * the dependency set covers text sources, not the images and stylesheets a
 * disk event may be about, and a created or deleted file may be one a
 * dangling reference was waiting for -- so it cannot be ruled out from the
 * files read before it existed. An unsaved edit can only be about a source
 * text, and one the last render did not read cannot change what that render
 * would produce. (An edit that ADDS a reference is to a file the last render
 * did read: the panel's own document or one of its dependencies, and
 * re-rendering recomputes the set.) With no render yet there is nothing to
 * compare against, so nothing is ruled out.
 */
export function affectsPanel(
  event: { fromEditor?: boolean },
  fsPath: string,
  dependencies: ReadonlySet<string> | undefined,
): boolean {
  if (!event.fromEditor) return true;
  return dependencies === undefined || dependsOn(dependencies, fsPath);
}
