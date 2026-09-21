/**
 * Site/book-mode templates: discovery and descriptor parsing. No vscode
 * types here, so all of it is unit tested against real temp directories.
 *
 * A template is one sub-folder of a templates root. Its descriptor is either
 * our own `template.json` or a `<publishing-template>` `.opt` file (only the
 * name, tags, preview image and css list are read from that; the `webhelp.*`
 * parameters steer a transformation's output structure and mean nothing to
 * the preview). Everything a descriptor names must resolve INSIDE the
 * template folder -- a template cannot point at files elsewhere on disk.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { isAbsolute, join, relative, resolve, sep } from 'path';

export interface SiteTemplate {
  /** The template folder's name, unique within one discovery result. */
  id: string;
  /** Display names by language tag; '' holds the language-neutral name. */
  names: Record<string, string>;
  description?: string;
  /** Raw layout keyword (validated against the built-in layouts later). */
  layout?: string;
  defaultDark: boolean;
  /** Absolute paths, in injection order. At least one. */
  css: string[];
  thumbnail?: string;
  header?: string;
  footer?: string;
  /** Absolute path of the template folder. */
  dir: string;
  builtin: boolean;
}

export interface TemplateDiagnostic {
  dir: string;
  message: string;
}

/** What a descriptor says, before its file references are checked on disk. */
export interface TemplateDescriptor {
  names: Record<string, string>;
  description?: string;
  layout?: string;
  defaultDark: boolean;
  css: string[];
  thumbnail?: string;
  header?: string;
  footer?: string;
}

export type ParseResult = { ok: true; descriptor: TemplateDescriptor } | { ok: false; error: string };

/** `rel` resolved against `dir`, or undefined when it is absolute or escapes `dir`. */
export function resolveInside(dir: string, rel: string): string | undefined {
  if (!rel || isAbsolute(rel)) return undefined;
  const abs = resolve(dir, rel);
  const back = relative(dir, abs);
  if (back === '' || back.startsWith('..') || isAbsolute(back) || back.split(sep).includes('..')) return undefined;
  return abs;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

export function parseTemplateJson(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `template.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: 'template.json must be an object' };
  const o = raw as Record<string, unknown>;

  const names: Record<string, string> = {};
  if (typeof o.name === 'string' && o.name.trim()) names[''] = o.name.trim();
  else if (typeof o.name === 'object' && o.name !== null) {
    for (const [lang, v] of Object.entries(o.name as Record<string, unknown>)) {
      const s = asString(v);
      if (s) names[lang.toLowerCase()] = s;
    }
  }

  const css = Array.isArray(o.css) ? o.css.filter((c): c is string => typeof c === 'string' && c.trim() !== '') : [];
  if (css.length === 0) return { ok: false, error: 'template.json needs a non-empty "css" list' };

  return {
    ok: true,
    descriptor: {
      names,
      description: asString(o.description),
      layout: asString(o.layout),
      defaultDark: o.defaultDark === true,
      css,
      thumbnail: asString(o.thumbnail),
      header: asString(o.header),
      footer: asString(o.footer),
    },
  };
}

function decodeXmlText(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Reads a `<publishing-template>` descriptor. The file is tiny and flat, so
 * a small scanner over its tags is enough; anything it does not recognise
 * (including every <parameter>) is ignored.
 */
export function parseTemplateOpt(text: string): ParseResult {
  const xml = text.replace(/<!--[\s\S]*?-->/g, '');
  if (!/<publishing-template[\s>]/.test(xml)) return { ok: false, error: 'not a <publishing-template> file' };

  const names: Record<string, string> = {};
  const nameMatch = /<name>([\s\S]*?)<\/name>/.exec(xml);
  if (nameMatch && decodeXmlText(nameMatch[1])) names[''] = decodeXmlText(nameMatch[1]);

  let layout: string | undefined;
  let defaultDark = false;
  const tagRe = /<tag\s+type\s*=\s*"([^"]*)"\s*>([\s\S]*?)<\/tag>/g;
  for (let m = tagRe.exec(xml); m; m = tagRe.exec(xml)) {
    const type = m[1].trim().toLowerCase();
    const value = decodeXmlText(m[2]).toLowerCase();
    if (type === 'layout' && !layout && value) layout = value;
    if (type === 'color' && value === 'dark') defaultDark = true;
  }

  const attr = (tag: string, name: string): string[] => {
    const out: string[] = [];
    const re = new RegExp(`<${tag}\\b[^>]*?\\b${name}\\s*=\\s*"([^"]*)"`, 'g');
    for (let m = re.exec(xml); m; m = re.exec(xml)) if (m[1].trim()) out.push(decodeXmlText(m[1]));
    return out;
  };

  const css = attr('css', 'file');
  if (css.length === 0) return { ok: false, error: '.opt lists no <css file="..."/>' };
  return { ok: true, descriptor: { names, layout, defaultDark, css, thumbnail: attr('preview-image', 'file')[0] } };
}

