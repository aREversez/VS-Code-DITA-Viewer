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
  makeConrefResolver,
  makeConrefRangeResolver,
  makeFileTitleResolver,
  detectNoteLabels,
  decodeHrefPart,
  readImageDimensions,
  escapeHtml,
} from './ditaRenderUtils';
import {
  diffTopics,
  AlignedRow,
  TopicDiffResult,
  applyInlineMarksToHtml,
  swapAlignedRows,
  buildQuickCommitChoices,
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

const DIFF_PANELS = new Map<string, vscode.WebviewPanel>();

export function registerCompareCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ditaViewer.compareWithGit', async () => {
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
        resolve: () => Promise<{ xml: string; label: string } | undefined>;
      }

      const choices: VersionChoice[] = [];

      choices.push({
        label: '$(file) Working copy' + (hasLocal ? ' •' : ''),
        description: vscode.l10n.t('includes unsaved changes'),
        resolve: async () => ({ xml: await getLocalContent(uri), label: vscode.l10n.t('Working copy') }),
      });

      const quickChoices = buildQuickCommitChoices(commits);

      if (quickChoices[0]) {
        const c = quickChoices[0];
        choices.push({
          label: `$(git-commit) ${vscode.l10n.t('Last commit to this file')} — ${c.shortHash}`,
          description: c.subject,
          resolve: async () => {
            const xml = await getFileAtRef(repoRoot, relPath, c.refHash);
            return xml ? { xml, label: `${c.shortHash} ${c.subject}` } : undefined;
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
            return xml ? { xml, label: `${c.shortHash} ${c.subject}` } : undefined;
          },
        });
      }

      choices.push({
        label: '$(git-commit) Pick a specific commit…',
        resolve: async () => {
          const picked = await pickCommit(commits);
          if (!picked) return undefined;
          const xml = await getFileAtRef(repoRoot, relPath, picked.hash);
          return xml ? { xml, label: `${picked.shortHash} ${picked.subject}` } : undefined;
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

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Computing differences…') },
        async () => {
          try {
            const result = computeDiff(leftResult.xml, rightResult.xml, docDir, uri);
            openDiffPanel(context, uri, result, leftResult.label, rightResult.label);
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
    const conrefResolver = makeConrefResolver(sideDocDir, root);
    const conrefRangeResolver = makeConrefRangeResolver(sideDocDir);
    const fileTitleResolver = makeFileTitleResolver(sideDocDir);
    const titleMap = new Map<string, string>();

    const ctx: RenderContext = {
      headingLevel: 1,
      asWebviewUri: (relPath: string) => {
        try {
          return 'vscode-resource:' + resolve(sideDocDir, decodeHrefPart(relPath));
        } catch {
          return relPath;
        }
      },
      documentDir: sideDocDir,
      resolveTitle: (id: string) => titleMap.get(id) || fileTitleResolver(id),
      resolveKey: (key: string) => keyMap.get(key),
      resolveConref: (conref: string) => conrefResolver(conref),
      resolveConrefRange: (conref: string, conrefend: string) => conrefRangeResolver(conref, conrefend),
      noteLabels: detectNoteLabels(root, vscode.env.language),
      getImageDimensions: (relPath: string) => {
        try { return readImageDimensions(resolve(sideDocDir, decodeHrefPart(relPath))); }
        catch { return undefined; }
      },
    };

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

function openDiffPanel(
  context: vscode.ExtensionContext,
  uri: vscode.Uri,
  result: TopicDiffResult,
  leftLabel: string,
  rightLabel: string,
): void {
  const key = uri.toString();
  const existing = DIFF_PANELS.get(key);

  if (existing) {
    existing.reveal();
    existing.webview.html = buildDiffHtml(context, existing.webview, result, leftLabel, rightLabel);
    return;
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
  panel.onDidDispose(() => DIFF_PANELS.delete(key));

  panel.webview.html = buildDiffHtml(context, panel.webview, result, leftLabel, rightLabel);

  panel.webview.onDidReceiveMessage((msg) => {
    if (msg.type === 'swapSides') {
      const swapped = swapAlignedRows(result.rows);
      const swappedResult = { ...result, rows: swapped };
      panel.webview.html = buildDiffHtml(context, panel.webview, swappedResult, rightLabel, leftLabel);
    }
  });
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

  const nonce = randomBytes(16).toString('base64');
  const theme = vscode.window.activeColorTheme;
  const isDark = theme.kind === vscode.ColorThemeKind.Dark || theme.kind === vscode.ColorThemeKind.HighContrast;

  const rowsHtml = renderRows(result.rows);
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
${rowsHtml}
</div>
<script nonce="${nonce}">${getDiffWebviewScript()}</script>
</body>
</html>`;
}

function renderRows(rows: AlignedRow[]): string {
  return rows.map((row) => renderRow(row)).join('\n');
}

function renderRow(row: AlignedRow): string {
  const cls = `diff-row diff-row--${row.changeType}`;
  const leftHtml = row.left ? applyInlineDiff(row.left.html, row, 'left') : emptyCell();
  const rightHtml = row.right ? applyInlineDiff(row.right.html, row, 'right') : emptyCell();

  const hasSectionChildren = row.children && row.children.length > 0;
  if (hasSectionChildren) {
    const nestedRows = row.children!.map((child) => renderRow(child)).join('\n');
    return `<div class="${cls} diff-row--section">
  <div class="diff-rows-nested">${nestedRows}</div>
</div>`;
  }

  return `<div class="${cls}">
  <div class="diff-cell diff-cell--left">${leftHtml}</div>
  <div class="diff-cell diff-cell--right">${rightHtml}</div>
</div>`;
}

function applyInlineDiff(html: string, row: AlignedRow, side: 'left' | 'right'): string {
  if (row.changeType !== 'modified' || !row.inlineDiff) return html;
  return applyInlineMarksToHtml(html, row.inlineDiff, side);
}

function emptyCell(): string {
  return `<div class="diff-cell diff-cell--empty">—</div>`;
}

function renderStats(stats: { added: number; removed: number; modified: number }): string {
  const parts: string[] = [];
  if (stats.added > 0) parts.push(`<span class="stat-add">+${stats.added}</span>`);
  if (stats.removed > 0) parts.push(`<span class="stat-del">−${stats.removed}</span>`);
  if (stats.modified > 0) parts.push(`<span class="stat-mod">~${stats.modified}</span>`);
  return parts.join(' ') || '0';
}

function getDiffWebviewScript(): string {
  return `
(function() {
  const vscode = acquireVsCodeApi();
  const body = document.body;
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  const btnSwap = document.getElementById('btn-swap');
  const btnInline = document.getElementById('btn-inline');
  const counter = document.getElementById('nav-counter');

  function getChangeRows() {
    return Array.from(document.querySelectorAll('.diff-row:not(.diff-row--unchanged):not(.diff-row--section)'));
  }

  let currentIdx = -1;

  function updateCounter() {
    const rows = getChangeRows();
    if (rows.length === 0) {
      counter.textContent = '0 / 0';
      return;
    }
    counter.textContent = (currentIdx + 1) + ' / ' + rows.length;
  }

  function navigateTo(idx) {
    const rows = getChangeRows();
    if (rows.length === 0) return;
    rows.forEach(function(r) { r.classList.remove('__diff_current'); });
    currentIdx = ((idx % rows.length) + rows.length) % rows.length;
    rows[currentIdx].classList.add('__diff_current');
    rows[currentIdx].scrollIntoView({ block: 'center', behavior: 'smooth' });
    updateCounter();
  }

  btnPrev.addEventListener('click', function() { navigateTo(currentIdx - 1); });
  btnNext.addEventListener('click', function() { navigateTo(currentIdx === -1 ? 0 : currentIdx + 1); });

  btnSwap.addEventListener('click', function() {
    vscode.postMessage({ type: 'swapSides' });
  });

  btnInline.addEventListener('click', function() {
    body.classList.toggle('show-inline');
    btnInline.setAttribute('aria-pressed', body.classList.contains('show-inline'));
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'F7' && !e.shiftKey) {
      e.preventDefault();
      navigateTo(currentIdx === -1 ? 0 : currentIdx + 1);
    } else if (e.key === 'F7' && e.shiftKey) {
      e.preventDefault();
      navigateTo(currentIdx - 1);
    }
  });

  updateCounter();
})();
`;
}
