// How each runtime export of api.ts relates to the ambient runtime (DESIGN.md
// 3.4, 3.7). Plain data, so the engine, the portable entry, the tests and the
// scripts all read one list.
//
// The split is computed, not guessed: test/exportKinds.test.ts runs a static
// call-graph analysis over core's sources and fails if a name listed as
// PORTABLE_PURE can reach the runtime (rt(), the runtime/path and runtime/fs
// wrappers, any stateSlot accessor), and if a name is in no list at all.

/**
 * Functions and constants that never reach the runtime. A host with no platform
 * can call them directly: this is what the portable entry exports at top level.
 */
export const PORTABLE_PURE = [
  'DEFAULT_NOTE_LABELS',
  'DEFAULT_REF_ERROR_TEXTS',
  'HOST_TOKENS',
  'IMAGE_DIMENSIONS_CACHE_MAX',
  'IMAGE_EXT',
  'MAP_STANDARD_TAG_TO_BASETYPE',
  'PROFILE_ATTRS',
  'STANDARD_TAG_TO_BASETYPE',
  'TOPIC_RENDER_CACHE_MAX_BYTES',
  'URL_SCHEME_RE',
  'ZH_NOTE_LABELS',
  'buildTitleMap',
  'collectIds',
  'collectIndextermChips',
  'collectMapSymbols',
  'collectRefEntries',
  'collectText',
  'collectTopicSymbols',
  'collectUnknownElements',
  'complete',
  'computeKeyrefSpacing',
  'createBookRoleLabeler',
  'createKeyScopeIndex',
  'decodeHrefPart',
  'detectDraftCommentLabel',
  'detectDraftCommentMetaLabels',
  'detectIndexLabel',
  'detectNoteLabels',
  'ditavalAction',
  'extractText',
  'fillRefErrorTemplate',
  'findConrefTargetOffset',
  'findEnclosingKeydefKeys',
  'findIdAttrAt',
  'findKeyDefinitionOffset',
  'findKeysAttrAt',
  'findRefAttrAt',
  'findTopLevelIndextermsInSubtree',
  'findUnclosedTag',
  'getAttributesForTag',
  'getAutoCloseTag',
  'getCloseTagCompletion',
  'getCompletionContext',
  'getDisplayNameInfo',
  'getKeyDefs',
  'getKeyScopes',
  'getMapRefName',
  'getMapTitleText',
  'isEmptyFilter',
  'isExcluded',
  'isExternalRef',
  'isValueExcluded',
  'lookupNamedEntity',
  'mergeProfilingAttrs',
  'needsSpace',
  'offsetToLineCol',
  'parseDita',
  'parseDitamap',
  'parseDitaval',
  'preprocessEntities',
  'profileGroups',
  'profileKey',
  'profileValuesOf',
  'profileValuesOfKeys',
  'profilingChipsHtml',
  'profilingKeysAttr',
  'pruneExcluded',
  'qualifiedNames',
  'qualifiedNamesMulti',
  'renderMapDocument',
  'resolveConkeyref',
  'resolveKeyInScope',
  'scopeKeyIndexKey',
  'splitRefFragment',
  'stripSameDocumentFragmentPrefix',
] as const;

/**
 * Functions that can reach the runtime: they read files, do path arithmetic, or
 * use per-runtime state (a cache, an overlay, the imagemap counter). They are
 * methods of an engine; the Node entry also exports them at top level, running
 * on its default runtime.
 */
export const RUNTIME_DEPENDENT = [
  'buildKeyMapForDocument',
  'buildKeySpace',
  'buildKeySpaceForDocument',
  'buildRenderContext',
  'clearAllSourceOverlays',
  'clearImageDimensionsCache',
  'clearSourceOverlay',
  'clearTopicRenderCache',
  'collectDiagnostics',
  'collectDitamapFilesUpward',
  'collectMapEntries',
  'collectMapKeys',
  'collectReferenceableFiles',
  'dependsOn',
  'expandDitamapRefs',
  'getTopicScopeChains',
  'isDitamapRef',
  'isInsideAny',
  'isKeyContextAvailable',
  'isPathInside',
  'isReadAllowed',
  'keySourceMaps',
  'makeConrefRangeResolver',
  'makeConrefResolver',
  'makeFileCache',
  'makeFileTitleResolver',
  'makeIsInCurrentBook',
  'makeRefErrorResolver',
  'noteSourceDependencies',
  'readImageDimensions',
  'readSourceText',
  'renderBookXml',
  'renderDocument',
  'renderElement',
  'renderMapXml',
  'renderSiteXml',
  'renderTopicCached',
  'renderTopicToHtml',
  'renderTopicXml',
  'setReadRoots',
  'setSourceOverlay',
  'setTopicRenderCacheBudgetForTesting',
  'sourceOverlaySize',
  'sourceStamp',
  'stampFiles',
  'toRelativeHref',
  'topicRenderCacheBytesHeld',
  'topicRenderCacheSize',
  'trackSourceReads',
] as const;

/**
 * Values that can reach the runtime but are not functions, so an engine cannot
 * wrap them: only the Node entry exports them.
 */
export const ROOT_ONLY = ['BASE_TYPE_RENDERERS'] as const;

export type RuntimeDependentName = (typeof RUNTIME_DEPENDENT)[number];
