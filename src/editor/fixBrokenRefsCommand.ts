// "Fix Broken References…" (ditaViewer.fixBrokenReferences).
//
// The sibling of the rename participant for the renames VS Code never saw:
// `git mv`, a terminal `mv`, a file moved in another editor, or a reference
// that was broken before the extension existed. Rather than watch the file
// system and guess what moved (which gets it wrong), the command scans the
// references that are broken *now*, offers the workspace file each one
// probably meant, and applies the answers as one WorkspaceEdit.
//
// Scope is the whole workspace from the Command Palette, or the selected files
// and folders from the Explorer. Only "exactly one file of that name" is
// preselected: a name that differs in case only is a different file on a
// case-sensitive file system, and several files of that name is a question.

import * as vscode from 'vscode';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import {
  type ChosenFix,
  type FixPlan,
  type FixProposal,
  MAX_SCANNED_FILES,
  buildFileIndex,
  findBrokenRefs,
  proposeFixes,
  toRenames,
} from './brokenRefs';
import { type FileInput, computeRefEdits, stripBom } from './refRenameEdits';
import { dirtyFileDocuments, openFileDocuments, saveRefEdits, workspaceEditForRefEdits } from './refEditWorkspaceEdit';
import { normalizePathForCompare } from './mapReferenceTools';

const FIX_CMD = 'ditaViewer.fixBrokenReferences';
const SCAN_GLOB = '**/*.{dita,ditamap,xml}';
const SCAN_FILE_RE = /\.(dita|ditamap|xml)$/i;
const EXCLUDE_GLOB = '**/{node_modules,.git}/**';
const READ_CONCURRENCY = 32;

let channel: vscode.OutputChannel | undefined;

function output(): vscode.OutputChannel {
  channel ??= vscode.window.createOutputChannel('DITA Broken References');
  return channel;
}

const relLabel = (p: string): string => vscode.workspace.asRelativePath(p, false);

// ── Scan ────────────────────────────────────────────────────────────────

interface Scan {
  files: FileInput[];
  /** Text read for each scanned file, keyed by normalized path (for line numbers). */
  textBySource: Map<string, string>;
  openDocs: Map<string, vscode.TextDocument>;
  plan: FixPlan;
  truncated: boolean;
}

async function fileTypeOf(uri: vscode.Uri): Promise<vscode.FileType | undefined> {
  try {
    return (await vscode.workspace.fs.stat(uri)).type;
  } catch {
    return undefined;
  }
}

/** The .dita / .ditamap / .xml files in scope, capped like the rename scan. */
async function scanFiles(scope: vscode.Uri[] | undefined): Promise<{ uris: vscode.Uri[]; truncated: boolean }> {
  const found: vscode.Uri[] = [];
  const seen = new Set<string>();
  const add = (uri: vscode.Uri): void => {
    const key = normalizePathForCompare(uri.fsPath, process.platform);
    if (seen.has(key)) return;
    seen.add(key);
    found.push(uri);
  };

  const limit = MAX_SCANNED_FILES + 1;
  if (!scope || scope.length === 0) {
    for (const uri of await vscode.workspace.findFiles(SCAN_GLOB, EXCLUDE_GLOB, limit)) add(uri);
  } else {
    for (const item of scope) {
      const kind = await fileTypeOf(item);
      if (kind === undefined) continue;
      if (kind & vscode.FileType.Directory) {
        const pattern = new vscode.RelativePattern(item, SCAN_GLOB);
        for (const uri of await vscode.workspace.findFiles(pattern, EXCLUDE_GLOB, limit)) add(uri);
      } else if (SCAN_FILE_RE.test(item.fsPath)) {
        add(item);
      }
    }
  }

  const truncated = found.length > MAX_SCANNED_FILES;
  return { uris: truncated ? found.slice(0, MAX_SCANNED_FILES) : found, truncated };
}

/** Reads the scanned files, preferring an open editor's unsaved text. */
async function readScannedFiles(
  uris: vscode.Uri[],
  openDocs: Map<string, vscode.TextDocument>,
): Promise<FileInput[]> {
  const files: FileInput[] = [];
  const readOne = async (uri: vscode.Uri): Promise<FileInput | undefined> => {
    const normPath = normalizePathForCompare(uri.fsPath, process.platform);
    const openDoc = openDocs.get(normPath);
    if (openDoc) return { path: uri.fsPath, text: openDoc.getText() };
    try {
      return { path: uri.fsPath, text: stripBom(await readFile(uri.fsPath, 'utf8')) };
    } catch {
      return undefined;
    }
  };
  for (let i = 0; i < uris.length; i += READ_CONCURRENCY) {
    const batch = await Promise.all(uris.slice(i, i + READ_CONCURRENCY).map(readOne));
    for (const file of batch) if (file) files.push(file);
  }
  return files;
}

