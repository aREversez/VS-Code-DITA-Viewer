// The crawler's tolerant XML scan into a light node tree, with its element and href helpers.
// Split out of mapCrawl.ts, which re-exports every name here. No vscode dependency.

import sax from 'sax';
import { preprocessEntities } from '@dita-viewer/core';
import { DitavalFilter } from './ditaval';

export interface XNode {
  tag: string;
  attrs: Record<string, string>;
  line: number; // 1-based
  /** Position in its document, unique within one file (a line can hold several elements). */
  uid: number;
  children: XNode[];
  parent?: XNode;
  text: string; // direct text (for <title> presence etc.)
}

// deliveryTarget is a DITA 1.3 filter-atts member (it replaces the deprecated
// DITA 1.2 @print): DITA-OT cascades and filters it on topicrefs like the
// rest of the group, so the map-level profiling checks must know it too.
export const PROFILING_ATTRS = ['audience', 'platform', 'product', 'otherprops', 'deliveryTarget', 'props', 'rev'];

/** Parses XML with sax into a light tree carrying 1-based line numbers. */
export function scanXml(raw: string): { root?: XNode; error?: { line: number; message: string } } {
  const pre = preprocessEntities(raw);
  // stripDoctype can drop newlines (multi-line internal subset); keep line
  // numbers aligned with the file the user sees.
  const drift = Math.max(0, countNewlines(raw) - countNewlines(pre));
  const parser = sax.parser(true, { trim: false, normalize: false, position: true });
  let root: XNode | undefined;
  let cur: XNode | undefined;
  let nextUid = 0;
  let error: { line: number; message: string } | undefined;
  parser.onerror = (err) => {
    error = { line: parser.line + 1 + drift, message: err.message.split('\n')[0] };
    // sax keeps going after error() unless we stop feeding it.
    parser.error = null as unknown as Error;
    throw err;
  };
  parser.onopentag = (node) => {
    const n: XNode = {
      tag: node.name,
      attrs: node.attributes as Record<string, string>,
      line: parser.line + 1 + drift,
      uid: nextUid++,
      children: [],
      parent: cur,
      text: '',
    };
    if (cur) cur.children.push(n);
    else root = n;
    cur = n;
  };
  parser.onclosetag = () => {
    cur = cur?.parent;
  };
  parser.ontext = (t) => {
    if (cur) cur.text += t;
  };
  try {
    parser.write(pre).close();
  } catch {
    return { root, error };
  }
  if (!root) return { error: { line: 1, message: 'No root element found' } };
  return { root };
}

function countNewlines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

/** Removes (in place) every descendant the DITAVAL filter would drop from the output. */
export function pruneExcluded(
  n: XNode,
  filter: DitavalFilter,
  topicId: string | undefined,
  topicIdOf: (n: XNode) => string | undefined,
  onRemove: (removed: XNode, topicId: string | undefined) => void,
): void {
  const keep: XNode[] = [];
  for (const c of n.children) {
    if (filter.excludes(c.attrs)) {
      // The whole subtree goes with it, so every id inside is gone from the output.
      const below = (d: XNode, tid: string | undefined): void => {
        const here = topicIdOf(d) ?? tid;
        onRemove(d, here);
        for (const k of d.children) below(k, here);
      };
      below(c, topicId);
    } else {
      keep.push(c);
      pruneExcluded(c, filter, topicIdOf(c) ?? topicId, topicIdOf, onRemove);
    }
  }
  n.children = keep;
}

export function* walk(n: XNode): Generator<XNode> {
  yield n;
  for (const c of n.children) yield* walk(c);
}

export const URL_RE = /^[a-z][a-z0-9+.-]*:/i;

export function isDitaHref(pathPart: string, format: string | undefined): boolean {
  if (format) return format === 'dita' || format === 'ditamap';
  return /\.(dita|xml|ditamap)$/i.test(pathPart);
}

export function classOf(n: XNode): string {
  return n.attrs['class'] ?? '';
}

export function isMapTag(n: XNode): boolean {
  const c = classOf(n);
  return /\bmap\/(topicref|keydef|mapref|topichead|topicgroup)\b/.test(c) || TOPICREF_TAGS.has(n.tag);
}

export const TOPICREF_TAGS = new Set([
  'topicref', 'keydef', 'mapref', 'topichead', 'topicgroup', 'chapter', 'part', 'appendix',
  'appendices', 'preface', 'glossarylist', 'notices', 'dedication', 'colophon', 'abbrevlist',
  'bibliolist', 'booklist', 'figurelist', 'indexlist', 'toc', 'tablelist', 'trademarklist',
  'amendments', 'draftintro', 'abstract', 'frontmatter', 'backmatter', 'glossentry', 'glossref',
  'topicset', 'topicsetref', 'anchor', 'anchorref',
]);

// ── Crawl ───────────────────────────────────────────────────────────────

function splitValues(v: string): string[] {
  // Handles plain space-separated values and the "attr(group value)" grouping syntax.
  const out: string[] = [];
  const cleaned = v.replace(/[A-Za-z_][\w.-]*\(([^)]*)\)/g, (_m, inner: string) => ` ${inner} `);
  for (const t of cleaned.trim().split(/\s+/)) if (t) out.push(t);
  return out;
}

/**
 * What a profiling attribute value means for the checks. Three shapes are told
 * apart, because the Oxygen report treats them differently:
 * - values: the tokens a group expands to, as splitValues finds them;
 * - emptyValue: the attribute is written with no value at all, empty or spaces
 *   only (dmv.prof.attr.empty.value);
 * - groupOnly: the value is nothing but an empty condition group, `audience()`
 *   (dmv.prof.group.val.prefs.undef), which names no value but is a group the
 *   preferences can be missing.
 */
export function profileValueOf(v: string): { values: string[]; emptyValue: boolean; groupOnly: boolean } {
  const values = splitValues(v);
  if (values.length > 0) return { values, emptyValue: false, groupOnly: false };
  const groups = v.match(/[A-Za-z_][\w.-]*\(\s*\)/g);
  if (groups && groups.length > 0) return { values: groups, emptyValue: false, groupOnly: true };
  return { values: [], emptyValue: true, groupOnly: false };
}

/** Why a key name cannot be parsed, if it cannot (Oxygen's invalid.keyref.syntax.1/.3). */
export function keyrefSyntax(key: string): 'slash' | 'whitespace' | undefined {
  if (!key) return 'whitespace';
  if (key.split('/').length > 2) return 'slash';
  return /\s/.test(key) ? 'whitespace' : undefined;
}

/** Whether a map element carries a navigation title (a @navtitle or topicmeta/navtitle). */
export function hasNavTitle(n: XNode): boolean {
  if (n.attrs['navtitle'] !== undefined) return true;
  return n.children.some((c) => c.tag === 'topicmeta' && c.children.some((t) => t.tag === 'navtitle'));
}
