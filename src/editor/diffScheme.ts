// The virtual `dita-diff` scheme behind the native source diff, kept free of
// `vscode` so the rules about it can be tested and shared by the language
// features and the diff provider alike.

export const DITA_DIFF_SCHEME = 'dita-diff';

export function isDiffVirtualScheme(scheme: string): boolean {
  return scheme === DITA_DIFF_SCHEME;
}

// The two virtual files carry the compared document's URI in `doc=`, stamped by
// openSourceDiff. Returns that URI string, or undefined when the URI is not a
// diff document or has no such query.
export function docUriStringFromDiffUri(uri: { scheme: string; query: string }): string | undefined {
  if (!isDiffVirtualScheme(uri.scheme)) return undefined;
  return new URLSearchParams(uri.query).get('doc') || undefined;
}
