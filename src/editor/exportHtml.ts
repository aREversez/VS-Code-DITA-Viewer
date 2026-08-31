// "Export as HTML" — reuses the extension's own render pipeline (no DITA-OT
// required) to produce a single self-contained .html file: styles inlined,
// images embedded as data URIs, shareable without any toolchain installed.

import * as vscode from 'vscode';
import { readFileSync, writeFileSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { parseDitamap, preprocessEntities } from '../parser/ditaParser';
import { collectMapEntries, getMapTitleText } from '../render/mapTypeMap';
import { formatLocalizedRole } from '../language/bookRoleL10n';
import { expandDitamapRefs, renderTopicToHtml, decodeHrefPart } from './ditaRenderUtils';
import { buildKeyMap } from './DitaViewerProvider';
import { buildStandaloneHtml, makeDataUriInliner, buildBookHeading } from './exportHtmlHelpers';

// ── Pure helpers (re-exported from exportHtmlHelpers, unit-tested there) ──

export { buildStandaloneHtml, makeDataUriInliner, buildBookHeading };

// ── Content builders ──

function buildTopicExport(fsPath: string): { title: string; bodyHtml: string; error?: string } {
  const keyMap = buildKeyMap(vscode.Uri.file(fsPath));
  const result = renderTopicToHtml({
    filePath: fsPath,
    keyMap,
    asWebviewUri: makeDataUriInliner(dirname(fsPath)),
    headingLevel: 1,
    uiLanguage: vscode.env.language,
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
  const heading = buildBookHeading;

  for (const entry of entries) {
    if (entry.href && !entry.href.split('#')[0].toLowerCase().endsWith('.ditamap')) {
      const absPath = resolve(docDir, decodeHrefPart(entry.href.split('#')[0]));
      if (visited.has(absPath)) continue;
      visited.add(absPath);
      const result = renderTopicToHtml({
        filePath: absPath,
        keyMap,
        asWebviewUri: makeDataUriInliner(dirname(absPath)),
        headingLevel: Math.min(1 + entry.depth, 6),
        uiLanguage: vscode.env.language,
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

export function getActiveDitaUri(): vscode.Uri | undefined {
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
