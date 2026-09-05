// The escalate-only transition rule behind a hidden preview panel's deferred
// render, extracted from DitaViewerProvider.ts and MapViewerProvider.ts.
//
// Both providers defer rendering while `webviewPanel.visible` is false and
// settle the debt once, in `onDidChangeViewState`, when the panel is shown
// again. What they owe on reveal is one of three things: nothing, a
// content-only patch (postContentUpdate -- a source edit, preserves scroll,
// no image re-decode), or a full reload (updateWebview -- a theme switch or
// mode change, since the light/dark class lives on <html>, outside the
// content div a content-only update touches). A second request landing while
// one is already pending must never downgrade it: a theme switch arriving
// after a source edit was already recorded has to leave the panel owing
// 'full', or the stale light/dark class would only get fixed by some later,
// unrelated re-render.
//
// Its own module for the reason mapTreeRefresh.ts and referenceableFiles.ts
// are: the two providers import vscode, so nothing written inside them is
// reachable from the plain-mocha unit tests, and this rule -- easy to state,
// easy to get backwards -- is exactly the kind of thing worth pinning down
// rather than trusting to a review of the inline condition.

export type PendingRender = 'none' | 'content' | 'full';

/**
 * Folds a newly requested render into whatever a hidden panel already owes.
 *
 * `current === 'none'` always takes the request outright, since there is
 * nothing to escalate over. Otherwise only a 'full' request can change
 * anything: it always wins (a 'full' request over an existing 'full' is a
 * no-op fold, not a special case), while a 'content' request arriving on top
 * of an already-pending 'content' or 'full' changes nothing -- in particular,
 * it must never turn a pending 'full' back into 'content'.
 */
export function foldPendingRender(current: PendingRender, requested: 'content' | 'full'): PendingRender {
  if (current === 'none' || requested === 'full') return requested;
  return current;
}
