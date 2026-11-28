// The whole public surface of @dita-viewer/core, with no side effects and no
// Node dependency. index.ts re-exports it and installs the Node platform;
// portable.ts and engine.ts build on it.
//
// Hosts (the Obsidian plugin, and in time the VS Code extension) render DITA
// through these exports only. The VS Code DITA Viewer depends on this package
// and holds no copies of ./parser, ./render and ./editor (see README), so they
// are edited here and released as a new version.

export { renderTopicXml, buildTitleMap, collectDitamapFilesUpward } from './editor/topicRender';
export type { TopicXmlRenderInput, TopicRenderInput, TopicRenderResult, ParsedTopicResult } from './editor/topicRender';
export { buildKeySpace, getKeyDefs, getKeyScopes, getTopicScopeChains, createKeyScopeIndex } from './editor/keySpace';
export type { KeyHrefDef, KeyScopeIndex, KeySpace } from './editor/keySpace';
export { readSourceText, setSourceOverlay, clearSourceOverlay } from './editor/sourceText';
export { decodeHrefPart } from './editor/refResolvers';
export { isPathInside, isInsideAny, setReadRoots, isReadAllowed } from './pathContainment';
export { buildKeyMapForDocument, buildKeySpaceForDocument } from './keyMapForDocument';
export { complete } from './completion';
export { collectDiagnostics } from './diagnostics';
export type { DitaDiagnostic, DiagnosticSeverity, DiagnosticsInput } from './diagnostics';
export type { CompletionEnv, CompletionResult, Suggestion, SuggestionKind } from './completion';
export { collectReferenceableFiles, toRelativeHref } from './language/referenceableFiles';
export type { ReadDir, WalkEntry } from './language/referenceableFiles';
export { IMAGE_EXT } from './completionData';
export { collectIds, splitRefFragment } from './language/ditaLanguageUtils';
export { collectRefEntries, offsetToLineCol } from './language/ditaLanguageUtils';
export type { RefEntry } from './language/ditaLanguageUtils';
export { renderMapXml } from './mapRender';
export type { MapXmlRenderInput } from './mapRender';
export { renderBookXml } from './bookRender';
export type { BookXmlRenderInput, BookXmlRenderResult } from './bookRender';
export { renderSiteXml } from './siteRender';
export type { SiteNavEntry, SiteXmlRenderInput, SiteXmlRenderResult } from './siteRender';
export {
  PROFILE_ATTRS,
  ditavalAction,
  isEmptyFilter,
  isExcluded,
  isValueExcluded,
  parseDitaval,
  profileGroups,
  profileKey,
  profileValuesOf,
  profileValuesOfKeys,
  pruneExcluded,
} from './profiling';
export type { Ditaval, DitavalAction, DitavalRule, ProfileFilter, ProfileGroup, ProfileValues } from './profiling';
export { collectMapEntries, getMapTitleText } from './render/mapTypeMap';
// The parser and renderer entry points a host that renders by itself needs, and
// what they take and return. Everything the VS Code viewer imports from the
// copied modules is here, so it can depend on this package instead of copying.
export { parseDita, parseDitamap, preprocessEntities } from './parser/ditaParser';
export type { DitaDocument, DitaNode, SourceRange } from './parser/domTypes';
export { STANDARD_TAG_TO_BASETYPE } from './parser/standardTagMap';
export { MAP_STANDARD_TAG_TO_BASETYPE } from './parser/mapTagMap';
export { renderDocument, renderElement } from './render/renderer';
export type { RenderContext } from './render/renderer';
export { collectIndextermChips, findTopLevelIndextermsInSubtree } from './render/baseTypeMap';
export { createBookRoleLabeler, extractText, getDisplayNameInfo, isDitamapRef, renderMapDocument } from './render/mapTypeMap';
export { isExternalRef } from './language/ditaLanguageUtils';
export type { MapEntry } from './render/mapTypeMap';
export type { RoleLabelFormatter, RoleLabelInfo } from './render/mapTypeMap';
export type { KeyMapOptions } from './keyMapForDocument';
// The rest of what the VS Code viewer imports from the copied modules: the
// render cache, the file and key resolvers, the source overlay, the editor
// language helpers, and the helpers its tests call. Their shapes follow the
// viewer's needs and may change while the version is 0.x.
export { lookupNamedEntity } from './parser/namedEntities';
export { BASE_TYPE_RENDERERS } from './render/baseTypeMap';
export { computeKeyrefSpacing, needsSpace } from './render/cjkSpacing';
export { mergeProfilingAttrs, profilingChipsHtml, profilingKeysAttr } from './render/renderer';
export { resolveConkeyref } from './editor/conkeyref';
export { collectMapKeys, isKeyContextAvailable, keySourceMaps, qualifiedNames, qualifiedNamesMulti, resolveKeyInScope, scopeKeyIndexKey } from './editor/keySpace';
export { DEFAULT_NOTE_LABELS, IMAGE_DIMENSIONS_CACHE_MAX, URL_SCHEME_RE, ZH_NOTE_LABELS, clearImageDimensionsCache, detectDraftCommentLabel, detectDraftCommentMetaLabels, detectIndexLabel, detectNoteLabels, expandDitamapRefs, makeConrefRangeResolver, makeConrefResolver, makeFileCache, makeFileTitleResolver, makeIsInCurrentBook, makeRefErrorResolver, readImageDimensions } from './editor/refResolvers';
export type { FileReader } from './editor/refResolvers';
export { DEFAULT_REF_ERROR_TEXTS, fillRefErrorTemplate } from './render/refErrorTexts';
export type { RefErrorTexts } from './render/refErrorTexts';
export { buildRenderContext } from './editor/renderContext';
export { clearAllSourceOverlays, dependsOn, noteSourceDependencies, sourceOverlaySize, sourceStamp, trackSourceReads } from './editor/sourceText';
export { TOPIC_RENDER_CACHE_MAX_BYTES, clearTopicRenderCache, collectText, renderTopicCached, renderTopicToHtml, setTopicRenderCacheBudgetForTesting, stampFiles, topicRenderCacheBytesHeld, topicRenderCacheSize } from './editor/topicRender';
export { collectMapSymbols, collectTopicSymbols, collectUnknownElements, findConrefTargetOffset, findEnclosingKeydefKeys, findIdAttrAt, findKeyDefinitionOffset, findKeysAttrAt, findRefAttrAt, findUnclosedTag, getAttributesForTag, getAutoCloseTag, getCloseTagCompletion, getCompletionContext, getMapRefName, stripSameDocumentFragmentPrefix } from './language/ditaLanguageUtils';
export type { DocSymbolSpec } from './language/ditaLanguageUtils';

