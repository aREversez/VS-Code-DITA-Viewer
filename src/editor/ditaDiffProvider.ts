// Diff/Compare view — command registration, QuickPick version selection,
// webview panel creation, and HTML assembly for side-by-side rendered DITA diff.

import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { dirname, join, basename, resolve } from 'path';
import { DitaNode } from '../parser/domTypes';
import { renderElement, RenderContext } from '../render/renderer';
import {
  buildKeyMap,
} from './DitaViewerProvider';
import {
  decodeHrefPart,
  escapeHtml,
  getImageLightboxScript,
} from './ditaRenderUtils';
import { sharedWebviewStrings } from './webviewL10n';
import { buildRenderContext } from './renderContext';
import {
  diffTopics,
  AlignedRow,
  TopicDiffResult,
  applyInlineMarksToHtml,
  swapAlignedRows,
  buildQuickCommitChoices,
  arrangeByRecency,
} from './ditaDiffEngine';
import {
  getRepoRoot,
  toRepoRelPath,
  getFileAtRef,
  listFileCommits,
  getLocalContent,
  hasUncommittedChanges,
  GitCommitInfo,
} from './ditaGitUtils';
import { getActiveDitaUri } from './exportHtml';
import { ensureCommandAllowed } from './workspaceTrustGate';
import { ensureDitaDiffVirtualDocuments, DITA_DIFF_SCHEME } from './ditaDiffVirtualDoc';

const DIFF_PANELS = new Map<string, vscode.WebviewPanel>();

// Test hook, same idea as getLastRenderedHtmlForTesting in DitaViewerProvider:
// VS Code gives a test no handle on a webview panel's HTML, so each diff render
// records its output here, keyed by the compared document's URI.
const lastDiffHtmlByUri = new Map<string, string>();

export function getLastDiffHtmlForTesting(uriString: string): string | undefined {
  return lastDiffHtmlByUri.get(uriString);
}

function recordDiffHtml(panel: vscode.WebviewPanel, html: string): void {
  for (const [key, p] of DIFF_PANELS) if (p === panel) lastDiffHtmlByUri.set(key, html);
}

// Holds whatever the panel should currently render. A single message
// listener (registered once per panel, in getOrCreateDiffPanel) reads
// from this on every 'swapSides' message, instead of each render call
// registering its own listener closed over that call's own `result` --
// re-comparing the same file re-uses the existing panel (see
// getOrCreateDiffPanel), and a naive listener-per-render-call would leave
// old listeners (closed over stale results) stacking up alongside the
// new one, firing the swap handler multiple times per click.
//
// The raw left/right XML is kept alongside the structured rows purely so the
// toolbar can hand the exact same two versions to VS Code's native diff editor
// on demand (see openSourceDiff) -- the rendered view never needs it.
type DiffPanelState = {
  result: TopicDiffResult;
  leftXml: string;
  rightXml: string;
  leftLabel: string;
  rightLabel: string;
  docUri: vscode.Uri;
};
const DIFF_STATE = new WeakMap<vscode.WebviewPanel, DiffPanelState>();

