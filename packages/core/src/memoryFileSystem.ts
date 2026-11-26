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
  let counter = 0;

  const key = (path: string): string => posixPath.resolve(path);

  const set = (path: string, content: MemoryFileContent): void => {
    const bytes = typeof content === 'string' ? encoder.encode(content) : content.slice();
    entries.set(key(path), { bytes, version: ++counter });
  };

  const isDirectory = (abs: string): boolean => {
    if (abs === '/') return true;
    const prefix = `${abs}/`;
    for (const k of entries.keys()) if (k.startsWith(prefix)) return true;
    return false;
  };

  for (const [path, content] of Object.entries(files)) set(path, content);

  return {
    set,
    delete: (path) => entries.delete(key(path)),
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
      const prefix = abs === '/' ? '/' : `${abs}/`;
      const children = new Map<string, boolean>();
      for (const k of entries.keys()) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        const slash = rest.indexOf('/');
        if (slash === -1) children.set(rest, false);
        else children.set(rest.slice(0, slash), true);
      }
      return [...children.keys()].sort().map((name) => ({ name, isDirectory: children.get(name) === true }));
    },
  };
}
