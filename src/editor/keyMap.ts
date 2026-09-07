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
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { DitaNode } from '../parser/domTypes';
import { parseDitamap, preprocessEntities } from '../parser/ditaParser';
import { expandDitamapRefs, stampFiles, FileReader } from './ditaRenderUtils';
import { parseDocRoot } from './docPaths';

export function findDitamapFiles(docUri: vscode.Uri, stopAtFirstMatch = true): string[] {
  const results: string[] = [];
  const docDir = dirname(docUri.fsPath);
  const root = parseDocRoot(docDir);
  let dir = docDir;
  while (dir.length >= root.length) {
    try {
      for (const entry of readdirSync(dir)) {
        if (entry.toLowerCase().endsWith('.ditamap')) results.push(join(dir, entry));
      }
    } catch (e) {
      console.warn(`Failed to read directory ${dir}:`, e instanceof Error ? e.message : e);
    }
    if (stopAtFirstMatch && results.length > 0) return results;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return results;
}

function extractTextFromNode(node: DitaNode): string {
  if (node.type === 'text') return node.text || '';
  return (node.children || []).map(extractTextFromNode).join('');
}

function getNodeValue(node: DitaNode, childBaseTypes: string[]): string | undefined {
  for (const bt of childBaseTypes) {
    const child = (node.children || []).find(
      (c) => c.type === 'element' && c.baseType === bt,
    );
    if (child) {
      const text = extractTextFromNode(child).trim();
      if (text) return text;
    }
    // DITA wraps <keyword> inside <keywords>; also search inside known wrappers
    const wrapper = (node.children || []).find(
      (c) => c.type === 'element' && (c.baseType === 'map/keywords'),
    );
    if (wrapper) {
      const inner = (wrapper.children || []).find(
        (c) => c.type === 'element' && c.baseType === bt,
      );
      if (inner) {
        const text = extractTextFromNode(inner).trim();
        if (text) return text;
      }
    }
  }
  return undefined;
}

function getKeyValueFromRef(node: DitaNode): string | undefined {
  // Priority: keyword > linktext > navtitle > shortdesc > indexterm
  const topicmeta = (node.children || []).find(
    (c) => c.type === 'element' && (c.baseType === 'map/topicmeta'),
  );
  if (!topicmeta) return undefined; // No topicmeta, no value
  return getNodeValue(topicmeta, [
    'map/keyword',
    'map/linktext',
    'map/navtitle',
    'map/shortdesc',
  ]);
}

// buildKeyMap sits on hot paths (preview re-render, completion, diagnostics,
// map tree) and used to re-read and re-parse every ancestor ditamap each
// call. Cache per document directory; invalidated when the set of ancestor
// maps changes or any involved file's mtime changes (including maps pulled
// in via expandDitamapRefs, tracked through the recording reader).
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
// book-mode topic caching needs the identical mtime fingerprint, and two
// copies of an invalidation rule drift apart silently.

/** Part of clearAllCaches() in DitaViewerProvider.ts -- kept here alongside
 *  the cache it clears rather than exporting the Map itself. */
export function clearKeyMapCache(): void {
  keyMapCache.clear();
}

export function buildKeyMap(docUri: vscode.Uri): Map<string, string> {
  const docDir = dirname(docUri.fsPath);
  // Scan all ancestor folders (not just the nearest one with a map) so keydef
  // maps living in outer folders are still picked up; maps referenced from any
  // scanned map are followed via expandDitamapRefs regardless of location.
  const mapFiles = findDitamapFiles(docUri, false);
  const mapFilesKey = mapFiles.join('|');

  const cached = keyMapCache.get(docDir);
  if (cached && cached.mapFilesKey === mapFilesKey && stampFiles(cached.files) === cached.stamps) {
    return cached.map;
  }

  const map = new Map<string, string>();
  const involvedFiles = [...mapFiles];
  const recordingRead: FileReader = (path, encoding) => {
    involvedFiles.push(path);
    return readFileSync(path, encoding);
  };
  for (const mf of mapFiles) {
    try {
      const content = readFileSync(mf, 'utf-8');
      const doc = parseDitamap(preprocessEntities(content));
      const mapRoot = doc.root;
      // Expand referenced ditamaps so keydefs from included maps are visible
      expandDitamapRefs(mapRoot, dirname(mf), recordingRead);
      function walk(node: DitaNode) {
        if (node.type !== 'element') return;
        const baseType = node.baseType;
        if ((baseType === 'map/topicref' || baseType === 'map/keydef') && node.attributes?.keys) {
          const keys = node.attributes.keys;
          const value = getKeyValueFromRef(node);
          // First definition wins (DITA precedence; nearest map scanned first)
          if (!map.has(keys)) map.set(keys, value || keys);
        }
        for (const child of node.children || []) walk(child);
      }
      for (const child of mapRoot.children || []) walk(child);
    } catch (e) {
      console.warn(`Failed to parse keymap from ${mf}:`, e instanceof Error ? e.message : e);
    }
  }

  if (keyMapCache.size >= KEY_MAP_CACHE_MAX && !keyMapCache.has(docDir)) {
    const oldest = keyMapCache.keys().next().value;
    if (oldest !== undefined) keyMapCache.delete(oldest);
  }
  keyMapCache.set(docDir, {
    mapFilesKey,
    stamps: stampFiles(involvedFiles),
    files: involvedFiles,
    map,
  });
  return map;
}
