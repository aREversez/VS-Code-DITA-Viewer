import * as vscode from 'vscode';
import { parseDita, parseDitamap, preprocessEntities } from '../parser/ditaParser';
import { renderDocument } from '../render/renderer';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { dirname, extname, isAbsolute, join, resolve, basename } from 'path';
import { randomBytes } from 'crypto';
import { DitaNode } from '../parser/domTypes';
import { buildTitleMap, expandDitamapRefs, makeConrefResolver, makeFileTitleResolver } from './ditaRenderUtils';

// Test-only hook: @vscode/test-electron integration tests can't read a
// webview's rendered HTML directly (VS Code doesn't expose the WebviewPanel
// created for a custom editor back to the caller of `vscode.openWith`), so
// each render stores its output here, keyed by document URI, for the test
// suite to read via the extension's exports. Negligible memory/perf cost;
// has no effect on normal usage.
const lastRenderedHtmlByUri = new Map<string, string>();

export function getLastRenderedHtmlForTesting(uriString: string): string | undefined {
  return lastRenderedHtmlByUri.get(uriString);
}

function getWebviewScript(): string {
  const L = {
    selectThemeCss: JSON.stringify(vscode.l10n.t('Select theme CSS')),
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
    reloadContent: JSON.stringify(vscode.l10n.t('Reload DITA content')),
  };
  return `
(function() {
  var vscode = acquireVsCodeApi();
  var scrollTimer = null;

  function findClosest(line) {
    var els = document.querySelectorAll('[data-line]');
    var best = null;
    var bestDiff = Infinity;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var l = parseInt(el.getAttribute('data-line'), 10);
      var d = Math.abs(l - line);
      if (d < bestDiff) { bestDiff = d; best = el; }
    }
    return best;
  }

  // Finds the smallest (most specific / deepest) element whose full source
  // range actually contains the given (line, col) position, rather than
  // just picking whichever element's *start* line happens to be numerically
  // closest. This correctly distinguishes plain text that is a direct child
  // of a coarse ancestor (e.g. <p>) from an inline tag (e.g. <uicontrol>)
  // that shares the same source line but only covers a narrower column range.
  function findContaining(line, col) {
    var els = document.querySelectorAll('[data-line]');
    var best = null;
    var bestSpan = Infinity;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var sl = parseInt(el.getAttribute('data-line'), 10);
      var el2 = parseInt(el.getAttribute('data-end-line'), 10);
      var sc = parseInt(el.getAttribute('data-start-col'), 10);
      var ec = parseInt(el.getAttribute('data-end-col'), 10);
      if (isNaN(sl) || isNaN(el2) || isNaN(sc) || isNaN(ec)) continue;
      var afterStart = line > sl || (line === sl && col >= sc);
      var beforeEnd = line < el2 || (line === el2 && col <= ec);
      if (!afterStart || !beforeEnd) continue;
      var span = (el2 - sl) * 100000 + (ec - sc);
      if (span < bestSpan) { bestSpan = span; best = el; }
    }
    return best || findClosest(line);
  }

  function onScrollEnd() {
    try {
      var els = document.querySelectorAll('[data-line]');
      if (!els.length) return;
      var best = els[0], bestDist = Math.abs(els[0].getBoundingClientRect().top);
      for (var i = 1; i < els.length; i++) {
        var dist = Math.abs(els[i].getBoundingClientRect().top);
        if (dist < bestDist) { bestDist = dist; best = els[i]; }
      }
      var line = best.getAttribute('data-line');
      if (line !== null) vscode.postMessage({ type: 'scrollSync', line: parseInt(line, 10) });
    } catch(e) {}
  }

  function scrollToLine(targetLine) {
    if (targetLine <= 0) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    var best = findClosest(targetLine);
    if (!best) return;
    var rect = best.getBoundingClientRect();
    if (rect.top < -5 || rect.top > 5) {
      best.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }

  var fontSize = 100;

  // Static highlight (no animation)
  var hlStyle = document.createElement('style');
  hlStyle.textContent = '.__hl{outline:2px solid var(--vscode-textLink-foreground,#4a90d9);outline-offset:2px;border-radius:3px;background:color-mix(in srgb,var(--vscode-textLink-foreground,#4a90d9) 12%,transparent);}';
  document.head.appendChild(hlStyle);

  // Image error handling (event delegation, nonce-safe)
  document.addEventListener('error', function(e) {
    var img = e.target;
    if (img.tagName !== 'IMG' || !img.hasAttribute('data-dita-src')) return;
    var src = img.getAttribute('data-dita-src') || 'unknown';
    var msg = 'Image fail: ' + src;
    img.alt = msg;
    img.style.outline = '3px solid red';
    img.style.outlineOffset = '-1px';
  }, true);

  function highlightElement(el) {
    if (!el) return;
    var prev = document.querySelector('.__hl');
    if (prev) prev.classList.remove('__hl');
    el.classList.add('__hl');
  }

  function isElementVisible(el) {
    var rect = el.getBoundingClientRect();
    return rect.top < window.innerHeight && rect.bottom > 0;
  }

  window.addEventListener('scroll', function() {
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(onScrollEnd, 150);
  });

  window.addEventListener('click', function(e) {
    var a = e.target.closest ? e.target.closest('a.xref') : null;
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) !== '#') return;
    e.preventDefault();
    var id = href.slice(1);
    var el = document.getElementById(id);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });

  window.addEventListener('dblclick', function(e) {
    var el = e.target.closest ? e.target.closest('[data-line]') : null;
    if (!el) return;
    var line = parseInt(el.getAttribute('data-line'), 10);
    if (!isNaN(line)) vscode.postMessage({ type: 'navigateToLine', line: line });
  });

  window.addEventListener('message', function(e) {
    if (e.data.type === 'revealLine') scrollToLine(e.data.line);
    if (e.data.type === 'highlightLine') {
      var best = findContaining(e.data.line, e.data.col || 0);
      if (best) {
        highlightElement(best);
        if (!isElementVisible(best)) best.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  });

  // Toolbar
  var tbStyle = 'position:fixed;top:4px;right:8px;z-index:9999;display:flex;align-items:center;gap:4px;padding:3px 6px;border-radius:5px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:12px;background:var(--vscode-editor-background,rgba(30,30,30,0.88));border:1px solid var(--vscode-widget-border,rgba(255,255,255,0.12));backdrop-filter:blur(4px);opacity:0.75;transition:opacity 0.15s;';
  var ddStyle = 'padding:1px 4px;border-radius:3px;border:1px solid var(--vscode-dropdown-border,var(--vscode-widget-border,#555));background:var(--vscode-dropdown-background,#333);color:var(--vscode-dropdown-foreground,#eee);font-size:11px;outline:none;cursor:pointer;';
  var btnStyle = 'padding:1px 5px;border-radius:3px;border:1px solid var(--vscode-dropdown-border,var(--vscode-widget-border,#555));background:var(--vscode-dropdown-background,#333);color:var(--vscode-dropdown-foreground,#eee);cursor:pointer;font-size:13px;line-height:1;outline:none;display:flex;align-items:center;';

  var toolbar = document.createElement('div');
  toolbar.id = '__toolbar';
  toolbar.style.cssText = tbStyle;
  toolbar.addEventListener('mouseenter', function() { toolbar.style.opacity = '1'; });
  toolbar.addEventListener('mouseleave', function() { toolbar.style.opacity = '0.75'; });

  // Theme CSS dropdown
  var cssFiles = window.__cssFiles || {};
  var defaultCss = window.__defaultCss || '';
  var cssKeys = Object.keys(cssFiles);
  if (cssKeys.length > 0) {
    var styleEl = document.createElement('style');
    styleEl.id = '__custom_css';
    styleEl.textContent = cssFiles[defaultCss] || '';
    document.head.appendChild(styleEl);
    var sel = document.createElement('select');
    sel.title = ${L.selectThemeCss};
    sel.style.cssText = 'max-width:130px;' + ddStyle;
    for (var i = 0; i < cssKeys.length; i++) {
      var opt = document.createElement('option');
      opt.value = cssKeys[i];
      opt.textContent = cssKeys[i].replace(/\\.css$/,'');
      if (cssKeys[i] === defaultCss) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', function() { styleEl.textContent = cssFiles[sel.value] || ''; });
    toolbar.appendChild(sel);
  }

  // Font size controls
  var fsDown = document.createElement('button');
  fsDown.innerHTML = 'A−';
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

  // Page width dropdown
  var widths = [
    { label: ${L.widthAuto}, value: '' },
    { label: ${L.widthFull}, value: '100%' },
    { label: ${L.widthWide}, value: '1400px' },
    { label: ${L.widthDesktop}, value: '1280px' },
    { label: ${L.widthNarrow}, value: '720px' },
  ];
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

  // Refresh button
  var refreshBtn = document.createElement('button');
  refreshBtn.innerHTML = '&#x21bb;';
  refreshBtn.title = ${L.reloadContent};
  refreshBtn.style.cssText = btnStyle;
  refreshBtn.addEventListener('click', function() { vscode.postMessage({ type: 'refresh' }); });
  toolbar.appendChild(refreshBtn);

  document.body.appendChild(toolbar);
})();
`;
}

