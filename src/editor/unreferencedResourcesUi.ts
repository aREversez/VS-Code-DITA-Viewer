// "Find Unreferenced Resources" (ditaViewer.findUnreferencedResources).
//
// The command scans first (crawl the maps, list the files), then asks in the
// open where to look, with the answer pre-filled:
//   1. Folders -- a checklist of the map's folders and the folders its images
//      live in, each with "N unreferenced of M". The folders that hold the
//      files the maps actually reference are checked, so scripts, styles and
//      notes next to the map are left out unless asked for.
//   2. File types -- only when several kinds turned up: images, media, PDFs
//      and DITA files are checked; py/css/js and the like are not. The choice
//      is remembered.
// Findings go to the Problems panel (a warning per file, which also marks the
// files and their folders in the Explorer) and a notification offers to show
// them or copy the list.

import * as vscode from 'vscode';
import { basename, dirname } from 'path';
import {
  FolderStat,
  RememberedExtensions,
  UnreferencedFilters,
  defaultCheckedExtensions,
  extensionOf,
  filesUnder,
  folderStats,
  listFilteredFiles,
  mergeRoots,
  normalizeFilters,
  referencedPaths,
  referencedResourceFolders,
  rememberExtensions,
  suggestFolders,
  summarizeExtensions,
} from './unreferencedResources';
import { CrawlResult, crawlMaps } from './mapCrawl';
import { computeUnreferencedFiles } from './mapReferenceTools';
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

const FIND_CMD = 'ditaViewer.findUnreferencedResources';
const SETTINGS = 'dita-viewer.unreferencedResources';
const TYPES_KEY = 'ditaViewer.unreferencedExtensions';
const STATS_DEPTH = 3;

let collection: vscode.DiagnosticCollection | undefined;

export function clearUnreferencedResults(): void {
  collection?.clear();
}

export function readFilters(): UnreferencedFilters {
  const cfg = vscode.workspace.getConfiguration(SETTINGS);
  return normalizeFilters({
    includeFiles: cfg.get<string>('includeFiles'),
    excludeFiles: cfg.get<string>('excludeFiles'),
    excludeFolders: cfg.get<string>('excludeFolders'),
  });
}

const relLabel = (p: string): string => vscode.workspace.asRelativePath(p, true);
const mapsLabel = (maps: string[]): string =>
  maps.length === 1 ? basename(maps[0]) : vscode.l10n.t('{0} maps', String(maps.length));

// ── Scan ────────────────────────────────────────────────────────────────

interface Scan {
  maps: string[];
  crawl: CrawlResult;
  referenced: Set<string>;
  files: string[];
  unreferenced: string[];
  stats: FolderStat[];
  suggested: string[];
}

/** Adds the files under `dir` to a scan (a folder the user browsed to). */
async function addFolder(scan: Scan, dir: string, token: vscode.CancellationToken): Promise<void> {
  const host = makeHost(token);
  const have = new Set(scan.files);
  const fresh = (await listFilteredFiles(dir, listHost, readFilters(), host.cancelled)).filter((f) => !have.has(f));
  const referenced = [...scan.referenced];
  scan.files.push(...fresh);
  scan.unreferenced.push(...computeUnreferencedFiles(fresh, referenced, host.platform));
  const roots = mergeRoots([...scan.stats.map((s) => s.dir), dir]);
  const stats = new Map(scan.stats.map((s) => [s.dir, s]));
  for (const s of folderStats(scan.files, scan.unreferenced, roots, STATS_DEPTH)) stats.set(s.dir, s);
  scan.stats = [...stats.values()].sort((a, b) => a.dir.localeCompare(b.dir));
}

