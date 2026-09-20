/**
 * How the extension reads and fingerprints DITA source files.
 *
 * Pure of the vscode module, so the rules here can be unit-tested; whatever
 * feeds it editor state lives elsewhere.
 */
import { statSync } from 'fs';

/**
 * A fingerprint of one file, comparable by string equality: two calls return
 * the same string exactly when nothing that matters to a cached render
 * derived from the file changed in between.
 *
 * `<mtimeMs>:<size>` on disk. mtime alone is not enough -- a restored
 * timestamp (git checkout, a copy tool, a coarse-grained file system) can
 * leave it equal for a file whose content is different, and size catches
 * most of those at the cost of one field of the stat that is already being
 * made. A file that cannot be statted is "?", so deleting a dependency
 * invalidates exactly as modifying it does, and creating one that was
 * missing turns "?" into a real stamp -- the other half of the same
 * requirement.
 */
export function sourceStamp(filePath: string): string {
  try {
    const st = statSync(filePath);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return '?';
  }
}
