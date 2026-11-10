/**
 * Who may tell the preview to move, and when, for the source-editor side of
 * the side-by-side sync. Kept free of `vscode` so the timing rules can be
 * executed by a unit test rather than only described in comments.
 *
 * Two different things can make the editor move on its own, and they need
 * different suppression:
 *
 *  - the preview scrolled and asked the editor to reveal the matching line
 *    (`notePreviewScroll`): the editor's resulting visible-range change must
 *    not be echoed straight back at the preview;
 *  - the cursor moved (`acceptSelection`): VS Code auto-reveals the cursor,
 *    which fires a visible-range change the preview must not follow, because
 *    the highlightLine already posted for the cursor centers a different line.
 *
 * Only the first window may swallow a selection change. A selection change
 * must never be swallowed by the window a previous selection change opened:
 * a click on a link followed within that window by the go-to-definition jump
 * is two selection changes, and the second one is the one that matters.
 */
export interface SourcePreviewSyncGate {
  /** The preview scrolled and the extension is about to reveal a line in the editor. */
  notePreviewScroll(): void;
  /** A single-line selection change: true when the preview should be told to highlight it. */
  acceptSelection(): boolean;
  /** An editor visible-range change: true when the preview should follow it. */
  acceptVisibleRange(): boolean;
}

export const PREVIEW_SCROLL_ECHO_MS = 250;
export const SELECTION_REVEAL_ECHO_MS = 400;

export function createSourcePreviewSyncGate(now: () => number = Date.now): SourcePreviewSyncGate {
  // Two windows, deliberately not one: a window opened by a selection change
  // must only ever silence the visible-range echo, never another selection.
  let previewScrollUntil = 0;
  let selectionRevealUntil = 0;
  return {
    notePreviewScroll() {
      previewScrollUntil = now() + PREVIEW_SCROLL_ECHO_MS;
    },
    acceptSelection() {
      if (now() < previewScrollUntil) return false;
      selectionRevealUntil = now() + SELECTION_REVEAL_ECHO_MS;
      return true;
    },
    acceptVisibleRange() {
      const t = now();
      return t >= previewScrollUntil && t >= selectionRevealUntil;
    },
  };
}
