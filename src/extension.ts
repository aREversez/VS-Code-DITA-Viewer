import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { basename, dirname, isAbsolute, join, resolve } from 'path';
import { DitaViewerProvider, findDitamapFiles, getLastRenderedHtmlForTesting, clearAllCaches } from './editor/DitaViewerProvider';
import { MapViewerProvider, getLastRenderedMapHtmlForTesting, clearMapCache } from './editor/MapViewerProvider';
import {
  resolveDitaOtExecutable,
  buildDitaOtArgs,
  buildDitaOtSpawnSpec,
  buildNavManifest,
  classifyLogLine,
  createLineBuffer,
  CssArg,
  SiteChromeFeatures,
} from './editor/ditaOtUtils';
import { registerLanguageFeatures } from './language/ditaLanguageFeatures';
import { registerMapTreeView } from './language/ditaMapTreeProvider';
import { ditaFileWatcherCounts } from './editor/ditaFileWatcher';
import { registerExportHtmlCommand } from './editor/exportHtml';
import { registerCompareCommand } from './editor/ditaDiffProvider';

const TRANSFORM_CMD = 'ditaViewer.transformWithDitaOt';

export function activate(context: vscode.ExtensionContext) {
  // Language features: go-to-definition, completion, outline symbols,
  // broken-reference diagnostics (items shared by .dita and .ditamap)
  registerLanguageFeatures(context);

  // Explorer sidebar tree view of the active DITA map
  registerMapTreeView(context);

  // "Export as HTML" command (self-contained file, no DITA-OT needed)
  registerExportHtmlCommand(context);

  // "Compare with Git Version" — rendered diff view for .dita files
  registerCompareCommand(context);

  // DITA topic preview (.dita)
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'ditaViewer.preview',
      new DitaViewerProvider(context),
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      },
    ),
  );

  // DITAMAP preview (.ditamap)
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'ditaViewer.mapPreview',
      new MapViewerProvider(context),
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      },
    ),
  );

  // Toggle between the reading view and the source editor: when the active
  // tab is already the given reading view, switch back to the text editor;
  // otherwise open the reading view beside the source.
  const toggleReadingView = async (viewType: string) => {
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const input = activeTab?.input;
    if (activeTab && input instanceof vscode.TabInputCustom && input.viewType === viewType) {
      const uriStr = input.uri.toString();
      // If the source is already open as a text tab, focus it and close the preview
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          if (tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uriStr) {
            await vscode.window.showTextDocument(tab.input.uri, { viewColumn: group.viewColumn });
            await vscode.window.tabGroups.close(activeTab);
            return;
          }
        }
      }
      // Otherwise reopen this tab with the default text editor in place
      await vscode.commands.executeCommand('vscode.openWith', input.uri, 'default', activeTab.group.viewColumn);
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    await vscode.commands.executeCommand(
      'vscode.openWith',
      editor.document.uri,
      viewType,
      vscode.ViewColumn.Beside,
    );
  };

  const showRenderedCommand = vscode.commands.registerCommand(
    'ditaViewer.showRendered',
    () => toggleReadingView('ditaViewer.preview'),
  );

  context.subscriptions.push(showRenderedCommand);

  const showMapRenderedCommand = vscode.commands.registerCommand(
    'ditaViewer.showMapRendered',
    () => toggleReadingView('ditaViewer.mapPreview'),
  );

  context.subscriptions.push(showMapRenderedCommand);

  // "Back to source" companions: shown (via when clauses) only while the
  // corresponding reading view is active, so the editor-title button carries
  // an accurate tooltip instead of "Open … Reading View". Same toggle logic.
  context.subscriptions.push(
    vscode.commands.registerCommand('ditaViewer.showSource', () =>
      toggleReadingView('ditaViewer.preview'),
    ),
    vscode.commands.registerCommand('ditaViewer.showMapSource', () =>
      toggleReadingView('ditaViewer.mapPreview'),
    ),
  );

  // DITA-OT transform command
  const extensionPath = context.extensionPath;
  // Shared output channel: created once so the log survives after the
  // command finishes ("View Output Log" used to open an already-disposed
  // channel); each run clears the previous content.
  const transformOutputChannel = vscode.window.createOutputChannel('DITA-OT Transform');
  context.subscriptions.push(transformOutputChannel);
  const transformCommand = vscode.commands.registerCommand(TRANSFORM_CMD, async () => {
    const tokenSource = new vscode.CancellationTokenSource();
    const disposables: vscode.Disposable[] = [];

    try {
      // 1. Determine input map file
      const mapUri = await resolveMapFile();
      if (!mapUri) {
        vscode.window.showErrorMessage(vscode.l10n.t('Please open a .ditamap file first.'));
        return;
      }
      const mapPath = normalizeDriveLetter(mapUri.fsPath);
      const mapDir = dirname(mapPath);

      // 2. Detect DITA-OT
      const configPath: string | undefined = vscode.workspace.getConfiguration('dita-viewer').get('ditaOtPath');
      const configuredPath = configPath && configPath.trim() ? configPath.trim() : undefined;

      const result = resolveDitaOtExecutable({
        configuredPath,
        ditaHomeEnv: process.env.DITA_HOME,
        pathEnv: process.env.PATH,
        platform: process.platform,
        fileExists: (p: string) => existsSync(p),
      });

      if (!result.found) {
        if (result.reason === 'setting-invalid') {
          const openSettingsLabel = vscode.l10n.t('Open Settings');
          const action = await vscode.window.showErrorMessage(
            vscode.l10n.t('The configured DITA-OT path is invalid: no dita executable was found under {0}.', configuredPath ?? ''),
            openSettingsLabel,
          );
          if (action === openSettingsLabel) {
            vscode.commands.executeCommand('workbench.action.openSettings', 'dita-viewer.ditaOtPath');
          }
        } else {
          const viewInstructionsLabel = vscode.l10n.t('View Install Instructions');
          const action = await vscode.window.showErrorMessage(
            vscode.l10n.t('DITA-OT was not found. Please install DITA-OT or configure the DITA_HOME environment variable.'),
            viewInstructionsLabel,
          );
          if (action === viewInstructionsLabel) {
            vscode.env.openExternal(vscode.Uri.parse('https://www.dita-ot.org/documentation/installing'));
          }
        }
        return;
      }

      // 3. QuickPick transtype
      const TRANSTYPES = [
        { label: 'html5', description: vscode.l10n.t('HTML5 (default)') },
        { label: 'pdf', description: 'PDF' },
        { label: 'xhtml', description: 'XHTML' },
        { label: 'markdown', description: 'Markdown' },
      ];
      const selected = await vscode.window.showQuickPick(TRANSTYPES, {
        placeHolder: vscode.l10n.t('Select an output format (transtype)'),
      });
      if (!selected) return;
      const transtype = selected.label;

      // 4. Choose output directory
      const defaultDir = join(mapDir, 'out', transtype);
      const chosenUri = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        defaultUri: vscode.Uri.file(defaultDir),
        openLabel: vscode.l10n.t('Select Output Directory'),
      });
      const outputDir = normalizeDriveLetter(
        (chosenUri && chosenUri.length > 0) ? chosenUri[0].fsPath : defaultDir,
      );

      if (existsSync(outputDir)) {
        try {
          const entries = readdirSync(outputDir);
          if (entries.length > 0) {
            const overwriteLabel = vscode.l10n.t('Overwrite');
            const overwrite = await vscode.window.showWarningMessage(
              vscode.l10n.t('The output directory already exists and is not empty: {0}. Overwrite it?', outputDir),
              { modal: true },
              overwriteLabel,
            );
            if (overwrite !== overwriteLabel) return;
          }
        } catch (e) {
          console.warn(`Failed to check output directory contents: ${outputDir}`, e instanceof Error ? e.message : e);
        }
      }

      // 5. Pick optional CSS (html5/xhtml only)
      let cssArg: CssArg | undefined;
      if (transtype === 'html5' || transtype === 'xhtml') {
        const cssFiles = scanCssFiles(mapDir);
        if (cssFiles.length > 0) {
          const items: (vscode.QuickPickItem & { css?: CssArg })[] = [
            { label: `$(close) ${vscode.l10n.t('No custom CSS')}`, description: vscode.l10n.t('Use DITA-OT default styles'), css: undefined },
            ...cssFiles.map((fp) => ({
              label: `$(file) ${basename(fp)}`,
              description: dirname(fp),
              css: { filename: basename(fp), root: dirname(fp) } as CssArg,
            })),
          ];
          const picked = await vscode.window.showQuickPick(items, {
            placeHolder: vscode.l10n.t('Select a custom CSS file (optional)'),
            ignoreFocusOut: false,
          });
          if (picked && picked.css) cssArg = picked.css;
        }
      }

      // 6. Pick optional DITAVAL filter
      let ditavalFile: string | undefined;
      const ditavalUri = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { [vscode.l10n.t('DITAVAL Filter Files')]: ['ditaval'] },
        openLabel: vscode.l10n.t('Select Filter File'),
      });
      if (ditavalUri && ditavalUri.length > 0) {
        ditavalFile = normalizeDriveLetter(ditavalUri[0].fsPath);
      }

      // 7. Pick site chrome features (html5/xhtml only)
      let siteChromeFeatures: SiteChromeFeatures | undefined;
      if (transtype === 'html5' || transtype === 'xhtml') {
        const featureItems: (vscode.QuickPickItem & { key: keyof SiteChromeFeatures })[] = [
          { label: vscode.l10n.t('Navigation Toolbar'), description: vscode.l10n.t('Prev/Next page + collapsible sections'), key: 'navToolbar', picked: true },
          { label: vscode.l10n.t('Sidebar Outline'), description: vscode.l10n.t('Fixed table of contents on the left'), key: 'sidebar', picked: true },
          { label: vscode.l10n.t('On-This-Page'), description: vscode.l10n.t('Right-hand navigation for headings on the current page'), key: 'onPageToc', picked: true },
          { label: vscode.l10n.t('Copy-Code Button'), description: vscode.l10n.t('Copy button on code blocks'), key: 'copyCode', picked: true },
          { label: vscode.l10n.t('Back to Top'), description: vscode.l10n.t('Back-to-top button in the bottom-right corner'), key: 'backToTop', picked: true },
          { label: vscode.l10n.t('Dark Mode'), description: vscode.l10n.t('Light/dark theme toggle'), key: 'darkMode', picked: true },
        ];
        const picked = await vscode.window.showQuickPick(featureItems, {
          canPickMany: true,
          placeHolder: vscode.l10n.t('Select the site enhancements to enable (all enabled by default)'),
          ignoreFocusOut: false,
        });
        if (picked) {
          const features: SiteChromeFeatures = {
            navToolbar: false, sidebar: false, onPageToc: false,
            copyCode: false, backToTop: false, darkMode: false,
          };
          for (const item of picked) features[(item as { key: keyof SiteChromeFeatures }).key] = true;
          siteChromeFeatures = features;
        } else {
          // User cancelled: enable all by default (keep backward compatibility)
          siteChromeFeatures = {
            navToolbar: true, sidebar: true, onPageToc: true,
            copyCode: true, backToTop: true, darkMode: true,
          };
        }
      }

      // 8. Run transformation
      const args = buildDitaOtArgs({ mapPath, transtype, outputDir, cssArg, ditavalFile });
      const outputChannel = transformOutputChannel;
      outputChannel.clear();

      disposables.push({ dispose: () => tokenSource.dispose() });

      outputChannel.show(true);

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: vscode.l10n.t('DITA-OT: Transforming to {0} (the first run may take a while)', transtype),
          cancellable: true,
        },
        async (progress, cancellationToken) => {
          cancellationToken.onCancellationRequested(() => {
            if (!tokenSource.token.isCancellationRequested) {
              tokenSource.cancel();
            }
          });

          return new Promise<void>((resolvePromise, rejectPromise) => {
            // Windows batch files must run through cmd.exe; the spec quotes
            // every argument explicitly instead of using shell: true (which
            // concatenates args unquoted — space/metacharacter unsafe).
            const spec = buildDitaOtSpawnSpec(result.location.executablePath, args, process.platform);
            const child = spawn(spec.command, spec.args, {
              windowsVerbatimArguments: spec.windowsVerbatimArguments,
            });
            let cancelled = false;
            let killTimer: ReturnType<typeof setTimeout> | undefined;

            const cancelListener = tokenSource.token.onCancellationRequested(() => {
              cancelled = true;
              if (process.platform === 'win32' && child.pid) {
                // Kill the whole tree — terminating the cmd.exe wrapper alone
                // leaves the DITA-OT Java process running.
                try {
                  spawn('taskkill', ['/pid', String(child.pid), '/t', '/f']);
                } catch (e) {
                  console.warn('Failed to kill Windows process tree:', e instanceof Error ? e.message : e);
                }
              } else {
                child.kill('SIGTERM');
                // Give it a moment, then SIGKILL
                killTimer = setTimeout(() => {
                  try {
                    child.kill('SIGKILL');
                  } catch (e) {
                    console.warn('Failed to send SIGKILL:', e instanceof Error ? e.message : e);
                  }
                }, 3000);
              }
            });
            disposables.push(cancelListener);

            let errorCount = 0;
            const lineBuffer = createLineBuffer();

            child.stdout?.on('data', (data: Buffer) => {
              outputChannel.append(data.toString());
            });

            child.stderr?.on('data', (data: Buffer) => {
              const text = data.toString();
              outputChannel.append(text);
              const lines = lineBuffer.processChunk(text);
              for (const line of lines) {
                if (classifyLogLine(line) === 'error') errorCount++;
              }
            });

            child.on('error', (err) => {
              outputChannel.appendLine(vscode.l10n.t('\n[DITA-OT] Failed to start process: {0}', err.message));
              rejectPromise(err);
            });

            child.on('close', async (code) => {
              if (killTimer) clearTimeout(killTimer);
              // Process any remaining partial line in the buffer
              for (const line of lineBuffer.flush()) {
                if (classifyLogLine(line) === 'error') errorCount++;
              }

              if (cancelled) {
                outputChannel.appendLine(vscode.l10n.t('\n[DITA-OT] Transformation cancelled by user.'));
                resolvePromise(); // Resolve gracefully on cancel
                return;
              }

              if (code !== 0) {
                outputChannel.appendLine(vscode.l10n.t('\n[DITA-OT] Process exited with code: {0}', String(code)));
                outputChannel.appendLine(vscode.l10n.t('\n[DITA-OT] Command: {0} {1}', result.location.executablePath, args.join(' ')));
                rejectPromise(new Error(vscode.l10n.t('DITA-OT exit code: {0}', String(code))));
                return;
              }

              // Success
              outputChannel.appendLine(vscode.l10n.t('\n[DITA-OT] Transformation complete. Output directory: {0}', outputDir));

              // 9. Inject site chrome (features enabled via QuickPick during flow)
              if (transtype === 'html5' || transtype === 'xhtml') {
                try {
                  if (siteChromeFeatures) {
                    injectSiteChrome(extensionPath, mapPath, outputDir, siteChromeFeatures);
                    outputChannel.appendLine(vscode.l10n.t('\n[DITA-OT] Site enhancements injected.'));
                  }
                } catch (e) {
                  outputChannel.appendLine(vscode.l10n.t('\n[DITA-OT] Failed to inject site enhancements: {0}', String(e)));
                }
              }

              const errorSummary = errorCount > 0
                ? vscode.l10n.t(' ({0} error(s) detected)', String(errorCount))
                : '';

              // Resolve the progress promise FIRST so the progress notification
              // dismisses immediately, then show the info message.
              resolvePromise();

              if (transtype === 'html5') {
                const indexPath = join(outputDir, 'index.html');
                if (existsSync(indexPath)) {
                  const openInBrowserLabel = vscode.l10n.t('Open in Browser');
                  const action = await vscode.window.showInformationMessage(
                    vscode.l10n.t('DITA-OT transformation complete{0}', errorSummary),
                    openInBrowserLabel,
                  );
                  if (action === openInBrowserLabel) {
                    vscode.env.openExternal(vscode.Uri.file(indexPath));
                  }
                } else {
                  const revealLabel = vscode.l10n.t('Reveal in File Explorer');
                  const action = await vscode.window.showInformationMessage(
                    vscode.l10n.t('DITA-OT transformation complete{0}', errorSummary),
                    revealLabel,
                  );
                  if (action === revealLabel) {
                    vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outputDir));
                  }
                }
              } else {
                const revealLabel = vscode.l10n.t('Reveal in File Explorer');
                const action = await vscode.window.showInformationMessage(
                  vscode.l10n.t('DITA-OT transformation complete{0}', errorSummary),
                  revealLabel,
                );
                if (action === revealLabel) {
                  vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outputDir));
                }
              }
            });
          });
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const viewLogLabel = vscode.l10n.t('View Output Log');
      const action = await vscode.window.showErrorMessage(
        vscode.l10n.t('DITA-OT transformation failed: {0}', message),
        viewLogLabel,
      );
      if (action === viewLogLabel) {
        vscode.commands.executeCommand('workbench.action.output.toggleOutput');
      }
    } finally {
      for (const d of disposables) {
        try {
          d.dispose();
        } catch (e) {
          console.warn('Failed to dispose disposable:', e instanceof Error ? e.message : e);
        }
      }
    }
  });

  context.subscriptions.push(transformCommand);

  // Exposed via `vscode.extensions.getExtension(id).exports` so the
  // @vscode/test-electron integration suite can inspect rendered webview
  // content without VS Code providing a public API to read a custom
  // editor's WebviewPanel from outside its own provider. Not used by the
  // extension itself at runtime.
  //
  // ditaFileWatcherCounts is here for the same reason: whether N open panels
  // really do share one FileSystemWatcher per folder is not observable from
  // outside the extension host, and it is the whole claim of ditaFileWatcher.ts.
  return {
    _test: {
      getLastRenderedHtml: getLastRenderedHtmlForTesting,
      getLastRenderedMapHtml: getLastRenderedMapHtmlForTesting,
      ditaFileWatcherCounts,
    },
  };
}

