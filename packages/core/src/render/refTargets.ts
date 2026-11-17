// What a reference can point at, as far as the broken-reference hints are
// concerned: is this a target the hints may probe at all?
//
// A LEAF module (no imports, not even 'path'), like refErrorTexts.ts, so the
// renderer (baseTypeMap), the resolver factory (editor/refResolvers) and the
// conkeyref diagnosis (editor/conkeyref) can share ONE rule without a cycle
// or a dependency on the filesystem layer. Three call sites used to spell the
// rule out separately; a fourth extension (or a new scheme) now changes one
// place.

/** A URL scheme (https:, mailto:, ...) -- and, by the same shape, a Windows
 *  drive letter (C:\...), which is no DITA-relative path either. */
export const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * True for a file part that is not a local DITA document, so a hint must
 * never probe it: a URL, an absolute path, or a web document (.html, .htm,
 * .pdf), whose #fragment is the format's own (#page=3, #section) rather than
 * a DITA id. Pass the part BEFORE any '#'.
 */
export function isNonDitaTarget(filePart: string): boolean {
  return URL_SCHEME_RE.test(filePart) || /^[\\/]/.test(filePart) || /\.(html?|pdf)$/i.test(filePart);
}

/** True when an @format value names a DITA target (absent means DITA). */
export function isDitaFormat(format: string | undefined): boolean {
  return !format || format === 'dita' || format === 'ditamap';
}
