// "Validate and Check for Completeness…" (ditaViewer.validateMapCompleteness):
// a form in a webview panel modeled on Oxygen's DITA Map Completeness Check
// dialog, with the same options and defaults; last-used settings are
// remembered and can be exported/imported. Findings are listed in the panel
// and published to the Problems panel. The checks themselves are pure and
// live in mapCrawl.ts / mapChecks.ts.

import * as vscode from 'vscode';
import { promises as fsp } from 'fs';
import { basename, dirname, join } from 'path';
import { crawlMaps } from './mapCrawl';
import { parseDitaval, DitavalFilter } from './ditaval';
import {
  CompletenessOptions,
  DEFAULT_COMPLETENESS_OPTIONS,
  Issue,
  IssueCategory,
  ProfilingPreferences,
  runChecks,
} from './mapChecks';
import { Msg, MsgCode, formatMessage } from './mapCheckMessages';
import {
  LIST_SCRIPT,
  MapCheckDeps,
  esc,
  makeHost,
  page,
  pickFiles,
  resolveMapArg,
} from './mapCheckShared';

const VALIDATE_CMD = 'ditaViewer.validateMapCompleteness';
const COMPLETENESS_STATE_KEY = 'ditaViewer.completenessOptions';

// ── Localization of finding text ────────────────────────────────────────
// One literal vscode.l10n.t(...) per template: scripts/check-l10n.cjs finds
// catalog entries by scanning for literal calls, and a test asserts every
// template in mapCheckMessages.ts appears here.

export function localizeMsg(m: Msg): string {
  const a = m.args;
  const c: MsgCode = m.code;
  switch (c) {
    case 'ref.missingTopic': return vscode.l10n.t('Referenced topic not found: {0}', ...a);
    case 'ref.missingMap': return vscode.l10n.t('Referenced map not found: {0}', ...a);
    case 'ref.missingConref': return vscode.l10n.t('Referenced conref target not found: {0}', ...a);
    case 'ref.missingResource': return vscode.l10n.t('Referenced resource not found: {0}', ...a);
    case 'ref.remoteUnreachable': return vscode.l10n.t('Remote resource could not be reached: {0}', ...a);
    case 'ref.outsideFolder': return vscode.l10n.t('Reference points outside the map folder: {0}', ...a);
    case 'ref.linkNotInMap': return vscode.l10n.t('Link target is not referenced in any map: {0}', ...a);
    case 'ref.multiple': return vscode.l10n.t('Topic referenced more than once ({1} times): {0}', ...a);
    case 'id.duplicate': return vscode.l10n.t('Duplicate topic id "{0}" ({1} topics share it)', ...a);
    case 'key.duplicate': return vscode.l10n.t('Key "{0}" is already defined; this definition is ignored', ...a);
    case 'key.unreferenced': return vscode.l10n.t('Key "{0}" is defined but never referenced', ...a);
    case 'reuse.unreferenced': return vscode.l10n.t('Reusable element <{0} id="{1}"> is never referenced by a conref or conkeyref', ...a);
    case 'prof.conflict': return vscode.l10n.t('@{0}="{1}" on <{2}> shares no value with the enclosing "{3}"; the content is overshadowed in profiled output', ...a);
    case 'prof.notConfigured': return vscode.l10n.t('No profiling preferences are configured (dita-viewer.completenessCheck.profilingAttributes)', ...a);
    case 'prof.attrUndefined': return vscode.l10n.t('Profiling attribute @{0} on <{1}> is not defined in the profiling preferences', ...a);
    case 'prof.valueUndefined': return vscode.l10n.t('@{0} value "{1}" is not defined in the profiling preferences', ...a);
    case 'prof.singleValue': return vscode.l10n.t('@{0} is single-value but has {1} values ("{2}")', ...a);
    case 'val.unreadable': return vscode.l10n.t('File could not be read', ...a);
    case 'val.xml': return vscode.l10n.t('XML error: {0}', ...a);
    case 'val.notMap': return vscode.l10n.t('Root element <{0}> is not a DITA map', ...a);
    case 'val.notTopic': return vscode.l10n.t('Root element <{0}> is not a DITA topic', ...a);
    case 'val.noId': return vscode.l10n.t('Topic <{0}> has no id attribute', ...a);
    case 'val.noTitle': return vscode.l10n.t('Topic <{0}> has no <title>', ...a);
    case 'tbl.cals.colsInvalid': return vscode.l10n.t('CALS table: @cols "{0}" is not a valid column count', ...a);
    case 'tbl.cals.attrNotNumeric': return vscode.l10n.t('CALS table: @{0} "{1}" is not numeric', ...a);
    case 'tbl.cals.colspecNotNumeric': return vscode.l10n.t('CALS table: <colspec> @{0} "{1}" is not numeric', ...a);
    case 'tbl.cals.colspecCount': return vscode.l10n.t('CALS table: {0} <colspec> element(s) but @cols is {1}', ...a);
    case 'tbl.cals.badName': return vscode.l10n.t('CALS table: @{1} "{0}" does not match any <colspec> colname', ...a);
    case 'tbl.cals.nameOrder': return vscode.l10n.t('CALS table: @nameend "{1}" comes before @namest "{0}"', ...a);
    case 'tbl.cals.overlap': return vscode.l10n.t('CALS table: row {0}: entry overlaps a cell spanning down from a previous row (column {1})', ...a);
    case 'tbl.cals.morerows': return vscode.l10n.t('CALS table: row {0}: @morerows="{1}" spans past the last row ({2} row(s) remain)', ...a);
    case 'tbl.cals.rowWidth': return vscode.l10n.t('CALS table: row {0} has {1} column(s) of cells; the table has {2}', ...a);
    case 'tbl.cals.colsMismatch': return vscode.l10n.t('CALS table: @cols is {0} but the table structure has {1} column(s)', ...a);
    case 'tbl.simple.short': return vscode.l10n.t('Simple table: row {0} has {1} cell(s); expected {2}', ...a);
    case 'tbl.simple.long': return vscode.l10n.t('Simple table: row {0} has {1} cell(s); the header row has {2}', ...a);
    default: return formatMessage(m);
  }
}

