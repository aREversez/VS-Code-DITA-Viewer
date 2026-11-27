// File access for the rest of core: each function delegates to the active
// runtime's FileSystem (DESIGN.md 3.4). Names follow what the code used to call
// in `fs`, minus the Sync suffix, because every operation here is synchronous.

import { rt } from '../runtime';
import type { FileStat } from '../platform';
import type { WalkEntry } from '../language/referenceableFiles';

export const readText = (path: string): string => rt().platform.fs.readText(path);
export const readHead = (path: string, maxBytes: number): Uint8Array => rt().platform.fs.readHead(path, maxBytes);
export const exists = (path: string): boolean => rt().platform.fs.exists(path);
export const stat = (path: string): FileStat | undefined => rt().platform.fs.stat(path);
export const readDir = (path: string): WalkEntry[] => rt().platform.fs.readDir(path);
/** A platform with no symlinks does not implement realPath: a path is then its own real path. */
export const realPath = (path: string): string => {
  const fs = rt().platform.fs;
  return fs.realPath ? fs.realPath(path) : path;
};
