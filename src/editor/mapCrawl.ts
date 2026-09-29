// Reference crawler behind "Find Unreferenced Resources".
//
// Starting from one or more root maps it follows every reference it can see
// -- topicrefs, submaps, keydef hrefs, and inside topics: images, xrefs,
// conrefs, objects, links -- and records what it found, with file and line
// for each hit. unreferencedResources.ts compares that against the files on
// disk.
//
// Pure of the vscode module (file access is injected via CrawlHost), so the
// whole thing is unit-testable against an in-memory file system.

import sax from 'sax';
import { dirname, resolve } from 'path';
import { preprocessEntities } from '../parser/ditaParser';
import { decodeHrefPart } from './ditaRenderUtils';
import { normalizePathForCompare } from './mapReferenceTools';

export interface CrawlHost {
  /** Text of a file (unsaved editor text if any). Rejects when unreadable. */
  readFile(absPath: string): Promise<string>;
  exists(absPath: string): Promise<boolean>;
  platform: NodeJS.Platform;
  /** Polled between files; returning true stops the crawl early. */
  cancelled?(): boolean;
}

export type RefKind = 'topicref' | 'mapref' | 'keydef' | 'image' | 'xref' | 'link' | 'conref' | 'object' | 'data' | 'other';

export interface Location {
  file: string; // absolute path
  line: number; // 1-based
}

export interface Reference extends Location {
  kind: RefKind;
  /** The href/conref/data value as written. */
  href: string;
  /** Absolute target path (fragment stripped); undefined for URLs and same-file fragments. */
  target?: string;
  /** External/peer scope or an absolute URL. */
  remote: boolean;
  /** Whether the target is a DITA file (topic or map) rather than a binary/other resource. */
  dita: boolean;
}

export interface KeyDef extends Location {
  key: string;
  href?: string;
  /** Absolute path the definition's href points at, if local. */
  target?: string;
}

export interface FileIssue extends Location {
  message: string;
}

