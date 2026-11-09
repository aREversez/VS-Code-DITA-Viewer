// Injects word-level diff marks into rendered HTML without disturbing its tags or entities.
// Split out of ditaDiffEngine.ts; a pure function module, no vscode dependency.

import { escapeHtml } from '../ditaRenderUtils';
import { DiffPart } from './diffTypes';

// ── Inline mark injection into rendered HTML ──

const XML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};
const XML_ENTITY_RE = /&(?:amp|lt|gt|quot|apos);/g;

function unescapeXml(s: string): string {
  return s.replace(XML_ENTITY_RE, (m) => XML_ENTITY_MAP[m] || m);
}

interface HtmlSegment {
  kind: 'tag' | 'text';
  raw: string;
  decoded?: string;
}

export function scanHtmlSegments(html: string): HtmlSegment[] {
  const segments: HtmlSegment[] = [];
  let i = 0;

  while (i < html.length) {
    if (html[i] === '<') {
      let end = i + 1;
      let inQuote: string | null = null;
      while (end < html.length) {
        const ch = html[end];
        if (inQuote) {
          if (ch === inQuote) inQuote = null;
        } else if (ch === '"' || ch === "'") {
          inQuote = ch;
        } else if (ch === '>') {
          break;
        }
        end++;
      }
      end = Math.min(end + 1, html.length);
      segments.push({ kind: 'tag', raw: html.slice(i, end) });
      i = end;
    } else {
      let end = html.indexOf('<', i);
      if (end === -1) end = html.length;
      const raw = html.slice(i, end);
      segments.push({ kind: 'text', raw, decoded: unescapeXml(raw) });
      i = end;
    }
  }
  return segments;
}

// `parts` (from diffTokens) is tokenized from a block's NORMALIZED text
// (normalizeText(htmlToPlainText(html)) -- see makeBlock): whitespace runs
// collapsed to a single space, leading/trailing whitespace trimmed. The
// html being annotated here still has the ORIGINAL, un-collapsed
// whitespace from the pretty-printed XML source -- indentation, newlines
// between sibling inline elements, and so on. A NormalizedMap re-derives
// that same normalized string from the html's actual text, while also
// recording, for every normalized character, which raw character range
// (in the concatenation of the html's text nodes) it was collapsed from --
// a single normalized space can stand in for a multi-character raw run
// like "\n    ". This lets a position expressed in `parts`' normalized
// coordinate space be projected back onto the html's real, un-normalized
// offsets, instead of assuming 1 normalized character == 1 raw character.
//
// That assumption used to be silent and unstated: the old implementation
// walked `parts` directly against raw segment lengths. It happened to
// round-trip correctly whenever a block had no whitespace worth
// collapsing, which is why this went unnoticed for plain single-line
// content -- but the instant a block's source had ANY indentation/newline
// between inline elements (i.e. almost any real, pretty-printed document),
// every mark position after that whitespace silently drifted by however
// many raw characters got collapsed into the one normalized space, showing
// red/green highlights over unrelated, unchanged text while the actually-
// changed words went unmarked.
interface NormalizedMap {
  norm: string;
  /** rawStart[k] / rawEnd[k]: the raw-text character range (into the
   *  concatenation of the html's own text nodes) that norm[k] was built
   *  from -- a single raw character for an ordinary character, or the
   *  whole collapsed run for a normalized whitespace character. */
  rawStart: number[];
  rawEnd: number[];
}

function buildNormalizedMap(raw: string): NormalizedMap {
  const norm: string[] = [];
  const rawStart: number[] = [];
  const rawEnd: number[] = [];
  let i = 0;
  const n = raw.length;

  while (i < n) {
    if (/\s/.test(raw[i])) {
      const start = i;
      while (i < n && /\s/.test(raw[i])) i++;
      norm.push(' ');
      rawStart.push(start);
      rawEnd.push(i);
    } else {
      norm.push(raw[i]);
      rawStart.push(i);
      rawEnd.push(i + 1);
      i++;
    }
  }

  // Mirror normalizeText's trailing .trim() so `norm` exactly matches the
  // normalizeText(...)'d block text that `parts` was actually built from --
  // otherwise a leading/trailing collapsed-whitespace character here with
  // no counterpart in `parts` would misalign every position after it.
  let startIdx = 0;
  let endIdx = norm.length;
  while (startIdx < endIdx && norm[startIdx] === ' ') startIdx++;
  while (endIdx > startIdx && norm[endIdx - 1] === ' ') endIdx--;

  return {
    norm: norm.slice(startIdx, endIdx).join(''),
    rawStart: rawStart.slice(startIdx, endIdx),
    rawEnd: rawEnd.slice(startIdx, endIdx),
  };
}

