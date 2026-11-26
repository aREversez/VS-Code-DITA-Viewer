/**
 * Whether a document-supplied href may become a clickable `href` in rendered or
 * exported HTML. The preview webview has a CSP, but an exported page has none,
 * so `<link href="javascript:...">` or a `data:text/html` link written in a
 * DITA source would run when the exported file is opened and clicked.
 *
 * Allowed: an in-page anchor, http(s), mailto, or a scheme-less relative path.
 * Everything else with a scheme (javascript:, data:, vbscript:, file:, a
 * drive-letter path) is refused. Browsers drop tab / newline / control
 * characters while parsing a URL scheme (`java\tscript:`), so they are removed
 * before looking for one.
 */
export function isSafeHref(href: string): boolean {
  const h = href.replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
  if (h === '') return false;
  if (h.startsWith('#')) return true;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(h);
  if (!scheme) return true;
  return /^(https?|mailto)$/i.test(scheme[1]);
}