export function registerCompareCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ditaViewer.compareWithGit', async () => {
      // The diff shells out to `git` (ditaGitUtils.ts); an untrusted
      // workspace stops at the gate rather than running it.
      if (!(await ensureCommandAllowed('ditaViewer.compareWithGit'))) return;
      const uri = getActiveDitaUri();
      if (!uri || !uri.fsPath.toLowerCase().endsWith('.dita')) {
        vscode.window.showErrorMessage(vscode.l10n.t('Please open a .dita file first.'));
        return;
      }

      const docDir = dirname(uri.fsPath);
      const repoRoot = await getRepoRoot(docDir);
      if (!repoRoot) {
        vscode.window.showErrorMessage(vscode.l10n.t('Not a Git repository: {0}', docDir));
        return;
      }

      const relPath = toRepoRelPath(repoRoot, uri.fsPath);
      if (relPath.startsWith('..')) {
        vscode.window.showErrorMessage(vscode.l10n.t('Not a Git repository: {0}', docDir));
        return;
      }

      const commits = await listFileCommits(repoRoot, relPath);
      const hasLocal = await hasUncommittedChanges(repoRoot, relPath);

      interface VersionChoice {
        label: string;
        description?: string;
        // Recency rank, lower = newer -- see arrangeByRecency. Working copy
        // is always the newest possible content; commit-backed choices use
        // their position in `commits` (git log order: index 0 is newest).
        resolve: () => Promise<{ xml: string; label: string; order: number } | undefined>;
      }

      const choices: VersionChoice[] = [];

      choices.push({
        label: '$(file) Working copy' + (hasLocal ? ' •' : ''),
        description: vscode.l10n.t('includes unsaved changes'),
        resolve: async () => ({ xml: await getLocalContent(uri), label: vscode.l10n.t('Working copy'), order: -1 }),
      });

      const quickChoices = buildQuickCommitChoices(commits);

      if (quickChoices[0]) {
        const c = quickChoices[0];
        choices.push({
          label: `$(git-commit) ${vscode.l10n.t('Last commit to this file')} — ${c.shortHash}`,
          description: c.subject,
          resolve: async () => {
            const xml = await getFileAtRef(repoRoot, relPath, c.refHash);
            return xml ? { xml, label: `${c.shortHash} ${c.subject}`, order: 0 } : undefined;
          },
        });
      }

      if (quickChoices[1]) {
        const c = quickChoices[1];
        choices.push({
          label: `$(git-commit) ${vscode.l10n.t('Previous commit to this file')} — ${c.shortHash}`,
          description: c.subject,
          resolve: async () => {
            const xml = await getFileAtRef(repoRoot, relPath, c.refHash);
            return xml ? { xml, label: `${c.shortHash} ${c.subject}`, order: 1 } : undefined;
          },
        });
      }

      choices.push({
        label: '$(git-commit) Pick a specific commit…',
        resolve: async () => {
          const picked = await pickCommit(commits);
          if (!picked) return undefined;
          const xml = await getFileAtRef(repoRoot, relPath, picked.hash);
          if (!xml) return undefined;
          const order = commits.findIndex((c) => c.hash === picked.hash);
          return { xml, label: `${picked.shortHash} ${picked.subject}`, order: order >= 0 ? order : commits.length };
        },
      });

      const leftChoice = await vscode.window.showQuickPick(choices, {
        placeHolder: vscode.l10n.t('Select the base (older) version'),
        title: vscode.l10n.t('Compare with Git Version'),
      });
      if (!leftChoice) return;

      const leftResult = await leftChoice.resolve();
      if (!leftResult) {
        vscode.window.showErrorMessage(vscode.l10n.t('Could not read the selected version.'));
        return;
      }

      const rightChoices = choices.filter((c) => c !== leftChoice);
      const rightChoice = await vscode.window.showQuickPick(rightChoices, {
        placeHolder: vscode.l10n.t('Select the version to compare against'),
        title: vscode.l10n.t('Compare with Git Version'),
      });
      if (!rightChoice) return;

      const rightResult = await rightChoice.resolve();
      if (!rightResult) {
        vscode.window.showErrorMessage(vscode.l10n.t('Could not read the selected version.'));
        return;
      }

      // Place the older version on the left and the newer on the right
      // regardless of which the user actually picked first -- see
      // arrangeByRecency for why pick order alone isn't reliable here.
      const { left: finalLeft, right: finalRight } = arrangeByRecency(leftResult, rightResult);

      const panel = getOrCreateDiffPanel(context, uri, finalLeft.label, finalRight.label);

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Computing differences…') },
        async () => {
          try {
            const result = computeDiff(finalLeft.xml, finalRight.xml, docDir, uri, panel.webview);
            renderDiffPanel(context, panel, {
              result,
              leftXml: finalLeft.xml,
              rightXml: finalRight.xml,
              leftLabel: finalLeft.label,
              rightLabel: finalRight.label,
              docUri: uri,
            });
          } catch (err) {
            // Defense-in-depth, not a substitute for fixing known failure
            // causes at their source: computeDiff/openDiffPanel are pure
            // rendering/diffing logic with no reason to throw in normal
            // operation, but this ensures any future regression here
            // surfaces as a readable message instead of VS Code's generic
            // "command failed" notification with no indication of why.
            const message = err instanceof Error ? err.message : String(err);
            console.error('Compare with Git Version failed:', err);
            vscode.window.showErrorMessage(
              vscode.l10n.t('Could not compute the difference: {0}', message),
            );
          }
        },
      );
    }),
  );

  registerShowRenderedDiffFromSource(context);
}

