// The preview's render helpers, as one import path. The code lives in the modules named
// below and in the ones re-exported from the first half of this file; importers keep
// using this path, so a name can move between them without touching them.

// Search match engine lives in the searchText leaf. Re-exported here so
// bookSearchIndex and the preview tests keep resolving it from this module; the
// webview overlay that injects it via .toString() now lives under ./webview/.
export { findTextMatches } from './searchText';
// Re-exported so existing importers keep resolving these from this module;
// they are now defined in refResolvers.ts.
export {
  readImageDimensions,
  IMAGE_DIMENSIONS_CACHE_MAX,
  clearImageDimensionsCache,
  makeFileCache,
  makeConrefResolver,
  makeConrefRangeResolver,
  makeFileTitleResolver,
  detectNoteLabels,
  detectIndexLabel,
  DEFAULT_NOTE_LABELS,
  ZH_NOTE_LABELS,
  makeIsInCurrentBook,
  decodeHrefPart,
  expandDitamapRefs,
} from '@dita-viewer/core';
export type { FileReader } from '@dita-viewer/core';
// Webview script builders now live under ./webview/. Re-exported from here so
// existing importers keep resolving them via this module (P5 forwarding barrel);
// this file itself no longer references any of the moved scripts.
export { getImageMapSupportScript } from './webview/imageMapScript';
export { getProfilingFilterScript } from './webview/profilingFilterScript';
export { getImageLightboxScript } from './webview/lightboxScript';
export { getSearchOverlayScript } from './webview/searchOverlayScript';
export { clampSidebarWidth, getSiteSidebarResizerScript } from './webview/siteSidebarResizerScript';
export {
  getSiteNavKeyboardScript,
  getSidebarUpdateScript,
  getSiteHistoryModelScript,
  getSiteNavClickHandlerScript,
  getBookNavClickHandlerScript,
  getBookScrollSyncScript,
  getOutlineSyncScript,
  getInitialSidebarBodyClass,
  getSiteNavCollapseStateHelperScript,
  getSiteNavExpandCollapseAllButtonsScript,
  getSiteNavToggleScript,
} from './webview/siteNavScripts';
export {
  getSiteHomeButtonScript,
  getSiteHistoryButtonsScript,
  getSitePrevNextButtonsScript,
  getSiteSidebarToggleScript,
  getModeToggleScript,
  getSiteOpenSourceScript,
  getToolbarPlacementScript,
  getTemplateSelectScript,
  HISTORY_BACK_ICON_SVG,
  HISTORY_FORWARD_ICON_SVG,
  PREV_TOPIC_ICON_SVG,
  NEXT_TOPIC_ICON_SVG,
  SITE_HOME_ICON_SVG,
  SITE_HOME_TARGET,
} from './webview/toolbarScripts';
export {
  getRefreshButtonScript,
  getToolbarScaffoldScript,
  getFontPrefsScript,
  getToolbarFontWidthTagTooltipsButtonsScript,
} from './webview/toolbarScaffold';
// Topic rendering pipeline (interfaces, parse-and-render, LRU cache) lives
// in ./topicRender. Re-exported here so providers and tests keep resolving
// everything from this module.
export {
  collectText,
  buildTitleMap,
  TopicRenderInput,
  TopicRenderResult,
  TopicXmlRenderInput,
  ParsedTopicResult,
  renderTopicXml,
  renderTopicToHtml,
  stampFiles,
  collectDitamapFilesUpward,
  TOPIC_RENDER_CACHE_MAX_BYTES,
  clearTopicRenderCache,
  topicRenderCacheSize,
  topicRenderCacheBytesHeld,
  setTopicRenderCacheBudgetForTesting,
  renderTopicCached,
} from '@dita-viewer/core';
// The host-side href opener moved out of topicRender (which stays host-free);
// re-exported so providers and tests keep resolving it from this module.
export { openHrefTarget } from './openHrefTarget';

// What used to be defined here, by concern: HTML escaping, topic-type sniffing, the
// Site / Book nav manifest, the Site home page, the sidebar tree, and Book rendering.
export { escapeAttr, escapeHtml } from './htmlEscape';
export { makeFileTopicTypeResolver } from './topicTypeResolver';
export type { DocsiteNavEntry } from './siteNavManifest';
export { buildBookNavManifest, resolveBookTopicPath, siteNavigableEntries, sitePageKeyScope } from './siteNavManifest';
export type { SiteHomeTile } from './siteHome';
export { buildSiteHomeTiles, renderSiteHomeHtml } from './siteHome';
export { renderSiteNavHtml, renderSiteNavTreeHtml, wrapSiteNavTreeHtml } from './siteNavRender';
export type { BookRenderInput } from './bookRender';
export { clearBookMembersCache, renderBookEntries, renderBookError, renderBookParts, renderBookPlaceholder, renderBookSkipMessage, wrapBookParts } from './bookRender';
