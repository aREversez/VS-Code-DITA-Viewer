/**
 * What docsite (site) mode has put in the webview, and what an edit owes it.
 *
 * Site mode used to answer any source edit by reloading the whole webview,
 * because the sidebar (titles, structure) lives outside the content pane an
 * incremental update touches. It now re-renders both halves and sends only
 * the one(s) that came out different -- an edit that changes neither sends
 * nothing at all. Pure, and out of MapViewerProvider.ts (which imports
 * vscode), so the rule can be unit-tested.
 */
export interface SiteRender {
  /**
   * The sidebar tree as last sent. undefined means "not known to match the
   * webview": after a page switch the webview flipped the active row on its
   * own, so what the host last rendered no longer describes the DOM.
   */
  sidebarTreeHtml: string | undefined;
  pageHtml: string;
}

export function diffSiteRender(
  previous: SiteRender | undefined,
  next: { sidebarTreeHtml: string; pageHtml: string },
): { sidebar?: string; page?: string } {
  const out: { sidebar?: string; page?: string } = {};
  if (previous === undefined || previous.sidebarTreeHtml !== next.sidebarTreeHtml) out.sidebar = next.sidebarTreeHtml;
  if (previous === undefined || previous.pageHtml !== next.pageHtml) out.page = next.pageHtml;
  return out;
}
