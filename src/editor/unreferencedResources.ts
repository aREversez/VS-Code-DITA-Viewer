// "Find Unreferenced Resources": every file under the chosen folders that the
// chosen maps -- and the topics they reach -- never point at.
//
// Filters work like Oxygen's dialog: comma-separated name patterns with `*`
// and `?` wildcards; excluded folders are not descended into at all.

import { dirname, join, relative, resolve } from 'path';
import { CrawlHost, CrawlResult, crawlMaps } from './mapCrawl';
import { computeUnreferencedFiles } from './mapReferenceTools';

export interface UnreferencedFilters {
  includeFiles: string;
  excludeFiles: string;
  excludeFolders: string;
}

export const DEFAULT_UNREFERENCED_FILTERS: UnreferencedFilters = {
  includeFiles: '*',
  excludeFiles: '.DS_Store,.gitignore,.hgignore,*.ditaval,*.xpr',
  excludeFolders: 'CVS,.svn,_svn,.git,.hg,temp,out',
};

/** Fills blank/missing filter settings with Oxygen's defaults (a blank include means "everything"). */
export function normalizeFilters(raw: Partial<UnreferencedFilters> | undefined): UnreferencedFilters {
  const pick = (v: unknown, dflt: string): string => (typeof v === 'string' && v.trim() !== '' ? v : dflt);
  return {
    includeFiles: pick(raw?.includeFiles, DEFAULT_UNREFERENCED_FILTERS.includeFiles),
    // Exclusions may legitimately be emptied out, so only a missing value falls back.
    excludeFiles: typeof raw?.excludeFiles === 'string' ? raw.excludeFiles : DEFAULT_UNREFERENCED_FILTERS.excludeFiles,
    excludeFolders: typeof raw?.excludeFolders === 'string' ? raw.excludeFolders : DEFAULT_UNREFERENCED_FILTERS.excludeFolders,
  };
}

export interface DirEntry {
  name: string;
  isDir: boolean;
}

export interface ListHost {
  readdir(dir: string): Promise<DirEntry[]>;
}

