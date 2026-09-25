import { readFileSync } from 'fs';
import { basename, extname } from 'path';
import { parseDitamap, preprocessEntities } from '../parser/ditaParser';
import { collectMapEntries } from '../render/mapTypeMap';

export interface NavManifestEntry {
  file: string;
  title: string;
}

export interface SiteChromeFeatures {
  navToolbar: boolean;
  sidebar: boolean;
  onPageToc: boolean;
  copyCode: boolean;
  backToTop: boolean;
  darkMode: boolean;
}

export function buildNavManifest(mapPath: string): NavManifestEntry[] {
  const raw = readFileSync(mapPath, 'utf-8');
  const doc = parseDitamap(preprocessEntities(raw));
  const entries = collectMapEntries(doc.root);
  return entries
    .filter((e) => !e.resourceOnly && e.href && e.href.toLowerCase().endsWith('.dita'))
    .map((e) => ({
      file: basename(e.href!, extname(e.href!)) + '.html',
      title: e.displayName,
    }));
}

/**
 * Fix the topic links on the DITA-OT map landing page (index.html).
 *
 * DITA-OT emits the map's own page as `<outputDir>/index.html` (the site root)
 * but computes its `href`/`src` values relative to the map's *source*
 * directory. When the map lives in a sub-folder — e.g. `manual/maps/book.ditamap`
 * referencing topics as `../topics/foo.dita` — every generated reference climbs
 * out of the site root (`href="../topics/foo.html"`), so clicking a TOC entry on
 * index.html navigates to a path *above* the exported site and lands nowhere.
 * The topic pages themselves are unaffected: their links stay inside `topics/`
 * and resolve correctly.
 *
 * Because index.html is at the site root, nothing above the root is part of the
 * site — so stripping the leading `../` segments turns each over-escaped
 * reference back into a root-relative one (`../topics/foo.html` →
 * `topics/foo.html`, `../commonltr.css` → `commonltr.css`). Absolute URLs,
 * `mailto:`/`tel:`, protocol-relative `//…` and bare `#anchor` references never
 * start with `../`, so they are left untouched; nor is a correct root-relative
 * link, making the transform idempotent.
 *
 * This is a plain text substitution, not an HTML/attribute parse: it assumes
 * index.html is a TOC/landing page with no code samples containing literal
 * `href="../…`/`src="../…` text (DITA-OT's own generated TOC markup never
 * does). The match requires `href`/`src` not be preceded by a word character
 * or `-`, so it does not touch compound attribute names such as `data-href`
 * or `data-src`; both `"` and `'` quoting are handled (DITA-OT itself always
 * emits `"`, but this keeps the function correct for hand-edited HTML too).
 */
