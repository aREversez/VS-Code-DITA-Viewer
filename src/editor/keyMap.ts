// ── ditamap discovery & key map building ──
//
// Extracted verbatim from DitaViewerProvider.ts (which had grown to ~1700
// lines) as a self-contained cluster. findDitamapFiles() and buildKeyMap()
// stay exported here (and re-exported from DitaViewerProvider.ts) since
// MapViewerProvider.ts, ditaDiffProvider.ts, exportHtml.ts, extension.ts,
// ditaLanguageFeatures.ts and ditaMapTreeProvider.ts all import them from
// there; getKeyValueFromRef/getNodeValue/extractTextFromNode stay private,
// same as before. No behavior change -- see the patch that introduced this
// file for the byte-for-byte diff against the code's previous location.

import * as vscode from 'vscode';
import { readSourceText, noteSourceDependencies } from './sourceText';
import { dirname } from 'path';
import { stampFiles, collectDitamapFilesUpward } from './ditaRenderUtils';
import { buildKeySpace, keySourceMaps, isKeyContextAvailable } from './keySpace';
import { getKeyContextMap, reportKeyContextMissing } from './keyContext';
import { parseDocRoot } from './docPaths';

export function findDitamapFiles(docUri: vscode.Uri, stopAtFirstMatch = true): string[] {
  const docDir = dirname(docUri.fsPath);
  const root = parseDocRoot(docDir);
  return collectDitamapFilesUpward(docDir, root, stopAtFirstMatch);
}

// buildKeyMap sits on hot paths (preview re-render, completion, diagnostics,
// map tree) and used to re-read and re-parse every ancestor ditamap each
// call. Cache per document directory; invalidated when the set of ancestor
// maps changes or any involved file's stamp changes (sourceStamp in
// sourceText.ts: mtime and size on disk, the unsaved text for an open dirty
// document; including maps pulled in via expandDitamapRefs, tracked through
// the recording reader).
interface KeyMapCacheEntry {
  mapFilesKey: string;
  stamps: string;
  files: string[];
  map: Map<string, string>;
}
const keyMapCache = new Map<string, KeyMapCacheEntry>();
// One entry per document directory; bound it so long sessions touching many
// folders cannot grow the cache without limit (evicts oldest-inserted first).
const KEY_MAP_CACHE_MAX = 50;
// stampFiles is imported from ditaRenderUtils.ts rather than defined here:
// book-mode topic caching needs the identical fingerprint, and two copies
// of an invalidation rule drift apart silently.

/** Part of clearAllCaches() in DitaViewerProvider.ts -- kept here alongside
 *  the cache it clears rather than exporting the Map itself. */
export function clearKeyMapCache(): void {
  keyMapCache.clear();
}

/**
 * The ditamaps key definitions come from for a document: the workspace's
 * context map when one is set (and still exists), otherwise the ancestor
 * maps. Go-to-definition on a keyref uses this so it lands in the same map
 * the preview's values came from.
 */
export function getKeySourceMaps(docUri: vscode.Uri): string[] {
  return keySourceMaps(getKeyContextMap(), () => findDitamapFiles(docUri, false));
}

export function buildKeyMap(docUri: vscode.Uri): Map<string, string> {
  const docDir = dirname(docUri.fsPath);
  const context = getKeyContextMap();
  // Scan all ancestor folders (not just the nearest one with a map) so keydef
  // maps living in outer folders are still picked up; maps referenced from any
  // scanned map are followed via expandDitamapRefs regardless of location.
  // With a context map the ancestors are not consulted at all (see
  // buildKeySpace), so the directory walk is skipped too.
  const mapFiles = getKeySourceMaps(docUri);
  // A context's key space does not depend on which document asks, so it gets
  // one entry; the ancestor scan is per document directory.
  const cacheKey = isKeyContextAvailable(context) ? `context:${context}` : docDir;
  const mapFilesKey = `${context ?? ''}#${mapFiles.join('|')}`;

  const cached = keyMapCache.get(cacheKey);
  if (cached && cached.mapFilesKey === mapFilesKey && stampFiles(cached.files) === cached.stamps) {
    // A hit reads nothing, but every render using this map depends on these files.
    noteSourceDependencies(cached.files);
    return cached.map;
  }

  const space = buildKeySpace(context, mapFiles, readSourceText, (mf, e) => {
    console.warn(`Failed to parse keymap from ${mf}:`, e instanceof Error ? e.message : e);
  });
  if (space.status === 'missing' && context !== undefined) reportKeyContextMissing(context);
  const map = space.keys;
  const involvedFiles = [...new Set([...mapFiles, ...space.files])];

  if (keyMapCache.size >= KEY_MAP_CACHE_MAX && !keyMapCache.has(cacheKey)) {
    const oldest = keyMapCache.keys().next().value;
    if (oldest !== undefined) keyMapCache.delete(oldest);
  }
  keyMapCache.set(cacheKey, {
    mapFilesKey,
    stamps: stampFiles(involvedFiles),
    files: involvedFiles,
    map,
  });
  return map;
}
