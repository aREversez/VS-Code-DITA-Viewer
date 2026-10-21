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

import sax from 'sax';
import { dirname, resolve } from 'path';
import { preprocessEntities } from '../parser/ditaParser';
import { decodeHrefPart } from './ditaRenderUtils';
import { normalizePathForCompare } from './mapReferenceTools';
import { DitavalFilter } from './ditaval';
import { Msg, msg } from './mapCheckMessages';
import { qualifiedNamesMulti } from './keySpace';

export interface CrawlHost {
  /** Text of a file (unsaved editor text if any). Rejects when unreadable. */
  readFile(absPath: string): Promise<string>;
  exists(absPath: string): Promise<boolean>;
  platform: NodeJS.Platform;
  /** Whether an existing path is a folder (folder-reference check). */
  isDirectory?(absPath: string): Promise<boolean>;
  /** Entry names of a folder, or undefined when it cannot be listed (capitalization check). */
  readDir?(absPath: string): Promise<string[] | undefined>;
  /** Polled between files; returning true stops the crawl early. */
  cancelled?(): boolean;
}

export type RefKind =
  | 'topicref'
  | 'mapref'
  | 'keydef'
  | 'image'
  | 'xref'
  | 'link'
  | 'conref'
  | 'object'
  | 'data'
  | 'other';

export interface Location {
  file: string; // absolute path
  line: number; // 1-based
}

export interface Reference extends Location {
  kind: RefKind;
  /** The href/conref/data value as written. */
  href: string;
  /** Absolute target path (fragment stripped); undefined for URLs. */
  target?: string;
  /** External/peer scope or an absolute URL. */
  remote: boolean;
  /** Whether the target is a DITA file (topic or map) rather than a binary/other resource. */
  dita: boolean;
  /** True for a topicref that is resource-only (or inside a resource-only branch). */
  resourceOnly: boolean;
  copyTo?: string;
  /** Where the reference sits: inside a relationship table. */
  inReltable: boolean;
  /** The element that carries the reference. */
  tag: string;
  /** The @scope attribute as written, if any. */
  scope?: string;
  /** The @format attribute as written, if any. */
  format?: string;
  /** True when the reference was written in a map (topicref, mapref, keydef). */
  inMap: boolean;
  /** True for a reference made by resolving a @keyref: its @format is not the element's own. */
  viaKeyref?: boolean;
}

export interface KeyDef extends Location {
  key: string; // bare key name
  /** Fully-qualified names this definition answers to (scope prefixes). */
  qualified: string[];
  /** The key scope chain this definition lives in ('' = root scope); the first of `scopeIds`. */
  scopeId: string;
  /**
   * Every scope chain this definition lives in. More than one when a `keyscope`
   * lists several names ("a b") on it or an ancestor: the key then belongs to all of them.
   */
  scopeIds: string[];
  href?: string;
  target?: string;
  /** The @format attribute on the defining element, if any. */
  format?: string;
}

export interface KeyUse extends Location {
  /** Bare key name (the part before any `/`). */
  key: string;
  /** The attribute value as written (a keyref may carry a `/elementid`). */
  value?: string;
  /** Which attribute used the key. Only `keyref` is resolved to a target. */
  attribute?: 'keyref' | 'conkeyref';
  /** The element that used the key. */
  tag?: string;
  /** For a keyref on a resource reference: the kind the element implies. */
  kind?: RefKind;
  /** Key scopes in effect where the key was used (map keyrefs only). */
  scopeChains?: string[][];
  /** Why the key name cannot be parsed, when it cannot (Oxygen's invalid.keyref.syntax.1/.3). */
  keySyntax?: 'slash' | 'whitespace';
  resourceOnly?: boolean;
  inReltable?: boolean;
  copyTo?: string;
  /**
   * The reference made from the element's own @href. DITA uses it as a fallback
   * only when the key is undefined, so it is dropped once the key resolves.
   */
  fallbackRef?: Reference;
}

/** A keyref that matches no key definition (Oxygen's `dmv.undef.key`). */
export interface UndefinedKey extends Location {
  key: string;
  value: string;
}

export interface TopicId extends Location {
  id: string;
  topicFile: string;
}

/** An @id attribute, on any element of a crawled map or topic (id-syntax check). */
export interface IdUse extends Location {
  id: string;
  tag: string;
}

