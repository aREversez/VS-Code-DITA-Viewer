/**
 * How the extension reads and fingerprints DITA source files.
 *
 * Previews are built from more than the document on screen -- conref targets,
 * mapref'd maps, keydef maps, the topics of a book -- and those used to be
 * read from disk, so text that was typed into an editor tab but not saved
 * did not show. The overlay below is the fix: a registry of the unsaved text
 * of open documents. Every read of a DITA source goes through readSourceText
 * (the unsaved text if there is any, otherwise the disk), and every cache
 * fingerprint through sourceStamp (which changes when either does).
 *
 * Pure of the vscode module, so the rules here can be unit-tested; the code
 * that feeds it from editor events is in sourceOverlaySync.ts.
 */
import { readFileSync, statSync } from 'fs';
import { normalize } from 'path';

interface OverlayEntry {
  text: string;
  rev: number;
}

const overlay = new Map<string, OverlayEntry>();

/**
 * One counter for every overlay change to every file, never reset. A stamp
 * built from it cannot collide with an earlier one: document.version, the
 * obvious alternative, restarts at 1 whenever a document is closed and
 * reopened, so "discard changes, reopen, type something else" could land on
 * a version number a cache entry was already built for.
 */
let revision = 0;

/** Same file however the path is spelled: `..` segments, and case on Windows. */
function key(filePath: string): string {
  const n = normalize(filePath);
  return process.platform === 'win32' ? n.toLowerCase() : n;
}

/**
 * Records `text` as the current unsaved content of a file. A no-op when it
 * already is: editor events fire for changes that do not alter the text (a
 * re-sync on open, a dirty-flag flip), and each real change here invalidates
 * every cache built from the file.
 */
export function setSourceOverlay(filePath: string, text: string): void {
  const k = key(filePath);
  const existing = overlay.get(k);
  if (existing && existing.text === text) return;
  overlay.set(k, { text, rev: ++revision });
}

/** The file is saved, reverted or closed: the disk is the truth again. */
export function clearSourceOverlay(filePath: string): void {
  overlay.delete(key(filePath));
}

export function clearAllSourceOverlays(): void {
  overlay.clear();
}

/** How many files currently have unsaved text -- test hook. */
export function sourceOverlaySize(): number {
  return overlay.size;
}

/**
 * The text of a DITA source file as the author currently has it: unsaved
 * editor text when there is some, the file on disk otherwise. Throws exactly
 * as readFileSync does for an unreadable file, so callers keep their existing
 * error handling. The one-value encoding parameter is what expandDitamapRefs'
 * FileReader type asks for.
 */
export function readSourceText(filePath: string, encoding: 'utf-8' = 'utf-8'): string {
  const entry = overlay.get(key(filePath));
  return entry ? entry.text : readFileSync(filePath, encoding);
}

/**
 * A fingerprint of one file, comparable by string equality: two calls return
 * the same string exactly when nothing that matters to a cached render
 * derived from the file changed in between.
 *
 * `dirty:<rev>` while the file has unsaved text; `<mtimeMs>:<size>` on disk.
 * mtime alone is not enough -- a restored timestamp (git checkout, a copy
 * tool, a coarse-grained file system) can leave it equal for a file whose
 * content is different, and size catches most of those at the cost of one
 * field of the stat that is already being made. A file that cannot be
 * statted is "?", so deleting a dependency invalidates exactly as modifying
 * it does, and creating one that was missing turns "?" into a real stamp --
 * the other half of the same requirement.
 */
export function sourceStamp(filePath: string): string {
  const entry = overlay.get(key(filePath));
  if (entry) return `dirty:${entry.rev}`;
  try {
    const st = statSync(filePath);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return '?';
  }
}