// ── Site chrome injection ──

function injectSiteChrome(
  extPath: string,
  mapPath: string,
  outputDir: string,
  features: SiteChromeFeatures,
): void {
  const manifest = buildNavManifest(mapPath);
  const jsTemplate = readFileSync(join(extPath, 'media', 'transform-assets', 'site-chrome.js'), 'utf-8');
  const js = jsTemplate
    .replace('/* __DV_MANIFEST__ */', JSON.stringify(manifest))
    .replace('/* __DV_FEATURES__ */', JSON.stringify(features));
  writeFileSync(join(outputDir, 'dita-viewer-chrome.js'), js, 'utf-8');

  const css = readFileSync(join(extPath, 'media', 'transform-assets', 'site-chrome.css'), 'utf-8');
  writeFileSync(join(outputDir, 'dita-viewer-chrome.css'), css, 'utf-8');

  const hasDark = features.darkMode;
  if (hasDark) {
    const darkCss = readFileSync(join(extPath, 'media', 'transform-assets', 'dark-mode.css'), 'utf-8');
    writeFileSync(join(outputDir, 'dita-viewer-dark.css'), darkCss, 'utf-8');
  }

  // Walk all HTML files (including index.html) and inject link+script tags
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      try {
        if (statSync(full).isDirectory()) { walk(full); continue; }
      } catch { continue; }
      if (!entry.toLowerCase().endsWith('.html')) continue;
      let html = readFileSync(full, 'utf-8');
      if (html.includes('dita-viewer-chrome')) continue;

      const rel = full.substring(outputDir.length).replace(/\\/g, '/');
      const depth = rel.replace(/^\/+/, '').split('/').length - 1;
      const prefix = depth > 0 ? '../'.repeat(depth) : '';

      // Insert CSS link before </head>, script before </body>
      const cssLink = '<link rel="stylesheet" type="text/css" href="' + prefix + 'dita-viewer-chrome.css">';
      html = html.replace('</head>', cssLink + '</head>');

      if (hasDark) {
        const darkLink = '<link rel="stylesheet" type="text/css" href="' + prefix + 'dita-viewer-dark.css">';
        html = html.replace('</head>', darkLink + '</head>');
      }

      html = html.replace('</body>', '<script src="' + prefix + 'dita-viewer-chrome.js"></script></body>');
      writeFileSync(full, html, 'utf-8');
    }
  }
  walk(outputDir);
}

