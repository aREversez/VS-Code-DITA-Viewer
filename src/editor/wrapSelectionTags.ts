// Pure logic for "wrap selection with DITA tag" (Oxygen-style: select text,
// press Enter, pick a tag from a searchable list). No vscode import here so
// this can be unit-tested directly; the vscode glue lives in
// wrapSelectionCommand.ts.

import { STANDARD_TAG_TO_BASETYPE } from '../parser/standardTagMap';
import { MAP_STANDARD_TAG_TO_BASETYPE } from '../parser/mapTagMap';

export interface WrapTagCandidate {
  tag: string;
  basetype: string;
}

const MAX_MRU = 8;

/**
 * All distinct tag names available for wrapping, sorted alphabetically, for
 * a topic (.dita) document or a map (.ditamap) document. The two tag maps
 * are keyed by tag name and can contain duplicate values (specializations
 * sharing a basetype), so this dedupes on the key, not the basetype.
 */
export function getWrapTagCandidates(isMap: boolean): WrapTagCandidate[] {
  const source = isMap ? MAP_STANDARD_TAG_TO_BASETYPE : STANDARD_TAG_TO_BASETYPE;
  const seen = new Set<string>();
  const out: WrapTagCandidate[] = [];
  for (const tag of Object.keys(source).sort((a, b) => a.localeCompare(b))) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push({ tag, basetype: source[tag] });
  }
  return out;
}

/**
 * Wraps `text` in `<tag>...</tag>`. Multi-line selections are wrapped as-is,
 * with no reindentation -- matching how Oxygen's own "Surround With" behaves.
 */
export function wrapTextWithTag(text: string, tag: string): string {
  return `<${tag}>${text}</${tag}>`;
}

/**
 * Moves `tag` to the front of `mru` (most-recently-used first), removing any
 * earlier occurrence and capping the list at `max` entries. Pure so the
 * ordering logic can be kill-tested without a real globalState.
 */
export function pushMruTag(mru: readonly string[], tag: string, max = MAX_MRU): string[] {
  const next = [tag, ...mru.filter((t) => t !== tag)];
  return next.slice(0, max);
}

/**
 * Orders candidates with MRU tags first (in MRU order), then the remaining
 * candidates in their existing (alphabetical) order. MRU entries that are no
 * longer valid tags for this document type are silently dropped.
 */
export function orderCandidatesWithMru(
  candidates: readonly WrapTagCandidate[],
  mru: readonly string[],
): WrapTagCandidate[] {
  const byTag = new Map(candidates.map((c) => [c.tag, c] as const));
  const mruOrdered: WrapTagCandidate[] = [];
  const usedTags = new Set<string>();
  for (const tag of mru) {
    const c = byTag.get(tag);
    if (c && !usedTags.has(tag)) {
      mruOrdered.push(c);
      usedTags.add(tag);
    }
  }
  const rest = candidates.filter((c) => !usedTags.has(c.tag));
  return [...mruOrdered, ...rest];
}

/**
 * Is `tag` a syntactically plausible element name a user could type into the
 * picker's search box (letters/digits/hyphen, must start with a letter)?
 * Used to decide whether to offer a "wrap with <input>" fallback item for
 * tags that aren't in the known candidate list (specializations we don't
 * enumerate, or deliberately custom elements).
 */
export function isValidCustomTagName(tag: string): boolean {
  return /^[A-Za-z][A-Za-z0-9-]*$/.test(tag);
}