async function pickCommit(commits: GitCommitInfo[]): Promise<GitCommitInfo | undefined> {
  if (commits.length === 0) {
    vscode.window.showErrorMessage(vscode.l10n.t('This file has no committed history yet.'));
    return undefined;
  }
  return vscode.window.showQuickPick(
    commits.map((c) => ({
      label: `$(git-commit) ${c.shortHash} ${c.subject}`,
      description: `${c.date} · ${c.author}`,
      commit: c,
    })),
    { placeHolder: vscode.l10n.t('Select a commit') },
  ).then((picked) => picked?.commit);
}

function computeDiff(
  leftXml: string,
  rightXml: string,
  docDir: string,
  docUri: vscode.Uri,
  webview: vscode.Webview,
): TopicDiffResult {
  const keyMap = buildKeyMap(docUri);

  // Factory, not a single pre-built function: note-label resolution needs
  // each side's ACTUAL parsed root (a topic's own xml:lang, if declared,
  // takes priority over the VS Code UI language -- same rule
  // detectNoteLabels already applies for the regular single-topic preview
  // path). Building one context up front, before either side was parsed,
  // meant there was no real root available yet -- that previously led to
  // passing a placeholder in its place, which crashed on every use. Called
  // once per side, after diffTopics has actually parsed that side's XML.
  const buildRenderBlock = (root: DitaNode, sideDocDir: string) => {
    const { ctx } = buildRenderContext({
      docDir: sideDocDir,
      ownRoot: root,
      titleMap: new Map<string, string>(),
      keyMap,
      // The single-topic preview (DitaViewerProvider.ts) has always used
      // the real webview.asWebviewUri() -- the only URI scheme a webview's
      // CSP + localResourceRoots will actually let an <img> load from.
      // This diff panel used a hand-rolled 'vscode-resource:' + path string
      // instead, a scheme VS Code stopped supporting years ago; every image
      // in the diff view failed to load, silently. Fixed by reusing the real
      // webview instance -- see getOrCreateDiffPanel.
      asWebviewUri: (relPath: string) => {
        try {
          return webview.asWebviewUri(vscode.Uri.file(resolve(sideDocDir, decodeHrefPart(relPath)))).toString();
        } catch {
          return relPath;
        }
      },
      headingLevel: 1,
      uiLanguage: vscode.env.language,
      // includeIndexLabel omitted: the diff view never surfaces indexterm
      // chips, so it has never set ctx.indexLabel (preserved byte-for-byte).
    });

    return (node: DitaNode, parentBaseType: string, headingLevel: number) => {
      const blockCtx: RenderContext = { ...ctx, headingLevel, parentBaseType };
      return renderElement(node, blockCtx);
    };
  };

  return diffTopics({
    leftXml,
    rightXml,
    leftDocDir: docDir,
    rightDocDir: docDir,
    renderBlockFactory: buildRenderBlock,
  });
}

// Split out of openDiffPanel: the panel now needs to exist (so its real
// webview.asWebviewUri is available to computeDiff -- see above) BEFORE
// the diff itself is computed, not after.
function getOrCreateDiffPanel(
  context: vscode.ExtensionContext,
  uri: vscode.Uri,
  leftLabel: string,
  rightLabel: string,
): vscode.WebviewPanel {
  const key = uri.toString();
  const existing = DIFF_PANELS.get(key);
  if (existing) {
    existing.reveal();
    return existing;
  }

  const fileName = basename(uri.fsPath);
  const panel = vscode.window.createWebviewPanel(
    'ditaViewer.diff',
    `$(diff) ${fileName} — ${leftLabel} ↔ ${rightLabel}`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.file(context.extensionPath),
        vscode.Uri.file(dirname(uri.fsPath)),
        ...(vscode.workspace.workspaceFolders?.map((f) => f.uri) || []),
      ],
    },
  );

  DIFF_PANELS.set(key, panel);
  panel.onDidDispose(() => {
    DIFF_PANELS.delete(key);
    DIFF_STATE.delete(panel);
    lastDiffHtmlByUri.delete(key);
  });

  panel.webview.onDidReceiveMessage((msg) => {
    const state = DIFF_STATE.get(panel);
    if (!state) return;
    if (msg.type === 'swapSides') {
      // Swap is a whole-state flip: the rows, the labels, AND the raw XML both
      // turn around, so the native source diff (openSourceDiff below) always
      // reflects whatever the rendered view is currently showing.
      const swapped: DiffPanelState = {
        result: { ...state.result, rows: swapAlignedRows(state.result.rows) },
        leftXml: state.rightXml,
        rightXml: state.leftXml,
        leftLabel: state.rightLabel,
        rightLabel: state.leftLabel,
        docUri: state.docUri,
      };
      renderDiffPanel(context, panel, swapped);
    } else if (msg.type === 'openSourceDiff') {
      void openSourceDiff(context, state);
    }
  });

  return panel;
}

