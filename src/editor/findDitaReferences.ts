// "Find Maps Referencing This File" — the reverse of clicking a topicref:
// given a .dita topic (or a submap), which .ditamap files in the workspace
// actually point at it? Answers the question Oxygen's own "Search
// References" answers, without needing the file's owning map to already be
// the one showing in the navigator sidebar.

import * as vscode from 'vscode';
import { readFileSync } from 'fs';
import { basename, dirname, resolve } from 'path';
import { parseDitamap, preprocessEntities } from '../parser/ditaParser';
import { collectMapEntries, getMapTitleText } from '../render/mapTypeMap';
import { formatLocalizedRole } from '../language/bookRoleL10n';
import { buildKeyMap } from './keyMap';
import { hrefMatchesTarget } from './mapReferenceTools';
import { getActiveDitaUri } from './exportHtml';

export interface ReferencingMapEntry {
  mapUri: vscode.Uri;
  mapTitle: string;
  entryTitle: string;
}

/**
 * Every (map, entry) pair in the workspace whose href resolves to
 * targetFsPath. Maps are read directly off disk and NOT passed through
 * expandDitamapRefs — a submap reference should surface as "referenced by
 * the parent map's <mapref>", not have that mapref disappear in favor of
 * re-attributing the submap's own contents to the parent.
 */
export async function findMapsReferencingFile(
  targetFsPath: string,
): Promise<ReferencingMapEntry[]> {
  const targetAbs = resolve(targetFsPath);
  const mapUris = await vscode.workspace.findFiles(
    '**/*.ditamap',
    '**/node_modules/**',
    1000,
  );
  const results: ReferencingMapEntry[] = [];

  for (const mapUri of mapUris) {
    let root;
    try {
      const content = readFileSync(mapUri.fsPath, 'utf-8');
      root = parseDitamap(preprocessEntities(content)).root;
    } catch {
      continue; // Unreadable/unparsable map: not a candidate, and not worth failing the whole search over
    }
    const mapDir = dirname(mapUri.fsPath);
    const keyMap = buildKeyMap(mapUri);
    const resolveKey = (k: string) => keyMap.get(k);
    const entries = collectMapEntries(root, resolveKey, formatLocalizedRole);
    const mapTitle =
      getMapTitleText(root, resolveKey) || basename(mapUri.fsPath);
    for (const entry of entries) {
      if (hrefMatchesTarget(mapDir, entry.href, targetAbs, process.platform)) {
        results.push({ mapUri, mapTitle, entryTitle: entry.displayName });
      }
    }
  }
  return results;
}

export function registerFindReferencingMapsCommand(
  context: vscode.ExtensionContext,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'ditaViewer.findReferencingMaps',
      async (uri?: vscode.Uri) => {
        const target = uri ?? getActiveDitaUri();
        if (!target) {
          vscode.window.showErrorMessage(
            vscode.l10n.t('Please open a .dita or .ditamap file first.'),
          );
          return;
        }

        const results = await findMapsReferencingFile(target.fsPath);
        if (results.length === 0) {
          vscode.window.showInformationMessage(
            vscode.l10n.t('No map in this workspace references {0}.', basename(target.fsPath)),
          );
          return;
        }

        const items = results.map((r) => ({
          label: r.mapTitle,
          description: vscode.workspace.asRelativePath(r.mapUri),
          detail: r.entryTitle,
          mapUri: r.mapUri,
        }));
        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: vscode.l10n.t('{0} map(s) reference this file — select one to open', String(results.length)),
        });
        if (picked) {
          await vscode.commands.executeCommand(
            'vscode.openWith',
            picked.mapUri,
            'ditaViewer.mapPreview',
          );
        }
      },
    ),
  );
}