// ── CSS file scanning for transform ──

function scanCssFiles(mapDir: string): string[] {
  const files = new Map<string, string>();
  const dirs = new Set<string>();

  dirs.add(mapDir);

  const root =
    vscode.workspace.getWorkspaceFolder(vscode.Uri.file(mapDir))?.uri.fsPath ??
    vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
  if (root && root !== mapDir) dirs.add(root);

  try {
    const cfgDirs: string[] | undefined =
      vscode.workspace.getConfiguration('dita-viewer').get('cssDirectory');
    if (cfgDirs) {
      for (const d of cfgDirs) {
        const abs = isAbsolute(d) ? d : resolve(mapDir, d);
        if (existsSync(abs)) dirs.add(abs);
      }
    }
  } catch (e) {
    console.warn('Failed to read CSS directory configuration:', e instanceof Error ? e.message : e);
  }

  for (const d of dirs) {
    try {
      for (const entry of readdirSync(d)) {
        if (entry.toLowerCase().endsWith('.css') && !files.has(entry)) {
          files.set(entry, join(d, entry));
        }
      }
    } catch (e) {
      console.warn(`Failed to read CSS directory ${d}:`, e instanceof Error ? e.message : e);
    }
  }

  try {
    const customPaths: string[] | undefined =
      vscode.workspace.getConfiguration('dita-viewer').get('customCss');
    if (customPaths) {
      for (const p of customPaths) {
        const abs = isAbsolute(p) ? p : resolve(mapDir, p);
        if (existsSync(abs) && !files.has(basename(abs))) {
          files.set(basename(abs), abs);
        }
      }
    }
  } catch (e) {
    console.warn('Failed to read custom CSS configuration:', e instanceof Error ? e.message : e);
  }

  return [...files.values()];
}

