// conkeyref resolution (P3) -- the DITA "content reference by key".
//
// A conkeyref value ("keyname", "keyname/elementid" or
// "keyname/topicid/elementid") is an indirect content reference: the leading
// segment is a key, resolved through the map key space to the target topic's
// href, and the remaining segments address an element inside that topic. It is
// the key-based analogue of a direct conref -- once the target element is
// found, the renderer substitutes it exactly as it would a conref target
// (same-type merge, cross-type replacement, cycle guard).
//
// This module is pure: no vscode, no filesystem, no parser. It takes the key
// space's href definitions plus an injected `loadTopic` (the caller owns file
// IO, caching and parsing) and returns the resolved target element or
// undefined. Returning undefined is how the caller learns to fall back: per the
// DITA 1.3 spec (and DITA-OT's DOTJ046E behaviour), when a conkeyref cannot be
// resolved -- key not defined, key with no href, target file missing, addressed
// id not present -- an element that also carries a direct @conref uses that
// instead, and when there is no conref the element renders its own literal
// content.
//
// Key-space precedence is inherited unchanged from the definitions it is given
// (first definition wins; a context map fully replaces the ancestor scan) --
// this function only reads the map it is handed, so switching the key context
// switches conkeyref targets for free.

import { DitaNode } from '../parser/domTypes';
import { KeyHrefDef } from './keySpace';

/**
 * Addressing inside the key's target topic: the whole topic when the value has
 * only the key name, otherwise the last path segment (the element id, for both
 * the "key/elemid" and the "key/topicid/elemid" forms -- the intermediate topic
 * id is redundant for a by-id lookup).
 */
function parseConkeyref(conkeyref: string): { keyName: string; elementId?: string } {
  const segments = conkeyref.split('/').filter((s) => s !== '');
  const keyName = segments[0];
  const elementId = segments.length > 1 ? segments[segments.length - 1] : undefined;
  return { keyName, elementId };
}

function findElementById(root: DitaNode, targetId: string): DitaNode | undefined {
  if (root.attributes?.id === targetId) return root;
  for (const child of root.children || []) {
    const found = findElementById(child, targetId);
    if (found) return found;
  }
  return undefined;
}

/**
 * Resolve a conkeyref to its target element.
 *
 * @param conkeyref the raw @conkeyref value.
 * @param defs      the key space's href definitions (from KeySpace.defs).
 * @param loadTopic loads and parses the topic at `href` (relative to
 *                  `baseDir`), returning its root, or undefined when the file
 *                  is missing or unparseable.
 * @param visited   conkeyref values already resolved on the current branch;
 *                  re-entering one returns undefined so an A -> B -> A cycle
 *                  terminates instead of recursing (the renderer threads its
 *                  conref chain through here, mirroring direct-conref
 *                  cycle protection).
 */
export function resolveConkeyref(
  conkeyref: string,
  defs: ReadonlyMap<string, KeyHrefDef>,
  loadTopic: (baseDir: string, href: string) => DitaNode | undefined,
  visited?: ReadonlySet<string>,
): DitaNode | undefined {
  if (!conkeyref) return undefined;
  // A conkeyref already resolved on this branch points back here -- stop the
  // cycle and let the caller fall back (conref / literal content).
  if (visited?.has(conkeyref)) return undefined;

  const { keyName, elementId } = parseConkeyref(conkeyref);
  if (!keyName) return undefined;
  const def = defs.get(keyName);
  // Key not defined, or defined without a resource target: nothing to pull.
  if (!def || !def.href) return undefined;

  const root = loadTopic(def.baseDir, def.href);
  if (!root) return undefined;

  // No element id -- the reference targets the key's whole topic.
  if (!elementId) return root;
  return findElementById(root, elementId);
}
