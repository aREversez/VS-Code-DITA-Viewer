// Minimal HTML escaping for text and attribute values.
// Split out of ditaRenderUtils.ts, which re-exports every name here.


export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Book rendering helpers (pure, no vscode dependency) ──
//
// Book mode is deliberately just "every referenced topic's own content,
// one after another" -- it composites topics for reading, the same way
// opening one of those topics directly would render it, profiling
// included (each topic's own inline profiling markup already renders
// correctly via renderTopicToHtml, unaffected by anything here). It does
// NOT layer in topicref-level (ditamap-source) profiling/filtering on top
// of that; that scope stays exclusive to Outline mode's tree, matching
// how a topic opened directly never reflects what any ditamap referencing
// it says either.
