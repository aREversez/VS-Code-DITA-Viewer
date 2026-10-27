// The host half of the Filter panel's DITAVAL row, shared by the topic preview
// and the map preview: remember which .ditaval a document uses, read it, and
// answer the webview's choose / clear requests.
//
// The webview owns the checkboxes and the hiding; the host owns the file dialog
// and the disk. A chosen file is kept per document (like the page-width choice)
// so a re-render or a reopened preview applies it again; it is read afresh on
// every full render, so the reload button picks up an edited .ditaval.

import * as vscode from 'vscode';
import { dirname } from 'path';
import { MSG_CHOOSE_DITAVAL, MSG_CLEAR_DITAVAL } from './mapMessages';
import { readForDocument, writeForDocument } from './perDocumentState';
import type { StateStore } from './perDocumentState';
import { readDitaval } from './ditavalPayload';
import type { DitavalPayload, DitavalProblem, DitavalRulePayload } from './ditavalPayload';
import { browseFiles } from './mapCheckShared';

/** Per-document: the absolute path of the .ditaval in force ('' once cleared). */
export const DITAVAL_KEY = 'ditaViewer.ditavalByUri';

/** What the webview receives: the payload with its problem already worded for the reader. */
export interface WebviewDitaval {
  name: string;
  rules: DitavalRulePayload[];
  error?: string;
}

function describeProblem(problem: DitavalProblem): string {
  switch (problem.kind) {
    case 'missing':
      return vscode.l10n.t('The DITAVAL file does not exist.');
    case 'unreadable':
      return vscode.l10n.t('The DITAVAL file could not be read: {0}', problem.detail);
    case 'malformed':
      return vscode.l10n.t('The DITAVAL file is not well-formed XML ({0}).', problem.detail);
  }
}

function toWebview(payload: DitavalPayload): WebviewDitaval {
  const out: WebviewDitaval = { name: payload.name, rules: payload.rules };
  if (payload.problem) out.error = describeProblem(payload.problem);
  return out;
}

/** The .ditaval a document currently uses, read from disk; null when none is chosen. */
export function ditavalForDocument(store: StateStore, uri: vscode.Uri): WebviewDitaval | null {
  const path = readForDocument<string>(store, DITAVAL_KEY, uri);
  return typeof path === 'string' && path !== '' ? toWebview(readDitaval(path)) : null;
}

/** True for the two request types the webview posts from the Filter panel. */
export function isDitavalRequest(type: unknown): type is typeof MSG_CHOOSE_DITAVAL | typeof MSG_CLEAR_DITAVAL {
  return type === MSG_CHOOSE_DITAVAL || type === MSG_CLEAR_DITAVAL;
}

/**
 * Answer a choose / clear request: ask for the file and remember the choice.
 * Resolves to what the webview should now apply (null = no filter), or to
 * undefined when the dialog was dismissed and nothing changed. The caller
 * posts it as MSG_SET_DITAVAL itself, so each provider's post stays visible to
 * scripts/check-map-message-parity.cjs.
 */
export async function handleDitavalRequest(
  type: typeof MSG_CHOOSE_DITAVAL | typeof MSG_CLEAR_DITAVAL,
  store: StateStore,
  document: vscode.TextDocument,
): Promise<{ ditaval: WebviewDitaval | null } | undefined> {
  if (type === MSG_CLEAR_DITAVAL) {
    writeForDocument(store, DITAVAL_KEY, document.uri, '');
    return { ditaval: null };
  }
  const previous = readForDocument<string>(store, DITAVAL_KEY, document.uri);
  const [picked] = await browseFiles(vscode.l10n.t('DITAVAL Filter Files'), ['ditaval'], false, previous || dirname(document.uri.fsPath));
  if (!picked) return undefined;
  writeForDocument(store, DITAVAL_KEY, document.uri, picked);
  return { ditaval: toWebview(readDitaval(picked)) };
}
