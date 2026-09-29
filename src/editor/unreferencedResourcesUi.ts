// "Find Unreferenced Resources…" (ditaViewer.findUnreferencedResources): a
// form in a webview panel modeled on Oxygen's dialog -- DITA maps, folders,
// include/exclude filters -- and a clickable result list. The search itself
// is pure and lives in unreferencedResources.ts / mapCrawl.ts.

import * as vscode from 'vscode';
import { dirname, relative } from 'path';
import {
  DEFAULT_UNREFERENCED_FILTERS,
  UnreferencedFilters,
  findUnreferencedResources,
} from './unreferencedResources';
import {
  LIST_SCRIPT,
  MapCheckDeps,
  esc,
  listHost,
  makeHost,
  page,
  pickFiles,
  pickFolders,
  resolveMapArg,
} from './mapCheckShared';

const FIND_CMD = 'ditaViewer.findUnreferencedResources';
const UNREF_STATE_KEY = 'ditaViewer.unreferencedFilters';

// ── Find Unreferenced Resources ─────────────────────────────────────────

interface UnrefFormState {
  maps: string[];
  folders: string[];
  filters: UnreferencedFilters;
}

let unrefPanel: vscode.WebviewPanel | undefined;

async function openUnreferencedDialog(context: vscode.ExtensionContext, arg: unknown, deps: MapCheckDeps): Promise<void> {
  const map = resolveMapArg(arg, deps);
  const saved = context.globalState.get<UnreferencedFilters>(UNREF_STATE_KEY);
  const state: UnrefFormState = {
    maps: map ? [map] : [],
    folders: map ? [dirname(map)] : [],
    filters: { ...DEFAULT_UNREFERENCED_FILTERS, ...(saved ?? {}) },
  };

  if (unrefPanel) {
    unrefPanel.dispose();
  }
  const panel = vscode.window.createWebviewPanel('ditaViewer.findUnreferenced', vscode.l10n.t('Find Unreferenced Resources'), vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  unrefPanel = panel;
  panel.onDidDispose(() => {
    if (unrefPanel === panel) unrefPanel = undefined;
  });
  panel.webview.html = unreferencedHtml(state);

  let running: vscode.CancellationTokenSource | undefined;
  const post = (m: unknown) => void panel.webview.postMessage(m);
  panel.onDidDispose(() => running?.cancel());

  panel.webview.onDidReceiveMessage(async (m: { type: string; [k: string]: unknown }) => {
    switch (m.type) {
      case 'addMap': {
        const picked = await pickFiles(vscode.l10n.t('Select DITA Maps'), { [vscode.l10n.t('DITA Maps')]: ['ditamap'] });
        for (const p of picked) if (!state.maps.includes(p)) state.maps.push(p);
        post({ type: 'maps', items: state.maps });
        break;
      }
      case 'removeMap':
        state.maps = state.maps.filter((x) => x !== m.value);
        post({ type: 'maps', items: state.maps });
        break;
      case 'addFolder': {
        const picked = await pickFolders(vscode.l10n.t('Select Folders'));
        for (const p of picked) if (!state.folders.includes(p)) state.folders.push(p);
        post({ type: 'folders', items: state.folders });
        break;
      }
      case 'removeFolder':
        state.folders = state.folders.filter((x) => x !== m.value);
        post({ type: 'folders', items: state.folders });
        break;
      case 'cancelRun':
        running?.cancel();
        break;
      case 'find': {
        state.filters = {
          includeFiles: String(m.includeFiles ?? '*'),
          excludeFiles: String(m.excludeFiles ?? ''),
          excludeFolders: String(m.excludeFolders ?? ''),
        };
        await context.globalState.update(UNREF_STATE_KEY, state.filters);
        if (state.maps.length === 0 || state.folders.length === 0) {
          post({ type: 'notice', text: vscode.l10n.t('Add at least one DITA map and one folder.') });
          break;
        }
        running = new vscode.CancellationTokenSource();
        post({ type: 'busy', on: true });
        try {
          const res = await findUnreferencedResources(
            { maps: state.maps, folders: state.folders, filters: state.filters },
            makeHost(running.token),
            listHost,
          );
          if (running.token.isCancellationRequested) {
            post({ type: 'notice', text: vscode.l10n.t('Search cancelled.') });
          } else {
            const roots = state.folders;
            const items = res.unreferenced.map((abs) => {
              const base = roots.find((r) => !relative(r, abs).startsWith('..')) ?? dirname(abs);
              return { abs, rel: relative(base, abs).replace(/\\/g, '/') };
            });
            const problems = res.crawl.fileIssues.filter((i) => !i.structural).length;
            post({
              type: 'results',
              items,
              summary:
                items.length === 0
                  ? vscode.l10n.t('No unreferenced resources found ({0} file(s) checked).', String(res.scanned))
                  : vscode.l10n.t('{0} unreferenced resource(s) among {1} file(s) checked.', String(items.length), String(res.scanned)),
              warning:
                problems > 0
                  ? vscode.l10n.t('{0} referenced file(s) could not be read or parsed, so what they reference may be reported as unreferenced. Run "Validate and Check for Completeness" for details.', String(problems))
                  : '',
            });
          }
        } catch (err) {
          post({ type: 'notice', text: vscode.l10n.t('Search failed: {0}', err instanceof Error ? err.message : String(err)) });
        } finally {
          running.dispose();
          running = undefined;
          post({ type: 'busy', on: false });
        }
        break;
      }
      case 'open':
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(String(m.path)), { preview: true });
        break;
      case 'reveal':
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(String(m.path)));
        break;
      case 'copy':
        await vscode.env.clipboard.writeText(String(m.text ?? ''));
        vscode.window.showInformationMessage(vscode.l10n.t('Copied to clipboard.'));
        break;
    }
  });
}