// Publish the two versions as in-memory documents and open VS Code's native
// diff editor over them. Reused URIs (keyed by document + side) mean repeated
// clicks refresh the same tab rather than stacking new ones; the query carries
// the original document URI so the native side can offer a way back here (see
// registerShowRenderedDiffFromSource).
async function openSourceDiff(context: vscode.ExtensionContext, state: DiffPanelState): Promise<void> {
  const docs = ensureDitaDiffVirtualDocuments(context);
  const docKey = state.docUri.toString();
  const stem = `${encodeURIComponent(basename(state.docUri.fsPath))}-${shortId(docKey)}`;
  const query = `doc=${encodeURIComponent(docKey)}`;
  const leftUri = vscode.Uri.from({ scheme: DITA_DIFF_SCHEME, path: `/${stem}.left.dita`, query });
  const rightUri = vscode.Uri.from({ scheme: DITA_DIFF_SCHEME, path: `/${stem}.right.dita`, query });
  docs.setContent(leftUri, state.leftXml);
  docs.setContent(rightUri, state.rightXml);
  const title = `${basename(state.docUri.fsPath)}: ${state.leftLabel} ↔ ${state.rightLabel}`;
  await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
}

// Test seam: drive openSourceDiff directly from the integration suite so it can
// verify that vscode.diff on the virtual .dita URIs actually opens the native
// text diff editor and is NOT hijacked by the ditaViewer.preview custom editor.
// The @vscode/test-electron harness cannot click a webview toolbar button, so
// this is the only way to exercise the end-to-end source-diff path in a real
// VS Code instance. openSourceDiff reads only leftXml/rightXml/labels/docUri
// from state (never result), so we construct a minimal state just for it.
export async function openSourceDiffForTesting(
  context: vscode.ExtensionContext,
  input: { leftXml: string; rightXml: string; leftLabel: string; rightLabel: string; docUri: vscode.Uri },
): Promise<void> {
  const state = { ...input, result: undefined! } as unknown as DiffPanelState;
  await openSourceDiff(context, state);
}

// A compact, collision-resistant identity for a document URI, used to namespace
// its two virtual source files so two different .dita files never share a path.
function shortId(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

// Reverse of openSourceDiff: from VS Code's native source-diff editor, jump
// back to this extension's rendered diff panel for the same comparison. The
// bridge is the `doc=` query openSourceDiff stamps on both virtual URIs -- it
// carries the compared document's URI, which is exactly the key DIFF_PANELS is
// indexed by, so the panel is still alive we simply reveal it.
function registerShowRenderedDiffFromSource(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ditaViewer.showRenderedDiffFromSource', async () => {
      const docKey = docKeyFromSourceDiffUri();
      const panel = docKey ? DIFF_PANELS.get(docKey) : undefined;
      if (panel) {
        panel.reveal();
        return;
      }
      // Panel closed since the source diff was opened (or this native diff was
      // not one of ours): re-run the compare command rather than dead-end.
      await vscode.commands.executeCommand('ditaViewer.compareWithGit');
    }),
  );
}

// Resolve the compared document's key from whichever source-diff side currently
// has focus. A diff editor exposes its panes several ways depending on where the
// caret is, so check the active text editor and, failing that, the active tab's
// diff input (either pane carries the same `doc=` query).
function docKeyFromSourceDiffUri(): string | undefined {
  const candidates: vscode.Uri[] = [];
  const editorUri = vscode.window.activeTextEditor?.document.uri;
  if (editorUri) candidates.push(editorUri);
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input instanceof vscode.TabInputTextDiff) candidates.push(input.modified, input.original);
  else if (input instanceof vscode.TabInputText) candidates.push(input.uri);
  for (const uri of candidates) {
    if (uri.scheme === DITA_DIFF_SCHEME) {
      return new URLSearchParams(uri.query).get('doc') ?? undefined;
    }
  }
  return undefined;
}