// ── Validate and Check for Completeness ─────────────────────────────────

let completenessPanel: vscode.WebviewPanel | undefined;
let diagnostics: vscode.DiagnosticCollection | undefined;

function readProfilingPreferences(): ProfilingPreferences {
  const cfg = vscode.workspace.getConfiguration('dita-viewer.completenessCheck');
  const attrs = cfg.get<Record<string, string[]>>('profilingAttributes') ?? {};
  const single = cfg.get<string[]>('singleValueProfilingAttributes') ?? [];
  return { attributes: attrs, singleValue: single };
}

async function checkRemote(url: string): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      let res = await fetch(url, { method: 'HEAD', signal: ctl.signal, redirect: 'follow' });
      if (res.status === 405 || res.status === 501) res = await fetch(url, { method: 'GET', signal: ctl.signal, redirect: 'follow' });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

const CATEGORY_ORDER: IssueCategory[] = [
  'validation', 'missing-reference', 'missing-resource', 'remote-resource', 'outside-folder',
  'unreferenced-link', 'multiple-reference', 'duplicate-id', 'duplicate-key', 'unreferenced-key',
  'unreferenced-reusable', 'table-layout', 'profiling-conflict', 'profiling-preference',
];

function categoryLabel(c: IssueCategory): string {
  switch (c) {
    case 'validation': return vscode.l10n.t('Validation');
    case 'missing-reference': return vscode.l10n.t('Missing topics and maps');
    case 'missing-resource': return vscode.l10n.t('Missing resources');
    case 'remote-resource': return vscode.l10n.t('Unreachable remote resources');
    case 'outside-folder': return vscode.l10n.t('References outside the map folder');
    case 'unreferenced-link': return vscode.l10n.t('Links to topics not referenced in maps');
    case 'multiple-reference': return vscode.l10n.t('Multiple references to the same topic');
    case 'duplicate-id': return vscode.l10n.t('Duplicate topic IDs');
    case 'duplicate-key': return vscode.l10n.t('Duplicate key definitions');
    case 'unreferenced-key': return vscode.l10n.t('Unreferenced key definitions');
    case 'unreferenced-reusable': return vscode.l10n.t('Unreferenced reusable elements');
    case 'table-layout': return vscode.l10n.t('Table layout problems');
    case 'profiling-conflict': return vscode.l10n.t('Profiling attribute conflicts');
    case 'profiling-preference': return vscode.l10n.t('Profiling preferences conflicts');
  }
}