/** Splits "a, b;c" into trimmed non-empty patterns. */
export function splitPatterns(text: string): string[] {
  return text
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** `*` (any run, incl. none) and `?` (one char) wildcards, whole-string, case-insensitive. */
export function globToRegExp(pattern: string): RegExp {
  const body = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${body}$`, 'i');
}

function matcher(patterns: string[]): (name: string, relPath: string) => boolean {
  const compiled = patterns.map((p) => ({ re: globToRegExp(p.replace(/\\/g, '/')), path: p.includes('/') }));
  return (name, relPath) => compiled.some((c) => c.re.test(c.path ? relPath : name));
}

/** All files under `folder` that pass the include/exclude filters. */
export async function listFilteredFiles(
  folder: string,
  list: ListHost,
  filters: UnreferencedFilters,
  cancelled?: () => boolean,
): Promise<string[]> {
  const include = matcher(splitPatterns(filters.includeFiles || '*'));
  const excludeFile = matcher(splitPatterns(filters.excludeFiles));
  const excludeDir = matcher(splitPatterns(filters.excludeFolders));
  const out: string[] = [];
  const root = resolve(folder);

  async function visit(dir: string): Promise<void> {
    if (cancelled?.()) return;
    let entries: DirEntry[];
    try {
      entries = await list.readdir(dir);
    } catch {
      return; // unreadable folder: skip rather than abort the whole search
    }
    for (const e of entries) {
      const abs = join(dir, e.name);
      const rel = relative(root, abs).replace(/\\/g, '/');
      if (e.isDir) {
        if (!excludeDir(e.name, rel)) await visit(abs);
      } else if (include(e.name, rel) && !excludeFile(e.name, rel)) {
        out.push(abs);
      }
    }
  }
  await visit(root);
  return out;
}

export interface UnreferencedQuery {
  maps: string[];
  folders: string[];
  filters: UnreferencedFilters;
}

export interface UnreferencedResult {
  /** Absolute paths, sorted, no duplicates. */
  unreferenced: string[];
  /** Files considered (after filters), across all folders. */
  scanned: number;
  crawl: CrawlResult;
}

/** Every local file the crawl opened or any reference/key definition points at. */
export function referencedPaths(crawl: CrawlResult): string[] {
  const out = new Set<string>(crawl.visited.values());
  for (const m of crawl.rootMaps) out.add(m);
  for (const r of crawl.refs) if (r.target) out.add(r.target);
  for (const k of crawl.keyDefs) if (k.target) out.add(k.target);
  return [...out];
}

export async function findUnreferencedResources(
  query: UnreferencedQuery,
  host: CrawlHost,
  list: ListHost,
): Promise<UnreferencedResult> {
  const crawl = await crawlMaps(query.maps, host);
  const referenced = referencedPaths(crawl);
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const folder of query.folders) {
    for (const f of await listFilteredFiles(folder, list, query.filters, host.cancelled)) {
      const key = f.replace(/\\/g, '/');
      if (seen.has(key)) continue; // overlapping folders
      seen.add(key);
      candidates.push(f);
    }
  }
  const unreferenced = computeUnreferencedFiles(candidates, referenced, host.platform).sort((a, b) =>
    a.localeCompare(b),
  );
  return { unreferenced, scanned: candidates.length, crawl };
}

// ── Choosing where to look ──────────────────────────────────────────────

/** Kinds of file a map plausibly references; anything else (scripts, styles, notes) is usually noise. */
export const RESOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'tif', 'tiff', 'ico', 'emf', 'wmf',
  'pdf', 'mp4', 'webm', 'mov', 'mp3', 'wav', 'ogg', 'dita', 'ditamap',
]);

/** Lower-case extension without the dot; '' when there is none. */
export function extensionOf(file: string): string {
  const name = file.replace(/\\/g, '/').split('/').pop() ?? '';
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function summarizeExtensions(files: string[]): Array<{ ext: string; count: number }> {
  const counts = new Map<string, number>();
  for (const f of files) counts.set(extensionOf(f), (counts.get(extensionOf(f)) ?? 0) + 1);
  return [...counts]
    .map(([ext, count]) => ({ ext, count }))
    .sort((a, b) => b.count - a.count || a.ext.localeCompare(b.ext));
}

export interface RememberedExtensions {
  checked: string[];
  unchecked: string[];
}

/** Extensions to pre-check: what the user chose before, else resource-like types. */
export function defaultCheckedExtensions(exts: string[], remembered?: RememberedExtensions): Set<string> {
  const out = new Set<string>();
  for (const e of exts) {
    if (remembered?.checked.includes(e)) out.add(e);
    else if (remembered?.unchecked.includes(e)) continue;
    else if (RESOURCE_EXTENSIONS.has(e)) out.add(e);
  }
  return out;
}

/** Remembers a choice, keeping what was remembered about extensions not shown this time. */
export function rememberExtensions(
  previous: RememberedExtensions | undefined,
  shown: string[],
  checked: string[],
): RememberedExtensions {
  const chosen = new Set(checked);
  const keep = (list: string[] | undefined) => (list ?? []).filter((e) => !shown.includes(e));
  return {
    checked: [...keep(previous?.checked), ...shown.filter((e) => chosen.has(e))],
    unchecked: [...keep(previous?.unchecked), ...shown.filter((e) => !chosen.has(e))],
  };
}

/** Folders that hold the local non-DITA files (images, media, PDFs) the maps and topics reference. */
export function referencedResourceFolders(crawl: CrawlResult): string[] {
  const dirs = new Set<string>();
  for (const r of crawl.refs) {
    if (r.target && !r.remote && !r.dita && r.kind !== 'conref') dirs.add(dirname(r.target));
  }
  for (const k of crawl.keyDefs) if (k.target && !/\.(dita|ditamap|xml)$/i.test(k.target)) dirs.add(dirname(k.target));
  return [...dirs].sort();
}

const within = (dir: string, file: string): boolean => {
  const rel = relative(dir, file);
  return rel !== '' && !rel.startsWith('..') && !rel.includes(':');
};

/** Unique folders with any folder nested in another dropped. */
export function mergeRoots(dirs: string[]): string[] {
  const unique = [...new Set(dirs.map((d) => resolve(d)))].sort((a, b) => a.length - b.length);
  const out: string[] = [];
  for (const d of unique) if (!out.some((o) => o === d || within(o, join(d, 'x')))) out.push(d);
  return out;
}

export function filesUnder(files: string[], dirs: string[]): string[] {
  return files.filter((f) => dirs.some((d) => within(d, f)));
}

export interface FolderStat {
  dir: string;
  total: number;
  unreferenced: number;
}

/**
 * Per-folder counts for the folder picker: for each root and its subfolders
 * down to `maxDepth` levels, how many files sit at or below it and how many
 * of those nothing references. Folders holding no files are left out.
 */
export function folderStats(all: string[], unreferenced: string[], roots: string[], maxDepth: number): FolderStat[] {
  const unref = new Set(unreferenced);
  const stats = new Map<string, FolderStat>();
  for (const file of all) {
    const root = roots.find((r) => within(r, file));
    if (!root) continue;
    let dir = dirname(file);
    const chain: string[] = [];
    for (;;) {
      chain.push(dir);
      if (dir === root) break;
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
    for (const d of chain) {
      const depth = d === root ? 0 : relative(root, d).split(/[\\/]/).length;
      if (depth > maxDepth) continue;
      const st = stats.get(d) ?? { dir: d, total: 0, unreferenced: 0 };
      st.total++;
      if (unref.has(file)) st.unreferenced++;
      stats.set(d, st);
    }
  }
  return [...stats.values()].sort((a, b) => a.dir.localeCompare(b.dir));
}

/**
 * Folders to pre-check: the folders the maps' images and other resources
 * live in (or the nearest listed ancestor when deeper than listed); with no
 * such folders, the maps' own folders.
 */
export function suggestFolders(stats: FolderStat[], resourceFolders: string[], mapDirs: string[]): string[] {
  const listed = new Set(stats.map((s) => s.dir));
  const nearest = (d: string): string | undefined => {
    for (let cur = d; ; cur = dirname(cur)) {
      if (listed.has(cur)) return cur;
      if (dirname(cur) === cur) return undefined;
    }
  };
  const fromResources = mergeRoots(resourceFolders.map(nearest).filter((d): d is string => !!d));
  if (fromResources.length > 0) return fromResources;
  return mapDirs.map((d) => resolve(d)).filter((d) => listed.has(d));
}