function renderDiffPanel(
  context: vscode.ExtensionContext,
  panel: vscode.WebviewPanel,
  state: DiffPanelState,
): void {
  DIFF_STATE.set(panel, state);
  panel.webview.html = buildDiffHtml(context, panel.webview, state.result, state.leftLabel, state.rightLabel);
  recordDiffHtml(panel, panel.webview.html);
}

function buildDiffHtml(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
  result: TopicDiffResult,
  leftLabel: string,
  rightLabel: string,
): string {
  const stylesUri = webview.asWebviewUri(
    vscode.Uri.file(join(context.extensionPath, 'media', 'styles.css')),
  );
  const diffStylesUri = webview.asWebviewUri(
    vscode.Uri.file(join(context.extensionPath, 'media', 'diff-styles.css')),
  );
  // The diff panel's script is a real file rather than a template literal in
  // this one: it reads, diffs, lints and syntax-highlights as the JavaScript it
  // is, and nobody has to reason about escaping inside a string that is itself
  // inside a string. Loaded externally, so the nonce goes on the tag that
  // names it -- see the <script> at the end of the body. It has no
  // interpolations, which is what makes it the cheap end of the extraction and
  // therefore the right one to prove the mechanism on; the scripts that do
  // interpolate need a placeholder convention on top of this.
  const diffScriptUri = webview.asWebviewUri(
    vscode.Uri.file(join(context.extensionPath, 'media', 'diff-webview.js')),
  );

  const nonce = randomBytes(16).toString('base64');
  const theme = vscode.window.activeColorTheme;
  const isDark = theme.kind === vscode.ColorThemeKind.Dark || theme.kind === vscode.ColorThemeKind.HighContrast;

  // Click-to-enlarge lightbox + image copy menu -- the same script the topic
  // and map previews embed. styles.css gives every rendered image cursor:zoom-in
  // in this webview too (it links the shared styles.css), so a diff-view image
  // showed the magnifying-glass cursor but clicking did nothing until now.
  // Injected inline (not merged into diff-webview.js) because it interpolates
  // the six localized copy strings; every listener is document-level delegation
  // so it needs no wiring to the panel's own script. See getImageLightboxScript.
  const L = sharedWebviewStrings();
  const lightboxScript = getImageLightboxScript({
    copyMenuItem: L.imgCopyMenuItem,
    copyDoneLabel: L.imgCopyDoneLabel,
    copyFailedLabel: L.imgCopyFailedLabel,
    copyUnsupportedLabel: L.imgCopyUnsupportedLabel,
    copyToastDone: L.imgCopyToastDone,
    copyToastFailed: L.imgCopyToastFailed,
  });

  const cols = renderColumns(result.rows);
  const statsHtml = renderStats(result.stats);

  const labels = {
    swapTitle: vscode.l10n.t('Swap sides'),
    prevChange: vscode.l10n.t('Previous change'),
    nextChange: vscode.l10n.t('Next change'),
    toggleInline: vscode.l10n.t('Show word-level changes'),
    navCounter: vscode.l10n.t('Jump to change (type a number and press Enter)'),
    sourceToggle: vscode.l10n.t('Open source diff'),
  };

  return `<!DOCTYPE html>
<html lang="en"${isDark ? ' class="vscode-dark"' : ''}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${webview.cspSource} data:; base-uri 'none';">
<link rel="stylesheet" href="${stylesUri}">
<link rel="stylesheet" href="${diffStylesUri}">
<title>Diff — ${escapeHtml(leftLabel)} ↔ ${escapeHtml(rightLabel)}</title>
</head>
<body class="show-inline">
<div id="diff-toolbar">
  <span class="diff-label" id="lbl-left">${escapeHtml(leftLabel)}</span>
  <span class="diff-stats">${statsHtml}</span>
  <span class="diff-label" id="lbl-right">${escapeHtml(rightLabel)}</span>
  <span class="diff-spacer"></span>
  <input class="diff-nav-counter" id="nav-counter" type="text" inputmode="numeric" size="7" autocomplete="off" spellcheck="false" title="${escapeHtml(labels.navCounter)}" aria-label="${escapeHtml(labels.navCounter)}">
  <button id="btn-prev" title="${escapeHtml(labels.prevChange)}" aria-label="${escapeHtml(labels.prevChange)}">↑</button>
  <button id="btn-next" title="${escapeHtml(labels.nextChange)}" aria-label="${escapeHtml(labels.nextChange)}">↓</button>
  <button id="btn-swap" title="${escapeHtml(labels.swapTitle)}" aria-label="${escapeHtml(labels.swapTitle)}">⇄</button>
  <button id="btn-inline" title="${escapeHtml(labels.toggleInline)}" aria-label="${escapeHtml(labels.toggleInline)}" aria-pressed="true">Aa</button>
  <button id="btn-source" title="${escapeHtml(labels.sourceToggle)}" aria-label="${escapeHtml(labels.sourceToggle)}">&lt;/&gt;</button>
</div>
<div id="diff-scroll">
${result.errorLeft ? `<div class="diff-error">${escapeHtml(result.errorLeft)}</div>` : ''}
${result.errorRight ? `<div class="diff-error">${escapeHtml(result.errorRight)}</div>` : ''}
<div class="diff-columns">
  <div class="diff-col diff-col--left">${cols.left}</div>
  <div class="diff-gutter" id="diff-gutter"><svg id="align-svg" class="align-svg" xmlns="http://www.w3.org/2000/svg"></svg></div>
  <div class="diff-col diff-col--right">${cols.right}</div>
</div>
</div>
<script nonce="${nonce}" src="${diffScriptUri}"></script>
<script nonce="${nonce}">${lightboxScript}</script>
</body>
</html>`;
}