/** Walks `parts` in normalized-text order, keeping only this side's own
 *  characters (mirrors the belongsToSide filtering the projection/fullText
 *  check below also uses), and converts each highlighted span's normalized
 *  position into a raw offset range via `normMap`. Adjacent raw ranges
 *  that touch are merged, same as the old single-pass version did. */
function projectPartsToRawRanges(
  parts: DiffPart[],
  side: 'left' | 'right',
  normMap: NormalizedMap,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = 0;

  for (const part of parts) {
    const belongsToSide = side === 'left' ? !part.added : !part.removed;
    if (!belongsToSide) continue;

    const len = part.value.length;
    if (len === 0) continue;

    const isHighlight = side === 'left' ? part.removed : part.added;
    const from = cursor;
    const to = cursor + len - 1; // inclusive last normalized index
    cursor += len;

    if (isHighlight && from < normMap.rawStart.length) {
      const start = normMap.rawStart[from];
      const end = normMap.rawEnd[Math.min(to, normMap.rawEnd.length - 1)];
      const last = ranges[ranges.length - 1];
      if (last && last.end === start) {
        last.end = end;
      } else {
        ranges.push({ start, end });
      }
    }
  }

  return ranges;
}

export function applyInlineMarksToHtml(
  html: string,
  parts: DiffPart[],
  side: 'left' | 'right',
): string {
  if (!parts.length) return html;

  const segments = scanHtmlSegments(html);
  const textSegments = segments.filter((s) => s.kind === 'text');
  const fullText = textSegments.map((s) => s.decoded || '').join('');
  const normalizedMap = buildNormalizedMap(fullText);

  const projection = parts
    .filter((p) => side === 'left' ? !p.added : !p.removed)
    .map((p) => p.value)
    .join('');

  // Exact equality, not a fuzzy normalizeText(...) comparison: `projection`
  // and `normalizedMap.norm` are both already fully normalized, so a real
  // match should be byte-for-byte identical. Requiring exact equality
  // (rather than normalizing both sides again before comparing) keeps this
  // a genuine sanity check on the mapping above instead of one that could
  // itself paper over a drift.
  if (projection !== normalizedMap.norm) {
    return html;
  }

  const rawMarks = projectPartsToRawRanges(parts, side, normalizedMap);
  if (rawMarks.length === 0) return html;

  const className = side === 'left' ? 'diff-inline-del' : 'diff-inline-add';
  let offset = 0;
  let markIdx = 0;

  for (const seg of segments) {
    if (seg.kind !== 'text') continue;
    const decoded = seg.decoded || '';
    const segStart = offset;
    const segEnd = segStart + decoded.length;

    const marksInSeg: Array<{ start: number; end: number }> = [];
    // A mark's raw range can span a segment boundary (e.g. two adjacent
    // text nodes separated by an empty tag, whose trailing/leading
    // whitespace collapsed into one normalized space) -- only advance past
    // a mark once its full range has been consumed, so its remainder is
    // picked up by the next text segment instead of being dropped.
    while (markIdx < rawMarks.length && rawMarks[markIdx].start < segEnd) {
      const m = rawMarks[markIdx];
      const start = Math.max(m.start, segStart);
      const end = Math.min(m.end, segEnd);
      if (end > start) marksInSeg.push({ start, end });
      if (m.end <= segEnd) markIdx++;
      else break;
    }

    if (marksInSeg.length > 0) {
      let newRaw = '';
      let cursor = 0;
      for (const mark of marksInSeg) {
        const mStart = mark.start - segStart;
        const mEnd = mark.end - segStart;
        newRaw += decoded.slice(cursor, mStart);
        newRaw += `<span class="${className}">${escapeHtml(decoded.slice(mStart, mEnd))}</span>`;
        cursor = mEnd;
      }
      newRaw += decoded.slice(cursor);
      seg.raw = newRaw;
    }

    offset = segEnd;
  }

  return segments.map((s) => s.raw).join('');
}