function toSeverity(s: Issue['severity']): vscode.DiagnosticSeverity {
  return s === 'error' ? vscode.DiagnosticSeverity.Error : s === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information;
}

function publishDiagnostics(issues: Issue[]): void {
  diagnostics ??= vscode.languages.createDiagnosticCollection('dita-viewer-completeness');
  diagnostics.clear();
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const i of issues) {
    const line = Math.max(0, i.line - 1);
    const d = new vscode.Diagnostic(new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER), localizeMsg(i.msg), toSeverity(i.severity));
    d.source = vscode.l10n.t('DITA Completeness Check');
    d.code = i.category;
    if (i.related?.length) {
      d.relatedInformation = i.related.map(
        (r) => new vscode.DiagnosticRelatedInformation(new vscode.Location(vscode.Uri.file(r.file), new vscode.Position(Math.max(0, r.line - 1), 0)), vscode.l10n.t('First occurrence')),
      );
    }
    const list = byFile.get(i.file);
    if (list) list.push(d);
    else byFile.set(i.file, [d]);
  }
  for (const [file, list] of byFile) diagnostics.set(vscode.Uri.file(file), list);
}

interface CompletenessFormState {
  map: string;
  options: CompletenessOptions;
}

async function openCompletenessDialog(context: vscode.ExtensionContext, arg: unknown, deps: MapCheckDeps): Promise<void> {
  const map = resolveMapArg(arg, deps);
  if (!map) {
    vscode.window.showErrorMessage(vscode.l10n.t('Please open a .ditamap file first.'));
    return;
  }
  const saved = context.globalState.get<Partial<CompletenessOptions>>(COMPLETENESS_STATE_KEY);
  const state: CompletenessFormState = { map, options: { ...DEFAULT_COMPLETENESS_OPTIONS, ...(saved ?? {}) } };

  completenessPanel?.dispose();
  const panel = vscode.window.createWebviewPanel('ditaViewer.completeness', vscode.l10n.t('DITA Map Completeness Check'), vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  completenessPanel = panel;
  let running: vscode.CancellationTokenSource | undefined;
  panel.onDidDispose(() => {
    if (completenessPanel === panel) completenessPanel = undefined;
    running?.cancel();
  });
  panel.webview.html = completenessHtml(state);
  const post = (m: unknown) => void panel.webview.postMessage(m);

  panel.webview.onDidReceiveMessage(async (m: { type: string; [k: string]: unknown }) => {
    switch (m.type) {
      case 'addDitaval': {
        const picked = await pickFiles(vscode.l10n.t('DITAVAL Filter Files'), { [vscode.l10n.t('DITAVAL Filter Files')]: ['ditaval'] });
        for (const p of picked) if (!state.options.ditavalFiles.includes(p)) state.options.ditavalFiles.push(p);
        post({ type: 'ditaval', items: state.options.ditavalFiles });
        break;
      }
      case 'removeDitaval':
        state.options.ditavalFiles = state.options.ditavalFiles.filter((x) => x !== m.value);
        post({ type: 'ditaval', items: state.options.ditavalFiles });
        break;
      case 'changeMap': {
        const picked = await pickFiles(vscode.l10n.t('Select DITA Maps'), { [vscode.l10n.t('DITA Maps')]: ['ditamap'] }, false);
        if (picked[0]) {
          state.map = picked[0];
          post({ type: 'map', value: state.map });
        }
        break;
      }
      case 'exportSettings': {
        const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(join(dirname(state.map), 'completeness-check-settings.json')), filters: { JSON: ['json'] } });
        if (target) {
          const opts = readOptions(m.options, state.options);
          await vscode.workspace.fs.writeFile(target, Buffer.from(JSON.stringify(opts, null, 2) + '\n', 'utf8'));
          vscode.window.showInformationMessage(vscode.l10n.t('Settings exported to {0}', basename(target.fsPath)));
        }
        break;
      }
      case 'importSettings': {
        const [file] = await pickFiles(vscode.l10n.t('Import settings'), { JSON: ['json'] }, false);
        if (!file) break;
        try {
          const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
          state.options = readOptions(parsed, state.options);
          post({ type: 'options', options: state.options });
        } catch (err) {
          vscode.window.showErrorMessage(vscode.l10n.t('Could not import settings: {0}', err instanceof Error ? err.message : String(err)));
        }
        break;
      }
      case 'cancelRun':
        running?.cancel();
        break;
      case 'check': {
        state.options = readOptions(m.options, state.options);
        await context.globalState.update(COMPLETENESS_STATE_KEY, state.options);
        running = new vscode.CancellationTokenSource();
        post({ type: 'busy', on: true });
        try {
          const issues = await runCompleteness(state.map, state.options, running.token);
          if (running.token.isCancellationRequested) {
            post({ type: 'notice', text: vscode.l10n.t('Check cancelled.') });
          } else {
            publishDiagnostics(issues);
            post({ type: 'results', ...summarize(issues) });
            if (issues.length > 0) void vscode.commands.executeCommand('workbench.actions.view.problems');
          }
        } catch (err) {
          post({ type: 'notice', text: vscode.l10n.t('Check failed: {0}', err instanceof Error ? err.message : String(err)) });
        } finally {
          running.dispose();
          running = undefined;
          post({ type: 'busy', on: false });
        }
        break;
      }
      case 'open': {
        const line = Math.max(0, Number(m.line ?? 1) - 1);
        await vscode.window.showTextDocument(vscode.Uri.file(String(m.path)), { selection: new vscode.Range(line, 0, line, 0), preview: true, viewColumn: vscode.ViewColumn.Beside });
        break;
      }
    }
  });
}

