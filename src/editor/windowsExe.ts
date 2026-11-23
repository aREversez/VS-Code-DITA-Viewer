// Naming Windows system executables by full path.
//
// Node resolves a bare executable name on Windows through the current
// directory before the system directories, and the extension host's working
// directory can be a workspace. `spawn('cmd.exe')` therefore runs a cmd.exe
// that a cloned repository ships at its root. Naming the System32 copy
// outright takes the search out of the picture.

import { win32 } from 'path';

// A drive-absolute (C:\ or C:/) or UNC root. Anything else -- ".", "Windows",
// "C:Windows" -- is relative to some current directory, which is exactly the
// hazard, so it is not trusted.
const ABSOLUTE_ROOT = /^(?:[A-Za-z]:[\\/]|\\\\[^\\/])/;

/**
 * `name` under `<SystemRoot>\System32`, from SystemRoot (else windir) in
 * `env`. Without an environment, or with no usable absolute root, the bare name
 * comes back: a missing or relative SystemRoot is not a reason to search the
 * current directory, but nor does it make spawning impossible. A SystemRoot
 * that is absolute yet wrong fails the spawn (ENOENT) rather than falling back
 * to the bare name, which would reopen the search this exists to close.
 */
export function windowsSystemExe(
  name: string,
  env: Record<string, string | undefined> | undefined,
): string {
  const root = env?.SystemRoot || env?.windir;
  return root && ABSOLUTE_ROOT.test(root) ? win32.join(root, 'System32', name) : name;
}
