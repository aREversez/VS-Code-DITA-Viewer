// Text similarity scores, and the inline diff (with its "rewritten" verdict) of a modified row.
// Split out of ditaDiffEngine.ts; a pure function module, no vscode dependency.

import { normalizeText } from './diffBlocks';
import { diffTokens, tokenizeForDiff } from './diffTokens';
import { AlignedRow, DiffPart } from './diffTypes';

// ── Similarity ──

// Similarity scoring reuses tokenizeForDiff's proper CJK/word/punctuation
// segmentation, not a naive whitespace split. Chinese (and other
// no-whitespace-between-words text) has essentially zero ASCII whitespace,
// so `s.split(/\s+/)` treated an ENTIRE Chinese sentence as a single
// indivisible "word" -- any two non-identical Chinese sentences (even a
// one-character edit) shared zero tokens, scored similarity 0, and were
// always classified as a full delete + a full insert instead of one
// "modified" row with word-level highlighting. Worse, since this same
// function decides whether a changed container's children are even
// examined (pairAdjacentChanges only recurses into 'modified' pairs), it
// silently defeated the container-recursion fix for any mostly-Chinese
// section/parml/list too -- the pair never got classified 'modified' in
// the first place, so recursion into it never even ran.
export function tokenize(s: string): string[] {
  return tokenizeForDiff(s).filter((t) => !/^\s+$/.test(t));
}

function diceSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.length === 0 && tokensB.length === 0) return 1;
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const bagA = new Map<string, number>();
  for (const t of tokensA) bagA.set(t, (bagA.get(t) || 0) + 1);
  const bagB = new Map<string, number>();
  for (const t of tokensB) bagB.set(t, (bagB.get(t) || 0) + 1);

  let intersection = 0;
  for (const [t, countA] of bagA) {
    const countB = bagB.get(t) || 0;
    intersection += Math.min(countA, countB);
  }
  return (2 * intersection) / (tokensA.length + tokensB.length);
}

// Character-level bigram Dice similarity -- a fallback for the token-based
// diceSimilarity above. That function scores two short single-token values that
// share no whole word ("5000" vs "8000", a version bump, a one-letter code)
// as 0%, which split a one-number edit into a delete plus an insert. They ARE a
// modification: the strings overlap heavily at the character level even though
// not one whitespace-delimited token is common. Bigrams recover that overlap
// ("000" is shared by "5000"/"8000") without the false positives a lowered
// token threshold would cause, since two genuinely different sentences share
// too few character bigrams to clear the same bar.
export function charBigrams(s: string): string[] {
  const norm = normalizeText(s).toLowerCase();
  const grams: string[] = [];
  for (let i = 0; i + 1 < norm.length; i++) {
    grams.push(norm.slice(i, i + 2));
  }
  return grams;
}

function charDiceSimilarity(a: string, b: string): number {
  const gramsA = charBigrams(a);
  const gramsB = charBigrams(b);
  if (gramsA.length === 0 || gramsB.length === 0) return 0;
  const bag = new Map<string, number>();
  for (const g of gramsA) bag.set(g, (bag.get(g) || 0) + 1);
  let intersection = 0;
  for (const g of gramsB) {
    const count = bag.get(g) || 0;
    if (count > 0) {
      intersection++;
      bag.set(g, count - 1);
    }
  }
  return (2 * intersection) / (gramsA.length + gramsB.length);
}

const SIMILARITY_THRESHOLD = 0.45;

// Word-level inline marks are informative when the two versions share enough
// wording (a rephrase, a value bump, a couple of edited characters). For a
// wholesale replacement -- cross-lingual rewrite, a paragraph swapped end to end
// -- the two texts share almost no tokens, so diffTokens degenerates into
// "strike every word on the left / highlight every word on the right": a wall of
// color that reads as noise rather than a cue about what changed. In that case
// return no parts and let the block's border plus its connector carry the change,
// and report `replaced` so the renderer can mark it as a rewrite.
//
// Three tiers instead of one on/off gate:
//   - similar (either dice score >= SIMILARITY_THRESHOLD): full word diff;
//   - middling: keep the diff only if, once trivial shared words are folded
//     into the surrounding change, enough real shared text remains to anchor
//     it (a long shared phrase inside an otherwise rewritten paragraph);
//   - dissimilar: no marks, `replaced`.

const PHRASE_KEEP_RATIO = 0.3;
const PHRASE_TRY_FLOOR = 0.2;

function isWeakEqual(value: string): boolean {
  return [...value.replace(/\s+/g, '')].length <= 3;
}

/** Fold tiny unchanged runs (a lone "the", a comma) that sit between two
 *  changes into those changes, so the marks read as phrases rather than a
 *  confetti of single words. Left/right text is preserved exactly. */
export function coalesceDiffParts(input: DiffPart[]): DiffPart[] {
  // diffTokens emits every unchanged token as its own part (mergePart compares
  // `undefined` with `false`, so adjacent unchanged tokens never merge). Join
  // neighbours of the same kind first, or every single word would look like an
  // isolated tiny equal run.
  const parts: DiffPart[] = [];
  for (const p of input) {
    const last = parts[parts.length - 1];
    if (last && !!last.added === !!p.added && !!last.removed === !!p.removed) {
      last.value += p.value;
    } else {
      parts.push({ value: p.value, added: p.added || undefined, removed: p.removed || undefined });
    }
  }
  const out: DiffPart[] = [];
  let leftBuf = '';
  let rightBuf = '';
  const flush = (): void => {
    if (leftBuf) out.push({ value: leftBuf, removed: true });
    if (rightBuf) out.push({ value: rightBuf, added: true });
    leftBuf = '';
    rightBuf = '';
  };
  parts.forEach((part, i) => {
    if (part.removed) {
      leftBuf += part.value;
    } else if (part.added) {
      rightBuf += part.value;
    } else if (i > 0 && i < parts.length - 1 && isWeakEqual(part.value)) {
      leftBuf += part.value;
      rightBuf += part.value;
    } else {
      flush();
      out.push(part);
    }
  });
  flush();
  return out;
}

interface InlineResult {
  parts: DiffPart[];
  replaced: boolean;
}

export function computeInline(leftText: string, rightText: string): InlineResult {
  if (leftText === rightText) return { parts: [], replaced: false };
  const tokenSim = diceSimilarity(leftText, rightText);
  const charSim = charDiceSimilarity(leftText, rightText);
  const similar = tokenSim >= SIMILARITY_THRESHOLD || charSim >= SIMILARITY_THRESHOLD;
  if (!similar && Math.max(tokenSim, charSim) < PHRASE_TRY_FLOOR) {
    return { parts: [], replaced: true };
  }
  const raw = diffTokens(tokenizeForDiff(leftText), tokenizeForDiff(rightText));
  if (raw.length === 0) return { parts: [], replaced: false }; // over the token cap
  const parts = coalesceDiffParts(raw);
  if (!similar) {
    let kept = 0;
    for (const p of parts) if (!p.added && !p.removed) kept += p.value.length;
    if (kept / Math.max(leftText.length, rightText.length) < PHRASE_KEEP_RATIO) {
      return { parts: [], replaced: true };
    }
  }
  return { parts, replaced: false };
}

/** Compute and attach the inline diff (and the `replaced` flag) of a modified row. */
export function applyInline(row: AlignedRow): void {
  if (!row.left || !row.right) return;
  const { parts, replaced } = computeInline(row.left.text, row.right.text);
  row.inlineDiff = parts;
  if (replaced) row.replaced = true;
  else delete row.replaced;
}
