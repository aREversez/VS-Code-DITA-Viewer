// "Export as HTML" — reuses the extension's own render pipeline (no DITA-OT
// required) to produce a single self-contained .html file: styles inlined,
// images embedded as data URIs, shareable without any toolchain installed.

import * as vscode from 'vscode';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { basename, dirname, extname, join, resolve } from 'path';
import { parseDitamap, preprocessEntities } from '../parser/ditaParser';
import { collectMapEntries, getMapTitleText } from '../render/mapTypeMap';
import { formatLocalizedRole } from '../language/bookRoleL10n';
import { expandDitamapRefs, renderTopicToHtml } from './ditaRenderUtils';
import { buildKeyMap } from './DitaViewerProvider';

// ── Pure helpers (unit-tested) ──

export function buildStandaloneHtml(opts: { title: string; bodyHtml: string; css: string }): string {
  const { title, bodyHtml, css } = opts;
  const safeTitle = title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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

/** Returns an asWebviewUri-compatible callback that inlines images as data URIs. */
export function makeDataUriInliner(baseDir: string): (relPath: string) => string {
  return (relPath: string): string => {
    try {
      const abs = resolve(baseDir, relPath);
      if (existsSync(abs)) {
        const ext = extname(abs).slice(1).toLowerCase();
        const mime = IMAGE_MIME[ext] || 'application/octet-stream';
        return `data:${mime};base64,${readFileSync(abs).toString('base64')}`;
      }
    } catch {}
    return '';
  };
}

// ── Content builders ──

function buildTopicExport(fsPath: string): { title: string; bodyHtml: string; error?: string } {
  const keyMap = buildKeyMap(vscode.Uri.file(fsPath));
  const result = renderTopicToHtml({
    filePath: fsPath,
    keyMap,
    asWebviewUri: makeDataUriInliner(dirname(fsPath)),
    headingLevel: 1,
  });
  return {
    title: result.title || basename(fsPath),
    bodyHtml: result.html,
    error: result.error,
  };
}

function buildMapExport(fsPath: string): { title: string; bodyHtml: string; error?: string } {
  const docDir = dirname(fsPath);
  const content = readFileSync(fsPath, 'utf-8');
  const doc = parseDitamap(preprocessEntities(content));
  expandDitamapRefs(doc.root, docDir);

  const keyMap = buildKeyMap(vscode.Uri.file(fsPath));
  const entries = collectMapEntries(doc.root, (k) => keyMap.get(k), formatLocalizedRole);

  const mapTitle = getMapTitleText(doc.root, (k) => keyMap.get(k)) || basename(fsPath);

  const visited = new Set<string>();
  const parts: string[] = [];
  const heading = (name: string, depth: number, role?: string) => {
    const level = Math.min(1 + depth, 6);
    const safe = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const badge = role ? `<span class="map-tree-badge">${role}</span> ` : '';
    return `<h${level} class="book-heading">${badge}${safe}</h${level}>`;
  };

  for (const entry of entries) {
    if (entry.href && !entry.href.split('#')[0].toLowerCase().endsWith('.ditamap')) {
      const absPath = resolve(docDir, entry.href.split('#')[0]);
      if (visited.has(absPath)) continue;
      visited.add(absPath);
      const result = renderTopicToHtml({
        filePath: absPath,
        keyMap,
        asWebviewUri: makeDataUriInliner(dirname(absPath)),
        headingLevel: Math.min(1 + entry.depth, 6),
      });
      if (result.error) {
        parts.push(heading(entry.displayName, entry.depth, entry.role));
      } else {
        if (entry.role) parts.push(heading(entry.displayName, entry.depth, entry.role));
        parts.push(`<div class="book-entry">${result.html}</div>`);
      }
    } else if (!entry.keys) {
      // Structural heading (topichead / chapter without href / sub-map label);
      // pure keydefs are definitions, not content
      parts.push(heading(entry.displayName, entry.depth, entry.role));
    }
  }
  return { title: mapTitle, bodyHtml: `<div class="ditamap-book">${parts.join('\n')}</div>` };
}

// ── Command ──

function getActiveDitaUri(): vscode.Uri | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor && /\.(dita|ditamap)$/i.test(editor.document.uri.fsPath)) {
    return editor.document.uri;
  }
  // Also works while a reading-view (custom editor) tab is active
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (tab?.input instanceof vscode.TabInputCustom && /\.(dita|ditamap)$/i.test(tab.input.uri.fsPath)) {
    return tab.input.uri;
  }
  return undefined;
}

export function registerExportHtmlCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ditaViewer.exportHtml', async () => {
      const uri = getActiveDitaUri();
      if (!uri) {
        vscode.window.showErrorMessage(vscode.l10n.t('Please open a .dita or .ditamap file first.'));
        return;
      }

      try {
        const fsPath = uri.fsPath;
        const isMap = fsPath.toLowerCase().endsWith('.ditamap');
        const built = isMap ? buildMapExport(fsPath) : buildTopicExport(fsPath);
        if (built.error) {
          vscode.window.showErrorMessage(vscode.l10n.t('Export failed: {0}', built.error));
          return;
        }

        const css = readFileSync(join(context.extensionPath, 'media', 'styles.css'), 'utf-8');
        const html = buildStandaloneHtml({ title: built.title, bodyHtml: built.bodyHtml, css });

        const base = basename(fsPath).replace(/\.(dita|ditamap)$/i, '');
        const target = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(join(dirname(fsPath), `${base}.html`)),
          filters: { HTML: ['html'] },
        });
        if (!target) return;

        writeFileSync(target.fsPath, html, 'utf-8');
        const openLabel = vscode.l10n.t('Open in Browser');
        const action = await vscode.window.showInformationMessage(
          vscode.l10n.t('Exported HTML: {0}', target.fsPath),
          openLabel,
        );
        if (action === openLabel) {
          vscode.env.openExternal(target);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(vscode.l10n.t('Export failed: {0}', message));
      }
    }),
  );
}
