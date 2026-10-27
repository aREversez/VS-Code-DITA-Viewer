// Opens an href that an imagemap hotspot carries, in the right place.
//
// Lives apart from topicRender.ts on purpose: it is the one function of the
// topic-rendering pipeline that is about the VS Code host (it opens editors
// and the system handler), and topicRender.ts must stay free of any host so a
// second host (the Obsidian plugin, through @dita-viewer/core) can use it
// unchanged. The vscode API is injected, so this module needs no runtime
// vscode import either and stays unit-testable.

import { resolve } from 'path';
import { decodeHrefPart } from '@dita-viewer/core';

/**
 * Resolves an imagemap hotspot href the same way the map tree's openTopic
 * handler resolves its targets, then opens it in the right place. Kept
 * next to decodeHrefPart because it reuses that decoding; vscode is
 * injected so this module stays free of a runtime vscode dependency (its
 * script builders are unit-tested standalone).
 *
 * http(s) URLs and non-DITA files (test.html, test.pdf, images) go to the
 * system handler via openExternal -- a rendered page's hotspot promises an
 * "opens the target" experience, and VS Code can't render a useful PDF or
 * web page inline. DITA sources open in the matching preview editor
 * (.ditamap -> ditaViewer.mapPreview, .dita/.xml -> ditaViewer.preview),
 * mirroring openTopic's view-type decision, so clicking a hotspot whose
 * xref points at another topic behaves like clicking a link to that topic.
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
  const targetUri = vscode.Uri.file(targetPath);
  const lower = filePart.toLowerCase();
  if (lower.endsWith('.ditamap')) {
    void vscode.commands.executeCommand('vscode.openWith', targetUri, 'ditaViewer.mapPreview');
  } else if (lower.endsWith('.dita') || lower.endsWith('.xml')) {
    void vscode.commands.executeCommand('vscode.openWith', targetUri, 'ditaViewer.preview');
  } else {
    void vscode.env.openExternal(targetUri);
  }
}