/** `exists` memoized per scan: one missing file is asked about by every reference to it. */
function memoizedExists(): (p: string) => boolean {
  const cache = new Map<string, boolean>();
  return (p: string) => {
    const key = normalizePathForCompare(p, process.platform);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const answer = existsSync(p);
    cache.set(key, answer);
    return answer;
  };
}

async function scan(scope: vscode.Uri[] | undefined): Promise<Scan | undefined> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t('Looking for broken references…'),
      cancellable: true,
    },
    async (_progress, token) => {
      const openDocs = openFileDocuments();
      const { uris, truncated } = await scanFiles(scope);
      if (token.isCancellationRequested) return undefined;

      const files = await readScannedFiles(uris, openDocs);
      if (token.isCancellationRequested) return undefined;

      const exists = memoizedExists();
      const broken = files.flatMap((file) =>
        findBrokenRefs({ file, exists, platform: process.platform }),
      );
      if (broken.length === 0) {
        return { files, textBySource: new Map(), openDocs, plan: { proposals: [], moves: [] }, truncated };
      }

      // One index for the whole workspace: candidates are matched by name only,
      // so a target is looked up, never crawled for.
      const indexUris = await vscode.workspace.findFiles('**/*', EXCLUDE_GLOB, MAX_SCANNED_FILES);
      const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
      const plan = proposeFixes({
        broken,
        index: buildFileIndex(
          indexUris.map((u) => u.fsPath),
          process.platform,
        ),
        platform: process.platform,
        roots,
      });

      const textBySource = new Map<string, string>();
      for (const file of files) {
        textBySource.set(normalizePathForCompare(file.path, process.platform), file.text);
      }
      return { files, textBySource, openDocs, plan, truncated };
    },
  );
}

// ── Picker ──────────────────────────────────────────────────────────────

interface FixPickItem extends vscode.QuickPickItem {
  proposal?: FixProposal;
}

interface CandidateItem extends vscode.QuickPickItem {
  path: string;
}

function counts(p: FixProposal): string {
  return vscode.l10n.t('{0} references in {1} files', String(p.target.refs.length), String(p.target.files.length));
}

function itemFor(p: FixProposal): FixPickItem {
  const label = relLabel(p.target.targetPath);
  const base = { proposal: p, label, description: counts(p) };
  switch (p.kind) {
    case 'unique':
      return {
        ...base,
        picked: true,
        description: `${counts(p)} · ${vscode.l10n.t('will become {0}', relLabel(p.preselect ?? ''))}`,
        iconPath: new vscode.ThemeIcon('check'),
      };
    case 'case':
      return {
        ...base,
        description: `${counts(p)} · ${vscode.l10n.t('only the case differs')}`,
        detail: relLabel(p.candidates[0]?.path ?? ''),
        iconPath: new vscode.ThemeIcon('warning'),
      };
    case 'multiple':
      return {
        ...base,
        description: `${counts(p)} · ${vscode.l10n.t('{0} files of that name', String(p.candidates.length))}`,
        detail: p.candidates.slice(0, 3).map((c) => relLabel(c.path)).join(' · '),
      };
    default:
      return {
        ...base,
        description: `${counts(p)} · ${vscode.l10n.t('no file of that name in the workspace')}`,
        iconPath: new vscode.ThemeIcon('question'),
      };
  }
}

function pickItems(plan: FixPlan): FixPickItem[] {
  const items: FixPickItem[] = [];
  const section = (label: string): void => {
    items.push({ label, kind: vscode.QuickPickItemKind.Separator });
  };
  const moves = new Map(plan.moves.map((m) => [m.key, m]));

  const fixable = plan.proposals.filter((p) => p.kind === 'unique' || p.kind === 'case');
  if (fixable.length > 0) {
    section(vscode.l10n.t('Can be fixed ({0})', String(fixable.length)));
    let shownMove: string | undefined;
    for (const p of fixable) {
      if (p.move && p.move !== shownMove) {
        const move = moves.get(p.move);
        if (move) {
          section(
            vscode.l10n.t('{0} → {1} ({2} references)', relLabel(move.oldDir), relLabel(move.newDir), String(move.references)),
          );
        }
      }
      shownMove = p.move;
      items.push(itemFor(p));
    }
  }

  const undecided = plan.proposals.filter((p) => p.kind === 'multiple');
  if (undecided.length > 0) {
    section(vscode.l10n.t('Needs a choice ({0})', String(undecided.length)));
    for (const p of undecided) items.push(itemFor(p));
  }

  const missing = plan.proposals.filter((p) => p.kind === 'none');
  if (missing.length > 0) {
    section(vscode.l10n.t('Not found in the workspace ({0})', String(missing.length)));
    for (const p of missing) items.push(itemFor(p));
  }
  return items;
}

