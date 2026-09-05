import * as vscode from 'vscode';
import { parseDitamap, preprocessEntities } from '../parser/ditaParser';
import { renderMapDocument, collectMapEntries } from '../render/mapTypeMap';
import { renderBookEntries, escapeHtml, expandDitamapRefs, getSearchOverlayScript, getProfilingFilterScript, decodeHrefPart } from './ditaRenderUtils';
import { buildKeyMap } from './DitaViewerProvider';
import { formatLocalizedRole } from '../language/bookRoleL10n';
import { dirname, join, resolve } from 'path';
import { randomBytes } from 'crypto';

// Test-only hook: see the identical comment in DitaViewerProvider.ts.
const lastRenderedHtmlByUri = new Map<string, string>();

export function getLastRenderedMapHtmlForTesting(uriString: string): string | undefined {
  return lastRenderedHtmlByUri.get(uriString);
}

/**
 * Clears the cached rendered map HTML. Entries are already removed
 * individually as each webview panel disposes; this is a defensive full
 * reset for extension deactivation, not a fix for an actual leak. Called
 * from clearAllCaches() in DitaViewerProvider.ts via extension.ts's
 * deactivate().
 */
export function clearMapCache(): void {
  lastRenderedHtmlByUri.clear();
}

function getMapWebviewScript(): string {
  const L = {
    previewToolbar: JSON.stringify(vscode.l10n.t('Preview toolbar')),
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
    profilingLabel: JSON.stringify(vscode.l10n.t('Flags')),
    profilingOnTitle: JSON.stringify(vscode.l10n.t('Profiling attributes (props/otherprops/audience/...) are highlighted. Click to hide the highlighting.')),
    profilingOffTitle: JSON.stringify(vscode.l10n.t('Profiling attribute highlighting is hidden. Click to show which content is flagged and with what.')),
    filterLabel: vscode.l10n.t('Filter'),
    filterTitle: vscode.l10n.t('Show/hide content by profiling attribute value (actually hides matching content, unlike the Flags toggle which only shows/hides the highlight)'),
    filterClose: vscode.l10n.t('Close'),
    filterEmpty: vscode.l10n.t('No profiling attributes in this document'),
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
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', ${L.previewToolbar});
  toolbar.style.cssText = tbStyle;
  toolbar.addEventListener('mouseenter', function() { toolbar.style.opacity = '1'; });
  toolbar.addEventListener('mouseleave', function() { toolbar.style.opacity = '0.75'; });

  var fontSize = 100;
  var fsDown = document.createElement('button');
  fsDown.innerHTML = 'A\u2212';
  fsDown.title = ${L.decreaseFontSize};
  fsDown.setAttribute('aria-label', ${L.decreaseFontSize});
  fsDown.style.cssText = btnStyle + 'font-weight:bold;';
  fsDown.addEventListener('click', function() {
    fontSize = Math.max(60, fontSize - 10);
    document.body.style.fontSize = fontSize + '%';
  });
  toolbar.appendChild(fsDown);

  var fsUp = document.createElement('button');
  fsUp.innerHTML = 'A+';
  fsUp.title = ${L.increaseFontSize};
  fsUp.setAttribute('aria-label', ${L.increaseFontSize});
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
  fontBtn.setAttribute('aria-label', ${L.fontCurrentSans});
  fontBtn.style.cssText = btnStyle + 'font-size:11px;';
  fontBtn.addEventListener('click', function() {
    isSerif = !isSerif;
    fontBtn.textContent = isSerif ? ${L.fontSerif} : ${L.fontSans};
    fontBtn.title = isSerif ? ${L.fontCurrentSerif} : ${L.fontCurrentSans};
    fontBtn.setAttribute('aria-label', isSerif ? ${L.fontCurrentSerif} : ${L.fontCurrentSans});
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
  wSel.setAttribute('aria-label', ${L.pageWidth});
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
  modeBtn.setAttribute('aria-label', ${L.switchModeTitle});
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

  // Profiling / conditional-attribute highlight toggle, same as the topic
  // viewer's Flags button -- purely a CSS class flip (body.hide-profiling),
  // no re-render needed. Defaults on for the same reason: the point is
  // surfacing what's flagged without the person having to discover the
  // toggle first.
  var profilingOn = true;
  var profilingBtn = document.createElement('button');
  profilingBtn.textContent = ${L.profilingLabel};
  profilingBtn.style.cssText = btnStyle + 'font-size:11px;';
  function applyProfilingToggle() {
    document.body.classList.toggle('hide-profiling', !profilingOn);
    profilingBtn.style.background = profilingOn ? 'var(--color-profiling-label-bg)' : '';
    profilingBtn.style.color = profilingOn ? 'var(--color-profiling-label-text)' : '';
    profilingBtn.title = profilingOn ? ${L.profilingOnTitle} : ${L.profilingOffTitle};
    profilingBtn.setAttribute('aria-label', profilingOn ? ${L.profilingOnTitle} : ${L.profilingOffTitle});
  }
  profilingBtn.addEventListener('click', function() {
    profilingOn = !profilingOn;
    applyProfilingToggle();
  });
  applyProfilingToggle();
  toolbar.appendChild(profilingBtn);

  // Filter button goes immediately next to Flags, same pairing as the
  // topic viewer -- in Outline mode this hides whole map entries by their
  // topicref-level profiling; in Book mode there's no topicref-level
  // profiling to speak of (see MapViewerProvider.renderBookContent), only
  // whatever profiled spans exist inside each composited topic's own
  // content, same as opening that topic directly.
  ${getProfilingFilterScript({
    buttonLabel: L.filterLabel,
    buttonTitle: L.filterTitle,
    closeLabel: L.filterClose,
    emptyLabel: L.filterEmpty,
  })}

  // Refresh button
  var refreshBtn = document.createElement('button');
  refreshBtn.innerHTML = '&#x21bb;';
  refreshBtn.title = ${L.reloadContent};
  refreshBtn.setAttribute('aria-label', ${L.reloadContent});
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

  // Every source edit (a topicref's profiling attributes, reordering
  // entries, ...) sends just the freshly rendered content as a message
  // instead of the extension reassigning webview.html wholesale -- see
  // postContentUpdate in MapViewerProvider.ts for why (same reasoning as
  // the topic viewer's own content-only update). Content-dependent setup
  // that only ran once at initial load, because a full reload used to
  // rerun this entire script from scratch every time, needs to re-run
  // after each swap instead. Map view has no per-image zoom toolbar and
  // no source-editor scroll-sync of its own to re-apply (unlike the topic
  // viewer), so this is a shorter list.
  window.addEventListener('message', function(e) {
    if (e.data.type === 'updateContent') {
      var contentRoot = document.getElementById('dita-content-root');
      if (contentRoot) {
        contentRoot.innerHTML = e.data.html;
        if (typeof pfApplyFilter === 'function') pfApplyFilter();
        if (typeof pfPanel !== 'undefined' && pfPanel) {
          pfPanel.remove();
          pfPanel = pfBuildPanel();
          document.body.appendChild(pfPanel);
        }
        if (typeof sb !== 'undefined' && sb.style.display !== 'none' && searchInput.value) {
          performSearch(searchInput.value);
        }
      }
    }
  });
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
        requestUpdate('full');
      } else if (message.type === 'openTopic') {
        const href = message.href as string;
        if (!href) return;
        const mapDir = dirname(document.uri.fsPath);
        const filePart = decodeHrefPart(href.split('#')[0]);
        const targetPath = resolve(mapDir, filePart);
        const targetUri = vscode.Uri.file(targetPath);
        // Decide the viewer by the file part only — "sub.ditamap#id" must
        // still open in the map preview.
        const viewType = filePart.toLowerCase().endsWith('.ditamap') ? 'ditaViewer.mapPreview' : 'ditaViewer.preview';
        vscode.commands.executeCommand('vscode.openWith', targetUri, viewType);
      } else if (message.type === 'switchMode') {
        currentMode = message.mode as 'tree' | 'book';
        requestUpdate('full');
      }
    });

    let disposed = false;
    let renderDebounceTimer: ReturnType<typeof setTimeout> | undefined;
    // The render a currently-hidden panel is owed, if any. 'content' is a
    // source edit, satisfied by postContentUpdate; 'full' is a theme switch,
    // manual refresh or tree/book mode toggle, each of which has to reassign
    // webview.html -- the light/dark class lives on <html>, outside the
    // content div a content-only update touches, and a mode switch replaces
    // the whole document rather than patching it. Escalates only -- a theme
    // switch landing while an edit is already pending must not be
    // downgraded, or the class stays stale until some later re-render.
    let pendingUpdate: 'none' | 'content' | 'full' = 'none';
    const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
      renderDebounceTimer = setTimeout(() => requestUpdate('content'), 300);
    });

    // Same rationale as DitaViewerProvider's referencedFilesWatcher: a
    // ditamap's topicrefs/keydefs/maprefs and each inlined topic's own
    // conref/image references routinely point outside this document, so
    // only watching this document itself (above) misses edits to the very
    // files book/outline mode is built from. Watches the containing
    // workspace folder broadly rather than the resolved reference set for
    // the same reason given there: that set isn't currently surfaced by
    // the renderer, and DITA projects commonly reach across folders.
    const watchBase =
      vscode.workspace.getWorkspaceFolder(document.uri)?.uri ??
      vscode.Uri.file(dirname(document.uri.fsPath));
    const referencedFilesWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(watchBase, '**/*.{dita,ditamap,css,png,jpg,jpeg,gif,svg,webp}'),
    );
    const onReferencedFileChanged = (uri: vscode.Uri) => {
      if (disposed) return;
      if (uri.toString() === document.uri.toString()) return; // already handled above
      if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
      renderDebounceTimer = setTimeout(() => requestUpdate('content'), 300);
    };
    referencedFilesWatcher.onDidChange(onReferencedFileChanged);
    referencedFilesWatcher.onDidCreate(onReferencedFileChanged);
    referencedFilesWatcher.onDidDelete(onReferencedFileChanged);

    // Re-render on theme switch so the manually-computed light/dark class
    // never goes stale relative to the actual active theme. A genuine full
    // reload, unlike postContentUpdate below -- the class lives on <html>,
    // outside the content div a content-only update touches.
    const themeSubscription = vscode.window.onDidChangeActiveColorTheme(() => {
      requestUpdate('full');
    });

    const updateWebview = () => {
      if (disposed) return;
      const html = this.generateHtml(document, webviewPanel.webview, currentMode);
      webviewPanel.webview.html = html;
      lastRenderedHtmlByUri.set(document.uri.toString(), html);
    };

    // The common case: a regular source edit (topicref profiling, adding/
    // reordering entries, ...). Sends just the freshly rendered content as
    // a message instead of reassigning webview.html -- same reasoning, and
    // the same fix, as DitaViewerProvider.ts's postContentUpdate: no full
    // page reload means no images re-requesting/re-decoding, no scroll
    // position lost, and nothing for an in-flight scroll correction to
    // race against. Falls back to a full reload only if rendering itself
    // failed, to show the error page.
    const postContentUpdate = () => {
      if (disposed) return;
      const result = this.renderMapContent(document, webviewPanel.webview, currentMode);
      if (result.error !== undefined) {
        updateWebview();
        return;
      }
      webviewPanel.webview.postMessage({ type: 'updateContent', html: result.html });
    };

    // A hidden panel (tabbed behind another editor, or sitting in a
    // collapsed group) still has a live webview under
    // retainContextWhenHidden, so without this every edit anywhere in the
    // watched set pays for a full re-render nobody is looking at. That is
    // expensive here in a way it isn't for a single topic: book mode
    // re-renders every referenced topic from scratch (see the render cost
    // note in scripts/bench-book-render.js), and the extension host is
    // single-threaded, so the cost lands on every other extension's
    // completions and hovers too. Record the debt instead and settle it
    // once, when the panel comes back.
    const requestUpdate = (kind: 'content' | 'full') => {
      if (disposed) return;
      if (!webviewPanel.visible) {
        if (pendingUpdate === 'none' || kind === 'full') pendingUpdate = kind;
        return;
      }
      if (kind === 'full') updateWebview();
      else postContentUpdate();
    };

    const viewStateSubscription = webviewPanel.onDidChangeViewState((e) => {
      if (!e.webviewPanel.visible || pendingUpdate === 'none') return;
      // Clear before rendering: postContentUpdate falls back to
      // updateWebview when rendering fails, and re-entering with a stale
      // pendingUpdate would render twice.
      const owed = pendingUpdate;
      pendingUpdate = 'none';
      if (owed === 'full') updateWebview();
      else postContentUpdate();
    });

    updateWebview();

    webviewPanel.onDidDispose(() => {
      disposed = true;
      if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
      changeSubscription.dispose();
      referencedFilesWatcher.dispose();
      themeSubscription.dispose();
      viewStateSubscription.dispose();
      lastRenderedHtmlByUri.delete(document.uri.toString());
    });
  }

  private renderMapContent(
    document: vscode.TextDocument,
    webview: vscode.Webview,
    mode: 'tree' | 'book',
  ): { html: string; error?: undefined } | { html?: undefined; error: string } {
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
        content = renderMapDocument(mapDoc.root, {
          docDir,
          resolveKey: (k) => keyMap.get(k),
          roleFormat: formatLocalizedRole,
          treeLabel: vscode.l10n.t('Document outline'),
        });
      }
      return { html: content };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: message };
    }
  }

  private generateHtml(
    document: vscode.TextDocument,
    webview: vscode.Webview,
    mode: 'tree' | 'book',
  ): string {
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.file(join(this.context.extensionPath, 'media', 'styles.css')),
    );

    const result = this.renderMapContent(document, webview, mode);
    if (result.error !== undefined) {
      const message = result.error;
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

    const script = getMapWebviewScript();
    const nonce = randomBytes(16).toString('base64');
    const theme = vscode.window.activeColorTheme;
    const isDark = theme.kind === vscode.ColorThemeKind.Dark || theme.kind === vscode.ColorThemeKind.HighContrast;

    return `<!DOCTYPE html>
<html lang="en"${isDark ? ' class="vscode-dark"' : ''}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none';">
<link rel="stylesheet" href="${stylesUri}">
<title>${escapeHtml(document.fileName)}</title>
</head>
<body class="mode-${mode}">
<div id="dita-content-root">${result.html}</div>
<script nonce="${nonce}">${script}</script>
</body>
</html>`;
  }

  private renderBookContent(
    mapRoot: import('../parser/domTypes').DitaNode,
    document: vscode.TextDocument,
    webview: vscode.Webview,
    docDir: string,
  ): string {
    // Build key map once for all entries. renderTopicCached compares it by
    // identity, so one instance for the whole pass is what makes reuse work.
    const keyMap = buildKeyMap(document.uri);
    const resolveKey = (k: string) => keyMap.get(k);
    const entries = collectMapEntries(mapRoot, resolveKey);

    // The assembly loop lives in ditaRenderUtils.renderBookEntries so it can
    // be unit-tested -- and benchmarked against the same code that ships --
    // without a VS Code instance. This method contributes the two things
    // that genuinely need one: the map's key definitions and the webview's
    // resource-URI conversion.
    return renderBookEntries({
      entries,
      docDir,
      keyMap,
      fileToWebviewUri: (absPath) => webview.asWebviewUri(vscode.Uri.file(absPath)).toString(),
      uiLanguage: vscode.env.language,
    });
  }
}


