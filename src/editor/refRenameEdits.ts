// Pure function that computes text edits needed when files are renamed or
// moved. Given a set of rename entries (old→new absolute paths) and a set
// of files with their content, returns the edits required to update every
// href / conref that pointed at a renamed target.
//
// No vscode dependency — only Node path + project utilities.

import * as pathWin32 from 'path/win32';
import * as pathPosix from 'path/posix';
import { collectRefEntries, isExternalRef } from '../language/ditaLanguageUtils';
import { decodeHrefPart } from './refResolvers';
import { normalizePathForCompare } from './mapReferenceTools';

export interface RenameEntry {
  oldPath: string; // absolute, normalized
  newPath: string; // absolute, normalized
}

export interface FileInput {
  path: string; // absolute path of the file containing references
  text: string; // file content
}

export interface FileEdit {
  /** Where the file will live once the rename has happened. */
  path: string;
  /**
   * Where the file lives right now (before the rename). Edits computed for a
   * file that is itself being moved must be applied to this location, because
   * a WorkspaceEdit returned from onWillRenameFiles runs before the move.
   */
  sourcePath: string;
  edits: Array<{ start: number; end: number; newText: string }>;
}

/**
 * Percent-encodes characters that are not unreserved in a URI path segment
 * (RFC 3986 §2.3), preserving `/` so multi-segment relative paths stay valid.
 */
export function encodeHrefPart(part: string): string {
  // encodeURIComponent yields UTF-8 percent-encoding (a per-UTF-16-unit hex
  // dump would corrupt every non-ASCII file name); `/` is kept as separator.
  return part.split('/').map(encodeURIComponent).join('/');
}

/** Drops a leading UTF-8 BOM so offsets match VS Code's TextDocument text. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Cheap pre-filter for candidate files. A file can need edits when it mentions
 * a renamed file's name (plain or percent-encoded), OR when it is itself being
 * moved (its relative outbound references may break even though they never
 * mention the renamed name), i.e. it is a renamed file or sits inside a
 * renamed folder.
 */
export function mayReferenceRenamed(
  filePath: string,
  text: string,
  renames: RenameEntry[],
  platform: NodeJS.Platform,
): boolean {
  const fileNorm = normalizePathForCompare(filePath, platform);
  for (const r of renames) {
    const oldNorm = normalizePathForCompare(r.oldPath, platform);
    if (fileNorm === oldNorm || fileNorm.startsWith(oldNorm.endsWith('/') ? oldNorm : oldNorm + '/')) {
      return true;
    }
    const slashed = r.oldPath.replace(/\\/g, '/');
    const plain = slashed.slice(slashed.lastIndexOf('/') + 1);
    // Paths are case-insensitive on win32, so compare lower-cased there.
    const hay = platform === 'win32' ? text.toLowerCase() : text;
    const fold = (x: string): string => (platform === 'win32' ? x.toLowerCase() : x);
    if (hay.includes(fold(plain)) || hay.includes(fold(encodeURIComponent(plain)))) return true;
  }
  return false;
}

const HANDLED_ATTRS = new Set(['href', 'conref']);

