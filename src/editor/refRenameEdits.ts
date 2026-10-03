// Pure function that computes text edits needed when files are renamed or
// moved. Given a set of rename entries (old→new absolute paths) and a set
// of files with their content, returns the edits required to update every
// href / conref that pointed at a renamed target.
//
// No vscode dependency — only Node path + project utilities.

import { dirname, relative, resolve, sep } from 'path';
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
  path: string;
  edits: Array<{ start: number; end: number; newText: string }>;
}

/**
 * Percent-encodes characters that are not unreserved in a URI path segment
 * (RFC 3986 §2.3), preserving `/` so multi-segment relative paths stay valid.
 */
export function encodeHrefPart(part: string): string {
  return part.replace(/[^a-zA-Z0-9._~\-/]/g, (c) =>
    '%' +
    c
      .charCodeAt(0)
      .toString(16)
      .toUpperCase()
      .padStart(2, '0'),
  );
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

  // Use path module matching the target platform so that POSIX absolute
  // paths (e.g. `/project`) don't get a drive letter on Windows hosts.
  const pImpl =
    platform === 'win32'
      ? ({ dirname, relative, resolve, sep } as typeof import('path'))
      : (pathPosix as unknown as typeof import('path'));

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
      results.push({ path: nF, edits });
    }
  }

  return results;
}
