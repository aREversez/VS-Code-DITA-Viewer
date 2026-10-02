// Shared plumbing for the map-check commands (Find Unreferenced Resources,
// Validate and Check for Completeness): file-system adapters for the pure
// crawl/check modules, the "which map?" default, a multi-select picker, and
// progress. All UI is native VS Code -- quick picks, a notification with a
// cancel button, a tree view for results (mapCheckResultsView.ts) -- not
// custom webview forms.

import * as vscode from 'vscode';
import { promises as fsp } from 'fs';
import { CrawlHost } from './mapCrawl';
import { getActiveDitaUri } from './exportHtml';
import { readSourceText } from './sourceText';

export interface MapCheckDeps {
  /** The map the navigator is showing, when the active editor gives no better answer. */
  currentTreeMap(): string | undefined;
}

export function makeHost(token?: vscode.CancellationToken): CrawlHost {
  return {
    platform: process.platform,
    readFile: async (p) => readSourceText(p),
    exists: async (p) => {
      try {
        await fsp.access(p);
        return true;
      } catch {
        return false;
      }
    },
    cancelled: () => !!token?.isCancellationRequested,
  };
}

export const listHost = {
  readdir: async (dir: string) => {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, isDir: e.isDirectory() }));
  },
};

/** The map a command should act on when none was passed: the active editor's, else the navigator's. */
export function activeMapPath(deps: MapCheckDeps): string | undefined {
  const active = getActiveDitaUri();
  if (active && /\.ditamap$/i.test(active.fsPath)) return active.fsPath;
  return deps.currentTreeMap();
}

/** A map handed in by a menu or toolbar (a Uri), else undefined. */
export function mapFromArg(arg: unknown): string | undefined {
  return arg instanceof vscode.Uri && /\.ditamap$/i.test(arg.fsPath) ? arg.fsPath : undefined;
}

export async function browseFiles(title: string, extensions: string[], many: boolean): Promise<string[]> {
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: many,
    canSelectFiles: true,
    canSelectFolders: false,
    filters: { [title]: extensions },
    title,
  });
  return (uris ?? []).map((u) => u.fsPath);
}

export async function browseFolders(title: string): Promise<string[]> {
  const uris = await vscode.window.showOpenDialog({ canSelectMany: true, canSelectFiles: false, canSelectFolders: true, title });
  return (uris ?? []).map((u) => u.fsPath);
}

export interface PickManyItem extends vscode.QuickPickItem {
  value: string;
}

export interface PickManyOptions {
  title: string;
  placeholder: string;
  items: PickManyItem[];
  /** Adds a "Browse…" title-bar button that appends whatever the callback returns (selected). */
  browse?: { tooltip: string; run: () => Promise<PickManyItem[]> };
  /** Extra title-bar buttons: run something, or close the picker so the caller can start over. */
  buttons?: Array<{ icon: string; tooltip: string; run?: () => void; restart?: boolean }>;
}

export type PickManyResult = { kind: 'accept'; values: string[] } | { kind: 'restart' } | undefined;

/**
 * A multi-select quick pick: items marked `picked` start checked, Enter
 * accepts, Esc cancels (undefined). Standard VS Code idiom for choosing from
 * a list that the user may also extend from disk.
 */
export function pickMany(opts: PickManyOptions): Promise<PickManyResult> {
  return new Promise((resolve) => {
    const qp = vscode.window.createQuickPick<PickManyItem>();
    qp.title = opts.title;
    qp.placeholder = opts.placeholder;
    qp.canSelectMany = true;
    qp.ignoreFocusOut = true;
    qp.matchOnDescription = true;
    qp.items = opts.items;
    qp.selectedItems = opts.items.filter((i) => i.picked);

    const browseButton: vscode.QuickInputButton | undefined = opts.browse
      ? { iconPath: new vscode.ThemeIcon('folder-opened'), tooltip: opts.browse.tooltip }
      : undefined;
    const extra = (opts.buttons ?? []).map((b) => ({
      button: { iconPath: new vscode.ThemeIcon(b.icon), tooltip: b.tooltip } as vscode.QuickInputButton,
      spec: b,
    }));
    qp.buttons = [...(browseButton ? [browseButton] : []), ...extra.map((e) => e.button)];

    let done = false;
    const finish = (v: PickManyResult) => {
      if (done) return;
      done = true;
      resolve(v);
      qp.dispose();
    };
    qp.onDidTriggerButton(async (b) => {
      if (b === browseButton && opts.browse) {
        const added = await opts.browse.run();
        const known = new Set(qp.items.map((i) => i.value));
        const fresh = added.filter((i) => !known.has(i.value));
        const reselected = added.filter((i) => known.has(i.value)).map((i) => qp.items.find((x) => x.value === i.value)!);
        const selected = [...qp.selectedItems, ...reselected];
        qp.items = [...fresh, ...qp.items];
        qp.selectedItems = [...selected, ...fresh];
        return;
      }
      const hit = extra.find((e) => e.button === b);
      if (hit?.spec.restart) finish({ kind: 'restart' });
      else hit?.spec.run?.();
    });
    qp.onDidAccept(() => finish({ kind: 'accept', values: qp.selectedItems.map((i) => i.value) }));
    qp.onDidHide(() => finish(undefined));
    qp.show();
  });
}

/**
 * Writes a setting where it already lives (workspace folder, then workspace,
 * then user); if unset anywhere, in the user settings so a check never
 * creates .vscode/settings.json in someone's repository on its own.
 */
export async function updateSetting(section: string, key: string, value: unknown): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(section);
  const info = cfg.inspect(key);
  const target =
    info?.workspaceFolderValue !== undefined
      ? vscode.ConfigurationTarget.WorkspaceFolder
      : info?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
  await cfg.update(key, value, target);
}