export class DitaViewerProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const documentRoot = vscode.Uri.file(dirname(document.uri.fsPath));

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(this.context.extensionPath),
        documentRoot,
        ...(vscode.workspace.workspaceFolders || []).map((f) => f.uri),
      ],
    };

    const findSourceEditor = () =>
      vscode.window.visibleTextEditors.find(
        (e) => e.document.uri.toString() === document.uri.toString(),
      );

    // The toggle command (and "Reopen Editor With") can dispose this panel
    // while sync timers are still pending — guard every deferred webview
    // access so nothing posts to a disposed webview.
    let disposed = false;

    const postRevealLine = (line: number) => {
      if (disposed) return;
      webviewPanel.webview.postMessage({ type: 'revealLine', line });
    };

    let skipVisibleUntil = 0;

    webviewPanel.webview.onDidReceiveMessage((message) => {
      if (message.type === 'refresh') {
        updateWebview();
        setTimeout(doSyncSourceToWebview, 200);
      } else if (message.type === 'scrollSync') {
        const editor = findSourceEditor();
        if (editor) {
          const currentTopLine = editor.visibleRanges[0]?.start.line;
          if (currentTopLine !== undefined) {
            const diff = Math.abs(message.line - currentTopLine);
            if (diff >= 2) {
              skipVisibleUntil = Date.now() + 250;
              const line = Math.max(0, Math.min(message.line, document.lineCount - 1));
              editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.AtTop);
              editor.selection = new vscode.Selection(new vscode.Position(line, 0), new vscode.Position(line, 0));
            }
          }
        }
      } else if (message.type === 'navigateToLine') {
        // Preview double-click → highlight in source, only scroll if not visible
        const editor = findSourceEditor();
        if (editor) {
          const line = Math.max(0, Math.min(message.line, document.lineCount - 1));
          const inView = editor.visibleRanges.some(r => line >= r.start.line && line <= r.end.line);
          if (!inView) {
            editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.AtTop);
          }
          editor.selection = new vscode.Selection(new vscode.Position(line, 0), new vscode.Position(line, 0));
        }
      }
    });

    // Source click → preview: highlight + scroll if not visible
    const selectionSub = vscode.window.onDidChangeTextEditorSelection((e) => {
      if (e.textEditor.document.uri.toString() !== document.uri.toString()) return;
      if (Date.now() < skipVisibleUntil) return;
      const sel = e.selections[0];
      if (!sel || sel.start.line !== sel.end.line) return;
      webviewPanel.webview.postMessage({ type: 'highlightLine', line: sel.start.line, col: sel.start.character });
    });

    const doSyncSourceToWebview = () => {
      const editor = findSourceEditor();
      if (editor) {
        const topLine = editor.visibleRanges[0]?.start.line;
        if (topLine !== undefined) postRevealLine(topLine);
      }
    };

    let visibleRangeTimer: ReturnType<typeof setTimeout> | undefined;
    const editorSub = vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (e.textEditor.document.uri.toString() !== document.uri.toString()) return;
      if (Date.now() < skipVisibleUntil) return;
      if (visibleRangeTimer) clearTimeout(visibleRangeTimer);
      visibleRangeTimer = setTimeout(() => {
        const topLine = e.textEditor.visibleRanges[0]?.start.line;
        if (topLine !== undefined) postRevealLine(topLine);
      }, 120);
    });

    let renderDebounceTimer: ReturnType<typeof setTimeout> | undefined;
    const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
      renderDebounceTimer = setTimeout(() => {
        updateWebview();
        setTimeout(doSyncSourceToWebview, 200);
      }, 300);
    });

    // Re-render on theme switch so the manually-computed light/dark class
    // (used for DITA-specific colors that have no direct VS Code theme
    // equivalent, e.g. note backgrounds) never goes stale relative to the
    // actual active theme.
    const themeSubscription = vscode.window.onDidChangeActiveColorTheme(() => {
      updateWebview();
    });

    const updateWebview = () => {
      if (disposed) return;
      const html = this.generateHtml(document, webviewPanel.webview);
      webviewPanel.webview.html = html;
      lastRenderedHtmlByUri.set(document.uri.toString(), html);
    };

    updateWebview();

    const initialSyncTimer = setTimeout(doSyncSourceToWebview, 300);

    webviewPanel.onDidDispose(() => {
      disposed = true;
      clearTimeout(initialSyncTimer);
      if (visibleRangeTimer) clearTimeout(visibleRangeTimer);
      if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
      changeSubscription.dispose();
      editorSub.dispose();
      selectionSub.dispose();
      themeSubscription.dispose();
    });
  }

  private generateHtml(
    document: vscode.TextDocument,
    webview: vscode.Webview,
  ): string {
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.file(join(this.context.extensionPath, 'media', 'styles.css')),
    );

    const docRootDir = dirname(document.uri.fsPath);
    const docRoot = vscode.Uri.file(docRootDir);
    const asWebviewUri = (relPath: string): string => {
      try {
        const resolvedPath = resolve(docRootDir, relPath);
        const fileUri = vscode.Uri.file(resolvedPath);
        const webviewUri = webview.asWebviewUri(fileUri);
        if (webviewUri) return webviewUri.toString();
      } catch {}
      try {
        const fullPath = resolve(docRootDir, relPath);
        if (existsSync(fullPath)) {
          const data = readFileSync(fullPath);
          const ext = extname(relPath).toLowerCase();
          const mime =
            ext === '.png' ? 'image/png'
            : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
            : ext === '.gif' ? 'image/gif'
            : ext === '.svg' ? 'image/svg+xml'
            : ext === '.webp' ? 'image/webp'
            : 'image/png';
          return `data:${mime};base64,${data.toString('base64')}`;
        }
      } catch {}
      return '';
    };

    try {
      const rawXml = document.getText();
      const preprocessedXml = preprocessEntities(rawXml);
      const ditaDoc = parseDita(preprocessedXml);
      const titleMap = buildTitleMap(ditaDoc.root);

      // Detect locale from xml:lang
      const lang = ditaDoc.root.attributes?.['xml:lang'] || '';
      const isZh = lang.startsWith('zh');
      const noteLabels = isZh
        ? { note: '注', notice: '注意', warning: '警告', danger: '危险', important: '重要', tip: '提示', restriction: '限制' }
        : { note: 'Note', notice: 'Notice', warning: 'Warning', danger: 'Danger', important: 'Important', tip: 'Tip', restriction: 'Restriction' };

      // Build key map from DITAMAP
      const keyMap = buildKeyMap(document.uri);

      // Build conref resolver
      const conrefResolver = makeConrefResolver(docRootDir);
      const fileTitleResolver = makeFileTitleResolver(docRootDir);

      const resolveTitle = (id: string): string | undefined => {
        // Local id match first
        const local = titleMap.get(id);
        if (local) return local;
        // Cross-file: id might be "file.dita#topicId"
        if (id.includes('#')) return fileTitleResolver(id);
        return undefined;
      };

      const content = renderDocument(ditaDoc.root, {
        headingLevel: 1,
        asWebviewUri,
        documentDir: docRoot.fsPath,
        resolveTitle,
        resolveKey: (key: string) => keyMap.get(key),
        resolveConref: (conref: string) => conrefResolver(conref),
        noteLabels,
      });

      const { files, defaultName } = discoverCssFiles(document.uri);
      const defaultContent = files[defaultName] || '';

      const theme = vscode.window.activeColorTheme;
      const isDark = theme.kind === vscode.ColorThemeKind.Dark || theme.kind === vscode.ColorThemeKind.HighContrast;

      const script = getWebviewScript();
      const cssFilesJson = escapeJson(JSON.stringify(files));
      const defaultNameJson = escapeJson(JSON.stringify(defaultName));

      // CSP nonce for defense-in-depth against XSS
      const nonce = randomBytes(16).toString('base64');

      return `<!DOCTYPE html>
<html lang="en"${isDark ? ' class="vscode-dark"' : ''}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${stylesUri}">
${defaultContent ? `<style>\n${defaultContent}\n</style>` : ''}
<title>${document.fileName}</title>
<script nonce="${nonce}">window.__cssFiles=${cssFilesJson};window.__defaultCss=${defaultNameJson};</script>
</head>
<body>
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
<h2>Render Error</h2>
<pre>${escapeHtml(message)}</pre>
</div>
</body>
</html>`;
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeJson(text: string): string {
  return text.replace(/<\/script>/gi, '<\\/script>');
}

// ── Keyref: parse DITAMAP for key→value mappings ──

export function findDitamapFiles(docUri: vscode.Uri, stopAtFirstMatch = true): string[] {
  const results: string[] = [];
  const docDir = dirname(docUri.fsPath);
  const root = parseDocRoot(docDir);
  let dir = docDir;
  while (dir.length >= root.length) {
    try {
      for (const entry of readdirSync(dir)) {
        if (entry.endsWith('.ditamap')) results.push(join(dir, entry));
      }
    } catch {}
    if (stopAtFirstMatch && results.length > 0) return results;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return results;
}

function extractTextFromNode(node: DitaNode): string {
  if (node.type === 'text') return node.text || '';
  return (node.children || []).map(extractTextFromNode).join('');
}

function getNodeValue(node: DitaNode, childBaseTypes: string[]): string | undefined {
  for (const bt of childBaseTypes) {
    const child = (node.children || []).find(
      (c) => c.type === 'element' && c.baseType === bt,
    );
    if (child) {
      const text = extractTextFromNode(child).trim();
      if (text) return text;
    }
    // DITA wraps <keyword> inside <keywords>; also search inside known wrappers
    const wrapper = (node.children || []).find(
      (c) => c.type === 'element' && (c.baseType === 'map/keywords'),
    );
    if (wrapper) {
      const inner = (wrapper.children || []).find(
        (c) => c.type === 'element' && c.baseType === bt,
      );
      if (inner) {
        const text = extractTextFromNode(inner).trim();
        if (text) return text;
      }
    }
  }
  return undefined;
}

function getKeyValueFromRef(node: DitaNode): string | undefined {
  // Priority: keyword > linktext > navtitle > shortdesc > indexterm
  const topicmeta = (node.children || []).find(
    (c) => c.type === 'element' && (c.baseType === 'map/topicmeta'),
  );
  if (!topicmeta) return undefined; // No topicmeta, no value
  return getNodeValue(topicmeta, [
    'map/keyword',
    'map/linktext',
    'map/navtitle',
    'map/shortdesc',
  ]);
}

export function buildKeyMap(docUri: vscode.Uri): Map<string, string> {
  const map = new Map<string, string>();
  // Scan all ancestor folders (not just the nearest one with a map) so keydef
  // maps living in outer folders are still picked up; maps referenced from any
  // scanned map are followed via expandDitamapRefs regardless of location.
  const mapFiles = findDitamapFiles(docUri, false);
  for (const mf of mapFiles) {
    try {
      const content = readFileSync(mf, 'utf-8');
      const doc = parseDitamap(preprocessEntities(content));
      const mapRoot = doc.root;
      // Expand referenced ditamaps so keydefs from included maps are visible
      expandDitamapRefs(mapRoot, dirname(mf));
      function walk(node: DitaNode) {
        if (node.type !== 'element') return;
        const baseType = node.baseType;
        if ((baseType === 'map/topicref' || baseType === 'map/keydef') && node.attributes?.keys) {
          const keys = node.attributes.keys;
          const value = getKeyValueFromRef(node);
          // First definition wins (DITA precedence; nearest map scanned first)
          if (!map.has(keys)) map.set(keys, value || keys);
        }
        for (const child of node.children || []) walk(child);
      }
      for (const child of mapRoot.children || []) walk(child);
    } catch {}
  }
  return map;
}

// (cross-file helpers now in ditaRenderUtils.ts)

// ── CSS file discovery ──

function discoverCssFiles(docUri: vscode.Uri): { files: Record<string, string>; defaultName: string } {
  const files: Record<string, string> = {};
  const loadedNames = new Set<string>();

  const addFile = (filePath: string) => {
    const name = basename(filePath);
    if (!loadedNames.has(name) && existsSync(filePath)) {
      try {
        files[name] = readFileSync(filePath, 'utf-8');
        loadedNames.add(name);
      } catch {}
    }
  };

  const docDir = dirname(docUri.fsPath);
  const root = parseDocRoot(docDir);
  const cssDir = findCustomCssDir(docDir);

  // Scan directories for .css files
  const scanDirs = new Set<string>();
  scanDirs.add(cssDir);
  if (root !== cssDir) scanDirs.add(root);
  // Add configured CSS directories
  try {
    const config = vscode.workspace.getConfiguration('dita-viewer');
    const cssDirConfigs: string[] | undefined = config.get('cssDirectory');
    if (cssDirConfigs) {
      for (const dir of cssDirConfigs) {
        const resolvedDir = resolveDirectoryPath(dir, docDir);
        if (resolvedDir && existsSync(resolvedDir) && !scanDirs.has(resolvedDir)) {
          scanDirs.add(resolvedDir);
        }
      }
    }
  } catch {}

  for (const sd of scanDirs) {
    try {
      for (const entry of readdirSync(sd)) {
        if (entry.toLowerCase().endsWith('.css')) addFile(join(sd, entry));
      }
    } catch {}
  }

  // Add explicitly configured CSS files
  try {
    const config = vscode.workspace.getConfiguration('dita-viewer');
    const paths: string[] | undefined = config.get('customCss');
    if (paths) {
      for (const p of paths) {
        const resolvedPath = resolveCssFilePath(p, docDir);
        if (resolvedPath) addFile(resolvedPath);
      }
    }
  } catch {}

  const defaultName = files['custom.css'] ? 'custom.css' : (Object.keys(files)[0] || '');
  return { files, defaultName };
}

function findCustomCssDir(docDir: string): string {
  const root = parseDocRoot(docDir);
  let dir = docDir;
  while (dir.length >= root.length) {
    if (existsSync(join(dir, 'custom.css'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return docDir;
}

function parseDocRoot(dir: string): string {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) return folders[0].uri.fsPath;
  const sep = dir.includes('/') ? '/' : '\\';
  const parts = dir.split(/[\\/]/);
  // POSIX: root is "/", Windows: root is "C:\"
  if (sep === '/') return '/' + parts.slice(1, 2).join('/');
  return parts.length > 2 ? parts.slice(0, 2).join('\\') : dir;
}

function resolveCssFilePath(cssPath: string, docDir: string): string | undefined {
  if (isAbsolute(cssPath) && existsSync(cssPath)) {
    return cssPath;
  }
  const resolved = resolve(docDir, cssPath);
  if (existsSync(resolved)) return resolved;
  const folders = vscode.workspace.workspaceFolders;
  if (folders) {
    for (const f of folders) {
      const wsPath = resolve(f.uri.fsPath, cssPath);
      if (existsSync(wsPath)) return wsPath;
    }
  }
  return undefined;
}

function resolveDirectoryPath(dirPath: string, docDir: string): string | undefined {
  // Absolute path
  if (isAbsolute(dirPath)) {
    return existsSync(dirPath) ? dirPath : undefined;
  }
  // Relative to doc directory
  const fromDoc = resolve(docDir, dirPath);
  if (existsSync(fromDoc)) return fromDoc;
  // Relative to workspace root
  const folders = vscode.workspace.workspaceFolders;
  if (folders) {
    for (const f of folders) {
      const wsPath = resolve(f.uri.fsPath, dirPath);
      if (existsSync(wsPath)) return wsPath;
    }
  }
  return undefined;
}