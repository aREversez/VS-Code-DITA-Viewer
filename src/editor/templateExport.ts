/**
 * Static DITA-OT export: turning the transform's html5/xhtml output into a
 * site that wears one of the media/templates/* templates -- the same shell
 * markup (.site-nav / #dita-content-root.site-main / .site-frame, the same
 * renderChrome/wrapShell and template-css builders) the Docsite preview
 * renders inside VS Code (MapViewerProvider.getRenderedContent), rebuilt
 * here around DITA-OT's own pages instead of the extension's renderer.
 *
 * Everything in this file is pure Node/fs (no vscode types) so it can be
 * unit tested against real temp directories, exactly like siteTemplates.ts;
 * extension.ts owns only the walking of the output tree and the writing.
 *
 * Shape of the injected site (per exported html file):
 *   <outputDir>/_template/<id>/               the whole template folder, copied
 *   <outputDir>/_template/<id>/dv-styles.css  template css with url()s
 *                                             rewritten to site-root paths
 *   <outputDir>/dita-viewer-site-shell.css    page-shell layout (shipped file)
 *   <outputDir>/dita-viewer-template-chrome.css  dv-* feature widgets
 *   <outputDir>/dita-viewer-chrome.js         features + sidebar nav/fold wiring
 */
import { readFileSync } from 'fs';
import { dirname, relative, resolve, sep } from 'path';
import { parseDitamap, preprocessEntities } from '../parser/ditaParser';
import { collectMapEntries } from '../render/mapTypeMap';
import type { SiteTemplate } from './siteTemplates';
import { buildTemplateStyleText, templateDataAttr } from './templateStyle';
import { renderChrome, wrapShell } from './templateChrome';
import {
  buildBookNavManifest,
  escapeAttr,
  escapeHtml,
  type DocsiteNavEntry,
  renderSiteNavTreeHtml,
  wrapSiteNavTreeHtml,
} from './ditaRenderUtils';

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Any source topic path -> the html DITA-OT writes for it: the last
 *  segment's extension (any of them) becomes '.html', matching how
 *  buildNavManifest reduces every href to `<basename>.html`. */
function htmlOutPath(relPosix: string): string {
  const slash = relPosix.lastIndexOf('/');
  const dot = relPosix.lastIndexOf('.');
  return dot > slash ? relPosix.slice(0, dot) + '.html' : relPosix + '.html';
}

export interface TemplateNav {
  /** The sidebar's own data: DocsiteNavEntry exactly as the preview builds
   *  it (buildBookNavManifest), except that each navigable entry's absPath
   *  is the '_root_/<site-rel output path>' pseudo-path below rather than
   *  a filesystem path -- so the tree markup, the fold-state ids and the
   *  active-row matching all work unchanged. */
  manifest: DocsiteNavEntry[];
  /** Ordered list of the site's pages (reading order), for the chrome
   *  script's prev/next buttons -- same shape as the legacy manifest. */
  pages: { file: string; title: string }[];
}

/**
 * The map's navigation tree for the exported site. Sub-maps are expanded
 * in place first; an entry whose topic file resolves OUTSIDE the output
 * root gets no page path of its own (DITA-OT's mirror rule cannot be
 * predicted for it) and degrades to a non-clickable group label, exactly
 * like a <topichead> -- the branch under it still navigates.
 */
