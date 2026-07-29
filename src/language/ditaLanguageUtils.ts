// Pure, editor-agnostic logic behind the DITA language features
// (go-to-definition, completion, diagnostics, document symbols).
// Everything here works on raw text + offsets so it stays unit-testable;
// the VS Code glue lives in ditaLanguageFeatures.ts.

import { DitaNode, SourceRange } from '../parser/domTypes';
import { createBookRoleLabeler, RoleLabelFormatter } from '../render/mapTypeMap';

// ── Reference attribute scanning ──

/** Attributes whose values reference other files/keys/elements. */
const REF_ATTRS = new Set(['href', 'conref', 'conkeyref', 'keyref']);

export interface RefEntry {
  /** Attribute name (href / conref / conkeyref / keyref) */
  attr: string;
  /** Raw attribute value */
  value: string;
  /** Offset of the first character of the value (inside the quotes) */
  valueStart: number;
  /** Offset just past the last character of the value */
  valueEnd: number;
  /** Tag the attribute belongs to */
  tagName: string;
  /** scope attribute on the same tag, if any */
  scope?: string;
  /** format attribute on the same tag, if any */
  format?: string;
}

const TAG_RE = /<([A-Za-z][\w.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const ATTR_RE = /([\w:.-]+)\s*=\s*"([^"]*)"/g;

/** Collects every reference-bearing attribute in the document text. */
export function collectRefEntries(text: string): RefEntry[] {
  const entries: RefEntry[] = [];
  TAG_RE.lastIndex = 0;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = TAG_RE.exec(text)) !== null) {
    const tagName = tagMatch[1];
    const attrSegment = tagMatch[2];
    if (!attrSegment) continue;
    const segmentOffset = tagMatch.index + 1 + tagName.length;

    // First pass: pick up scope/format so hrefs can be classified
    let scope: string | undefined;
    let format: string | undefined;
    ATTR_RE.lastIndex = 0;
    let am: RegExpExecArray | null;
    while ((am = ATTR_RE.exec(attrSegment)) !== null) {
      if (am[1] === 'scope') scope = am[2];
      else if (am[1] === 'format') format = am[2];
    }

    ATTR_RE.lastIndex = 0;
    while ((am = ATTR_RE.exec(attrSegment)) !== null) {
      if (!REF_ATTRS.has(am[1])) continue;
      const eqAndQuote = am[0].indexOf('"');
      const valueStart = segmentOffset + am.index + eqAndQuote + 1;
      entries.push({
        attr: am[1],
        value: am[2],
        valueStart,
        valueEnd: valueStart + am[2].length,
        tagName,
        scope,
        format,
      });
    }
  }
  return entries;
}

/** Finds the reference attribute whose value contains the given offset. */
export function findRefAttrAt(text: string, offset: number): RefEntry | undefined {
  return collectRefEntries(text).find((e) => offset >= e.valueStart && offset <= e.valueEnd);
}

const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const WIN_ABS_RE = /^([a-zA-Z]:[\\/]|\\\\|\/)/;

/** True when the reference points outside the local project (not resolvable from disk). */
export function isExternalRef(value: string, scope?: string): boolean {
  if (!value) return true;
  if (scope === 'external' || scope === 'peer') return true;
  if (URL_SCHEME_RE.test(value)) return true;
  if (WIN_ABS_RE.test(value)) return true;
  return false;
}

// ── Key definition lookup ──

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&');
}

/**
 * Returns the offset of the keys="..." attribute that defines the given key
 * inside a ditamap source text, or -1. A keys attribute may hold a
 * space-separated list of key names.
 */
export function findKeyDefinitionOffset(mapText: string, key: string): number {
  const re = /\bkeys\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(mapText)) !== null) {
    const names = m[1].split(/\s+/).filter(Boolean);
    if (names.includes(key)) return m.index;
  }
  return -1;
}

/**
 * Resolves a conref/href fragment ("topicId" or "topicId/elementId") to the
 * offset of the target id="..." attribute in the target file's text, or -1.
 */