/**
 * Host tokens the stylesheet reads (styles/dita-content.css). A host defines
 * these on the element that carries the rendered content; styles/TOKENS.md
 * says what each one means.
 */
export const HOST_TOKENS = [
  '--dita-fg',
  '--dita-fg-muted',
  '--dita-bg',
  '--dita-bg-elevated',
  '--dita-border',
  '--dita-focus',
  '--dita-hover-bg',
  '--dita-selected-fg',
  '--dita-link',
  '--dita-code-bg',
  '--dita-code-inline-bg',
  '--dita-font',
] as const;
export type { AnalysisWarning, WarningSink } from './warnings';

// Project-analysis foundations, moved from the extension (DESIGN.md 4.2, step 3a):
// the check messages, the tolerant XML scan, the @class helpers and the
// completeness check's DITAVAL reader. Generic names (walk, fill, msg ...) sit at
// the root until the Phase 3 tiering decides where they belong. Two names changed
// in the move because the root already had them for the render-time profiling:
// pruneExcluded is pruneExcludedXNodes, the DITAVAL reader is parseDitavalFilter and its rule type is DitavalRuleAtLine.
export { MESSAGE_TEMPLATES, fill, formatMessage, msg } from './analysis/mapCheckMessages';
export type { Msg, MsgCode } from './analysis/mapCheckMessages';
export {
  PROFILING_ATTRS,
  TOPICREF_TAGS,
  URL_RE,
  classOf,
  hasNavTitle,
  isDitaHref,
  isMapTag,
  keyrefSyntax,
  profileValueOf,
  pruneExcludedXNodes,
  scanXml,
  walk,
} from './analysis/mapXmlScan';
export type { XNode } from './analysis/mapXmlScan';
export {
  chainHas,
  classChain,
  classElementTag,
  classPairTag,
  classSyntaxProblem,
  declaresGrammar,
  defaultClassOf,
  effectiveClassOf,
  isDitaDoctype,
  readDoctype,
  sideOfRoot,
} from './analysis/ditaClass';
export type { ClassSide, ClassSyntaxProblem, Doctype } from './analysis/ditaClass';
export { parseDitavalFilter, parseDitavalRules } from './analysis/ditaval';
export type { DitavalFilter, DitavalRule as DitavalRuleAtLine } from './analysis/ditaval';