export function buildTemplateNav(input: {
  mapPath: string;
  readText?: (path: string) => string;
  resolveKey?: (key: string) => string | undefined;
  resolveTopicTitle?: (href: string) => string | undefined;
}): TemplateNav {
  const readText = input.readText ?? ((p) => readFileSync(p, 'utf-8'));
  const mapPath = resolve(input.mapPath);
  const mapDir = dirname(mapPath);

  const doc = parseDitamap(preprocessEntities(readText(mapPath)));
  const entries = collectMapEntries(doc.root, input.resolveKey);
  const manifest = buildBookNavManifest(entries, mapDir, input.resolveTopicTitle);

  const pages: { file: string; title: string }[] = [];
  for (const entry of manifest) {
    if (entry.isGroup || !entry.absPath) continue;
    // DITA-OT mirrors the map's own tree under the output dir, dropping the
    // '../' segments a map in a sub-folder uses to reach sibling topics --
    // exactly the escape normalizeIndexHtmlLinks strips on index.html. A
    // topic at mapDir-relative '../topics/foo.dita' is written to
    // '<output>/topics/foo.html', so that is its site path.
    const fromMap = toPosix(relative(mapDir, entry.absPath));
    const outFile = htmlOutPath(fromMap.replace(/^(\.\.\/)+/, ''));
    entry.absPath = '_root_/' + outFile;
    entry.href = outFile;
    pages.push({ file: outFile, title: entry.title });
  }
  return { manifest, pages };
}

/**
 * The static sidebar: the preview's nested tree markup (fold toggles,
 * chips, roving tabindex included), wrapped in the .site-nav <nav> the
 * template css styles. `currentAbsPath` is the page being wrapped, in the
 * same '_root_/…' form buildTemplateNav produces -- its row arrives
 * `active` and every ancestor expanded (revealActive), so the reader sees
 * where they are with no runtime JS. A stored fold set folds additional
 * branches (the chrome script persists it to localStorage as they fold).
 */
export function renderSidebarHtml(
  manifest: readonly DocsiteNavEntry[],
  currentAbsPath: string,
  labels: { nav: string; expand: string; collapse: string },
  collapsedIds: ReadonlySet<string> = new Set(),
): string {
  if (manifest.length === 0) return '';
  const tree = renderSiteNavTreeHtml(
    [...manifest],
    currentAbsPath,
    { expand: labels.expand, collapse: labels.collapse },
    collapsedIds,
    true,
  );
  return wrapSiteNavTreeHtml(tree, labels.nav);
}

/** h1-h3 headings of the wrapped content, in document order. */
export interface OutlineHeading {
  id: string;
  text: string;
  level: number;
}

/**
 * Collects the on-this-page headings and, when a heading carries no id,
 * stamps a generated one onto the content html (an exported page is a real
 * document -- unlike the preview's client-side ensureId, the ids have to be
 * in the markup for the '#id' links to work). Returns the possibly-rewritten
 * content plus the heading list. The main[role=main] region is scanned, so
 * DITA-OT's own chrome outside it can never join the outline.
 */
export function collectOutline(contentHtml: string): { contentHtml: string; headings: OutlineHeading[] } {
  const headings: OutlineHeading[] = [];
  let seq = 0;
  const rewritten = contentHtml.replace(/<h([1-3])\b((?:\s+[^<>]*?)?)>/gi, (m, level, attrs: string) => {
    const idMatch = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    const id = idMatch ? idMatch[1] ?? idMatch[2] ?? '' : '';
    const finalId = id || `dv-outline-${seq++}`;
    const nextAttrs = id ? attrs : `${attrs} id="${finalId}"`;
    headings.push({ id: finalId, text: '', level: Number(level) });
    return `<h${level}${nextAttrs}>`;
  });
  // Second pass: read each heading's text out of the (rewritten) markup.
  for (const h of headings) {
    const esc = h.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`<h${h.level}\\b[^>]*\\bid="${esc}"[^>]*>([\\s\\S]*?)</h${h.level}>`, 'i').exec(rewritten);
    h.text = m ? m[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '';
  }
  return { contentHtml: rewritten, headings };
}

/**
 * The on-this-page outline column, in the markup the template css and the
 * preview's .tpl-outline rules already know. Undefined unless the template
 * opted in AND the page has at least two headings -- the same minimum
 * getOutlineSyncScript enforces client-side with .tpl-outline--empty,
 * decided at build time here instead.
 */
