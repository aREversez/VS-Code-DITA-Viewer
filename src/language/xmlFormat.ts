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
  /** Every attribute of a block-level start tag on its own line. */
  breakLineBeforeAttribute: boolean;
  /** Break a block-level start tag's attributes when it exceeds the width. */
  breakLongAttributes: boolean;
  /** Extra elements whose content is copied verbatim. */
  preserveSpaceElements: string[];
  /** Extra elements treated as inline (their parent's content stays mixed). */
  mixedContentElements: string[];
  /** Extra elements that always start on their own line, even in mixed content. */
  breakLineElements: string[];
}

export const DEFAULT_FORMAT_OPTIONS: FormatOptions = {
  indentSize: 2,
  useTabs: false,
  lineWidth: 100,
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

// Elements that start on their own line even inside mixed content
// (<li>text<ul>...</ul></li>).
const BLOCK = [
  'p', 'ul', 'ol', 'dl', 'sl', 'note', 'table', 'simpletable', 'fig', 'figgroup',
  'section', 'example', 'codeblock', 'pre', 'lines', 'screen', 'msgblock',
  'steps', 'steps-unordered', 'substeps', 'step', 'substep', 'choices',
  'stepresult', 'stepxmp', 'info', 'itemgroup', 'lq', 'object', 'imagemap',
  'dlentry', 'li', 'sli', 'choice', 'tutorialinfo', 'cmd', 'context',
  'prereq', 'postreq', 'result', 'refsyn', 'properties', 'body', 'conbody',
  'taskbody', 'refbody',
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
  block: Set<string>;
}

function makeCtx(o: FormatOptions): Ctx {
  return {
    o,
    preserve: new Set([...PRESERVE_SPACE, ...o.preserveSpaceElements]),
    inline: new Set([...INLINE, ...o.mixedContentElements]),
    block: new Set([...BLOCK, ...o.breakLineElements]),
  };
}

const isWs = (n: XNode): boolean => n.kind === 'text' && n.raw.trim() === '';
const hasXmlSpacePreserve = (el: XElement): boolean => /\bxml:space\s*=\s*["']preserve["']/.test(el.rawStartTag);
const isPreserved = (el: XElement, c: Ctx): boolean => c.preserve.has(el.name) || hasXmlSpacePreserve(el);
const isBlockEl = (el: XElement, c: Ctx): boolean => c.block.has(el.name) || isPreserved(el, c);

function meaningful(el: XElement): XNode[] {
  return el.children.filter((n) => !isWs(n));
}

/** Text, CDATA, or an inline child makes the element's content "mixed". */
function isMixed(el: XElement, c: Ctx): boolean {
  for (const ch of el.children) {
    if (ch.kind === 'text' && ch.raw.trim() !== '') return true;
    if (ch.kind === 'cdata') return true;
    if (ch.kind === 'element' && c.inline.has(ch.name) && !isBlockEl(ch, c)) return true;
  }
  return false;
}

function startTagText(el: XElement, closing: string, depth: number, o: Out, c: Ctx, breakable: boolean): string {
  if (!el.attrs) return el.rawStartTag.slice(0, el.selfClosing ? -2 : -1) + closing;
  const attrs = el.attrs.map((a) => a.text);
  const one = `<${el.name}${attrs.map((a) => ' ' + a).join('')}${closing}`;
  if (!breakable || attrs.length < 2) return one;
  const startCols = o.indentCols(depth);
  const tooLong = c.o.lineWidth > 0 && startCols + one.length > c.o.lineWidth && !one.includes('\n');
  if (!(c.o.breakLineBeforeAttribute || (c.o.breakLongAttributes && tooLong))) return one;
  const align = startCols + 1 + el.name.length + 1;
  const pad = o.indent(depth) + ' '.repeat(Math.max(0, align - o.indentCols(depth)));
  if (c.o.breakLineBeforeAttribute) {
    return `<${el.name} ${attrs[0]}` + attrs.slice(1).map((a) => `\n${pad}${a}`).join('') + closing;
  }
  // Fill each line up to the line width (greedy), continuation lines aligned
  // under the first attribute; the closing "/>" or ">" counts on the last line.
  let text = `<${el.name} ${attrs[0]}`;
  let cols = align + attrs[0].length;
  for (let i = 1; i < attrs.length; i++) {
    const a = attrs[i];
    const tail = i === attrs.length - 1 ? closing.length : 0;
    if (cols + 1 + a.length + tail > c.o.lineWidth) {
      text += `\n${pad}${a}`;
      cols = align + a.length;
    } else {
      text += ` ${a}`;
      cols += 1 + a.length;
    }
  }
  return text + closing;
}

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
      out.put(startTagText(el, '>', depth, out, c, true) + `</${el.name}>`);
    } else {
      out.put(startTagText(el, '/>', depth, out, c, true));
    }
    return;
  }
  out.put(startTagText(el, '>', depth, out, c, true));
  if (isMixed(el, c)) emitMixed(el, depth, out, c);
  else {
    for (const k of kids) emitBlock(k, depth + 1, out, c);
    out.begin(depth);
  }
  out.put(`</${el.name}>`);
}

