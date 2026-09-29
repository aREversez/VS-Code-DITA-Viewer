// ── key definitions of one ditamap (vscode-free, unit-testable) ──
//
// Split out of keyMap.ts, which imports vscode and so cannot be loaded by
// the mocha suite. buildKeyMap (keyMap.ts) and any other consumer of "the
// keys a map defines" go through collectMapKeys so there is one rule for
// what a keydef contributes.

import { dirname } from 'path';
import { DitaNode } from '../parser/domTypes';
import { parseDitamap, preprocessEntities } from '../parser/ditaParser';
import { expandDitamapRefs, FileReader } from './ditaRenderUtils';
import { sourceStamp } from './sourceText';

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

/** The individual key names in a `keys` attribute (whitespace-separated). */
export function splitKeyNames(keys: string): string[] {
  return keys.split(/\s+/).filter(Boolean);
}

/**
 * Parses one ditamap, expands the ditamaps it references, and adds every
 * key it defines to `into` (first definition wins, in document order).
 * Throws if the map itself cannot be read or parsed; the caller decides
 * whether that is fatal.
 */
export function collectMapKeys(mapPath: string, into: Map<string, string>, read: FileReader): void {
  const content = read(mapPath, 'utf-8');
  const doc = parseDitamap(preprocessEntities(content));
  const mapRoot = doc.root;
  // Expand referenced ditamaps so keydefs from included maps are visible
  expandDitamapRefs(mapRoot, dirname(mapPath), read);
  function walk(node: DitaNode) {
    if (node.type !== 'element') return;
    const baseType = node.baseType;
    if ((baseType === 'map/topicref' || baseType === 'map/keydef') && node.attributes?.keys) {
      const value = getKeyValueFromRef(node);
      // keys is a space-separated list: one keydef defines every name in it
      // with the same resource. First definition of each name wins (DITA
      // precedence; nearest map scanned first).
      for (const name of splitKeyNames(node.attributes.keys)) {
        if (!into.has(name)) into.set(name, value || name);
      }
    }
    for (const child of node.children || []) walk(child);
  }
  for (const child of mapRoot.children || []) walk(child);
}

// ── key space: context map vs. ancestor scan ──

export type KeyContextStatus = 'none' | 'active' | 'missing';

export interface KeySpace {
  keys: Map<string, string>;
  /** Every file the key values were derived from (for cache stamping). */
  files: string[];
  /** 'none': no context set. 'active': keys come from the context map alone.
   *  'missing': a context is set but its file no longer exists, so the
   *  ancestor scan was used instead. */
  status: KeyContextStatus;
}

/** A context counts only while its file (or an unsaved copy of it) exists. */
export function isKeyContextAvailable(contextMap: string | undefined): contextMap is string {
  return contextMap !== undefined && sourceStamp(contextMap) !== '?';
}

/**
 * The ditamaps the key definitions come from: the context map alone when one
 * is set and available, otherwise the ancestor maps. The single answer to
 * "where do keys come from" -- the key map behind previews and diagnostics
 * (buildKeySpace) and go-to-definition on a keyref must both ask this, or a
 * preview can show one brand's value while F12 jumps to another's.
 * `ancestorMaps` is a function so the directory walk is skipped when the
 * context answers.
 */
export function keySourceMaps(contextMap: string | undefined, ancestorMaps: () => string[]): string[] {
  return isKeyContextAvailable(contextMap) ? [contextMap] : ancestorMaps();
}

/**
 * The key space every keyref in the workspace resolves against.
 *
 * With a context map (Oxygen's DITA Maps Manager "context"), the keys are
 * those of that one map, expanded through its map references, and nothing
 * else: the ancestor maps are NOT consulted, so choosing one brand's keydef
 * map cannot pick up another brand's definition of the same key. Without a
 * context it is the ancestor scan buildKeyMap always did.
 *
 * A context whose file no longer exists falls back to the ancestor scan and
 * says so ('missing') -- the caller decides how to tell the user. A context
 * that exists but cannot be parsed is reported through onError and yields an
 * empty key space rather than quietly resolving against other maps.
 */
export function buildKeySpace(
  contextMap: string | undefined,
  ancestorMaps: string[],
  read: FileReader,
  onError: (mapPath: string, error: unknown) => void = () => undefined,
): KeySpace {
  const files: string[] = [];
  const recordingRead: FileReader = (path, encoding) => {
    files.push(path);
    return read(path, encoding);
  };

  const sources = keySourceMaps(contextMap, () => ancestorMaps);
  let status: KeyContextStatus = 'none';
  if (contextMap !== undefined) {
    // Listed even when missing, so the file reappearing changes the stamp.
    files.push(contextMap);
    status = isKeyContextAvailable(contextMap) ? 'active' : 'missing';
  }

  const keys = new Map<string, string>();
  for (const mf of sources) {
    try {
      collectMapKeys(mf, keys, recordingRead);
    } catch (e) {
      onError(mf, e);
    }
  }
  return { keys, files: [...new Set(files)], status };
}
