// "Find Unreferenced Resources": every file under the chosen folders that the
// chosen maps -- and the topics they reach -- never point at.
//
// Filters work like Oxygen's dialog: comma-separated name patterns with `*`
// and `?` wildcards; excluded folders are not descended into at all.

import { join, relative, resolve } from 'path';
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
