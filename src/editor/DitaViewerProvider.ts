import * as vscode from 'vscode';
import { parseDita } from '../parser/ditaParser';
import { renderDocument } from '../render/renderer';
import { readFileSync, existsSync } from 'fs';
import { dirname, extname, join, resolve } from 'path';
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
    // If target is far past the last rendered element, stay at bottom
    if (targetLine > elLine + 2) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      return;
    }
    // Only scroll if element is not already at viewport top
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
      if (message.type === 'scrollSync') {
        const editor = findSourceEditor();
        if (editor) {
          const currentTopLine = editor.visibleRanges[0]?.start.line;
          if (currentTopLine !== undefined) {
            const diff = message.line - currentTopLine;
            // Only pull source forward when webview is ahead
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
    const css = getStylesCss(this.context);
    const script = getWebviewScript();
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

      const theme = vscode.window.activeColorTheme;
      const isDark = theme.kind === vscode.ColorThemeKind.Dark || theme.kind === vscode.ColorThemeKind.HighContrast;

      return `<!DOCTYPE html>
<html lang="en"${isDark ? ' class="vscode-dark"' : ''}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'unsafe-inline';">
<link rel="stylesheet" href="${stylesUri}">
<title>${document.fileName}</title>
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
