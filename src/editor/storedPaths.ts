// How DITAVAL filter paths are stored in the dita-viewer.completenessCheck.ditavalFiles
// setting: relative to the map's folder when inside it, else absolute. These two stayed
// in the extension when the checks moved into core (DESIGN.md 4.4, step 5): they read and
// write a setting, and need real path arithmetic with no host to carry it. Pure -- no
// vscode -- so tests import them directly, like mapReferenceTools.

import { isAbsolute, relative, resolve } from 'path';

/** A DITAVAL path as stored in settings: relative to the map's folder when inside it, else absolute. */
export function toStoredPath(mapDir: string, abs: string): string {
  const rel = relative(mapDir, abs);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) ? rel.replace(/\\/g, '/') : abs;
}

export function resolveStoredPath(mapDir: string, stored: string): string {
  return isAbsolute(stored) ? stored : resolve(mapDir, stored);
}
