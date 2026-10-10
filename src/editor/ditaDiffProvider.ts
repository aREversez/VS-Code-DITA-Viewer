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
} from './ditaRenderUtils';
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
const DIFF_STATE = new WeakMap<vscode.WebviewPanel, { result: TopicDiffResult; leftLabel: string; rightLabel: string }>();

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
            renderDiffPanel(context, panel, result, finalLeft.label, finalRight.label);
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
    if (msg.type === 'swapSides') {
      const state = DIFF_STATE.get(panel);
      if (!state) return;
      const swapped = swapAlignedRows(state.result.rows);
      const swappedResult = { ...state.result, rows: swapped };
      const swappedLabels = { leftLabel: state.rightLabel, rightLabel: state.leftLabel };
      DIFF_STATE.set(panel, { result: swappedResult, ...swappedLabels });
      panel.webview.html = buildDiffHtml(context, panel.webview, swappedResult, swappedLabels.leftLabel, swappedLabels.rightLabel);
      recordDiffHtml(panel, panel.webview.html);
    }
  });

  return panel;
}

function renderDiffPanel(
  context: vscode.ExtensionContext,
  panel: vscode.WebviewPanel,
  result: TopicDiffResult,
  leftLabel: string,
  rightLabel: string,
): void {
  DIFF_STATE.set(panel, { result, leftLabel, rightLabel });
  panel.webview.html = buildDiffHtml(context, panel.webview, result, leftLabel, rightLabel);
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

  const cols = renderColumns(result.rows);
  const statsHtml = renderStats(result.stats);

  const labels = {
    swapTitle: vscode.l10n.t('Swap sides'),
    prevChange: vscode.l10n.t('Previous change'),
    nextChange: vscode.l10n.t('Next change'),
    toggleInline: vscode.l10n.t('Show word-level changes'),
  };

  return `<!DOCTYPE html>
<html lang="en"${isDark ? ' class="vscode-dark"' : ''}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none';">
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
  <span class="diff-nav-counter" id="nav-counter"></span>
  <button id="btn-prev" title="${escapeHtml(labels.prevChange)}" aria-label="${escapeHtml(labels.prevChange)}">↑</button>
  <button id="btn-next" title="${escapeHtml(labels.nextChange)}" aria-label="${escapeHtml(labels.nextChange)}">↓</button>
  <button id="btn-swap" title="${escapeHtml(labels.swapTitle)}" aria-label="${escapeHtml(labels.swapTitle)}">⇄</button>
  <button id="btn-inline" title="${escapeHtml(labels.toggleInline)}" aria-label="${escapeHtml(labels.toggleInline)}" aria-pressed="true">Aa</button>
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
}

function renderColumns(rows: AlignedRow[]): { left: string; right: string; changeCount: number } {
  const sink: ColumnSink = { left: [], right: [], changeCount: 0 };
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

    const idxAttr = row.changeType !== 'unchanged' ? ` data-diff-idx="${sink.changeCount++}"` : '';
    if (row.left) {
      sink.left.push(
        `<div class="dv-block dv-block--${row.changeType}"${idxAttr}>${applyInlineDiff(row.left.html, row, 'left')}</div>`,
      );
    }
    if (row.right) {
      sink.right.push(
        `<div class="dv-block dv-block--${row.changeType}"${idxAttr}>${applyInlineDiff(row.right.html, row, 'right')}</div>`,
      );
    }
  }
}

function applyInlineDiff(html: string, row: AlignedRow, side: 'left' | 'right'): string {
  if (row.changeType !== 'modified' || !row.inlineDiff) return html;
  return applyInlineMarksToHtml(html, row.inlineDiff, side);
}

function renderStats(stats: { added: number; removed: number; modified: number }): string {
  const parts: string[] = [];
  if (stats.added > 0) parts.push(`<span class="stat-add">+${stats.added}</span>`);
  if (stats.removed > 0) parts.push(`<span class="stat-del">−${stats.removed}</span>`);
  if (stats.modified > 0) parts.push(`<span class="stat-mod">~${stats.modified}</span>`);
  return parts.join(' ') || '0';
}