export function findConrefTargetOffset(text: string, fragment: string): number {
  const [topicId, elementId] = fragment.split('/');
  if (!topicId) return -1;
  const findId = (id: string, from: number): number => {
    const re = new RegExp(`\\bid\\s*=\\s*"${escapeRegExp(id)}"`, 'g');
    re.lastIndex = from;
    const m = re.exec(text);
    return m ? m.index : -1;
  };
  const topicOff = findId(topicId, 0);
  if (topicOff < 0) return -1;
  if (!elementId) return topicOff;
  return findId(elementId, topicOff);
}

/** Collects all id="..." values declared in a document text. */
export function collectIds(text: string): string[] {
  const ids: string[] = [];
  const re = /\bid\s*=\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) ids.push(m[1]);
  return ids;
}

/** Converts a character offset into a 0-based line/column pair. */
export function offsetToLineCol(text: string, offset: number): { line: number; col: number } {
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, col: offset - lineStart };
}

// ── Completion context detection ──

export type CompletionContextKind = 'tag' | 'attrName' | 'attrValue' | 'none';

export interface DitaCompletionContext {
  kind: CompletionContextKind;
  /** Tag the cursor is inside of (for attrName/attrValue) */
  tagName?: string;
  /** Attribute whose value is being typed (for attrValue) */
  attrName?: string;
  /** Text already typed for the current token */
  prefix?: string;
  /** Offset where the current attr value starts (for attrValue) */
  valueStart?: number;
  /** True when typing a closing tag ("</se") */
  closing?: boolean;
}

/** Classifies what kind of completion applies at the given offset. */
export function getCompletionContext(text: string, offset: number): DitaCompletionContext {
  const lastLt = text.lastIndexOf('<', offset - 1);
  if (lastLt < 0) return { kind: 'none' };
  const between = text.substring(lastLt, offset);
  // Comments / processing instructions / closed tags → no structural completion
  if (between.includes('>') || between.startsWith('<!') || between.startsWith('<?')) {
    return { kind: 'none' };
  }

  // Still typing the tag name itself: "<", "<no", "</se"
  const tagTyping = /^<(\/?)([\w.-]*)$/.exec(between);
  if (tagTyping) return { kind: 'tag', prefix: tagTyping[2], closing: tagTyping[1] === '/' };

  const tagNameMatch = /^<\/?([\w.-]+)/.exec(between);
  const tagName = tagNameMatch ? tagNameMatch[1] : undefined;

  // Inside an attribute value: attr="partial
  const valueMatch = /([\w:.-]+)\s*=\s*"([^"]*)$/.exec(between);
  if (valueMatch) {
    return {
      kind: 'attrValue',
      tagName,
      attrName: valueMatch[1],
      prefix: valueMatch[2],
      valueStart: offset - valueMatch[2].length,
    };
  }

  // After whitespace inside the tag → attribute name position
  if (/[\s"']([\w:.-]*)$/.test(between)) {
    const anm = /([\w:.-]*)$/.exec(between);
    return { kind: 'attrName', tagName, prefix: anm ? anm[1] : '' };
  }

  return { kind: 'none' };
}

// ── Tag auto-closing ──

/**
 * When the character just typed before `offset` is the '>' of an opening
 * tag, returns the tag name to auto-close. Closing tags, self-closing tags,
 * comments, PIs and '>' inside attribute values yield undefined.
 */