/** A map reference whose target is already being crawled: a cycle (Oxygen's dmv.recursive.ref). */
export interface RecursiveRef extends Location {
  /** The map reference as written. */
  href: string;
}

/** A topicref/keydef that sits inside a reference to a map, where DITA ignores it. */
export interface IgnoredMaprefContent extends Location {
  tag: string;
}

/** A map element that carries, or needs, a navigation title. */
export interface MapEntry extends Location {
  tag: string;
  href?: string;
  keyref?: string;
  scope?: string;
  navTitle: boolean;
}

export interface ReusableCandidate extends Location {
  id: string;
  tag: string;
  topicFile: string;
}

export interface ConrefUse {
  /** Absolute path of the conref target file (own file for `#…`), if resolvable. */
  targetFile?: string;
  /** Last fragment segment: the element id for `#topic/elem`, the topic id for a bare `#topic`. */
  targetId?: string;
  /** The topic-id segment (the part right after `#`), if the value carried a fragment. */
  topicId?: string;
  /** The element-id segment after the topic id (`#topic/elem`), if any. */
  elemId?: string;
  /** Where the conref is written, so an unresolvable topic id can be reported on it. */
  sourceFile?: string;
  sourceLine?: number;
  /** Key name for a conkeyref. */
  key?: string;
}

export interface TableInfo extends Location {
  kind: 'cals' | 'simple';
  /** Human-readable problems found in this table's layout. */
  problems: Array<{ line: number; msg: Msg }>;
}

export interface ProfilingConflict extends Location {
  attribute: string;
  values: string[];
  ancestorValues: string[];
  tag: string;
}

export interface ProfilingValueUse extends Location {
  attribute: string;
  values: string[];
  tag: string;
}

export interface FileIssue extends Location {
  severity: 'error' | 'warning';
  msg: Msg;
  /** True for DITA-structure findings (root element, id, title); false for XML errors. */
  structural: boolean;
}

export interface CrawlOptions {
  /** DITAVAL filters to apply; content excluded by them is not crawled. */
  filter?: DitavalFilter;
  /** Attribute names treated as profiling attributes (in addition to the DITA built-ins). */
  extraProfilingAttributes?: string[];
}

export interface CrawlResult {
  rootMaps: string[];
  maps: Set<string>; // every map file reached (incl. root maps)
  topics: Set<string>; // every DITA topic file reached
  refs: Reference[];
  keyDefs: KeyDef[];
  keyUses: KeyUse[];
  undefinedKeys: UndefinedKey[];
  topicIds: TopicId[];
  /** Every @id attribute seen, in maps and topics. */
  ids: IdUse[];
  recursiveRefs: RecursiveRef[];
  ignoredMaprefContent: IgnoredMaprefContent[];
  mapEntries: MapEntry[];
  reusable: ReusableCandidate[];
  conrefUses: ConrefUse[];
  tables: TableInfo[];
  profilingConflicts: ProfilingConflict[];
  profilingValues: ProfilingValueUse[];
  fileIssues: FileIssue[];
  /** Normalized path -> original path, for every file the crawl opened. */
  visited: Map<string, string>;
  cancelled: boolean;
}

// ── XML scan ────────────────────────────────────────────────────────────

interface XNode {
  tag: string;
  attrs: Record<string, string>;
  line: number; // 1-based
  children: XNode[];
  parent?: XNode;
  text: string; // direct text (for <title> presence etc.)
}

const PROFILING_ATTRS = ['audience', 'platform', 'product', 'otherprops', 'props', 'rev'];

/** Parses XML with sax into a light tree carrying 1-based line numbers. */
export function scanXml(raw: string): { root?: XNode; error?: { line: number; message: string } } {
  const pre = preprocessEntities(raw);
  // stripDoctype can drop newlines (multi-line internal subset); keep line
  // numbers aligned with the file the user sees.
  const drift = Math.max(0, countNewlines(raw) - countNewlines(pre));
  const parser = sax.parser(true, { trim: false, normalize: false, position: true });
  let root: XNode | undefined;
  let cur: XNode | undefined;
  let error: { line: number; message: string } | undefined;
  parser.onerror = (err) => {
    error = { line: parser.line + 1 + drift, message: err.message.split('\n')[0] };
    // sax keeps going after error() unless we stop feeding it.
    parser.error = null as unknown as Error;
    throw err;
  };
  parser.onopentag = (node) => {
    const n: XNode = {
      tag: node.name,
      attrs: node.attributes as Record<string, string>,
      line: parser.line + 1 + drift,
      children: [],
      parent: cur,
      text: '',
    };
    if (cur) cur.children.push(n);
    else root = n;
    cur = n;
  };
  parser.onclosetag = () => {
    cur = cur?.parent;
  };
  parser.ontext = (t) => {
    if (cur) cur.text += t;
  };
  try {
    parser.write(pre).close();
  } catch {
    return { root, error };
  }
  if (!root) return { error: { line: 1, message: 'No root element found' } };
  return { root };
}

