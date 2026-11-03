// The rule that decides whether a path-valued attribute points at a file that
// is not there. Two callers need it and must agree: the broken-reference
// diagnostics (which report a reference) and "Fix Broken References…" (which
// repairs one). It lives here, as a pure function over text + an `exists`
// callback, so both sides read the same rule instead of keeping a copy each.
//
// No vscode dependency — Node path + the core reference scanner only.

import * as pathWin32 from 'path/win32';
import * as pathPosix from 'path/posix';
import { collectRefEntries, decodeHrefPart, isExternalRef } from '@dita-viewer/core';

/**
 * Attributes whose value names a file that already exists. `copy-to` is
 * deliberately absent: it names a file *to be generated*, so every map with a
 * `copy-to` would otherwise be reported as broken.
 */
export const FILE_REF_ATTRS: ReadonlySet<string> = new Set([
  'href',
  'conref',
  'conrefend',
  'data',
  'longdescref',
]);

/** How many files one scan reads; the same cap the rename participant uses. */
export const MAX_SCANNED_FILES = 5000;

export interface SourceFile {
  /** Absolute path of the file that holds the reference. */
  path: string;
  text: string;
}

/** Where a reference value points, after decoding and resolving. */
export interface RefTarget {
  /** The path part exactly as written (before `#`, before decoding). */
  filePart: string;
  /** The fragment including its leading `#`, or ''. */
  fragment: string;
  /** Absolute path of the referenced file. */
  targetPath: string;
}

/**
 * The file a reference attribute value points at, or undefined when the value
 * is not a reference to a nearby file: empty, an external / peer / absolute
 * reference, or one built from an entity, which cannot be resolved from the
 * text alone. A bare `#fragment` points at the file that holds it, which is
 * what `filePart === ''` and `targetPath === fromFile` mean.
 */
export function refTargetOf(
  value: string,
  scope: string | undefined,
  fromFile: string,
  platform: NodeJS.Platform,
): RefTarget | undefined {
  if (!value) return undefined;
  if (isExternalRef(value, scope)) return undefined;
  if (value.includes('&')) return undefined;

  const hashIdx = value.indexOf('#');
  const filePart = hashIdx >= 0 ? value.slice(0, hashIdx) : value;
  const fragment = hashIdx >= 0 ? value.slice(hashIdx) : '';

  // Pick the path flavour by the target platform, not the host, so the result
  // is deterministic (and testable) on any machine.
  const pImpl = (platform === 'win32' ? pathWin32 : pathPosix) as typeof import('path');
  if (!filePart) return { filePart, fragment, targetPath: pImpl.normalize(fromFile) };

  const decodedPath = decodeHrefPart(filePart);
  if (!decodedPath) return undefined;

  const targetPath = pImpl.resolve(pImpl.dirname(fromFile), decodedPath);
  return { filePart, fragment, targetPath };
}

/** A reference whose target file does not exist. */
export interface BrokenRef extends RefTarget {
  /** The file that holds the reference. */
  file: string;
  /** Attribute that carries it (href / conref / conrefend / data / longdescref). */
  attr: string;
  /** The attribute value as written, fragment included. */
  value: string;
  /** Offsets of the value inside the holding file's text. */
  valueStart: number;
  valueEnd: number;
}

/**
 * Every reference in `file` that points at a file which is not there.
 * `exists` is the caller's file-system probe: diagnostics pass `existsSync`,
 * the scan passes a memoized one, and neither changes what counts as broken.
 */
export function findBrokenRefs(opts: {
  file: SourceFile;
  exists: (p: string) => boolean;
  platform: NodeJS.Platform;
}): BrokenRef[] {
  const { file, exists, platform } = opts;
  const broken: BrokenRef[] = [];
  for (const entry of collectRefEntries(file.text, FILE_REF_ATTRS)) {
    const target = refTargetOf(entry.value, entry.scope, file.path, platform);
    if (!target) continue;
    // A same-file reference names no file of its own, so it cannot be missing.
    if (!target.filePart) continue;
    if (exists(target.targetPath)) continue;
    broken.push({
      file: file.path,
      attr: entry.attr,
      value: entry.value,
      valueStart: entry.valueStart,
      valueEnd: entry.valueEnd,
      ...target,
    });
  }
  return broken;
}