export function getAutoCloseTag(text: string, offset: number): string | undefined {
  if (text[offset - 1] !== '>') return undefined;
  const lastLt = text.lastIndexOf('<', offset - 2);
  if (lastLt < 0) return undefined;
  const tagText = text.substring(lastLt, offset);
  if (tagText.startsWith('</') || tagText.startsWith('<!') || tagText.startsWith('<?')) {
    return undefined;
  }
  if (/\/\s*>$/.test(tagText)) return undefined;
  // An odd number of quotes means the '>' was typed inside an attribute value
  if (((tagText.match(/"/g) || []).length) % 2 === 1) return undefined;
  const m = /^<([A-Za-z][\w.-]*)(?:[\s>]|$)/.exec(tagText);
  return m ? m[1] : undefined;
}

/** Innermost tag left unclosed at the end of the given text. */
export function findUnclosedTag(text: string): string | undefined {
  // Strip constructs whose content must not feed the tag stack
  const cleaned = text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ' ')
    .replace(/<\?[\s\S]*?\?>/g, ' ')
    .replace(/<![^>]*>/g, ' ');
  const stack: string[] = [];
  const re = /<(\/?)([A-Za-z][\w.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    if (m[1]) {
      // Pop down to the matching open tag (tolerates malformed nesting)
      const idx = stack.lastIndexOf(m[2]);
      if (idx >= 0) stack.length = idx;
    } else if (!/\/\s*$/.test(m[3])) {
      stack.push(m[2]);
    }
  }
  return stack[stack.length - 1];
}

/**
 * When the two characters ending at `offset` are '</', returns the tag name
 * that completes the closing tag, or undefined.
 */
export function getCloseTagCompletion(text: string, offset: number): string | undefined {
  if (text.substring(offset - 2, offset) !== '</') return undefined;
  return findUnclosedTag(text.substring(0, offset - 2));
}

// ── Attribute knowledge for completion ──

const UNIVERSAL_ATTRS = [
  'id',
  'conref',
  'conkeyref',
  'keyref',
  'outputclass',
  'props',
  'audience',
  'platform',
  'product',
  'rev',
  'importance',
  'translate',
  'xml:lang',
];

const REF_TAG_ATTRS = ['href', 'keys', 'keyref', 'navtitle', 'format', 'scope', 'processing-role', 'toc', 'type', 'collection-type'];

export const TAG_SPECIFIC_ATTRS: Record<string, string[]> = {
  xref: ['href', 'format', 'scope', 'type'],
  link: ['href', 'format', 'scope', 'type'],
  image: ['href', 'height', 'width', 'placement', 'align', 'scale'],
  note: ['type', 'othertype'],
  topicref: REF_TAG_ATTRS,
  keydef: ['keys', 'href', 'format', 'scope', 'processing-role'],
  mapref: ['href', 'format', 'processing-role'],
  chapter: REF_TAG_ATTRS,
  part: REF_TAG_ATTRS,
  appendix: REF_TAG_ATTRS,
  preface: REF_TAG_ATTRS,
  glossaryref: REF_TAG_ATTRS,
  topichead: ['navtitle', 'collection-type'],
  table: ['frame', 'colsep', 'rowsep', 'pgwide'],
  tgroup: ['cols'],
  colspec: ['colname', 'colwidth', 'colnum'],
  entry: ['colname', 'namest', 'nameend', 'morerows', 'valign', 'align'],
  codeblock: ['outputclass', 'scale'],
  ph: ['keyref'],
  keyword: ['keyref'],
  term: ['keyref'],
  lq: ['href', 'reftitle'],
  fig: ['frame', 'expanse'],
  section: ['spectitle'],
};

/** Attribute names offered for a tag: tag-specific first, then universal. */
export function getAttributesForTag(tag: string | undefined): string[] {
  const specific = tag ? TAG_SPECIFIC_ATTRS[tag] || [] : [];
  const merged: string[] = [...specific];
  for (const a of UNIVERSAL_ATTRS) if (!merged.includes(a)) merged.push(a);
  return merged;
}

// ── Document symbols ──

export interface DocSymbolSpec {
  name: string;
  detail?: string;
  kind: 'topic' | 'section' | 'ref' | 'head' | 'structural' | 'keydef';
  range: SourceRange;
  children: DocSymbolSpec[];
}

function plainText(node: DitaNode): string {
  if (node.type === 'text') return node.text || '';
  return (node.children || []).map(plainText).join('');
}

function findTitleText(node: DitaNode): string | undefined {
  const titleChild = (node.children || []).find(
    (c) => c.type === 'element' && c.baseType === 'topic/title',
  );
  if (!titleChild) return undefined;
  const t = plainText(titleChild).trim();
  return t || undefined;
}

/** Outline for a .dita topic file: topics, sections and examples. */
// Topic specializations are recognized by tag name too: authored source
// files carry no @class attribute, so their baseType stays undefined.
const TOPIC_ROOT_TAGS = new Set([
  'topic',
  'concept',
  'task',
  'reference',
  'glossentry',
  'glossgroup',
  'troubleshooting',
]);

function isTopicNode(node: DitaNode): boolean {
  return node.baseType === 'topic/topic' || (!!node.tagName && TOPIC_ROOT_TAGS.has(node.tagName));
}

export function collectTopicSymbols(root: DitaNode): DocSymbolSpec[] {
  function walk(node: DitaNode): DocSymbolSpec[] {
    const result: DocSymbolSpec[] = [];
    for (const child of node.children || []) {
      if (child.type !== 'element') continue;
      const bt = child.baseType;
      if (isTopicNode(child)) {
        result.push({
          name: findTitleText(child) || child.attributes?.id || '(topic)',
          detail: child.tagName,
          kind: 'topic',
          range: child.sourceRange,
          children: walk(child),
        });
      } else if (bt === 'topic/section' || bt === 'topic/example') {
        result.push({
          name: findTitleText(child) || (bt === 'topic/example' ? '(example)' : '(section)'),
          detail: child.tagName,
          kind: 'section',
          range: child.sourceRange,
          children: walk(child),
        });
      } else {
        result.push(...walk(child));
      }
    }
    return result;
  }

  // The root topic itself is represented too, so breadcrumbs show it
  if (isTopicNode(root)) {
    return [
      {
        name: findTitleText(root) || root.attributes?.id || '(topic)',
        detail: root.tagName,
        kind: 'topic',
        range: root.sourceRange,
        children: walk(root),
      },
    ];
  }
  return walk(root);
}

/** Display name for a map reference node (navtitle > linktext > href > keys). */
export function getMapRefName(node: DitaNode): string {
  const topicmeta = (node.children || []).find(
    (c) => c.type === 'element' && c.baseType === 'map/topicmeta',
  );
  if (topicmeta) {
    for (const bt of ['map/navtitle', 'map/linktext']) {
      const child = (topicmeta.children || []).find(
        (c) => c.type === 'element' && c.baseType === bt,
      );
      if (child) {
        const t = plainText(child).trim();
        if (t) return t;
      }
    }
  }
  const navtitleAttr = node.attributes?.navtitle;
  if (navtitleAttr) return navtitleAttr;
  const href = node.attributes?.href;
  if (href) return href;
  const keys = node.attributes?.keys;
  if (keys) return keys;
  return '(unnamed)';
}

/** Outline for a .ditamap file: topicref hierarchy with structural containers. */
export function collectMapSymbols(root: DitaNode, roleFormat?: RoleLabelFormatter): DocSymbolSpec[] {
  const roleLabel = createBookRoleLabeler(roleFormat);
  function walk(node: DitaNode, depth: number): DocSymbolSpec[] {
    const result: DocSymbolSpec[] = [];
    for (const child of node.children || []) {
      if (child.type !== 'element') continue;
      const bt = child.baseType;
      if (bt === 'map/topicref' || bt === 'map/mapref') {
        // Book divisions surface their numbered role ("Chapter 1", …)
        const label = roleLabel(child.tagName, depth);
        result.push({
          name: getMapRefName(child),
          detail: label || child.tagName,
          kind: 'ref',
          range: child.sourceRange,
          children: walk(child, depth + 1),
        });
      } else if (bt === 'map/keydef') {
        result.push({
          name: child.attributes?.keys || '(keydef)',
          detail: child.tagName,
          kind: 'keydef',
          range: child.sourceRange,
          children: walk(child, depth + 1),
        });
      } else if (bt === 'map/topichead') {
        result.push({
          name: getMapRefName(child),
          detail: child.tagName,
          kind: 'head',
          range: child.sourceRange,
          children: walk(child, depth + 1),
        });
      } else if (bt === 'map/bookmap-structural') {
        result.push({
          name: child.tagName || '(container)',
          kind: 'structural',
          range: child.sourceRange,
          children: walk(child, depth),
        });
      } else if (bt === 'map/reltable') {
        continue;
      } else {
        result.push(...walk(child, depth));
      }
    }
    return result;
  }
  return walk(root, 0);
}
