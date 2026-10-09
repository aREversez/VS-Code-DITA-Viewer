/**
 * Assembles a standalone HTML document that reproduces, outside VS Code,
 * exactly what a template's css is scoped to style: the same shell classes
 * (`.site-nav`, `.site-frame`, `#dita-content-root.site-main`, the book
 * `content-visibility` selector) that MapViewerProvider builds, plus the
 * template's own header/footer via renderChrome and its css via
 * buildTemplateStyleText -- the same pure functions the real preview uses,
 * so this cannot drift from what a reader actually sees.
 *
 * This exists so a template can be opened in a real, plain browser (see
 * src/test-visual/visual.test.ts) without needing a VS Code webview, which
 * the @vscode/test-electron harness cannot read computed style or take a
 * screenshot from (see src/test-e2e -- it only captures the HTML string
 * handed to the webview, before any css is applied).
 *
 * The fixture sidebar/content below is deliberately small and static: it is
 * not the real renderer's output, just enough of the real shell's markup
 * (nested `.site-nav-item`s including one `.collapsed`, a `.book-entry` for
 * the content-visibility check, an `#__topbar`) for a template's css
 * selectors to have something to match against.
 */
import { buildTemplateStyleText } from './templateStyle';
import { renderChrome, wrapShell } from './templateChrome';
import { renderSiteHomeHtml, renderSiteNavTreeHtml, wrapSiteNavTreeHtml } from './ditaRenderUtils';
import type { SiteTemplate } from './siteTemplates';

/** The sidebar drag handle, exactly as MapViewerProvider emits it. */
const FIXTURE_RESIZER = '<div id="__site-nav-resizer" class="site-nav-resizer" role="separator" aria-orientation="vertical" tabindex="0"></div>';

const FIXTURE_NAV = `<nav class="site-nav" aria-label="Table of contents">
  <ul class="site-nav-tree">
    <li class="site-nav-item has-children">
      <button class="site-nav-toggle" aria-expanded="true"></button>
      <a class="site-nav-link active" href="#"><span class="site-nav-link-text">Getting Started</span></a>
      <ul class="site-nav-children">
        <li class="site-nav-item"><a class="site-nav-link" href="#"><span class="site-nav-link-text">Installation</span></a></li>
        <li class="site-nav-item"><a class="site-nav-link" href="#"><span class="site-nav-link-text">Quick Start</span></a></li>
      </ul>
    </li>
    <li class="site-nav-item has-children collapsed">
      <button class="site-nav-toggle" aria-expanded="false"></button>
      <a class="site-nav-link" href="#"><span class="site-nav-link-text">Reference</span></a>
      <ul class="site-nav-children">
        <li class="site-nav-item"><a class="site-nav-link" href="#"><span class="site-nav-link-text">API</span></a></li>
      </ul>
    </li>
  </ul>
</nav>`;

/**
 * Route A's sidebar half of the fixture: the resizer as a sibling of the nav.
 * Split into the pieces above because the webhelp shell takes them as separate
 * parts, while this function's own-mode output has always been this exact
 * string -- kept byte-identical so the shipped-template screenshots and the
 * content-visibility assertion do not shift.
 */
const FIXTURE_SIDEBAR = `\n${FIXTURE_RESIZER}\n${FIXTURE_NAV}`;

/**
 * The manifest the fixture sidebar is built from: one active top-level entry
 * with two children, and a second branch with one. Shaped so the real renderer
 * produces every tree hook the contract names (topicref, has-children,
 * expanded, active) in one page.
 */
const FIXTURE_NAV_MANIFEST = [
  { absPath: '/w/getting-started.dita', title: 'Getting Started', depth: 0 },
  { absPath: '/w/installation.dita', title: 'Installation', depth: 1 },
  { absPath: '/w/quick-start.dita', title: 'Quick Start', depth: 1 },
  { absPath: '/w/reference.dita', title: 'Reference', depth: 0 },
  { absPath: '/w/api.dita', title: 'API', depth: 1 },
];

/**
 * The sidebar for a webhelp-DOM snapshot, from the REAL renderer rather than a
 * hand-written copy: `li.topicref` is a required contract hook and only
 * renderSiteNavTreeHtml's webhelp branch emits it (route B step 4), so a hand
 * fixture could not satisfy the contract it is supposed to be checking. Route
 * A's snapshot below keeps the hand-written FIXTURE_SIDEBAR unchanged instead
 * of switching to this, so an own-mode page cannot shift by a byte.
 */
