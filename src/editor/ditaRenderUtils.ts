import { existsSync, readFileSync, openSync, readSync, closeSync, statSync } from 'fs';
import { resolve, dirname, relative, isAbsolute, extname, normalize } from 'path';
import { DitaNode } from '../parser/domTypes';
import { parseDita, parseDitamap, preprocessEntities } from '../parser/ditaParser';
import { renderDocument } from '../render/renderer';
import type { MapEntry } from '../render/mapTypeMap';
import type { BookPart } from './bookPatch';

// ── Image dimensions (for reserving layout space before the image loads) ──
//
// <img loading="lazy"> with no width/height reserves zero space until the
// browser actually decodes the file, then snaps the surrounding content
// down to make room -- barely noticeable for a single image in the topic
// preview, but Book mode composites many topics' worth of images into one
// long page, so scrolling through it means repeatedly landing on a fresh
// batch of not-yet-loaded images and watching everything below them lurch
// as each one finally loads. Reading real width/height from the file
// (only the header, not the whole image -- a bounded 64KB read handles
// every format below even for a multi-MB JPEG with a large EXIF/ICC
// profile before its SOF marker) lets width/height attributes go on the
// <img> tag, which combined with this project's existing img{height:auto}
// makes the browser reserve the correct *aspect ratio* box immediately,
// still scaling responsively via max-width -- not a fixed pixel size.
// This only fills a gap: an explicit @width/@height on the DITA <image>
// element itself always wins (see the image renderer in baseTypeMap.ts).

const IMAGE_HEADER_READ_BYTES = 65536;

function readHeaderBytes(filePath: string, maxBytes: number): Buffer | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buf, 0, maxBytes, 0);
    return buf.subarray(0, bytesRead);
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* already closed / never opened */ }
    }
  }
}

function readPngDimensions(buf: Buffer): { width: number; height: number } | undefined {
  // 8-byte signature, then a 4-byte chunk length + "IHDR" + width (4B BE) + height (4B BE)
  if (buf.length < 24) return undefined;
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) return undefined;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return undefined;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function readGifDimensions(buf: Buffer): { width: number; height: number } | undefined {
  if (buf.length < 10) return undefined;
  const sig = buf.toString('ascii', 0, 6);
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return undefined;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

function readBmpDimensions(buf: Buffer): { width: number; height: number } | undefined {
  if (buf.length < 26) return undefined;
  if (buf.toString('ascii', 0, 2) !== 'BM') return undefined;
  const width = buf.readInt32LE(18);
  const height = buf.readInt32LE(22);
  // A negative height means a top-down (rather than the default
  // bottom-up) bitmap -- the magnitude is still the real pixel height.
  return { width: Math.abs(width), height: Math.abs(height) };
}

function readJpegDimensions(buf: Buffer): { width: number; height: number } | undefined {
  if (buf.length < 4 || buf.readUInt16BE(0) !== 0xffd8) return undefined;
  let offset = 2;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) { offset++; continue; }
    const marker = buf[offset + 1];
    // Markers with no payload to skip over
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (offset + 4 > buf.length) break;
    const segmentLength = buf.readUInt16BE(offset + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (offset + 9 > buf.length) return undefined; // truncated read -- header didn't fit in what we sampled
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    if (marker === 0xda) return undefined; // Start of Scan reached with no SOF found
    offset += 2 + segmentLength;
  }
  return undefined;
}

function readSvgDimensions(buf: Buffer): { width: number; height: number } | undefined {
  const text = buf.toString('utf-8');
  const svgTagMatch = text.match(/<svg\b[^>]*>/);
  if (!svgTagMatch) return undefined;
  const tag = svgTagMatch[0];
  const widthMatch = tag.match(/\bwidth="([\d.]+)(?:px)?"/);
  const heightMatch = tag.match(/\bheight="([\d.]+)(?:px)?"/);
  if (widthMatch && heightMatch) {
    const width = parseFloat(widthMatch[1]);
    const height = parseFloat(heightMatch[1]);
    if (width > 0 && height > 0) return { width, height };
  }
  // Percentage/unitless width+height, or neither present -- fall back to
  // viewBox, which every real-world SVG has anyway and gives an aspect
  // ratio even when absolute pixel dimensions weren't authored at all.
  const viewBoxMatch = tag.match(/\bviewBox="\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)\s*"/);
  if (viewBoxMatch) {
    const width = parseFloat(viewBoxMatch[1]);
    const height = parseFloat(viewBoxMatch[2]);
    if (width > 0 && height > 0) return { width, height };
  }
  return undefined;
}

const IMAGE_DIMENSION_READERS: Record<string, (buf: Buffer) => { width: number; height: number } | undefined> = {
  '.png': readPngDimensions,
  '.gif': readGifDimensions,
  '.bmp': readBmpDimensions,
  '.jpg': readJpegDimensions,
  '.jpeg': readJpegDimensions,
  '.svg': readSvgDimensions,
};

/**
 * Reads just enough of an image file to determine its natural pixel
 * dimensions, without loading or decoding the whole file. Returns
 * undefined for anything unreadable, unrecognized, or corrupt -- callers
 * treat that as "no dimensions available" and fall back to the previous
 * behavior (no width/height reserved), never an error.
 *
 * Cached by path + mtime: every source edit re-renders the whole topic
 * (see postContentUpdate in DitaViewerProvider.ts/MapViewerProvider.ts),
 * which calls this again for every image in it regardless of whether that
 * particular image had anything to do with what was just typed. A cheap
 * stat() to check mtime, versus re-opening and re-parsing the header, is
 * the difference that matters for a topic with a lot of images -- the
 * common case is the same unchanged images on every keystroke, not new
 * ones. Bounded by IMAGE_DIMENSIONS_CACHE_MAX with oldest-unused-first
 * eviction (a cache hit re-inserts the entry, so it counts as recently
 * used), keeping long sessions that preview many distinct images from
 * growing the Map without limit -- entries are tiny (a path plus two
 * numbers), but the project's rule is that every cache stays bounded and
 * clearable, and this one is cleared alongside the rest on deactivation.
 */
const imageDimensionsCache = new Map<string, { mtimeMs: number; dimensions: { width: number; height: number } | undefined }>();
// One entry per distinct image file ever previewed; bound it the same way
// keyMapCache is bounded in DitaViewerProvider.ts.
export const IMAGE_DIMENSIONS_CACHE_MAX = 1000;

export function clearImageDimensionsCache(): void {
  imageDimensionsCache.clear();
}

export function readImageDimensions(filePath: string): { width: number; height: number } | undefined {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(filePath).mtimeMs;
  } catch {
    // Not statable (doesn't exist, permissions, ...) -- nothing to read,
    // and any previous cache entry for this path is now stale.
    imageDimensionsCache.delete(filePath);
    return undefined;
  }

  const cached = imageDimensionsCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) {
    // Re-insert so a cache hit keeps the entry from being the oldest
    // (and therefore first-evicted) candidate.
    imageDimensionsCache.delete(filePath);
    imageDimensionsCache.set(filePath, cached);
    return cached.dimensions;
  }

  const reader = IMAGE_DIMENSION_READERS[extname(filePath).toLowerCase()];
  let dimensions: { width: number; height: number } | undefined;
  if (reader) {
    const buf = readHeaderBytes(filePath, IMAGE_HEADER_READ_BYTES);
    if (buf) {
      try {
        dimensions = reader(buf);
      } catch {
        dimensions = undefined;
      }
    }
  }
  if (imageDimensionsCache.size >= IMAGE_DIMENSIONS_CACHE_MAX) {
    const oldest = imageDimensionsCache.keys().next().value;
    if (oldest !== undefined) imageDimensionsCache.delete(oldest);
  }
  imageDimensionsCache.set(filePath, { mtimeMs, dimensions });
  return dimensions;
}

// ── Text extraction ──

export function collectText(node: DitaNode): string {
  if (node.type === 'text') return node.text || '';
  return (node.children || []).map(collectText).join('');
}

// ── Title map (id → title text for xref) ──

export function buildTitleMap(root: DitaNode): Map<string, string> {
  const map = new Map<string, string>();
  function walk(node: DitaNode) {
    if (node.type === 'element') {
      const id = node.attributes?.id;
      if (id) {
        const titleChild = (node.children || []).find(
          (c) => c.type === 'element' && c.baseType === 'topic/title',
        );
        if (titleChild) {
          map.set(id, collectText(titleChild));
        }
      }
      for (const child of node.children || []) walk(child);
    }
  }
  walk(root);
  return map;
}

// ── Cross-file helpers (conref + title resolver share file cache) ──

export function makeFileCache(docDir: string) {
  const cache = new Map<string, DitaNode | undefined>();

  function loadFile(filePath: string): DitaNode | undefined {
    const absPath = resolve(docDir, decodeHrefPart(filePath));
    if (cache.has(absPath)) return cache.get(absPath);
    if (!existsSync(absPath)) { cache.set(absPath, undefined); return undefined; }
    try {
      const content = readFileSync(absPath, 'utf-8');
      const doc = parseDita(preprocessEntities(content));
      cache.set(absPath, doc.root);
      return doc.root;
    } catch {
      cache.set(absPath, undefined);
      return undefined;
    }
  }

  function findElementById(root: DitaNode, targetId: string): DitaNode | undefined {
    if (root.attributes?.id === targetId) return root;
    for (const child of root.children || []) {
      const found = findElementById(child, targetId);
      if (found) return found;
    }
    return undefined;
  }

  function findTitleOfElement(root: DitaNode, elementId: string): string | undefined {
    const el = findElementById(root, elementId);
    if (!el) return undefined;
    const titleChild = (el.children || []).find(
      (c) => c.type === 'element' && c.baseType === 'topic/title',
    );
    if (!titleChild) return undefined;
    return collectText(titleChild);
  }

  /**
   * Every absolute path this cache was asked for, including ones that turned
   * out not to exist (those are memoized as undefined). Callers use it as the
   * dependency set of a render: rendered HTML can only be reused for as long
   * as none of these files changes. A missing file has to be reported as
   * carefully as a present one, since creating it later is exactly the kind
   * of change that must invalidate.
   */
  function touchedFiles(): string[] {
    return [...cache.keys()];
  }

  return { loadFile, findElementById, findTitleOfElement, touchedFiles };
}

export function makeConrefResolver(
  docDir: string,
  ownRoot?: DitaNode,
  sharedCache?: ReturnType<typeof makeFileCache>,
): (conref: string) => DitaNode | undefined {
  const cache = sharedCache ?? makeFileCache(docDir);

  return (conref: string): DitaNode | undefined => {
    const hashIdx = conref.indexOf('#');
    if (hashIdx < 0) return undefined;
    const filePath = conref.substring(0, hashIdx);
    const idPart = conref.substring(hashIdx + 1);
    const parts = idPart.split('/');
    const elementId = parts.length > 1 ? parts[1] : parts[0];
    if (!elementId) return undefined;

    // No file path before "#" -- a same-document reference, e.g.
    // conref="#noteId" or the "#./noteId" shorthand some authors use
    // (treating the current file as if it were "./" of itself). docDir on
    // its own resolves to a *directory*, not a file, so handing an empty
    // filePath to loadFile always failed here: existsSync passed (the
    // directory exists), but reading a directory as a file then threw and
    // got silently cached as "not found". Search the document already
    // being rendered instead of touching the filesystem at all.
    if (!filePath) {
      return ownRoot ? cache.findElementById(ownRoot, elementId) : undefined;
    }

    const root = cache.loadFile(filePath);
    if (!root) return undefined;
    const el = cache.findElementById(root, elementId);
    if (!el) return undefined;
    // Return the entire target element so its tag/baseType is preserved.
    // resolveConrefForNode in the renderer decides whether to replace just
    // the children (same-type conref) or the entire element (cross-type).
    return el;
  };
}

