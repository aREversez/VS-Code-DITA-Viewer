// Shared render-context factory (P2).
//
// The three DITA render paths -- renderTopicXml (book / site / map preview),
// DitaViewerProvider.renderTopicContentUntracked (single-topic custom editor)
// and ditaDiffProvider.computeDiff (the Git compare panel) -- each used to
// hand-assemble the same conref / keyref / title / image resolvers into a
// RenderContext. Duplicating the wiring meant that adding a resolver (the
// upcoming conkeyref, P3) in one path would silently leave the other two
// behind. Centralising it here means the key resolvers are wired once.
//
// Pure module: no vscode import. `asWebviewUri` and the document directory
// are passed in by the caller (those are the only genuinely per-path bits),
// so the whole factory is unit-testable in plain mocha.
//
// What legitimately differs per path stays as input flags, so wiring the
// factory in is behaviour-preserving:
//   - includeIndexLabel: preview and book set indexLabel, the diff view does
//     not (it never surfaces indexterm chips). Kept as a flag to preserve
//     that byte-for-byte.
//   - collectDependencies / bookMembers: only the book/site path uses them.
//     collectDependencies also folds image reads into the dependency set.
//   - suppressIndexterm: only the export path sets it.

import { resolve, relative, isAbsolute } from 'path';
import { DitaNode } from '../parser/domTypes';
import { RenderContext } from '../render/renderer';
import {
  makeFileCache,
  makeConrefResolver,
  makeConrefRangeResolver,
  makeFileTitleResolver,
  makeIsInCurrentBook,
  detectNoteLabels,
  detectIndexLabel,
  readImageDimensions,
  decodeHrefPart,
  URL_SCHEME_RE,
} from './refResolvers';
import { defaultTopicScopeChains, getKeyDefs, getKeyScopes, KeyDefLookup, KeyHrefDef, resolveKeyInScope } from './keySpace';
import { resolveConkeyref } from './conkeyref';

export interface BuildRenderContextInput {
  /** Directory hrefs in this document resolve against (== RenderContext.documentDir). */
  docDir: string;
  /** The document's own parsed root, for same-document conref lookups. */
  ownRoot: DitaNode;
  /** This document's id -> title map (empty for the diff view). */
  titleMap: Map<string, string>;
  /** Resolved key values for keyref / conkeyref. */
  keyMap: Map<string, string>;
  /**
   * Each key's resource target (href + defining map dir), used to resolve
   * conkeyref. Normally left undefined: the defs are looked up from `keyMap`
   * by instance identity (getKeyDefs), since both come from one buildKeySpace
   * call and the render paths thread the keyMap through everywhere. Pass it
   * explicitly only to drive conkeyref with a hand-built keyMap (tests).
   */
  keyDefs?: ReadonlyMap<string, KeyHrefDef>;
  /**
   * The key scope chains the document is read in (a keyscope listing several names
   * gives several chains; `[[]]` is the root scope). A keyref / conkeyref resolves
   * in the nearest scope that defines the key, as DITA says, instead of by name alone.
   * Book / site rendering passes the scope of the topicref that put the topic on the
   * page. Left undefined, the scope comes from `docFile` (the first topicref that
   * publishes it); with neither, or with a `keyMap` that carries no scope index (one
   * built by hand), keys resolve by name only, as they always did.
   */
  keyScope?: string[][];
  /**
   * Absolute path of the document being rendered. Together with `markConrefs`
   * it lets same-file conrefs be marked too (their target file is this one).
   */
  docFile?: string;
  /**
   * Opt-in: have the renderer mark conref'd content (data-conref-* attributes)
   * for the preview's gray tint and jump button. Left off by every path that
   * must emit plain markup -- "Export as HTML" and the diff view. Needs
   * `docFile`; without it nothing is marked.
   */
  markConrefs?: boolean;
  /** Per-path URI function; the callers keep their vscode-dependent versions. */
  asWebviewUri: (relPath: string) => string;
  headingLevel: number;
  uiLanguage?: string;
  /** Preview and book: true; diff: false (omits ctx.indexLabel). */
  includeIndexLabel?: boolean;
  suppressIndexterm?: boolean;
  /** Book / docsite only: the set of files that make up the current book. */
  bookMembers?: ReadonlySet<string>;
  /**
   * Standalone preview only: render non-book cross-file xrefs as real links
   * carrying data-dita-href for the webview to hand to the host (see
   * RenderContext.clickableExternalXrefs). Every other render path leaves it
   * unset and keeps the historical non-clickable hint span.
   */
  clickableExternalXrefs?: boolean;
  /** Book / site only: sink that records every file the render read. */
  collectDependencies?: Set<string>;
}

