import * as vscode from 'vscode';
import { parseDitamap, preprocessEntities } from '../parser/ditaParser';
import { renderMapDocument, collectMapEntries } from '../render/mapTypeMap';
import { renderTopicToHtml, renderBookPlaceholder, renderBookError, renderBookSkipMessage, escapeHtml, expandDitamapRefs, getSearchOverlayScript, decodeHrefPart } from './ditaRenderUtils';
import { buildKeyMap } from './DitaViewerProvider';
import { formatLocalizedRole } from '../language/bookRoleL10n';
import { dirname, join, resolve } from 'path';
import { randomBytes } from 'crypto';
import { readFileSync, existsSync } from 'fs';

// Test-only hook: see the identical comment in DitaViewerProvider.ts.
const lastRenderedHtmlByUri = new Map<string, string>();

export function getLastRenderedMapHtmlForTesting(uriString: string): string | undefined {
  return lastRenderedHtmlByUri.get(uriString);
}

function getMapWebviewScript(): string {
  const L = {
    decreaseFontSize: JSON.stringify(vscode.l10n.t('Decrease font size')),
    increaseFontSize: JSON.stringify(vscode.l10n.t('Increase font size')),
    fontSans: JSON.stringify(vscode.l10n.t('Sans')),
    fontSerif: JSON.stringify(vscode.l10n.t('Serif')),
    fontCurrentSans: JSON.stringify(vscode.l10n.t('Current: Sans-serif. Click to switch to Serif')),
    fontCurrentSerif: JSON.stringify(vscode.l10n.t('Current: Serif. Click to switch to Sans-serif')),
    pageWidth: JSON.stringify(vscode.l10n.t('Page width')),
    widthAuto: JSON.stringify(vscode.l10n.t('Auto')),
    widthFull: JSON.stringify(vscode.l10n.t('Full')),
    widthWide: JSON.stringify(vscode.l10n.t('Wide')),
    widthDesktop: JSON.stringify(vscode.l10n.t('Desktop')),
    widthNarrow: JSON.stringify(vscode.l10n.t('Narrow')),
    switchModeTitle: JSON.stringify(vscode.l10n.t('Switch between outline tree and full book view')),
    modeOutline: JSON.stringify(vscode.l10n.t('Outline')),
    modeBook: JSON.stringify(vscode.l10n.t('Book')),
    reloadContent: JSON.stringify(vscode.l10n.t('Reload DITA content')),
    searchPlaceholder: vscode.l10n.t('Search'),
    searchNext: vscode.l10n.t('Next match'),
    searchPrev: vscode.l10n.t('Previous match'),
    searchClose: vscode.l10n.t('Close search'),
    searchMatchCase: vscode.l10n.t('Match case'),
    searchUseRegex: vscode.l10n.t('Use regex'),
    searchInvalidRegex: vscode.l10n.t('Invalid regex'),
  };
  return `
(function() {
  var vscode = acquireVsCodeApi();
  // The whole HTML document is regenerated on every mode switch, so derive
  // the current mode from the body class instead of a hardcoded default —
  // otherwise the script's state resets to 'tree' while the extension is in
  // 'book' mode and the toggle can never switch back.
  var currentMode = document.body.classList.contains('mode-book') ? 'book' : 'tree';

  // Click on navigable tree node → post message to extension
  document.addEventListener('click', function(e) {
    var link = e.target.closest ? e.target.closest('.map-tree-link') : null;
    if (!link) return;
    e.preventDefault();
    var href = link.getAttribute('data-href');
    if (href) {
      vscode.postMessage({ type: 'openTopic', href: href });
    }
  });

  // Toolbar (same pattern as DITA viewer)
  var tbStyle = 'position:fixed;top:4px;right:8px;z-index:9999;display:flex;align-items:center;gap:4px;padding:3px 6px;border-radius:5px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:12px;background:var(--vscode-editor-background,rgba(30,30,30,0.88));border:1px solid var(--vscode-widget-border,rgba(255,255,255,0.12));backdrop-filter:blur(4px);opacity:0.75;transition:opacity 0.15s;';
  var btnStyle = 'padding:1px 5px;border-radius:3px;border:1px solid var(--vscode-dropdown-border,var(--vscode-widget-border,#555));background:var(--vscode-dropdown-background,#333);color:var(--vscode-dropdown-foreground,#eee);cursor:pointer;font-size:13px;line-height:1;outline:none;display:flex;align-items:center;';

  var toolbar = document.createElement('div');
  toolbar.id = '__toolbar';
  toolbar.style.cssText = tbStyle;
  toolbar.addEventListener('mouseenter', function() { toolbar.style.opacity = '1'; });
  toolbar.addEventListener('mouseleave', function() { toolbar.style.opacity = '0.75'; });

  var fontSize = 100;
  var fsDown = document.createElement('button');
  fsDown.innerHTML = 'A\u2212';
  fsDown.title = ${L.decreaseFontSize};
  fsDown.style.cssText = btnStyle + 'font-weight:bold;';
  fsDown.addEventListener('click', function() {
    fontSize = Math.max(60, fontSize - 10);
    document.body.style.fontSize = fontSize + '%';
  });
  toolbar.appendChild(fsDown);

  var fsUp = document.createElement('button');
  fsUp.innerHTML = 'A+';
  fsUp.title = ${L.increaseFontSize};
  fsUp.style.cssText = btnStyle + 'font-weight:bold;';
  fsUp.addEventListener('click', function() {
    fontSize = Math.min(200, fontSize + 10);
    document.body.style.fontSize = fontSize + '%';
  });
  toolbar.appendChild(fsUp);

  // Font toggle (serif / sans-serif)
  var isSerif = false;
  var fontBtn = document.createElement('button');
  fontBtn.textContent = ${L.fontSans};
  fontBtn.title = ${L.fontCurrentSans};
  fontBtn.style.cssText = btnStyle + 'font-size:11px;';
  fontBtn.addEventListener('click', function() {
    isSerif = !isSerif;
    fontBtn.textContent = isSerif ? ${L.fontSerif} : ${L.fontSans};
    fontBtn.title = isSerif ? ${L.fontCurrentSerif} : ${L.fontCurrentSans};
    document.body.style.fontFamily = isSerif ? "Georgia,'Times New Roman','Noto Serif SC','Songti SC',STSong,SimSun,serif" : '';
  });
  toolbar.appendChild(fontBtn);

  // Page width
  var widths = [
    { label: ${L.widthAuto}, value: '' },
    { label: ${L.widthFull}, value: '100%' },
    { label: ${L.widthWide}, value: '1400px' },
    { label: ${L.widthDesktop}, value: '1280px' },
    { label: ${L.widthNarrow}, value: '720px' },
  ];
  var ddStyle = 'padding:1px 4px;border-radius:3px;border:1px solid var(--vscode-dropdown-border,var(--vscode-widget-border,#555));background:var(--vscode-dropdown-background,#333);color:var(--vscode-dropdown-foreground,#eee);font-size:11px;outline:none;cursor:pointer;';
  var wSel = document.createElement('select');
  wSel.title = ${L.pageWidth};
  wSel.style.cssText = 'max-width:72px;' + ddStyle;
  for (var i = 0; i < widths.length; i++) {
    var opt = document.createElement('option');
    opt.value = widths[i].value;
    opt.textContent = widths[i].label;
    wSel.appendChild(opt);
  }
  wSel.addEventListener('change', function() {
    document.body.style.maxWidth = wSel.value;
    document.body.style.margin = wSel.value ? '0 auto' : '';
  });
  toolbar.appendChild(wSel);

  // Mode toggle button
  var modeBtn = document.createElement('button');
  modeBtn.title = ${L.switchModeTitle};
  modeBtn.style.cssText = btnStyle + 'font-size:11px;';
  function updateModeLabel() {
    modeBtn.textContent = currentMode === 'tree' ? ${L.modeBook} : ${L.modeOutline};
  }
  updateModeLabel();
  modeBtn.addEventListener('click', function() {
    var newMode = currentMode === 'tree' ? 'book' : 'tree';
    currentMode = newMode;
    updateModeLabel();
    vscode.postMessage({ type: 'switchMode', mode: newMode });
  });
  toolbar.appendChild(modeBtn);

  // Refresh button
  var refreshBtn = document.createElement('button');
  refreshBtn.innerHTML = '&#x21bb;';
  refreshBtn.title = ${L.reloadContent};
  refreshBtn.style.cssText = btnStyle;
  refreshBtn.addEventListener('click', function() { vscode.postMessage({ type: 'refresh' }); });
  toolbar.appendChild(refreshBtn);

  document.body.appendChild(toolbar);

  ${getSearchOverlayScript({
    placeholder: L.searchPlaceholder,
    nextMatch: L.searchNext,
    prevMatch: L.searchPrev,
    close: L.searchClose,
    matchCase: L.searchMatchCase,
    useRegex: L.searchUseRegex,
    invalidRegex: L.searchInvalidRegex,
  })}
})();
`;
}

