// Naming Windows system executables by full path.
//
// Node resolves a bare executable name on Windows through the current
// directory before the system directories, and the extension host's working
// directory can be a workspace. `spawn('cmd.exe')` therefore runs a cmd.exe
// that a cloned repository ships at its root. Naming the System32 copy
// outright takes the search out of the picture.

import { win32 } from 'path';

// A drive-absolute (C:\ or C:/) or UNC root. Anything else -- ".", "Windows",
// "C:", "\Windows" -- is relative to some current directory, which is exactly
// the hazard, so it is not trusted.
export const ABSOLUTE_ROOT = /^(?:[A-Za-z]:[\\/]|\\\\[^\\/])/;

/**
 * `name` under `<SystemRoot>\System32`, from SystemRoot (else windir) in
 * `env`, which defaults to process.env: omitting the argument must not opt
 * back into the current-directory search this exists to close.
 *
 * Each candidate root is judged on its own, so a relative SystemRoot (".",
 * "Windows", "C:Windows") is skipped and a usable windir is still used. Only
 * when neither is absolute does the bare name come back -- that leaves the
 * current-directory search open, but a broken environment is not a reason to
 * make spawning impossible. An absolute but wrong root is joined and fails
 * the spawn (ENOENT) rather than falling back to the bare name.
 */
export function windowsSystemExe(
  name: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const root = [env.SystemRoot, env.windir].find((r) => typeof r === 'string' && ABSOLUTE_ROOT.test(r));
  return root ? win32.join(root, 'System32', name) : name;
}