// conrefend extends a conref reference from a single element to a run of
// elements: everything from the conref target through the conrefend target,
// inclusive, in source-document order. Per the DITA spec this only applies
// when both ids resolve to elements that are siblings under the same
// parent — Oxygen's own conrefend support has the same restriction — so
// this returns undefined (letting the caller fall back to normal
// single-target conref handling) rather than guessing at some other
// relationship when that's not the case.
export function makeConrefRangeResolver(
  docDir: string,
  ownRoot?: DitaNode,
  sharedCache?: ReturnType<typeof makeFileCache>,
): (conref: string, conrefend: string) => DitaNode[] | undefined {
  const cache = sharedCache ?? makeFileCache(docDir);

  function resolveRef(ref: string): { root: DitaNode; id: string } | undefined {
    const hashIdx = ref.indexOf('#');
    if (hashIdx < 0) return undefined;
    const filePath = ref.substring(0, hashIdx);
    // Strip the "./" same-document marker before splitting on "/" so a
    // topic-scoped same-document range (e.g. "#./topicId/elementId") lands
    // on the real topic/element pair instead of misreading "." as the
    // topic id and folding the rest of the fragment into a single
    // (unmatchable) id.
    const idPart = ref.substring(hashIdx + 1).replace(/^\.\/+/, '');
    const parts = idPart.split('/');
    const id = parts.length > 1 ? parts[1] : parts[0];

    // No file path before "#" -- a same-document reference, same as the
    // single-target makeConrefResolver above. docDir on its own resolves
    // to a *directory*, not a file, so handing an empty filePath to
    // loadFile always failed here the same way: existsSync passed, but
    // reading a directory as a file then threw and got silently cached as
    // "not found". Search the document already being rendered instead of
    // touching the filesystem at all.
    if (!filePath) {
      if (!ownRoot) return undefined;
      return { root: ownRoot, id };
    }

    const root = cache.loadFile(filePath);
    if (!root) return undefined;
    return { root, id };
  }

  function findWithParent(node: DitaNode, targetId: string, parent: DitaNode | undefined): { el: DitaNode; parent: DitaNode } | undefined {
    if (node.attributes?.id === targetId && parent) return { el: node, parent };
    for (const child of node.children || []) {
      const found = findWithParent(child, targetId, node);
      if (found) return found;
    }
    return undefined;
  }

  return (conref: string, conrefend: string): DitaNode[] | undefined => {
    const start = resolveRef(conref);
    const end = resolveRef(conrefend);
    if (!start || !end) return undefined;

    const startFound = findWithParent(start.root, start.id, undefined);
    const endFound = findWithParent(end.root, end.id, undefined);
    if (!startFound || !endFound) return undefined;
    if (startFound.parent !== endFound.parent) return undefined;

    // Filter to element children before indexing: the parser preserves
    // whitespace-only text nodes between sibling elements (parsed with
    // trim:false), which would otherwise get swept into the slice and
    // thrown into the returned range as extra, attribute-less entries.
    // "Sibling" here means sibling *element*, matching what conref/
    // conrefend actually identify (elements with ids), not raw text runs.
    const siblings = (startFound.parent.children || []).filter((c) => c.type === 'element');
    const startIdx = siblings.indexOf(startFound.el);
    const endIdx = siblings.indexOf(endFound.el);
    if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) return undefined;

    return siblings.slice(startIdx, endIdx + 1);
  };
}

export function makeFileTitleResolver(
  docDir: string,
  sharedCache?: ReturnType<typeof makeFileCache>,
): (href: string) => string | undefined {
  const cache = sharedCache ?? makeFileCache(docDir);

  return (href: string): string | undefined => {
    // Only local relative references can be resolved from disk — never probe
    // the filesystem for external URLs or absolute paths (on Windows an
    // https:// href would otherwise resolve to a junk docDir\https:\ path).
    if (!href || URL_SCHEME_RE.test(href) || isAbsolute(href)) return undefined;
    const hashIdx = href.indexOf('#');
    if (hashIdx < 0) {
      // No fragment: only hrefs that look like DITA files get file-level
      // resolution — bare ids (unmatched local anchors that callers pass
      // through) must not be probed as filenames.
      if (!/\.(dita|xml)$/i.test(href)) return undefined;
      // Resolve the root topic's title from the file
      const root = cache.loadFile(href);
      if (!root) return undefined;
      const titleChild = (root.children || []).find(
        (c) => c.type === 'element' && c.baseType === 'topic/title',
      );
      return titleChild ? collectText(titleChild) : undefined;
    }
    const filePath = href.substring(0, hashIdx);
    const idPart = href.substring(hashIdx + 1);
    const topicId = idPart.split('/')[0];

    const root = cache.loadFile(filePath);
    if (!root) return undefined;
    return cache.findTitleOfElement(root, topicId);
  };
}

/**
 * Default topic-type labeler used when no localized labeler is injected.
 * Returns undefined for the generic `<topic>` root (every entry would
 * otherwise carry an identical "Topic" chip, which adds visual noise
 * without any information), and a simple capitalized tag name for any
 * specialization (`concept` -> "Concept", `task` -> "Task", ...). Callers
 * that want localized labels (MapViewerProvider in VS Code) inject their
 * own labeler; pure-function tests use this default to stay vscode-free.
 */
function defaultTopicTypeLabel(tagName: string): string | undefined {
  if (!tagName || tagName === 'topic') return undefined;
  return tagName.charAt(0).toUpperCase() + tagName.slice(1);
}

// Read at most this many bytes before falling back to the whole file --
// generous enough to clear an XML declaration, a handful of comments, and
// a DOCTYPE with a modest internal entity subset (the overwhelming
// majority of real DITA files), while still being a small, bounded read
// rather than the whole file.
const ROOT_TAG_SNIFF_BYTES = 8192;

// Matches one leading "preamble" construct at the start of a string: an
// XML declaration, a comment, a DOCTYPE (with or without a `[...]`
// internal subset), another processing instruction, or plain whitespace.
// sniffRootTagName below strips these one at a time until only the root
// element itself is left at the front of the string.
const PREAMBLE_CONSTRUCT_RE =
  /^(?:<\?xml[^>]*\?>|<!--[\s\S]*?-->|<!DOCTYPE[^[>]*(?:\[[\s\S]*?\])?\s*>|<\?[^>]*\?>|\s+)/;

/**
 * Extracts the root element's tag name from a string already known to
 * start (after any preamble) with that element -- the actual scan logic
 * sniffRootTagName below is built around; split out so it can be re-run
 * against progressively more of the file (the bounded chunk, then, only if
 * that wasn't enough, the whole file) without duplicating the preamble-
 * stripping loop.
 */
function extractRootTagName(content: string): string | undefined {
  let rest = content;
  // Realistically at most a handful of these constructs precede the root
  // element in any real document; the iteration cap is defensive against
  // a pathological input looping here, not a real limit on well-formed XML.
  for (let i = 0; i < 20; i++) {
    const m = PREAMBLE_CONSTRUCT_RE.exec(rest);
    if (!m || m[0].length === 0) break;
    rest = rest.slice(m[0].length);
  }
  const tagMatch = /^<([A-Za-z_][\w.-]*)/.exec(rest);
  return tagMatch ? tagMatch[1] : undefined;
}

/**
 * Reads just enough of a file to name its root element, without parsing it
 * -- makeFileTopicTypeResolver's whole reason to exist rather than reusing
 * makeFileTitleResolver's cache.loadFile(), which runs the file through
 * the full DITA parser (parseDita) to build a complete DOM. For a sidebar
 * chip that only needs one tag name, and that -- unlike the title fallback,
 * which only fires for entries the map itself left unnamed -- is
 * unconditional on every entry with an href, paying for a full parse of
 * every referenced topic on every docsite render would reintroduce exactly
 * the O(topics-in-book) cost docsite mode exists to avoid.
 *
 * Reads a bounded leading chunk first (ROOT_TAG_SNIFF_BYTES) and only
 * falls back to the whole file if the root tag wasn't found in it and
 * there was more file left to read -- a huge DOCTYPE internal subset is
 * rare, but should still resolve correctly rather than silently return
 * nothing.
 */
function sniffRootTagName(absPath: string): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(absPath, 'r');
    const buf = Buffer.alloc(ROOT_TAG_SNIFF_BYTES);
    const bytesRead = readSync(fd, buf, 0, ROOT_TAG_SNIFF_BYTES, 0);
    const chunk = buf.toString('utf-8', 0, bytesRead);
    const tag = extractRootTagName(chunk);
    if (tag !== undefined || bytesRead < ROOT_TAG_SNIFF_BYTES) return tag;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* already closed or never opened successfully */ }
    }
  }
  // The bounded chunk didn't contain the root tag and the file is bigger
  // than that chunk -- fall back to reading (not parsing) the whole thing.
  try {
    return extractRootTagName(readFileSync(absPath, 'utf-8'));
  } catch {
    return undefined;
  }
}

/**
 * Resolves a topic href to its root element's displayable type label
 * ("Concept", "Task", "Reference", ...) for the docsite-mode sidebar's
 * per-entry chip. Mirrors makeFileTitleResolver's guard rules exactly
 * (local relative .dita/.xml hrefs only, fragment stripped since the
 * sidebar links to files and a fragment points inside one) but resolves
 * the root tag via sniffRootTagName instead of a full parse -- see that
 * function's own comment for why that distinction matters here
 * specifically. Has its own small per-resolver cache (path -> tag name)
 * rather than sharing makeFileTitleResolver's file-cache: there is no DOM
 * to share, and a de-duplicated entries list (buildBookNavManifest's own
 * contract) means this cache mostly guards against a resolver being
 * handed to buildBookNavManifest more than once, not a hot path.
 */
export function makeFileTopicTypeResolver(
  docDir: string,
  labeler: (tagName: string) => string | undefined = defaultTopicTypeLabel,
): (href: string) => string | undefined {
  const cache = new Map<string, string | undefined>();

  return (href: string): string | undefined => {
    if (!href || URL_SCHEME_RE.test(href) || isAbsolute(href)) return undefined;
    const hashIdx = href.indexOf('#');
    // Same file-level-only resolution makeFileTitleResolver uses for its
    // no-fragment branch: a bare id is not a filename and must not be
    // probed as one, and a fragment points inside the current topic file
    // (whose type this resolver already reports for the file itself).
    const filePath = hashIdx < 0 ? href : href.substring(0, hashIdx);
    if (!filePath || !/\.(dita|xml)$/i.test(filePath)) return undefined;
    const absPath = resolve(docDir, decodeHrefPart(filePath));
    if (cache.has(absPath)) {
      const tagName = cache.get(absPath);
      return tagName === undefined ? undefined : labeler(tagName);
    }
    const tagName = sniffRootTagName(absPath);
    cache.set(absPath, tagName);
    return tagName === undefined ? undefined : labeler(tagName);
  };
}

// ── Search text matching ──
// Pure match engine shared between unit tests and the webview search overlay
// (injected there via findTextMatches.toString(), so it must stay fully
// self-contained — no references to other module-level bindings).
export function findTextMatches(
  text: string,
  term: string,
  useRegex: boolean,
  caseSensitive: boolean,
): { start: number; end: number }[] | null {
  const matches: { start: number; end: number }[] = [];
  // Plain-text terms are regex-escaped and run through the same regex path:
  // the 'i' flag handles case-insensitivity without toLowerCase(), whose
  // length-changing Unicode folds (İ, ẞ, …) would skew match offsets.
  const pattern = useRegex ? term : term.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&');
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
  } catch {
    return null;
  }
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m[0].length > 0) {
      matches.push({ start: m.index, end: m.index + m[0].length });
      // Cap per-node matches so degenerate patterns cannot flood the DOM
      if (matches.length >= 1000) break;
    } else {
      regex.lastIndex++;
    }
  }
  return matches;
}

// Decides which search marks have to be touched to move the '__current' class
// from one match to another. Shared between unit tests and the webview search
// overlay (injected there via planCurrentMarkMove.toString(), so it must stay
// fully self-contained — no references to other module-level bindings).
//
// The point of this existing at all: without it, moving the highlight one step
// means walking every mark in the document and calling classList.add or
// .remove on each, which in book mode is tens of thousands of style
// invalidations per arrow key. With it, the caller touches two. That trade is
// only sound for as long as exactly one mark carries the class and the caller
// knows which — hence `previous`, and hence the cases below where the two
// disagree.
//
// Returns indices into the caller's mark list; -1 means "nothing to do".
//   clear — the mark to remove '__current' from
//   set   — the mark to add it to
export function planCurrentMarkMove(
  previous: number,
  next: number,
  count: number,
): { clear: number; set: number } {
  // An index outside the list names no mark, and an empty list puts both of them
  // outside it, so these two guards are the entire decision -- there is no
  // separate no-marks case that has to be kept in step with them. That they are
  // reachable rather than theoretical: the match list shrinks whenever the
  // document changes under an open search bar, and the index tracked from the
  // previous, longer list outlives it by one update. Clearing "mark 7" of a
  // 3-mark list would be a silent no-op at best, so drop it and let the caller's
  // own bounds check be the second line of defence.
  const previousIsValid = previous >= 0 && previous < count;
  const nextIsValid = next >= 0 && next < count;
  // previous === next is the mark that already carries the class. Reporting it
  // as something to clear first would take the highlight off and put it back
  // on within one task — invisible normally, but a flash when the browser
  // happens to paint in between, and pointless work either way.
  const clear = previousIsValid && previous !== next ? previous : -1;
  return { clear, set: nextIsValid ? next : -1 };
}

