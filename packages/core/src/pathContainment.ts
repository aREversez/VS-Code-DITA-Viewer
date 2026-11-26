import { exists, realPath } from './runtime/fs';
import { isAbsolute, getSep, relative, resolve } from './runtime/path';

// "Is this path inside that folder?" for hosts that resolve a href an author
// wrote. A reference such as `../../../.ssh/id_rsa` or `/etc/hosts` resolves
// fine with path.resolve() and then gets read, inlined or handed to the OS, so
// every place that turns a document's href into a file asks this first.
//
// Symlinks are followed (a link inside the folder that points out of it is out),
// and `..` must be a whole segment: a folder named `..hidden` is inside.

function real(p: string): string {
  const abs = resolve(p);
  try {
    return exists(abs) ? realPath(abs) : abs;
  } catch {
    return abs;
  }
}

/** True when `target` is `root` itself or somewhere below it. */
export function isPathInside(root: string, target: string): boolean {
  const rel = relative(real(root), real(target));
  if (rel === '') return true;
  return rel !== '..' && !rel.startsWith('..' + getSep()) && !isAbsolute(rel);
}

/** True when `target` is inside at least one of `roots` (false for an empty list). */
export function isInsideAny(roots: readonly string[], target: string): boolean {
  return roots.some((r) => isPathInside(r, target));
}

// A process-wide read boundary for the reference resolvers (conref, conkeyref,
// title lookups all read through one file cache). The host sets it from its
// workspace folders; a `conref="../../../elsewhere/x.dita#id"` that leaves them
// is then treated as a missing file instead of being parsed. Unset (the
// default, and what a host with no folder open uses) means unrestricted -- the
// same global-hook shape as setSourceOverlay in ./editor/sourceText.
let readRoots: readonly string[] | undefined;

/** Restrict resolver reads to `roots`; pass undefined or an empty list to lift the limit. */
export function setReadRoots(roots: readonly string[] | undefined): void {
  readRoots = roots && roots.length > 0 ? [...roots] : undefined;
}

/** False only when a boundary is set and `absPath` is outside it. */
export function isReadAllowed(absPath: string): boolean {
  return readRoots === undefined || isInsideAny(readRoots, absPath);
}
