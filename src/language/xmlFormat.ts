// Pure, dependency-free "Format and Indent" engine for DITA / XML source.
//
// Modelled on the structure of Oxygen's pretty printer (see the design notes
// in the commit message), re-expressed for a text-preserving token tree:
//  - recursion depth drives indentation; the per-depth indent strings are
//    cached (Oxygen keeps them in a push/pop stack of contexts),
//  - element-only content puts every child on its own line one level deeper,
//  - mixed content (text, inline elements) is flowed: source line breaks and
//    their own indent columns decide where a run continues, unless the caller
//    opts into `wrapMixedContent`, which additionally wraps by `lineWidth`,
//  - whitespace-preserving elements (codeblock, pre, ...) are copied verbatim.
//
// Safety rules (they make the result idempotent and semantics-preserving):
//  - whitespace is only ever collapsed or turned into a line break where
//    whitespace already existed; it is never invented inside mixed content,
//  - text, entity references, comments, CDATA, PIs and attribute values are
//    copied verbatim (no normalization),
//  - a document that is not well-formed is refused, never "repaired".

import { MarkupToken, scanMarkup } from './xmlTagBalance';

export interface FormatOptions {
  /** Columns per indent level. */
  indentSize: number;
  useTabs: boolean;
  /** Wrap attributes and long mixed-content runs at this many columns (0 = never wrap). */
  lineWidth: number;
  /**
   * Additionally wrap mixed content at `lineWidth`. Off by default so the
   * layout matches Oxygen, whose `lineWidth` only affects attribute wrapping
   * and never reflows prose between inline tags. Turn on when you want a hard
   * print-style wrap of mixed content (the historical behaviour of this
   * formatter before Oxygen parity).
   */
  wrapMixedContent: boolean;
  /** `<a/>` becomes `<a></a>`; otherwise `<a></a>` becomes `<a/>`. */
  expandEmptyElements: boolean;
  /** Every attribute of a start tag on its own line, one level deeper. */
  breakLineBeforeAttribute: boolean;
  /** Wrap a start tag's attributes at the line width. */
  breakLongAttributes: boolean;
  /** Extra elements whose content is copied verbatim. */
  preserveSpaceElements: string[];
  /** Extra elements treated as inline (their parent's content stays mixed). */
  mixedContentElements: string[];
  /** Elements that always start on their own line, even in mixed content (none by default: Oxygen keeps them in the text flow). */
  breakLineElements: string[];
}

export const DEFAULT_FORMAT_OPTIONS: FormatOptions = {
  indentSize: 2,
  useTabs: false,
  lineWidth: 80,
  wrapMixedContent: false,
  expandEmptyElements: false,
  breakLineBeforeAttribute: false,
  breakLongAttributes: true,
  preserveSpaceElements: [],
  mixedContentElements: [],
  breakLineElements: [],
};

// DITA elements whose whitespace is significant (white-space: pre).
const PRESERVE_SPACE = ['codeblock', 'pre', 'lines', 'screen', 'msgblock'];

// DITA phrase-level elements. `image`, `data` and `indexterm` are left out on
// purpose: they also sit alone in element-only parents (fig, entry, ...).
const INLINE = [
  'ph', 'b', 'i', 'u', 'tt', 'sup', 'sub', 'line-through', 'overline',
  'uicontrol', 'wintitle', 'menucascade', 'shortcut', 'userinput', 'systemoutput',
  'filepath', 'cmdname', 'codeph', 'option', 'parmname', 'varname', 'apiname',
  'msgnum', 'msgph', 'synph', 'kwd', 'var', 'oper', 'delim', 'sep', 'repsep',
  'xref', 'keyword', 'term', 'tm', 'q', 'cite', 'abbreviated-form', 'text',
  'boolean', 'state', 'foreign', 'unknown', 'fn', 'draft-comment',
  'required-cleanup', 'xmlelement', 'xmlatt', 'textentity', 'numcharref',
  'parameterentity', 'xmlnsname', 'xmlpi', 'longquoteref', 'navtitle',
  'linktext', 'shortdesc-inline', 'data-about', 'sort-as',
];

// ─────────────────────────── tree ───────────────────────────

interface Attr {
  /** `name="value"` — value and quote style verbatim, no spaces around `=`. */
  text: string;
}

type XNode = XElement | XLeaf;

interface XLeaf {
  kind: 'text' | 'comment' | 'cdata' | 'pi' | 'declaration';
  start: number;
  end: number;
  raw: string;
  parent: XElement | null;
}

interface XElement {
  kind: 'element';
  name: string;
  start: number;
  end: number;
  /** The start tag as written, and its parsed attributes (null = unparseable). */
  rawStartTag: string;
  attrs: Attr[] | null;
  selfClosing: boolean;
  children: XNode[];
  parent: XElement | null;
  /** Source of the whole element (start tag through end tag). */
  raw: string;
}