export interface BuiltRenderContext {
  ctx: RenderContext;
  /** Every file the shared cache read while resolving -- the book/site path
   *  folds these into collectDependencies after renderDocument returns. */
  touchedFiles: () => string[];
}

export function buildRenderContext(input: BuildRenderContextInput): BuiltRenderContext {
  const { docDir, ownRoot, titleMap, keyMap, asWebviewUri, headingLevel, uiLanguage } = input;

  // One cache shared by all three resolvers. They routinely load the same
  // conref/title target; sharing avoids re-parsing it and gives a single
  // place to read back the complete set of files this render touched.
  const fileCache = makeFileCache(docDir);
  const conrefResolver = makeConrefResolver(docDir, ownRoot, fileCache);
  const conrefRangeResolver = makeConrefRangeResolver(docDir, ownRoot, fileCache);
  const fileTitleResolver = makeFileTitleResolver(docDir, fileCache);

  // Which scope a reference is read in, and the lookups bound to it. The preview's key
  // space also keeps a flat name map (first definition wins, bare names visible
  // everywhere); a lookup that knows where it sits reads the scope index instead, so it
  // finds the nearest definition the way the completeness checks do.
  const scopeIndex = getKeyScopes(keyMap);
  const keyChains = scopeIndex
    ? (input.keyScope ?? (input.docFile ? defaultTopicScopeChains(scopeIndex, input.docFile) : undefined))
    : undefined;
  const lookupKey = (key: string): string | undefined =>
    scopeIndex && keyChains ? resolveKeyInScope(key, keyChains, scopeIndex.values) : keyMap.get(key);

  const ctx: RenderContext = {
    headingLevel,
    asWebviewUri,
    documentDir: docDir,
    // Local id match first, then cross-file ("file.dita#topicId" or "file.dita").
    resolveTitle: (id: string) => titleMap.get(id) || fileTitleResolver(id),
    resolveKey: lookupKey,
    resolveConref: (conref: string) => conrefResolver(conref),
    resolveConrefRange: (conref: string, conrefend: string) => conrefRangeResolver(conref, conrefend),
    noteLabels: detectNoteLabels(ownRoot, uiLanguage),
    suppressIndexterm: input.suppressIndexterm,
    getImageDimensions: (relPath: string) => {
      try {
        const absPath = resolve(docDir, decodeHrefPart(relPath));
        // An image's dimensions are emitted as width/height attributes, so
        // the file is a genuine dependency of the rendered HTML and has to be
        // recorded alongside the conref/title targets (only when the caller
        // passes a sink -- the preview and diff paths do not).
        input.collectDependencies?.add(absPath);
        return readImageDimensions(absPath);
      } catch {
        return undefined;
      }
    },
  };

  if (input.markConrefs && input.docFile) {
    const docFile = input.docFile;
    // origins only holds elements resolved from another file or through a
    // chain; a same-document target has none, and lives in docFile.
    ctx.conrefSource = (target: DitaNode) => fileCache.originOf(target)?.file ?? docFile;
  }

  if (input.includeIndexLabel) ctx.indexLabel = detectIndexLabel(ownRoot, uiLanguage);
  if (input.bookMembers) ctx.isInCurrentBook = makeIsInCurrentBook(docDir, input.bookMembers);
  if (input.clickableExternalXrefs) ctx.clickableExternalXrefs = true;

  // conkeyref rides on the same file cache: a key's href resolves against the
  // map that defined it (baseDir), not the topic being rendered, so it needs
  // the absolute-path loader rather than the docDir-relative conref resolver.
  // Discovered from keyMap by identity unless the caller passed defs directly.
  let lastLoaded: { file?: string; root: DitaNode } | undefined;
  const flatDefs = input.keyDefs ?? getKeyDefs(keyMap);
  // Definitions come from the same scope as the text, so a conkeyref or an xref keyref
  // cannot reach one scope's file while the text shows another's. Defs handed in
  // explicitly (tests) are used as given.
  const keyDefs: KeyDefLookup | undefined =
    flatDefs && !input.keyDefs && scopeIndex && keyChains
      ? { get: (name) => resolveKeyInScope(name, keyChains, scopeIndex.defs) }
      : flatDefs;
  if (keyDefs && flatDefs && flatDefs.size > 0) {
    // A keyref on a link-shaped element (topic/xref) resolves to the key's
    // resource target as its effective href. The keydef's href is relative
    // to the map that defined it, but every href the renderer consumes
    // (isInCurrentBook, resolveTitle, the preview's own open-by-href) is
    // relative to the DOCUMENT's folder -- so rebase here, preserving any
    // element-id fragment, and hand through the shapes that are not
    // filesystem paths (URL schemes, absolute paths) untouched.
    ctx.resolveKeyHref = (key: string): string | undefined => {
      const def = keyDefs.get(key);
      if (!def?.href) return undefined;
      const raw = def.href;
      if (URL_SCHEME_RE.test(raw) || isAbsolute(raw)) return raw;
      const hashIdx = raw.indexOf('#');
      const pathPart = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
      const fragment = hashIdx >= 0 ? raw.slice(hashIdx) : '';
      if (!pathPart) return fragment || undefined;
      const abs = resolve(def.baseDir, decodeHrefPart(pathPart));
      return relative(docDir, abs).replace(/\\/g, '/') + fragment;
    };
    const loadTopic = (baseDir: string, href: string): DitaNode | undefined => {
      const absPath = resolve(baseDir, decodeHrefPart(href.split('#')[0]));
      // A conkeyref target is a real dependency of the rendered HTML, exactly
      // like a conref target; record it when the caller tracks dependencies.
      input.collectDependencies?.add(absPath);
      return fileCache.loadAbsPath(absPath);
    };
    ctx.resolveConkeyref = (conkeyref: string) => {
      const el = resolveConkeyref(conkeyref, keyDefs, (baseDir, href) => {
        const absPath = resolve(baseDir, decodeHrefPart(href.split('#')[0]));
        const root = loadTopic(baseDir, href);
        if (root) lastLoaded = { file: absPath, root };
        return root;
      });
      if (el && lastLoaded) fileCache.noteOrigin(el, lastLoaded);
      return el;
    };
  }

  // One hop further along a reference chain, resolved relative to the file
  // that holds `from`. conkeyref wins over conref when it resolves, the same
  // rule as the first hop (an unresolvable conkeyref falls back to conref).
  ctx.resolveChainHop = (from: DitaNode): DitaNode | undefined => {
    const conkeyref = from.attributes?.conkeyref;
    if (conkeyref && ctx.resolveConkeyref) {
      lastLoaded = undefined;
      const viaKey = ctx.resolveConkeyref(conkeyref);
      if (viaKey) return viaKey;
    }
    const conref = from.attributes?.conref;
    return conref ? conrefResolver(conref, from) : undefined;
  };

  return { ctx, touchedFiles: () => fileCache.touchedFiles() };
}
