// Search match engine: a pure, self-contained function so it can be both
// unit-tested directly and injected into the webview search overlay via
// findTextMatches.toString(). Moved verbatim out of ditaRenderUtils.ts (P5
// pure refactor) so the overlay script module can import it without a cycle.
// Leaf module: no imports, no other module-level bindings.

// ── Search text matching ──
// Pure match engine shared between unit tests and the webview search overlay
// (injected there via findTextMatches.toString(), so it must stay fully
// self-contained — no references to other module-level bindings).
export function findTextMatches(
  text: string,
  term: string,
  useRegex: boolean,
  caseSensitive: boolean,
): { start: number; end: number }[] | null {
  const matches: { start: number; end: number }[] = [];
  // Plain-text terms are regex-escaped and run through the same regex path:
  // the 'i' flag handles case-insensitivity without toLowerCase(), whose
  // length-changing Unicode folds (İ, ẞ, …) would skew match offsets.
  const pattern = useRegex ? term : term.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&');
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
  } catch {
    return null;
  }
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m[0].length > 0) {
      matches.push({ start: m.index, end: m.index + m[0].length });
      // Cap per-node matches so degenerate patterns cannot flood the DOM
      if (matches.length >= 1000) break;
    } else {
      regex.lastIndex++;
    }
  }
  return matches;
}