/** Asks which file one undecidable target meant. */
async function chooseCandidate(p: FixProposal): Promise<string | undefined> {
  const items: CandidateItem[] = p.candidates.map((c) => ({
    path: c.path,
    label: relLabel(c.path),
    description: c.suggested
      ? vscode.l10n.t('suggested: it sits where the other missing files went')
      : c.sharedTail > 0
        ? vscode.l10n.t('shares {0} trailing path segment(s)', String(c.sharedTail))
        : undefined,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: vscode.l10n.t('Fix Broken References — {0}', p.target.fileName),
    placeHolder: vscode.l10n.t('{0} references in {1} files point at a file that is gone; which file did they mean?', String(p.target.refs.length), String(p.target.files.length)),
    matchOnDescription: true,
  });
  return picked?.path;
}

/** What a proposal resolves to without asking, or undefined when it must ask. */
function silentPath(p: FixProposal): string | undefined {
  if (p.preselect) return p.preselect;
  return p.kind === 'case' ? p.candidates[0]?.path : undefined;
}

// ── Apply ───────────────────────────────────────────────────────────────

async function applyChosen(scanResult: Scan, chosen: ChosenFix[]): Promise<{ updated: number; files: number }> {
  const renames = toRenames(chosen, process.platform);
  if (renames.length === 0) return { updated: 0, files: 0 };

  const fileEdits = computeRefEdits({ renames, files: scanResult.files, platform: process.platform });
  const applied = workspaceEditForRefEdits({
    fileEdits,
    textBySource: scanResult.textBySource,
    openDocs: scanResult.openDocs,
  });
  if (applied.replacements === 0) return { updated: 0, files: 0 };

  // One edit for the whole batch, so one undo takes all of it back.
  const dirtyBefore = dirtyFileDocuments();
  const ok = await vscode.workspace.applyEdit(applied.edit);
  if (!ok) {
    void vscode.window.showErrorMessage(vscode.l10n.t('The reference update could not be applied.'));
    return { updated: 0, files: 0 };
  }

  // The edit leaves a file it had to open as a dirty buffer, so the rewrite is
  // only on disk once that is saved -- and only buffers the edit itself made
  // dirty are saved, never one the user had unsaved work in.
  await saveRefEdits({ fileEdits, dirtyBefore });

  vscode.window.setStatusBarMessage(
    vscode.l10n.t('Updated {0} references in {1} files', String(applied.replacements), String(applied.fileCount)),
    5000,
  );
  return { updated: applied.replacements, files: applied.fileCount };
}

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

/** The targets no file of that name could be found for, where they are written. */
function reportUnmatched(scanResult: Scan): number {
  const unmatched = scanResult.plan.proposals.filter((p) => p.kind === 'none');
  if (unmatched.length === 0) return 0;

  const out = output();
  const count = unmatched.reduce((n, p) => n + p.target.refs.length, 0);
  out.appendLine(
    vscode.l10n.t('{0} reference(s) point at a file that is not in the workspace and no file of that name was found:', String(count)),
  );
  for (const p of unmatched) {
    for (const ref of p.target.refs) {
      const text = scanResult.textBySource.get(normalizePathForCompare(ref.file, process.platform)) ?? '';
      out.appendLine(`  ${relLabel(ref.file)}:${lineOf(text, ref.valueStart)}  ${ref.value}`);
    }
  }
  out.appendLine('');
  return unmatched.length;
}

// ── Command ─────────────────────────────────────────────────────────────

function scopeFromArgs(arg: unknown, more: unknown): vscode.Uri[] | undefined {
  const list = Array.isArray(more) ? more : Array.isArray(arg) ? arg : arg ? [arg] : [];
  const uris = list.filter((u): u is vscode.Uri => u instanceof vscode.Uri);
  return uris.length > 0 ? uris : undefined;
}

async function fixBrokenRefs(scope: vscode.Uri[] | undefined): Promise<{ updated: number; files: number }> {
  const scanResult = await scan(scope);
  if (!scanResult) return { updated: 0, files: 0 };

  if (scanResult.truncated) {
    void vscode.window.showWarningMessage(
      vscode.l10n.t('The scan stopped after {0} files; some references were not checked.', String(MAX_SCANNED_FILES)),
    );
  }

  const answerable = scanResult.plan.proposals.filter((p) => p.kind !== 'none');
  if (answerable.length === 0) {
    const unmatched = reportUnmatched(scanResult);
    if (unmatched > 0) {
      const show = vscode.l10n.t('Show Output');
      const pick = await vscode.window.showInformationMessage(
        vscode.l10n.t('No broken reference could be matched to a file in the workspace.'),
        show,
      );
      if (pick === show) output().show();
      return { updated: 0, files: 0 };
    }
    void vscode.window.showInformationMessage(
      vscode.l10n.t('No broken references found ({0} files scanned).', String(scanResult.files.length)),
    );
    return { updated: 0, files: 0 };
  }

  const picked = await vscode.window.showQuickPick(pickItems(scanResult.plan), {
    title: vscode.l10n.t('Fix Broken References'),
    placeHolder: vscode.l10n.t('Ticked references are rewritten; untick anything that should stay as it is. Items that need a choice ask for it after Enter.'),
    matchOnDescription: true,
    matchOnDetail: true,
    canPickMany: true,
  });
  if (!picked || picked.length === 0) return { updated: 0, files: 0 };

  const chosen: ChosenFix[] = [];
  for (const item of picked) {
    const proposal = item.proposal;
    if (!proposal || proposal.kind === 'none') continue;
    const targetPath = proposal.target.targetPath;
    if (proposal.kind === 'multiple') {
      const answer = await chooseCandidate(proposal);
      if (!answer) return { updated: 0, files: 0 }; // cancelled: apply nothing
      chosen.push({ targetPath, newPath: answer });
      continue;
    }
    const silent = silentPath(proposal);
    if (silent) chosen.push({ targetPath, newPath: silent });
  }

  const result = await applyChosen(scanResult, chosen);
  const unmatched = reportUnmatched(scanResult);
  if (result.updated > 0 && unmatched > 0) {
    const show = vscode.l10n.t('Show Output');
    const pick = await vscode.window.showInformationMessage(
      vscode.l10n.t('{0} missing target(s) had no matching file; they are listed in the output.', String(unmatched)),
      show,
    );
    if (pick === show) output().show();
  }
  return result;
}

export function registerFixBrokenRefsCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(FIX_CMD, (arg?: unknown, more?: unknown) =>
      fixBrokenRefs(scopeFromArgs(arg, more)),
    ),
    new vscode.Disposable(() => {
      channel?.dispose();
      channel = undefined;
    }),
  );
}

