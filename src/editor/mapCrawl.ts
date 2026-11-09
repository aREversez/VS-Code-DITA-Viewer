// Reference crawler behind "Find Unreferenced Resources" and "Validate and
// Check for Completeness".
//
// Starting from one or more root maps it follows every reference it can see
// -- topicrefs, submaps, keydef hrefs, and inside topics: images, xrefs,
// conrefs, objects, links -- and records what it found, with file and line
// for each hit. The checks in mapChecks.ts and the unreferenced-file finder
// in unreferencedResources.ts are both pure functions of the CrawlResult.
//
// Pure of the vscode module (file access is injected via CrawlHost), so the
// whole thing is unit-testable against an in-memory file system.
//
// The data model lives in mapCrawlTypes.ts and the XML scan in mapXmlScan.ts; both are
// re-exported from here, so importers of this path are unaffected.

import { dirname, resolve } from 'path';
import { qualifiedNamesMulti, resolveKeyInScope, scopeKeyIndexKey } from '@dita-viewer/core';
import { decodeHrefPart } from './ditaRenderUtils';
import { normalizePathForCompare } from './mapReferenceTools';
import { Msg, msg } from './mapCheckMessages';
import { chainHas, classElementTag, ClassSide, classSyntaxProblem, declaresGrammar, Doctype, effectiveClassOf, readDoctype, sideOfRoot } from './ditaClass';
import { CrawlHost, CrawlOptions, CrawlResult, KeyDef, KeyUse, Location, RefKind, Reference } from './mapCrawlTypes';
import { PROFILING_ATTRS, TOPICREF_TAGS, URL_RE, XNode, classOf, hasNavTitle, isDitaHref, isMapTag, keyrefSyntax, profileValueOf, pruneExcluded, scanXml, walk } from './mapXmlScan';

export type { ClassIssue, ConkeyrefTarget, ConrefShape, ConrefTargetValue, ConrefUse, CrawlHost, CrawlOptions, CrawlResult, DomainsIssue, EmptyProfilingValue, ExcludedElement, FileIssue, FileRoot, IdUse, IgnoredMaprefContent, KeyDef, KeyElementPath, KeyLinkWithoutTarget, KeyUse, LinkWithoutTarget, Location, MapEntry, ProfilingConflict, ProfilingValueUse, RecursiveRef, RefKind, Reference, ReusableCandidate, SectionIssue, TableInfo, TopicId, UndefinedKey } from './mapCrawlTypes';
export { scanXml } from './mapXmlScan';

