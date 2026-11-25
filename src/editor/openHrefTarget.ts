// Opens an href that an imagemap hotspot carries, in the right place.
//
// Lives apart from topicRender.ts on purpose: it is the one function of the
// topic-rendering pipeline that is about the VS Code host (it opens editors
// and the system handler), and topicRender.ts must stay free of any host so a
// second host (the Obsidian plugin, through @dita-viewer/core) can use it
// unchanged. The vscode API is injected, so this module needs no runtime
// vscode import either and stays unit-testable.

import { extname, resolve } from 'path';
import { decodeHrefPart, isInsideAny } from '@dita-viewer/core';

// What the OS may be asked to open for a hotspot or link. Anything else (an
// .exe, .lnk, .bat, a script, a shell-registered type) is only revealed in the
// file manager: a rendered page is content from a document, and one click must
// never be able to launch a program. .html/.htm/.svg are deliberately NOT here:
// opened by the system they run script in the browser, and a DITA source has no
// need to open one (HTML output is generated, not linked).
const OPEN_EXTERNALLY = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.txt', '.md']);

/**
 * Resolves an imagemap hotspot / link href the same way the map tree's
 * openTopic handler resolves its targets, then opens it in the right place.
 * Kept next to decodeHrefPart because it reuses that decoding; vscode is
 * injected so this module stays free of a runtime vscode dependency (its
 * script builders are unit-tested standalone).
 *
 * http(s) URLs go to the system handler via openExternal. A local target must
 * stay inside the workspace (the document's own folder when no folder is
 * open): `../..` and absolute paths that leave it are refused with a warning,
 * for every branch. Inside it, DITA sources open in the matching preview editor
 * (.ditamap -> ditaViewer.mapPreview, .dita/.xml -> ditaViewer.preview),
 * mirroring openTopic's view-type decision; display-safe files (pdf, raster
 * images, text) go to the system handler; every other type is revealed in the
 * OS file manager instead of being executed.
 */
export function openHrefTarget(
  vscode: typeof import('vscode'),
  href: string,
  baseDir: string,
): void {
  const raw = (href || '').trim();
  if (!raw) return;
  if (/^(https?:\/\/|mailto:)/i.test(raw)) {
    void vscode.env.openExternal(vscode.Uri.parse(raw));
    return;
  }
  if (raw.startsWith('#')) return; // same-page anchors never reach the host
  const filePart = decodeHrefPart(raw.split('#')[0]);
  if (!filePart) return;
  const targetPath = resolve(baseDir, filePart);
  const folders = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
  const roots = folders.length > 0 ? folders : [baseDir];
  if (!isInsideAny(roots, targetPath)) {
    void vscode.window.showWarningMessage(
      vscode.l10n.t('Not opened: "{0}" is outside the workspace.', filePart),
    );
    return;
  }
  const targetUri = vscode.Uri.file(targetPath);
  const lower = filePart.toLowerCase();
  if (lower.endsWith('.ditamap')) {
    void vscode.commands.executeCommand('vscode.openWith', targetUri, 'ditaViewer.mapPreview');
  } else if (lower.endsWith('.dita') || lower.endsWith('.xml')) {
    void vscode.commands.executeCommand('vscode.openWith', targetUri, 'ditaViewer.preview');
  } else if (OPEN_EXTERNALLY.has(extname(lower))) {
    void vscode.env.openExternal(targetUri);
  } else {
    void vscode.commands.executeCommand('revealFileInOS', targetUri);
  }
}