// ── Test seam ───────────────────────────────────────────────────────────
//
// The quick pick cannot be driven from @vscode/test-electron, so this runs the
// command's real scan (findFiles, disk reads, exists) and its real apply step
// for a scope and an explicit choice per target, and reports what the picker
// would have offered. `choose` overrides a target's preselection, which is how
// the suite covers the "needs a choice" path.

export interface BrokenRefFixResult {
  proposals: Array<{ target: string; kind: string; candidates: string[]; preselect?: string }>;
  updated: number;
  files: number;
}

export async function fixBrokenRefsForTesting(opts: {
  scope: string;
  choose?: Record<string, string>;
}): Promise<BrokenRefFixResult> {
  const scanResult = await scan([vscode.Uri.file(opts.scope)]);
  if (!scanResult) return { proposals: [], updated: 0, files: 0 };

  const chosen: ChosenFix[] = [];
  for (const p of scanResult.plan.proposals) {
    const override = opts.choose?.[p.target.targetPath];
    const silent = override ?? silentPath(p);
    if (silent) chosen.push({ targetPath: p.target.targetPath, newPath: silent });
  }

  const result = await applyChosen(scanResult, chosen);
  return {
    proposals: scanResult.plan.proposals.map((p) => ({
      target: p.target.targetPath,
      kind: p.kind,
      candidates: p.candidates.map((c) => c.path),
      preselect: p.preselect,
    })),
    ...result,
  };
}
