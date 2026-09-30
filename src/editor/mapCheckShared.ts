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
  /** Extra title-bar buttons (open settings, …). */
  buttons?: Array<{ icon: string; tooltip: string; run: () => void }>;
}

/**
 * A multi-select quick pick: items marked `picked` start checked, Enter
 * accepts, Esc cancels (undefined). Standard VS Code idiom for choosing from
 * a list that the user may also extend from disk.
 */
export function pickMany(opts: PickManyOptions): Promise<string[] | undefined> {
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
      run: b.run,
    }));
    qp.buttons = [...(browseButton ? [browseButton] : []), ...extra.map((e) => e.button)];

    let done = false;
    const finish = (v: string[] | undefined) => {
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
        const selected = [...qp.selectedItems, ...added.filter((i) => known.has(i.value)).map((i) => qp.items.find((x) => x.value === i.value)!)];
        qp.items = [...fresh, ...qp.items];
        qp.selectedItems = [...selected, ...fresh];
        return;
      }
      extra.find((e) => e.button === b)?.run();
    });
    qp.onDidAccept(() => finish(qp.selectedItems.map((i) => i.value)));
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

// ── Webview plumbing (used by the completeness dialog until it moves to the same native UI) ────────────────────────────────────────────────────

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function nonce(): string {
  let s = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

export const BASE_CSS = `
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 12px 20px 24px; max-width: 760px; }
  p.lead { margin: 0 0 14px; }
  h2 { font-size: 1.05em; margin: 18px 0 6px; font-weight: 600; }
  label { display: flex; align-items: center; gap: 6px; padding: 2px 0; }
  .sub { margin-left: 22px; }
  fieldset { border: 1px solid var(--vscode-panel-border); border-radius: 3px; margin: 12px 0; padding: 8px 12px; }
  legend { padding: 0 6px; }
  .list { border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); background: var(--vscode-input-background); min-height: 64px; max-height: 140px; overflow: auto; }
  .list div { padding: 3px 8px; cursor: default; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .list div.sel { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .list div.empty { color: var(--vscode-descriptionForeground); font-style: italic; }
  .row { display: flex; gap: 8px; margin: 6px 0; align-items: center; }
  .row.end { justify-content: flex-end; }
  .row .grow { flex: 1; }
  .fld { display: grid; grid-template-columns: 110px 1fr; gap: 6px; align-items: center; margin: 4px 0; }
  input[type=text] { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 3px 6px; font: inherit; width: 100%; box-sizing: border-box; }
  button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 0; padding: 4px 14px; cursor: pointer; font: inherit; }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: .5; cursor: default; }
  .muted { color: var(--vscode-descriptionForeground); }
  #results { margin-top: 18px; }
  #results .item { padding: 2px 4px; cursor: pointer; display: flex; gap: 8px; }
  #results .item:hover { background: var(--vscode-list-hoverBackground); }
  #results .item .path { color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #results .item .sev { flex: none; width: 1.2em; text-align: center; }
  .sev-error { color: var(--vscode-errorForeground); } .sev-warning { color: var(--vscode-editorWarning-foreground); } .sev-info { color: var(--vscode-editorInfo-foreground); }
  .cat { font-weight: 600; margin: 12px 0 2px; }
`;

export function page(title: string, body: string, script: string): string {
  const n = nonce();
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${n}';">
<title>${esc(title)}</title><style>${BASE_CSS}</style></head><body>${body}<script nonce="${n}">
const vscode = acquireVsCodeApi();
${script}
</script></body></html>`;
}

export const LIST_SCRIPT = `
function bindList(id) {
  const el = document.getElementById(id);
  el.addEventListener('click', (e) => {
    const d = e.target.closest('div[data-v]');
    if (!d) return;
    el.querySelectorAll('div.sel').forEach((x) => x.classList.remove('sel'));
    d.classList.add('sel');
  });
  return el;
}
function renderList(el, items, emptyText) {
  el.innerHTML = '';
  if (!items.length) { const d = document.createElement('div'); d.className = 'empty'; d.textContent = emptyText; el.appendChild(d); return; }
  for (const v of items) { const d = document.createElement('div'); d.dataset.v = v; d.title = v; d.textContent = v; el.appendChild(d); }
}
function selected(el) { const d = el.querySelector('div.sel'); return d ? d.dataset.v : undefined; }
`;

export async function pickFiles(title: string, filters: Record<string, string[]>, many = true): Promise<string[]> {
  const uris = await vscode.window.showOpenDialog({ canSelectMany: many, canSelectFiles: true, canSelectFolders: false, filters, title });
  return (uris ?? []).map((u) => u.fsPath);
}

export async function pickFolders(title: string): Promise<string[]> {
  const uris = await vscode.window.showOpenDialog({ canSelectMany: true, canSelectFiles: false, canSelectFolders: true, title });
  return (uris ?? []).map((u) => u.fsPath);
}

export function resolveMapArg(arg: unknown, deps: MapCheckDeps): string | undefined {
  if (arg instanceof vscode.Uri && /\.ditamap$/i.test(arg.fsPath)) return arg.fsPath;
  const active = getActiveDitaUri();
  if (active && /\.ditamap$/i.test(active.fsPath)) return active.fsPath;
  return deps.currentTreeMap();
}
