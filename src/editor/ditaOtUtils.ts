import { readFileSync, realpathSync } from 'fs';
import { homedir } from 'os';
import { dirname, isAbsolute, relative, resolve, sep } from 'path';
import { parseDitamap, preprocessEntities } from '../parser/ditaParser';
import { collectMapEntries } from '../render/mapTypeMap';
import { expandDitamapRefs, decodeHrefPart } from './ditaRenderUtils';

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
  /**
   * Template-mode marker (injectTemplateChrome in extension.ts): the page
   * layout comes from a media/templates/* shell rather than the legacy
   * dv-sidebar/dv-toolbar chrome. site-chrome.js keys its sidebar link
   * rewriting, fold persistence and pane-scroll behaviors off this flag;
   * the layout toggles above stay false on that path.
   */
  siteShell?: boolean;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Mirrors DITA-OT's own output naming for a topic reached from `docDir`:
 *  the last path segment gets a `.html` extension, with the rest of the
 *  relative path preserved -- matching htmlOutPath in templateExport.ts, so
 *  a manifest entry always names the file DITA-OT actually wrote, not a
 *  flattened basename that collides across sibling folders. */
function navHtmlOutPath(fromMapRelPosix: string): string {
  const stripped = fromMapRelPosix.replace(/^(\.\.\/)+/, '');
  const slash = stripped.lastIndexOf('/');
  const dot = stripped.lastIndexOf('.');
  return dot > slash ? stripped.slice(0, dot) + '.html' : stripped + '.html';
}

