// "Find Unreferenced Resources" (ditaViewer.findUnreferencedResources).
//
// From a menu or toolbar on a map it just runs: that map, its folder, the
// filters from settings. From the Command Palette it first offers two quick
// picks (maps, then folders) with the active map and its folder checked, so
// the usual case is Enter, Enter. Results land in the Map Checks view, where
// "Change Maps and Folders…" and "Run Again" are one click away. Filters are
// ordinary settings (dita-viewer.unreferencedResources.*).

import * as vscode from 'vscode';
import { dirname } from 'path';
import {
  UnreferencedFilters,
  findUnreferencedResources,
  normalizeFilters,
} from './unreferencedResources';
import {
  MapCheckDeps,
  PickManyItem,
  activeMapPath,
  browseFiles,
  browseFolders,
  listHost,
  makeHost,
  mapFromArg,
  pickMany,
} from './mapCheckShared';
import { MapChecksView } from './mapCheckResultsView';

const FIND_CMD = 'ditaViewer.findUnreferencedResources';
const SETTINGS = 'dita-viewer.unreferencedResources';

interface Scope {
  maps: string[];
  folders: string[];
}

let lastScope: Scope | undefined;

export function readFilters(): UnreferencedFilters {
  const cfg = vscode.workspace.getConfiguration(SETTINGS);
  return normalizeFilters({
    includeFiles: cfg.get<string>('includeFiles'),
    excludeFiles: cfg.get<string>('excludeFiles'),
    excludeFolders: cfg.get<string>('excludeFolders'),
  });
}

const relLabel = (p: string): string => vscode.workspace.asRelativePath(p, true);

function item(value: string, picked: boolean, description?: string): PickManyItem {
  return { value, label: relLabel(value), description, picked };
}

async function workspaceMaps(): Promise<string[]> {
  const found = await vscode.workspace.findFiles('**/*.ditamap', '**/{node_modules,.git,out,temp}/**', 200);
  return found.map((u) => u.fsPath).sort((a, b) => a.localeCompare(b));
}

/** Step 1: which maps. Step 2: which folders. Both start from `initial`. */
async function pickScope(initial: Scope | undefined, hintMap: string | undefined): Promise<Scope | undefined> {
  const preMaps = initial?.maps ?? (hintMap ? [hintMap] : []);
  const known = new Set(preMaps);
  const mapItems = [
    ...preMaps.map((m) => item(m, true)),
    ...(await workspaceMaps()).filter((m) => !known.has(m)).map((m) => item(m, false)),
  ];
  const maps = await pickMany({
    title: vscode.l10n.t('Find Unreferenced Resources — DITA maps (1/2)'),
    placeholder: vscode.l10n.t('Select the maps whose references count; files they do not reach are reported'),
    items: mapItems,
    browse: {
      tooltip: vscode.l10n.t('Browse for maps…'),
      run: async () => (await browseFiles(vscode.l10n.t('DITA Maps'), ['ditamap'], true)).map((p) => item(p, true)),
    },
  });
  if (!maps) return undefined;
  if (maps.length === 0) {
    void vscode.window.showWarningMessage(vscode.l10n.t('Select at least one DITA map.'));
    return undefined;
  }

  const f = readFilters();
  const preFolders = initial?.folders?.length ? initial.folders : maps.map((m) => dirname(m));
  const folderSet = new Set(preFolders);
  const extra = [
    ...maps.map((m) => dirname(m)),
    ...(vscode.workspace.workspaceFolders ?? []).map((w) => w.uri.fsPath),
  ].filter((d, i, all) => !folderSet.has(d) && all.indexOf(d) === i);
  const folders = await pickMany({
    title: vscode.l10n.t('Find Unreferenced Resources — folders to check (2/2)'),
    placeholder: vscode.l10n.t('Filters: include {0} · exclude files {1} · exclude folders {2}', f.includeFiles, f.excludeFiles, f.excludeFolders),
    items: [...[...folderSet].map((d) => item(d, true)), ...extra.map((d) => item(d, false))],
    browse: { tooltip: vscode.l10n.t('Browse for folders…'), run: async () => (await browseFolders(vscode.l10n.t('Select Folders'))).map((p) => item(p, true)) },
    buttons: [
      {
        icon: 'gear',
        tooltip: vscode.l10n.t('Edit filters in Settings'),
        run: () => void vscode.commands.executeCommand('workbench.action.openSettings', SETTINGS),
      },
    ],
  });
  if (!folders) return undefined;
  if (folders.length === 0) {
    void vscode.window.showWarningMessage(vscode.l10n.t('Select at least one folder.'));
    return undefined;
  }
  return { maps, folders };
}

async function run(view: MapChecksView, scope: Scope): Promise<void> {
  lastScope = scope;
  const filters = readFilters();
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Finding unreferenced resources…'), cancellable: true },
    async (_progress, token) => {
      try {
        const res = await findUnreferencedResources({ maps: scope.maps, folders: scope.folders, filters }, makeHost(token), listHost);
        if (token.isCancellationRequested) return;
        view.setUnreferenced({
          maps: scope.maps,
          folders: scope.folders,
          scanned: res.scanned,
          files: res.unreferenced,
          unreadable: res.crawl.fileIssues.filter((i) => !i.structural).length,
        });
        await view.reveal();
      } catch (err) {
        void vscode.window.showErrorMessage(vscode.l10n.t('Search failed: {0}', err instanceof Error ? err.message : String(err)));
      }
    },
  );
}

export function registerUnreferencedResourcesCommand(
  context: vscode.ExtensionContext,
  deps: MapCheckDeps,
  view: MapChecksView,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(FIND_CMD, async (arg?: unknown) => {
      const direct = mapFromArg(arg);
      if (direct) return run(view, { maps: [direct], folders: [dirname(direct)] });
      const scope = await pickScope(view.lastUnreferenced ?? lastScope, activeMapPath(deps));
      if (scope) await run(view, scope);
    }),
    vscode.commands.registerCommand('ditaViewer.mapChecks.rerunUnreferenced', async () => {
      const last = view.lastUnreferenced;
      if (last) await run(view, { maps: last.maps, folders: last.folders });
    }),
    vscode.commands.registerCommand('ditaViewer.mapChecks.changeUnreferenced', async () => {
      const scope = await pickScope(view.lastUnreferenced ?? lastScope, activeMapPath(deps));
      if (scope) await run(view, scope);
    }),
  );
}