/** Runs the check for the given map, once per DITAVAL file (or once, unfiltered). */
export async function runCompleteness(map: string, options: CompletenessOptions, token?: vscode.CancellationToken): Promise<Issue[]> {
  const host = makeHost(token);
  const filters: Array<DitavalFilter | undefined> = [];
  if (options.ditavalFiles.length === 0) filters.push(undefined);
  for (const f of options.ditavalFiles) {
    try {
      filters.push(parseDitaval(await fsp.readFile(f, 'utf8')));
    } catch {
      vscode.window.showWarningMessage(vscode.l10n.t('DITAVAL file could not be read: {0}', f));
    }
  }
  const all: Issue[] = [];
  const seen = new Set<string>();
  const prefs = readProfilingPreferences();
  const extra = Object.keys(prefs.attributes).filter((a) => !['audience', 'platform', 'product', 'otherprops', 'props', 'rev'].includes(a));
  for (const filter of filters) {
    if (token?.isCancellationRequested) break;
    const crawl = await crawlMaps([map], host, { filter, extraProfilingAttributes: extra });
    const issues = await runChecks(crawl, options, { host, checkRemote: options.includeRemote ? checkRemote : undefined, preferences: prefs });
    for (const i of issues) {
      const key = `${i.category}\u0000${i.file}\u0000${i.line}\u0000${i.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        all.push(i);
      }
    }
  }
  return all;
}

function summarize(issues: Issue[]) {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const groups = CATEGORY_ORDER.map((c) => ({
    label: categoryLabel(c),
    items: issues
      .filter((i) => i.category === c)
      .map((i) => ({ file: i.file, line: i.line, severity: i.severity, text: localizeMsg(i.msg), name: basename(i.file) })),
  })).filter((g) => g.items.length > 0);
  return {
    summary:
      issues.length === 0
        ? vscode.l10n.t('No problems found.')
        : vscode.l10n.t('{0} error(s), {1} warning(s). Also shown in the Problems panel.', String(errors), String(warnings)),
    groups,
  };
}

const BOOL_OPTIONS: Array<keyof CompletenessOptions> = [
  'batchValidate', 'checkNonDita', 'includeRemote', 'reportOutsideMapFolder', 'reportUnreferencedLinks',
  'reportMultipleRefs', 'checkDuplicateTopicIds', 'reportDuplicateKeys', 'reportUnreferencedKeys',
  'reportUnreferencedReusable', 'reportTableProblems', 'identifyProfilingConflicts', 'reportProfilingPreferences',
];

/** Merges untrusted form/file input over a base, keeping only known keys of the right type. */
export function readOptions(input: unknown, base: CompletenessOptions): CompletenessOptions {
  const out: CompletenessOptions = { ...base, ditavalFiles: [...base.ditavalFiles] };
  if (!input || typeof input !== 'object') return out;
  const src = input as Record<string, unknown>;
  const o = out as unknown as Record<string, unknown>;
  for (const k of BOOL_OPTIONS) if (typeof src[k] === 'boolean') o[k] = src[k];
  if (Array.isArray(src.ditavalFiles)) out.ditavalFiles = src.ditavalFiles.filter((x): x is string => typeof x === 'string');
  return out;
}

function completenessHtml(state: CompletenessFormState): string {
  const o = state.options;
  const cb = (id: keyof CompletenessOptions, label: string, sub = false, hint = '') =>
    `<label class="${sub ? 'sub' : ''}" ${hint ? `title="${esc(hint)}"` : ''}><input type="checkbox" id="${id}" ${o[id] ? 'checked' : ''}>${esc(label)}</label>`;
  const body = `
<p class="lead">${esc(vscode.l10n.t('This operation will perform an XML validation and DITA completeness check on all the topics and maps referenced from the current map.'))}</p>
<div class="row"><span class="muted">${esc(vscode.l10n.t('Map:'))}</span><span class="grow" id="mapPath" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span><button id="changeMap">${esc(vscode.l10n.t('Change…'))}</button></div>
${cb('batchValidate', vscode.l10n.t('Batch validate referenced DITA resources'), false, vscode.l10n.t('XML well-formedness plus DITA structure (root element, topic id, title). No DTD/RNG validation.'))}
${cb('checkNonDita', vscode.l10n.t('Check the existence of referenced non-DITA resources'))}
${cb('includeRemote', vscode.l10n.t('Include remote resources'), true)}
<label><input type="checkbox" id="useDitaval" ${o.ditavalFiles.length ? 'checked' : ''}>${esc(vscode.l10n.t('Use DITAVAL filters:'))}</label>
<div class="sub" id="ditavalBox">
  <div class="list" id="ditaval"></div>
  <div class="row end"><button id="addDitaval">${esc(vscode.l10n.t('Add'))}</button><button id="removeDitaval">${esc(vscode.l10n.t('Remove'))}</button></div>
</div>
${cb('reportOutsideMapFolder', vscode.l10n.t('Report references to resources outside of the DITA map folder'))}
${cb('reportUnreferencedLinks', vscode.l10n.t('Report links to topics not referenced in DITA maps'))}
${cb('reportMultipleRefs', vscode.l10n.t('Report multiple references to the same topic'))}
${cb('checkDuplicateTopicIds', vscode.l10n.t('Check for duplicate topic IDs within the DITA map context'))}
${cb('reportDuplicateKeys', vscode.l10n.t('Report duplicate key definitions'))}
${cb('reportUnreferencedKeys', vscode.l10n.t('Report unreferenced key definitions'))}
${cb('reportUnreferencedReusable', vscode.l10n.t('Report unreferenced reusable elements'))}
${cb('reportTableProblems', vscode.l10n.t('Report table layout problems'))}
${cb('identifyProfilingConflicts', vscode.l10n.t('Identify possible conflicts in profiling attribute values'))}
${cb('reportProfilingPreferences', vscode.l10n.t('Report attributes and values that conflict with profiling preferences'), false, vscode.l10n.t('Uses the dita-viewer.completenessCheck.profilingAttributes setting.'))}
<div class="row" style="margin-top:14px">
  <button id="exportSettings">${esc(vscode.l10n.t('Export settings'))}</button><button id="importSettings">${esc(vscode.l10n.t('Import settings'))}</button>
  <span class="grow"></span>
  <button class="primary" id="check">${esc(vscode.l10n.t('Check'))}</button><button id="cancel" disabled>${esc(vscode.l10n.t('Cancel'))}</button>
</div>
<div id="results"></div>`;
  const script = `
${LIST_SCRIPT}
const ids = ${JSON.stringify(BOOL_OPTIONS)};
const $ = (id) => document.getElementById(id);
const ditaval = bindList('ditaval');
const NONE = ${JSON.stringify(vscode.l10n.t('(none)'))};
renderList(ditaval, ${JSON.stringify(o.ditavalFiles)}, NONE);
$('mapPath').textContent = ${JSON.stringify(state.map)};
$('mapPath').title = ${JSON.stringify(state.map)};
function syncDitaval() { const on = $('useDitaval').checked; $('ditavalBox').style.opacity = on ? 1 : .5; $('addDitaval').disabled = !on; $('removeDitaval').disabled = !on; }
$('useDitaval').onchange = syncDitaval; syncDitaval();
function collect() {
  const o = {};
  for (const id of ids) o[id] = $(id).checked;
  o.ditavalFiles = $('useDitaval').checked ? [...ditaval.querySelectorAll('div[data-v]')].map((d) => d.dataset.v) : [];
  return o;
}
$('addDitaval').onclick = () => { $('useDitaval').checked = true; vscode.postMessage({ type: 'addDitaval' }); };
$('removeDitaval').onclick = () => { const v = selected(ditaval); if (v) vscode.postMessage({ type: 'removeDitaval', value: v }); };
$('changeMap').onclick = () => vscode.postMessage({ type: 'changeMap' });
$('exportSettings').onclick = () => vscode.postMessage({ type: 'exportSettings', options: collect() });
$('importSettings').onclick = () => vscode.postMessage({ type: 'importSettings' });
$('check').onclick = () => vscode.postMessage({ type: 'check', options: collect() });
$('cancel').onclick = () => vscode.postMessage({ type: 'cancelRun' });
const SEV = { error: '✖', warning: '⚠', info: 'ℹ' };
window.addEventListener('message', (e) => {
  const m = e.data;
  if (m.type === 'ditaval') { renderList(ditaval, m.items, NONE); }
  else if (m.type === 'map') { $('mapPath').textContent = m.value; $('mapPath').title = m.value; }
  else if (m.type === 'options') { for (const id of ids) $(id).checked = !!m.options[id]; renderList(ditaval, m.options.ditavalFiles, NONE); $('useDitaval').checked = m.options.ditavalFiles.length > 0; syncDitaval(); }
  else if (m.type === 'busy') { $('check').disabled = m.on; $('cancel').disabled = !m.on; if (m.on) $('results').textContent = '…'; }
  else if (m.type === 'notice') { $('results').textContent = m.text; }
  else if (m.type === 'results') {
    const box = $('results'); box.textContent = '';
    const s = document.createElement('div'); s.textContent = m.summary; box.appendChild(s);
    for (const g of m.groups) {
      const h = document.createElement('div'); h.className = 'cat'; h.textContent = g.label + ' (' + g.items.length + ')'; box.appendChild(h);
      for (const it of g.items) {
        const d = document.createElement('div'); d.className = 'item'; d.title = it.file + ':' + it.line;
        const sev = document.createElement('span'); sev.className = 'sev sev-' + it.severity; sev.textContent = SEV[it.severity] || '';
        const txt = document.createElement('span'); txt.textContent = it.text;
        const loc = document.createElement('span'); loc.className = 'path'; loc.textContent = it.name + ':' + it.line;
        d.append(sev, txt, loc);
        d.onclick = () => vscode.postMessage({ type: 'open', path: it.file, line: it.line });
        box.appendChild(d);
      }
    }
  }
});`;
  return page(vscode.l10n.t('DITA Map Completeness Check'), body, script);
}

export function registerCompletenessCommand(context: vscode.ExtensionContext, deps: MapCheckDeps): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(VALIDATE_CMD, (arg?: unknown) => openCompletenessDialog(context, arg, deps)),
    new vscode.Disposable(() => {
      diagnostics?.dispose();
      diagnostics = undefined;
    }),
  );
}
