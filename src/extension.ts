import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { basename, dirname, isAbsolute, join, resolve } from 'path';
import { DitaViewerProvider, findDitamapFiles, getLastRenderedHtmlForTesting } from './editor/DitaViewerProvider';
import { MapViewerProvider, getLastRenderedMapHtmlForTesting } from './editor/MapViewerProvider';
import {
  resolveDitaOtExecutable,
  buildDitaOtArgs,
  buildNavManifest,
  classifyLogLine,
  createLineBuffer,
  CssArg,
  SiteChromeFeatures,
} from './editor/ditaOtUtils';

const TRANSFORM_CMD = 'ditaViewer.transformWithDitaOt';

export function activate(context: vscode.ExtensionContext) {
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

  const showRenderedCommand = vscode.commands.registerCommand(
    'ditaViewer.showRendered',
    () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      vscode.commands.executeCommand(
        'vscode.openWith',
        editor.document.uri,
        'ditaViewer.preview',
          vscode.ViewColumn.Beside,
      );
    },
  );

  context.subscriptions.push(showRenderedCommand);

  const showMapRenderedCommand = vscode.commands.registerCommand(
    'ditaViewer.showMapRendered',
    () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      vscode.commands.executeCommand(
        'vscode.openWith',
        editor.document.uri,
        'ditaViewer.mapPreview',
          vscode.ViewColumn.Beside,
      );
    },
  );

  context.subscriptions.push(showMapRenderedCommand);

  // DITA-OT transform command
  const extensionPath = context.extensionPath;
  const transformCommand = vscode.commands.registerCommand(TRANSFORM_CMD, async () => {
    const tokenSource = new vscode.CancellationTokenSource();
    const disposables: vscode.Disposable[] = [];

    try {
      // 1. Determine input map file
      const mapUri = await resolveMapFile();
      if (!mapUri) {
        vscode.window.showErrorMessage('请先打开一个 .ditamap 文件。');
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
          const action = await vscode.window.showErrorMessage(
            `配置的 DITA-OT 路径无效：${configuredPath} 下未找到 dita 可执行文件。`,
            '打开设置',
          );
          if (action === '打开设置') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'dita-viewer.ditaOtPath');
          }
        } else {
          const action = await vscode.window.showErrorMessage(
            '未找到 DITA-OT。请安装 DITA-OT 或配置 DITA_HOME 环境变量。',
            '查看安装说明',
          );
          if (action === '查看安装说明') {
            vscode.env.openExternal(vscode.Uri.parse('https://www.dita-ot.org/documentation/installing'));
          }
        }
        return;
      }

      // 3. QuickPick transtype
      const TRANSTYPES = [
        { label: 'html5', description: 'HTML5 (默认)' },
        { label: 'pdf', description: 'PDF' },
        { label: 'xhtml', description: 'XHTML' },
        { label: 'markdown', description: 'Markdown' },
      ];
      const selected = await vscode.window.showQuickPick(TRANSTYPES, {
        placeHolder: '选择输出格式（transtype）',
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
        openLabel: '选择输出目录',
      });
      const outputDir = normalizeDriveLetter(
        (chosenUri && chosenUri.length > 0) ? chosenUri[0].fsPath : defaultDir,
      );

      if (existsSync(outputDir)) {
        try {
          const entries = readdirSync(outputDir);
          if (entries.length > 0) {
            const overwrite = await vscode.window.showWarningMessage(
              `输出目录已存在且非空：${outputDir}。是否覆盖？`,
              { modal: true },
              '覆盖',
            );
            if (overwrite !== '覆盖') return;
          }
        } catch {}
      }

      // 5. Pick optional CSS (html5/xhtml only)
      let cssArg: CssArg | undefined;
      if (transtype === 'html5' || transtype === 'xhtml') {
        const cssFiles = scanCssFiles(mapDir);
        if (cssFiles.length > 0) {
          const items: (vscode.QuickPickItem & { css?: CssArg })[] = [
            { label: '$(close) 不添加自定义 CSS', description: '使用 DITA-OT 默认样式', css: undefined },
            ...cssFiles.map((fp) => ({
              label: `$(file) ${basename(fp)}`,
              description: dirname(fp),
              css: { filename: basename(fp), root: dirname(fp) } as CssArg,
            })),
          ];
          const picked = await vscode.window.showQuickPick(items, {
            placeHolder: '选择自定义 CSS 文件（可选）',
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
        filters: { 'DITAVAL 筛选文件': ['ditaval'] },
        openLabel: '选择筛选文件',
      });
      if (ditavalUri && ditavalUri.length > 0) {
        ditavalFile = normalizeDriveLetter(ditavalUri[0].fsPath);
      }

      // 7. Pick site chrome features (html5/xhtml only)
      let siteChromeFeatures: SiteChromeFeatures | undefined;
      if (transtype === 'html5' || transtype === 'xhtml') {
        const featureItems: (vscode.QuickPickItem & { key: keyof SiteChromeFeatures })[] = [
          { label: '导航工具栏', description: '上一页/下一页 + 折叠/展开章节', key: 'navToolbar', picked: true },
          { label: '侧边栏目录', description: '左侧固定目录树', key: 'sidebar', picked: true },
          { label: '本页目录', description: '右侧本页标题导航', key: 'onPageToc', picked: true },
          { label: '代码复制按钮', description: '代码块复制按钮', key: 'copyCode', picked: true },
          { label: '回到顶部', description: '右下角回到顶部按钮', key: 'backToTop', picked: true },
          { label: '暗色模式', description: '亮色/暗色切换', key: 'darkMode', picked: true },
        ];
        const picked = await vscode.window.showQuickPick(featureItems, {
          canPickMany: true,
          placeHolder: '选择要启用的站点增强功能（默认全部启用）',
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
      const outputChannel = vscode.window.createOutputChannel('DITA-OT Transform');

      disposables.push(
        vscode.Disposable.from(
          { dispose: () => outputChannel.dispose() },
          { dispose: () => tokenSource.dispose() },
        ),
      );

      outputChannel.show(true);

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `DITA-OT: 正在转换为 ${transtype}（首次转换可能需要较长时间）`,
          cancellable: true,
        },
        async (progress, cancellationToken) => {
          cancellationToken.onCancellationRequested(() => {
            if (!tokenSource.token.isCancellationRequested) {
              tokenSource.cancel();
            }
          });

          return new Promise<void>((resolvePromise, rejectPromise) => {
            // On Windows, batch files (.bat) require shell: true to execute reliably,
            // otherwise spawn can fail with EINVAL when paths contain spaces.
            const isWin = process.platform === 'win32';
            const child = spawn(result.location.executablePath, args, { shell: isWin });
            let cancelled = false;

            const cancelListener = tokenSource.token.onCancellationRequested(() => {
              cancelled = true;
              child.kill('SIGTERM');
              // Give it a moment, then SIGKILL
              setTimeout(() => {
                try { child.kill('SIGKILL'); } catch {}
              }, 3000);
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
              outputChannel.appendLine(`\n[DITA-OT] 进程启动失败: ${err.message}`);
              rejectPromise(err);
            });

            child.on('close', async (code) => {
              // Process any remaining partial line in the buffer
              for (const line of lineBuffer.flush()) {
                if (classifyLogLine(line) === 'error') errorCount++;
              }

              if (cancelled) {
                outputChannel.appendLine(`\n[DITA-OT] 转换已被用户取消。`);
                resolvePromise(); // Resolve gracefully on cancel
                return;
              }

              if (code !== 0) {
                outputChannel.appendLine(`\n[DITA-OT] 进程退出，退出码: ${code}`);
                outputChannel.appendLine(`\n[DITA-OT] 命令: ${result.location.executablePath} ${args.join(' ')}`);
                rejectPromise(new Error(`DITA-OT 退出码: ${code}`));
                return;
              }

              // Success
              outputChannel.appendLine(`\n[DITA-OT] 转换完成。输出目录: ${outputDir}`);

              // 8. Inject site chrome (features enabled via QuickPick during flow)
              if (transtype === 'html5' || transtype === 'xhtml') {
                try {
                  if (siteChromeFeatures) {
                    injectSiteChrome(extensionPath, mapPath, outputDir, siteChromeFeatures);
                    outputChannel.appendLine(`\n[DITA-OT] 站点增强已注入。`);
                  }
                } catch (e) {
                  outputChannel.appendLine(`\n[DITA-OT] 站点增强注入失败: ${e}`);
                }
              }

              const errorSummary = errorCount > 0
                ? `（检测到 ${errorCount} 个错误）`
                : '';

              if (transtype === 'html5') {
                const indexPath = join(outputDir, 'index.html');
                if (existsSync(indexPath)) {
                  const action = await vscode.window.showInformationMessage(
                    `DITA-OT 转换完成${errorSummary}`,
                    '在浏览器中打开',
                  );
                  if (action === '在浏览器中打开') {
                    vscode.env.openExternal(vscode.Uri.file(indexPath));
                  }
                } else {
                  const action = await vscode.window.showInformationMessage(
                    `DITA-OT 转换完成${errorSummary}`,
                    '在文件管理器中显示',
                  );
                  if (action === '在文件管理器中显示') {
                    vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outputDir));
                  }
                }
              } else {
                const action = await vscode.window.showInformationMessage(
                  `DITA-OT 转换完成${errorSummary}`,
                  '在文件管理器中显示',
                );
                if (action === '在文件管理器中显示') {
                  vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outputDir));
                }
              }

              resolvePromise();
            });
          });
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const action = await vscode.window.showErrorMessage(
        `DITA-OT 转换失败: ${message}`,
        '查看输出日志',
      );
      if (action === '查看输出日志') {
        vscode.commands.executeCommand('workbench.action.output.toggleOutput');
      }
    } finally {
      for (const d of disposables) {
        try { d.dispose(); } catch {}
      }
    }
  });

  context.subscriptions.push(transformCommand);

  // Exposed via `vscode.extensions.getExtension(id).exports` so the
  // @vscode/test-electron integration suite can inspect rendered webview
  // content without VS Code providing a public API to read a custom
  // editor's WebviewPanel from outside its own provider. Not used by the
  // extension itself at runtime.
  return {
    _test: {
      getLastRenderedHtml: getLastRenderedHtmlForTesting,
      getLastRenderedMapHtml: getLastRenderedMapHtmlForTesting,
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
  } catch {}

  for (const d of dirs) {
    try {
      for (const entry of readdirSync(d)) {
        if (entry.toLowerCase().endsWith('.css') && !files.has(entry)) {
          files.set(entry, join(d, entry));
        }
      }
    } catch {}
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
  } catch {}

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
  if (docUri.fsPath.endsWith('.ditamap')) {
    return docUri;
  }

  if (docUri.fsPath.endsWith('.dita')) {
    const maps = findDitamapFiles(docUri);
    if (maps.length === 0) return undefined;

    if (maps.length === 1) {
      return vscode.Uri.file(maps[0]);
    }

    const items = maps.map((m) => ({
      label: m,
      description: '选择关联的 DITA Map',
    }));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: '找到多个 DITA Map 文件，请选择要使用的：',
    });
    return picked ? vscode.Uri.file(picked.label) : undefined;
  }

  return undefined;
}