export class MapViewerProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const documentRoot = vscode.Uri.file(dirname(document.uri.fsPath));
    // Per-panel mode state (not global)
    let currentMode: 'tree' | 'book' = 'tree';

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(this.context.extensionPath),
        documentRoot,
        ...(vscode.workspace.workspaceFolders || []).map((f) => f.uri),
      ],
    };

    webviewPanel.webview.onDidReceiveMessage((message) => {
      if (message.type === 'refresh') {
        updateWebview();
      } else if (message.type === 'openTopic') {
        const href = message.href as string;
        if (!href) return;
        const mapDir = dirname(document.uri.fsPath);
        const targetPath = resolve(mapDir, decodeHrefPart(href.split('#')[0]));
        const targetUri = vscode.Uri.file(targetPath);
        const viewType = href.toLowerCase().endsWith('.ditamap') ? 'ditaViewer.mapPreview' : 'ditaViewer.preview';
        vscode.commands.executeCommand('vscode.openWith', targetUri, viewType);
      } else if (message.type === 'switchMode') {
        currentMode = message.mode as 'tree' | 'book';
        updateWebview();
      }
    });

    let renderDebounceTimer: ReturnType<typeof setTimeout> | undefined;
    const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
      renderDebounceTimer = setTimeout(updateWebview, 300);
    });

    // Re-render on theme switch so the manually-computed light/dark class
    // never goes stale relative to the actual active theme.
    const themeSubscription = vscode.window.onDidChangeActiveColorTheme(() => {
      updateWebview();
    });

    const updateWebview = () => {
      const html = this.generateHtml(document, webviewPanel.webview, currentMode);
      webviewPanel.webview.html = html;
      lastRenderedHtmlByUri.set(document.uri.toString(), html);
    };

    updateWebview();

    webviewPanel.onDidDispose(() => {
      if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
      changeSubscription.dispose();
      themeSubscription.dispose();
    });
  }

  private generateHtml(
    document: vscode.TextDocument,
    webview: vscode.Webview,
    mode: 'tree' | 'book',
  ): string {
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.file(join(this.context.extensionPath, 'media', 'styles.css')),
    );

    const docDir = dirname(document.uri.fsPath);

    try {
      const rawXml = document.getText();
      const preprocessedXml = preprocessEntities(rawXml);
      const mapDoc = parseDitamap(preprocessedXml);

      // Expand topicrefs/keydefs that reference external .ditamap files
      // so their key-value pairs are visible inline in both tree and book mode
      expandDitamapRefs(mapDoc.root, docDir);

      let content: string;
      if (mode === 'book') {
        content = this.renderBookContent(mapDoc.root, document, webview, docDir);
      } else {
        // Resolve <ph keyref="..."/> etc. in the map title and navtitles
        const keyMap = buildKeyMap(document.uri);
        content = renderMapDocument(mapDoc.root, { docDir, resolveKey: (k) => keyMap.get(k), roleFormat: formatLocalizedRole });
      }

      const script = getMapWebviewScript();
      const nonce = randomBytes(16).toString('base64');
      const theme = vscode.window.activeColorTheme;
      const isDark = theme.kind === vscode.ColorThemeKind.Dark || theme.kind === vscode.ColorThemeKind.HighContrast;

      return `<!DOCTYPE html>
<html lang="en"${isDark ? ' class="vscode-dark"' : ''}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${stylesUri}">
<title>${document.fileName}</title>
</head>
<body class="mode-${mode}">
${content}
<script nonce="${nonce}">${script}</script>
</body>
</html>`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Error</title></head>
<body>
<div style="padding:2rem;color:#c0392b;">
<h2>Map Render Error</h2>
<pre>${escapeHtml(message)}</pre>
</div>
</body>
</html>`;
    }
  }

  private renderBookContent(
    mapRoot: import('../parser/domTypes').DitaNode,
    document: vscode.TextDocument,
    webview: vscode.Webview,
    docDir: string,
  ): string {
    // Build key map once for all entries
    const keyMap = buildKeyMap(document.uri);
    const resolveKey = (k: string) => keyMap.get(k);
    const entries = collectMapEntries(mapRoot, resolveKey);

    // Track visited absolute paths to avoid duplicates
    const visited = new Set<string>();

    const parts: string[] = [];
    for (const entry of entries) {
      if (entry.href) {
        // Sub-map reference: its contents were already inlined as child
        // entries by expandDitamapRefs — render a section heading only
        // instead of parsing the map file as a topic.
        if (entry.href.split('#')[0].toLowerCase().endsWith('.ditamap')) {
          parts.push(renderBookPlaceholder(entry.displayName, entry.depth));
          continue;
        }
        const absPath = resolve(docDir, decodeHrefPart(entry.href.split('#')[0]));
        if (visited.has(absPath)) {
          parts.push(renderBookSkipMessage(entry.href));
          continue;
        }
        visited.add(absPath);

        // Create per-topic asWebviewUri that resolves relative to the topic's dir
        const topicDir = dirname(absPath);
        const asWebviewUri = (relPath: string): string => {
          const fsRelPath = decodeHrefPart(relPath);
          try {
            const resolvedPath = resolve(topicDir, fsRelPath);
            const fileUri = vscode.Uri.file(resolvedPath);
            const wvUri = webview.asWebviewUri(fileUri);
            if (wvUri) return wvUri.toString();
          } catch {}
          try {
            const fullPath = resolve(topicDir, fsRelPath);
            if (existsSync(fullPath)) {
              const data = readFileSync(fullPath);
              const ext = relPath.toLowerCase().split('.').pop() || '';
              const mime =
                ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml'
                : ext === 'webp' ? 'image/webp' : 'image/png';
              return `data:${mime};base64,${data.toString('base64')}`;
            }
          } catch {}
          return '';
        };

        const headingLevel = Math.min(1 + entry.depth, 6);
        const result = renderTopicToHtml({
          filePath: absPath,
          keyMap,
          asWebviewUri,
          headingLevel,
        });

        if (result.error) {
          parts.push(renderBookError(entry.displayName, result.error, entry.depth));
        } else {
          parts.push(`<div class="book-entry">${result.html}</div>`);
        }
      } else {
        parts.push(renderBookPlaceholder(entry.displayName, entry.depth));
      }
    }

    return `<div class="ditamap-book">${parts.join('\n')}</div>`;
  }
}