export async function crawlMaps(rootMaps: string[], host: CrawlHost, opts: CrawlOptions = {}): Promise<CrawlResult> {
  const result: CrawlResult = {
    rootMaps: rootMaps.map((m) => resolve(m)),
    maps: new Set(),
    topics: new Set(),
    refs: [],
    keyDefs: [],
    usedKeyNames: new Set(),
    keyUses: [],
    undefinedKeys: [],
    topicIds: [],
    ids: [],
    recursiveRefs: [],
    ignoredMaprefContent: [],
    mapEntries: [],
    reusable: [],
    conrefUses: [],
    conrefShapes: [],
    conrefTargetValues: [],
    linksWithoutTarget: [],
    keyLinksWithoutTarget: [],
    conkeyrefTargets: [],
    keyElementPaths: [],
    tables: [],
    profilingConflicts: [],
    profilingValues: [],
    emptyProfilingValues: [],
    excludedElements: [],
    fileIssues: [],
    classIssues: [],
    domainsIssues: [],
    sectionIssues: [],
    fileRoots: [],
    visited: new Map(),
    cancelled: false,
  };
  const norm = (p: string) => normalizePathForCompare(p, host.platform);
  const seenMaps = new Map<string, Set<string>>();
  /** A key definition by its element (file + scan uid), so a map's second scope
   * extends it instead of cloning it. */
  const keyDefIndex = new Map<string, KeyDef>();
  const seenTopics = new Set<string>();
  const profilingAttrs = [...PROFILING_ATTRS, ...(opts.extraProfilingAttributes ?? [])];
  const topicQueue: Array<{ path: string; inherited: Map<string, string[]> }> = [];
  /**
   * The key scopes a topic is published in: every topicref that points at it adds the
   * scope chains in effect there (R066). A topic crawled once can sit in several scopes,
   * and its keyrefs are resolved in each. A topic no topicref publishes has no entry
   * and resolves in the root scope.
   */
  const topicScopes = new Map<string, Map<string, string[][]>>();
  const noteTopicScope = (target: string, chains: string[][]): void => {
    const k = norm(target);
    let m = topicScopes.get(k);
    if (!m) topicScopes.set(k, (m = new Map()));
    m.set(JSON.stringify(chains), chains);
  };

  /** Reads and scans a file, recording read/parse problems as file issues. */
  async function load(path: string, from?: Location, prune = false): Promise<{ root: XNode; doctype?: Doctype; grammar: boolean } | undefined> {
    if (host.cancelled?.()) {
      result.cancelled = true;
      return undefined;
    }
    result.visited.set(norm(path), path);
    let text: string;
    try {
      text = await host.readFile(path);
    } catch {
      // A missing target is reported by the reference check, not here.
      if (!from) result.fileIssues.push({ file: path, line: 1, severity: 'error', msg: msg('val.unreadable'), structural: false });
      return undefined;
    }
    const scanned = scanXml(text);
    if (scanned.error) {
      result.fileIssues.push({ file: path, line: scanned.error.line, severity: 'error', msg: msg('val.xml', scanned.error.message), structural: false });
      return undefined;
    }
    if (prune && opts.filter && scanned.root) {
      const root = scanned.root;
      const topicIdOf = (n: XNode): string | undefined => (isTopicElement(n) ? n.attrs['id'] : undefined);
      pruneExcluded(root, opts.filter, topicIdOf(root), topicIdOf, (removed, removedTopicId) => {
        const id = removed.attrs['id'];
        if (id) result.excludedElements.push({ file: path, line: removed.line, id, tag: removed.tag, topicId: removedTopicId });
      });
    }
    return scanned.root
      ? { root: scanned.root, doctype: readDoctype(text), grammar: declaresGrammar(text, scanned.root.attrs) }
      : undefined;
  }

  function addRef(
    file: string,
    node: XNode,
    kind: RefKind,
    href: string,
    extra: { resourceOnly?: boolean; inReltable?: boolean; inMap?: boolean; scopeChains?: string[][] } = {},
  ): Reference {
    const scope = node.attrs['scope'];
    const format = node.attrs['format'];
    const remote = scope === 'external' || scope === 'peer' || URL_RE.test(href);
    const pathPart = href.split('#')[0];
    const target = !remote && pathPart ? resolve(dirname(file), decodeHrefPart(pathPart)) : undefined;
    const ref: Reference = {
      file,
      line: node.line,
      kind,
      href,
      target,
      remote,
      dita: !remote && !!pathPart && isDitaHref(pathPart, format),
      resourceOnly: !!extra.resourceOnly,
      copyTo: node.attrs['copy-to'],
      inReltable: !!extra.inReltable,
      tag: node.tag,
      scope,
      format,
      type: node.attrs['type'],
      inMap: !!extra.inMap,
      scopeChains: extra.scopeChains,
    };
    if (!remote && !pathPart) ref.target = undefined; // "#id" -- same-file fragment
    result.refs.push(ref);
    return ref;
  }

  /** The file, topic id and element id a conref/conrefend value names. */
  function contentTarget(value: string, sourceFile: string): { file?: string; topicId?: string; elementId?: string } {
    const hash = value.indexOf('#');
    const pathPart = hash >= 0 ? value.slice(0, hash) : value;
    const frag = hash >= 0 ? value.slice(hash + 1) : '';
    const segs = frag ? frag.split('/') : [];
    const sameTopic = segs[0] === '.';
    return {
      file: URL_RE.test(value) ? undefined : pathPart ? resolve(dirname(sourceFile), decodeHrefPart(pathPart)) : sourceFile,
      topicId: segs[0] && !sameTopic ? segs[0] : undefined,
      elementId: segs.length && !(sameTopic && segs.length === 1) ? segs[segs.length - 1] || undefined : undefined,
    };
  }

  // ── Maps ──
  async function crawlMap(mapPath: string, chain: string[], from?: Location, scopeChains: string[][] = [[]], replay = false): Promise<void> {
    const key = norm(mapPath);
    // A map reached again through a different key scope is a second instance of it: its
    // key definitions are in effect in both scopes, since a qualified name resolves through
    // either (corpus 6's q-twice). The file is scanned once; a second scope only re-registers
    // its keys, so nothing is collected twice.
    const scopeSig = scopeChains.map((c) => c.join('/')).sort().join('|');
    const seenScopes = seenMaps.get(key);
    if (seenScopes) {
      if (seenScopes.has(scopeSig)) return;
      seenScopes.add(scopeSig);
      replay = true;
    } else seenMaps.set(key, new Set([scopeSig]));
    const loaded = await load(mapPath, from);
    if (!loaded) return;
    const root = loaded.root;
    if (!replay) {
      result.maps.add(mapPath);
      const side = sideOfRoot(root.tag, root.attrs['class']);
      result.fileRoots.push({
        file: mapPath, line: root.line, tag: root.tag, side,
        classValue: effectiveClassOf(root.tag, root.attrs['class'], side),
        dita: isMapRootNode(root) || isTopicElement(root),
      });
      scanClasses(root, mapPath, loaded.doctype, loaded.grammar);
      scanDomains(root, mapPath);
      const rootId = root.attrs['id'];
      if (rootId) {
        // A topic read as a map keeps the topic's declared type.
        const idType = isMapRootNode(root) || isTopicElement(root) ? 'ID' : 'NMTOKEN';
        result.ids.push({ file: mapPath, line: root.line, id: rootId, tag: root.tag, idType });
      }
      const isMapRoot = isMapRootNode(root);
      // A topic read as a map (a @format mismatch) is reported by the reference check,
      // not as a structural problem of the target; only a root that is neither is a warning.
      if (!isMapRoot && !isTopicElement(root)) {
        result.fileIssues.push({
          file: mapPath, line: root.line, severity: 'warning',
          msg: msg('val.notMap', root.tag), structural: true,
        });
      }
    }
    const ctx: MapCtx = {
      file: mapPath, scopeChains, resourceOnly: false, inReltable: false, profile: new Map(), replay,
    };
    for (const c of root.children) await walkMapNode(c, ctx, chain.concat(key));
  }

  interface MapCtx {
    file: string;
    /** Key scope chains (names outermost first); several when keyscope lists several names. */
    scopeChains: string[][];
    resourceOnly: boolean;
    inReltable: boolean;
    /** Cascaded profiling values from topicref ancestors: attribute -> allowed value set. */
    profile: Map<string, string[]>;
    /** A second pass over a map already scanned in another scope: register keys only. */
    replay: boolean;
  }

  async function walkMapNode(n: XNode, ctx: MapCtx, chain: string[]): Promise<void> {
    if (host.cancelled?.()) { result.cancelled = true; return; }
    // Branch filtering
    if (opts.filter && opts.filter.excludes(n.attrs)) return;

    const tag = n.tag;
    const id = n.attrs['id'];
    if (id && !ctx.replay) {
      result.ids.push({ file: ctx.file, line: n.line, id, tag, idType: isTopicElement(n) ? 'ID' : 'NMTOKEN' });
    }
    if (!ctx.replay && (tag === 'topichead' || TOPICREF_TAGS.has(tag))) {
      result.mapEntries.push({
        file: ctx.file, line: n.line, tag, href: n.attrs['href'],
        keyref: n.attrs['keyref'], scope: n.attrs['scope'], navTitle: hasNavTitle(n),
      });
    }

    // Key scopes
    let scopeChains = ctx.scopeChains;
    const keyscope = n.attrs['keyscope'];
    if (keyscope) {
      const names = keyscope.trim().split(/\s+/).filter(Boolean);
      if (names.length) scopeChains = scopeChains.flatMap((chain) => names.map((nm) => chain.concat(nm)));
    }
    const localCtx: MapCtx = { ...ctx, scopeChains };

    if (tag === 'reltable') localCtx.inReltable = true;

    const href = n.attrs['href'];
    const keyref = n.attrs['keyref'];
    const keys = n.attrs['keys'];
    const isKeydef = tag === 'keydef' || /\bmap\/keydef\b/.test(classOf(n));
    const procRole = n.attrs['processing-role'];
    const resourceOnly = procRole === 'resource-only' || (isKeydef && procRole !== 'normal') || ctx.resourceOnly;
    localCtx.resourceOnly = procRole === 'normal' ? false : resourceOnly;

    // A keyref on a map element is a reference to whatever the key resolves
    // to. Resolution happens once every map is crawled (a definition may live
    // in a submap or after the use), so the context is recorded here.
    let mapKeyUse: KeyUse | undefined;
    if (keyref && !ctx.replay) {
      const keyName = keyref.trim();
      const isMap = tag === 'mapref' || /\bmap\/mapref\b/.test(classOf(n));
      mapKeyUse = {
        file: ctx.file, line: n.line, key: keyName.split('/')[0],
        value: keyref, attribute: 'keyref', tag,
        keySyntax: keyrefSyntax(keyName),
        kind: isKeydef ? 'keydef' : isMap ? 'mapref' : 'topicref',
        scopeChains, resourceOnly: localCtx.resourceOnly,
        inReltable: localCtx.inReltable, copyTo: n.attrs['copy-to'],
      };
      result.keyUses.push(mapKeyUse);
    }

    // Cascade profiling attributes from this topicref to descendants and to its topic.
    // A replay only registers keys, so the cascade and its findings are skipped.
    const cascaded = ctx.replay ? ctx.profile : new Map(ctx.profile);
    if (isMapTag(n) && !ctx.replay) {
      for (const a of profilingAttrs) {
        const v = n.attrs[a];
        if (v === undefined) continue;
        const value = profileValueOf(v);
        if (value.emptyValue) {
          result.emptyProfilingValues.push({ file: ctx.file, line: n.line, attribute: a, tag });
          continue;
        }
        result.profilingValues.push({ file: ctx.file, line: n.line, attribute: a, values: value.values, tag });
        // An empty group carries no value: it reaches the preferences as its own text
        // (Oxygen's dmv.prof.group.val.prefs.undef) but cascades nothing.
        if (value.groupOnly) continue;
        const values = value.values;
        const prev = cascaded.get(a);
        if (prev) {
          const inter = values.filter((x) => prev.includes(x));
          if (inter.length === 0 && !/^\s*$/.test(v)) {
            result.profilingConflicts.push({
              file: ctx.file, line: n.line, attribute: a, values, ancestorValues: prev, tag,
            });
          }
          cascaded.set(a, inter.length ? inter : prev);
        } else cascaded.set(a, values);
      }
    }
    localCtx.profile = cascaded;

    if (keys) {
      const names = keys.trim().split(/\s+/).filter(Boolean);
      const scopeIds = [...new Set(scopeChains.map((c) => c.join('/')))];
      for (const name of names) {
        const qualified = qualifiedNamesMulti(name, scopeChains);
        // A replay reaches the same definition under a second scope: it answers to that
        // scope too, but stays one definition, so R010 and R011 see it once. The name is part
        // of the identity: one element may carry several (`keys="a b"`).
        const id = `${norm(ctx.file)}\u0000${n.uid}\u0000${name}`;
        const known = keyDefIndex.get(id);
        if (known) {
          for (const sid of scopeIds) if (!known.scopeIds.includes(sid)) known.scopeIds.push(sid);
          for (const q of qualified) if (!known.qualified.includes(q)) known.qualified.push(q);
          continue;
        }
        const def: KeyDef = {
          file: ctx.file, line: n.line, key: name, qualified, scopeId: scopeIds[0], scopeIds, href,
          keyref: keyref?.trim(),
          format: n.attrs['format'],
        };
        if (href && !URL_RE.test(href) && n.attrs['scope'] !== 'external') {
          const p = href.split('#')[0];
          if (p) def.target = resolve(dirname(ctx.file), decodeHrefPart(p));
        }
        keyDefIndex.set(id, def);
        result.keyDefs.push(def);
      }
    }

    // DITA: @keyref takes precedence over @href, but @href is the fallback when
    // the key is undefined. The href is recorded as usual and the key resolution
    // below drops it again if the key turns out to be defined.
    let followedMap = false;
    if (href !== undefined && href !== '' && (isMapTag(n) || tag === 'linkref' || n.attrs['href'])) {
      const isRelInner = ctx.inReltable && !isMapTag(n);
      const kind: RefKind = isKeydef ? 'keydef' : isMapHref(n, href) ? 'mapref' : 'topicref';
      if (!isRelInner || isMapTag(n)) {
        if (ctx.replay) {
          // A replay follows a nested map for its keys only, not for its references.
          const target = href.split('#')[0];
          if (kind === 'mapref' && target && n.attrs['scope'] !== 'external' && !URL_RE.test(href)) {
            const resolved = resolve(dirname(ctx.file), decodeHrefPart(target));
            if (!chain.includes(norm(resolved))) {
              await crawlMap(resolved, chain, { file: ctx.file, line: n.line }, scopeChains, true);
            }
          }
          if (kind === 'mapref') followedMap = true;
        } else {
          const ref = addRef(ctx.file, n, kind, href, {
            resourceOnly: localCtx.resourceOnly, inReltable: localCtx.inReltable, inMap: true, scopeChains,
          });
          if (mapKeyUse) mapKeyUse.fallbackRef = ref;
          if (ref.target && !ref.remote) {
            const tkey = norm(ref.target);
            if (kind === 'mapref') {
              // A target already on the crawl path closes a cycle: report it where it
              // closes (Oxygen names the map that points back, not every member).
              if (chain.includes(tkey)) result.recursiveRefs.push({ file: ctx.file, line: n.line, href });
              else await crawlMap(ref.target, chain, ref, scopeChains);
              followedMap = true;
            } else if (ref.dita && n.attrs['format'] !== 'ditamap') {
              if (kind === 'topicref') noteTopicScope(ref.target, scopeChains);
              if (!seenTopics.has(tkey)) {
                seenTopics.add(tkey);
                topicQueue.push({ path: ref.target, inherited: cascaded });
              }
            }
          } else if (kind === 'mapref') {
            followedMap = true;
          }
        }
      }
    }
    // The content of a reference to a map is ignored by DITA (dmv.ref.topic.inside.mapref).
    if (followedMap) {
      if (!ctx.replay) {
        for (const c of n.children) {
          if (c.tag !== 'topicmeta' && (isMapTag(c) || TOPICREF_TAGS.has(c.tag))) {
            result.ignoredMaprefContent.push({ file: ctx.file, line: c.line, tag: c.tag });
          }
        }
      }
      return;
    }
    for (const c of n.children) await walkMapNode(c, localCtx, chain);
  }

  function isMapHref(n: XNode, href: string): boolean {
    const p = href.split('#')[0].toLowerCase();
    return n.attrs['format'] === 'ditamap' || (p.endsWith('.ditamap') && !n.attrs['format']) || /\bmap\/mapref\b/.test(classOf(n)) || n.tag === 'mapref';
  }

  // ── Topics ──
  function hrefAttrKind(n: XNode): RefKind | undefined {
    switch (n.tag) {
      case 'image': return 'image';
      case 'xref': return 'xref';
      case 'link': return 'link';
      case 'object': return 'object';
      case 'data': case 'data-about': return 'data';
      case 'lq': case 'source': case 'audio': case 'video': case 'media-source': return 'other';
      case 'topicref': case 'keydef': return undefined;
      default: return undefined;
    }
  }

  async function crawlTopic(path: string, inherited: Map<string, string[]>): Promise<void> {
    if (host.cancelled?.()) { result.cancelled = true; return; }
    const loaded = await load(path, { file: path, line: 1 }, true);
    if (!loaded) {
      // A missing target is reported by the reference check; a parse error already recorded.
      return;
    }
    const root = loaded.root;
    result.topics.add(path);
    const isTopic = isTopicElement(root);
    const side = sideOfRoot(root.tag, root.attrs['class']);
    result.fileRoots.push({
      file: path, line: root.line, tag: root.tag, side,
      classValue: effectiveClassOf(root.tag, root.attrs['class'], side),
      dita: isTopic || isMapRootNode(root),
    });
    scanClasses(root, path, loaded.doctype, loaded.grammar);
    scanDomains(root, path);
    scanSections(root, path, side);
    // A map read as a topic (a @format mismatch) is reported by the reference check.
    if (!isTopic && !isMapRootNode(root)) {
      result.fileIssues.push({
        file: path, line: root.line, severity: 'warning',
        msg: msg('val.notTopic', root.tag), structural: true,
      });
    }

    // Every @id (id syntax, duplicate element ids) and every reusable element
    // (unreferenced-reusable, conref range checks), with the enclosing topic id
    // and the element's place among its parent's children.
    const visitIds = (n: XNode, topicId: string | undefined, parentKey: string, order: number, shadowed: boolean): void => {
      const isTopic = isTopicElement(n);
      const currentTopic = isTopic ? (n.attrs['id'] ?? topicId) : topicId;
      const id = n.attrs['id'];
      if (id) {
        result.ids.push({ file: path, line: n.line, id, tag: n.tag, idType: isTopic ? 'ID' : 'NMTOKEN', topicId: currentTopic });
        if (!isTopic) {
          result.reusable.push({
            file: path, line: n.line, id, tag: n.tag, topicFile: path, topicId: currentTopic,
            parentKey, order, replacedByConref: shadowed || undefined,
            classValue: effectiveClassOf(n.tag, n.attrs['class'], side),
          });
        }
      }
      const key = `${parentKey}/${n.tag}${id ? `#${id}` : `[${order}]`}`;
      // The element's own @conref replaces what is written inside it (Oxygen's
      // dmv.ref.filtered.conref); the element itself survives the resolution.
      const childShadowed = shadowed || n.attrs['conref'] !== undefined;
      n.children.forEach((c, i) => visitIds(c, currentTopic, key, i, childShadowed));
    };
    visitIds(root, undefined, '', 0, false);

    // Topic ids (root and nested)
    for (const n of walk(root)) {
      if (isTopicElement(n)) {
        const id = n.attrs['id'];
        if (id) result.topicIds.push({ file: path, line: n.line, id, topicFile: path });
        else result.fileIssues.push({ file: path, line: n.line, severity: 'error', msg: msg('val.noId', n.tag), structural: true });
        if (!n.children.some((c) => c.tag === 'title' || /\btopic\/title\b/.test(classOf(c)))) {
          result.fileIssues.push({ file: path, line: n.line, severity: 'warning', msg: msg('val.noTitle', n.tag), structural: true });
        }
      }
    }

    // Local-topic-only scan.
    for (const n of walk(root)) {
      const conref = n.attrs['conref'];
      const conrefend = n.attrs['conrefend'];
      const conkeyref = n.attrs['conkeyref'];
      if (conref !== undefined || conrefend !== undefined || conkeyref !== undefined) {
        const start = conref ? contentTarget(conref, path) : undefined;
        const end = conrefend ? contentTarget(conrefend, path) : undefined;
        result.conrefShapes.push({
          file: path, line: n.line, tag: n.tag, conref, conrefend, conkeyref,
          targetFile: start?.file, targetTopicId: start?.topicId, targetElementId: start?.elementId,
          endTargetFile: end?.file, endTopicId: end?.topicId, endElementId: end?.elementId,
          classValue: effectiveClassOf(n.tag, n.attrs['class'], side),
        });
      }
      // `-dita-use-conref-target` is only meaningful on an element that is a
      // content reference; without @conref or @conkeyref the value is a mistake.
      if (conref === undefined && conkeyref === undefined) {
        for (const [attribute, value] of Object.entries(n.attrs)) {
          if (/(^|\s)-dita-use-conref-target(\s|$)/.test(value)) {
            result.conrefTargetValues.push({ file: path, line: n.line, tag: n.tag, attribute, value });
          }
        }
      }
      if ((n.tag === 'xref' || n.tag === 'link') && !n.attrs['href'] && !n.attrs['keyref'] && !conref && !conkeyref) {
        result.linksWithoutTarget.push({ file: path, line: n.line, tag: n.tag });
      }
      if (conkeyref) {
        const key = conkeyref.trim().split('/')[0];
        result.keyUses.push({ file: path, line: n.line, key, value: conkeyref, attribute: 'conkeyref', tag: n.tag });
        result.conrefUses.push({ key, targetId: conkeyref.includes('/') ? conkeyref.split('/').pop() : undefined });
      }
      if (conref) {
        const ref = addRef(path, n, 'conref', conref);
        if (ref.dita && ref.target) {
          const ck = norm(ref.target);
          if (!seenTopics.has(ck) && !ref.target.toLowerCase().endsWith('.ditamap')) {
            seenTopics.add(ck);
            topicQueue.push({ path: ref.target, inherited: new Map() });
          }
        }
        const frag = conref.includes('#') ? conref.split('#')[1] : '';
        // "." is DITA's same-topic fragment (`#.`, `#./elem`): it names no topic id to look up.
        const segs = frag ? frag.split('/') : [];
        const sameTopic = segs[0] === '.';
        result.conrefUses.push({
          targetFile: ref.target ?? path,
          targetId: segs.length && !(sameTopic && segs.length === 1) ? segs[segs.length - 1] : undefined,
          topicId: segs[0] && !sameTopic ? segs[0] : undefined,
          elemId: segs.length > 1 ? segs.slice(1).join('/') : undefined,
          sourceFile: path,
          sourceLine: n.line,
        });
      }
      const keyrefValue = n.attrs['keyref'];
      let topicKeyUse: KeyUse | undefined;
      if (keyrefValue) {
        const keyName = keyrefValue.trim();
        topicKeyUse = {
          file: path, line: n.line, key: keyName.split('/')[0],
          value: keyrefValue, attribute: 'keyref', tag: n.tag, kind: hrefAttrKind(n),
          keySyntax: keyrefSyntax(keyName),
        };
        result.keyUses.push(topicKeyUse);
      }
      for (const a of ['href', 'data']) {
        const href = n.attrs[a];
        if (!href) continue;
        if (a === 'data' && n.tag !== 'object') continue;
        const kind = hrefAttrKind(n);
        if (!kind) continue;
        const ref = addRef(path, n, kind, href);
        if (topicKeyUse) topicKeyUse.fallbackRef = ref; // dropped if the key resolves
        if (ref.dita && ref.target) {
          const tkey = norm(ref.target);
          if (!seenTopics.has(tkey) && !ref.target.toLowerCase().endsWith('.ditamap')) {
            seenTopics.add(tkey);
            topicQueue.push({ path: ref.target, inherited: new Map() });
          }
        }
      }
      // <image keyref> etc. resolve through the key space (see resolveKeyRefs below).
    }

    checkTables(root, path);
    checkProfiling(root, path, inherited);
  }

  const TOPIC_ROOTS = new Set([
    'topic', 'concept', 'task', 'reference', 'glossentry', 'glossgroup', 'troubleshooting',
    'learningPlan', 'learningOverview', 'learningContent', 'learningSummary', 'learningAssessment',
    'subjectScheme',
  ]);

  function isTopicElement(n: XNode): boolean {
    if (/\btopic\/topic\b/.test(classOf(n))) return true;
    return TOPIC_ROOTS.has(n.tag);
  }

  function isMapRootNode(n: XNode): boolean {
    return /\bmap\/map\b/.test(classOf(n)) || n.tag === 'map' || n.tag === 'bookmap';
  }

  // ── Tables ──
  function checkTables(root: XNode, path: string): void {
    for (const n of walk(root)) {
      if (n.tag === 'table') {
        for (const tg of n.children.filter((c) => c.tag === 'tgroup')) checkCals(tg, path);
      } else if (n.tag === 'simpletable' || n.tag === 'properties' || n.tag === 'choicetable') {
        checkSimple(n, path);
      }
    }
  }

  function checkCals(tg: XNode, path: string): void {
    const problems: Array<{ line: number; msg: Msg }> = [];
    const colsAttr = tg.attrs['cols'];
    const cols = colsAttr !== undefined ? Number(colsAttr) : NaN;
    if (colsAttr === undefined || !Number.isInteger(cols) || cols < 1) {
      problems.push({ line: tg.line, msg: msg('tbl.cals.colsInvalid', colsAttr ?? '') });
    }
    for (const a of ['rowsep', 'colsep']) {
      const v = tg.attrs[a];
      if (v !== undefined && !/^\d+$/.test(v)) problems.push({ line: tg.line, msg: msg('tbl.cals.attrNotNumeric', a, v) });
    }
    const colspecs = tg.children.filter((c) => c.tag === 'colspec');
    const names = new Map<string, number>();
    colspecs.forEach((cs, i) => {
      const nm = cs.attrs['colname'];
      const num = cs.attrs['colnum'] ? Number(cs.attrs['colnum']) : i + 1;
      if (nm) names.set(nm, num);
      for (const a of ['rowsep', 'colsep']) {
        const v = cs.attrs[a];
        if (v !== undefined && !/^\d+$/.test(v)) problems.push({ line: cs.line, msg: msg('tbl.cals.colspecNotNumeric', a, v) });
      }
    });
    if (Number.isInteger(cols) && colspecs.length > 0 && colspecs.length !== cols) {
      problems.push({ line: tg.line, msg: msg('tbl.cals.colspecCount', colspecs.length, cols) });
    }
    const rows: XNode[] = [];
    for (const sec of tg.children.filter((c) => c.tag === 'thead' || c.tag === 'tbody' || c.tag === 'tfoot')) {
      for (const r of sec.children.filter((c) => c.tag === 'row')) rows.push(r);
    }
    const width = colspecs.length > 0 ? colspecs.length : cols;
    // carry[c] = remaining rows an entry from above still occupies in column c
    let carry: number[] = Array.from({ length: Number.isInteger(width) ? width : 0 }, () => 0);
    let maxCols = 0;
    rows.forEach((row, ri) => {
      const occupied = carry.map((v) => v > 0);
      const next = carry.map((v) => Math.max(0, v - 1));
      let col = 0;
      const entries = row.children.filter((c) => c.tag === 'entry');
      for (const e of entries) {
        let start: number;
        let span = 1;
        const cn = e.attrs['colname'];
        const ns = e.attrs['namest'];
        const ne = e.attrs['nameend'];
        const refName = (nm: string, attr: string): number | undefined => {
          const num = names.get(nm);
          if (num === undefined && colspecs.length > 0) {
            problems.push({ line: e.line, msg: msg('tbl.cals.badName', nm, attr) });
          }
          return num;
        };
        if (ns || ne) {
          const s = ns ? refName(ns, 'namest') : undefined;
          const en = ne ? refName(ne, 'nameend') : undefined;
          if (s !== undefined && en !== undefined) {
            start = s - 1;
            span = Math.max(1, en - s + 1);
            if (en < s) problems.push({ line: e.line, msg: msg('tbl.cals.nameOrder', ns ?? '', ne ?? '') });
          } else {
            start = col;
          }
        } else if (cn) {
          const s = refName(cn, 'colname');
          start = s !== undefined ? s - 1 : col;
        } else {
          while (occupied[col]) col++;
          start = col;
        }
        for (let c = start; c < start + span; c++) {
          if (occupied[c]) {
            problems.push({ line: e.line, msg: msg('tbl.cals.overlap', ri + 1, c + 1) });
            break;
          }
        }
        const more = e.attrs['morerows'] ? Number(e.attrs['morerows']) : 0;
        if (Number.isFinite(more) && more > 0) {
          const rowsLeft = rows.length - ri - 1;
          if (more > rowsLeft) {
            problems.push({ line: e.line, msg: msg('tbl.cals.morerows', ri + 1, more, rowsLeft) });
          }
          for (let c = start; c < start + span; c++) {
            while (next.length <= c) next.push(0);
            next[c] = Math.max(next[c], more);
          }
        }
        for (let c = start; c < start + span; c++) occupied[c] = true;
        col = start + span;
        maxCols = Math.max(maxCols, col);
      }
      const usedWidth = Math.max(col, ...occupied.map((o, i) => (o ? i + 1 : 0)));
      if (Number.isInteger(width) && width > 0 && usedWidth < width) {
        problems.push({ line: row.line, msg: msg('tbl.cals.rowWidth', ri + 1, usedWidth, width) });
      } else if (Number.isInteger(width) && width > 0 && col > width) {
        problems.push({ line: row.line, msg: msg('tbl.cals.rowWidth', ri + 1, col, width) });
      }
      carry = next;
    });
    if (Number.isInteger(cols) && cols > 0 && colspecs.length === 0 && maxCols > 0 && maxCols !== cols) {
      problems.push({ line: tg.line, msg: msg('tbl.cals.colsMismatch', cols, maxCols) });
    }
    if (problems.length) result.tables.push({ file: path, line: tg.line, kind: 'cals', problems });
  }

  function checkSimple(t: XNode, path: string): void {
    const rowTags = new Set(['sthead', 'strow', 'prophead', 'property', 'chhead', 'chrow']);
    const rows = t.children.filter((c) => rowTags.has(c.tag));
    if (rows.length === 0) return;
    const cellCount = (r: XNode) => r.children.length;
    const head = rows.find((r) => r.tag === 'sthead' || r.tag === 'prophead' || r.tag === 'chhead');
    const expected = head ? cellCount(head) : Math.max(...rows.map(cellCount));
    const problems: Array<{ line: number; msg: Msg }> = [];
    rows.forEach((r, i) => {
      const n = cellCount(r);
      if (n < expected) problems.push({ line: r.line, msg: msg('tbl.simple.short', i + 1, n, expected) });
      else if (head && n > expected) problems.push({ line: r.line, msg: msg('tbl.simple.long', i + 1, n, expected) });
    });
    if (problems.length) result.tables.push({ file: path, line: t.line, kind: 'simple', problems });
  }

  // ── Profiling ──
  function checkProfiling(root: XNode, path: string, inherited: Map<string, string[]>): void {
    // The values a topicref passes down are compared with the topic root only, as Oxygen
    // does (real report: nothing for a body element against the map value, a conflict for
    // the root). Below the root an element is compared with its ancestors in this file.
    const visit = (n: XNode, eff: Map<string, string[]>): void => {
      const isRoot = n === root;
      const against = isRoot ? inherited : eff;
      let next = isRoot ? new Map<string, string[]>() : eff;
      for (const a of profilingAttrs) {
        const v = n.attrs[a];
        if (v === undefined) continue;
        const value = profileValueOf(v);
        if (value.emptyValue) {
          result.emptyProfilingValues.push({ file: path, line: n.line, attribute: a, tag: n.tag });
          continue;
        }
        const values = value.values;
        result.profilingValues.push({ file: path, line: n.line, attribute: a, values, tag: n.tag });
        if (value.groupOnly) continue; // an empty group compares, but cascades nothing
        const prev = against.get(a);
        if (prev) {
          const inter = values.filter((x) => prev.includes(x));
          if (inter.length === 0) {
            result.profilingConflicts.push({
              file: path, line: n.line, attribute: a, values, ancestorValues: prev, tag: n.tag,
            });
          }
          if (next === eff) next = new Map(eff);
          // The root hands its own values on; elsewhere the overlap (or the ancestor's set).
          next.set(a, isRoot ? values : inter.length ? inter : prev);
        } else {
          if (next === eff) next = new Map(eff);
          next.set(a, values);
        }
      }
      for (const c of n.children) visit(c, next);
    };
    visit(root, inherited);
  }

  // ── Class, domains and sections ──
  /**
   * The written @class values the DITA class syntax rejects, and the elements no DTD
   * gives a class. A file with no DOCTYPE and no schema has no default class at all, so every
   * element that does not write one is reported (what Oxygen reports: one finding per
   * element, the root included). A written value always wins: a hand-written or
   * specialized class is taken at its word, and only its syntax is checked. An element
   * the generated table does not know, in a file that does declare a DITA DTD, is left
   * alone: whether that DTD declares it is schema validation's question, not this one.
   */
  function scanClasses(root: XNode, file: string, doctype: Doctype | undefined, grammar: boolean): void {
    // A DOCTYPE of any kind or a schema association may supply the class defaults (a specialization
    // ships its own DTD); only a file that declares neither has no source of a class at all.
    if (doctype !== undefined || grammar) {
      for (const n of walk(root)) {
        const explicit = n.attrs['class'];
        if (explicit === undefined) continue; // the DTD supplies a class, or the element is outside the table
        const problem = classSyntaxProblem(explicit);
        if (problem) result.classIssues.push({ file, line: n.line, tag: n.tag, problem });
      }
      return;
    }
    for (const n of walk(root)) {
      const explicit = n.attrs['class'];
      if (explicit !== undefined) {
        const problem = classSyntaxProblem(explicit);
        if (problem) result.classIssues.push({ file, line: n.line, tag: n.tag, problem });
        continue;
      }
      // No DTD or schema is declared here at all, so the element has no class
      // to check; that is the finding.
      result.classIssues.push({ file, line: n.line, tag: n.tag, problem: 'not-specified' });
    }
  }

  /** An @domains written empty claims no domain (Oxygen's dmv.invalid.domains.format). */
  function scanDomains(root: XNode, file: string): void {
    const domains = root.attrs['domains'];
    if (domains !== undefined && domains.trim() === '') result.domainsIssues.push({ file, line: root.line, tag: root.tag });
  }

  /**
   * A section's title must come first and be its only one. Only a section in a legal
   * place is checked: one whose parent is a body, a bodydiv or a sectiondiv (the
   * containers DITA gives a section). A section nested in another section is not valid
   * DITA at all, so the schema answer is the one that counts and this check stays
   * quiet, which is what the boundary probes showed.
   */
  function scanSections(root: XNode, file: string, side: ClassSide): void {
    const classOfNode = (n: XNode): string | undefined => effectiveClassOf(n.tag, n.attrs['class'], side);
    for (const n of walk(root)) {
      if (classElementTag(classOfNode(n)) !== 'section') continue;
      const parentClass = n.parent ? classOfNode(n.parent) : undefined;
      if (!chainHas(parentClass, 'topic/body') && !chainHas(parentClass, 'topic/bodydiv') && !chainHas(parentClass, 'topic/sectiondiv')) continue;
      const titles = n.children.filter((c) => classElementTag(classOfNode(c)) === 'title');
      if (titles.length > 1) {
        for (const t of titles.slice(1)) result.sectionIssues.push({ file, line: t.line, tag: n.tag, kind: 'duplicate-title' });
      } else if (titles.length === 1 && n.children[0] !== titles[0]) {
        result.sectionIssues.push({ file, line: titles[0].line, tag: n.tag, kind: 'first-title' });
      }
    }
  }

  // ── Drive ──
  for (const m of result.rootMaps) {
    await crawlMap(m, []);
    if (result.cancelled) break;
  }
  while (topicQueue.length && !result.cancelled) {
    const t = topicQueue.shift()!;
    await crawlTopic(t.path, t.inherited);
  }

  // ── Key resolution ──
  // Every @keyref use is resolved against the keys the maps define. This runs
  // after both loops because a definition may live in a submap or after the
  // use. A keyref that resolves to a resource becomes a reference, so the
  // ordinary existence / duplicate / link checks see it; a keyref that resolves
  // to nothing is reported as an undefined key (Oxygen's `dmv.undef.key`).
  // A key lives in a scope (`scopeIds`) and is found by (scope, name): R066. A use
  // looks in its own scope first, then each enclosing one; a name written with
  // scope qualifiers (`s1.k`) is looked up below the scope it starts from.
  const keyIndex = new Map<string, KeyDef>();
  for (const def of result.keyDefs) {
    for (const sid of def.scopeIds) {
      const k = scopeKeyIndexKey(sid, def.key);
      if (!keyIndex.has(k)) keyIndex.set(k, def);
    }
  }
  const droppedFallbacks = new Set<Reference>();
  for (const use of result.keyUses) {
    if (use.keySyntax) continue; // reported as invalid key syntax, not as an undefined key
    // A map element carries the scopes it sits in; a topic takes those of every topicref
    // that publishes it (or the root scope when none does).
    const contexts = use.scopeChains
      ? [use.scopeChains]
      : [...(topicScopes.get(norm(use.file))?.values() ?? [[[]]])];
    const defs = new Set<KeyDef>();
    let missing = false;
    for (const chains of contexts) {
      const def = resolveKeyInScope(use.key, chains, keyIndex);
      if (def) defs.add(def);
      else missing = true;
    }
    if (missing) {
      result.undefinedKeys.push({ file: use.file, line: use.line, key: use.key, value: use.value ?? use.key });
    }
    // A use counts for its name once any context resolved it: the first of two definitions
    // that bind one name is the one resolution reaches, so both names are used (R010/R011).
    if (defs.size) result.usedKeyNames.add(use.key);
    for (const def of defs) {
      // A keyref may append an element id (`key/element`): the key resolves to a
      // file and a topic, so the appended id is checked against that topic later.
      const suffix = use.value?.split('/').slice(1).join('/');
      const keyHref = def.href ?? '';
      const keyHash = keyHref.indexOf('#');
      const keyTopic = keyHash >= 0 ? keyHref.slice(keyHash + 1).split('/')[0] : '';
      if (suffix && !use.scopeChains) {
        result.keyElementPaths.push({
          file: use.file, line: use.line, value: use.value ?? use.key,
          elementPath: suffix, targetFile: def.target, topicId: keyTopic || undefined,
        });
      }
      // The key is defined, so the element's own @href is not used.
      if (use.fallbackRef) droppedFallbacks.add(use.fallbackRef);
      if (use.attribute === 'conkeyref') {
        // Content references never become References here, but the file behind the key
        // is one the element depends on: recorded so the checks can report it missing.
        if (def.target) {
          result.conkeyrefTargets.push({
            file: use.file, line: use.line,
            href: def.href ?? use.value ?? use.key,
            target: def.target,
            dita: isDitaHref((def.href ?? '').split('#')[0], def.format),
          });
        }
        continue;
      }
      if (!def.target) {
        // A text-only key: defined, but there is no resource to link to. A key that
        // redirects to another key is left alone: this crawl does not follow
        // redirect chains, so it cannot tell where the chain ends.
        if (!def.keyref && (use.kind === 'xref' || use.kind === 'link')) {
          result.keyLinksWithoutTarget.push({
            file: use.file, line: use.line, key: use.key, value: use.value ?? use.key, tag: use.tag,
          });
        }
        continue;
      }
      // Only elements that make a link (xref, image, topicref, ...) are references;
      // a <ph keyref> or <keyword keyref> merely borrows the key's text.
      if (!use.kind) continue;
      const pathPart = (def.href ?? '').split('#')[0];
      result.refs.push({
        file: use.file,
        line: use.line,
        kind: use.kind,
        href: def.href ?? use.value ?? use.key,
        target: def.target,
        remote: false,
        dita: isDitaHref(pathPart, def.format),
        resourceOnly: !!use.resourceOnly,
        copyTo: use.copyTo,
        inReltable: !!use.inReltable,
        tag: use.tag ?? '',
        format: def.format,
        inMap: !!use.scopeChains,
        // A <topicref keyref> sits in the scopes of the map element that carries it,
        // so a duplicate check counts it in that scope (R008, as the key use does).
        scopeChains: use.scopeChains,
        viaKeyref: true,
      });
    }
  }
  if (droppedFallbacks.size) result.refs = result.refs.filter((r) => !droppedFallbacks.has(r));
  return result;
}

// ── helpers ─────────────────────────────────────────────────────────────

// qualifiedNames / qualifiedNamesMulti live in keySpace.ts (the preview's key
// lookup uses the same rule); re-exported so existing importers keep working.
export { qualifiedNames, qualifiedNamesMulti } from '@dita-viewer/core';
