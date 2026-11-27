// An in-memory FileSystem, for hosts that have no disk core can read
// synchronously: a browser (the host preloads the user's files, see DESIGN.md
// 3.8), a test, a server rendering from a database.
//
// Paths are absolute and POSIX; pair it with `posixPath`. Directories are
// implied by the files under them, and the root always exists.

import type { FileStat, FileSystem } from './platform';
import type { WalkEntry } from './language/referenceableFiles';
import { posixPath } from './posixPath';

export type MemoryFileContent = string | Uint8Array;

export interface MemoryFileSystem extends FileSystem {
  /** Adds or replaces a file. Its `mtimeMs` becomes a number no earlier call has produced. */
  set(path: string, content: MemoryFileContent): void;
  /** Removes a file. Returns whether it existed. */
  delete(path: string): boolean;
}

interface Entry {
  bytes: Uint8Array;
  version: number;
}

function fail(code: string, op: string, path: string): never {
  const err = new Error(`${code}: ${op} '${path}'`) as Error & { code: string };
  err.code = code;
  throw err;
}

/**
 * `mtimeMs` is a per-file-system counter, not a clock: every set() takes the
 * next number, so a stamp built from `mtimeMs` and `size` changes whenever a
 * file's content does, exactly as it does on disk.
 */
export function createMemoryFileSystem(files: Record<string, MemoryFileContent> = {}): MemoryFileSystem {
  const encoder = new TextEncoder();
  // ignoreBOM: keep a leading BOM in the text, as readFileSync does.
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  const entries = new Map<string, Entry>();
  // How many files lie below each directory, at any depth. A directory exists
  // exactly while its count is above zero, so asking whether a path is one (which
  // every lookup of a missing file does) does not scan every file.
  const filesBelow = new Map<string, number>();
  // The same count for each directory's immediate children, by name: a file child
  // counts itself (1), a subdirectory child counts the files below it. A name
  // is listed while its count is above zero, so readDir reads one directory's own
  // entries instead of scanning every file.
  const kids = new Map<string, Map<string, number>>();
  let counter = 0;

  const key = (path: string): string => posixPath.resolve(path);

  const bump = <K>(map: Map<K, number>, k: K, by: 1 | -1): void => {
    const n = (map.get(k) ?? 0) + by;
    if (n > 0) map.set(k, n);
    else map.delete(k);
  };

  /** A file is added (+1) or removed (-1) at `abs`: count it in every ancestor directory. */
  const adjust = (abs: string, by: 1 | -1): void => {
    let child = abs;
    for (;;) {
      const dir = posixPath.dirname(child);
      bump(filesBelow, dir, by);
      let names = kids.get(dir);
      if (!names) kids.set(dir, (names = new Map()));
      bump(names, child.slice(dir === '/' ? 1 : dir.length + 1), by);
      if (names.size === 0) kids.delete(dir);
      if (dir === '/') break;
      child = dir;
    }
  };

  const set = (path: string, content: MemoryFileContent): void => {
    const bytes = typeof content === 'string' ? encoder.encode(content) : content.slice();
    const abs = key(path);
    if (abs === '/') return fail('EISDIR', 'write', path); // the root is always a directory
    if (!entries.has(abs)) adjust(abs, 1);
    entries.set(abs, { bytes, version: ++counter });
  };

  const isDirectory = (abs: string): boolean => abs === '/' || filesBelow.has(abs);

  for (const [path, content] of Object.entries(files)) set(path, content);

  return {
    set,
    delete(path) {
      const abs = key(path);
      if (!entries.delete(abs)) return false;
      adjust(abs, -1);
      return true;
    },
    readText(path) {
      const abs = key(path);
      const entry = entries.get(abs);
      if (entry) return decoder.decode(entry.bytes);
      return fail(isDirectory(abs) ? 'EISDIR' : 'ENOENT', 'read', path);
    },
    readHead(path, maxBytes) {
      const abs = key(path);
      const entry = entries.get(abs);
      if (entry) return entry.bytes.slice(0, Math.max(0, maxBytes));
      return fail(isDirectory(abs) ? 'EISDIR' : 'ENOENT', 'read', path);
    },
    exists(path) {
      const abs = key(path);
      return entries.has(abs) || isDirectory(abs);
    },
    stat(path): FileStat | undefined {
      const abs = key(path);
      const entry = entries.get(abs);
      if (entry) return { size: entry.bytes.length, mtimeMs: entry.version };
      return isDirectory(abs) ? { size: 0, mtimeMs: 0 } : undefined;
    },
    readDir(path): WalkEntry[] {
      const abs = key(path);
      if (entries.has(abs) || !isDirectory(abs)) return fail(entries.has(abs) ? 'ENOTDIR' : 'ENOENT', 'scandir', path);
      const under = abs === '/' ? '/' : `${abs}/`;
      // A name that is both a file and a directory (a file at /p and another at /p/q) lists as a directory.
      return [...(kids.get(abs)?.keys() ?? [])].sort().map((name) => ({ name, isDirectory: filesBelow.has(under + name) }));
    },
  };
}
