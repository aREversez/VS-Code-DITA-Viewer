import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { registerSourceOverlay } from './editor/sourceOverlayFeed';
import { registerSourceEditorTracker } from './editor/sourceEditorOpener';
import { DitaViewerProvider, getLastRenderedHtmlForTesting, clearAllCaches } from './editor/DitaViewerProvider';
import { MapViewerProvider, getLastRenderedMapHtmlForTesting, clearMapCache } from './editor/MapViewerProvider';
import { registerLanguageFeatures } from './language/ditaLanguageFeatures';
import { registerMapTreeView } from './language/ditaMapTreeProvider';
import { ditaFileWatcherCounts } from './editor/ditaFileWatcher';
import { registerExportHtmlCommand, getActiveDitaUri } from './editor/exportHtml';
import { registerCompareCommand, getLastDiffHtmlForTesting, openSourceDiffForTesting } from './editor/ditaDiffProvider';
import { resolveOxygenLaunch, buildOxygenSpawnArgs } from './editor/oxygenLauncher';
import { registerWrapSelectionCommand } from './editor/wrapSelectionCommand';
import { registerFindReferencingMapsCommand } from './editor/findDitaReferences';
import { registerKeyContextCommand } from './editor/keyContextCommand';
import { registerUnreferencedResourcesCommand } from './editor/unreferencedResourcesUi';
import { registerCompletenessCommand } from './editor/completenessCheckUi';
import { registerRefRenameParticipant, computeRenameEditsForTesting } from './editor/refRenameParticipant';
import { ensureCommandAllowed } from './editor/workspaceTrustGate';
import { registerTransformCommand } from './transformCommand';