// ── mixed-content flow ──

type FlowItem = { atom: string; space: boolean } | { block: XNode };

function flatten(nodes: XNode[], items: FlowItem[], c: Ctx, pending: { space: boolean }): void {
  for (const n of nodes) {
    if (n.kind === 'text') {
      // Every separator between the pieces of the split is whitespace that
      // was in the source, so each piece after the first is preceded by one.
      const parts = n.raw.split(XML_WS);
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) pending.space = true;
        if (parts[i] === '') continue;
        items.push({ atom: parts[i], space: pending.space });
        pending.space = false;
      }
    } else if (n.kind === 'element') {
      if (isBlockEl(n, c)) {
        items.push({ block: n });
        pending.space = false;
      } else if (n.children.length === 0) {
        const open = n.attrs
          ? `<${n.name}${n.attrs.map((a) => ' ' + a.text).join('')}`
          : n.rawStartTag.slice(0, n.selfClosing ? -2 : -1);
        if (c.o.expandEmptyElements) {
          items.push({ atom: `${open}>`, space: pending.space });
          items.push({ atom: `</${n.name}>`, space: false });
        } else {
          items.push({ atom: `${open}/>`, space: pending.space });
        }
        pending.space = false;
      } else {
        const open = n.attrs
          ? `<${n.name}${n.attrs.map((a) => ' ' + a.text).join('')}>`
          : n.rawStartTag;
        items.push({ atom: open, space: pending.space });
        pending.space = false;
        flatten(n.children, items, c, pending);
        items.push({ atom: `</${n.name}>`, space: pending.space });
        pending.space = false;
      }
    } else {
      items.push({ atom: n.raw, space: pending.space });
      pending.space = false;
    }
  }
}

function firstLineLen(s: string): number {
  const i = s.search(/[\r\n]/);
  return i < 0 ? s.length : i;
}

function emitMixed(el: XElement, depth: number, out: Out, c: Ctx): void {
  const items: FlowItem[] = [];
  flatten(el.children, items, c, { space: false });
  const cont = depth + 1;
  let afterBlock = false;
  let first = true;
  let i = 0;
  while (i < items.length) {
    const it = items[i];
    if ('block' in it) {
      emitBlock(it.block, cont, out, c);
      afterBlock = true;
      first = false;
      i++;
      continue;
    }
    // A chunk is a run of atoms with no whitespace between them: the only
    // place the line may break is in front of it.
    let text = it.atom;
    const space = it.space;
    i++;
    while (i < items.length) {
      const nx = items[i];
      if ('block' in nx || nx.space) break;
      text += nx.atom;
      i++;
    }
    if (afterBlock) {
      out.begin(cont);
      out.put(text);
      afterBlock = false;
    } else if (first || !space) {
      out.put(text);
    } else if (c.o.lineWidth > 0 && out.cols + 1 + firstLineLen(text) > c.o.lineWidth) {
      out.begin(cont);
      out.put(text);
    } else {
      out.put(' ' + text);
    }
    first = false;
  }
  if (afterBlock) out.begin(depth);
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