export function renderOutlineHtml(headings: readonly OutlineHeading[]): string | undefined {
  if (headings.length < 2) return undefined;
  const links = headings
    .map(
      (h) =>
        `<a class="tpl-outline-link" href="#${escapeAttr(h.id)}" data-outline-target="${escapeAttr(h.id)}" data-outline-level="${h.level}">${escapeHtml(h.text)}</a>`,
    )
    .join('');
  return `<aside id="__site-outline" class="tpl-outline"><div class="tpl-outline-inner">${links}</div></aside>`;
}

/** The class list merge onto an existing '<body ...>' attribute string. */
function mergeClass(attrs: string, add: string): string {
  const m = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
  if (!m) return `${attrs} class="${add.trim()}"`;
  const existing = (m[1] ?? m[2] ?? '').trim();
  const next = `${existing} ${add}`.trim();
  return attrs.slice(0, m.index) + `class="${next}"` + attrs.slice(m.index + m[0].length);
}

export interface ShellPageInput {
  /** The DITA-OT-produced html of one page. */
  html: string;
  template: SiteTemplate;
  /** Sidebar <nav> for this page (renderSidebarHtml output), '' for none. */
  sidebarHtml: string;
  /** Generate the on-this-page outline from this page's own headings. Only
   *  templates that opted in (SiteTemplate.outline) pass true; the heading
   *  ids are stamped into the moved content so the '#id' links resolve. */
  outline?: boolean;
  /** Site title for the header/footer {title} placeholder (the map title). */
  mapTitle: string;
  year: number;
  /** Turns an absolute template-resource path into the href a page uses
   *  (extension.ts feeds `prefix + '_template/<id>/…'`). */
  toRelative: (absPath: string) => string;
  /** Snippet inserted right after the '<body ...>' opening tag (the dark
   *  palette bootstrap); extension.ts builds it once per export. */
  bodyBootstrapHtml?: string;
  /** Markup inserted before '</head>' (css links, bootstrap + chrome
   *  scripts) -- the caller owns what the static site loads. */
  headInjectHtml?: string;
}

/**
 * Rebuilds one DITA-OT output page inside the template shell. The topic's
 * own <main role="main"> moves into #dita-content-root.site-main UNCHANGED
 * (relative links inside it keep resolving from the page's own folder --
 * the page itself never moves), and everything the template supplies --
 * header, sidebar, outline, footer -- is the same pure chrome the preview
 * uses. A page without a <main> (DITA-OT's map landing page, whose body IS
 * the TOC) has its whole body content treated as the main region instead.
 */
