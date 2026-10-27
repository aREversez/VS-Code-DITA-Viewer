/**
 * The WebHelp-style page shell (route B, milestone 1 step 3): the skeleton a
 * template with `dom: "webhelp"` lays its content into -- a top bar, a tool
 * bar, three columns (publication toc / topic body / on-this-page outline)
 * and a page footer -- carrying every required hook of the contract in
 * webhelpContract.ts. Pure: no vscode types, so it is unit tested directly,
 * and the caller hands it the sidebar/content/outline markup it has already
 * built so the same node ids (#dita-content-root, #__site-outline) stay
 * unique and the behaviour JS keeps finding them.
 *
 * The optional content of the header (logo, top menu) and the tool bar
 * (breadcrumb, prev/next) is filled by a later step; this step emits the
 * structural containers so each required hook is present whatever the map
 * holds. Every class/id name is a public interface name written by hand here
 * -- no third-party markup, css, script or image.
 */

/** Escape text for an HTML text node: `&` first so entities are not double-encoded. */
export function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape text that will sit inside a double-quoted attribute value. */
export function escapeAttribute(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export interface WebhelpShellParts {
  /** The publication toc tree (a `<nav class="site-nav">`, its rows gaining `topicref` in step 4). */
  sidebarHtml: string;
  /** The sidebar drag handle, kept a sibling of the columns exactly as the own shell keeps it. */
  resizerHtml: string;
  /** The `<div id="dita-content-root">` -- the single node later refreshes diff/patch. */
  contentRootHtml: string;
  /** The on-this-page outline column, dropped into #wh_topic_toc_content when supplied. */
  outlineHtml?: string;
  /** Plain-text publication title for .wh_publication_title (the map title). */
  publicationTitle?: string;
  /** Resolved webview URI of the brand logo; the .wh_logo hook appears only when given. */
  logoUri?: string;
  /**
   * Site mode's landing page (the SITE_HOME_TARGET stop). Adds the contract's
   * `wh_main_page` body token the way M3-10 decided it: ADDITIVE, next to
   * `wh_topic_page`, rather than exclusive the way Oxygen's own output names
   * them. Exclusivity would mean every one of webhelp-compat.css's rules
   * (all 61 of them scoped under body.wh_topic_page) needed a second home
   * page copy -- the base-css rewrite §5 ranks as the riskiest item of the
   * route, and the whole point of the shared shell is not to fork it. A real
   * Oxygen template that tests the two apart (`body:not(.wh_topic_page)`,
   * say) misreads our home page; the compat sheet's own home rules are
   * scoped `body.wh_topic_page.wh_main_page`, so they stay correct here and
   * a user template that needs strict exclusivity can still override.
   */
  mainPage?: boolean;
}

/**
 * The body's children for a webhelp page, plus the body class the contract
 * names (`wh_topic_page`). Unlike the own shell there is no sidebar-less
 * shape: a webhelp template is a site template, and the top bar / tool bar /
 * footer stand whether or not the tree has rows. The three columns and the
 * resizer always sit inside `.wh_content_area`; the shell never re-emits the
 * nodes it is handed, so #dita-content-root stays unique.
 */
export function buildWebhelpShell(p: WebhelpShellParts): { bodyClass: string; html: string } {
  const logo = p.logoUri ? `<span class="wh_logo"><img src="${escapeAttribute(p.logoUri)}" alt=""></span>` : '';
  const title = `<span class="wh_publication_title">${escapeText(p.publicationTitle ?? '')}</span>`;
  const header =
    `<header class="wh_header"><div class="wh_header_flex_container">` +
    `${logo}${title}<ul class="wh_top_menu"></ul>` +
    `</div></header>`;
  const tools =
    `<nav class="wh_tools">` +
    `<div class="wh_breadcrumb"></div>` +
    `<div class="wh_right_tools">` +
    `<span class="wh_navigation_links"><a class="navprev"></a><a class="navnext"></a></span>` +
    `</div>` +
    `</nav>`;
  const columns =
    `<div class="wh_content_area">` +
    `<nav id="wh_publication_toc" class="wh_publication_toc"><div id="wh_publication_toc_content">${p.sidebarHtml}</div></nav>` +
    `\n${p.resizerHtml}\n` +
    `<div id="wh_topic_body" class="wh_topic_body"><div class="wh_topic_content body">${p.contentRootHtml}</div></div>` +
    `<nav id="wh_topic_toc" class="wh_topic_toc"><div id="wh_topic_toc_content">${p.outlineHtml ?? ''}</div></nav>` +
    `</div>`;
  const footer = `<footer class="wh_footer"></footer>`;
  const html = `${header}\n<div id="wh_topic_container">\n${tools}\n${columns}\n</div>\n${footer}\n<button id="go2top" type="button" aria-label="Back to top"></button>`;
  return { bodyClass: p.mainPage ? ' wh_topic_page wh_main_page' : ' wh_topic_page', html };
}
