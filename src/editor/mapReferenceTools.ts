// Pure path helpers behind two context-menu features:
//   - "Find Maps Referencing This File" (findDitaReferences.ts) -- does any
//     href, anywhere in the workspace's maps, resolve to this file?
//   - "Find Unreferenced Resources" (ditaMapTreeProvider.ts) -- which .dita
//     files under the current map's folder does *no* href in this map
//     resolve to?
//
// Both boil down to the same two steps -- turn an href into an absolute
// path, then compare absolute paths across a filesystem that may or may not
// be case-sensitive -- so that logic lives here once, independent of
// vscode, and is unit-tested directly rather than through the commands.

import { resolve } from 'path';
import { decodeHrefPart } from './ditaRenderUtils';

/**
 * The absolute on-disk path an href resolves to, or undefined when the href
 * is empty, an absolute URL (`https://…`, `mailto:…`), or otherwise not a
 * local file reference. Doesn't check the file actually exists on disk --
 * callers that need that (the tree's click-to-open) do it themselves, since
 * "find unreferenced resources" in particular wants to compare against
 * hrefs that may point at a file that was since deleted, not silently drop
 * them.
 */
export function resolveLocalHrefPath(
  mapDir: string,
  href: string | undefined,
): string | undefined {
  if (!href) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return undefined; // absolute URL / mailto: / etc.
  const filePart = decodeHrefPart(href.split('#')[0]);
  if (!filePart) return undefined; // a bare "#fragment" href, e.g. an internal cross-reference
  return resolve(mapDir, filePart);
}

/**
 * Normalizes an absolute path for cross-platform comparison: backslashes to
 * forward slashes so a Windows-style and POSIX-style path to the same file
 * compare equal, lowercased only on win32 (the platform whose default
 * filesystems are case-insensitive -- macOS and Linux are left
 * case-sensitive, matching resolveDitaOtExecutable's own platform split in
 * ditaOtUtils.ts).
 */
export function normalizePathForCompare(
  path: string,
  platform: NodeJS.Platform,
): string {
  const slashed = path.replace(/\\/g, '/');
  return platform === 'win32' ? slashed.toLowerCase() : slashed;
}

/** Whether a map entry's href resolves to the given absolute target path. */
export function hrefMatchesTarget(
  mapDir: string,
  href: string | undefined,
  targetAbsPath: string,
  platform: NodeJS.Platform,
): boolean {
  const abs = resolveLocalHrefPath(mapDir, href);
  if (!abs) return false;
  return (
    normalizePathForCompare(abs, platform) ===
    normalizePathForCompare(targetAbsPath, platform)
  );
}

/**
 * candidateAbsPaths that don't normalize-equal any of referencedAbsPaths --
 * the files a map's own href set never mentions. Order of candidateAbsPaths
 * is preserved; callers sort for display themselves (see
 * findUnreferencedResources in ditaMapTreeProvider.ts).
 */
export function computeUnreferencedFiles(
  candidateAbsPaths: string[],
  referencedAbsPaths: Iterable<string>,
  platform: NodeJS.Platform,
): string[] {
  const referenced = new Set<string>();
  for (const p of referencedAbsPaths)
    referenced.add(normalizePathForCompare(p, platform));
  return candidateAbsPaths.filter(
    (p) => !referenced.has(normalizePathForCompare(p, platform)),
  );
}