export function buildShellPageHtml(input: ShellPageInput): string {
  const bodyMatch = /<body\b([^>]*)>/i.exec(input.html);
  const bodyClose = input.html.toLowerCase().lastIndexOf('</body>');
  if (!bodyMatch || bodyClose < 0) return input.html;

  const inner = input.html.slice(bodyMatch.index + bodyMatch[0].length, bodyClose);
  const main = /<main\b[^>]*\brole\s*=\s*["']main["'][^>]*>([\s\S]*?)<\/main>/i.exec(inner) || /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(inner);
  let contentHtml = main ? main[1] : inner;

  let outline = '';
  if (input.outline) {
    const collected = collectOutline(contentHtml);
    contentHtml = collected.contentHtml;
    outline = renderOutlineHtml(collected.headings) ?? '';
  }

  const chrome = renderChrome(input.template, { title: input.mapTitle, year: input.year }, input.toRelative);
  const shell = wrapShell({
    sidebarHtml: input.sidebarHtml,
    resizerHtml: input.sidebarHtml
      ? '<div id="__site-nav-resizer" class="site-nav-resizer" role="separator" aria-orientation="vertical" tabindex="0"></div>'
      : '',
    contentRootHtml: `<div id="dita-content-root"${input.sidebarHtml || outline ? ' class="site-main"' : ''}>${contentHtml}</div>`,
    outlineHtml: outline || undefined,
    headerHtml: chrome.headerHtml,
    footerHtml: chrome.footerHtml,
  });

  let bodyAttrs = mergeClass(bodyMatch[1], `mode-site${shell.bodyClass}`);
  if (!/\bdata-template\s*=/i.test(bodyAttrs)) {
    bodyAttrs += ` data-template="${templateDataAttr(input.template.id)}"`;
  }

  const headEnd = input.html.toLowerCase().indexOf('</head>');
  const before = headEnd >= 0 ? input.html.slice(0, headEnd) : input.html.slice(0, bodyMatch.index);
  const between = headEnd >= 0 ? input.html.slice(headEnd + '</head>'.length, bodyMatch.index) : '';
  const after = input.html.slice(bodyClose + '</body>'.length);

  return (
    `${before}${input.headInjectHtml ?? ''}</head>${between}` +
    `<body${bodyAttrs}>${input.bodyBootstrapHtml ?? ''}${shell.html}</body>${after}`
  );
}

/**
 * The full <head> injection for a template-mode page, in cascade order:
 * the template's own css (a generated file inside the copied template
 * folder, so its url()s sit beside the resources they name), the shell
 * layout, the dv-* feature widgets, then the before-paint bootstrap script
 * and the deferred chrome script (it manipulates the sidebar/body, so it
 * must run after parse -- defer keeps that off the critical path). All
 * hrefs arrive already depth-prefixed by the caller.
 */
export interface ShellAssetHrefs {
  templateCss: string;
  shellCss: string;
  chromeCss: string;
  chromeJs: string;
}

export function buildHeadInjectHtml(href: ShellAssetHrefs, headBootstrapScript: string): string {
  const link = (h: string) => `<link rel="stylesheet" type="text/css" href="${escapeAttr(h)}">`;
  return (
    link(href.templateCss) +
    link(href.shellCss) +
    link(href.chromeCss) +
    '<script>' + headBootstrapScript + '</script>' +
    '<script defer src="' + escapeAttr(href.chromeJs) + '"></script>'
  );
}

/**
 * Body-level before-paint script for a template-mode export: syncs the
 * template's own dark palette (body.template-dark) with the same 'dv-theme'
 * preference the html.dark toggle uses, falling back to the OS preference,
 * then to the template's defaultDark. Placed right after <body> opens so
 * the class lands before any content paints (a <head> script has no body
 * yet); the existing head bootstrap keeps doing the same job for html.dark.
 */
export function buildTemplateDarkBootstrapScript(defaultDark: boolean): string {
  const def = defaultDark ? 'true' : 'false';
  return (
    "(function(){try{var b=document.body;" +
    "var s=localStorage.getItem('dv-theme');" +
    'var d=s!==null?s===\'dark\':(window.matchMedia?window.matchMedia(\'(prefers-color-scheme: dark)\').matches:' +
    def +
    ');' +
    'if(d)b.className+=(b.className?" ":"")+"template-dark";}catch(e){}})();'
  );
}

function joinAsset(extPath: string, ...parts: string[]): string {
  return [extPath, ...parts].join(sep);
}

/** The shell-layout css shipped for template-mode exports. */
export function readShellCss(extPath: string): string {
  return readFileSync(joinAsset(extPath, 'media', 'transform-assets', 'site-shell.css'), 'utf-8');
}

/** The dv-* feature-widget css for template-mode exports. */
export function readTemplateChromeCss(extPath: string): string {
  return readFileSync(joinAsset(extPath, 'media', 'transform-assets', 'template-chrome.css'), 'utf-8');
}

/** The template's css with url()s rewritten through `toRelative` (which
 *  maps them onto `_template/<id>/...`, site-root-relative then
 *  depth-prefixed) -- the same builder the preview feeds webview URIs. */
export function buildTemplateCssText(template: SiteTemplate, toRelative: (abs: string) => string): string {
  return buildTemplateStyleText(template, (p) => readFileSync(p, 'utf-8'), toRelative);
}