const fixtureWebhelpNav = (): string =>
  wrapSiteNavTreeHtml(
    renderSiteNavTreeHtml(
      FIXTURE_NAV_MANIFEST,
      '/w/getting-started.dita',
      { expand: 'Expand', collapse: 'Collapse' },
      new Set<string>(),
      false,
      true,
    ),
    'Table of contents',
  );

const FIXTURE_TOPIC_BODY = `
  <h1>Getting Started</h1>
  <p>Sample paragraph so text colour and body font are visible against the template background.</p>
  <div class="ditamap-book">
    <div class="book-entry" id="fixture-book-entry">
      <h2>Installation</h2>
      <p>Fixture book entry -- this element's <code>content-visibility</code> is what the visual
      check reads back; a template must not override it.</p>
    </div>
  </div>
`;

/** The one node every incremental content swap replaces, in both dom modes. */
const wrapContentRoot = (inner: string): string =>
  `<div id="dita-content-root" class="site-main">${inner}</div>`;

const FIXTURE_CONTENT = `\n${wrapContentRoot(FIXTURE_TOPIC_BODY)}`;

const FIXTURE_TOPBAR = `<div id="__topbar"><button id="__fixture-btn" type="button">Mode</button></div>`;

export interface SnapshotOptions {
  /** The full text of media/styles.css, injected so callers don't hardcode a path. */
  baseCss: string;
  /**
   * The full text of media/webhelp-compat.css. The real preview loads it on
   * EVERY map page (MapViewerProvider's `compatUri` link, always emitted because
   * an in-place mode switch must not need to rebuild <head>), so a webhelp-DOM
   * snapshot without it would lay the page out with only dv-base and would not
   * resemble what the preview shows. Optional: the route A snapshots and the
   * content-visibility kill test pass none, and every rule in it is scoped under
   * body.wh_topic_page, so leaving it out of an own-DOM page changes nothing.
   */
  compatCss?: string;
  template: SiteTemplate;
  /** Reads a css file's text; see buildTemplateStyleText. */
  readFile: (path: string) => string;
  /** Turns an absolute resource path into a URL the browser can load; see buildTemplateStyleText. */
  toUri: (absPath: string) => string;
  mode: 'site' | 'book';
  dark: boolean;
  /**
   * Snapshot the docsite LANDING page (the tile gallery) instead of a topic
   * page. Only meaningful with a webhelp-DOM template, where it is what puts
   * the contract's wh_main_page token on the body and the wh_* names on the
   * tiles (M3-10) so a template css written against those hooks has something
   * real to match. Route A's landing page needs no flag: it is the same
   * .site-home markup either way.
   */
  landingPage?: boolean;
  /**
   * Overrides the markup inside #dita-content-root. The webhelp checks pass
   * real renderer output here (renderTopicXml), because §1 of the contract
   * names body-content class names too -- `h1.topictitle1`, `.shortdesc`,
   * `.body`, `.note__title` -- and a hand-written fixture cannot show a
   * template's css against them without duplicating the renderer by hand and
   * drifting from it. Absent: the built-in FIXTURE_TOPIC_BODY, which is what
   * the shipped route A templates have always rendered.
   */
  contentHtml?: string;
}

/** The landing-page fixture: renderSiteHomeHtml's own output, so the tile
 *  markup the visual check sees is the markup the preview emits -- one call,
 *  webhelp tokens included, no second hand-written copy to drift. */
const FIXTURE_LANDING = (webhelp: boolean): string =>
  renderSiteHomeHtml(
    [
      { title: 'Getting Started', target: '/w/getting-started.dita', role: 'Part I', topicCount: 3 },
      { title: 'Reference', target: '/w/reference.dita', topicType: 'Task', topicCount: 2 },
      { title: 'No chips', target: '/w/plain.dita', topicCount: 1 },
    ],
    { heading: 'Fixture Map', topicCountLabel: (n) => (n === 1 ? '1 topic' : `${n} topics`), webhelp },
  );

/**
 * The shell's `logoUri` argument for a snapshot: the template's own logo file,
 * turned into a URL the same way every other template resource is. An .opt
 * descriptor's <logo> is the only way a template names one (template.json puts
 * its logo inside the `header` part, which the webhelp shell does not use --
 * route B §2.1), and MapViewerProvider passes `template.logo` here too, so this
 * mirrors the live wiring rather than inventing a second one. Undefined when the
 * template has no logo, which is exactly when the contract's optional .wh_logo
 * hook must stay absent.
 */
