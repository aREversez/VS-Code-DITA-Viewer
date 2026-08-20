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