export function activate(context: vscode.ExtensionContext) {
  // Unsaved editor text into the sources the previews read (sourceText.ts).
  // First, so it is in place before anything can render.
  registerSourceOverlay(context);

  // Remembers which tab group was active last, for "open source" in docsite mode.
  registerSourceEditorTracker(context);

  // Key context map (Oxygen's DITA Maps Manager "context"): restored before
  // anything can render, so the first key resolution already follows it.
  registerKeyContextCommand(context);

  // Language features: go-to-definition, completion, outline symbols,
  // broken-reference diagnostics (items shared by .dita and .ditamap)
  registerLanguageFeatures(context);

  // Update href/conref references when DITA files are renamed or moved
  registerRefRenameParticipant(context);

  // Explorer sidebar tree view of the active DITA map
  const mapTree = registerMapTreeView(context);

  // "Find Unreferenced Resources…" (Oxygen DITA Maps Manager style)
  registerUnreferencedResourcesCommand(context, { currentTreeMap: () => mapTree.currentMapPath() });

  // "Validate and Check for Completeness…" (Oxygen DITA Map Completeness Check style)
  registerCompletenessCommand(context, { currentTreeMap: () => mapTree.currentMapPath() });

  // "Export as HTML" command (self-contained file, no DITA-OT needed)
  registerExportHtmlCommand(context);

  // "Compare with Git Version" — rendered diff view for .dita files
  registerCompareCommand(context);

  // Oxygen-style "select text, press Enter, pick a tag to wrap it in"
  registerWrapSelectionCommand(context);

  // "Open with Oxygen" — hands the file to Oxygen XML Editor
  context.subscriptions.push(
    vscode.commands.registerCommand('ditaViewer.openWithOxygen', async (uri?: vscode.Uri) => {
      // Untrusted workspaces never spawn Oxygen (mapExplorer.openWithOxygen
      // delegates here, so both row and editor/explorer entries are covered).
      if (!(await ensureCommandAllowed('ditaViewer.openWithOxygen'))) return;
      const target = uri ?? getActiveDitaUri();
      if (!target) {
        vscode.window.showErrorMessage(vscode.l10n.t('Please open a .dita or .ditamap file first.'));
        return;
      }

      const configPath: string | undefined = vscode.workspace.getConfiguration('dita-viewer').get('oxygenPath');
      const configuredPath = configPath && configPath.trim() ? configPath.trim() : undefined;

      const result = resolveOxygenLaunch({
        configuredPath,
        platform: process.platform,
        pathEnv: process.env.PATH,
        fileExists: (p) => existsSync(p),
      });

      if (!result.found) {
        const openSettingsLabel = vscode.l10n.t('Open Settings');
        const message =
          result.reason === 'setting-invalid'
            ? vscode.l10n.t('The configured Oxygen XML Editor path is invalid: {0}', configuredPath ?? '')
            : vscode.l10n.t('Oxygen XML Editor was not found. Please configure its path in settings.');
        const action = await vscode.window.showErrorMessage(message, openSettingsLabel);
        if (action === openSettingsLabel) {
          vscode.commands.executeCommand('workbench.action.openSettings', 'dita-viewer.oxygenPath');
        }
        return;
      }

      const spawnArgs = buildOxygenSpawnArgs(result.spec, target.fsPath);
      try {
        const child = spawn(spawnArgs.command, spawnArgs.args, { detached: true, stdio: 'ignore' });
        child.on('error', (err) => {
          vscode.window.showErrorMessage(vscode.l10n.t('Failed to launch Oxygen XML Editor: {0}', err.message));
        });
        child.unref();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(vscode.l10n.t('Failed to launch Oxygen XML Editor: {0}', message));
      }
    }),
  );

  // "Find Maps Referencing This File…" — reverse lookup of a topicref/mapref
  registerFindReferencingMapsCommand(context);

  // "Reveal in Map Navigator" — the file-Explorer-to-mapExplorer direction
  // of the pair completed by the tree's own "Reveal in Explorer" row command.
  context.subscriptions.push(
    vscode.commands.registerCommand('ditaViewer.revealInMapExplorer', async (uri?: vscode.Uri) => {
      const target = uri ?? getActiveDitaUri();
      if (!target) {
        vscode.window.showErrorMessage(vscode.l10n.t('Please open a .dita or .ditamap file first.'));
        return;
      }
      const revealed = await mapTree.revealPath(target.fsPath);
      if (!revealed) {
        vscode.window.showInformationMessage(
          vscode.l10n.t('This file is not part of the DITA map currently shown in the navigator.'),
        );
      }
    }),
  );

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

  registerTransformCommand(context);

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
      getLastDiffHtml: getLastDiffHtmlForTesting,
      ditaFileWatcherCounts,
      // Font-size/typeface and page-width preferences are read from
      // globalState at render time (FONT_PREFS_KEY, WIDTH_SELECTION_KEY in
      // DitaViewerProvider.ts) and there is no command or webview click the
      // harness can use to set them from outside -- @vscode/test-electron
      // cannot reach into a webview to operate its toolbar. Exposing the
      // Memento directly lets a test set a preference and then open a
      // preview to check the bootstrap script it renders, rather than only
      // being able to assert the default.
      globalState: context.globalState,
      // The rename participant's edits are only ever applied by VS Code for a
      // user-initiated Explorer rename (fs.rename fires no participant event and
      // applyEdit drops its returned edits), so the integration suite cannot
      // drive the full apply path headlessly. This seam runs the participant's
      // real candidate gathering (findFiles + disk) and edit computation for a
      // given rename and returns each affected file's post-edit content, which
      // is what the suite asserts against.
      computeRenameEdits: computeRenameEditsForTesting,
      // Reproduces the webview "Open source diff" button's exact production
      // path (register the virtual-doc provider, then vscode.diff over two
      // .dita-scheme URIs) so the integration suite can confirm the native
      // diff editor opens instead of the ditaViewer.preview custom editor.
      openSourceDiffForTesting: (input: { leftXml: string; rightXml: string; leftLabel: string; rightLabel: string; docUri: vscode.Uri }) =>
        openSourceDiffForTesting(context, input),
    },
  };
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