const templateLogo = (template: SiteTemplate, toUri: (absPath: string) => string): string | undefined =>
  template.logo ? toUri(template.logo) : undefined;

/** A self-contained HTML document string, ready for page.goto('file://...') or page.setContent(). */
export function buildTemplateSnapshotHtml(o: SnapshotOptions): string {
  const ctx = { title: 'Fixture Map', year: 2026 };
  const { headerHtml, footerHtml } = renderChrome(o.template, ctx, o.toUri);
  const templateCssText = buildTemplateStyleText(o.template, o.readFile, o.toUri);

  const webhelp = o.template.dom === 'webhelp';
  // The content that goes INSIDE #dita-content-root: a topic body (default) or
  // the landing-page tile gallery. The gallery is renderSiteHomeHtml's own
  // output, so the tile markup a visual check reads is the markup the preview
  // emits -- webhelp tokens included for a webhelp template, none for route A.
  const inner = o.landingPage
    ? FIXTURE_LANDING(webhelp)
    : o.contentHtml ?? FIXTURE_TOPIC_BODY;
  const contentRoot = wrapContentRoot(inner);

  let bodyClassExtra: string;
  let shellBody: string;
  if (webhelp) {
    // Route B: the SAME wrapShell the live preview calls, so the hook skeleton
    // and the wh_topic_page / wh_main_page body tokens here cannot drift from
    // what a reader gets. headerHtml/footerHtml are ignored by the webhelp
    // branch on purpose -- the webhelp shell owns those regions (route B §2.1).
    const shell = wrapShell({
      sidebarHtml: fixtureWebhelpNav(),
      resizerHtml: FIXTURE_RESIZER,
      contentRootHtml: contentRoot,
      outlineHtml: '<aside id="__site-outline" class="tpl-outline"><div class="tpl-outline-inner"></div></aside>',
      dom: 'webhelp',
      publicationTitle: 'Fixture Map',
      // The real preview hands wrapShell the template's own logo (MapViewerProvider's
      // `logoUri`), which is what makes the contract's optional .wh_logo hook appear.
      // Without it a snapshot of a template that HAS a logo would still lack the hook,
      // and the logo's own rules could never be checked.
      logoUri: templateLogo(o.template, o.toUri),
      mainPage: o.landingPage === true,
    });
    bodyClassExtra = shell.bodyClass;
    shellBody = shell.html;
  } else {
    // Route A (own dom): exactly the assembly this function has always produced
    // for a topic page -- the fixture strings are unchanged and the shell is
    // hand-woven here rather than routed through wrapShell so the shipped-
    // template screenshots and the content-visibility assertion cannot shift by
    // even a newline. (FIXTURE_SIDEBAR is the hand-written resizer+nav pair,
    // not the renderer's; an own-mode page never needs the topicref classes.)
    // FIXTURE_CONTENT is the content root around FIXTURE_TOPIC_BODY and is used
    // verbatim for the default topic page; a landing page or an injected
    // contentHtml instead goes through contentRoot, because the old `core`
    // hardcoded FIXTURE_CONTENT and would otherwise have silently ignored both.
    const core = `${FIXTURE_SIDEBAR}\n${
      o.landingPage || o.contentHtml !== undefined
        ? contentRoot
        : FIXTURE_CONTENT
    }`;
    bodyClassExtra = headerHtml || footerHtml ? ' site-shell' : '';
    shellBody = headerHtml || footerHtml
      ? `${headerHtml ?? ''}\n<div class="site-frame">\n${core}\n</div>\n${footerHtml ?? ''}`
      : core;
  }

  const bodyModeClass = o.mode === 'site' ? 'mode-site' : 'mode-book';
  const darkClass = o.dark ? ' template-dark' : '';
  const safeId = o.template.id.replace(/[^A-Za-z0-9_-]/g, '_');
  const compatStyle = o.compatCss ? `\n<style id="dita-compat-style">${o.compatCss}</style>` : '';

  return `<!DOCTYPE html>
<html class="${o.dark ? 'vscode-dark' : 'vscode-light'}">
<head>
<meta charset="utf-8">
<title>Template snapshot: ${o.template.id}</title>
<style id="dita-base-style">${o.baseCss}</style>${compatStyle}
<style id="dita-template-style">${templateCssText}</style>
</head>
<body class="${bodyModeClass}${bodyClassExtra}${darkClass}" data-template="${safeId}">
${FIXTURE_TOPBAR}
${shellBody}
</body>
</html>`;
}
