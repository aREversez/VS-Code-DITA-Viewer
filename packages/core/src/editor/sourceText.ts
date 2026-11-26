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
import { isCaseSensitive, normalize } from '../runtime/path';
import { readText, stat } from '../runtime/fs';
import { stateSlot } from '../runtime';

interface OverlayEntry {
  text: string;
  rev: number;
}

/**
 * Per runtime, not per process: two engines must not see each other's unsaved
 * text, revision numbers or read recording (DESIGN.md 3.4). The top-level
 * functions below act on the default runtime's state.
 */
interface SourceState {
  /** Unsaved text by normalised path key. */
  overlay: Map<string, OverlayEntry>;
  /**
   * One counter for every overlay change to every file, never reset (within a
   * runtime). A stamp built from it cannot collide with an earlier one:
   * document.version, the obvious alternative, restarts at 1 whenever a
   * document is closed and reopened, so "discard changes, reopen, type
   * something else" could land on a version number a cache entry was already
   * built for.
   */
  revision: number;
  /** The set trackSourceReads is currently filling, if any. */
  recorder: Set<string> | undefined;
}
const sourceState = stateSlot<SourceState>(() => ({ overlay: new Map(), revision: 0, recorder: undefined }));

/**
 * Same file however the path is spelled: `..` segments, case on Windows, and
 * `/` vs `\` -- normalize() only resolves the former two and, on win32,
 * rewrites `/` to `\`, so a caller (or a test) that builds a path with `/`
 * throughout gets a different key than the disk path unless both are folded
 * to one separator here.
 */
function key(filePath: string): string {
  const n = normalize(filePath).replace(/\\/g, '/');
  return isCaseSensitive() ? n : n.toLowerCase();
}

/**
 * Records `text` as the current unsaved content of a file. A no-op when it
 * already is: editor events fire for changes that do not alter the text (a
 * re-sync on open, a dirty-flag flip), and each real change here invalidates
 * every cache built from the file.
 */
export function setSourceOverlay(filePath: string, text: string): void {
  const k = key(filePath);
  const existing = sourceState().overlay.get(k);
  if (existing && existing.text === text) return;
  const s = sourceState();
  s.overlay.set(k, { text, rev: ++s.revision });
}

/** The file is saved, reverted or closed: the disk is the truth again. */
export function clearSourceOverlay(filePath: string): void {
  sourceState().overlay.delete(key(filePath));
}

export function clearAllSourceOverlays(): void {
  sourceState().overlay.clear();
}

/** How many files currently have unsaved text -- test hook. */
export function sourceOverlaySize(): number {
  return sourceState().overlay.size;
}

/**
 * The text of a DITA source file as the author currently has it: unsaved
 * editor text when there is some, the file on disk otherwise. Throws exactly
 * as readFileSync does for an unreadable file, so callers keep their existing
 * error handling. The one-value encoding parameter is what expandDitamapRefs'
 * FileReader type asks for.
 */
export function readSourceText(filePath: string, _encoding: 'utf-8' = 'utf-8'): string {
  const k = key(filePath);
  const s = sourceState();
  s.recorder?.add(k);
  const entry = s.overlay.get(k);
  return entry ? entry.text : readText(filePath);
}

// ── Which sources a render read ──
//
// A preview panel has to decide, for an edit made in some other document,
// whether that edit can change what it shows. The answer is exactly "did my
// last render read that file", which the readers above can report as they go.

/**
 * Runs `fn` and returns its result along with every source file read through
 * readSourceText while it ran (as normalized keys, for dependsOn). Nests: an
 * inner call gets its own files, and they are also added to the outer one.
 * Anything that answers from a cache instead of reading must say what the
 * cached answer was built from -- see noteSourceDependencies.
 */
export function trackSourceReads<T>(fn: () => T): { result: T; files: ReadonlySet<string> } {
  const s = sourceState();
  const outer = s.recorder;
  const mine = new Set<string>();
  s.recorder = mine;
  try {
    return { result: fn(), files: mine };
  } finally {
    s.recorder = outer;
    if (outer) for (const f of mine) outer.add(f);
  }
}

/**
 * For a cache hit: reading nothing does not mean depending on nothing. The
 * cache entry knows the files it was built from, and reports them here so an
 * enclosing trackSourceReads sees the same set on the second pass as on the
 * first. A no-op outside a tracker.
 */
export function noteSourceDependencies(filePaths: Iterable<string>): void {
  const recorder = sourceState().recorder;
  if (!recorder) return;
  for (const p of filePaths) recorder.add(key(p));
}

/** Whether a set returned by trackSourceReads contains this file, however its path is spelled. */
export function dependsOn(files: ReadonlySet<string>, filePath: string): boolean {
  return files.has(key(filePath));
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
  const entry = sourceState().overlay.get(key(filePath));
  if (entry) return `dirty:${entry.rev}`;
  const st = stat(filePath);
  return st ? `${st.mtimeMs}:${st.size}` : '?';
}
