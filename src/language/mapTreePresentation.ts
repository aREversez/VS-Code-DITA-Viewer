/**
 * How a row of the Explorer's DITA map tree presents itself: the label it
 * shows and the icon that sits left of it. Extracted from
 * ditaMapTreeProvider.ts (which stays vscode-wired) so the two decision
 * tables worth pinning down -- which name a row answers to, and which icon
 * marks its DITA type -- can be unit-tested against parsed fixtures.
 */
import { DitaNode } from '../parser/domTypes';
import { getDisplayNameInfo, getMapTitleText, isDitamapRef } from '../render/mapTypeMap';

export interface MapTreeLabelContext {
  /** True for the root row: the main map itself rather than one of its references. */
  isRoot: boolean;
  /** Key resolver from the map's keydefs -- titles resolve their keyrefs through it. */
  resolveKey?: (key: string) => string | undefined;
  /**
   * Reads a referenced file's own title off disk (makeFileTitleResolver).
   * Only consulted for entries the map itself never named.
   */
  readTitle: (href: string) => string | undefined;
  /** Label for the root row when the map carries no parsable title at all. */
  rootFallback: string;
}

/**
 * The label of one visible tree row.
 *
 * - The root row shows the map's own <title>/<mainbooktitle>, keyrefs
 *   resolved, falling back to the file name. Before this, the tree had no
 *   root row at all -- the map's top-level references started at the very
 *   top, and the map itself (its title, the file behind it) was invisible.
 * - A submap reference (a mapref, or any reference whose href points at a
 *   .ditamap) shows the referenced map's own title rather than its file
 *   name. expandDitamapRefs already spliced that map's children -- its
 *   <title> included -- into the node, so the title is in the DOM already;
 *   a title carrying a keyref (the version-number pattern software manuals
 *   use) resolves through it. A duplicate reference (the second ref to the
 *   same map is not spliced in again) falls back to reading the file.
 * - A keydef answers to its key: the keyword/navtitle the map gave it, or
 *   the keys value. Never the target topic's own title -- that names the
 *   topic, not the reusable string the key stands for.
 * - Everything else keeps the docsite sidebar's resolution order: an
 *   authored navtitle/linktext wins; failing that the referenced topic's
 *   own <title> off disk; the href file name is the last resort.
 */
export function mapTreeLabel(node: DitaNode, ctx: MapTreeLabelContext): string {
  if (ctx.isRoot) {
    return getMapTitleText(node, ctx.resolveKey) || ctx.rootFallback;
  }
  const baseType = node.baseType;
  if (baseType === 'map/bookmap-structural') {
    return node.tagName || '(container)';
  }
  if (baseType === 'map/keydef' && !isDitamapRef(node)) {
    // A keydef's identity is its key: the keyword/navtitle the map gave it,
    // then the keys value itself -- never the target topic's own title,
    // which names the topic, not the reusable string the key stands for.
    const nameInfo = getDisplayNameInfo(node, ctx.resolveKey);
    if (nameInfo.explicit) return nameInfo.text;
    return node.attributes?.keys || nameInfo.text;
  }
  const nameInfo = getDisplayNameInfo(node, ctx.resolveKey);
  if (nameInfo.explicit) return nameInfo.text;
  if (isDitamapRef(node)) {
    const inlined = getMapTitleText(node, ctx.resolveKey);
    if (inlined) return inlined;
  }
  return ctx.readTitle(node.attributes?.href || '') || nameInfo.text;
}

/**
 * Icon per DITA type, the way Oxygen's DITA Maps Manager tells its rows
 * apart: the main map, referenced submaps, key definitions, groupings, and
 * the information types of referenced topics (a task row shows a checklist,
 * a concept a lightbulb, ...). Tag names are the root element of the
 * referenced topic file, as sniffed by makeFileTopicTypeResolver.
 */
export const TOPIC_TYPE_ICON_IDS: Record<string, string> = {
  task: 'checklist',
  concept: 'lightbulb',
  reference: 'references',
  troubleshooting: 'wrench',
  glossentry: 'book',
  glossgroup: 'book',
  topic: 'file',
};

export interface MapTreeIconInput {
  isRoot: boolean;
  /** The row references another .ditamap (mapref or a .ditamap href). */
  isMapRef: boolean;
  baseType?: string;
  /** Root tag of the referenced topic file, when it could be read. */
  topicType?: string;
  /** Carries a numbered book-division label ("Chapter 1", "Part I", ...). */
  hasRole?: boolean;
}

export function mapTreeIconId(input: MapTreeIconInput): string {
  if (input.isRoot) return 'map-filled';
  // A mapref is a map even when its href is not local (external scope) --
  // the tag itself says what kind of thing the row points at.
  if (input.isMapRef || input.baseType === 'map/mapref') return 'map';
  if (input.baseType === 'map/keydef') return 'key';
  if (input.baseType === 'map/topichead' || input.baseType === 'map/bookmap-structural') {
    return 'folder';
  }
  const byType = input.topicType ? TOPIC_TYPE_ICON_IDS[input.topicType] : undefined;
  if (byType) return byType;
  // Unreadable target: a book division still reads as a book row, anything
  // else as a plain file.
  return input.hasRole ? 'book' : 'file';
}