// ── Default note labels ──
// Values follow DITA-OT's own strings-en-us.xml / strings-zh-cn.xml bundles
// (org.dita.base/xsl/common) so the preview matches what a real DITA-OT
// publish would show. Two intentional deviations from DITA-OT's exact
// casing, kept for visual consistency across the 13 note types in this
// project's own UI (DITA-OT itself is inconsistent here — only Caution and
// Danger are upper-cased there, Warning is not):
//   - Caution/Danger are title case here, not DITA-OT's "CAUTION"/"DANGER"
//   - zh-cn "Notice" is left untranslated even in DITA-OT's own bundle
//     (literally has a `<!--TODO:Notice-->` in the source); this project
//     already ships '注意' for it, kept as-is here.
// Covers the full DITA 1.3 note/@type enumeration (13 values); 'other' is
// handled separately via @othertype in the topic/note renderer, since its
// label isn't a fixed string.
//
// zh-cn deviations from a literal DITA-OT mirror (both fixes, not stylistic):
//   - attention/caution previously collided with notice/warning (all four
//     rendered '注意'/'警告'), making the two pairs visually indistinguishable
//     in the preview. attention -> '留意', caution -> '小心' to disambiguate;
//     '小心'/'警告'/'危险' also matches the conventional CN safety-signage
//     triad for Caution/Warning/Danger.
//   - trouble -> '故障排除' ("troubleshooting"), not '故障' ("fault"); the
//     DITA semantic is remedy guidance, which '故障' alone doesn't convey.

export const DEFAULT_NOTE_LABELS: Record<string, string> = {
  note: 'Note', notice: 'Notice', warning: 'Warning', danger: 'Danger',
  important: 'Important', tip: 'Tip', restriction: 'Restriction',
  attention: 'Attention', caution: 'Caution', fastpath: 'Fastpath',
  remember: 'Remember', trouble: 'Trouble',
};

export const ZH_NOTE_LABELS: Record<string, string> = {
  note: '注', notice: '注意', warning: '警告', danger: '危险',
  important: '重要', tip: '提示', restriction: '限制',
  attention: '留意', caution: '小心', fastpath: '捷径',
  remember: '切记', trouble: '故障排除',
};

export function detectNoteLabels(root: DitaNode, uiLanguage?: string): Record<string, string> {
  const lang = root.attributes?.['xml:lang'] || uiLanguage || '';
  return lang.startsWith('zh') ? ZH_NOTE_LABELS : DEFAULT_NOTE_LABELS;
}

/** Same xml:lang-first, uiLanguage-fallback resolution as detectNoteLabels,
 *  for the "Index" label shown in indexterm chip tooltips. Kept separate
 *  rather than folded into noteLabels since it isn't a note type and has
 *  its own (much smaller) two-language set. */
export function detectIndexLabel(root: DitaNode, uiLanguage?: string): string {
  const lang = root.attributes?.['xml:lang'] || uiLanguage || '';
  return lang.startsWith('zh') ? '\u7d22\u5f15' : 'Index';
}

// ── Escaping (single source of truth for non-renderer code) ──

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Book rendering helpers (pure, no vscode dependency) ──
//
// Book mode is deliberately just "every referenced topic's own content,
// one after another" -- it composites topics for reading, the same way
// opening one of those topics directly would render it, profiling
// included (each topic's own inline profiling markup already renders
// correctly via renderTopicToHtml, unaffected by anything here). It does
// NOT layer in topicref-level (ditamap-source) profiling/filtering on top
// of that; that scope stays exclusive to Outline mode's tree, matching
// how a topic opened directly never reflects what any ditamap referencing
// it says either.

export function renderBookPlaceholder(displayName: string, depth: number): string {
  const level = Math.min(1 + depth, 6);
  return `<div class="book-entry book-entry--placeholder">
  <h${level} class="book-section-heading">${escapeAttr(displayName)}</h${level}>
</div>`;
}

export function renderBookError(displayName: string, errorMsg: string, depth: number): string {
  const level = Math.min(1 + depth, 6);
  return `<div class="book-entry book-entry--error">
  <h${level} class="book-entry-title">${escapeHtml(displayName)}</h${level}>
  <p class="book-error">${escapeHtml(errorMsg)}</p>
</div>`;
}

export function renderBookSkipMessage(href: string): string {
  return `<p class="book-skip">(Skipped: ${escapeHtml(href)} already included above)</p>`;
}

// ── Shared: render a single .dita file to an HTML fragment ──

export interface TopicRenderInput {
  filePath: string;
  keyMap: Map<string, string>;
  asWebviewUri: (relPath: string) => string;
  headingLevel: number;
  /**
   * Fallback language (e.g. from vscode.env.language) used to pick note
   * labels (Warning/Attention/...) when the topic itself has no xml:lang
   * of its own to go by -- see detectNoteLabels. Most individual topic
   * files don't repeat xml:lang on every file (it's commonly set once,
   * at the ditamap or bookmap level, and left implicit on topics), so
   * relying on the topic's own root attribute alone left those topics
   * permanently defaulting to English regardless of the editor's own
   * display language.
   */
  uiLanguage?: string;
  /** See RenderContext.suppressIndexterm (render/renderer.ts) -- passed
   *  through untouched; only the "Export as HTML" command sets this. */
  suppressIndexterm?: boolean;
  /**
   * Optional sink: absolute paths of every file this render read -- the
   * topic itself, each conref/conrefend target, each file consulted for an
   * xref title, and each image whose dimensions were emitted. Callers that
   * cache rendered output use it as their invalidation set; renderTopicCached
   * is the only caller that does. Left unset by "Export as HTML", which
   * renders once and has nothing to invalidate.
   */
  collectDependencies?: Set<string>;
}

export interface TopicRenderResult {
  html: string;
  title?: string;
  error?: string;
}

export interface TopicXmlRenderInput {
  xml: string;
  docDir: string;
  keyMap: Map<string, string>;
  asWebviewUri: (relPath: string) => string;
  headingLevel: number;
  uiLanguage?: string;
  /** See TopicRenderInput.suppressIndexterm above. */
  suppressIndexterm?: boolean;
  /** See TopicRenderInput.collectDependencies above. */
  collectDependencies?: Set<string>;
}

export interface ParsedTopicResult {
  doc?: import('../parser/domTypes').DitaDocument;
  html: string;
  title?: string;
  error?: string;
}

// ── Ditamap reference expansion ──
// Walks the map tree and inlines children from referenced .ditamap files
// so key-value pairs appear inline in tree/book view.

export type FileReader = (path: string, encoding: 'utf-8') => string;

const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Percent-decodes an href path segment for filesystem lookups. DITA tools
 * URL-encode spaces and special characters in hrefs (e.g. "my%20image.png"),
 * but the file on disk keeps the literal name. Malformed escape sequences
 * are returned unchanged.
 */
