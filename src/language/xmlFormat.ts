// Pure, dependency-free "Format and Indent" engine for DITA / XML source.
//
// Modelled on the structure of Oxygen's pretty printer (see the design notes
// in the commit message), re-expressed for a text-preserving token tree:
//  - recursion depth drives indentation; the per-depth indent strings are
//    cached (Oxygen keeps them in a push/pop stack of contexts),
//  - element-only content puts every child on its own line one level deeper,
//  - mixed content (text, inline elements) is flowed and wrapped at the line
//    width, continuation lines indented one level below the owner,
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
  /** Wrap mixed content at this many columns (0 = never wrap). */
  lineWidth: number;
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

/** Text, CDATA, or an inline child makes the element's content "mixed". */
function isMixed(el: XElement, c: Ctx): boolean {
  for (const ch of el.children) {
    if (ch.kind === 'text' && ch.raw.trim() !== '') return true;
    if (ch.kind === 'cdata') return true;
    if (ch.kind === 'element' && c.inline.has(ch.name)) return true;
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
 * they no longer fit, the bracket itself drops to a continuation line at the
 * tag's own level — one level shallower than the attribute continuation, the
 * indent a wrapped run of text would get — and the run follows right after it.
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
  attrs.forEach((a, i) => {
    const tail = i === attrs.length - 1 ? t.closing.length : 0;
    if (c.o.breakLongAttributes && width > 0 && out.cols + 1 + firstLineLen(a) + tail > width) {
      out.begin(cont);
      out.put(a);
    } else {
      out.put(' ' + a);
    }
  });
  if (c.o.breakLongAttributes && width > 0 && out.cols + t.closing.length + tailRun > width) {
    out.begin(t.depth);
  }
  out.put(t.closing);
}

// ── element-only layout ──

function emitBlock(node: XNode, depth: number, out: Out, c: Ctx): void {
  out.begin(depth);
  if (node.kind === 'element') emitElement(node, depth, out, c);
  else out.put(node.raw.trim());
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
  putOpenTag({ el, closing: '>', depth }, out, c);
  if (isMixed(el, c)) emitMixed(el, depth, out, c);
  else {
    for (const k of kids) emitBlock(k, depth + 1, out, c);
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

type FlowItem =
  | { kind: 'piece'; piece: Piece; space: boolean; breakDepth?: number }
  | { kind: 'eo'; el: XElement; open: OpenTag; depth: number; space: boolean; breakDepth?: number };

function flatten(nodes: XNode[], items: FlowItem[], c: Ctx, pending: { space: boolean }, depth: number): void {
  const push = (piece: Piece, breakDepth?: number) => {
    items.push({ kind: 'piece', piece, space: pending.space, breakDepth });
    pending.space = false;
  };
  for (const n of nodes) {
    if (n.kind === 'text') {
      // Every separator between the pieces of the split is whitespace that
      // was in the source, so each piece after the first is preceded by one.
      const parts = n.raw.split(XML_WS);
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) pending.space = true;
        if (parts[i] === '') continue;
        push(parts[i]);
      }
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
        items.push({
          kind: 'eo', el: n, open: { el: n, closing: '>', depth }, depth, space: pending.space, breakDepth,
        });
        pending.space = false;
      }
    } else {
      push(n.raw);
    }
  }
}

function emitMixed(el: XElement, depth: number, out: Out, c: Ctx): void {
  const items: FlowItem[] = [];
  flatten(el.children, items, c, { space: false }, depth + 1);
  const cont = depth + 1;
  // The owner's end tag `</name>` is glued to the last line of the flow, so the
  // final run has to reserve its width before a break is considered (Oxygen
  // wraps `…USB` and keeps `与电源接口。</p>` together on the next line).
  const ownerCloseLen = 2 + el.name.length;
  let first = true;
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
    const headPiece = head.kind === 'eo' ? head.open : head.kind === 'piece' ? head.piece : null;
    const isLast = !terminator && i >= items.length;
    const isTagHead = !!headPiece && typeof headPiece !== 'string';
    const headFit = isTagHead ? 1 + headPiece.el.name.length : len + (isLast ? ownerCloseLen : 0);
    if (head.breakDepth !== undefined && !first) out.begin(head.breakDepth);
    else if (first || !head.space) {
      /* glued to what precedes it */
    } else if (c.o.lineWidth > 0 && out.cols + 1 + headFit > c.o.lineWidth) out.begin(cont);
    else out.put(' ');
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
        for (let j = k + 1; j < pieces.length; j++) tailRun += pieceLen(pieces[j]);
        if (isLast && k === pieces.length - 1) tailRun += ownerCloseLen;
        putOpenTag(p, out, c, tailRun);
      }
    }
    if (terminator) {
      for (const k of meaningful(terminator.el)) emitBlock(k, terminator.depth + 1, out, c);
      out.begin(terminator.depth);
      out.put(`</${terminator.el.name}>`);
    }
    first = false;
  }
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

// Above this line length a document is not treated as already hard-wrapped: the
// long line is either a source written on one line or an unbreakable run, so
// there is no wrap width to detect and the configured lineWidth is kept instead.
const DETECT_MAX_WIDTH = 300;

/**
 * Estimate the hard-wrap line width a document was already formatted with, so
 * re-formatting it is a no-op instead of a reflow (Oxygen's "Detect line width
 * on open", which exists to keep pretty-print diffs out of version control).
 *
 * The estimate is the longest non-blank line. Formatting at a width equal to
 * the longest existing line is idempotent: every line still fits, and an
 * element/word the source moved to the next line still does not fit, so the
 * same break is chosen. Returns null (use the configured width) when there is
 * no wrap structure to detect: fewer than two content lines, a longest line
 * above DETECT_MAX_WIDTH, or only one line that is anywhere near full length
 * (a lone long paragraph is unwrapped content, not evidence of a width).
 */
export function detectLineWidth(text: string): number | null {
  const lengths = text
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => l.length);
  if (lengths.length < 2) return null;
  const max = Math.max(...lengths);
  if (max > DETECT_MAX_WIDTH) return null;
  const nearFull = lengths.filter((n) => n >= Math.ceil(max * 0.75)).length;
  if (nearFull < 2) return null;
  return max;
}