async function scanMaps(maps: string[]): Promise<Scan | undefined> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t('Scanning {0}…', mapsLabel(maps)),
      cancellable: true,
    },
    async (_progress, token) => {
      try {
        const host = makeHost(token);
        const crawl = await crawlMaps(maps, host);
        const referenced = new Set(referencedPaths(crawl));
        const resourceFolders = referencedResourceFolders(crawl);
        const mapDirs = maps.map((m) => dirname(m));
        const roots = mergeRoots([...mapDirs, ...resourceFolders]);
        const filters = readFilters();
        const files: string[] = [];
        const seen = new Set<string>();
        for (const root of roots) {
          for (const f of await listFilteredFiles(root, listHost, filters, host.cancelled)) {
            if (!seen.has(f)) {
              seen.add(f);
              files.push(f);
            }
          }
        }
        if (token.isCancellationRequested) return undefined;
        const unreferenced = computeUnreferencedFiles(files, referenced, host.platform);
        const stats = folderStats(files, unreferenced, roots, STATS_DEPTH);
        return { maps, crawl, referenced, files, unreferenced, stats, suggested: suggestFolders(stats, resourceFolders, mapDirs) };
      } catch (err) {
        void vscode.window.showErrorMessage(vscode.l10n.t('Search failed: {0}', err instanceof Error ? err.message : String(err)));
        return undefined;
      }
    },
  );
}

// ── Pickers ─────────────────────────────────────────────────────────────

function folderItem(stat: FolderStat, picked: boolean): PickManyItem {
  return {
    value: stat.dir,
    label: relLabel(stat.dir) || basename(stat.dir),
    description:
      stat.unreferenced === 0
        ? vscode.l10n.t('all {0} referenced', String(stat.total))
        : vscode.l10n.t('{0} unreferenced of {1}', String(stat.unreferenced), String(stat.total)),
    iconPath: vscode.ThemeIcon.Folder,
    picked,
  };
}

async function chooseMaps(current: string[]): Promise<string[] | undefined> {
  const found = await vscode.workspace.findFiles('**/*.ditamap', '**/{node_modules,.git,out,temp}/**', 200);
  const known = new Set(current);
  const items: PickManyItem[] = [
    ...current.map((m) => ({ value: m, label: relLabel(m), picked: true })),
    ...found.map((u) => u.fsPath).filter((m) => !known.has(m)).sort((a, b) => a.localeCompare(b)).map((m) => ({ value: m, label: relLabel(m), picked: false })),
  ];
  const res = await pickMany({
    title: vscode.l10n.t('Find Unreferenced Resources — DITA maps'),
    placeholder: vscode.l10n.t('Select the maps whose references count; files they do not reach are reported'),
    items,
    browse: {
      tooltip: vscode.l10n.t('Browse for maps…'),
      run: async () => (await browseFiles(vscode.l10n.t('DITA Maps'), ['ditamap'], true)).map((p) => ({ value: p, label: relLabel(p), picked: true })),
    },
  });
  if (res?.kind !== 'accept' || res.values.length === 0) return undefined;
  return res.values;
}

/** Step 1. Returns the chosen folders, 'maps' to pick other maps, or undefined to cancel. */
async function chooseFolders(scan: Scan, token: vscode.CancellationToken): Promise<string[] | 'maps' | undefined> {
  const f = readFilters();
  const chosenByDefault = new Set(scan.suggested);
  const items = scan.stats.map((s) => folderItem(s, chosenByDefault.has(s.dir)));
  const res = await pickMany({
    title: vscode.l10n.t('Find Unreferenced Resources — folders to check (1/2) — {0}', mapsLabel(scan.maps)),
    placeholder: vscode.l10n.t('Tick the folders to check, then press Enter · buttons at the top right: browse for folders, change maps, filters'),
    items,
    browse: {
      tooltip: vscode.l10n.t('Browse for another folder…'),
      run: async () => {
        const added: PickManyItem[] = [];
        for (const dir of await browseFolders(vscode.l10n.t('Select Folders'))) {
          await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: vscode.l10n.t('Reading {0}…', relLabel(dir)) }, () => addFolder(scan, dir, token));
          const stat = scan.stats.find((s) => s.dir === dir);
          if (stat) added.push(folderItem(stat, true));
        }
        return added;
      },
    },
    buttons: [
      { icon: 'file-code', tooltip: vscode.l10n.t('Choose other maps…'), restart: true },
      {
        icon: 'gear',
        tooltip: vscode.l10n.t('Filters: include {0} · exclude files {1} · exclude folders {2}', f.includeFiles, f.excludeFiles, f.excludeFolders),
        run: () => void vscode.commands.executeCommand('workbench.action.openSettings', SETTINGS),
      },
    ],
  });
  if (!res) return undefined;
  return res.kind === 'restart' ? 'maps' : res.values;
}

