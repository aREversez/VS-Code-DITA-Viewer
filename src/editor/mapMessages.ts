// The message types the map preview's host (MapViewerProvider.ts) and its
// webview script (webview/mapScript.ts) exchange. One constant interpolated
// into both sides, so the two spellings cannot disagree -- see below.
//
// The content-update protocol between this provider and its webview script.
//
// Both sides live in this file, but the script side is a string, so no
// compiler and no test can see that the two spellings of a message type agree.
// A typo on either side fails silently and looks exactly like "the preview
// stopped updating on edit" -- and patchContent is the worse case, since the
// webview would ignore every patch and the document would simply go stale.
// Interpolating one constant into both sides makes that unrepresentable
// rather than tested. The script's other message types (openTopic,
// switchMode, refresh) are left as literals: they are outside this change,
// and each one's failure is visible rather than silent.
export const MSG_UPDATE_CONTENT = 'updateContent';
export const MSG_PATCH_CONTENT = 'patchContent';
export const MSG_REQUEST_FULL_RENDER = 'requestFullRender';
// Same treatment, same reason: a mismatch here is silent rather than loud --
// the button still changes document.body's style locally either way, so the
// only symptom of a typo is that the choice quietly fails to survive closing
// the panel, which is exactly the bug this pair of message types exists to
// fix (see FONT_PREFS_KEY / WIDTH_SELECTION_KEY above).
export const MSG_SET_FONT_PREFS = 'setFontPrefs';
export const MSG_SET_WIDTH_SELECTION = 'setWidthSelection';
// Same reasoning again -- see TAG_TOOLTIPS_KEY in DitaViewerProvider.ts for
// why this is a global, shared-with-the-topic-viewer preference.
export const MSG_SET_TAG_TOOLTIPS = 'setTagTooltips';
// webview -> host only, no counterpart-typo risk on the other side to guard
// against (nothing else reads this literal), so it stays a plain constant
// rather than getting the MSG_UPDATE_CONTENT treatment above.
export const MSG_SWITCH_SITE_PAGE = 'switchSitePage';
// Docsite mode: open a topic's source file in the text editor, in a tab
// group other than the preview's. webview -> host only.
export const MSG_OPEN_TOPIC_SOURCE = 'openTopicSource';
// The Book/Site sidebar's row context menu: one message carrying an
// `action` (openMapSource/openSource/openWithOxygen/revealInExplorer/
// findUnreferenced/exportHtml/copyTitle/copyHref) and, for the row-scoped
// actions, the row's resolved `target` path. The host validates `target`
// against the map's own manifest before acting, so the webview cannot name
// an arbitrary file. Expand/Collapse All never reach here -- they act
// in-page. webview -> host only.
export const MSG_NAV_CONTEXT = 'navContextAction';
// Docsite/book view: the reader picked a template ('' = none). webview -> host.
export const MSG_SET_TEMPLATE = 'setTemplate';
// Book mode's own sidebar refresh (nested-fold-and-highlight-plan.md item
// 1) -- host -> webview only, sent alongside (not instead of)
// MSG_PATCH_CONTENT/MSG_UPDATE_CONTENT on every source edit in book mode.
// See postContentUpdate's own comment for why the sidebar needs this
// separate, always-full-replace path rather than riding along with
// diffBookParts' incremental content patch.
export const MSG_UPDATE_SIDEBAR = 'updateSidebar';
// Persisted sidebar collapse state (nested-fold-and-highlight-plan.md item
// 3) -- webview -> host, one message per user action (a single toggle
// click, or a whole expand/collapse-all sweep), always carrying the FULL
// current set of collapsed ids rather than an incremental delta (see
// reportSiteNavCollapseState's own comment in ditaRenderUtils.ts). Stored
// under COLLAPSED_NAV_KEY, per document, the same shape/keying convention
// as WIDTH_SELECTION_KEY above.
export const MSG_SET_NAV_COLLAPSED = 'setNavCollapsed';
// Full-book search (docsite design doc, 4.4) -- webview -> host request and
// host -> webview response, same pairing convention as MSG_UPDATE_CONTENT
// above (both spellings live in this one file already, but the pair is
// still named/interpolated together rather than left as two independent
// literals, since a mismatch here would silently mean search never shows
// results instead of failing loudly).
export const MSG_BOOK_SEARCH = 'bookSearch';
export const MSG_BOOK_SEARCH_RESULTS = 'bookSearchResults';
// In-place mode switch (toolbar-persistence work): the webview's mode button
// sends a 'switchMode' REQUEST (webview -> host, left a literal -- its failure
// is loud, the switch just does nothing), and the host answers with this one
// host -> webview message carrying everything needed to rebuild the view
// WITHOUT reassigning webview.html. Interpolated on both sides like
// MSG_UPDATE_CONTENT, because a typo here is silent: the client would ignore
// the reply and leave the stale mode on screen while the host believes it
// already switched.
export const MSG_SWITCH_MODE = 'applyModeStage';
