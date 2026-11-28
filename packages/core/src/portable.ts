// Entry point for hosts that are not Node: a browser, a worker, an app over a
// virtual file system. No Node built-in is imported anywhere below this file.
//
// It exports what needs no platform at top level (parsing, profiling,
// completion, the language utilities, constants) and createEngine, which binds
// the rest (rendering, key spaces, diagnostics, reference resolution) to a
// Platform. Which name is which is src/exportKinds.ts.
//
// The Node entry installs a default runtime so the same names work at top
// level there; this entry installs none, so the runtime-dependent names exist
// only on an engine.

export { HOST_TOKENS } from './api';
export { MESSAGE_TEMPLATES, fill, formatMessage, msg } from './analysis/mapCheckMessages';
export { PROFILING_ATTRS, TOPICREF_TAGS, URL_RE, classOf, hasNavTitle, isDitaHref, isMapTag, keyrefSyntax, profileValueOf, pruneExcludedXNodes, scanXml, walk } from './analysis/mapXmlScan';
export { crawlMaps } from './analysis/mapCrawl';
export { analysisHostFromFileSystem } from './analysis/host';
export { comparablePath } from './analysis/pathKey';
export { chainHas, classChain, classElementTag, classPairTag, classSyntaxProblem, declaresGrammar, defaultClassOf, effectiveClassOf, isDitaDoctype, readDoctype, sideOfRoot } from './analysis/ditaClass';
export { parseDitavalFilter, parseDitavalRules } from './analysis/ditaval';
export { complete } from './completion';
export { IMAGE_EXT } from './completionData';
export { resolveConkeyref } from './editor/conkeyref';
export { createKeyScopeIndex, getKeyDefs, getKeyScopes, qualifiedNames, qualifiedNamesMulti, resolveKeyInScope, scopeKeyIndexKey } from './editor/keySpace';
export { DEFAULT_NOTE_LABELS, IMAGE_DIMENSIONS_CACHE_MAX, URL_SCHEME_RE, ZH_NOTE_LABELS, decodeHrefPart, detectDraftCommentLabel, detectDraftCommentMetaLabels, detectIndexLabel, detectNoteLabels } from './editor/refResolvers';
export { TOPIC_RENDER_CACHE_MAX_BYTES, buildTitleMap, collectText } from './editor/topicRender';
export { collectIds, collectMapSymbols, collectRefEntries, collectTopicSymbols, collectUnknownElements, findConrefTargetOffset, findEnclosingKeydefKeys, findIdAttrAt, findKeyDefinitionOffset, findKeysAttrAt, findRefAttrAt, findUnclosedTag, getAttributesForTag, getAutoCloseTag, getCloseTagCompletion, getCompletionContext, getMapRefName, isExternalRef, offsetToLineCol, splitRefFragment, stripSameDocumentFragmentPrefix } from './language/ditaLanguageUtils';
export { parseDita, parseDitamap, preprocessEntities } from './parser/ditaParser';
export { MAP_STANDARD_TAG_TO_BASETYPE } from './parser/mapTagMap';
export { lookupNamedEntity } from './parser/namedEntities';
export { STANDARD_TAG_TO_BASETYPE } from './parser/standardTagMap';
export { PROFILE_ATTRS, ditavalAction, isEmptyFilter, isExcluded, isValueExcluded, parseDitaval, profileGroups, profileKey, profileValuesOf, profileValuesOfKeys, pruneExcluded } from './profiling';
export { collectIndextermChips, findTopLevelIndextermsInSubtree } from './render/baseTypeMap';
export { computeKeyrefSpacing, needsSpace } from './render/cjkSpacing';
export { createBookRoleLabeler, extractText, getDisplayNameInfo, getMapTitleText, renderMapDocument } from './render/mapTypeMap';
export { DEFAULT_REF_ERROR_TEXTS, fillRefErrorTemplate } from './render/refErrorTexts';
export { mergeProfilingAttrs, profilingChipsHtml, profilingKeysAttr } from './render/renderer';

export type * from './api';
export type { FileStat, FileSystem, PathOps, Platform } from './platform';
export type { Engine, EngineFunctions } from './engine';
export type { MemoryFileContent, MemoryFileSystem } from './memoryFileSystem';
export { createEngine } from './engine';
export { createMemoryFileSystem } from './memoryFileSystem';
export { posixPath } from './posixPath';
