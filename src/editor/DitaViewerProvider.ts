import * as vscode from 'vscode';
import { parseDita } from '../parser/ditaParser';
import { renderDocument } from '../render/renderer';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { dirname, extname, isAbsolute, join, resolve, basename } from 'path';
import { DitaNode } from '../parser/domTypes';

function getStylesCss(context: vscode.ExtensionContext): string {
  const stylePath = join(context.extensionPath, 'media', 'styles.css');
  try {
    return readFileSync(stylePath, 'utf-8');
  } catch {
    return '';
  }
}

function getWebviewScript(): string {
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

  function onScrollEnd() {
    var best = findClosest(0);
    if (best) {
      var line = best.getAttribute('data-line');
      if (line !== null) vscode.postMessage({ type: 'scrollSync', line: parseInt(line, 10) });
    }
  }

  function scrollToLine(targetLine) {
    if (targetLine <= 0) { window.scrollTo(0, 0); return; }
    var best = findClosest(targetLine);
    if (!best) return;
    var elLine = parseInt(best.getAttribute('data-line'), 10);
    if (targetLine > elLine + 2) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      return;
    }
    var rect = best.getBoundingClientRect();
    if (rect.top < -5 || rect.top > 5) {
      best.scrollIntoView({ block: 'start' });
    }
  }

  window.addEventListener('scroll', function() {
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(onScrollEnd, 500);
  });

  window.addEventListener('click', function(e) {
    var a = e.target.closest ? e.target.closest('a') : null;
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) !== '#') return;
    e.preventDefault();
    var id = href.slice(1);
    var el = document.getElementById(id);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });

  window.addEventListener('message', function(e) {
    if (e.data.type === 'revealLine') scrollToLine(e.data.line);
  });

  // Toolbar shared styles
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
    sel.title = 'Select theme CSS';
    sel.style.cssText = 'max-width:130px;' + ddStyle;
    for (var i = 0; i < cssKeys.length; i++) {
      var opt = document.createElement('option');
      opt.value = cssKeys[i];
      opt.textContent = cssKeys[i].replace(/\.css$/,'');
      if (cssKeys[i] === defaultCss) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', function() { styleEl.textContent = cssFiles[sel.value] || ''; });
    toolbar.appendChild(sel);
  }

  // Page width dropdown
  var widths = [
    { label: 'Auto', value: '' },
    { label: 'Full', value: '100%' },
    { label: 'Wide', value: '1400px' },
    { label: 'Desktop', value: '1280px' },
    { label: 'Narrow', value: '720px' },
  ];
  var wSel = document.createElement('select');
  wSel.title = 'Page width';
  wSel.style.cssText = 'max-width:80px;' + ddStyle;
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
  refreshBtn.title = 'Reload DITA content';
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

    const postRevealLine = (line: number) => {
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
            const diff = message.line - currentTopLine;
            if (diff > 1) {
              skipVisibleUntil = Date.now() + 250;
              const line = Math.max(0, Math.min(message.line, document.lineCount - 1));
              editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.AtTop);
              editor.selection = new vscode.Selection(new vscode.Position(line, 0), new vscode.Position(line, 0));
            }
          }
        }
      }
    });

    const doSyncSourceToWebview = () => {
      const editor = findSourceEditor();
      if (editor) {
        const topLine = editor.visibleRanges[0]?.start.line;
        if (topLine !== undefined) postRevealLine(topLine);
      }
    };

    const editorSub = vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (e.textEditor.document.uri.toString() === document.uri.toString()) {
        if (Date.now() < skipVisibleUntil) return;
        const topLine = e.textEditor.visibleRanges[0]?.start.line;
        if (topLine !== undefined) postRevealLine(topLine);
      }
    });

    const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebview();
        setTimeout(doSyncSourceToWebview, 200);
      }
    });

    const updateWebview = () => {
      const html = this.generateHtml(document, webviewPanel.webview);
      webviewPanel.webview.html = html;
    };

    updateWebview();

    setTimeout(doSyncSourceToWebview, 300);

    webviewPanel.onDidDispose(() => {
      changeSubscription.dispose();
      editorSub.dispose();
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
      const ditaDoc = parseDita(document.getText());
      const titleMap = buildTitleMap(ditaDoc.root);

      const content = renderDocument(ditaDoc.root, {
        headingLevel: 1,
        asWebviewUri,
        documentDir: docRoot.fsPath,
        resolveTitle: (id: string) => titleMap.get(id),
      });

      const { files, defaultName } = discoverCssFiles(document.uri);
      const defaultContent = files[defaultName] || '';

      const theme = vscode.window.activeColorTheme;
      const isDark = theme.kind === vscode.ColorThemeKind.Dark || theme.kind === vscode.ColorThemeKind.HighContrast;

      const script = getWebviewScript();
      const cssFilesJson = escapeJson(JSON.stringify(files));
      const defaultNameJson = escapeJson(JSON.stringify(defaultName));

      return `<!DOCTYPE html>
<html lang="en"${isDark ? ' class="vscode-dark"' : ''}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'unsafe-inline';">
<link rel="stylesheet" href="${stylesUri}">
${defaultContent ? `<style>\n${defaultContent}\n</style>` : ''}
<title>${document.fileName}</title>
<script>window.__cssFiles=${cssFilesJson};window.__defaultCss=${defaultNameJson};</script>
</head>
<body>
${content}
<script>${script}</script>
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

function collectText(node: DitaNode): string {
  if (node.type === 'text') return node.text || '';
  return (node.children || []).map(collectText).join('');
}

function buildTitleMap(root: DitaNode): Map<string, string> {
  const map = new Map<string, string>();
  function walk(node: DitaNode) {
    if (node.type === 'element') {
      const id = node.attributes?.id;
      if (id) {
        const titleChild = (node.children || []).find(
          (c) => c.type === 'element' && c.baseType === 'topic/title',
        );
        if (titleChild) {
          map.set(id, collectText(titleChild));
        }
      }
      for (const child of node.children || []) walk(child);
    }
  }
  walk(root);
  return map;
}

interface CssFileInfo {
  name: string;
  content: string;
}

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

  // Scan the directory where custom.css was found (or doc dir)
  try {
    for (const entry of readdirSync(cssDir)) {
      if (entry.endsWith('.css')) addFile(join(cssDir, entry));
    }
  } catch {}

  // Also scan workspace root if different
  if (root !== cssDir) {
    try {
      for (const entry of readdirSync(root)) {
        if (entry.endsWith('.css')) addFile(join(root, entry));
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
  const parts = dir.split(/[\\/]/);
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