function unreferencedHtml(state: UnrefFormState): string {
  const body = `
<p class="lead">${esc(vscode.l10n.t('All files from the listed folders that are not referenced from the specified DITA Maps will be reported.'))}</p>
<h2>${esc(vscode.l10n.t('DITA Maps:'))}</h2>
<div class="list" id="maps"></div>
<div class="row end"><button id="addMap">${esc(vscode.l10n.t('Add'))}</button><button id="removeMap">${esc(vscode.l10n.t('Remove'))}</button></div>
<h2>${esc(vscode.l10n.t('Folders:'))}</h2>
<div class="list" id="folders"></div>
<div class="row end"><button id="addFolder">${esc(vscode.l10n.t('Add'))}</button><button id="removeFolder">${esc(vscode.l10n.t('Remove'))}</button></div>
<fieldset><legend>${esc(vscode.l10n.t('Filters'))}</legend>
  <div class="fld"><span>${esc(vscode.l10n.t('Include files:'))}</span><input type="text" id="includeFiles" value="${esc(state.filters.includeFiles)}"></div>
  <div class="fld"><span>${esc(vscode.l10n.t('Exclude files:'))}</span><input type="text" id="excludeFiles" value="${esc(state.filters.excludeFiles)}"></div>
  <div class="fld"><span>${esc(vscode.l10n.t('Exclude folders:'))}</span><input type="text" id="excludeFolders" value="${esc(state.filters.excludeFolders)}"></div>
  <div class="muted">${esc(vscode.l10n.t('Comma-separated patterns; * and ? are wildcards.'))}</div>
</fieldset>
<div class="row end"><button class="primary" id="find">${esc(vscode.l10n.t('Find'))}</button><button id="cancel" disabled>${esc(vscode.l10n.t('Cancel'))}</button></div>
<div id="results"></div>`;
  const script = `
${LIST_SCRIPT}
const T = ${JSON.stringify({
    none: vscode.l10n.t('(none)'),
    copyAll: vscode.l10n.t('Copy list'),
    open: vscode.l10n.t('Open'),
    reveal: vscode.l10n.t('Reveal'),
  })};
const maps = bindList('maps'), folders = bindList('folders');
renderList(maps, ${JSON.stringify(state.maps)}, T.none);
renderList(folders, ${JSON.stringify(state.folders)}, T.none);
const $ = (id) => document.getElementById(id);
$('addMap').onclick = () => vscode.postMessage({ type: 'addMap' });
$('removeMap').onclick = () => { const v = selected(maps); if (v) vscode.postMessage({ type: 'removeMap', value: v }); };
$('addFolder').onclick = () => vscode.postMessage({ type: 'addFolder' });
$('removeFolder').onclick = () => { const v = selected(folders); if (v) vscode.postMessage({ type: 'removeFolder', value: v }); };
$('find').onclick = () => vscode.postMessage({ type: 'find', includeFiles: $('includeFiles').value, excludeFiles: $('excludeFiles').value, excludeFolders: $('excludeFolders').value });
$('cancel').onclick = () => vscode.postMessage({ type: 'cancelRun' });
window.addEventListener('message', (e) => {
  const m = e.data;
  if (m.type === 'maps') renderList(maps, m.items, T.none);
  else if (m.type === 'folders') renderList(folders, m.items, T.none);
  else if (m.type === 'busy') { $('find').disabled = m.on; $('cancel').disabled = !m.on; if (m.on) $('results').textContent = '…'; }
  else if (m.type === 'notice') { $('results').textContent = m.text; }
  else if (m.type === 'results') {
    const box = $('results'); box.textContent = '';
    const s = document.createElement('div'); s.textContent = m.summary; box.appendChild(s);
    if (m.warning) { const w = document.createElement('div'); w.className = 'sev-warning'; w.textContent = m.warning; box.appendChild(w); }
    if (m.items.length) {
      const bar = document.createElement('div'); bar.className = 'row';
      const b = document.createElement('button'); b.textContent = T.copyAll;
      b.onclick = () => vscode.postMessage({ type: 'copy', text: m.items.map((i) => i.abs).join('\\n') });
      bar.appendChild(b); box.appendChild(bar);
    }
    for (const it of m.items) {
      const d = document.createElement('div'); d.className = 'item'; d.title = it.abs;
      const p = document.createElement('span'); p.className = 'path'; p.textContent = it.rel;
      d.appendChild(p);
      d.onclick = () => vscode.postMessage({ type: 'open', path: it.abs });
      d.oncontextmenu = (ev) => { ev.preventDefault(); vscode.postMessage({ type: 'reveal', path: it.abs }); };
      box.appendChild(d);
    }
  }
});`;
  return page(vscode.l10n.t('Find Unreferenced Resources'), body, script);
}

export function registerUnreferencedResourcesCommand(context: vscode.ExtensionContext, deps: MapCheckDeps): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(FIND_CMD, (arg?: unknown) => openUnreferencedDialog(context, arg, deps)),
  );
}
