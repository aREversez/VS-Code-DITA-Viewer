/**
 * The page chrome a template can add around a docsite/book page: a header
 * (logo, title, tagline, banner image, links) and a footer (logo, text,
 * links), plus the wrapper that lays them out around the sidebar and the
 * content pane. Pure -- the webview-URI mapping is injected -- so it is unit
 * tested, including that nothing a template says can become markup.
 */
import type { SiteTemplate, TemplateFooter, TemplateHeader, TemplateLink } from './siteTemplates';

export function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttribute(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** {title} and {year} only; anything else in braces is left as written. */
export function fillPlaceholders(text: string, ctx: { title: string; year: number }): string {
  return text.replace(/\{(title|year)\}/g, (_m, key: string) => (key === 'title' ? ctx.title : String(ctx.year)));
}

/** A URL made safe to sit inside url("...") in an inline style: quotes and parentheses encoded. */
export function cssUrlSafe(uri: string): string {
  return uri.replace(/["'()\\\s<>]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
}

function renderLinks(links: readonly TemplateLink[]): string {
  if (links.length === 0) return '';
  const items = links.map((l) => `<a class="tpl-link" href="${escapeAttribute(l.href)}" rel="noopener noreferrer">${escapeText(l.label)}</a>`);
  return `<nav class="tpl-links">${items.join('')}</nav>`;
}

export function renderTemplateHeader(h: TemplateHeader, ctx: { title: string; year: number }, toUri: (abs: string) => string): string {
  const logo = h.logo ? `<img class="tpl-logo" src="${escapeAttribute(toUri(h.logo))}" alt="">` : '';
  const title = h.title !== undefined ? h.title : '{title}';
  const titleHtml = title ? `<span class="tpl-title">${escapeText(fillPlaceholders(title, ctx))}</span>` : '';
  const tagline = h.tagline ? `<span class="tpl-tagline">${escapeText(fillPlaceholders(h.tagline, ctx))}</span>` : '';
  const style = h.banner ? ` style="background-image:url(&quot;${escapeAttribute(cssUrlSafe(toUri(h.banner)))}&quot;)"` : '';
  const cls = h.banner ? 'tpl-header tpl-header--banner' : 'tpl-header';
  return `<header class="${cls}"${style}><div class="tpl-brand">${logo}<span class="tpl-brand-text">${titleHtml}${tagline}</span></div>${renderLinks(h.links)}</header>`;
}

export function renderTemplateFooter(f: TemplateFooter, ctx: { title: string; year: number }, toUri: (abs: string) => string): string {
  const logo = f.logo ? `<img class="tpl-logo tpl-logo--footer" src="${escapeAttribute(toUri(f.logo))}" alt="">` : '';
  const text = f.text ? `<span class="tpl-footer-text">${escapeText(fillPlaceholders(f.text, ctx))}</span>` : '';
  return `<footer class="tpl-footer"><div class="tpl-footer-brand">${logo}${text}</div>${renderLinks(f.links)}</footer>`;
}

/** The map's own title: a bookmap's main book title, else the first <title>, else the file name. */
export function mapTitleFromXml(xml: string, fileName: string): string {
  const inner = (tag: string): string | undefined => {
    const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
    if (!m) return undefined;
    const text = m[1]
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
    return text || undefined;
  };
  return inner('mainbooktitle') ?? inner('title') ?? fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');
}

export interface ShellParts {
  sidebarHtml: string;
  resizerHtml: string;
  contentRootHtml: string;
  headerHtml?: string;
  footerHtml?: string;
}

/**
 * The body's children. Without chrome it is exactly what the page always
 * had -- sidebar, resizer, content, as siblings -- so a page with no
 * template (or a template without header and footer) is untouched. With
 * chrome, the three are wrapped in .site-frame between the header and the
 * footer; only a page that HAS a sidebar gets chrome (a book with an empty
 * sidebar is not laid out as a docsite).
 */
export function wrapShell(p: ShellParts): { bodyClass: string; html: string } {
  const hasChrome = p.sidebarHtml !== '' && (p.headerHtml !== undefined || p.footerHtml !== undefined);
  const core = `${p.sidebarHtml}\n${p.resizerHtml}\n${p.contentRootHtml}`;
  if (!hasChrome) return { bodyClass: '', html: core };
  return {
    bodyClass: ' tpl-shell',
    html: `${p.headerHtml ?? ''}\n<div class="site-frame">\n${core}\n</div>\n${p.footerHtml ?? ''}`,
  };
}

/** Header and footer HTML for a template, or undefined for parts it does not have. */
export function renderChrome(
  t: SiteTemplate | undefined,
  ctx: { title: string; year: number },
  toUri: (abs: string) => string,
): { headerHtml?: string; footerHtml?: string } {
  if (!t) return {};
  return {
    headerHtml: t.header ? renderTemplateHeader(t.header, ctx, toUri) : undefined,
    footerHtml: t.footer ? renderTemplateFooter(t.footer, ctx, toUri) : undefined,
  };
}
