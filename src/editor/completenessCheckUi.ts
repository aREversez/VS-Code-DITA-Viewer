// "Validate and Check for Completeness" (ditaViewer.validateMapCompleteness).
//
// Native VS Code UI: one multi-select quick pick lists the checks (Oxygen's
// option set, grouped, with the last choice checked; Enter runs it), a
// notification shows progress with a cancel button, findings go to the
// Problems panel and to the Map Checks view in the Explorer. Which checks
// are on and which DITAVAL files apply are ordinary settings
// (dita-viewer.completenessCheck.*), so a team can share them in
// .vscode/settings.json. The checks themselves are pure and live in
// mapCrawl.ts / mapChecks.ts.

import * as vscode from 'vscode';
import { promises as fsp } from 'fs';
import { basename, dirname } from 'path';
import { crawlMaps } from './mapCrawl';
import { parseDitaval, DitavalFilter } from './ditaval';
import {
  CheckId,
  CompletenessOptions,
  DEFAULT_ENABLED_CHECKS,
  Issue,
  IssueCategory,
  ProfilingPreferences,
  normalizeEnabled,
  optionsFromSettings,
  resolveStoredPath,
  runChecks,
  toStoredPath,
} from './mapChecks';
import { Msg, MsgCode, formatMessage } from './mapCheckMessages';
import {
  MapCheckDeps,
  activeMapPath,
  browseFiles,
  makeHost,
  mapFromArg,
  updateSetting,
} from './mapCheckShared';
import { CompletenessState, MapChecksView } from './mapCheckResultsView';

const VALIDATE_CMD = 'ditaViewer.validateMapCompleteness';
const SETTINGS = 'dita-viewer.completenessCheck';

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


// -- Settings ---------------------------------------------------------------

function readEnabled(): string[] {
  const v = vscode.workspace.getConfiguration(SETTINGS).get<string[]>('enabledChecks');
  return Array.isArray(v) ? v : DEFAULT_ENABLED_CHECKS;
}

function readDitavalFiles(mapDir: string): string[] {
  const v = vscode.workspace.getConfiguration(SETTINGS).get<string[]>('ditavalFiles');
  return (Array.isArray(v) ? v : []).map((s) => resolveStoredPath(mapDir, s));
}

// -- The check picker ---------------------------------------------------------

interface CheckItem extends vscode.QuickPickItem {
  id?: CheckId;
}

function checkItems(picked: Set<string>, ditavalCount: number): CheckItem[] {
  const it = (id: CheckId, label: string, description?: string): CheckItem => ({ id, label, description, picked: picked.has(id) });
  const sep = (label: string): CheckItem => ({ label, kind: vscode.QuickPickItemKind.Separator });
  return [
    sep(vscode.l10n.t('Files and resources')),
    it('batchValidate', vscode.l10n.t('Validate referenced DITA files'), vscode.l10n.t('XML errors; topic id, title and root element')),
    it('checkNonDita', vscode.l10n.t('Check that referenced images and other files exist')),
    it('includeRemote', vscode.l10n.t('Also check remote (http/https) resources'), vscode.l10n.t('needs the check above')),
    it(
      'useDitaval',
      vscode.l10n.t('Filter with DITAVAL files'),
      ditavalCount > 0 ? vscode.l10n.t('{0} file(s) — check runs once per file', String(ditavalCount)) : vscode.l10n.t('choose files after accepting'),
    ),
    sep(vscode.l10n.t('References')),
    it('reportOutsideMapFolder', vscode.l10n.t('References to resources outside the map folder')),
    it('reportUnreferencedLinks', vscode.l10n.t('Links to topics not referenced in any map')),
    it('reportMultipleRefs', vscode.l10n.t('Multiple references to the same topic'), vscode.l10n.t('a unique copy-to counts as a different topic')),
    sep(vscode.l10n.t('IDs and keys')),
    it('checkDuplicateTopicIds', vscode.l10n.t('Duplicate topic IDs within the map')),
    it('reportDuplicateKeys', vscode.l10n.t('Duplicate key definitions')),
    it('reportUnreferencedKeys', vscode.l10n.t('Unreferenced key definitions')),
    it('reportUnreferencedReusable', vscode.l10n.t('Unreferenced reusable elements'), vscode.l10n.t('ids in resource-only topics that no conref uses')),
    sep(vscode.l10n.t('Content')),
    it('reportTableProblems', vscode.l10n.t('Table layout problems')),
    it('identifyProfilingConflicts', vscode.l10n.t('Conflicts in profiling attribute values')),
    it('reportProfilingPreferences', vscode.l10n.t('Attributes and values that conflict with profiling preferences'), vscode.l10n.t('uses the profiling settings')),
  ];
}

type PickResult = { picked: CheckId[]; map: string } | undefined;

