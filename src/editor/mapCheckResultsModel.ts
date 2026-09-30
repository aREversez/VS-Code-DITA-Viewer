// Pure shaping of check results for the Map Checks tree view (kept apart
// from vscode so it can be unit-tested).

import { dirname, relative, basename } from 'path';

export interface FolderGroup {
  /** Folder shown as the group label, relative to the searched folder ("." shown as its own name). */
  label: string;
  dir: string;
  files: string[];
}

/**
 * Groups files by their folder, labelled relative to the searched folder they
 * fall under (the deepest one when searches overlap). Groups and files are
 * sorted by name.
 */
export function groupByFolder(files: string[], roots: string[]): FolderGroup[] {
  const byDir = new Map<string, FolderGroup>();
  const sortedRoots = [...roots].sort((a, b) => b.length - a.length);
  for (const file of files) {
    const dir = dirname(file);
    const root = sortedRoots.find((r) => !relative(r, file).startsWith('..')) ?? dirname(dir);
    let g = byDir.get(dir);
    if (!g) {
      const rel = relative(root, dir).replace(/\\/g, '/');
      g = { label: rel === '' ? basename(root) : rel, dir, files: [] };
      byDir.set(dir, g);
    }
    g.files.push(file);
  }
  const groups = [...byDir.values()];
  for (const g of groups) g.files.sort((a, b) => basename(a).localeCompare(basename(b)));
  return groups.sort((a, b) => a.label.localeCompare(b.label));
}