function countNewlines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

/** Removes (in place) every descendant the DITAVAL filter would drop from the output. */
function pruneExcluded(n: XNode, filter: DitavalFilter): void {
  n.children = n.children.filter((c) => !filter.excludes(c.attrs));
  for (const c of n.children) pruneExcluded(c, filter);
}

function* walk(n: XNode): Generator<XNode> {
  yield n;
  for (const c of n.children) yield* walk(c);
}

const URL_RE = /^[a-z][a-z0-9+.-]*:/i;

function isDitaHref(pathPart: string, format: string | undefined): boolean {
  if (format) return format === 'dita' || format === 'ditamap';
  return /\.(dita|xml|ditamap)$/i.test(pathPart);
}

function classOf(n: XNode): string {
  return n.attrs['class'] ?? '';
}

function isMapTag(n: XNode): boolean {
  const c = classOf(n);
  return /\bmap\/(topicref|keydef|mapref|topichead|topicgroup)\b/.test(c) || TOPICREF_TAGS.has(n.tag);
}

const TOPICREF_TAGS = new Set([
  'topicref', 'keydef', 'mapref', 'topichead', 'topicgroup', 'chapter', 'part', 'appendix',
  'appendices', 'preface', 'glossarylist', 'notices', 'dedication', 'colophon', 'abbrevlist',
  'bibliolist', 'booklist', 'figurelist', 'indexlist', 'toc', 'tablelist', 'trademarklist',
  'amendments', 'draftintro', 'abstract', 'frontmatter', 'backmatter', 'glossentry', 'glossref',
  'topicset', 'topicsetref', 'anchor', 'anchorref',
]);

// ── Crawl ───────────────────────────────────────────────────────────────

