/**
 * Turns a template's css files into one <style> block for the map webview.
 * Pure (file reading and the webview-URI mapping are injected) so it is unit
 * tested. Relative url(...) references are rewritten to webview URIs, but
 * only when they stay inside the template folder; @import is dropped (the
 * webview's CSP would block it anyway, and it is how a stylesheet would reach
 * outside the folder).
 */
import { dirname, isAbsolute, join, normalize, sep } from 'path';
import { SiteTemplate } from './siteTemplates';

const URL_RE = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;
const EXTERNAL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/**
 * `join(cssDir, relPath)`, but only if it stays inside `templateDir` once
 * both are normalized; undefined (blank it out) if it would escape, or was
 * already an absolute reference.
 *
 * Deliberately join()+normalize() rather than resolve()+relative(): resolve()
 * anchors a drive-less path (on Windows, one built without a leading `C:` --
 * exactly what a root given as e.g. `/tpl/red` produces) to the process's
 * cwd, so templateDir and the css-relative target can silently end up
 * resolved against different drives and compare as unrelated even though
 * they are the same folder.
 */
function resolveInsideTemplate(templateDir: string, cssDir: string, relPath: string): string | undefined {
  if (!relPath || isAbsolute(relPath)) return undefined;
  const base = normalize(templateDir).replace(/[\\/]+$/, '');
  const abs = normalize(join(cssDir, relPath));
  if (abs !== base && !abs.startsWith(base + sep)) return undefined;
  return abs;
}

export function rewriteCssUrls(css: string, cssFile: string, templateDir: string, toUri: (absPath: string) => string): string {
  const cssDir = dirname(cssFile);
  return css
    .replace(/@import\b[^;{]*;?/gi, '')
    .replace(URL_RE, (_m, _q: string, raw: string) => {
      const u = raw.trim();
      if (u === '') return 'url("")';
      if (/^(?:data:|#)/i.test(u)) return `url("${u}")`;
      if (EXTERNAL_RE.test(u)) return 'url("")'; // http(s):, file:, //host -- not loadable, and not ours to allow
      const m = /^([^?#]*)([?#].*)?$/.exec(u);
      const path = m ? m[1] : u;
      const suffix = m && m[2] ? m[2] : '';
      const inside = resolveInsideTemplate(templateDir, cssDir, path);
      return inside ? `url("${toUri(inside)}${suffix}")` : 'url("")';
    });
}

/** A </style> in css text would end the block early and let markup through. */
function escapeForStyleElement(css: string): string {
  return css.replace(/<\/(style)/gi, '<\\/$1');
}

/**
 * The template's own css, joined and made safe to drop into a <style>
 * element, WITHOUT the surrounding tag. The map webview keeps a persistent
 * `<style id="dita-template-style">` in its head so an in-place mode switch
 * can swap only this text (see MapViewerProvider's applyModeStage); the full
 * document build wraps it with buildTemplateStyle below.
 */
export function buildTemplateStyleText(t: SiteTemplate, readFile: (p: string) => string, toUri: (absPath: string) => string): string {
  const parts: string[] = [];
  for (const file of t.css) {
    let text: string;
    try {
      text = readFile(file);
    } catch {
      continue; // vanished since discovery; the rest of the template still applies
    }
    parts.push(rewriteCssUrls(text, file, t.dir, toUri));
  }
  return escapeForStyleElement(parts.join('\n'));
}

export function buildTemplateStyle(t: SiteTemplate, readFile: (p: string) => string, toUri: (absPath: string) => string): string {
  return `<style id="dita-template-style">\n${buildTemplateStyleText(t, readFile, toUri)}\n</style>`;
}

/** The sanitised value of the body's `data-template` hook for a template id. */
export function templateDataAttr(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '_');
}

/** Attributes for <body>: a hook for template css (`body[data-template="id"]`) and a dark marker. */
export function templateBodyAttrs(t: SiteTemplate | undefined): { className: string; attrs: string } {
  if (!t) return { className: '', attrs: '' };
  const safeId = templateDataAttr(t.id);
  return { className: t.defaultDark ? ' template-dark' : '', attrs: ` data-template="${safeId}"` };
}
