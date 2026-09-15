// Pure helpers for HTML export — no vscode dependency, unit-tested directly.
// Kept in a separate module so tests can import without loading the VS Code API.

import { existsSync, readFileSync } from 'fs';
import { extname, resolve } from 'path';
import { escapeAttr, decodeHrefPart } from './ditaRenderUtils';

/** Builds a self-contained HTML document string. All values are escaped. */
export function buildStandaloneHtml(opts: { title: string; bodyHtml: string; css: string }): string {
  const { title, bodyHtml, css } = opts;
  const safeTitle = escapeAttr(title);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="generator" content="DITA Viewer for VS Code">
<title>${safeTitle}</title>
<style>
${css}
</style>
</head>
<body>
<main class="dita-export">
${bodyHtml}
</main>
</body>
</html>`;
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

/** Returns a callback that inlines images as data URIs. */
export function makeDataUriInliner(baseDir: string): (relPath: string) => string {
  return (relPath: string): string => {
    try {
      const abs = resolve(baseDir, decodeHrefPart(relPath));
      if (existsSync(abs)) {
        const ext = extname(abs).slice(1).toLowerCase();
        const mime = IMAGE_MIME[ext] || 'application/octet-stream';
        return `data:${mime};base64,${readFileSync(abs).toString('base64')}`;
      }
    } catch (e) {
      console.warn(`Failed to inline image ${relPath}:`, e instanceof Error ? e.message : e);
    }
    return '';
  };
}

/** Builds a book-section heading with an optional role badge. All text is escaped. */
export function buildBookHeading(name: string, depth: number, role?: string): string {
  const level = Math.min(1 + depth, 6);
  const safe = escapeAttr(name);
  const badge = role ? `<span class="map-tree-badge">${escapeAttr(role)}</span> ` : '';
  return `<h${level} class="book-heading">${badge}${safe}</h${level}>`;
}

/** What buildMapExport (exportHtml.ts) should do with one collectMapEntries
 *  entry when assembling the exported HTML body. Kept here rather than
 *  inline in buildMapExport purely so this branching is unit-testable --
 *  exportHtml.ts itself imports 'vscode', which this project's plain
 *  mocha suite can't resolve outside a real extension host, so nothing in
 *  that file can be exercised directly; see this file's own top comment.
 *
 * Deliberately doesn't decide the already-rendered-this-topic dedup case
 * (buildMapExport's own `visited` set) -- that's about iteration state
 * across entries, not a property of any one entry in isolation, so it
 * stays inline in buildMapExport alongside the loop that tracks it.
 */
export type MapExportEntryAction = 'skip' | 'render-topic' | 'structural-heading';

export function classifyMapExportEntry(entry: { href?: string; resourceOnly?: boolean; keys?: string }): MapExportEntryAction {
  // A resource-only keydef/topicref exists purely to be pulled in via
  // keyref/conref elsewhere -- never its own page, and never even a
  // structural heading (a resource-only chapter/topichead, however
  // unusual, still shouldn't show up as a heading with nothing readable
  // under it in the exported document).
  if (entry.resourceOnly) return 'skip';
  if (entry.href && !entry.href.split('#')[0].toLowerCase().endsWith('.ditamap')) return 'render-topic';
  // No real href (or a .ditamap href, which expandDitamapRefs should
  // already have inlined away before entries reach here) -- a structural
  // heading (topichead, chapter without href, ...) UNLESS it's a pure
  // keydef/key-only topicref (has `keys`), which is a definition, not
  // content, and gets no heading of its own.
  if (!entry.keys) return 'structural-heading';
  return 'skip';
}