export function decodeHrefPart(part: string): string {
  if (!part.includes('%')) return part;
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

function isLocalHref(href: string, scope?: string): boolean {
  if (!href || href.startsWith('#')) return false;
  if (scope === 'external' || scope === 'peer') return false;
  if (URL_SCHEME_RE.test(href)) return false;
  if (isAbsolute(href)) return false;
  return true;
}

/** True when the node is a topicref/keydef/mapref pointing at another local .ditamap. */
export function isDitamapRef(node: DitaNode): boolean {
  if (node.type !== 'element') return false;
  const baseType = node.baseType;
  if (baseType !== 'map/topicref' && baseType !== 'map/keydef' && baseType !== 'map/mapref') return false;
  const href = node.attributes?.href;
  if (!href || !isLocalHref(href, node.attributes?.scope)) return false;
  const pathPart = href.split('#')[0].toLowerCase();
  return pathPart.endsWith('.ditamap') || node.attributes?.format === 'ditamap';
}

// Hrefs inside a referenced map are relative to that map's own folder.
// When its children are inlined into the root map's tree, rewrite them so
// they stay valid relative to the root map's folder — otherwise nested
// keydef maps, sub-map topics and navigation all resolve to wrong paths.
function rebaseHrefs(node: DitaNode, fromDir: string, toDir: string): void {
  if (node.type !== 'element') return;
  const href = node.attributes?.href;
  if (href && node.attributes && isLocalHref(href, node.attributes.scope)) {
    const hashIdx = href.indexOf('#');
    const pathPart = hashIdx >= 0 ? href.substring(0, hashIdx) : href;
    const fragment = hashIdx >= 0 ? href.substring(hashIdx) : '';
    if (pathPart) {
      const abs = resolve(fromDir, pathPart);
      node.attributes.href = normalize(relative(toDir, abs)).replace(/\\/g, '/') + fragment;
    }
  }
  for (const child of node.children || []) rebaseHrefs(child, fromDir, toDir);
}

export function expandDitamapRefs(
  node: DitaNode,
  docDir: string,
  readFile: FileReader = readFileSync as unknown as FileReader,
  visited?: Set<string>,
): void {
  if (node.type !== 'element') return;

  if (isDitamapRef(node)) {
    const href = node.attributes!.href!;
    const targetPath = resolve(docDir, decodeHrefPart(href.split('#')[0]));
    if (!visited) visited = new Set();
    // Already-inlined maps are skipped, but this node's other children
    // (and siblings via the loop below) must still be expanded.
    if (!visited.has(targetPath)) {
      visited.add(targetPath);
      try {
        const content = readFile(targetPath, 'utf-8');
        const doc = parseDitamap(preprocessEntities(content));
        const refChildren = (doc.root.children || []).filter(
          (c) => c.type === 'element',
        );
        if (refChildren.length > 0) {
          const refDir = dirname(targetPath);
          if (refDir !== resolve(docDir)) {
            for (const rc of refChildren) rebaseHrefs(rc, refDir, docDir);
          }
          if (!node.children) node.children = [];
          node.children.push(...refChildren);
        }
      } catch {
        // file not found or parse error — skip silently
      }
    }
  }

  for (const child of node.children || []) {
    expandDitamapRefs(child, docDir, readFile, visited);
  }
}

export function renderTopicXml(input: TopicXmlRenderInput): ParsedTopicResult {
  const { xml, docDir, keyMap, asWebviewUri, headingLevel, uiLanguage, suppressIndexterm, collectDependencies } = input;
  try {
    const preprocessedXml = preprocessEntities(xml);
    const ditaDoc = parseDita(preprocessedXml);
    const titleMap = buildTitleMap(ditaDoc.root);
    const noteLabels = detectNoteLabels(ditaDoc.root, uiLanguage);
    const indexLabel = detectIndexLabel(ditaDoc.root, uiLanguage);

    // One cache shared by all three resolvers. They routinely load the same
    // conref/title target, and three independent caches each parsed it again;
    // sharing also gives a single place to read back the complete set of
    // files this render touched, which is what lets renderTopicCached key its
    // reuse on something both narrower and more correct than "some file in
    // the workspace changed".
    const fileCache = makeFileCache(docDir);
    const conrefResolver = makeConrefResolver(docDir, ditaDoc.root, fileCache);
    const conrefRangeResolver = makeConrefRangeResolver(docDir, ditaDoc.root, fileCache);
    const fileTitleResolver = makeFileTitleResolver(docDir, fileCache);

    const resolveTitle = (id: string): string | undefined => {
      const local = titleMap.get(id);
      if (local) return local;
      return fileTitleResolver(id);
    };

    const html = renderDocument(ditaDoc.root, {
      headingLevel,
      asWebviewUri,
      documentDir: docDir,
      resolveTitle,
      resolveKey: (key: string) => keyMap.get(key),
      resolveConref: (conref: string) => conrefResolver(conref),
      resolveConrefRange: (conref: string, conrefend: string) => conrefRangeResolver(conref, conrefend),
      noteLabels,
      indexLabel,
      suppressIndexterm,
      getImageDimensions: (relPath: string) => {
        try {
          const absPath = resolve(docDir, decodeHrefPart(relPath));
          // An image's bytes are not parsed into the output, but its
          // dimensions are (the width/height attributes), so the file is a
          // genuine dependency of the rendered HTML and has to be recorded
          // alongside the conref/title targets. readImageDimensions caches
          // dimensions on its own, so without this a replaced image would
          // slip through an otherwise-valid topic cache entry.
          collectDependencies?.add(absPath);
          return readImageDimensions(absPath);
        } catch {
          return undefined;
        }
      },
    });

    if (collectDependencies) {
      for (const touched of fileCache.touchedFiles()) collectDependencies.add(touched);
    }

    const titleNode = (ditaDoc.root.children || []).find(
      (c) => c.type === 'element' && c.baseType === 'topic/title',
    );
    const title = titleNode ? collectText(titleNode) : undefined;
    return { doc: ditaDoc, html, title };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { html: '', error: `Error rendering topic: ${message}` };
  }
}

export function renderTopicToHtml(input: TopicRenderInput): TopicRenderResult {
  const { filePath, keyMap, asWebviewUri, headingLevel, uiLanguage, suppressIndexterm, collectDependencies } = input;
  try {
    if (!existsSync(filePath)) {
      return { html: '', error: `File not found: ${filePath}` };
    }
    // The topic's own file is a dependency of its own render even though it
    // is read here rather than through the shared file cache.
    collectDependencies?.add(filePath);
    const rawXml = readFileSync(filePath, 'utf-8');
    const result = renderTopicXml({
      xml: rawXml,
      docDir: dirname(filePath),
      keyMap,
      asWebviewUri,
      headingLevel,
      uiLanguage,
      suppressIndexterm,
      collectDependencies,
    });
    return { html: result.html, title: result.title, error: result.error };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { html: '', error: `Error rendering ${filePath}: ${message}` };
  }
}

// ── Topic render cache (book mode) ──

/**
 * Fingerprint of a set of files' mtimes, used to decide whether a cached
 * result derived from them is still valid. A file that cannot be statted
 * contributes "?" rather than being dropped, so deleting a dependency
 * invalidates exactly as a modification does -- and creating a file that was
 * previously missing turns "?" into a real timestamp, which is the other half
 * of the same requirement.
 *
 * Shared by buildKeyMap's cache (DitaViewerProvider.ts) and renderTopicCached
 * below. It lived privately in the former until the topic cache needed the
 * identical logic; keeping one copy is the point.
 */
export function stampFiles(files: string[]): string {
  return files
    .map((f) => {
      try {
        return String(statSync(f).mtimeMs);
      } catch {
        return '?';
      }
    })
    .join('|');
}

/**
 * Budget for the topic render cache below, in bytes of rendered HTML.
 *
 * Bounded and clearable like every other cache in this file, per the rule
 * stated at imageDimensionsCache -- but bounded by bytes rather than by entry
 * count, because count is not a meaningful unit here. The other caches hold
 * fixed-size entries (a dimension pair, a keymap), so capping their count caps
 * their memory; a topic's HTML varies by orders of magnitude between a stub
 * and a full reference topic, so any count cap is either far too generous in
 * bytes or, set low enough to be safe, far too tight in entries.
 *
 * Too tight in entries is the failure that matters, and it is not gradual: a
 * book with more topics than the cap gets NO reuse at all. Each pass renders
 * in map order, so once the cache is full every insertion evicts an entry the
 * same pass has not reached again yet -- a cyclic access pattern, LRU's
 * classic worst case. Budgeting by bytes puts the cliff where it belongs: a
 * book whose entire HTML exceeds the budget is already costing at least that
 * much to hold as one assembled string (plus the webview DOM built from it),
 * so that is the point at which caching more stops being worth it.
 *
 * 32MB holds roughly 4,500 typical topics -- any realistic book, with room
 * for several open at once. Cleared from clearAllCaches() on deactivation.
 */
export const TOPIC_RENDER_CACHE_MAX_BYTES = 32 * 1024 * 1024;

interface TopicRenderCacheEntry {
  html: string;
  title: string | undefined;
  /** Absolute paths the render read; see TopicRenderInput.collectDependencies. */
  files: string[];
  stamps: string;
  /**
   * Compared by identity, not by content: buildKeyMap hands back the same Map
   * instance for as long as its own cache entry is valid, so identity is a
   * cheap proxy for "the key values this HTML was rendered with". If that
   * cache is evicted and rebuilt with identical contents the check fails and
   * the topic re-renders -- a false invalidation, never a stale hit, which is
   * the safe direction to be wrong in.
   */
  keyMap: Map<string, string>;
  uiLanguage: string | undefined;
  suppressIndexterm: boolean | undefined;
  /** Retained size of html, stored so eviction can subtract it without
   *  re-measuring every entry. */
  bytes: number;
}

const topicRenderCache = new Map<string, TopicRenderCacheEntry>();
let topicRenderCacheBytes = 0;
let topicRenderCacheBudget = TOPIC_RENDER_CACHE_MAX_BYTES;

export function clearTopicRenderCache(): void {
  topicRenderCache.clear();
  topicRenderCacheBytes = 0;
}

/** How many topic renders are currently held -- test hook for eviction/clear. */
export function topicRenderCacheSize(): number {
  return topicRenderCache.size;
}

/** Bytes of HTML currently held -- test hook, paired with the size above. */
export function topicRenderCacheBytesHeld(): number {
  return topicRenderCacheBytes;
}

/**
 * Test hook: shrinks the budget so eviction can be exercised without first
 * rendering 32MB of real topics. Called with no argument it restores the
 * production budget. Nothing outside the test suite calls this.
 */
export function setTopicRenderCacheBudgetForTesting(bytes?: number): void {
  topicRenderCacheBudget = bytes ?? TOPIC_RENDER_CACHE_MAX_BYTES;
}

function dropTopicEntry(key: string): void {
  const entry = topicRenderCache.get(key);
  if (!entry) return;
  topicRenderCache.delete(key);
  topicRenderCacheBytes -= entry.bytes;
}

function dropOldestTopicEntry(): void {
  const oldest = topicRenderCache.keys().next().value;
  if (oldest !== undefined) dropTopicEntry(oldest);
}

/**
 * renderTopicToHtml with reuse across passes -- the difference between "one
 * keystroke in one topic" and "the whole book again" in book mode, which
 * otherwise re-renders every referenced topic on each debounced pass (see
 * scripts/bench-book-render.js for the measured cost, and the budget note
 * above for why reuse is bounded in bytes).
 *
 * Deliberately opt-in and separate rather than built into renderTopicToHtml:
 * "Export as HTML" calls that one with its own asWebviewUri, and sharing a
 * single cache between the two would hand book-mode HTML to an exported
 * standalone file.
 *
 * Two assumptions worth stating, since neither is enforced by the key.
 *
 * asWebviewUri output depends only on the local URI and the window's remote
 * info, never on which webview asked: VS Code builds it as
 * `https://<scheme>+<authority>.vscode-resource.vscode-cdn.net<path>` in a
 * module-level helper with no panel in scope, and cspSource is likewise the
 * constant `'self' https://*.vscode-cdn.net` (both checked against the
 * shipped extension host bundle, not assumed). So HTML built for one map
 * panel is valid in another, and the caller's asWebviewUri closure is not
 * part of the cache key.
 *
 * headingLevel is part of the key rather than a merely validated field
 * because the same topic legitimately sits at different depths across two
 * open books -- validating it instead would make those two entries evict each
 * other on every pass.
 */
export function renderTopicCached(input: TopicRenderInput): TopicRenderResult {
  const key = `${input.filePath}\u0000${input.headingLevel}`;

  const cached = topicRenderCache.get(key);
  if (
    cached &&
    cached.keyMap === input.keyMap &&
    cached.uiLanguage === input.uiLanguage &&
    cached.suppressIndexterm === input.suppressIndexterm &&
    stampFiles(cached.files) === cached.stamps
  ) {
    // Re-insert so a hit keeps the entry from being the oldest (and therefore
    // first-evicted) candidate -- same LRU-by-reinsertion as
    // imageDimensionsCache above.
    topicRenderCache.delete(key);
    topicRenderCache.set(key, cached);
    return { html: cached.html, title: cached.title };
  }

  // Honour a caller-supplied sink as well, so anyone who passed one still
  // sees the dependency set instead of having it silently replaced.
  const dependencies = input.collectDependencies ?? new Set<string>();
  const result = renderTopicToHtml({ ...input, collectDependencies: dependencies });
  if (result.error) {
    // Never cache a failure. A malformed mid-edit save is exactly the
    // transient case this path sees, and pinning it would keep serving the
    // error page after the file was fixed -- the dependency stamps would
    // still match, because the file that failed to parse is the very file
    // whose mtime gets compared.
    dropTopicEntry(key);
    return result;
  }

  const files = [...dependencies];
  // UTF-8 bytes, not html.length: DITA content is frequently CJK, where the
  // character count understates what is actually retained by up to 3x.
  const bytes = Buffer.byteLength(result.html, 'utf8');
  if (bytes > topicRenderCacheBudget) {
    // A single topic larger than the entire budget. Caching it would evict
    // everything else and then be evicted itself on the next insert, so skip
    // it: that entry alone falls back to uncached rendering.
    dropTopicEntry(key);
    return result;
  }

  // Make room before inserting, and account for any stale entry this key
  // already holds -- overwriting it in place would otherwise leak its bytes
  // out of the running total and shrink the effective budget permanently.
  dropTopicEntry(key);
  while (topicRenderCache.size > 0 && topicRenderCacheBytes + bytes > topicRenderCacheBudget) {
    dropOldestTopicEntry();
  }
  topicRenderCache.set(key, {
    html: result.html,
    title: result.title,
    files,
    stamps: stampFiles(files),
    keyMap: input.keyMap,
    uiLanguage: input.uiLanguage,
    suppressIndexterm: input.suppressIndexterm,
    bytes,
  });
  topicRenderCacheBytes += bytes;
  return result;
}

// ── Book mode assembly ──

/**
 * Resolves one map entry's href to the absolute path renderBookParts (and
 * the docsite-mode nav manifest below, which must agree with it exactly --
 * a sidebar listing a topic this book doesn't actually render, or vice
 * versa, is worse than either one being wrong consistently) would treat as
 * "this topic". Returns undefined for anything that isn't a renderable
 * .dita topic: no href, a fragment-only self-reference, or a .ditamap --
 * by the time entries reach here they should already be flattened by
 * expandDitamapRefs, so a .ditamap entry surviving to this point means the
 * caller skipped that step, not that this is a legitimate case to render.
 */
export function resolveBookTopicPath(entry: MapEntry, docDir: string): string | undefined {
  if (!entry.href) return undefined;
  const refPath = entry.href.split('#')[0];
  if (!refPath || refPath.toLowerCase().endsWith('.ditamap')) return undefined;
  return resolve(docDir, decodeHrefPart(refPath));
}

export interface DocsiteNavEntry {
  /** Resolved absolute path -- the same identity renderBookParts's own
   *  `visited` set and de-duplication use, and what a future "is this xref
   *  target part of the current book" check (docsite design doc, 3.2/4.5)
   *  will key off of. */
  absPath: string;
  title: string;
  /** Nesting level, 0 at the map's own top level -- for sidebar indentation. */
  depth: number;
  /** BookMap structural role ("Chapter 1", "Appendix A", ...), when the
   *  entry has one -- see collectMapEntries/createBookRoleLabeler. */
  role?: string;
  /** Displayable type label for the referenced topic's own root element
   *  ("Concept", "Task", "Reference", ...), when a resolveTopicType was
   *  passed to buildBookNavManifest and the topic file's root tag is one
   *  the labeler recognized. The generic `<topic>` root yields undefined
   *  (see makeFileTopicTypeResolver's default labeler) so a plain map
   *  full of `<topic>` files doesn't get a row of identical "Topic"
   *  chips with no information -- only specializations get a chip. */
  topicType?: string;
}

/**
 * Builds the docsite-mode sidebar/prev-next data source from the same
 * flattened entries list renderBookParts renders from -- pass it the exact
 * same `entries` (and `docDir`) used for the content render, not a
 * separately-collected one, so the nav can never list a topic the book
 * doesn't actually contain or omit one it does. Order matches document
 * order (collectMapEntries' own order), which is what a reading-order
 * prev/next needs.
 *
 * resolveTopicTitle, when given, is called for every entry that has an
 * href -- regardless of MapEntry.displayNameExplicit -- and its result, if
 * any, wins over entry.displayName. This deliberately overrides an
 * explicit map-authored navtitle/linktext/keyword too: the sidebar is
 * showing the reader a list of topics, and a book's own rendered content
 * (tree mode's tooltip aside) always shows a topic's real <title>
 * regardless of what the map called it, so the sidebar should match that
 * rather than surface the map's own label for it, which can drift from the
 * topic's actual title over time. entry.displayName is still the fallback
 * when resolveTopicTitle finds nothing (topic has no <title>, or the file
 * failed to read) -- an explicit navtitle beats no title at all. Passed
 * entry.href (the original relative href, not the resolved absPath) so a
 * caller can hand this makeFileTitleResolver(docDir) directly.
 *
 * resolveTopicType, when given, is called for every entry with a real
 * href (regardless of role -- a chapter can still be a <task>, and
 * showing both chips lets the sidebar answer "structural role" and
 * "information type" independently) and produces the sidebar's per-entry
 * type chip. Pass makeFileTopicTypeResolver(docDir); unlike
 * resolveTopicTitle this isn't conditioned on the map having left the
 * entry unnamed, since a topic's type isn't something the map ever states
 * on its own -- but the resolver itself stays cheap by design (a bounded
 * sniff of the root tag, not a full parse; see sniffRootTagName's own
 * comment), specifically so this being unconditional doesn't reintroduce
 * an O(topics-in-book) cost on every docsite render.
 */
export function buildBookNavManifest(
  entries: MapEntry[],
  docDir: string,
  resolveTopicTitle?: (href: string) => string | undefined,
  resolveTopicType?: (href: string) => string | undefined,
): DocsiteNavEntry[] {
  const seen = new Set<string>();
  const result: DocsiteNavEntry[] = [];
  for (const entry of entries) {
    const absPath = resolveBookTopicPath(entry, docDir);
    if (!absPath || seen.has(absPath)) continue; // same one-entry-per-topic rule renderBookParts's own `visited` set enforces
    seen.add(absPath);
    let title = entry.displayName;
    if (resolveTopicTitle && entry.href) {
      const realTitle = resolveTopicTitle(entry.href);
      if (realTitle) title = realTitle;
    }
    // Topic type is read straight off the topic file (not the map), so a
    // missing href (keydef-only entry, fragment-only self-reference) has
    // no file to read from and therefore no type chip -- skipped here
    // rather than calling the resolver with an undefined href, matching
    // resolveTopicTitle's own guard above.
    const topicType = entry.href && resolveTopicType ? resolveTopicType(entry.href) : undefined;
    result.push({ absPath, title, depth: entry.depth, role: entry.role, topicType });
  }
  return result;
}

/**
 * Docsite mode's sidebar -- one link per topic, indented by depth, the
 * current page marked active. Deliberately just a static list: switching
 * pages toggles the `active` class client-side (see the webview script's
 * .site-nav-link click handler) rather than re-rendering this nav on every
 * page change, since which topics exist and how they nest never changes
 * just because the reader picked a different one to look at right now.
 *
 * currentAbsPath must be one of manifest's own absPath values (generateHtml
 * resolves an unknown/stale one back to the first entry before calling
 * this) -- if it somehow isn't, nothing throws, the sidebar just renders
 * with no active entry.
 *
 * Each entry can carry up to two chips in front of its title: a role chip
 * for the bookmap's structural role ("Chapter 1", "Appendix A", ...) and a
 * type chip for the topic's own root element type ("Concept", "Task", ...).
 * Both are optional per entry; missing chips simply don't render, which
 * keeps a plain map full of generic `<topic>` files from getting a row of
 * identical "Topic" labels with no information value (see
 * makeFileTopicTypeResolver's default labeler for that filter). The title
 * text is wrapped in its own span so the link's flex layout can ellipsis
 * the title without ever clipping the chips -- the chips are short fixed
 * labels and the title is the part that overflows on narrow sidebars.
 */
export function renderSiteNavHtml(manifest: DocsiteNavEntry[], currentAbsPath: string, navLabel: string): string {
  const links = manifest
    .map((entry) => {
      const activeClass = entry.absPath === currentAbsPath ? ' active' : '';
      const indent = 8 + entry.depth * 16;
      // Role chip first (the rarer, more specific signal), then the type
      // chip (the topic's information type), then the title. Both chips
      // are escaped the same way the title is -- they're already display
      // strings produced by labelers, but a labeler fed a malicious tag
      // name (from a parsed topic a user controls) shouldn't be able to
      // inject markup into the sidebar.
      const roleChip = entry.role
        ? `<span class="site-nav-chip site-nav-chip--role">${escapeHtml(entry.role)}</span>`
        : '';
      const typeChip = entry.topicType
        ? `<span class="site-nav-chip site-nav-chip--type">${escapeHtml(entry.topicType)}</span>`
        : '';
      return `<a href="#" class="site-nav-link${activeClass}" data-site-target="${escapeAttr(entry.absPath)}" style="padding-left:${indent}px" title="${escapeAttr(entry.title)}">${roleChip}${typeChip}<span class="site-nav-link-text">${escapeHtml(entry.title)}</span></a>`;
    })
    .join('\n');
  return `<nav class="site-nav" aria-label="${escapeAttr(navLabel)}">${links}</nav>`;
}

/**
 * Docsite mode's sidebar click handler -- flips which .site-nav-link
 * carries the `active` class (client-side, no server round-trip for that
 * part; see renderSiteNavHtml's own comment for why) and asks the
 * extension host to render the newly-selected topic. Extracted into its
 * own testable function rather than left inline in getMapWebviewScript
 * (MapViewerProvider.ts, which isn't reachable from mocha -- it imports
 * vscode) for the same reason getSearchOverlayScript/
 * getProfilingFilterScript above are: new Function(script) is the cheapest
 * check that still catches a broken template literal.
 */
export function getSiteNavClickHandlerScript(opts: { switchSitePageMsgType: string }): string {
  return `
  // Shared by the sidebar's own click handler and the prev/next buttons
  // (getSitePrevNextButtonsScript below) -- switching pages always means
  // the same three things: flip which sidebar link is 'active', refresh
  // prev/next's own enabled state and click targets against the new
  // active link, and ask the extension host to render it. Takes the
  // .site-nav-link element itself (not just its target path) so
  // updatePrevNextButtons can read the *next* prev/next targets' own
  // title attribute for free.
  function switchToSitePage(link) {
    if (!link || link.classList.contains('active')) return;
    var target = link.getAttribute('data-site-target');
    if (!target) return;
    var prevActive = document.querySelector('.site-nav-link.active');
    if (prevActive) prevActive.classList.remove('active');
    link.classList.add('active');
    updatePrevNextButtons();
    vscode.postMessage({ type: '${opts.switchSitePageMsgType}', target: target });
  }

  // Prev/next's targets are derived from the sidebar's own link order
  // rather than tracked separately -- buildBookNavManifest's own contract
  // is that its entries (and so the sidebar links built from them) are
  // already in document/reading order, so the sidebar IS the ordering,
  // not just a display of it. A no-op wherever the buttons don't exist
  // (only site mode creates them; see getSitePrevNextButtonsScript).
  function updatePrevNextButtons() {
    var prevBtn = document.getElementById('__site-prev-btn');
    var nextBtn = document.getElementById('__site-next-btn');
    if (!prevBtn && !nextBtn) return;
    var links = Array.prototype.slice.call(document.querySelectorAll('.site-nav-link'));
    var activeIdx = -1;
    for (var i = 0; i < links.length; i++) {
      if (links[i].classList.contains('active')) { activeIdx = i; break; }
    }
    var prevLink = activeIdx > 0 ? links[activeIdx - 1] : null;
    var nextLink = activeIdx >= 0 && activeIdx < links.length - 1 ? links[activeIdx + 1] : null;
    if (prevBtn) {
      prevBtn.disabled = !prevLink;
      prevBtn.onclick = prevLink ? function() { switchToSitePage(prevLink); } : null;
    }
    if (nextBtn) {
      nextBtn.disabled = !nextLink;
      nextBtn.onclick = nextLink ? function() { switchToSitePage(nextLink); } : null;
    }
  }

  document.addEventListener('click', function(e) {
    var siteLink = e.target.closest ? e.target.closest('.site-nav-link') : null;
    if (!siteLink) return;
    e.preventDefault();
    switchToSitePage(siteLink);
  });

  updatePrevNextButtons(); // establish initial state on load, same as the sidebar's own active link is already set server-side
`;
}

/**
 * Docsite mode's prev/next buttons -- built but, same convention as
 * getToolbarFontWidthTagTooltipsButtonsScript, NOT appended to the toolbar
 * here; the caller decides where in its own button order they belong
 * (design doc: "跟字号/页宽那些按钮放一起"). Their actual enabled state and
 * click targets are established by updatePrevNextButtons() in
 * getSiteNavClickHandlerScript above, called once these exist -- so this
 * function only needs to create the two elements, not wire them up.
 */
export function getSitePrevNextButtonsScript(opts: { prevLabel: string; prevTitle: string; nextLabel: string; nextTitle: string }): string {
  const prevLabel = JSON.stringify(opts.prevLabel);
  const prevTitle = JSON.stringify(opts.prevTitle);
  const nextLabel = JSON.stringify(opts.nextLabel);
  const nextTitle = JSON.stringify(opts.nextTitle);
  return `
  var sitePrevBtn = document.createElement('button');
  sitePrevBtn.id = '__site-prev-btn';
  sitePrevBtn.textContent = ${prevLabel};
  sitePrevBtn.title = ${prevTitle};
  sitePrevBtn.setAttribute('aria-label', ${prevTitle});
  sitePrevBtn.style.cssText = btnStyle + 'font-size:20px;padding:2px 10px;justify-content:center;';

  var siteNextBtn = document.createElement('button');
  siteNextBtn.id = '__site-next-btn';
  siteNextBtn.textContent = ${nextLabel};
  siteNextBtn.title = ${nextTitle};
  siteNextBtn.setAttribute('aria-label', ${nextTitle});
  siteNextBtn.style.cssText = btnStyle + 'font-size:20px;padding:2px 10px;justify-content:center;';
`;
}

/**
 * Docsite mode's sidebar collapse toggle -- a single button that flips
 * `site-nav-collapsed` on document.body. The sidebar itself starts
 * collapsed (see MapViewerProvider.ts's body class construction for site
 * mode): a fully-expanded topic list by default ate too much width for
 * what's often a glance-and-dismiss navigation aid, so site mode now opens
 * with the content pane full-width and this button is how a reader gets
 * the list back. Deliberately a plain class toggle on body rather than
 * anything that touches the sidebar's own markup or posts a message to the
 * extension host: nothing here needs to survive a page switch through any
 * path other than "the class is already sitting on body, which page
 * switches never touch" (see postSitePageUpdate's own comment on why the
 * sidebar element itself is left alone by a content-only update) -- so
 * this one class flip is also, for free, exactly what keeps the sidebar's
 * open/closed state stable across clicking from topic to topic.
 * Same convention as getSitePrevNextButtonsScript: builds the element but
 * does not append it anywhere, so the caller decides where in the toolbar
 * it belongs.
 */
export function getSiteSidebarToggleScript(opts: { toggleTitle: string }): string {
  const toggleTitle = JSON.stringify(opts.toggleTitle);
  return `
  var siteSidebarToggleBtn = document.createElement('button');
  siteSidebarToggleBtn.id = '__site-sidebar-toggle-btn';
  siteSidebarToggleBtn.textContent = '\\u2630';
  siteSidebarToggleBtn.title = ${toggleTitle};
  siteSidebarToggleBtn.setAttribute('aria-label', ${toggleTitle});
  siteSidebarToggleBtn.style.cssText = btnStyle + 'font-size:14px;';
  siteSidebarToggleBtn.addEventListener('click', function() {
    document.body.classList.toggle('site-nav-collapsed');
  });
`;
}

export interface BookRenderInput {
  /** Flattened topicref list, in map order -- see collectMapEntries. */
  entries: MapEntry[];
  /** Directory the map itself lives in; entry hrefs resolve against it. */
  docDir: string;
  /**
   * One instance for the whole pass. renderTopicCached compares it by
   * identity, so a fresh Map per entry would defeat reuse entirely -- which
   * is what the benchmark script used to do, and why the assembly loop now
   * lives here where both callers share it.
   */
  keyMap: Map<string, string>;
  /**
   * Converts an absolute local path into a URI the webview can load. This is
   * the only vscode-specific primitive in a book render; everything else
   * (resolving hrefs against each topic's own directory, de-duplicating,
   * heading depth, error and placeholder markup) lives here so it can be
   * tested -- and benchmarked -- without a VS Code instance.
   */
  fileToWebviewUri: (absPath: string) => string;
  uiLanguage?: string;
}

/**
 * Assembles every topic a map references into the ordered parts that Book
 * mode shows as one long document. Called by MapViewerProvider's
 * collectBookParts and by scripts/bench-book-render.js.
 *
 * It used to be a private method on the provider, with the benchmark keeping
 * its own hand-copied version of the loop. That copy had already drifted once
 * (it built a fresh keyMap per topic), and once rendering became cached the
 * drift stopped being cosmetic: the benchmark would have measured zero reuse
 * and reported that the cache did not work. One loop, two callers.
 *
 * Returns the parts rather than the joined document so MapViewerProvider can
 * diff two renders of the same map and send only the entries that changed
 * (see bookPatch.ts). wrapBookParts turns them back into exactly the document
 * this function used to return, byte for byte.
 */
export function renderBookParts(input: BookRenderInput): BookPart[] {
  const { entries, docDir, keyMap, fileToWebviewUri, uiLanguage } = input;

  // Track visited absolute paths to avoid duplicates
  const visited = new Set<string>();

  const parts: BookPart[] = [];
  // A key per part, so two renders of the same map can be compared part by
  // part. Uniqueness is enforced here rather than assumed: a topic's resolved
  // path cannot repeat (the visited set above already de-duplicates those),
  // but two sub-maps, two skip notes or two structural headings can easily
  // collide, and a repeated key would make the diff read two different
  // entries as the same one. The suffix comes from the collision count, so it
  // is itself stable across re-renders of an unchanged map.
  const usedKeys = new Map<string, number>();
  const push = (keyBase: string, html: string): void => {
    const seen = usedKeys.get(keyBase) ?? 0;
    usedKeys.set(keyBase, seen + 1);
    parts.push({ key: seen === 0 ? keyBase : `${keyBase}~${seen + 1}`, html });
  };
  for (const entry of entries) {
    if (entry.href) {
      // Sub-map reference: its contents were already inlined as child
      // entries by expandDitamapRefs — render a section heading only
      // instead of parsing the map file as a topic.
      const refPath = entry.href.split('#')[0];
      if (refPath.toLowerCase().endsWith('.ditamap')) {
        push(
          `map:${resolve(docDir, decodeHrefPart(refPath))}`,
          renderBookPlaceholder(entry.displayName, entry.depth),
        );
        continue;
      }
      const absPath = resolveBookTopicPath(entry, docDir)!; // href is truthy and not a .ditamap -- both already checked above, so this always resolves
      if (visited.has(absPath)) {
        push(`skip:${entry.href}`, renderBookSkipMessage(entry.href));
        continue;
      }
      visited.add(absPath);

      // Per-topic asWebviewUri: image hrefs inside a topic are relative to
      // that topic's own directory, not to the map's.
      const topicDir = dirname(absPath);
      const asWebviewUri = (relPath: string): string => {
        try {
          return fileToWebviewUri(resolve(topicDir, decodeHrefPart(relPath)));
        } catch (e) {
          // The empty src still surfaces as a visibly broken image (the
          // webview script's document-level error listener marks it);
          // log the cause so path-resolution failures are debuggable.
          console.warn(`Failed to resolve webview URI for ${relPath}:`, e instanceof Error ? e.message : e);
          return '';
        }
      };

      const headingLevel = Math.min(1 + entry.depth, 6);
      // Cached, unlike the equivalent call in exportHtml.ts (which renders
      // once into a standalone file and has nothing to invalidate). Book
      // mode re-renders the whole map on every edit to any watched file,
      // and reuse keyed on the set of files each render actually read
      // turns that from "every topic again" into "the edited topic, plus
      // whatever conrefs it".
      const result = renderTopicCached({
        filePath: absPath,
        keyMap,
        asWebviewUri,
        headingLevel,
        uiLanguage,
      });

      if (result.error) {
        // Keyed like the topic it stands in for, so a topic that starts or
        // stops failing to parse patches that one entry in place instead of
        // forcing a whole-document replace.
        push(`topic:${absPath}`, renderBookError(entry.displayName, result.error, entry.depth));
      } else {
        // Book mode is just each referenced topic's own content, one
        // after another -- the same profiling/highlighting a topic
        // already renders when opened directly (via renderTopicCached
        // above) carries straight through here unchanged. No separate
        // topicref-level (ditamap-source) profiling layered on top of
        // it; that scope is exclusive to Outline mode's tree.
        push(`topic:${absPath}`, `<div class="book-entry">${result.html}</div>`);
      }
    } else {
      push(`struct:${entry.depth}:${entry.displayName}`, renderBookPlaceholder(entry.displayName, entry.depth));
    }
  }

  return parts;
}

/**
 * Joins parts into the single container that both the stylesheet and the
 * webview script address as .ditamap-book. Kept apart from renderBookParts so
 * the incremental path can diff the parts and still produce exactly the same
 * document whenever it has to fall back to sending all of them.
 */
export function wrapBookParts(parts: BookPart[]): string {
  return `<div class="ditamap-book">${parts.map((part) => part.html).join('\n')}</div>`;
}

export function renderBookEntries(input: BookRenderInput): string {
  return wrapBookParts(renderBookParts(input));
}

// ── Webview search overlay (Ctrl+F) ──
// Returns inline JS that creates a floating search bar with text highlighting,
// match navigation, and keyboard shortcuts. Injected into both DITA topic
// and DITA map webview scripts.

export function getSearchOverlayScript(opts: {
  placeholder: string;
  nextMatch: string;
  prevMatch: string;
  close: string;
  matchCase: string;
  useRegex: string;
  invalidRegex: string;
}): string {
  const ph = JSON.stringify(opts.placeholder);
  const next = JSON.stringify(opts.nextMatch);
  const prev = JSON.stringify(opts.prevMatch);
  const cls = JSON.stringify(opts.close);
  const mc = JSON.stringify(opts.matchCase);
  const re = JSON.stringify(opts.useRegex);
  const ir = JSON.stringify(opts.invalidRegex);
  return `
  // ── Search overlay (Ctrl+F) ──
  var searchMarks = [];
  var currentMatch = -1;
  // Which mark actually carries '__current' right now, or -1 if none does.
  // Tracked apart from currentMatch so that moving the highlight touches two
  // marks instead of every mark in the document -- see updateCurrentMatch.
  var highlightedMatch = -1;
  var useRegex = false;
  var caseSensitive = false;

  var sbStyle = 'position:fixed;top:40px;right:8px;z-index:10000;display:none;align-items:center;gap:4px;padding:4px 8px;border-radius:5px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:12px;background:var(--vscode-editor-background,rgba(30,30,30,0.95));border:1px solid var(--vscode-widget-border,rgba(255,255,255,0.12));backdrop-filter:blur(4px);box-shadow:0 2px 8px rgba(0,0,0,0.2);';
  var sbInputStyle = 'width:180px;padding:2px 6px;border-radius:3px;border:1px solid var(--vscode-dropdown-border,var(--vscode-widget-border,#555));background:var(--vscode-dropdown-background,#333);color:var(--vscode-dropdown-foreground,#eee);font-size:12px;outline:none;';
  var sbBtnStyle = 'padding:1px 6px;border-radius:3px;border:1px solid var(--vscode-dropdown-border,var(--vscode-widget-border,#555));background:var(--vscode-dropdown-background,#333);color:var(--vscode-dropdown-foreground,#eee);cursor:pointer;font-size:13px;line-height:1;outline:none;';
  var sbToggleStyleOff = sbBtnStyle + 'font-size:11px;';
  var sbCountStyle = 'min-width:50px;text-align:center;color:var(--vscode-descriptionForeground,#999);font-size:11px;';
  var sbActiveBg = 'var(--vscode-button-background,#0e639c)';
  var sbActiveFg = 'var(--vscode-button-foreground,#fff)';
  var sbInactiveBg = 'var(--vscode-dropdown-background,#333)';
  var sbInactiveFg = 'var(--vscode-dropdown-foreground,#eee)';
  var sbInactiveBd = 'var(--vscode-dropdown-border,var(--vscode-widget-border,#555))';

  var sb = document.createElement('div');
  sb.id = '__search_bar';
  sb.setAttribute('role', 'search');
  sb.style.cssText = sbStyle;

  var searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = ${ph};
  searchInput.setAttribute('aria-label', ${ph});
  searchInput.style.cssText = sbInputStyle;

  var searchCount = document.createElement('span');
  searchCount.style.cssText = sbCountStyle;
  searchCount.textContent = '';
  searchCount.setAttribute('aria-live', 'polite');

  var caseBtn = document.createElement('button');
  caseBtn.textContent = 'Aa';
  caseBtn.title = ${mc};
  caseBtn.setAttribute('aria-label', ${mc});
  caseBtn.style.cssText = sbToggleStyleOff;

  var regexBtn = document.createElement('button');
  regexBtn.textContent = '.*';
  regexBtn.title = ${re};
  regexBtn.setAttribute('aria-label', ${re});
  regexBtn.style.cssText = sbToggleStyleOff + 'font-family:monospace;';

  var searchPrev = document.createElement('button');
  searchPrev.innerHTML = '&uarr;';
  searchPrev.title = ${prev};
  searchPrev.setAttribute('aria-label', ${prev});
  searchPrev.style.cssText = sbBtnStyle;

  var searchNext = document.createElement('button');
  searchNext.innerHTML = '&darr;';
  searchNext.title = ${next};
  searchNext.setAttribute('aria-label', ${next});
  searchNext.style.cssText = sbBtnStyle;

  var searchClose = document.createElement('button');
  searchClose.innerHTML = '&times;';
  searchClose.title = ${cls};
  searchClose.setAttribute('aria-label', ${cls});
  searchClose.style.cssText = sbBtnStyle + 'font-size:16px;';

  sb.appendChild(searchInput);
  sb.appendChild(searchCount);
  sb.appendChild(caseBtn);
  sb.appendChild(regexBtn);
  sb.appendChild(searchPrev);
  sb.appendChild(searchNext);
  sb.appendChild(searchClose);
  document.body.appendChild(sb);

  var searchHlStyle = document.createElement('style');
  searchHlStyle.textContent = 'mark.__search_mark{background:rgba(255,213,0,0.35);color:inherit;border-radius:2px;padding:0;}mark.__search_mark.__current{background:rgba(255,165,0,0.6);outline:2px solid rgba(255,165,0,0.8);border-radius:2px;}';
  document.head.appendChild(searchHlStyle);

  function updateToggleVisual(btn, active) {
    if (active) {
      btn.style.background = sbActiveBg;
      btn.style.color = sbActiveFg;
      btn.style.borderColor = sbActiveBg;
    } else {
      btn.style.background = sbInactiveBg;
      btn.style.color = sbInactiveFg;
      btn.style.borderColor = sbInactiveBd;
    }
  }

  function clearSearchHighlights() {
    var marks = document.querySelectorAll('mark.__search_mark');
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i];
      var p = m.parentNode;
      if (!p) continue;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
      p.normalize();
    }
    searchMarks = [];
    currentMatch = -1;
    highlightedMatch = -1;
  }

  // Returns array of {start, end} match positions within a text string.
  // Core implementation is the exported findTextMatches (unit-tested TS),
  // injected here so webview and tests always run the same algorithm.
  var findTextMatchesCore = ${findTextMatches.toString()};
  function findMatchesInText(text, term) {
    return findTextMatchesCore(text, term, useRegex, caseSensitive);
  }

  // Which marks to touch when the current match moves. Same arrangement: the
  // exported planCurrentMarkMove is unit-tested TS, injected here so webview
  // and tests always run the same algorithm.
  var planCurrentMarkMoveCore = ${planCurrentMarkMove.toString()};

  function performSearch(term) {
    clearSearchHighlights();
    searchCount.style.color = '';
    if (!term) { searchCount.textContent = ''; return; }

    // Validate regex early so we can show an error
    if (useRegex) {
      try {
        var testFlags = caseSensitive ? 'g' : 'gi';
        new RegExp(term, testFlags);
      } catch(e) {
        searchCount.textContent = ${ir};
        searchCount.style.color = 'var(--vscode-errorForeground,#f48771)';
        return;
      }
    }

    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function(node) {
        if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
        var parent = node.parentNode;
        if (!parent) return NodeFilter.FILTER_REJECT;
        var tag = parent.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'MARK') return NodeFilter.FILTER_REJECT;
        var el = parent;
        while (el && el !== document.body) {
          if (el.id === '__toolbar' || el.id === '__search_bar') return NodeFilter.FILTER_REJECT;
          // Docsite mode's sidebar (.site-nav) sits beside #dita-content-root
          // as a sibling under body, not inside it -- without this, Ctrl+F
          // would also match/highlight topic titles and chips in the
          // sidebar, which isn't "the page" the reader is searching.
          if (el.classList && el.classList.contains('site-nav')) return NodeFilter.FILTER_REJECT;
          el = el.parentNode;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    var textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    for (var i = 0; i < textNodes.length; i++) {
      var node = textNodes[i];
      var text = node.textContent;
      var matches = findMatchesInText(text, term);
      if (!matches || matches.length === 0) continue;

      var lastIndex = 0;
      var fragments = [];
      for (var j = 0; j < matches.length; j++) {
        if (matches[j].start > lastIndex) {
          fragments.push(document.createTextNode(text.substring(lastIndex, matches[j].start)));
        }
        var mark = document.createElement('mark');
        mark.className = '__search_mark';
        mark.textContent = text.substring(matches[j].start, matches[j].end);
        fragments.push(mark);
        lastIndex = matches[j].end;
      }
      if (lastIndex < text.length) {
        fragments.push(document.createTextNode(text.substring(lastIndex)));
      }
      var p = node.parentNode;
      for (var k = 0; k < fragments.length; k++) {
        p.insertBefore(fragments[k], node);
      }
      p.removeChild(node);
    }

    searchMarks = Array.prototype.slice.call(document.querySelectorAll('mark.__search_mark'));
    if (searchMarks.length > 0) {
      currentMatch = 0;
      updateCurrentMatch();
    } else {
      currentMatch = -1;
      searchCount.textContent = '0/0';
    }
  }

  function updateCurrentMatch() {
    // Two marks rather than all of them, which is the whole reason
    // highlightedMatch is tracked. That is only sound while exactly one mark
    // carries '__current' and highlightedMatch names it; both ends hold
    // because every mark is created fresh (performSearch) and every mark is
    // destroyed through clearSearchHighlights, which resets the tracker.
    // Should the two ever drift, the failure is a mark left lit rather than a
    // crash -- classList.add and .remove are no-ops when the token is already
    // in the wanted state, and the bounds checks below catch a stale index
    // into a list that has since shrunk.
    var move = planCurrentMarkMoveCore(highlightedMatch, currentMatch, searchMarks.length);
    if (move.clear >= 0 && searchMarks[move.clear]) {
      searchMarks[move.clear].classList.remove('__current');
    }
    if (move.set >= 0 && searchMarks[move.set]) {
      searchMarks[move.set].classList.add('__current');
    }
    highlightedMatch = move.set;
    if (currentMatch >= 0 && searchMarks[currentMatch]) {
      searchMarks[currentMatch].scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    searchCount.textContent = (currentMatch + 1) + '/' + searchMarks.length;
  }

  function gotoNextMatch() {
    if (searchMarks.length === 0) return;
    currentMatch = (currentMatch + 1) % searchMarks.length;
    updateCurrentMatch();
  }

  function gotoPrevMatch() {
    if (searchMarks.length === 0) return;
    currentMatch = (currentMatch - 1 + searchMarks.length) % searchMarks.length;
    updateCurrentMatch();
  }

  function openSearchBar() {
    sb.style.display = 'flex';
    searchInput.focus();
    searchInput.select();
  }

  function closeSearchBar() {
    sb.style.display = 'none';
    clearSearchHighlights();
    searchInput.value = '';
    searchCount.textContent = '';
    searchCount.style.color = '';
  }

  var searchDebounce = null;

  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      e.stopPropagation();
      openSearchBar();
      return;
    }
    if (e.key === 'Escape' && sb.style.display !== 'none') {
      e.preventDefault();
      closeSearchBar();
      return;
    }
  });

  searchInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) { gotoPrevMatch(); } else { gotoNextMatch(); }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSearchBar();
      return;
    }
  });

  searchInput.addEventListener('input', function() {
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(function() {
      performSearch(searchInput.value);
    }, 150);
  });

  caseBtn.addEventListener('click', function() {
    caseSensitive = !caseSensitive;
    updateToggleVisual(caseBtn, caseSensitive);
    performSearch(searchInput.value);
  });

  regexBtn.addEventListener('click', function() {
    useRegex = !useRegex;
    updateToggleVisual(regexBtn, useRegex);
    performSearch(searchInput.value);
  });

  searchPrev.addEventListener('click', gotoPrevMatch);
  searchNext.addEventListener('click', gotoNextMatch);
  searchClose.addEventListener('click', closeSearchBar);
`;
}

export function getProfilingFilterScript(opts: {
  buttonLabel: string;
  buttonTitle: string;
  closeLabel: string;
  emptyLabel: string;
}): string {
  const btnLabel = JSON.stringify(opts.buttonLabel);
  const btnTitle = JSON.stringify(opts.buttonTitle);
  const closeLabel = JSON.stringify(opts.closeLabel);
  const emptyLabel = JSON.stringify(opts.emptyLabel);
  return `
  // ── Profiling filter panel ──
  // Phase 2 of profiling support: the highlight toggle (built earlier in
  // this script) only ever shows/hides the *decoration* -- the content
  // stays visible either way. This panel actually hides content, scoped to
  // whichever attribute/value combinations the person unchecks, using the
  // data-profile-keys the renderer stamped on every .profiled element.
  // Deliberately a separate control from the highlight toggle: "show me
  // what's flagged" and "show me what this would look like built for X"
  // are different questions, and conflating them into one button would
  // make neither easy to reach.
  var pfPanel = null;
  var pfExcluded = {};

  // Whether the Filter button itself reflects "something is actually being
  // hidden right now" -- mirrors the Flags button's own highlight-on-active
  // treatment (applyProfilingToggle above) so the two controls read the
  // same way. Computed from pfExcluded rather than from panel-open state:
  // the person should still see the button lit up after closing the panel
  // if a filter is still in effect.
  function pfUpdateButtonState() {
    var active = false;
    for (var k in pfExcluded) { if (pfExcluded.hasOwnProperty(k)) { active = true; break; } }
    pfFilterBtn.style.background = active ? 'var(--color-profiling-label-bg)' : '';
    pfFilterBtn.style.color = active ? 'var(--color-profiling-label-text)' : '';
  }

  function pfApplyFilter() {
    var els = document.querySelectorAll('[data-profile-keys]');
    for (var i = 0; i < els.length; i++) {
      var keys = els[i].getAttribute('data-profile-keys').split(',');
      var hide = false;
      for (var j = 0; j < keys.length; j++) {
        if (pfExcluded[keys[j]]) { hide = true; break; }
      }
      els[i].classList.toggle('profile-filtered-out', hide);
    }
    pfUpdateButtonState();
  }

  function pfBuildPanel() {
    var groups = {};
    var groupOrder = [];
    var els = document.querySelectorAll('[data-profile-keys]');
    for (var i = 0; i < els.length; i++) {
      var keys = els[i].getAttribute('data-profile-keys').split(',');
      for (var j = 0; j < keys.length; j++) {
        var parts = keys[j].split(':');
        var attr = decodeURIComponent(parts[0]);
        var val = decodeURIComponent(parts[1]);
        if (!groups[attr]) { groups[attr] = {}; groupOrder.push(attr); }
        groups[attr][val] = keys[j];
      }
    }
    groupOrder.sort();

    // Anchored to the toolbar's own bottom-right corner (computed from its
    // live rect, not a hardcoded offset, so it stays correct if the
    // toolbar's height/width ever changes) rather than the fixed
    // top:40px;left:8px it used to use. Popping up right under the button
    // that opened it, on the same side as the toolbar, means the person
    // never has to move their eyes across the window to find it.
    var toolbarRect = toolbar.getBoundingClientRect();
    var panel = document.createElement('div');
    panel.id = '__profiling_filter_panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', ${btnLabel});
    panel.style.cssText = 'position:fixed;top:' + (toolbarRect.bottom + 6) + 'px;right:8px;z-index:10000;max-height:70vh;overflow:auto;padding:8px 10px;border-radius:5px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:12px;background:var(--vscode-editor-background,rgba(30,30,30,0.95));border:1px solid var(--vscode-widget-border,rgba(255,255,255,0.12));backdrop-filter:blur(4px);box-shadow:0 2px 8px rgba(0,0,0,0.2);color:var(--vscode-foreground,#ccc);min-width:160px;';

    if (groupOrder.length === 0) {
      var empty = document.createElement('div');
      empty.textContent = ${emptyLabel};
      empty.style.cssText = 'color:var(--vscode-descriptionForeground,#999);';
      panel.appendChild(empty);
    }

    for (var g = 0; g < groupOrder.length; g++) {
      var attrName = groupOrder[g];
      var heading = document.createElement('div');
      heading.textContent = attrName.charAt(0).toUpperCase() + attrName.slice(1);
      heading.style.cssText = 'font-weight:600;margin:6px 0 2px;';
      if (g === 0) heading.style.marginTop = '0';
      panel.appendChild(heading);

      var values = Object.keys(groups[attrName]).sort();
      for (var v = 0; v < values.length; v++) {
        var val = values[v];
        var rawKey = groups[attrName][val];
        var row = document.createElement('label');
        row.style.cssText = 'display:flex;align-items:center;gap:5px;padding:1px 0;cursor:pointer;white-space:nowrap;';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !pfExcluded[rawKey];
        (function(key) {
          cb.addEventListener('change', function(e) {
            if (e.target.checked) { delete pfExcluded[key]; } else { pfExcluded[key] = true; }
            pfApplyFilter();
          });
        })(rawKey);
        row.appendChild(cb);
        var txt = document.createElement('span');
        txt.textContent = val;
        row.appendChild(txt);
        panel.appendChild(row);
      }
    }

    var closeLink = document.createElement('a');
    closeLink.href = '#';
    closeLink.setAttribute('role', 'button');
    closeLink.textContent = ${closeLabel};
    closeLink.style.cssText = 'display:block;margin-top:8px;color:var(--vscode-textLink-foreground,#3794ff);cursor:pointer;';
    closeLink.addEventListener('click', function(e) { e.preventDefault(); pfTogglePanel(); });
    panel.appendChild(closeLink);

    return panel;
  }

  function pfTogglePanel() {
    if (pfPanel) {
      pfPanel.remove();
      pfPanel = null;
      return;
    }
    pfPanel = pfBuildPanel();
    document.body.appendChild(pfPanel);
  }

  var pfFilterBtn = document.createElement('button');
  pfFilterBtn.textContent = ${btnLabel};
  pfFilterBtn.title = ${btnTitle};
  pfFilterBtn.setAttribute('aria-label', ${btnTitle});
  pfFilterBtn.style.cssText = btnStyle + 'font-size:11px;';
  pfFilterBtn.addEventListener('click', pfTogglePanel);
  pfUpdateButtonState();
  toolbar.appendChild(pfFilterBtn);
`;
}

// ── Shared toolbar scaffolding (style constants + the toolbar container
// itself) ──
//
// DitaViewerProvider.ts and MapViewerProvider.ts built this same handful of
// lines independently: same style strings, same element, same hover
// behavior. Each provider still owns appendChild ordering for its own
// buttons -- this only emits the shared setup, declaring `tbStyle`,
// `ddStyle`, `btnStyle` and `toolbar` for the rest of each provider's own
// toolbar-building code (including getProfilingFilterScript above, which
// already assumes both) to use.
//
// `previewToolbar` is a raw string, quoted here internally -- same
// convention as getSearchOverlayScript/getProfilingFilterScript above, and
// required by it: sharedWebviewStrings() hands this out as a value both
// providers pass into a function call rather than interpolating directly,
// so it belongs in that function's raw-string group, not the
// pre-JSON.stringify'd group (see the comment on sharedWebviewStrings()
// itself for why the two groups aren't interchangeable).
export function getToolbarScaffoldScript(opts: { previewToolbar: string }): string {
  const previewToolbar = JSON.stringify(opts.previewToolbar);
  return `
  // Toolbar
  var tbStyle = 'position:fixed;top:4px;right:8px;z-index:9999;display:flex;align-items:center;gap:4px;padding:3px 6px;border-radius:5px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:12px;background:var(--vscode-editor-background,rgba(30,30,30,0.88));border:1px solid var(--vscode-widget-border,rgba(255,255,255,0.12));backdrop-filter:blur(4px);opacity:0.75;transition:opacity 0.15s;';
  var ddStyle = 'padding:1px 4px;border-radius:3px;border:1px solid var(--vscode-dropdown-border,var(--vscode-widget-border,#555));background:var(--vscode-dropdown-background,#333);color:var(--vscode-dropdown-foreground,#eee);font-size:11px;outline:none;cursor:pointer;';
  var btnStyle = 'padding:1px 5px;border-radius:3px;border:1px solid var(--vscode-dropdown-border,var(--vscode-widget-border,#555));background:var(--vscode-dropdown-background,#333);color:var(--vscode-dropdown-foreground,#eee);cursor:pointer;font-size:13px;line-height:1;outline:none;display:flex;align-items:center;';

  var toolbar = document.createElement('div');
  toolbar.id = '__toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', ${previewToolbar});
  toolbar.style.cssText = tbStyle;
  toolbar.addEventListener('mouseenter', function() { toolbar.style.opacity = '1'; });
  toolbar.addEventListener('mouseleave', function() { toolbar.style.opacity = '0.75'; });
`;
}

// ── Shared font-preference state (read-back, apply, persist) ──
//
// Declares fontSize/isSerif/SERIF_STACK and the apply/save functions the
// font buttons (getToolbarFontWidthTagTooltipsButtonsScript below) close
// over. Kept as its own script rather than folded into that one: the topic
// viewer applies these prefs immediately on load, before the toolbar itself
// is built, while the map viewer builds them together with the toolbar --
// each provider calls this wherever its own script needs fontSize/isSerif
// to already exist, same effective timing (applied once, immediately) even
// though the textual position differs between the two files.
//
// `setFontPrefsMsgType` is the raw (unquoted) postMessage type string, e.g.
// 'setFontPrefs' -- both providers currently use the exact same value, one
// as a literal and one via a same-valued constant.
export function getFontPrefsScript(opts: { setFontPrefsMsgType: string }): string {
  return `
  var fontPrefs = window.__fontPrefs || { size: 100, serif: false };
  var fontSize = typeof fontPrefs.size === 'number' ? fontPrefs.size : 100;
  var isSerif = fontPrefs.serif === true;
  var SERIF_STACK = "Georgia,'Times New Roman','Noto Serif SC','Songti SC',STSong,SimSun,serif";

  function applyFontPrefs() {
    document.body.style.fontSize = fontSize + '%';
    document.body.style.fontFamily = isSerif ? SERIF_STACK : '';
  }
  applyFontPrefs();

  function saveFontPrefs() {
    vscode.postMessage({ type: '${opts.setFontPrefsMsgType}', size: fontSize, serif: isSerif });
  }
`;
}

// ── Shared font-size/typeface, page-width and tag-tooltip toolbar buttons ──
//
// Builds fsDown/fsUp/fontBtn(/fontResetBtn)/wSel/tagTooltipsBtn and their
// listeners -- everything both providers' toolbars have always agreed on
// byte-for-byte except for two deliberate, still-preserved differences:
// the topic viewer alone has a font-reset button, and the map viewer's
// font-size buttons carry an extra 'font-weight:bold;' the topic viewer's
// don't. Both are opts here rather than silently unified, so this
// extraction doesn't change what either toolbar looks like.
//
// Deliberately does NOT call toolbar.appendChild for any of these: the two
// providers interleave them with their own buttons (theme CSS dropdown,
// mode toggle, refresh, Flags, Filter) in different orders, and forcing one
// shared order would be a visible behavior change this extraction isn't
// meant to make. Each provider appends fsDown/fsUp/fontBtn/(fontResetBtn)/
// wSel/tagTooltipsBtn itself, in whatever order it already used.
//
// All *Label/*Title opts are raw strings, quoted internally -- same
// convention as getSearchOverlayScript/getProfilingFilterScript above (see
// the comment on getToolbarScaffoldScript for why: sharedWebviewStrings()
// hands these out as values passed into a function call, which belongs in
// that function's raw-string group).
export function getToolbarFontWidthTagTooltipsButtonsScript(opts: {
  decreaseFontSize: string;
  increaseFontSize: string;
  fontSans: string;
  fontSerif: string;
  fontCurrentSans: string;
  fontCurrentSerif: string;
  fontSizeButtonExtraStyle: string; // raw CSS text appended after btnStyle, e.g. '' or 'font-weight:bold;'
  includeFontReset: boolean;
  resetFont?: string; // required (raw string) when includeFontReset is true
  widthAuto: string;
  widthFull: string;
  widthWide: string;
  widthDesktop: string;
  widthNarrow: string;
  pageWidth: string;
  setWidthSelectionMsgType: string; // raw, e.g. 'setWidthSelection'
  tagTooltipsLabel: string;
  tagTooltipsOnTitle: string;
  tagTooltipsOffTitle: string;
  setTagTooltipsMsgType: string; // raw, e.g. 'setTagTooltips'
}): string {
  const decreaseFontSize = JSON.stringify(opts.decreaseFontSize);
  const increaseFontSize = JSON.stringify(opts.increaseFontSize);
  const fontSans = JSON.stringify(opts.fontSans);
  const fontSerif = JSON.stringify(opts.fontSerif);
  const fontCurrentSans = JSON.stringify(opts.fontCurrentSans);
  const fontCurrentSerif = JSON.stringify(opts.fontCurrentSerif);
  const widthAuto = JSON.stringify(opts.widthAuto);
  const widthFull = JSON.stringify(opts.widthFull);
  const widthWide = JSON.stringify(opts.widthWide);
  const widthDesktop = JSON.stringify(opts.widthDesktop);
  const widthNarrow = JSON.stringify(opts.widthNarrow);
  const pageWidth = JSON.stringify(opts.pageWidth);
  const tagTooltipsLabel = JSON.stringify(opts.tagTooltipsLabel);
  const tagTooltipsOnTitle = JSON.stringify(opts.tagTooltipsOnTitle);
  const tagTooltipsOffTitle = JSON.stringify(opts.tagTooltipsOffTitle);
  const fsExtra = opts.fontSizeButtonExtraStyle;
  const fontResetBlock = opts.includeFontReset ? `
  // Reset font size + family to default in one click
  var fontResetBtn = document.createElement('button');
  fontResetBtn.innerHTML = '&#8635;';
  fontResetBtn.title = ${JSON.stringify(opts.resetFont)};
  fontResetBtn.setAttribute('aria-label', ${JSON.stringify(opts.resetFont)});
  fontResetBtn.style.cssText = btnStyle + 'font-size:12px;';
  fontResetBtn.addEventListener('click', function() {
    fontSize = 100;
    isSerif = false;
    applyFontPrefs();
    fontBtn.textContent = ${fontSans};
    fontBtn.title = ${fontCurrentSans};
    fontBtn.setAttribute('aria-label', ${fontCurrentSans});
    saveFontPrefs();
  });
` : '';
  return `
  // Font size controls
  var fsDown = document.createElement('button');
  fsDown.innerHTML = 'A\u2212';
  fsDown.title = ${decreaseFontSize};
  fsDown.setAttribute('aria-label', ${decreaseFontSize});
  fsDown.style.cssText = btnStyle + '${fsExtra}';
  fsDown.addEventListener('click', function() {
    fontSize = Math.max(60, fontSize - 10);
    document.body.style.fontSize = fontSize + '%';
    saveFontPrefs();
  });

  var fsUp = document.createElement('button');
  fsUp.innerHTML = 'A+';
  fsUp.title = ${increaseFontSize};
  fsUp.setAttribute('aria-label', ${increaseFontSize});
  fsUp.style.cssText = btnStyle + '${fsExtra}';
  fsUp.addEventListener('click', function() {
    fontSize = Math.min(200, fontSize + 10);
    document.body.style.fontSize = fontSize + '%';
    saveFontPrefs();
  });

  // Font toggle (serif / sans-serif) -- reflects the persisted state on open
  var fontBtn = document.createElement('button');
  fontBtn.textContent = isSerif ? ${fontSerif} : ${fontSans};
  fontBtn.title = isSerif ? ${fontCurrentSerif} : ${fontCurrentSans};
  fontBtn.setAttribute('aria-label', isSerif ? ${fontCurrentSerif} : ${fontCurrentSans});
  fontBtn.style.cssText = btnStyle + 'font-size:11px;';
  fontBtn.addEventListener('click', function() {
    isSerif = !isSerif;
    fontBtn.textContent = isSerif ? ${fontSerif} : ${fontSans};
    fontBtn.title = isSerif ? ${fontCurrentSerif} : ${fontCurrentSans};
    fontBtn.setAttribute('aria-label', isSerif ? ${fontCurrentSerif} : ${fontCurrentSans});
    document.body.style.fontFamily = isSerif ? SERIF_STACK : '';
    saveFontPrefs();
  });
${fontResetBlock}
  // Page width dropdown
  var widths = [
    { label: ${widthAuto}, value: '' },
    { label: ${widthFull}, value: '100%' },
    { label: ${widthWide}, value: '1400px' },
    { label: ${widthDesktop}, value: '1280px' },
    { label: ${widthNarrow}, value: '720px' },
  ];
  var wSel = document.createElement('select');
  wSel.title = ${pageWidth};
  wSel.setAttribute('aria-label', ${pageWidth});
  wSel.style.cssText = 'max-width:72px;' + ddStyle;
  var restoredWidth = window.__widthSelection || '';
  for (var i = 0; i < widths.length; i++) {
    var opt = document.createElement('option');
    opt.value = widths[i].value;
    opt.textContent = widths[i].label;
    if (widths[i].value === restoredWidth) opt.selected = true;
    wSel.appendChild(opt);
  }
  function applyWidth(value) {
    document.body.style.maxWidth = value;
    document.body.style.margin = value ? '0 auto' : '';
  }
  if (restoredWidth) applyWidth(restoredWidth);
  wSel.addEventListener('change', function() {
    applyWidth(wSel.value);
    vscode.postMessage({ type: '${opts.setWidthSelectionMsgType}', value: wSel.value });
  });

  // Tag-name tooltip toggle
  var tagTooltipsOn = window.__tagTooltips === true;
  var tagTooltipsBtn = document.createElement('button');
  tagTooltipsBtn.textContent = ${tagTooltipsLabel};
  tagTooltipsBtn.style.cssText = btnStyle + 'font-size:11px;';
  function applyTagTooltips() {
    var contentRoot = document.getElementById('dita-content-root');
    var els = contentRoot ? contentRoot.querySelectorAll('[data-dita-tagname]') : [];
    for (var i = 0; i < els.length; i++) {
      if (tagTooltipsOn) els[i].setAttribute('title', els[i].getAttribute('data-dita-tagname'));
      else els[i].removeAttribute('title');
    }
    tagTooltipsBtn.style.background = tagTooltipsOn ? 'var(--color-profiling-label-bg)' : '';
    tagTooltipsBtn.style.color = tagTooltipsOn ? 'var(--color-profiling-label-text)' : '';
    tagTooltipsBtn.title = tagTooltipsOn ? ${tagTooltipsOnTitle} : ${tagTooltipsOffTitle};
    tagTooltipsBtn.setAttribute('aria-label', tagTooltipsOn ? ${tagTooltipsOnTitle} : ${tagTooltipsOffTitle});
  }
  tagTooltipsBtn.addEventListener('click', function() {
    tagTooltipsOn = !tagTooltipsOn;
    applyTagTooltips();
    vscode.postMessage({ type: '${opts.setTagTooltipsMsgType}', value: tagTooltipsOn });
  });
  applyTagTooltips(); // reflects a persisted "on" against the initial content; a no-op walk when off, but only once per panel open
`;
}