export function buildNavManifest(mapPath: string): NavManifestEntry[] {
  const docDir = dirname(mapPath);
  const raw = readFileSync(mapPath, 'utf-8');
  const doc = parseDitamap(preprocessEntities(raw));
  // Submap topicrefs must be inlined before collectMapEntries walks the
  // tree -- collectMapEntries treats a .ditamap href as a transparent
  // wrapper around already-spliced children (see its own isDitamapRef
  // branch) and never emits an entry for it, so without this step every
  // topic reached only through a nested submap silently never reaches the
  // nav manifest at all (no prev/next on those pages).
  expandDitamapRefs(doc.root, docDir);
  const entries = collectMapEntries(doc.root);
  return entries
    .filter((e) => !e.resourceOnly && e.href && !e.href.split('#')[0].toLowerCase().endsWith('.ditamap'))
    .map((e) => {
      const absPath = resolve(docDir, decodeHrefPart(e.href!.split('#')[0]));
      const fromMap = toPosix(relative(docDir, absPath));
      return {
        file: navHtmlOutPath(fromMap),
        title: e.displayName,
      };
    });
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
    // Index-page layout (tree vs tile, data-dv-index-layout) is also
    // independent of dark/light and the accent theme, and needs the same
    // before-paint treatment as both -- otherwise a reader who picked "tile"
    // sees the tree layout flash on every visit to index.html until
    // site-chrome.js runs at the end of <body>. Harmless on non-index pages:
    // the CSS this attribute drives is scoped under ".dv-index".
    + "var l=localStorage.getItem('dv-index-layout');"
    + "if(l)document.documentElement.setAttribute('data-dv-index-layout',l);"
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
  /**
   * Distinguishes a directory from a file at a path fileExists already
   * reported as existing. fs.existsSync() (the usual fileExists
   * implementation) is true for directories too, so without this, a
   * configuredPath pointing at the DITA-OT *installation directory* --
   * exactly what the ditaOtPath setting's own description tells users to
   * provide -- would be treated as the executable itself instead of
   * falling through to append bin/dita[.bat], and spawn() would then be
   * handed a directory and fail. Optional (defaults to "never a
   * directory") only so existing narrow test doubles that already model
   * an exact bin/dita path don't need updating.
   */
  isDirectory?: (p: string) => boolean;
}): DetectionResult {
  // Priority 1: configured path
  if (input.configuredPath) {
    const trimmed = input.configuredPath.trim();
    // If the configured path itself looks like a file that exists, use it directly
    if (input.fileExists(trimmed) && !(input.isDirectory?.(trimmed) ?? false)) {
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
  /**
   * Absolute path to a DITA-OT PDF customization folder (a `catalog.xml` plus
   * `fo/attrs/custom.xsl` / `fo/xsl/custom.xsl` next to it, same layout as
   * `org.dita.pdf2/Customization`). Passed through as `--customization.dir` so
   * the default FOP pipeline picks up the override attribute-sets/templates
   * without installing anything into the user's local DITA-OT or running the
   * integrator. Note the flag has NO `args.` prefix — DITA-OT registers
   * `--customization.dir` as a top-level option (see `dita --help`); the
   * `--args.` prefix is only for the `args.*` property family and is rejected
   * as an unsupported option for this one. Only meaningful for the `pdf`
   * transtype — ignored otherwise. See `media/pdf-customization/`.
   */
  pdfCustomizationDir?: string;
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
  if (input.transtype === 'pdf' && input.pdfCustomizationDir) {
    args.push('--customization.dir', input.pdfCustomizationDir);
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

/**
 * Splices the nav manifest and feature-flag JSON into the shared
 * site-chrome.js template (injectSiteChrome/injectTemplateChrome in
 * extension.ts). Function replacers, not strings: String.replace
 * interprets $&, $$, $`, $', $1-$99 in a *string* replacement even when
 * the search value isn't a regex, so a topic/map title containing e.g.
 * "$&" would splice the matched placeholder text back into the output and
 * corrupt this file's syntax -- breaking prev/next, sidebar and dark mode
 * on every page, since one chrome.js serves the whole exported site.
 */
export function buildSiteChromeScript(jsTemplate: string, manifest: unknown, features: unknown): string {
  return jsTemplate
    .replace('/* __DV_MANIFEST__ */', () => JSON.stringify(manifest))
    .replace('/* __DV_FEATURES__ */', () => JSON.stringify(features));
}

export type LogLevel = 'error' | 'warn' | 'info';

const ERROR_RE = /^.*?\[(ERROR|FATAL)\]/i;
const WARN_RE = /^.*?\[WARN\]/i;
// DITA-OT's toolchain doesn't only report failures through its own
// [ERROR]/[FATAL] log4j markers: Ant's own "BUILD FAILED" banner, a raw
// JVM launch failure ("Error: Could not find or load main class ..." --
// thrown before DITA-OT's own logger is even running, e.g. a bad
// JAVA_HOME), and an Ant task echoing its own failure (FOP's [fop]/[java]
// lines don't use the [ERROR] convention at all) would otherwise all be
// silently counted as "info" -- undercounting the error summary shown to
// the user on a run that still exits 0 (e.g. continue-on-error).
const BUILD_FAILED_RE = /^\s*BUILD FAILED\b/;
const JVM_LAUNCH_ERROR_RE = /^\s*Error:\s/;
const ANT_TASK_ERROR_RE = /^\s*\[[\w.:-]+\]\s*Error\b/;

export function classifyLogLine(line: string): LogLevel {
  if (
    ERROR_RE.test(line) ||
    BUILD_FAILED_RE.test(line) ||
    JVM_LAUNCH_ERROR_RE.test(line) ||
    ANT_TASK_ERROR_RE.test(line)
  ) {
    return 'error';
  }
  if (WARN_RE.test(line)) return 'warn';
  return 'info';
}

// ── Line buffer for streamed chunk processing ──

export interface LineBuffer {
  processChunk(chunk: string): string[];
  flush(): string[];
}

/** Strips one trailing \r, so a CRLF-emitting process (DITA-OT/Java on
 *  Windows) yields the same line text as an LF-only one -- callers that do
 *  more than classifyLogLine's loose substring match (an exact-match line
 *  consumer, say) would otherwise silently see a dangling \r on Windows. */
function stripTrailingCr(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

export function createLineBuffer(): LineBuffer {
  let buffer = '';
  return {
    processChunk(chunk: string): string[] {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      return lines.map(stripTrailingCr);
    },
    flush(): string[] {
      const remaining = stripTrailingCr(buffer);
      buffer = '';
      return remaining ? [remaining] : [];
    },
  };
}

/** Resolves symlinks when the path exists, else just normalises it. */
function realOrResolved(p: string): string {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

/**
 * True when wiping `outputDir` would also wipe something the user cares about:
 * the map itself (the output dir is the map's folder or one of its ancestors),
 * a workspace folder root (or an ancestor of one), the user's home directory,
 * or a filesystem root. Symlinks are resolved first so a link to the map's
 * folder is caught too. The webhelp-style export clears the output directory
 * before writing, so such a target must be refused outright rather than
 * confirmed.
 */
export function isUnsafeExportClearTarget(
  outputDir: string,
  mapPath: string,
  workspaceRoots: readonly string[] = [],
): boolean {
  const target = realOrResolved(outputDir);
  if (dirname(target) === target) return true; // filesystem root
  const containsOrEquals = (candidate: string): boolean => {
    const rel = relative(target, realOrResolved(candidate));
    // `..` must be a whole path segment: a folder named "..hidden" is inside.
    const escapes = rel === '..' || rel.startsWith('..' + sep);
    return rel === '' || (!escapes && !isAbsolute(rel));
  };
  return containsOrEquals(mapPath) || containsOrEquals(homedir()) || workspaceRoots.some(containsOrEquals);
}
