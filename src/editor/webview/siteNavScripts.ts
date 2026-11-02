// Webview scripts for the sidebar tree navigation, as one import path. The factories
// live in three modules by who uses them: siteNavShared (keyboard model, sidebar
// updates, fold state, expand / collapse all, the fold toggle: both modes),
// siteModeScripts (the page-switching click handler and its history model) and
// bookModeScripts (scroll-to-anchor clicks, scroll sync, the outline column).
// Each module is self-contained: a factory only composes others in its own module,
// and none of it reaches back through the ditaRenderUtils barrel.

export { getInitialSidebarBodyClass, getSidebarUpdateScript, getSiteNavCollapseStateHelperScript, getSiteNavExpandCollapseAllButtonsScript, getSiteNavKeyboardScript, getSiteNavToggleScript } from './siteNavShared';
export { getSiteHistoryModelScript, getSiteNavClickHandlerScript } from './siteModeScripts';
export { getBookNavClickHandlerScript, getBookScrollSyncScript, getOutlineSyncScript } from './bookModeScripts';