function normalizeDriveLetter(p: string): string {
  if (process.platform === 'win32' && /^[a-z]:/.test(p)) {
    return p[0].toUpperCase() + p.slice(1);
  }
  return p;
}

async function resolveMapFile(): Promise<vscode.Uri | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;

  const docUri = editor.document.uri;
  if (docUri.fsPath.toLowerCase().endsWith('.ditamap')) {
    return docUri;
  }

  if (docUri.fsPath.toLowerCase().endsWith('.dita')) {
    const maps = findDitamapFiles(docUri);
    if (maps.length === 0) return undefined;

    if (maps.length === 1) {
      return vscode.Uri.file(maps[0]);
    }

    const items = maps.map((m) => ({
      label: m,
      description: vscode.l10n.t('Associated DITA Map'),
    }));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: vscode.l10n.t('Multiple DITA Map files found — select the one to use:'),
    });
    return picked ? vscode.Uri.file(picked.label) : undefined;
  }

  return undefined;
}

// Module-level caches in DitaViewerProvider/MapViewerProvider/ditaRenderUtils
// are already self-bounded (keyMapCache and imageDimensionsCache have hard
// entry caps, and the book-mode topic render cache has a byte budget; the
// per-panel render caches are cleaned as each webview panel disposes -- see
// each provider's onDidDispose), so this isn't fixing a leak. It's a
// defensive reset for the case VS Code deactivates the extension without
// disposing every panel first (window close, extension host restart, manual
// disable), so nothing from this session's caches lingers into whatever runs
// next in the same process. The topic render cache is the one that outlives
// panels deliberately -- reuse across two panels showing the same book is
// part of what makes it worth having -- so deactivation is what clears it.
export function deactivate(): void {
  clearAllCaches();
  clearMapCache();
}
