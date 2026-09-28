// Pure, dependency-free scanner for XML tag balance. Used by
//  - the well-formedness diagnostics (unclosed / stray end tags get a red
//    squiggle, like Oxygen's "must be terminated by the matching end-tag"),
//  - the "wrap selection with tag" command (refuses selections whose tags are
//    unpaired or whose boundaries fall inside a tag).
// It is deliberately tolerant: it never throws, and keeps scanning after an
// error so a document being typed in still gets useful, stable diagnostics.

export type MarkupIssueKind =
  | 'unclosed-element' // start tag never closed (or closed out of order)
  | 'unexpected-end-tag' // end tag with no matching open element
  | 'unterminated-markup' // "<name ..." with no closing ">"
  | 'invalid-markup'; // a "<" that starts nothing valid

export interface MarkupIssue {
  kind: MarkupIssueKind;
  tagName?: string;
  /** Offsets into the scanned text, [start, end). */
  start: number;
  end: number;
}

export type MarkupTokenKind = 'start' | 'end' | 'empty' | 'comment' | 'cdata' | 'pi' | 'declaration';

export interface MarkupToken {
  kind: MarkupTokenKind;
  start: number;
  end: number;
  name?: string;
}

export interface MarkupScan {
  tokens: MarkupToken[];
  issues: MarkupIssue[];
}

const TAG_NAME = /(\/?)([^\s/><"'=&]+)/y;

interface OpenElement {
  name: string;
  start: number;
  nameEnd: number;
}

export function scanMarkup(text: string): MarkupScan {
  const tokens: MarkupToken[] = [];
  const issues: MarkupIssue[] = [];
  const stack: OpenElement[] = [];
  const n = text.length;
  let i = 0;

  const opaque = (kind: MarkupTokenKind, open: string, close: string, lt: number): number => {
    const closeAt = text.indexOf(close, lt + open.length);
    if (closeAt < 0) {
      tokens.push({ kind, start: lt, end: n });
      issues.push({ kind: 'unterminated-markup', start: lt, end: Math.min(n, lt + open.length) });
      return n;
    }
    tokens.push({ kind, start: lt, end: closeAt + close.length });
    return closeAt + close.length;
  };

  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;

    if (text.startsWith('<!--', lt)) { i = opaque('comment', '<!--', '-->', lt); continue; }
    if (text.startsWith('<![CDATA[', lt)) { i = opaque('cdata', '<![CDATA[', ']]>', lt); continue; }
    if (text.startsWith('<?', lt)) { i = opaque('pi', '<?', '?>', lt); continue; }
    if (text.startsWith('<!', lt)) {
      // <!DOCTYPE ... [ internal subset ]> — '>' inside [] or quotes does not end it
      let depth = 0;
      let quote = '';
      let j = lt + 2;
      let end = -1;
      for (; j < n; j++) {
        const c = text[j];
        if (quote) { if (c === quote) quote = ''; continue; }
        if (c === '"' || c === "'") quote = c;
        else if (c === '[') depth++;
        else if (c === ']') depth = Math.max(0, depth - 1);
        else if (c === '>' && depth === 0) { end = j + 1; break; }
      }
      if (end < 0) {
        tokens.push({ kind: 'declaration', start: lt, end: n });
        issues.push({ kind: 'unterminated-markup', start: lt, end: Math.min(n, lt + 2) });
        break;
      }
      tokens.push({ kind: 'declaration', start: lt, end });
      i = end;
      continue;
    }

    TAG_NAME.lastIndex = lt + 1;
    const m = TAG_NAME.exec(text);
    if (!m) {
      issues.push({ kind: 'invalid-markup', start: lt, end: lt + 1 });
      i = lt + 1;
      continue;
    }
    const isEnd = m[1] === '/';
    const name = m[2];

    // Find the closing '>' (quote-aware). A '<' before it means the tag was
    // never terminated (also how a half-selected tag shows up).
    let quote = '';
    let end = -1;
    let broken = -1;
    for (let j = TAG_NAME.lastIndex; j < n; j++) {
      const c = text[j];
      if (c === '<') { broken = j; break; }
      if (quote) { if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'") quote = c;
      else if (c === '>') { end = j + 1; break; }
    }
    if (end < 0) {
      const stop = broken >= 0 ? broken : n;
      issues.push({ kind: 'unterminated-markup', tagName: name, start: lt, end: stop });
      if (broken < 0) break;
      i = broken;
      continue;
    }

    if (isEnd) {
      tokens.push({ kind: 'end', start: lt, end, name });
      let idx = -1;
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].name === name) { idx = k; break; }
      }
      if (idx < 0) {
        issues.push({ kind: 'unexpected-end-tag', tagName: name, start: lt, end });
      } else {
        for (let k = stack.length - 1; k > idx; k--) {
          const open = stack[k];
          issues.push({ kind: 'unclosed-element', tagName: open.name, start: open.start, end: open.nameEnd });
        }
        stack.length = idx;
      }
    } else if (text[end - 2] === '/') {
      tokens.push({ kind: 'empty', start: lt, end, name });
    } else {
      tokens.push({ kind: 'start', start: lt, end, name });
      stack.push({ name, start: lt, nameEnd: lt + 1 + name.length });
    }
    i = end;
  }

  for (const open of stack) {
    issues.push({ kind: 'unclosed-element', tagName: open.name, start: open.start, end: open.nameEnd });
  }
  issues.sort((a, b) => a.start - b.start);
  return { tokens, issues };
}

export type WrapSelectionCheck =
  | { ok: true }
  | { ok: false; reason: 'cuts-markup' }
  | { ok: false; reason: 'unbalanced'; tagName?: string };

/**
 * Can [start, end) of `fullText` be wrapped in a new element without breaking
 * well-formedness? Requires that neither boundary falls inside a tag / PI /
 * declaration / comment, and that the selected fragment's own tags are all
 * paired (every start tag has its end tag inside the selection, and vice
 * versa). A selection lying wholly inside one comment or CDATA section is
 * opaque text and always fine.
 */
export function validateWrapSelection(fullText: string, start: number, end: number): WrapSelectionCheck {
  const { tokens } = scanMarkup(fullText);
  for (const t of tokens) {
    const startInside = t.start < start && start < t.end;
    const endInside = t.start < end && end < t.end;
    if (!startInside && !endInside) continue;
    if (startInside && endInside && (t.kind === 'comment' || t.kind === 'cdata')) {
      return { ok: true };
    }
    return { ok: false, reason: 'cuts-markup' };
  }
  const first = scanMarkup(fullText.slice(start, end)).issues[0];
  if (first) return { ok: false, reason: 'unbalanced', tagName: first.tagName };
  return { ok: true };
}