/** Step 2: which kinds of file count. Skipped when only one kind turned up. */
async function chooseTypes(context: vscode.ExtensionContext, files: string[]): Promise<string[] | undefined> {
  const exts = summarizeExtensions(files);
  if (exts.length < 2) return files.length > 0 ? exts.map((e) => e.ext) : [];
  const remembered = context.globalState.get<RememberedExtensions>(TYPES_KEY);
  const checked = defaultCheckedExtensions(exts.map((e) => e.ext), remembered);
  const res = await pickMany({
    title: vscode.l10n.t('Find Unreferenced Resources — file types (2/2)'),
    placeholder: vscode.l10n.t('Images, media and DITA files are ticked; scripts, styles and notes usually are not referenced. Press Enter to search'),
    items: exts.map((e) => ({
      value: e.ext,
      label: e.ext === '' ? vscode.l10n.t('(no extension)') : `.${e.ext}`,
      description: vscode.l10n.t('{0} unreferenced', String(e.count)),
      picked: checked.has(e.ext),
    })),
  });
  if (res?.kind !== 'accept') return undefined;
  await context.globalState.update(
    TYPES_KEY,
    rememberExtensions(remembered, exts.map((e) => e.ext), res.values),
  );
  return res.values;
}

// ── Results ─────────────────────────────────────────────────────────────

async function report(maps: string[], files: string[], checked: number): Promise<void> {
  collection ??= vscode.languages.createDiagnosticCollection('dita-viewer-unreferenced');
  collection.clear();
  if (files.length === 0) {
    void vscode.window.showInformationMessage(vscode.l10n.t('No unreferenced resources found ({0} file(s) checked).', String(checked)));
    return;
  }
  const names = maps.map((m) => basename(m)).join(', ');
  for (const file of files) {
    const d = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 0),
      vscode.l10n.t('Not referenced by {0}', names),
      vscode.DiagnosticSeverity.Warning,
    );
    d.source = vscode.l10n.t('DITA Unreferenced Resources');
    collection.set(vscode.Uri.file(file), [d]);
  }
  const show = vscode.l10n.t('Show Problems');
  const copy = vscode.l10n.t('Copy List');
  const pick = await vscode.window.showInformationMessage(
    vscode.l10n.t('{0} unreferenced resource(s) found among {1} file(s) checked — listed in the Problems panel.', String(files.length), String(checked)),
    show,
    copy,
  );
  if (pick === show) await vscode.commands.executeCommand('workbench.actions.view.problems');
  else if (pick === copy) await vscode.env.clipboard.writeText(files.join('\n'));
}

// ── Command ─────────────────────────────────────────────────────────────

async function findUnreferenced(context: vscode.ExtensionContext, initialMaps: string[]): Promise<void> {
  let maps = initialMaps;
  for (;;) {
    if (maps.length === 0) {
      const picked = await chooseMaps([]);
      if (!picked) return;
      maps = picked;
    }
    const scan = await scanMaps(maps);
    if (!scan) return;
    const cancelToken = new vscode.CancellationTokenSource();
    const folders = await chooseFolders(scan, cancelToken.token);
    cancelToken.dispose();
    if (folders === undefined) return;
    if (folders === 'maps') {
      const picked = await chooseMaps(maps);
      if (!picked) return;
      maps = picked;
      continue;
    }
    if (folders.length === 0) {
      void vscode.window.showWarningMessage(vscode.l10n.t('Select at least one folder.'));
      return;
    }
    const inFolders = filesUnder(scan.unreferenced, folders);
    const checked = filesUnder(scan.files, folders).length;
    const types = await chooseTypes(context, inFolders);
    if (!types) return;
    const wanted = new Set(types);
    const files = inFolders.filter((f) => wanted.has(extensionOf(f))).sort((a, b) => a.localeCompare(b));
    await report(maps, files, checked);
    return;
  }
}

export function registerUnreferencedResourcesCommand(context: vscode.ExtensionContext, deps: MapCheckDeps): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(FIND_CMD, async (arg?: unknown) => {
      const map = mapFromArg(arg) ?? activeMapPath(deps);
      await findUnreferenced(context, map ? [map] : []);
    }),
    vscode.commands.registerCommand('ditaViewer.clearMapCheckResults', async () => {
      clearUnreferencedResults();
      await vscode.commands.executeCommand('ditaViewer.mapChecks.clear');
    }),
    new vscode.Disposable(() => {
      collection?.dispose();
      collection = undefined;
    }),
  );
}