export interface TemplateRoot {
  dir: string;
  builtin: boolean;
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Reads one template folder; a broken one yields diagnostics and no template. */
function loadTemplateDir(dir: string, id: string, builtin: boolean, diagnostics: TemplateDiagnostic[]): SiteTemplate | undefined {
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch (e) {
    diagnostics.push({ dir, message: `cannot read folder: ${e instanceof Error ? e.message : String(e)}` });
    return undefined;
  }
  const jsonName = files.find((f) => f === 'template.json');
  const optName = files.filter((f) => f.toLowerCase().endsWith('.opt')).sort()[0];
  const descriptorName = jsonName ?? optName;
  if (!descriptorName) return undefined; // not a template folder -- silently skipped

  let text: string;
  try {
    text = readFileSync(join(dir, descriptorName), 'utf-8');
  } catch (e) {
    diagnostics.push({ dir, message: `cannot read ${descriptorName}: ${e instanceof Error ? e.message : String(e)}` });
    return undefined;
  }
  const parsed = jsonName ? parseTemplateJson(text) : parseTemplateOpt(text);
  if (!parsed.ok) {
    diagnostics.push({ dir, message: `${descriptorName}: ${parsed.error}` });
    return undefined;
  }
  const d = parsed.descriptor;

  const resolveFile = (rel: string, what: string): string | undefined => {
    const abs = resolveInside(dir, rel);
    if (!abs) {
      diagnostics.push({ dir, message: `${what} "${rel}" is outside the template folder; ignored` });
      return undefined;
    }
    if (!existsSync(abs)) {
      diagnostics.push({ dir, message: `${what} "${rel}" does not exist; ignored` });
      return undefined;
    }
    return abs;
  };

  const css = d.css.map((c) => resolveFile(c, 'css')).filter((c): c is string => c !== undefined);
  if (css.length === 0) {
    diagnostics.push({ dir, message: 'no usable css file; template skipped' });
    return undefined;
  }
  return {
    id,
    names: d.names,
    description: d.description,
    layout: d.layout,
    defaultDark: d.defaultDark,
    css,
    thumbnail: d.thumbnail ? resolveFile(d.thumbnail, 'thumbnail') : undefined,
    header: d.header ? resolveFile(d.header, 'header') : undefined,
    footer: d.footer ? resolveFile(d.footer, 'footer') : undefined,
    dir,
    builtin,
  };
}

/**
 * Scans every root for template sub-folders. Roots are given lowest priority
 * first: a later root's template replaces an earlier one with the same id
 * (a user template overriding a built-in one), which is reported.
 */
export function discoverTemplates(roots: readonly TemplateRoot[]): { templates: SiteTemplate[]; diagnostics: TemplateDiagnostic[] } {
  const diagnostics: TemplateDiagnostic[] = [];
  const byId = new Map<string, SiteTemplate>();
  for (const root of roots) {
    if (!isDir(root.dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(root.dir).sort();
    } catch (e) {
      diagnostics.push({ dir: root.dir, message: `cannot read templates folder: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    for (const entry of entries) {
      const dir = join(root.dir, entry);
      if (!isDir(dir)) continue;
      const t = loadTemplateDir(dir, entry, root.builtin, diagnostics);
      if (!t) continue;
      const previous = byId.get(entry);
      if (previous) diagnostics.push({ dir, message: `replaces the template "${entry}" from ${previous.dir}` });
      byId.set(entry, t);
    }
  }
  return { templates: [...byId.values()], diagnostics };
}

/** The template's display name for `lang` (e.g. 'zh-cn'), falling back to the neutral name, then any, then the id. */
export function templateDisplayName(t: SiteTemplate, lang: string): string {
  const l = lang.toLowerCase();
  return t.names[l] ?? t.names[l.split('-')[0]] ?? t.names[''] ?? Object.values(t.names)[0] ?? t.id;
}
