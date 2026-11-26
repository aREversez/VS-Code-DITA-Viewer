// What core needs from the host it runs in: files and path arithmetic.
//
// Core never touches `fs` or `path` directly outside src/node/. Everything goes
// through one `Platform`, so the same code runs on Node (src/node), over an
// in-memory file system (memoryFileSystem.ts) and, with a bundler, in a browser.
// See DESIGN.md, section 3.3.
//
// Type-only module: nothing here is loaded at run time.

import type { WalkEntry } from './language/referenceableFiles';

export interface FileStat {
  readonly size: number;
  readonly mtimeMs: number;
}

/**
 * Synchronous and read-only. Core never writes. The render pipeline is
 * synchronous end to end, so a host whose own file API is asynchronous loads
 * the files it needs into memory first (createMemoryFileSystem).
 */
export interface FileSystem {
  /** UTF-8 text. Throws when the file is missing or unreadable (the readFileSync contract callers already handle). */
  readText(path: string): string;
  /** At most `maxBytes` from the start of the file; used only to read image headers. Throws when unreadable. */
  readHead(path: string, maxBytes: number): Uint8Array;
  exists(path: string): boolean;
  /** undefined when the path cannot be statted. */
  stat(path: string): FileStat | undefined;
  /** Throws when the directory is unreadable. */
  readDir(path: string): WalkEntry[];
  /** Symlink resolution for isPathInside. Optional: when absent a path is its own real path. */
  realPath?(path: string): string;
}

export interface PathOps {
  readonly sep: string;
  /** Replaces `process.platform === 'win32'` lower-casing: false means path keys are lower-cased. */
  readonly caseSensitive: boolean;
  resolve(...segments: string[]): string;
  join(...segments: string[]): string;
  dirname(path: string): string;
  relative(from: string, to: string): string;
  isAbsolute(path: string): boolean;
  normalize(path: string): string;
  extname(path: string): string;
}

export interface Platform {
  readonly fs: FileSystem;
  readonly path: PathOps;
}