const ATTR_RE = /\s*([^\s=/>"']+)\s*=\s*("[^"]*"|'[^']*')/y;
const XML_WS = /[ \t\r\n]+/;

function parseAttrs(startTag: string, name: string): Attr[] | null {
  let i = 1 + name.length;
  const stop = startTag.endsWith('/>') ? startTag.length - 2 : startTag.length - 1;
  const attrs: Attr[] = [];
  for (;;) {
    ATTR_RE.lastIndex = i;
    const m = ATTR_RE.exec(startTag);
    if (!m || m.index + m[0].length > stop) break;
    attrs.push({ text: `${m[1]}=${m[2]}` });
    i = m.index + m[0].length;
  }
  return startTag.slice(i, stop).trim() === '' ? attrs : null;
}

export type ParseResult =
  | { ok: true; roots: XNode[] }
  | { ok: false; message: string; offset: number };

function parseTree(text: string): ParseResult {
  const { tokens, issues } = scanMarkup(text);
  if (issues.length > 0) {
    const first = issues[0];
    return {
      ok: false,
      offset: first.start,
      message: first.tagName ? `${first.kind}: <${first.tagName}>` : first.kind,
    };
  }
  const roots: XNode[] = [];
  const stack: XElement[] = [];
  const add = (n: XNode) => (stack.length ? stack[stack.length - 1].children : roots).push(n);
  const parentNow = () => (stack.length ? stack[stack.length - 1] : null);
  let pos = 0;

  const pushText = (end: number) => {
    if (end > pos) add({ kind: 'text', start: pos, end, raw: text.slice(pos, end), parent: parentNow() });
  };

  for (const t of tokens as MarkupToken[]) {
    pushText(t.start);
    pos = t.end;
    const raw = text.slice(t.start, t.end);
    if (t.kind === 'start' || t.kind === 'empty') {
      const name = t.name as string;
      const el: XElement = {
        kind: 'element', name, start: t.start, end: t.end, rawStartTag: raw,
        attrs: parseAttrs(raw, name), selfClosing: t.kind === 'empty',
        children: [], parent: parentNow(), raw,
      };
      add(el);
      if (t.kind === 'start') stack.push(el);
    } else if (t.kind === 'end') {
      const el = stack.pop() as XElement;
      el.end = t.end;
      el.raw = text.slice(el.start, t.end);
    } else {
      add({ kind: t.kind, start: t.start, end: t.end, raw, parent: parentNow() });
    }
  }
  pushText(text.length);
  return { ok: true, roots };
}

// ─────────────────────────── output ───────────────────────────

class Out {
  lines: string[] = [];
  cur = '';
  cols = 0;
  private started = false;
  private readonly indents: string[] = [];

  constructor(readonly o: FormatOptions) {}

  /** Cached indent string for a depth (Oxygen's per-depth context prefix). */
  indent(depth: number): string {
    for (let d = this.indents.length; d <= depth; d++) {
      this.indents[d] = d === 0 ? '' : this.indents[d - 1] + (this.o.useTabs ? '\t' : ' '.repeat(this.o.indentSize));
    }
    return this.indents[depth];
  }

  /** Visual columns taken by `depth` levels. */
  indentCols(depth: number): number {
    return depth * this.o.indentSize;
  }

  /** Start a fresh line indented to `depth`. */
  begin(depth: number): void {
    if (this.started) this.lines.push(this.cur);
    this.cur = this.indent(depth);
    this.cols = this.indentCols(depth);
    this.started = true;
  }

  put(s: string): void {
    const norm = s.replace(/\r\n?/g, '\n');
    const parts = norm.split('\n');
    this.cur += parts[0];
    this.cols += parts[0].length;
    for (let i = 1; i < parts.length; i++) {
      this.lines.push(this.cur);
      this.cur = parts[i];
      this.cols = parts[i].length;
    }
  }

  finish(): string[] {
    if (this.started) this.lines.push(this.cur);
    this.started = false;
    return this.lines;
  }
}

interface Ctx {
  o: FormatOptions;
  preserve: Set<string>;
  inline: Set<string>;
  /** User-listed elements that always start a line (empty by default). */
  block: Set<string>;
}

function makeCtx(o: FormatOptions): Ctx {
  return {
    o,
    preserve: new Set([...PRESERVE_SPACE, ...o.preserveSpaceElements]),
    inline: new Set([...INLINE, ...o.mixedContentElements]),
    block: new Set(o.breakLineElements),
  };
}

const isWs = (n: XNode): boolean => n.kind === 'text' && n.raw.trim() === '';
const hasXmlSpacePreserve = (el: XElement): boolean => /\bxml:space\s*=\s*["']preserve["']/.test(el.rawStartTag);
const isPreserved = (el: XElement, c: Ctx): boolean => c.preserve.has(el.name) || hasXmlSpacePreserve(el);

function meaningful(el: XElement): XNode[] {
  return el.children.filter((n) => !isWs(n));
}

/**
 * Text, CDATA, or an inline child makes the element's content "mixed".
 *
 * Oxygen decides mixed vs. element-only from the schema, not from what the
 * source looks like: a `<section>` that happens to hold a `<ph>` (its schema
 * says element-only) is still laid out block-wise, and a `<keywords>` whose
 * `keyword*` children are all phrase-level is likewise element-only. Without
 * the schema, "has real text or CDATA directly" is the reliable proxy — the
 * children that make it truly mixed (running text with tags inside) are the
 * ones with a text node among them. Only an inline child, with no real text
 * alongside, is Oxygen-block: `<link><linktext>…</linktext></link>`,
 * `<xref …><linktext>…</linktext></xref>`, `<keywords><keyword>…</keyword>…`.
 */
function isMixed(el: XElement, _c: Ctx): boolean {
  for (const ch of el.children) {
    if (ch.kind === 'text' && ch.raw.trim() !== '') return true;
    if (ch.kind === 'cdata') return true;
  }
  return false;
}

function firstLineLen(s: string): number {
  const i = s.search(/[\r\n]/);
  return i < 0 ? s.length : i;
}

// ── start tags ──

/** A start tag in the stream: written attribute by attribute so it can wrap. */
interface OpenTag {
  el: XElement;
  closing: '>' | '/>';
  /** Depth of the element; attribute continuation lines sit at depth + 1. */
  depth: number;
}

type Piece = string | OpenTag;

function oneLine(t: OpenTag): string {
  const { el } = t;
  if (!el.attrs) return el.rawStartTag.slice(0, el.selfClosing ? -2 : -1) + t.closing;
  return `<${el.name}${el.attrs.map((a) => ' ' + a.text).join('')}${t.closing}`;
}

const pieceLen = (p: Piece): number => firstLineLen(typeof p === 'string' ? p : oneLine(p));

/** Whether `putOpenTag` can break this tag between `<name` and its end. */
function canWrapAttributes(t: OpenTag, c: Ctx): boolean {
  const n = t.el.attrs ? t.el.attrs.length : 0;
  if (n === 0 || c.o.lineWidth <= 0) return false;
  return c.o.breakLongAttributes || (c.o.breakLineBeforeAttribute && n >= 2);
}

/**
 * Write a start tag, filling each line up to the line width. An attribute that
 * does not fit starts a continuation line one level below the element (the
 * same indent its children get), not under the first attribute — this is how
 * Oxygen lays long tags out, including tags that sit in the middle of a text
 * line and are already past the width when they start.
 *
 * `tailRun` is the width of the content glued right after the closing bracket
 * (a text or inline run that starts on the same line, with no whitespace in
 * front of it). Oxygen treats that bracket plus its glued run as one unit: if
 * they no longer fit, the bracket itself drops to a continuation line — at the
 * attribute-continuation level when the tag's own attributes already wrapped
 * (so the bracket lines up with the wrapped attribute that precedes it), or
 * one level shallower (the tag's own depth) when the attributes fit inline
 * and only the bracket needs to move. The glued run follows right after.
 * The glued run ends where the next tag with attributes begins: that tag
 * wraps at its own attributes, so only its `<name` belongs to the unit.
 */
function putOpenTag(t: OpenTag, out: Out, c: Ctx, tailRun = 0): void {
  const { el } = t;
  const attrs = el.attrs ? el.attrs.map((a) => a.text) : [];
  if (!el.attrs || attrs.length === 0) {
    out.put(oneLine(t));
    return;
  }
  const cont = t.depth + 1;
  out.put(`<${el.name}`);
  if (c.o.breakLineBeforeAttribute && attrs.length >= 2) {
    for (const a of attrs) {
      out.begin(cont);
      out.put(a);
    }
    out.put(t.closing);
    return;
  }
  const width = c.o.lineWidth;
  let attrsWrapped = false;
  attrs.forEach((a) => {
    if (c.o.breakLongAttributes && width > 0 && out.cols + 1 + firstLineLen(a) > width) {
      out.begin(cont);
      out.put(a);
      attrsWrapped = true;
    } else {
      out.put(' ' + a);
    }
  });
  if (c.o.breakLongAttributes && width > 0 && tailRun > 0 && out.cols + t.closing.length + tailRun > width) {
    out.begin(attrsWrapped ? cont : t.depth);
  }
  out.put(t.closing);
}

// ── element-only layout ──

function emitBlock(node: XNode, depth: number, out: Out, c: Ctx): void {
  out.begin(depth);
  if (node.kind === 'element') emitElement(node, depth, out, c);
  else out.put(node.raw.trim());
}

/**
 * Return the entire element rendered as a single line when Oxygen would keep
 * it that way. Three shapes qualify:
 *   1. A self-closing element (`<a/>`): always inline-able.
 *   2. A text-only leaf: exactly one text child glued to both tags with no
 *      source newline; whitespace at either edge collapses to a single space
 *      exactly the way `emitMixed` would render it.
 *   3. An element-only parent whose every child is inline-able (recursively)
 *      and where the source has zero whitespace between the tags and children.
 * Anything preserved, unparseable, spread across source lines, or containing a
 * comment / PI / CDATA at the parent level returns null. The caller enforces
 * the option-level vetoes (`expandEmptyElements`, `breakLineBeforeAttribute`)
 * and the width check.
 */
function tryInlineTree(el: XElement, c: Ctx): string | null {
  if (isPreserved(el, c) || el.attrs === null) return null;
  if (el.selfClosing) return oneLine({ el, closing: '/>', depth: 0 });
  const kids = meaningful(el);
  if (kids.length === 0) return null;
  const openEnd = el.start + el.rawStartTag.length;
  const closeStart = el.end - (3 + el.name.length);
  if (kids.length === 1 && kids[0].kind === 'text') {
    const t = kids[0];
    if (t.start !== openEnd || t.end !== closeStart) return null;
    if (t.raw.includes('\n') || t.raw.includes('\r')) return null;
    const txt = t.raw.trim();
    if (txt === '') return null;
    const lead = /^[ \t]/.test(t.raw) ? ' ' : '';
    const trail = /[ \t]$/.test(t.raw) ? ' ' : '';
    return oneLine({ el, closing: '>', depth: 0 }) + lead + txt + trail + `</${el.name}>`;
  }
  // Element-only: no text / CDATA / comment / PI at this level, and every
  // child sits flush against the previous one's end tag.
  for (const k of kids) if (k.kind !== 'element') return null;
  let cursor = openEnd;
  let s = oneLine({ el, closing: '>', depth: 0 });
  for (const k of kids) {
    const childEl = k as XElement;
    if (childEl.start !== cursor) return null;
    const child = tryInlineTree(childEl, c);
    if (child === null) return null;
    s += child;
    cursor = childEl.end;
  }
  if (cursor !== closeStart) return null;
  return s + `</${el.name}>`;
}

/**
 * Wrapper around `tryInlineTree` used from `emitElement`: apply the option-
 * level vetoes, refuse mixed content at this level, and check the resulting
 * line against the configured width.
 */
function tryCollapseElementOnly(el: XElement, kids: XNode[], out: Out, c: Ctx): string | null {
  if (kids.length === 0) return null;
  if (isMixed(el, c)) return null;
  if (c.o.expandEmptyElements || c.o.breakLineBeforeAttribute) return null;
  const s = tryInlineTree(el, c);
  if (s === null) return null;
  if (c.o.lineWidth > 0 && out.cols + s.length > c.o.lineWidth) return null;
  return s;
}

function emitElement(el: XElement, depth: number, out: Out, c: Ctx): void {
  if (isPreserved(el, c)) {
    out.put(el.raw);
    return;
  }
  const kids = meaningful(el);
  if (kids.length === 0) {
    if (c.o.expandEmptyElements) {
      putOpenTag({ el, closing: '>', depth }, out, c);
      out.put(`</${el.name}>`);
    } else {
      putOpenTag({ el, closing: '/>', depth }, out, c);
    }
    return;
  }
  // Oxygen keeps an element-only parent on the line the source had it: any
  // subtree that fits on one line without touching preserved content, mixed
  // text at the parent level, or gaps between sibling tags collapses as one
  // unit. Refuse when the resulting line would overflow, when the user asked
  // for every attribute on its own line, or when empty elements are being
  // expanded.
  const collapsed = tryCollapseElementOnly(el, kids, out, c);
  if (collapsed !== null) {
    out.put(collapsed);
    return;
  }
  putOpenTag({ el, closing: '>', depth }, out, c);
  if (isMixed(el, c)) emitMixed(el, depth, out, c);
  else {
    // Element-only content: each child on its own line at depth + 1, except a
    // comment or PI that the source glued right behind a real close tag (e.g.
    // `</p><!-- trailing note -->`) — Oxygen keeps that tail-run on the same
    // line, so we do too. An element child is always broken out; that preserves
    // the recursive-indent contract for fully-collapsed sources.
    let prev: XNode | null = null;
    for (const k of kids) {
      const glueAfterCloseTag =
        prev !== null &&
        prev.kind === 'element' &&
        !prev.selfClosing &&
        prev.children.length > 0 &&
        !isPreserved(prev, c) &&
        (k.kind === 'comment' || k.kind === 'pi') &&
        k.start === prev.end;
      if (glueAfterCloseTag) { /* glue: no line break, no space (Oxygen keeps `</p><!-- x -->` tight) */ }
      else out.begin(depth + 1);
      if (k.kind === 'element') emitElement(k, depth + 1, out, c);
      else out.put(k.raw.trim());
      prev = k;
    }
    out.begin(depth);
  }
  out.put(`</${el.name}>`);
}

// ── mixed-content flow ──
//
// Inside mixed content nothing is forced onto its own line. Text, inline
// elements and also elements such as <fig> or <ul> stay in the text flow; an
// element whose own content is element-only writes its start tag in the flow,
// puts its children on lines one level deeper and its end tag on a line of its
// own at its depth, and the flow carries on right after that end tag
// (`</ul></li>`, `</fig></p>`).

// Oxygen keeps the layout the source already has around a multi-line child
// (`</ul></li>` stays on one line, `</ul>` + newline + `</li>` stays on two),
// so besides "was there whitespace" the flow records "did it contain a line
// break" and how many columns the source indented the next item after that
// break. Only those boundaries use it; whitespace inside running text is
// still reflowed.
interface Pending {
  space: boolean;
  nl: boolean;
  /** Cols the source indented the following item (valid when `nl` is set). */
  nlCols: number;
}

type FlowItem =
  | { kind: 'piece'; piece: Piece; space: boolean; nl: boolean; nlCols: number; breakDepth?: number }
  | { kind: 'eo'; el: XElement; open: OpenTag; depth: number; space: boolean; nl: boolean; nlCols: number; breakDepth?: number };

/** Cols the source indented the tail of `s` after its last line break. */
function lastLineIndent(s: string, indentSize: number): number {
  const i = Math.max(s.lastIndexOf('\n'), s.lastIndexOf('\r'));
  if (i < 0) return 0;
  let cols = 0;
  for (let j = i + 1; j < s.length; j++) cols += s[j] === '\t' ? indentSize : 1;
  return cols;
}

function flatten(nodes: XNode[], items: FlowItem[], c: Ctx, pending: Pending, depth: number): void {
  const take = () => {
    const w = { space: pending.space, nl: pending.nl, nlCols: pending.nlCols };
    pending.space = false;
    pending.nl = false;
    pending.nlCols = 0;
    return w;
  };
  const push = (piece: Piece, breakDepth?: number) => {
    items.push({ kind: 'piece', piece, ...take(), breakDepth });
  };
  const markWs = (s: string): void => {
    pending.space = true;
    if (s.includes('\n') || s.includes('\r')) {
      pending.nl = true;
      pending.nlCols = lastLineIndent(s, c.o.indentSize);
    }
  };
  for (const n of nodes) {
    if (n.kind === 'text') {
      const words = n.raw.split(XML_WS).filter((w) => w !== '');
      if (words.length === 0) {
        markWs(n.raw);
        continue;
      }
      const lead = (/^[ \t\r\n]*/.exec(n.raw) as RegExpExecArray)[0];
      const trail = (/[ \t\r\n]*$/.exec(n.raw) as RegExpExecArray)[0];
      if (lead) markWs(lead);
      words.forEach((w, idx) => {
        if (idx > 0) pending.space = true;
        push(w);
      });
      if (trail) markWs(trail);
    } else if (n.kind === 'element') {
      const breakDepth = c.block.has(n.name) ? depth : undefined;
      const kids = meaningful(n);
      if (isPreserved(n, c)) {
        push(n.raw, breakDepth);
      } else if (n.children.length === 0 || (kids.length === 0 && !c.inline.has(n.name))) {
        if (c.o.expandEmptyElements) {
          push({ el: n, closing: '>', depth }, breakDepth);
          push(`</${n.name}>`);
        } else {
          push({ el: n, closing: '/>', depth }, breakDepth);
        }
      } else if (isMixed(n, c) || kids.length === 0) {
        push({ el: n, closing: '>', depth }, breakDepth);
        flatten(n.children, items, c, pending, depth + 1);
        push(`</${n.name}>`);
      } else {
        items.push({ kind: 'eo', el: n, open: { el: n, closing: '>', depth }, depth, ...take(), breakDepth });
      }
    } else {
      push(n.raw);
    }
  }
}

function emitMixed(el: XElement, depth: number, out: Out, c: Ctx): void {
  const items: FlowItem[] = [];
  const pending: Pending = { space: false, nl: false, nlCols: 0 };
  flatten(el.children, items, c, pending, depth + 1);
  const cont = depth + 1;
  // The owner's end tag `</name>` is glued to the last line of the flow, so the
  // final run has to reserve its width before a break is considered (Oxygen
  // wraps `…USB` and keeps `与电源接口。</p>` together on the next line).
  const ownerCloseLen = 2 + el.name.length;
  let first = true;
  let afterEo = false; // the cursor is right behind the end tag of a multi-line child
  let lastBlockClose = false; // the last emitted piece closed a non-inline element (flattened or eo)
  let i = 0;
  while (i < items.length) {
    // A chunk is a run of pieces with no whitespace between them: the only
    // place the line may break is in front of it.
    const head = items[i];
    const pieces: Piece[] = [];
    let len = 0;
    let terminator: Extract<FlowItem, { kind: 'eo' }> | null = null;
    while (i < items.length) {
      const it = items[i];
      if (pieces.length > 0 && (it.space || it.breakDepth !== undefined)) break;
      if (it.kind === 'piece') {
        pieces.push(it.piece);
        len += pieceLen(it.piece);
        i++;
      } else {
        pieces.push(it.open);
        len += pieceLen(it.open);
        terminator = it;
        i++;
        break;
      }
    }
    // A start tag never gets relocated as a whole: only its `<name` has to fit
    // where the chunk begins; the attributes (and the closing bracket, via the
    // tailRun above) wrap on their own. A text chunk still moves as one unit.
    const headPiece = head.kind === 'eo' ? head.open : head.piece;
    const isLast = !terminator && i >= items.length;
    // Only a tag that has attributes to wrap can be split at its `<name`; a tag
    // without any (`<b>`) is as unbreakable as a word and moves as one unit.
    const splitsAtName = typeof headPiece !== 'string' && canWrapAttributes(headPiece, c);
    const headFit = splitsAtName ? 1 + (headPiece as OpenTag).el.name.length : len + (isLast ? ownerCloseLen : 0);
    const headIsOpenTag = head.kind === 'eo' || (head.kind === 'piece' && typeof head.piece !== 'string');
    if (head.breakDepth !== undefined && !first) out.begin(head.breakDepth);
    else if (first) {
      // Source whitespace between the owner's start tag and the first content
      // is Oxygen's one leading space (never a line break here).
      if (head.space) out.put(' ');
    } else if (head.nl && head.kind === 'eo') {
      // A line break in front of a multi-line child is kept, at its children's indent.
      out.begin(head.depth + 1);
    } else if (head.nl && headIsOpenTag) {
      // A line break in front of a start tag (inline or block flattened as
      // pieces) is kept. Inline tags honour the source's own indent when it
      // reached at least the continuation level (this matches Oxygen's col-10
      // for a `<sup>` whose source line already started at column 10 and its
      // col-8 for a `<keyword>` whose source line started at column 0). When
      // the source had no such column, the tag sits where width-wrapped inline
      // tags go (depth + 1) so re-formatting is a no-op. Non-inline tags (for
      // example `<note>` inside `<li>`) sit at `cont`, the indent the source's
      // line break implies.
      const openTag = head.kind === 'piece' ? (head.piece as OpenTag) : null;
      const inlineFlat = openTag !== null && c.inline.has(openTag.el.name);
      if (!inlineFlat) out.begin(cont);
      else {
        const srcDepth = head.nlCols > 0 ? Math.ceil(head.nlCols / Math.max(1, c.o.indentSize)) : 0;
        out.begin(Math.max(cont, srcDepth));
      }
    } else if (head.nl && afterEo) {
      // So is a line break behind a multi-line child's end tag.
      out.begin(cont);
    } else if (!head.space) {
      /* glued to what precedes it */
    } else if (c.o.wrapMixedContent && c.o.lineWidth > 0 && out.cols + 1 + headFit > c.o.lineWidth) {
      // Opt-in print-style wrap: a start tag that wraps onto a line of its own
      // sits where its children go (depth + 1), like its attribute continuation
      // lines; text and inline markup continue at the owner's depth + 1.
      // Oxygen never enters this branch — its `lineWidth` only wraps attributes.
      out.begin(head.kind === 'eo' ? head.depth + 1 : typeof head.piece !== 'string' ? head.piece.depth + 1 : cont);
    } else out.put(' ');
    // A start tag is not an atomic wrap unit: `<name` is placed here and its
    // attributes wrap by themselves. The content glued right after the tag's
    // closing bracket (the rest of this chunk, and the owner's end tag when this
    // is the flow's last chunk) is passed as `tailRun` so the bracket can drop
    // to a continuation line together with that run.
    for (let k = 0; k < pieces.length; k++) {
      const p = pieces[k];
      if (typeof p === 'string') out.put(p);
      else {
        let tailRun = 0;
        let reachedEnd = true;
        for (let j = k + 1; j < pieces.length; j++) {
          const q = pieces[j];
          if (typeof q !== 'string' && canWrapAttributes(q, c)) {
            tailRun += 1 + q.el.name.length; // only `<name`; its attributes wrap on their own
            reachedEnd = false;
            break;
          }
          tailRun += pieceLen(q);
        }
        if (isLast && reachedEnd) tailRun += ownerCloseLen;
        putOpenTag(p, out, c, tailRun);
      }
    }
    if (terminator) {
      for (const k of meaningful(terminator.el)) emitBlock(k, terminator.depth + 1, out, c);
      out.begin(terminator.depth);
      out.put(`</${terminator.el.name}>`);
      lastBlockClose = true;
    } else {
      const lp = pieces.length ? pieces[pieces.length - 1] : null;
      const m = typeof lp === 'string' ? /^<\/([\w:.-]+)>$/.exec(lp) : null;
      lastBlockClose = m ? !c.inline.has(m[1]) : false;
    }
    afterEo = terminator !== null;
    first = false;
  }
  // Behind a multi-line child (`</fig>`, `</ul>`) or behind a non-inline
  // element written on one line (`</note>`), the owner's end tag stays where
  // the source had it: on a line of its own at the owner's depth if the
  // source put a line break there, glued to the child's end tag otherwise.
  // A trailing break behind plain text or an inline element is not kept —
  // Oxygen collapses `…</b>.\n</note>` to `\n` becoming one space.
  if (pending.nl && (afterEo || lastBlockClose)) out.begin(depth);
  else if (pending.space && !afterEo) out.put(' ');
}

// ─────────────────────────── public API ───────────────────────────

export type FormatResult =
  | { ok: true; text: string }
  | { ok: false; message: string; offset: number };

export interface FormatEdit {
  start: number;
  end: number;
  newText: string;
}

export type RangeFormatResult =
  | { ok: true; edits: FormatEdit[] }
  | { ok: false; message: string; offset: number };

/** Format a whole document. `eol` is the line terminator of the result. */
export function formatXml(text: string, options: Partial<FormatOptions> = {}, eol = '\n'): FormatResult {
  const o: FormatOptions = { ...DEFAULT_FORMAT_OPTIONS, ...options };
  const parsed = parseTree(text);
  if (!parsed.ok) return parsed;
  const c = makeCtx(o);
  const out = new Out(o);
  for (const n of parsed.roots) {
    if (isWs(n)) continue;
    if (n.kind === 'text') return { ok: false, message: 'text outside the root element', offset: n.start };
    emitBlock(n, 0, out, c);
  }
  const lines = out.finish();
  const endsWithNewline = /\n\s*$/.test(text);
  return { ok: true, text: lines.join(eol) + (endsWithNewline && lines.length ? eol : '') };
}

function depthOf(el: XElement): number {
  let d = 0;
  for (let p = el.parent; p; p = p.parent) d++;
  return d;
}

function collect(nodes: XNode[], into: XNode[]): void {
  for (const n of nodes) {
    into.push(n);
    if (n.kind === 'element') collect(n.children, into);
  }
}

/**
 * Format only what [selStart, selEnd) covers: the outermost elements wholly
 * inside the selection, or — when there are none — the innermost element
 * around it. A target that is inline in mixed content is widened to the
 * element that owns the flow, so a wrapped paragraph is never cut in half.
 */
export function formatXmlRange(
  text: string,
  selStart: number,
  selEnd: number,
  options: Partial<FormatOptions> = {},
  eol = '\n',
): RangeFormatResult {
  const o: FormatOptions = { ...DEFAULT_FORMAT_OPTIONS, ...options };
  const parsed = parseTree(text);
  if (!parsed.ok) return parsed;
  const c = makeCtx(o);
  const all: XNode[] = [];
  collect(parsed.roots, all);

  const widen = (n: XNode): XNode => {
    let cur = n;
    while (cur.parent && isMixed(cur.parent, c)) cur = cur.parent;
    return cur;
  };

  let targets: XNode[] = all.filter(
    (n) => n.kind !== 'text' && n.start >= selStart && n.end <= selEnd,
  );
  if (targets.length === 0) {
    const around = all.filter((n): n is XElement => n.kind === 'element' && n.start <= selStart && n.end >= selEnd);
    if (around.length === 0) {
      const whole = formatXml(text, o, eol);
      if (!whole.ok) return whole;
      return { ok: true, edits: whole.text === text ? [] : [{ start: 0, end: text.length, newText: whole.text }] };
    }
    targets = [around[around.length - 1]];
  }
  const widened = [...new Set(targets.map(widen))];
  const maximal = widened.filter((n) => !widened.some((m) => m !== n && m.start <= n.start && m.end >= n.end));
  maximal.sort((a, b) => a.start - b.start);

  const edits: FormatEdit[] = [];
  for (const n of maximal) {
    const depth = n.kind === 'element' ? depthOf(n) : depthOfLeaf(n);
    const out = new Out(o);
    emitBlock(n, depth, out, c);
    let body = out.finish().join(eol);
    let start = n.start;
    const lineStart = text.lastIndexOf('\n', n.start - 1) + 1;
    if (text.slice(lineStart, n.start).trim() === '') start = lineStart;
    else body = body.slice(out.indent(depth).length);
    if (text.slice(start, n.end) !== body) edits.push({ start, end: n.end, newText: body });
  }
  return { ok: true, edits };
}

function depthOfLeaf(n: XLeaf): number {
  let d = 0;
  for (let p = n.parent; p; p = p.parent) d++;
  return d;
}

/** Shrink a whole-text replacement to the smallest differing span. */
export function minimalEdit(oldText: string, newText: string): FormatEdit | null {
  if (oldText === newText) return null;
  let a = 0;
  const max = Math.min(oldText.length, newText.length);
  while (a < max && oldText[a] === newText[a]) a++;
  let b = 0;
  while (b < max - a && oldText[oldText.length - 1 - b] === newText[newText.length - 1 - b]) b++;
  return { start: a, end: oldText.length - b, newText: newText.slice(a, newText.length - b) };
}

const DETECT_MIN_WIDTH = 20;
const DETECT_MAX_WIDTH = 300;
const DETECT_MAX_CANDIDATES = 24;
// Widths people actually configure. The width a file was wrapped to need not
// equal any of its line lengths (no line may reach it exactly), so these are
// tried besides the line lengths.
const DETECT_COMMON_WIDTHS = [60, 70, 72, 75, 78, 80, 90, 100, 110, 120, 132, 140, 160, 180, 200];
// Detection formats the text once per candidate; skip it for very large files.
const DETECT_MAX_TEXT = 1_000_000;

/** Lines of `a` that do not appear verbatim in `b` (order-independent). */
function lineDistance(a: string, b: string): number {
  const bag = new Map<string, number>();
  for (const l of b.split(/\r?\n/)) bag.set(l, (bag.get(l) ?? 0) + 1);
  let d = 0;
  for (const l of a.split(/\r?\n/)) {
    const n = bag.get(l) ?? 0;
    if (n > 0) bag.set(l, n - 1);
    else d++;
  }
  return d;
}

/** Visual width of a line the way the formatter measures it (a leading tab is one indent). */
function lineCols(line: string, indentSize: number): number {
  let cols = 0;
  let i = 0;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
    cols += line[i] === '\t' ? indentSize : 1;
    i++;
  }
  return cols + line.length - i;
}

/**
 * Find the line width a document was already wrapped to (Oxygen's "Detect line
 * width on open"), so that re-formatting it is a no-op instead of a reflow.
 *
 * The width is not guessed from line lengths — an unbreakable run (a long CJK
 * sentence, a codeblock line, a long attribute value) is longer than the width
 * and would be mistaken for it. Instead each plausible width is tried: the
 * candidates are the distinct line lengths, and the one whose formatted result
 * differs least from the text wins (zero lines for a document Oxygen wrapped).
 *
 * Returns null — keep `options.lineWidth` — when
 *  - the document is already stable at the configured width,
 *  - there is no evidence of hard wrapping: formatting without any wrapping is
 *    as close to the text as the best width (a hand-written document whose
 *    paragraphs are single long lines), or
 *  - the text is malformed, too large, or `options.lineWidth` is 0 (never wrap).
 */
export function detectLineWidth(text: string, options: Partial<FormatOptions> = {}): number | null {
  const base: FormatOptions = { ...DEFAULT_FORMAT_OPTIONS, ...options };
  if (base.lineWidth <= 0 || text.length > DETECT_MAX_TEXT) return null;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const distance = (width: number): number | null => {
    const r = formatXml(text, { ...base, lineWidth: width }, eol);
    return r.ok ? lineDistance(text, r.text) : null;
  };

  const atConfigured = distance(base.lineWidth);
  if (atConfigured === null || atConfigured === 0) return null;
  const unwrapped = distance(0);
  if (unwrapped === null) return null;

  const candidates = [
    ...new Set(
      text
        .split(/\r\n|\r|\n/)
        .filter((l) => l.trim() !== '')
        .map((l) => lineCols(l, base.indentSize)),
    ),
  ]
    .filter((w) => w >= DETECT_MIN_WIDTH && w <= DETECT_MAX_WIDTH && w !== base.lineWidth)
    .sort((x, y) => y - x)
    .slice(0, DETECT_MAX_CANDIDATES);
  for (const w of DETECT_COMMON_WIDTHS) if (w !== base.lineWidth && !candidates.includes(w)) candidates.push(w);

  let best: { width: number; d: number } | null = null;
  for (const w of candidates) {
    const d = distance(w);
    if (d === null) continue;
    const closer = best !== null && Math.abs(w - base.lineWidth) < Math.abs(best.width - base.lineWidth);
    if (best === null || d < best.d || (d === best.d && closer)) best = { width: w, d };
  }
  if (best === null || best.d >= unwrapped || best.d >= atConfigured) return null;
  return best.width;
}
