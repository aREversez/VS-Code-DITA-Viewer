// Quick Fix for a "Referenced file not found" diagnostic: the same repair
// "Fix Broken References…" offers, for the one target the cursor is on.
//
// The command repairs a batch and asks about each undecidable target; a Quick
// Fix has no room for a question, so it offers one action per candidate file
// instead of a picker. The target with exactly one file of that name is marked
// preferred, so Enter picks it, and a name that differs in case only is not
// preferred -- it is a different file on a case-sensitive file system, and that
// decision stays with the user, just as in the command's picker.
//
// Candidates are looked up when the lightbulb is asked for, not cached: a code
// action request costs one search for the file's name, and there is no index to
// go stale when a file is created, deleted or moved.
//
// The diagnostic is the whole input: its range is exactly the reference's value
// (see findBrokenRefs), so the target is re-read from the document instead of
// being carried on the Diagnostic -- which this version of the API has no field
// for anyway.

import * as vscode from 'vscode';
import { type BrokenRef, buildFileIndex, findBrokenRefs, proposeFixes } from './brokenRefs';
import { computeRefEdits } from './refRenameEdits';
import { workspaceEditForRefEdits } from './refEditWorkspaceEdit';
import { normalizePathForCompare } from './mapReferenceTools';

const MISSING_FILE_CODE = 'missing-file';
const EXCLUDE_GLOB = '**/{node_modules,.git}/**';

const DITA_SELECTOR: vscode.DocumentSelector = [
  { language: 'dita' },
  { language: 'ditamap' },
  { pattern: '**/*.dita' },
  { pattern: '**/*.ditamap' },
];

const relLabel = (p: string): string => vscode.workspace.asRelativePath(p, false);

function samePath(a: string, b: string): boolean {
  return normalizePathForCompare(a, process.platform) === normalizePathForCompare(b, process.platform);
}

/** Every reference in the document whose file part resolves to nothing. */
function brokenRefsIn(document: vscode.TextDocument): BrokenRef[] {
  return findBrokenRefs({
    file: { path: document.uri.fsPath, text: document.getText() },
    exists: () => false,
    platform: process.platform,
  });
}

/** The reference a diagnostic points at: its range is the attribute's value. */
function refAt(document: vscode.TextDocument, broken: BrokenRef[], diagnostic: vscode.Diagnostic): BrokenRef | undefined {
  const start = document.offsetAt(diagnostic.range.start);
  const end = document.offsetAt(diagnostic.range.end);
  return broken.find((ref) => ref.valueStart === start && ref.valueEnd === end);
}

/** Escapes the glob characters a file name may contain, so it is looked up literally. */
function globEscape(name: string): string {
  return name.replace(/[[\]{}*?]/g, (c) => `[${c}]`);
}

/**
 * The files in the workspace with this name. A name that cannot be written as
 * a glob has no candidates: the fix is still available from the command, which
 * has the whole index.
 */
async function filesNamed(name: string): Promise<string[]> {
  if (!name || /[[\]{}*?]/.test(name)) return [];
  try {
    const uris = await vscode.workspace.findFiles(`**/${globEscape(name)}`, EXCLUDE_GLOB);
    return uris.map((u) => u.fsPath);
  } catch {
    return [];
  }
}

/** The WorkspaceEdit that points this document's references at `newPath`. */
function editFor(document: vscode.TextDocument, targetPath: string, newPath: string): vscode.WorkspaceEdit | undefined {
  const text = document.getText();
  const sourcePath = document.uri.fsPath;
  const fileEdits = computeRefEdits({
    renames: [{ oldPath: targetPath, newPath }],
    files: [{ path: sourcePath, text }],
    platform: process.platform,
  });
  const key = normalizePathForCompare(sourcePath, process.platform);
  const applied = workspaceEditForRefEdits({
    fileEdits,
    textBySource: new Map([[key, text]]),
    openDocs: new Map([[key, document]]),
  });
  return applied.replacements > 0 ? applied.edit : undefined;
}

export class BrokenRefCodeActions implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  async provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): Promise<vscode.CodeAction[]> {
    const diagnostics = context.diagnostics.filter((d) => d.code === MISSING_FILE_CODE);
    if (diagnostics.length === 0) return [];

    const broken = brokenRefsIn(document);
    const actions: vscode.CodeAction[] = [];
    for (const diagnostic of diagnostics) {
      const ref = refAt(document, broken, diagnostic);
      if (ref) actions.push(...(await this.actionsFor(document, diagnostic, ref)));
    }
    return actions;
  }

  private async actionsFor(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic,
    ref: BrokenRef,
  ): Promise<vscode.CodeAction[]> {
    const targetPath = ref.targetPath;
    const fileName = targetPath.split(/[\\/]/).pop() ?? '';
    const found = await filesNamed(fileName);
    if (found.length === 0) return [];

    // Only this target: the group the picker would show is "every reference in
    // this file that points at the missing file", which is what one fix should
    // rewrite. Other missing targets keep their own diagnostics and fixes.
    const broken = brokenRefsIn(document).filter((r) => samePath(r.targetPath, targetPath));
    if (broken.length === 0) return [];

    const plan = proposeFixes({
      broken,
      index: buildFileIndex(found, process.platform),
      platform: process.platform,
      roots: (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    });
    const proposal = plan.proposals[0];
    if (!proposal) return [];

    const actions: vscode.CodeAction[] = [];
    for (const candidate of proposal.candidates) {
      const action = new vscode.CodeAction(
        vscode.l10n.t('Change to {0}', relLabel(candidate.path)),
        vscode.CodeActionKind.QuickFix,
      );
      action.diagnostics = [diagnostic];
      // A single file of that name is the answer, so it is Enter's default; a
      // case-only match and several files of that name are not.
      action.isPreferred = proposal.kind === 'unique' && candidate.path === proposal.preselect;
      action.edit = editFor(document, targetPath, candidate.path);
      if (action.edit) actions.push(action);
    }
    return actions;
  }
}

export function registerBrokenRefCodeActions(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(DITA_SELECTOR, new BrokenRefCodeActions(), {
      providedCodeActionKinds: BrokenRefCodeActions.providedCodeActionKinds,
    }),
  );
}