export async function crawlMaps(rootMaps: string[], host: CrawlHost, opts: CrawlOptions = {}): Promise<CrawlResult> {
  const result: CrawlResult = {
    rootMaps: rootMaps.map((m) => resolve(m)),
    maps: new Set(),
    topics: new Set(),
    refs: [],
    keyDefs: [],
    keyUses: [],
    undefinedKeys: [],
    topicIds: [],
    ids: [],
    recursiveRefs: [],
    ignoredMaprefContent: [],
    mapEntries: [],
    reusable: [],
    conrefUses: [],
    tables: [],
    profilingConflicts: [],
    profilingValues: [],
    fileIssues: [],
    visited: new Map(),
    cancelled: false,
  };
  const norm = (p: string) => normalizePathForCompare(p, host.platform);
  const seenMaps = new Set<string>();
  const seenTopics = new Set<string>();
  const profilingAttrs = [...PROFILING_ATTRS, ...(opts.extraProfilingAttributes ?? [])];
  const topicQueue: Array<{ path: string; inherited: Map<string, string[]> }> = [];

  /** Reads and scans a file, recording read/parse problems as file issues. */
  async function load(path: string, from?: Location, prune = false): Promise<XNode | undefined> {
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
    if (prune && opts.filter && scanned.root) pruneExcluded(scanned.root, opts.filter);
    return scanned.root;
  }

  function addRef(
    file: string,
    node: XNode,
    kind: RefKind,
    href: string,
    extra: { resourceOnly?: boolean; inReltable?: boolean; inMap?: boolean } = {},
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
      inMap: !!extra.inMap,
    };
    if (!remote && !pathPart) ref.target = undefined; // "#id" -- same-file fragment
    result.refs.push(ref);
    return ref;
  }

  // ── Maps ──
  async function crawlMap(mapPath: string, chain: string[], from?: Location): Promise<void> {
    const key = norm(mapPath);
    if (seenMaps.has(key)) return;
    seenMaps.add(key);
    const root = await load(mapPath, from);
    if (!root) return;
    result.maps.add(mapPath);
    const rootId = root.attrs['id'];
    if (rootId) result.ids.push({ file: mapPath, line: root.line, id: rootId, tag: root.tag });
    const isMapRoot = isMapRootNode(root);
    // A topic read as a map (a @format mismatch) is reported by the reference check,
    // not as a structural problem of the target; only a root that is neither is a warning.
    if (!isMapRoot && !isTopicElement(root)) {
      result.fileIssues.push({
        file: mapPath, line: root.line, severity: 'warning',
        msg: msg('val.notMap', root.tag), structural: true,
      });
    }
    const ctx: MapCtx = { file: mapPath, scopeChains: [[]], resourceOnly: false, inReltable: false, profile: new Map() };
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
  }

  async function walkMapNode(n: XNode, ctx: MapCtx, chain: string[]): Promise<void> {
    if (host.cancelled?.()) { result.cancelled = true; return; }
    // Branch filtering
    if (opts.filter && opts.filter.excludes(n.attrs)) return;

    const tag = n.tag;
    const id = n.attrs['id'];
    if (id) result.ids.push({ file: ctx.file, line: n.line, id, tag });
    if (tag === 'topichead' || TOPICREF_TAGS.has(tag)) {
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
    if (keyref) {
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
    const cascaded = new Map(ctx.profile);
    if (isMapTag(n)) {
      for (const a of profilingAttrs) {
        const v = n.attrs[a];
        if (v === undefined) continue;
        const values = splitValues(v);
        if (values.length === 0) continue;
        result.profilingValues.push({ file: ctx.file, line: n.line, attribute: a, values, tag });
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
        const def: KeyDef = {
          file: ctx.file, line: n.line, key: name, qualified, scopeId: scopeIds[0], scopeIds, href,
          format: n.attrs['format'],
        };
        if (href && !URL_RE.test(href) && n.attrs['scope'] !== 'external') {
          const p = href.split('#')[0];
          if (p) def.target = resolve(dirname(ctx.file), decodeHrefPart(p));
        }
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
        const ref = addRef(ctx.file, n, kind, href, {
          resourceOnly: localCtx.resourceOnly, inReltable: localCtx.inReltable, inMap: true,
        });
        if (mapKeyUse) mapKeyUse.fallbackRef = ref;
        if (ref.target && !ref.remote) {
          const tkey = norm(ref.target);
          if (kind === 'mapref') {
            // A target already on the crawl path closes a cycle: report it where it
            // closes (Oxygen names the map that points back, not every member).
            if (chain.includes(tkey)) result.recursiveRefs.push({ file: ctx.file, line: n.line, href });
            else await crawlMap(ref.target, chain, ref);
            followedMap = true;
          } else if (ref.dita && !seenTopics.has(tkey) && n.attrs['format'] !== 'ditamap') {
            seenTopics.add(tkey);
            topicQueue.push({ path: ref.target, inherited: cascaded });
          }
        } else if (kind === 'mapref') {
          followedMap = true;
        }
      }
    }
    // The content of a reference to a map is ignored by DITA (dmv.ref.topic.inside.mapref).
    if (followedMap) {
      for (const c of n.children) {
        if (c.tag !== 'topicmeta' && (isMapTag(c) || TOPICREF_TAGS.has(c.tag))) {
          result.ignoredMaprefContent.push({ file: ctx.file, line: c.line, tag: c.tag });
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
    const root = await load(path, { file: path, line: 1 }, true);
    if (!root) {
      // A missing target is reported by the reference check; a parse error already recorded.
      return;
    }
    result.topics.add(path);
    const isTopic = isTopicElement(root);
    // A map read as a topic (a @format mismatch) is reported by the reference check.
    if (!isTopic && !isMapRootNode(root)) {
      result.fileIssues.push({
        file: path, line: root.line, severity: 'warning',
        msg: msg('val.notTopic', root.tag), structural: true,
      });
    }

    // Every @id, including reusable elements (id syntax); topic ids additionally
    // feed the duplicate-id and conref-target checks.
    for (const n of walk(root)) {
      const id = n.attrs['id'];
      if (id) result.ids.push({ file: path, line: n.line, id, tag: n.tag });
    }

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

    // Local-topic-only scan
    const usedElementIds = new Set<string>();
    for (const n of walk(root)) {
      for (const a of ['conref', 'conrefend', 'conkeyref']) {
        const v = n.attrs[a];
        if (!v) continue;
        if (a === 'conkeyref') {
          const key = v.trim().split('/')[0];
          result.keyUses.push({ file: path, line: n.line, key, value: v, attribute: 'conkeyref', tag: n.tag });
          result.conrefUses.push({ key, targetId: v.includes('/') ? v.split('/').pop() : undefined });
        } else if (a === 'conref') {
          const ref = addRef(path, n, 'conref', v);
          if (ref.dita && ref.target) {
            const ck = norm(ref.target);
            if (!seenTopics.has(ck) && !ref.target.toLowerCase().endsWith('.ditamap')) {
              seenTopics.add(ck);
              topicQueue.push({ path: ref.target, inherited: new Map() });
            }
          }
          const frag = v.includes('#') ? v.split('#')[1] : '';
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
          if (!ref.target && !ref.remote && frag) usedElementIds.add(frag.split('/').pop() ?? '');
        }
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

    // Reusable-element candidates: any element with an id that is not a topic/body/section container.
    for (const n of walk(root)) {
      const id = n.attrs['id'];
      if (!id || isTopicElement(n)) continue;
      result.reusable.push({ file: path, line: n.line, id, tag: n.tag, topicFile: path });
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
        const values = splitValues(v);
        if (values.length === 0) continue;
        result.profilingValues.push({ file: path, line: n.line, attribute: a, values, tag: n.tag });
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
  const keyIndex = new Map<string, KeyDef>();
  for (const def of result.keyDefs) {
    for (const q of def.qualified) if (!keyIndex.has(q)) keyIndex.set(q, def);
  }
  const droppedFallbacks = new Set<Reference>();
  for (const use of result.keyUses) {
    if (use.attribute !== 'keyref') continue;
    if (use.keySyntax) continue; // reported as invalid key syntax, not as an undefined key
    const def = resolveKeyUse(use, keyIndex);
    if (!def) {
      result.undefinedKeys.push({ file: use.file, line: use.line, key: use.key, value: use.value ?? use.key });
      continue;
    }
    // The key is defined, so the element's own @href is not used.
    if (use.fallbackRef) droppedFallbacks.add(use.fallbackRef);
    if (!def.target) continue; // a text-only key: defined, but no resource
    // Only elements that make a link (xref, image, topicref, ...) are references;
    // a <ph keyref> or <keyword keyref> merely borrows the key's text.
    if (!use.kind) continue;    const pathPart = (def.href ?? '').split('#')[0];
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
      viaKeyref: true,
    });
  }
  if (droppedFallbacks.size) result.refs = result.refs.filter((r) => !droppedFallbacks.has(r));
  return result;
}

/**
 * Resolves a keyref use against the key index: the most-qualified name first,
 * so a key inside a key scope wins over a same-named key at an outer scope
 * (DITA's nearest-scope precedence).
 */
function resolveKeyUse(use: KeyUse, index: ReadonlyMap<string, KeyDef>): KeyDef | undefined {
  const candidates = qualifiedNamesMulti(use.key, use.scopeChains ?? [[]]).reverse();
  for (const c of candidates) {
    const def = index.get(c);
    if (def) return def;
  }
  return undefined;
}

// ── helpers ─────────────────────────────────────────────────────────────

function splitValues(v: string): string[] {
  // Handles plain space-separated values and the "attr(group value)" grouping syntax.
  const out: string[] = [];
  const cleaned = v.replace(/[A-Za-z_][\w.-]*\(([^)]*)\)/g, (_m, inner: string) => ` ${inner} `);
  for (const t of cleaned.trim().split(/\s+/)) if (t) out.push(t);
  return out;
}

/** Why a key name cannot be parsed, if it cannot (Oxygen's invalid.keyref.syntax.1/.3). */
function keyrefSyntax(key: string): 'slash' | 'whitespace' | undefined {
  if (!key) return 'whitespace';
  if (key.split('/').length > 2) return 'slash';
  return /\s/.test(key) ? 'whitespace' : undefined;
}

/** Whether a map element carries a navigation title (a @navtitle or topicmeta/navtitle). */
function hasNavTitle(n: XNode): boolean {
  if (n.attrs['navtitle'] !== undefined) return true;
  return n.children.some((c) => c.tag === 'topicmeta' && c.children.some((t) => t.tag === 'navtitle'));
}

// qualifiedNames / qualifiedNamesMulti live in keySpace.ts (the preview's key
// lookup uses the same rule); re-exported so existing importers keep working.
export { qualifiedNames, qualifiedNamesMulti } from './keySpace';
