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
import { renderChrome } from './templateChrome';
import type { SiteTemplate } from './siteTemplates';

const FIXTURE_SIDEBAR = `
<div id="__site-nav-resizer" class="site-nav-resizer" role="separator" aria-orientation="vertical" tabindex="0"></div>
<nav class="site-nav" aria-label="Table of contents">
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

const FIXTURE_CONTENT = `
<div id="dita-content-root" class="site-main">
  <h1>Getting Started</h1>
  <p>Sample paragraph so text colour and body font are visible against the template background.</p>
  <div class="ditamap-book">
    <div class="book-entry" id="fixture-book-entry">
      <h2>Installation</h2>
      <p>Fixture book entry -- this element's <code>content-visibility</code> is what the visual
      check reads back; a template must not override it.</p>
    </div>
  </div>
</div>`;

const FIXTURE_TOPBAR = `<div id="__topbar"><button id="__fixture-btn" type="button">Mode</button></div>`;

export interface SnapshotOptions {
  /** The full text of media/styles.css, injected so callers don't hardcode a path. */
  baseCss: string;
  template: SiteTemplate;
  /** Reads a css file's text; see buildTemplateStyleText. */
  readFile: (path: string) => string;
  /** Turns an absolute resource path into a URL the browser can load; see buildTemplateStyleText. */
  toUri: (absPath: string) => string;
  mode: 'site' | 'book';
  dark: boolean;
}

/** A self-contained HTML document string, ready for page.goto('file://...') or page.setContent(). */
export function buildTemplateSnapshotHtml(o: SnapshotOptions): string {
  const ctx = { title: 'Fixture Map', year: 2026 };
  const { headerHtml, footerHtml } = renderChrome(o.template, ctx, o.toUri);
  const templateCssText = buildTemplateStyleText(o.template, o.readFile, o.toUri);

  const core = `${FIXTURE_SIDEBAR}\n${FIXTURE_CONTENT}`;
  const shellBody = headerHtml || footerHtml
    ? `${headerHtml ?? ''}\n<div class="site-frame">\n${core}\n</div>\n${footerHtml ?? ''}`
    : core;

  const bodyModeClass = o.mode === 'site' ? 'mode-site' : 'mode-book';
  const shellClass = headerHtml || footerHtml ? ' site-shell' : '';
  const darkClass = o.dark ? ' template-dark' : '';
  const safeId = o.template.id.replace(/[^A-Za-z0-9_-]/g, '_');

  return `<!DOCTYPE html>
<html class="${o.dark ? 'vscode-dark' : 'vscode-light'}">
<head>
<meta charset="utf-8">
<title>Template snapshot: ${o.template.id}</title>
<style id="dita-base-style">${o.baseCss}</style>
<style id="dita-template-style">${templateCssText}</style>
</head>
<body class="${bodyModeClass}${shellClass}${darkClass}" data-template="${safeId}">
${FIXTURE_TOPBAR}
${shellBody}
</body>
</html>`;
}