export function computeRefEdits(opts: {
  renames: RenameEntry[];
  files: FileInput[];
  platform: NodeJS.Platform;
}): FileEdit[] {
  const { renames, files, platform } = opts;

  // Pre-compute normalized old/new pairs for fast lookup.
  const renamePairs = renames.map((r) => ({
    oldNorm: normalizePathForCompare(r.oldPath, platform),
    newNorm: normalizePathForCompare(r.newPath, platform),
    newPath: r.newPath,
    oldPath: r.oldPath,
  }));

  // Pick the path flavour by the target platform, not the host, so the result
  // is deterministic (and testable) on any machine.
  const pImpl = (platform === 'win32' ? pathWin32 : pathPosix) as typeof import('path');

  const results: FileEdit[] = [];

  for (const file of files) {
    const pF = file.path; // current position
    // Determine new position of this file after renames.
    const pFNorm = normalizePathForCompare(pF, platform);
    let nF = pF;
    for (const pair of renamePairs) {
      if (pair.oldNorm === pFNorm) {
        // Exact file rename
        nF = pair.newPath;
        break;
      }
      // Folder prefix match: file lives inside a renamed folder
      const oldPrefix = pair.oldNorm.endsWith('/') ? pair.oldNorm : pair.oldNorm + '/';
      if (pFNorm.startsWith(oldPrefix)) {
        const remainder = pF.slice(pair.oldPath.length);
        nF = pair.newPath + remainder;
        break;
      }
    }

    const refs = collectRefEntries(file.text);
    const edits: Array<{ start: number; end: number; newText: string }> = [];

    for (const ref of refs) {
      // Only process href and conref — skip keyref, conkeyref, etc.
      if (!HANDLED_ATTRS.has(ref.attr)) continue;

      // Skip external refs
      if (isExternalRef(ref.value, ref.scope)) continue;

      // Skip empty or bare fragment
      if (!ref.value || ref.value.startsWith('#')) continue;

      // Skip if value contains '&' (entity reference, can't statically resolve)
      if (ref.value.includes('&')) continue;

      // Split into path part and fragment part
      const hashIdx = ref.value.indexOf('#');
      const rawPathPart = hashIdx >= 0 ? ref.value.slice(0, hashIdx) : ref.value;
      const fragmentPart = hashIdx >= 0 ? ref.value.slice(hashIdx) : '';

      // Decode the path part
      const decodedPath = decodeHrefPart(rawPathPart);
      if (!decodedPath) continue;

      // Resolve to absolute
      const target = pImpl.resolve(pImpl.dirname(pF), decodedPath);
      const targetNorm = normalizePathForCompare(target, platform);

      // Check if target matches any rename entry
      let newTarget: string | undefined;
      for (const pair of renamePairs) {
        // Exact file match
        if (pair.oldNorm === targetNorm) {
          newTarget = pair.newPath;
          break;
        }
        // Folder prefix match (folder rename/move)
        const oldPrefix = pair.oldNorm.endsWith('/') ? pair.oldNorm : pair.oldNorm + '/';
        if (targetNorm.startsWith(oldPrefix)) {
          const remainder = target.slice(pair.oldPath.length);
          newTarget = pair.newPath + remainder;
          break;
        }
      }

      const fileDirChanged =
        normalizePathForCompare(pImpl.dirname(nF), platform) !==
        normalizePathForCompare(pImpl.dirname(pF), platform);

      if (!newTarget && !fileDirChanged) {
        // No rename matches and file didn't move — nothing to do
        continue;
      }

      // If file moved but target didn't match any rename, target stays the same absolute path
      const finalTarget = newTarget ?? target;

      // Compute new relative path
      const newDir = pImpl.dirname(nF);
      let newRelPath = pImpl.relative(newDir, finalTarget);
      // Always use forward slashes in hrefs
      newRelPath = newRelPath.split(pImpl.sep).join('/');

      // Detect if original used ./ prefix
      const hadDotSlashPrefix = rawPathPart.startsWith('./');
      if (hadDotSlashPrefix && !newRelPath.startsWith('./')) {
        newRelPath = './' + newRelPath;
      }

      // Detect if original used % encoding
      const hadEncoding = rawPathPart.includes('%');
      if (hadEncoding) {
        // Encode each path segment separately to preserve /
        newRelPath = encodeHrefPart(newRelPath);
      }

      // Re-append fragment
      const newHref = newRelPath + fragmentPart;

      // Only emit edit if the value actually changed
      if (newHref !== ref.value) {
        edits.push({ start: ref.valueStart, end: ref.valueEnd, newText: newHref });
      }
    }

    if (edits.length > 0) {
      results.push({ path: nF, sourcePath: pF, edits });
    }
  }

  return results;
}