// Independent two-column layout: each side flows as its own continuous
// document. A block present on only one side (added / removed) is emitted into
// that column alone -- no full-height empty placeholder stretches the other
// column to match, which is what broke the reading flow in the old aligned-row
// model. Change type is carried by a thin edge marker (see .dv-block--* in
// diff-styles.css) plus word-level inline marks. Both sides of one change share
// a data-diff-idx so the webview's next/prev navigation can highlight the pair
// together even though the columns are no longer row-for-row aligned.
interface ColumnSink {
  left: string[];
  right: string[];
  changeCount: number;
  /** moveId -> data-diff-idx, so the two halves of a moved block (one in each
   *  column, at different positions) share one change index and one connector. */
  moveIdx: Map<number, number>;
}

function renderColumns(rows: AlignedRow[]): { left: string; right: string; changeCount: number } {
  const sink: ColumnSink = { left: [], right: [], changeCount: 0, moveIdx: new Map() };
  collectColumns(rows, sink);
  return { left: sink.left.join('\n'), right: sink.right.join('\n'), changeCount: sink.changeCount };
}

function collectColumns(rows: AlignedRow[], sink: ColumnSink): void {
  for (const row of rows) {
    // A modified container (section / list / table) recurses into its children;
    // the container itself contributes no block of its own, matching the
    // aligned-row renderer, which only ever showed the recursed children.
    if (row.children && row.children.length > 0) {
      collectColumns(row.children, sink);
      continue;
    }

    let idx: number | undefined;
    if (row.changeType !== 'unchanged') {
      if (row.moveId !== undefined && sink.moveIdx.has(row.moveId)) {
        idx = sink.moveIdx.get(row.moveId);
      } else {
        idx = sink.changeCount++;
        if (row.moveId !== undefined) sink.moveIdx.set(row.moveId, idx);
      }
    }
    const idxAttr = idx !== undefined ? ` data-diff-idx="${idx}"` : '';
    const cls =
      `dv-block dv-block--${row.changeType}` +
      (row.moveId !== undefined ? ' dv-block--moved' : '') +
      (row.replaced ? ' dv-block--replaced' : '');
    if (row.left) {
      sink.left.push(`<div class="${cls}"${idxAttr}>${applyInlineDiff(row.left.html, row, 'left')}</div>`);
    }
    if (row.right) {
      sink.right.push(`<div class="${cls}"${idxAttr}>${applyInlineDiff(row.right.html, row, 'right')}</div>`);
    }
  }
}

function applyInlineDiff(html: string, row: AlignedRow, side: 'left' | 'right'): string {
  if (!row.inlineDiff || (row.changeType !== 'modified' && row.moveId === undefined)) return html;
  return applyInlineMarksToHtml(html, row.inlineDiff, side);
}

function renderStats(stats: { added: number; removed: number; modified: number }): string {
  const parts: string[] = [];
  if (stats.added > 0) parts.push(`<span class="stat-add">+${stats.added}</span>`);
  if (stats.removed > 0) parts.push(`<span class="stat-del">−${stats.removed}</span>`);
  if (stats.modified > 0) parts.push(`<span class="stat-mod">~${stats.modified}</span>`);
  return parts.join(' ') || '0';
}
