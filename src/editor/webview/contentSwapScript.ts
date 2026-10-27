
// Webview script: what both previews redo after their content root's HTML has
// been replaced. Shared by the topic preview's updateContent handler and the
// map preview's afterContentSwap -- each used to carry its own copy, in a
// different order.
//
// A dependency-free leaf with no options: it only reads names that the other
// injected scripts declare in the same scope (pfApplyFilter / pfPanel /
// pfBuildPanel from getProfilingFilterScript, refreshSearchAfterDomChange from
// getSearchOverlayScript, tagTooltipsOn / applyTagTooltips from
// getToolbarScaffoldScript), each behind a guard so a preview that lacks one
// still works. Inline it after those scripts; it only defines a function.

export function getContentSwapRefreshScript(): string {
  return `
  // Each of these holds state about the DOM that was just thrown away, so each
  // has to be pointed at the new one: the profiling decisions were computed
  // over the old elements, an open filter panel lists the old attribute/value
  // options, and the page search's highlight ranges reference detached nodes.
  // Tag tooltips come last. Off (the default) needs no walk -- fresh HTML only
  // ever carries data-dita-tagname, never a stray title= from this feature --
  // while on promotes the new content's data attributes the way the old
  // content's already were.
  function refreshAfterContentSwap() {
    if (typeof pfApplyFilter === 'function') pfApplyFilter();
    if (typeof pfPanel !== 'undefined' && pfPanel) {
      pfPanel.remove();
      pfPanel = pfBuildPanel();
      document.body.appendChild(pfPanel);
    }
    if (typeof refreshSearchAfterDomChange === 'function') refreshSearchAfterDomChange();
    if (tagTooltipsOn) applyTagTooltips();
  }
`;
}