export interface CrawlResult {
  rootMaps: string[];
  maps: Set<string>; // every map file reached (incl. root maps)
  topics: Set<string>; // every DITA topic file reached
  refs: Reference[];
  keyDefs: KeyDef[];
  /** Files that could not be read or parsed; what they reference is unknown. */
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
}

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
    };
    if (cur) cur.children.push(n);
    else root = n;
    cur = n;
  };
  parser.onclosetag = () => {
    cur = cur?.parent;
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

const TOPICREF_TAGS = new Set([
  'topicref', 'keydef', 'mapref', 'topichead', 'topicgroup', 'chapter', 'part', 'appendix',
  'appendices', 'preface', 'glossarylist', 'notices', 'dedication', 'colophon', 'abbrevlist',
  'bibliolist', 'booklist', 'figurelist', 'indexlist', 'toc', 'tablelist', 'trademarklist',
  'amendments', 'draftintro', 'abstract', 'frontmatter', 'backmatter', 'glossentry', 'glossref',
  'topicset', 'topicsetref', 'anchor', 'anchorref',
]);

function isMapTag(n: XNode): boolean {
  return /\bmap\/(topicref|keydef|mapref|topichead|topicgroup)\b/.test(classOf(n)) || TOPICREF_TAGS.has(n.tag);
}

function isMapHref(n: XNode, href: string): boolean {
  const p = href.split('#')[0].toLowerCase();
  return (
    n.attrs['format'] === 'ditamap' ||
    (p.endsWith('.ditamap') && !n.attrs['format']) ||
    /\bmap\/mapref\b/.test(classOf(n)) ||
    n.tag === 'mapref'
  );
}

/** Elements in topics whose href/data attribute points at a resource. */
function hrefAttrKind(n: XNode): RefKind | undefined {
  switch (n.tag) {
    case 'image': return 'image';
    case 'xref': return 'xref';
    case 'link': return 'link';
    case 'object': return 'object';
    case 'data': case 'data-about': return 'data';
    case 'lq': case 'source': case 'audio': case 'video': case 'media-source': return 'other';
    default: return undefined;
  }
}

// ── Crawl ───────────────────────────────────────────────────────────────

export async function crawlMaps(rootMaps: string[], host: CrawlHost): Promise<CrawlResult> {
  const result: CrawlResult = {
    rootMaps: rootMaps.map((m) => resolve(m)),
    maps: new Set(),
    topics: new Set(),
    refs: [],
    keyDefs: [],
    fileIssues: [],
    visited: new Map(),
    cancelled: false,
  };
  const norm = (p: string) => normalizePathForCompare(p, host.platform);
  const seenMaps = new Set<string>();
  const seenTopics = new Set<string>();
  const topicQueue: string[] = [];

  /** Reads and scans a file, recording read/parse problems as file issues. */
  async function load(path: string, quietIfMissing: boolean): Promise<XNode | undefined> {
    if (host.cancelled?.()) {
      result.cancelled = true;
      return undefined;
    }
    result.visited.set(norm(path), path);
    let text: string;
    try {
      text = await host.readFile(path);
    } catch {
      if (!quietIfMissing) result.fileIssues.push({ file: path, line: 1, message: 'File could not be read' });
      return undefined;
    }
    const scanned = scanXml(text);
    if (scanned.error) {
      result.fileIssues.push({ file: path, line: scanned.error.line, message: scanned.error.message });
      return undefined;
    }
    return scanned.root;
  }

  function addRef(file: string, node: XNode, kind: RefKind, href: string): Reference {
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
    };
    result.refs.push(ref);
    return ref;
  }

  async function crawlMap(mapPath: string, chain: string[]): Promise<void> {
    const key = norm(mapPath);
    if (seenMaps.has(key)) return;
    seenMaps.add(key);
    // A root map that can't be read is worth reporting; a submap that is
    // simply missing is a broken reference, not a file problem.
    const root = await load(mapPath, chain.length > 0);
    if (!root) return;
    result.maps.add(mapPath);
    for (const c of root.children) await walkMapNode(c, mapPath, chain.concat(key));
  }

  async function walkMapNode(n: XNode, file: string, chain: string[]): Promise<void> {
    if (host.cancelled?.()) {
      result.cancelled = true;
      return;
    }
    const href = n.attrs['href'];
    const keys = n.attrs['keys'];
    const isKeydef = n.tag === 'keydef' || /\bmap\/keydef\b/.test(classOf(n));

    if (keys) {
      for (const name of keys.trim().split(/\s+/).filter(Boolean)) {
        const def: KeyDef = { file, line: n.line, key: name, href };
        if (href && !URL_RE.test(href) && n.attrs['scope'] !== 'external') {
          const p = href.split('#')[0];
          if (p) def.target = resolve(dirname(file), decodeHrefPart(p));
        }
        result.keyDefs.push(def);
      }
    }

    if (href !== undefined && href !== '' && (isMapTag(n) || n.tag === 'linkref')) {
      const kind: RefKind = isKeydef ? 'keydef' : isMapHref(n, href) ? 'mapref' : 'topicref';
      const ref = addRef(file, n, kind, href);
      if (ref.target && !ref.remote) {
        const tkey = norm(ref.target);
        if (kind === 'mapref') {
          if (!chain.includes(tkey)) await crawlMap(ref.target, chain);
        } else if (ref.dita && !seenTopics.has(tkey) && n.attrs['format'] !== 'ditamap') {
          seenTopics.add(tkey);
          topicQueue.push(ref.target);
        }
      }
    }
    for (const c of n.children) await walkMapNode(c, file, chain);
  }

  async function crawlTopic(path: string): Promise<void> {
    const root = await load(path, true);
    if (!root) return;
    result.topics.add(path);
    for (const n of walk(root)) {
      const conref = n.attrs['conref'];
      if (conref) queueIfDita(addRef(path, n, 'conref', conref));
      const kind = hrefAttrKind(n);
      if (!kind) continue;
      for (const a of ['href', 'data']) {
        const v = n.attrs[a];
        if (!v || (a === 'data' && n.tag !== 'object')) continue;
        queueIfDita(addRef(path, n, kind, v));
      }
    }
  }

  function queueIfDita(ref: Reference): void {
    if (!ref.dita || !ref.target || ref.target.toLowerCase().endsWith('.ditamap')) return;
    const tkey = norm(ref.target);
    if (seenTopics.has(tkey)) return;
    seenTopics.add(tkey);
    topicQueue.push(ref.target);
  }

  for (const m of result.rootMaps) {
    await crawlMap(m, []);
    if (result.cancelled) break;
  }
  while (topicQueue.length && !result.cancelled) await crawlTopic(topicQueue.shift()!);
  return result;
}