export function normalizeIndexHtmlLinks(html: string): string {
  return html.replace(/(?<![\w-])((?:href|src)=(?:"|')?)(?:\.\.\/)+/gi, '$1');
}

/**
 * Body of the inline `<head>` bootstrap script that applies the reader's dark
 * mode preference to `<html>` before body content paints, for the DITA-OT
 * HTML5/XHTML export's site chrome. Raw JS only (no `<script>` tags) — the
 * caller wraps it, same convention as the other `getXScript()` helpers in
 * ditaRenderUtils.ts.
 *
 * Without this, the page paints DITA-OT's light default first and only
 * flips dark once `dita-viewer-chrome.js` (which self-installs at the end of
 * `<body>`) runs `initDarkMode()` — a white flash on every topic navigation.
 * `initDarkMode()` now only *reads* the `dark` class this script applies, so
 * the theme-resolution logic (stored `dv-theme`, else the OS
 * `prefers-color-scheme`) lives in exactly one place.
 *
 * Kept as an exported, independently testable function — rather than an
 * inline string literal in extension.ts — because template-string webview JS
 * like this is invisible to `tsc`/`eslint`/`npm test` unless it is executed
 * against a fake DOM in a unit test.
 */
export function buildThemeBootstrapScript(): string {
  return "(function(){try{var s=localStorage.getItem('dv-theme');"
    + "var d=s!==null?s==='dark':!!(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);"
    + "if(d)document.documentElement.classList.add('dark');"
    // Chrome accent theme (data-dv-theme) is independent of dark/light -- read
    // and applied in the same try block so a thrown localStorage read (e.g.
    // private browsing) doesn't leave the dark-class logic half-run either.
    + "var t=localStorage.getItem('dv-chrome-theme');"
    + "if(t)document.documentElement.setAttribute('data-dv-theme',t);"
    + "}catch(e){}})();";
}

/**
 * Body of the inline `<head>` bootstrap that re-applies the reader's stored
 * collapse-all-sections preference before body content paints, for the
 * DITA-OT HTML5/XHTML export's site chrome — the section-collapse twin of
 * buildThemeBootstrapScript(), same no-flash rationale. Without it, every
 * topic navigation paints fully expanded and only collapses once
 * `dita-viewer-chrome.js` runs at the end of `<body>`.
 *
 * Two deliberate omissions:
 * - Only TOP-LEVEL `section.section` elements get the class. site-chrome.css
 *   hides a collapsed section's non-heading children wholesale, so a nested
 *   section inside a collapsed ancestor is already hidden; marking those too
 *   would leave stragglers flagged while the preference-clear reader's
 *   per-anchor reveal (which only un-collapses ancestors) could not reach
 *   them. chrome.js re-syncs nothing on load, so what this script stamps is
 *   what the page runs with.
 * - Skipped entirely when the URL carries a hash: a link naming one section
 *   outranks a stored collapse-everything preference, and collapsing here
 *   would race chrome.js's load-time ancestor-expansion for the native
 *   fragment jump. Better a brief expanded paint than a broken deep link.
 *
 * Reads the same 'dv-section-collapse' key as site-chrome.js's
 * getSectionPref/setSectionPref; raw JS only (no `<script>` tags) — the
 * caller wraps it.
 */
export function buildCollapseBootstrapScript(): string {
  return "(function(){try{if(location.hash.length>1)return;"
    + "if(localStorage.getItem('dv-section-collapse')!=='1')return;"
    + "var all=document.getElementsByTagName('section');"
    + "for(var i=0;i<all.length;i++){var e=all[i];"
    + "if(!/(^|\\s)section(\\s|$)/.test(e.className))continue;"
    + "if(e.parentNode&&e.parentNode.nodeType===1&&/(^|\\s)section(\\s|$)/.test(e.parentNode.className))continue;"
    + "e.className+=' dv-collapsed';}}catch(e){}})();";
}

export interface DitaOtLocation {
  executablePath: string;
  source: 'setting' | 'env' | 'path';
}

export type DetectionResult =
  | { found: true; location: DitaOtLocation }
  | { found: false; reason: 'not-configured' | 'setting-invalid' | 'not-found' }; // setting-invalid = configuredPath provided but file doesn't exist

export function resolveDitaOtExecutable(input: {
  configuredPath?: string;
  ditaHomeEnv?: string;
  pathEnv?: string;
  platform: NodeJS.Platform;
  fileExists: (p: string) => boolean;
}): DetectionResult {
  // Priority 1: configured path
  if (input.configuredPath) {
    const trimmed = input.configuredPath.trim();
    // If the configured path itself looks like a file that exists, use it directly
    if (input.fileExists(trimmed)) {
      return { found: true, location: { executablePath: trimmed, source: 'setting' } };
    }
    // Otherwise assume it's an installation directory: append bin/{dita|dita.bat}
    const exe = input.platform === 'win32'
      ? `${trimmed}\\bin\\dita.bat`
      : `${trimmed}/bin/dita`;
    if (input.fileExists(exe)) {
      return { found: true, location: { executablePath: exe, source: 'setting' } };
    }
    return { found: false, reason: 'setting-invalid' };
  }

  // Priority 2: DITA_HOME env
  if (input.ditaHomeEnv) {
    const exe = input.platform === 'win32'
      ? `${input.ditaHomeEnv}\\bin\\dita.bat`
      : `${input.ditaHomeEnv}/bin/dita`;
    if (input.fileExists(exe)) {
      return { found: true, location: { executablePath: exe, source: 'env' } };
    }
  }

  // Priority 3: PATH env
  if (input.pathEnv) {
    const sep = input.platform === 'win32' ? ';' : ':';
    const dirs = input.pathEnv.split(sep);
    const exeName = input.platform === 'win32' ? 'dita.bat' : 'dita';
    for (const dir of dirs) {
      if (!dir) continue;
      const candidate = `${dir}/${exeName}`.replace(/\\/g, '/');
      if (input.fileExists(candidate)) {
        return { found: true, location: { executablePath: candidate, source: 'path' } };
      }
    }
  }

  return { found: false, reason: 'not-found' };
}

export interface CssArg {
  filename: string;
  root: string;
}

export function buildDitaOtArgs(input: {
  mapPath: string;
  transtype: string;
  outputDir: string;
  cssArg?: CssArg;
  ditavalFile?: string;
}): string[] {
  const args = ['-i', input.mapPath, '-f', input.transtype, '-o', input.outputDir, '--nav-toc=full'];
  if (input.cssArg) {
    args.push('--args.css', input.cssArg.filename);
    args.push('--args.cssroot', input.cssArg.root);
    args.push('--args.copycss', 'yes');
    args.push('--args.csspath', 'css');
  }
  if (input.ditavalFile) {
    args.push('--filter', input.ditavalFile);
  }
  return args;
}

export interface SpawnSpec {
  command: string;
  args: string[];
  /** Pass through to child_process.spawn (Windows cmd.exe invocation only) */
  windowsVerbatimArguments?: boolean;
}

/**
 * Builds a safe spawn invocation for the DITA-OT executable. On Windows,
 * dita.bat must run through cmd.exe, but `shell: true` concatenates all
 * arguments unquoted — breaking paths with spaces and allowing cmd
 * metacharacters (&, ^, |) in user-controlled paths to inject commands.
 * Instead every argument is explicitly double-quoted (with "" escaping)
 * and passed verbatim to `cmd.exe /d /s /c`.
 */
export function buildDitaOtSpawnSpec(
  executablePath: string,
  args: string[],
  platform: NodeJS.Platform,
): SpawnSpec {
  if (platform !== 'win32') {
    return { command: executablePath, args };
  }
  const quote = (a: string) => `"${a.replace(/"/g, '""')}"`;
  const commandLine = [quote(executablePath), ...args.map(quote)].join(' ');
  return {
    command: 'cmd.exe',
    // /s makes cmd strip only the outer quotes of the wrapped command line
    args: ['/d', '/s', '/c', `"${commandLine}"`],
    windowsVerbatimArguments: true,
  };
}

export type LogLevel = 'error' | 'warn' | 'info';

const ERROR_RE = /^.*?\[ERROR\]/i;
const WARN_RE = /^.*?\[WARN\]/i;

export function classifyLogLine(line: string): LogLevel {
  if (ERROR_RE.test(line)) return 'error';
  if (WARN_RE.test(line)) return 'warn';
  return 'info';
}

// ── Line buffer for streamed chunk processing ──

export interface LineBuffer {
  processChunk(chunk: string): string[];
  flush(): string[];
}

export function createLineBuffer(): LineBuffer {
  let buffer = '';
  return {
    processChunk(chunk: string): string[] {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      return lines;
    },
    flush(): string[] {
      const remaining = buffer;
      buffer = '';
      return remaining ? [remaining] : [];
    },
  };
}