function pickChecks(map: string, ditavalCount: number): Promise<PickResult> {
  return new Promise((resolve) => {
    let currentMap = map;
    const qp = vscode.window.createQuickPick<CheckItem>();
    qp.canSelectMany = true;
    qp.ignoreFocusOut = true;
    qp.matchOnDescription = true;
    const setTitle = () => (qp.title = vscode.l10n.t('Validate and Check for Completeness — {0}', basename(currentMap)));
    setTitle();
    qp.placeholder = vscode.l10n.t('Choose the checks to run, then press Enter');
    const items = checkItems(new Set(readEnabled()), ditavalCount);
    qp.items = items;
    qp.selectedItems = items.filter((i) => i.picked);
    const btn = (icon: string, tooltip: string): vscode.QuickInputButton => ({ iconPath: new vscode.ThemeIcon(icon), tooltip });
    const changeMap = btn('file-code', vscode.l10n.t('Choose another map…'));
    const openSettings = btn('gear', vscode.l10n.t('Profiling and other settings'));
    qp.buttons = [changeMap, openSettings];
    let done = false;
    const finish = (v: PickResult) => {
      if (done) return;
      done = true;
      resolve(v);
      qp.dispose();
    };
    qp.onDidTriggerButton(async (b) => {
      if (b === changeMap) {
        const [m] = await browseFiles(vscode.l10n.t('DITA Maps'), ['ditamap'], false);
        if (m) {
          currentMap = m;
          setTitle();
        }
      } else if (b === openSettings) {
        void vscode.commands.executeCommand('workbench.action.openSettings', SETTINGS);
      }
    });
    qp.onDidAccept(() => finish({ picked: qp.selectedItems.map((i) => i.id).filter((x): x is CheckId => !!x), map: currentMap }));
    qp.onDidHide(() => finish(undefined));
    qp.show();
  });
}

// -- Running --------------------------------------------------------------------

function toState(map: string, issues: Issue[]): CompletenessState {
  const groups = CATEGORY_ORDER.map((c) => ({
    label: categoryLabel(c),
    items: issues
      .filter((i) => i.category === c)
      .map((i) => ({ file: i.file, line: i.line, severity: i.severity, text: localizeMsg(i.msg), related: i.related })),
  })).filter((g) => g.items.length > 0);
  return {
    map,
    groups,
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
  };
}

let lastMap: string | undefined;

async function run(view: MapChecksView, map: string): Promise<void> {
  lastMap = map;
  const options = optionsFromSettings(readEnabled(), readDitavalFiles(dirname(map)));
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Checking {0}…', basename(map)), cancellable: true },
    async (_progress, token) => {
      try {
        const issues = await runCompleteness(map, options, token);
        if (token.isCancellationRequested) return;
        publishDiagnostics(issues);
        view.setCompleteness(toState(map, issues));
        await view.reveal();
      } catch (err) {
        void vscode.window.showErrorMessage(vscode.l10n.t('Check failed: {0}', err instanceof Error ? err.message : String(err)));
      }
    },
  );
}

/** Asks which checks to run (remembering the answer in settings), then runs them. */
async function chooseAndRun(view: MapChecksView, map: string): Promise<void> {
  const ditavalCount = readDitavalFiles(dirname(map)).length;
  const res = await pickChecks(map, ditavalCount);
  if (!res) return;
  let picked = normalizeEnabled(res.picked);
  if (picked.includes('useDitaval') && readDitavalFiles(dirname(res.map)).length === 0) {
    const files = await browseFiles(vscode.l10n.t('DITAVAL Filter Files'), ['ditaval'], true);
    if (files.length === 0) picked = picked.filter((id) => id !== 'useDitaval');
    else await updateSetting(SETTINGS, 'ditavalFiles', files.map((f) => toStoredPath(dirname(res.map), f)));
  }
  await updateSetting(SETTINGS, 'enabledChecks', picked);
  await run(view, res.map);
}

export function registerCompletenessCommand(context: vscode.ExtensionContext, deps: MapCheckDeps, view: MapChecksView): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(VALIDATE_CMD, async (arg?: unknown) => {
      const map = mapFromArg(arg) ?? activeMapPath(deps) ?? lastMap;
      if (!map) {
        void vscode.window.showErrorMessage(vscode.l10n.t('Please open a .ditamap file first.'));
        return;
      }
      await chooseAndRun(view, map);
    }),
    vscode.commands.registerCommand('ditaViewer.mapChecks.rerunCompleteness', async () => {
      const last = view.lastCompleteness;
      if (last) await run(view, last.map);
    }),
    vscode.commands.registerCommand('ditaViewer.mapChecks.changeCompleteness', async () => {
      const map = view.lastCompleteness?.map ?? activeMapPath(deps) ?? lastMap;
      if (map) await chooseAndRun(view, map);
    }),
    new vscode.Disposable(() => {
      diagnostics?.dispose();
      diagnostics = undefined;
    }),
  );
}
