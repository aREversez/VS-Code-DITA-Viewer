// Word-level diff of two texts: CJK-aware tokenizing and the token diff itself.
// Split out of ditaDiffEngine.ts; a pure function module, no vscode dependency.

import { lcsAlign } from './diffLcs';
import { DiffPart } from './diffTypes';

// ── Inline word-level diff ──

const CJK_RANGES = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/;

// Tokens must partition `text` exactly -- tokens.join('') === text always --
// with nothing dropped and nothing synthesized. This used to skip over
// whitespace entirely (discarding it) and let mergePart glue a single
// synthetic space after every token instead. That coincidentally
// round-tripped single-word-then-single-space runs, but broke the instant
// any punctuation touched a word with no space -- "Note:", "e.g.", "isn't",
// "well-known", or simply a period at the end of a sentence all came back
// with a spurious inserted space ("Note :", "isn ' t", "fox ."). Since
// applyInlineMarksToHtml requires its reconstructed text to exactly equal
// the rendered html's plain text (see makeBlock/htmlToPlainText), that
// spurious-space drift silently discarded the inline highlighting for
// almost any real sentence, leaving "modified" rows a flat, undifferentiated
// amber block with no visible red/green pinpointing which words actually
// changed.
export function tokenizeForDiff(text: string): string[] {
  const tokens: string[] = [];
  const chars = [...text];
  let i = 0;

  while (i < chars.length) {
    const ch = chars[i];
    if (/\s/.test(ch)) {
      let ws = '';
      while (i < chars.length && /\s/.test(chars[i])) {
        ws += chars[i];
        i++;
      }
      tokens.push(ws);
    } else if (CJK_RANGES.test(ch)) {
      tokens.push(ch);
      i++;
    } else if (/[a-zA-Z0-9\u00c0-\u024f]/.test(ch)) {
      let word = '';
      while (i < chars.length && /[a-zA-Z0-9\u00c0-\u024f]/.test(chars[i])) {
        word += chars[i];
        i++;
      }
      tokens.push(word);
    } else {
      tokens.push(ch);
      i++;
    }
  }
  return tokens;
}

const INLINE_TOKEN_CAP = 2000;

export function diffTokens(oldTokens: string[], newTokens: string[]): DiffPart[] {
  if (oldTokens.length > INLINE_TOKEN_CAP || newTokens.length > INLINE_TOKEN_CAP) {
    return [];
  }

  const ops = lcsAlign(oldTokens, newTokens, (a, b) => a === b, (item) => item);
  const parts: DiffPart[] = [];

  for (const op of ops) {
    if (op.op === 'same') {
      mergePart(parts, op.left!, false, false);
    } else if (op.op === 'removed') {
      mergePart(parts, op.left!, false, true);
    } else {
      mergePart(parts, op.right!, true, false);
    }
  }

  return parts;
}

// No synthetic separators -- tokens (including whitespace-run tokens) are
// concatenated verbatim, so the concatenation of a side's selected parts
// exactly reconstructs that side's original (post-normalizeText) text.
function mergePart(parts: DiffPart[], value: string, added: boolean, removed: boolean): void {
  const last = parts[parts.length - 1];
  if (last && last.added === added && last.removed === removed) {
    last.value += value;
  } else {
    parts.push({ value, added: added || undefined, removed: removed || undefined });
  }
}
