import { existsSync, readFileSync, openSync, readSync, closeSync, statSync, readdirSync } from 'fs';
import { resolve, join, dirname, relative, isAbsolute, extname, normalize } from 'path';
import { DitaNode } from '../parser/domTypes';
import { parseDita, parseDitamap, preprocessEntities } from '../parser/ditaParser';
import { renderDocument } from '../render/renderer';
import type { MapEntry } from '../render/mapTypeMap';
import { isDitamapRef } from '../render/mapTypeMap';
import type { BookPart } from './bookPatch';
import { sourceStamp, readSourceText, noteSourceDependencies } from './sourceText';

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
      const content = readSourceText(absPath, 'utf-8');
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
 *
 * Reads the DISK, not the unsaved editor text (sourceText.ts), on purpose:
 * this only picks the sidebar's topic-type chip, and changing a topic's root
 * element while it is unsaved is rare enough that the chip catching up on
 * save is not worth a second overlay-aware read path over a partial file
 * read.
 */
function sniffRootTagName(absPath: string): string | undefined {
  // Reads the head of the file outside readSourceText, so report it by hand:
  // a panel drops change events for files its last render did not read, and
  // this file's root tag is something the render shows.
  noteSourceDependencies([absPath]);
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

/** Renders `<div data-book-anchor="...">` when anchorId is given, nothing
 *  extra otherwise -- shared by renderBookPlaceholder/renderBookError/
 *  renderBookParts' own inline topic wrapper so the three places book mode
 *  writes a `.book-entry` root all spell the attribute the same way. See
 *  renderBookParts' own comment for where anchorId comes from and why it is
 *  absent for some parts (a duplicate reference, an external/.ditamap href,
 *  a childless hrefless entry -- anything buildBookNavManifest itself drops
 *  and the sidebar therefore never links to). */
function bookAnchorAttr(anchorId: string | undefined): string {
  return anchorId ? ` data-book-anchor="${escapeAttr(anchorId)}"` : '';
}

export function renderBookPlaceholder(displayName: string, depth: number, anchorId?: string): string {
  const level = Math.min(1 + depth, 6);
  return `<div class="book-entry book-entry--placeholder"${bookAnchorAttr(anchorId)}>
  <h${level} class="book-section-heading">${escapeAttr(displayName)}</h${level}>
</div>`;
}

export function renderBookError(displayName: string, errorMsg: string, depth: number, anchorId?: string): string {
  const level = Math.min(1 + depth, 6);
  return `<div class="book-entry book-entry--error"${bookAnchorAttr(anchorId)}>
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
  /** See TopicXmlRenderInput.bookMembers below; passed through untouched. */
  bookMembers?: ReadonlySet<string>;
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
  /**
   * Absolute paths of every topic that is part of the current book/docsite
   * render -- passed straight to RenderContext.isInCurrentBook (see that
   * field's own doc comment for why a cross-file xref's clickability
   * depends on this). Undefined for standalone single-topic preview and
   * "Export as HTML", which is exactly when a cross-file xref should keep
   * rendering as the non-clickable xref-external hint it always has.
   *
   * A ReadonlySet, not a plain array: renderBookParts/MapViewerProvider
   * build this once per book and hand the SAME instance to every topic's
   * render call, which renderTopicCached leans on for its own cache key
   * (compared by identity, exactly like keyMap) -- membership lookups
   * would work the same with an array, but identity comparison is the
   * whole point here.
   */
  bookMembers?: ReadonlySet<string>;
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
  readFile: FileReader = readSourceText,
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
  const { xml, docDir, keyMap, asWebviewUri, headingLevel, uiLanguage, suppressIndexterm, collectDependencies, bookMembers } = input;
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

    // Same local-reference guard makeFileTitleResolver applies before ever
    // touching the filesystem: never probe for a URL-scheme or absolute
    // href, and a fragment-only href has no file part to resolve.
    const isInCurrentBook = bookMembers
      ? (href: string): string | undefined => {
          if (!href || URL_SCHEME_RE.test(href) || isAbsolute(href)) return undefined;
          const pathPart = href.split('#')[0];
          if (!pathPart) return undefined;
          const absPath = resolve(docDir, decodeHrefPart(pathPart));
          return bookMembers.has(absPath) ? absPath : undefined;
        }
      : undefined;

    const html = renderDocument(ditaDoc.root, {
      headingLevel,
      asWebviewUri,
      documentDir: docDir,
      resolveTitle,
      isInCurrentBook,
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
  const { filePath, keyMap, asWebviewUri, headingLevel, uiLanguage, suppressIndexterm, collectDependencies, bookMembers } = input;
  try {
    if (!existsSync(filePath)) {
      return { html: '', error: `File not found: ${filePath}` };
    }
    // The topic's own file is a dependency of its own render even though it
    // is read here rather than through the shared file cache.
    collectDependencies?.add(filePath);
    const rawXml = readSourceText(filePath, 'utf-8');
    const result = renderTopicXml({
      xml: rawXml,
      docDir: dirname(filePath),
      keyMap,
      asWebviewUri,
      headingLevel,
      uiLanguage,
      suppressIndexterm,
      collectDependencies,
      bookMembers,
    });
    return { html: result.html, title: result.title, error: result.error };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { html: '', error: `Error rendering ${filePath}: ${message}` };
  }
}

// ── Topic render cache (book mode) ──

/**
 * Fingerprint of a set of files, used to decide whether a cached result
 * derived from them is still valid: one sourceStamp per file (sourceText.ts
 * has the rules, including how a missing file and a changed size count),
 * joined in order.
 *
 * Shared by buildKeyMap's cache (keyMap.ts), renderTopicCached below and
 * the book search index. It lived privately in the first until the topic
 * cache needed the identical logic; keeping one copy is the point.
 */
export function stampFiles(files: string[]): string {
  return files.map(sourceStamp).join('|');
}

/**
 * Pure directory-walking core of findDitamapFiles (keyMap.ts). Lives here
 * rather than there for the same reason stampFiles above does: keyMap.ts
 * imports vscode at module scope for parseDocRoot/vscode.Uri, so nothing
 * defined there can be unit tested without a vscode.Uri/workspace, even
 * logic like this that never touches vscode itself.
 *
 * Walks upward from startDir to root (inclusive); at *each* level it scans
 * that directory's whole subtree, not just its direct children, for
 * .ditamap files -- layouts that keep maps/ and topics/ as siblings (see
 * test-dita-file/manual) put the nearest map one directory below the
 * ancestor level being scanned, so a direct-children-only scan at each
 * ancestor silently misses it and buildKeyMap falls back to whichever
 * unrelated .ditamap happens to sit directly in a further-up ancestor, if
 * any, instead of the real one (kill test: keyMap.test.ts).
 */
export function collectDitamapFilesUpward(startDir: string, root: string, stopAtFirstMatch: boolean): string[] {
  const results: string[] = [];
  // A directory two ancestor levels up recursively covers everything a
  // closer level already scanned, so without this a .ditamap nested a
  // couple of directories down would be reported once per ancestor level
  // that subsumes it, not once.
  const visited = new Set<string>();
  let dir = startDir;
  while (dir.length >= root.length) {
    collectDitamapFilesRecursive(dir, results, visited);
    if (stopAtFirstMatch && results.length > 0) return results;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return results;
}

function collectDitamapFilesRecursive(dir: string, results: string[], visited: Set<string>): void {
  if (visited.has(dir)) return;
  visited.add(dir);
  let entries: import('fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    console.warn(`Failed to read directory ${dir}:`, e instanceof Error ? e.message : e);
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectDitamapFilesRecursive(full, results, visited);
    } else if (entry.name.toLowerCase().endsWith('.ditamap')) {
      results.push(full);
    }
  }
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
  /** Compared by identity, same rationale as keyMap above -- the same
   *  topic renders different HTML (a cross-file xref is a real link or
   *  not) depending on which book's membership set it was rendered
   *  against, so a stale entry from a different book must never answer
   *  for this one. renderBookParts/MapViewerProvider hand the same Set
   *  instance to every topic in one book's render pass, so this stays a
   *  cheap identity check rather than a per-render content comparison. */
  bookMembers: ReadonlySet<string> | undefined;
  /** Retained size of html, stored so eviction can subtract it without
   *  re-measuring every entry. */
  bytes: number;
}

const topicRenderCache = new Map<string, TopicRenderCacheEntry>();
let topicRenderCacheBytes = 0;
let topicRenderCacheBudget = TOPIC_RENDER_CACHE_MAX_BYTES;

/**
 * Keeps the same bookMembers Set instance alive across render passes of the
 * same open map when its actual membership hasn't changed -- which is the
 * overwhelmingly common case (editing a topic's own content, the debounced
 * trigger for nearly every book-mode re-render, changes nothing about which
 * topics the book references). renderTopicCached's own cache keys the
 * bookMembers field by identity, same rationale as keyMap (see
 * TopicRenderCacheEntry.bookMembers) -- without this, renderBookParts
 * handing a freshly `new Set()`-built membership to every single pass would
 * silently defeat topic-render reuse across every re-render, not just ones
 * that actually changed the map's topicref list.
 *
 * Keyed by docDir (one open map, one docDir -- matches buildKeyMap's own
 * cache granularity in keyMap.ts) and fingerprinted by the resolved
 * absolute-path list itself (cheap: pure path resolution already computed
 * to build the set, no extra disk I/O), not by entries' own object
 * identity -- entries is rebuilt fresh from freshly re-parsed map XML on
 * every render pass regardless of whether anything in it actually changed.
 */
interface BookMembersCacheEntry {
  fingerprint: string;
  members: Set<string>;
}
const bookMembersCache = new Map<string, BookMembersCacheEntry>();
const BOOK_MEMBERS_CACHE_MAX = 50;

/** Part of clearAllCaches() in DitaViewerProvider.ts, same as clearKeyMapCache. */
export function clearBookMembersCache(): void {
  bookMembersCache.clear();
}

function getStableBookMembers(entries: MapEntry[], docDir: string): ReadonlySet<string> {
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.resourceOnly) continue; // never rendered as its own page -- not a book member for xref-target purposes either
    const absPath = resolveBookTopicPath(entry, docDir);
    if (absPath) paths.push(absPath);
  }
  // \u0000 can't appear in a filesystem path, so this join is collision-free
  // the same way TopicRenderCacheEntry's own cache key delimiter is.
  const fingerprint = paths.join('\u0000');
  const cached = bookMembersCache.get(docDir);
  if (cached && cached.fingerprint === fingerprint) return cached.members;

  if (bookMembersCache.size >= BOOK_MEMBERS_CACHE_MAX && !bookMembersCache.has(docDir)) {
    const oldest = bookMembersCache.keys().next().value;
    if (oldest !== undefined) bookMembersCache.delete(oldest);
  }
  const members = new Set(paths);
  bookMembersCache.set(docDir, { fingerprint, members });
  return members;
}

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
    cached.bookMembers === input.bookMembers &&
    stampFiles(cached.files) === cached.stamps
  ) {
    // Re-insert so a hit keeps the entry from being the oldest (and therefore
    // first-evicted) candidate -- same LRU-by-reinsertion as
    // imageDimensionsCache above.
    topicRenderCache.delete(key);
    topicRenderCache.set(key, cached);
    // A hit reads nothing, but the answer still stands for these files.
    noteSourceDependencies(cached.files);
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
    // whose stamp gets compared.
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
    bookMembers: input.bookMembers,
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
  // External resources (keydefs/topicrefs pointing at https:, mailto:, ...)
  // are links, not book members. Without this guard resolve() would splice
  // the URL onto docDir -- on Windows a topicref/keydef href of
  // "https://support.example.com" used to surface as the nonsense path
  // <docDir>\https:\support.example.com and blow up docsite/book mode with
  // "File not found". Same guard isInCurrentBook and the title/type
  // resolvers apply before touching the filesystem. (Drive-rooted hrefs
  // like "/topics/x.dita" stay resolvable on purpose -- resolve() already
  // handles them against docDir's own drive.)
  if (URL_SCHEME_RE.test(refPath)) return undefined;
  return resolve(docDir, decodeHrefPart(refPath));
}

export interface DocsiteNavEntry {
  /** Stable identifier for this entry, used to key persisted UI state
   *  (sidebar collapsed/expanded) across re-renders of the same map --
   *  see buildBookNavManifest's own comment for how it's computed.
   *  Optional (rather than required) so every existing call site that
   *  constructs a DocsiteNavEntry by hand for a test of renderSiteNavHtml/
   *  buildSiteNavTree/buildBookSearchIndex, none of which read this
   *  field, doesn't have to grow one just to satisfy the type checker;
   *  buildBookNavManifest itself always populates it. */
  id?: string;
  /** Resolved absolute path -- the same identity renderBookParts's own
   *  `visited` set and de-duplication use, and what the "is this xref
   *  target part of the current book" check (docsite design doc, 3.2/4.5;
   *  see the book members set in MapViewerProvider) keys off of. Undefined
   *  exactly when isGroup is true (see below) --
   *  a group entry has no topic file of its own to resolve one from. */
  absPath?: string;
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
  /** True for an entry with no topic of its own to navigate to -- a
   *  <topichead> (pure heading, no href by definition) or an href-less
   *  topicref used purely as a grouping container -- kept in the
   *  manifest anyway (rather than dropped, which is what happened before
   *  this field existed) purely so its real, navigable descendants have
   *  a labeled branch to nest under in the sidebar tree. See
   *  buildBookNavManifest's own comment for why an href-less entry with
   *  no descendants (a bare key-only topicref/keydef used only for
   *  keyref text substitution) is dropped rather than becoming an empty
   *  isGroup entry. Matches how tree mode already renders a topichead as
   *  a non-clickable heading with the same nested-children shape
   *  (map/topichead in mapTypeMap.ts) and how book mode already renders
   *  one as a plain section heading (renderBookParts's own `struct:`
   *  placeholder branch). renderSiteNavHtml skips the link markup
   *  entirely for a group entry -- title text only, no data-site-target,
   *  no click-to-navigate -- and every consumer that otherwise assumes
   *  every manifest entry has a real topic file behind it (search
   *  indexing, the initial/fallback page, book-membership checks) must
   *  filter these out first; see MapViewerProvider.ts's own
   *  siteNavigableEntries. */
  isGroup?: boolean;
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
 *
 * entry.resourceOnly is checked before anything else, group entries
 * included -- a resource-only <topichead> (unusual, but not invalid) is
 * skipped outright rather than surfaced as an empty group, same as a
 * resource-only real topic is skipped rather than surfaced as a page.
 *
 * The returned entries' depth values are COMPACTED, not copied straight
 * from MapEntry.depth: skipping an entry (resource-only, a duplicate
 * topic, a dropped childless hrefless entry) also promotes everything
 * that survives underneath it by however many ancestors were skipped, so
 * the output tree never has a surviving entry stranded one level deeper
 * than a parent that no longer exists in it.
 */
/**
 * The per-entry position (stable id + compacted depth) buildBookNavManifest
 * itself gives each surviving entry -- or undefined for one it drops
 * entirely (resource-only, a duplicate topic path already seen earlier in
 * this same pass, or a childless hrefless entry). Parallel to `entries`:
 * same length, same order, index-for-index.
 *
 * Factored out of buildBookNavManifest so a second consumer needing the
 * exact same per-entry id -- renderBookParts, for book mode's own scroll-to
 * anchors (nested-fold-and-highlight-plan.md item 1) -- reads it off
 * directly instead of re-deriving this stack a second time. Two independent
 * copies of "which sibling number is this" is exactly the kind of drift a
 * prior fix (mapref depth transparency, 2ae5729) already had to clean up
 * once for the depth side of this same stack; the id side deserves the same
 * caution. Fresh state every call -- calling this twice on the same
 * entries/docDir (as buildBookNavManifest and renderBookParts each do) is
 * safe and gives identical results, since nothing is cached or shared
 * across calls.
 *
 * Depth compaction: entries carry their ORIGINAL depth from the full,
 * unfiltered map structure (collectMapEntries) -- but a skipped entry
 * (resource-only, a duplicate reference, or a childless hrefless entry
 * dropped outright below) must not leave a "hole" that pushes its own
 * surviving descendants one level deeper in the sidebar tree than they
 * should sit. survivingAncestors holds the ORIGINAL depth of every
 * still-open ancestor that DID survive, in nesting order; its length at
 * any point is exactly the entry now being considered's own compacted
 * depth (no surviving ancestor open above it -> depth 0; one -> depth 1;
 * and so on). A skipped entry is simply never pushed onto it, so whatever
 * survives right after it re-parents to the next real ancestor still on
 * the stack -- e.g. a topichead marked resource-only that would otherwise
 * have grouped three real topics underneath it: those three now surface
 * as depth-0 siblings instead of stranded, unreachable depth-1 orphans
 * with no depth-0 parent left in the output tree for buildSiteNavTree
 * (renderSiteNavHtml) to nest them under.
 *
 * id computation runs alongside the depth-compaction stack, on exactly the
 * same "did this entry actually survive" logic -- a skipped entry consumes
 * no sibling slot, for the same reason it leaves no depth hole: a later
 * sibling's id must not depend on how many entries ahead of it happened to
 * get filtered out, or persisted collapsed state would silently point at
 * the wrong node the next time the map gains or loses an unrelated
 * resource-only entry.
 *
 * ancestorIndices holds, for every still-open surviving ancestor (kept in
 * lockstep with survivingAncestors -- same push/pop sites), the sibling
 * index THAT ancestor was itself given when it was emitted; a group's own
 * id is 'grp:' + those ancestor indices plus its own, dot-joined (e.g.
 * 'grp:0.2' for the third child of the first top-level group) --
 * positional, not title-based, since two <topichead> group headers
 * commonly share the exact same navtitle text, and the same title can also
 * be re-localized out from under a stored id when the UI language changes.
 *
 * childCounts[d] is the next sibling index to hand out at compacted depth
 * d under the currently-open parent chain; truncated to exactly depth+1
 * entries every iteration (dropping any deeper level's leftover counter
 * from a now-closed branch, extending with a fresh 0 the first time this
 * depth is reached under the current parent) so numbering restarts
 * correctly every time a shallower sibling closes off a branch, the same
 * "no ancestor -> depth 0" invariant survivingAncestors itself already
 * relies on.
 */
function computeManifestEntryPositions(
  entries: MapEntry[],
  docDir: string,
): ({ id: string; depth: number } | undefined)[] {
  const seen = new Set<string>();
  const positions: ({ id: string; depth: number } | undefined)[] = [];
  const survivingAncestors: number[] = [];
  const ancestorIndices: number[] = [];
  const childCounts: number[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    while (survivingAncestors.length > 0 && survivingAncestors[survivingAncestors.length - 1] >= entry.depth) {
      survivingAncestors.pop();
      ancestorIndices.pop();
    }
    const depth = survivingAncestors.length;
    if (childCounts.length > depth + 1) childCounts.length = depth + 1;
    if (childCounts.length <= depth) childCounts.push(0);

    if (entry.resourceOnly) { positions.push(undefined); continue; } // exists purely to be pulled in via keyref/conref elsewhere, never its own page
    if (!entry.href) {
      // No topic file of its own -- either a <topichead> (which by
      // definition never has one) or a bare key-only topicref/keydef
      // (used purely for keyref text substitution, e.g.
      // <topicref keys="product_version"><topicmeta><linktext>1.0
      // </linktext></topicmeta></topicref>, with no navigable content of
      // its own either). Those two cases look identical on a MapEntry (no
      // baseType/tagName carried through), so they're told apart the only
      // way that's actually meaningful for the sidebar: does this entry
      // have anything nested under it. A topichead grouping real
      // topicrefs has entries[i+1..] at a deeper ORIGINAL depth right
      // after it (compaction doesn't change whether one entry nests
      // under another in the source map, only what depth number a
      // surviving entry is labeled with) and becomes a group header; a
      // leaf key-only topicref has nothing deeper following it and is
      // dropped, exactly as it always was before group headers existed
      // -- showing an unclickable, childless "V1.0.0" row in the reading
      // sidebar for what is really just a keyref variable would be pure
      // noise, not navigation.
      const hasChildren = i + 1 < entries.length && entries[i + 1].depth > entry.depth;
      if (hasChildren) {
        const siblingIndex = childCounts[depth]++;
        const id = 'grp:' + [...ancestorIndices, siblingIndex].join('.');
        positions.push({ id, depth });
        survivingAncestors.push(entry.depth);
        ancestorIndices.push(siblingIndex);
      } else {
        positions.push(undefined);
      }
      continue;
    }
    const absPath = resolveBookTopicPath(entry, docDir);
    if (!absPath || seen.has(absPath)) { positions.push(undefined); continue; } // same one-entry-per-topic rule renderBookParts's own `visited` set enforces
    seen.add(absPath);
    // A navigable entry's absPath is already unique (the `seen` dedup
    // above guarantees it) and stays meaningful across a document's own
    // edits in a way a positional path wouldn't, so it doubles as the
    // entry's id directly rather than getting its own 'grp:'-style
    // synthetic one. It still consumes a sibling slot in childCounts
    // (via siblingIndex below) purely so a LATER, deeper group nested
    // under this entry gets a correctly-numbered ancestor prefix -- a
    // real topic can itself have further topicrefs nested under it in
    // the map, same as a topichead can.
    const siblingIndex = childCounts[depth]++;
    positions.push({ id: absPath, depth });
    survivingAncestors.push(entry.depth);
    ancestorIndices.push(siblingIndex);
  }
  return positions;
}

export function buildBookNavManifest(
  entries: MapEntry[],
  docDir: string,
  resolveTopicTitle?: (href: string) => string | undefined,
  resolveTopicType?: (href: string) => string | undefined,
): DocsiteNavEntry[] {
  const positions = computeManifestEntryPositions(entries, docDir);
  const result: DocsiteNavEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const pos = positions[i];
    if (!pos) continue;
    if (!entry.href) {
      result.push({ id: pos.id, title: entry.displayName, depth: pos.depth, role: entry.role, isGroup: true });
      continue;
    }
    let title = entry.displayName;
    if (resolveTopicTitle) {
      const realTitle = resolveTopicTitle(entry.href);
      if (realTitle) title = realTitle;
    }
    const topicType = resolveTopicType ? resolveTopicType(entry.href) : undefined;
    // pos.id is this navigable entry's absPath (see computeManifestEntryPositions),
    // so it doubles as `absPath` directly rather than resolving it again here.
    result.push({ id: pos.id, absPath: pos.id, title, depth: pos.depth, role: entry.role, topicType });
  }
  return result;
}

/**
 * The subset of a docsite manifest that actually has a topic file behind
 * it -- every entry except a group header (DocsiteNavEntry.isGroup; see
 * its own comment). buildBookNavManifest's result is the sidebar's own
 * data source and needs the group headers to build its nested tree, but
 * anything treating the manifest as "the list of pages/files in this
 * book" (full-text search indexing, the book-membership set xref
 * resolution checks against, picking a fallback/first page to land on)
 * would misbehave on an absPath-less entry -- this is the one place that
 * filter lives, rather than every one of those call sites repeating
 * `.filter((m) => m.absPath !== undefined)` (and the type narrowing that
 * goes with it) on its own.
 */
export function siteNavigableEntries(manifest: DocsiteNavEntry[]): (DocsiteNavEntry & { absPath: string })[] {
  return manifest.filter((entry): entry is DocsiteNavEntry & { absPath: string } => entry.absPath !== undefined);
}

/** One manifest entry plus the direct children nested under it, built by
 *  buildSiteNavTree below. The manifest itself never carries parent/child
 *  links (see DocsiteNavEntry's own comment -- it's a flat, already-in-
 *  reading-order list keyed only by depth), so this is the one place that
 *  shape gets turned into an actual tree, purely for renderSiteNavHtml's
 *  own nested-<ul> output. */
interface SiteNavTreeNode {
  entry: DocsiteNavEntry;
  children: SiteNavTreeNode[];
}

/**
 * Groups a flat, depth-annotated manifest into a tree via a simple
 * ancestor stack: each entry becomes a child of the most recent
 * still-open entry with a strictly shallower depth (popping anything at
 * the same depth or deeper off the stack first, since those branches are
 * now closed). Works for irregular depth jumps the same way a strictly-
 * incrementing manifest would -- it only ever compares each entry's depth
 * to the stack, never assumes a fixed step of 1.
 */
function buildSiteNavTree(manifest: readonly DocsiteNavEntry[]): SiteNavTreeNode[] {
  const roots: SiteNavTreeNode[] = [];
  const stack: SiteNavTreeNode[] = [];
  for (const entry of manifest) {
    const node: SiteNavTreeNode = { entry, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].entry.depth >= entry.depth) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

/** Width, in px, reserved in front of every entry's title for the
 *  expand/collapse toggle -- reserved at every depth (not just where a
 *  toggle actually renders) so a leaf's title still lines up under its
 *  parent's title rather than jumping left by one toggle's width. */
const SITE_NAV_TOGGLE_SLOT = 16;

/**
 * Docsite mode's sidebar -- one link per topic, nested and indented by
 * depth to match the map's own structure, the current page marked active.
 * Parent entries (anything with at least one entry nested under it) get an
 * expand/collapse toggle to their left, Oxygen-style; leaves don't, but
 * still reserve that same width (SITE_NAV_TOGGLE_SLOT) so titles at a
 * given depth line up whether or not that particular row has a toggle.
 * Collapsing/expanding is pure client-side state (getSiteNavToggleScript)
 * -- which topics exist and how they nest never changes just because a
 * branch is tucked away, so this function never needs to know about
 * collapsed state at all, and this HTML is still rendered exactly once and
 * left alone afterward: switching pages toggles the `active` class
 * client-side (see the webview script's .site-nav-link click handler)
 * rather than re-rendering this nav on every page change.
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
 *
 * toggleLabels is optional (defaults to English) rather than required so
 * every existing caller/test that only cares about the link markup itself
 * doesn't have to thread localized strings through just to satisfy the
 * type checker.
 */
/**
 * Just the `<ul class="site-nav-tree">` of sidebar rows -- renderSiteNavHtml
 * below wraps this in `<nav class="site-nav">`. Split out so a content-only
 * refresh (book mode's own incremental sidebar update,
 * nested-fold-and-highlight-plan.md item 1 -- see MSG_UPDATE_SIDEBAR in
 * MapViewerProvider.ts) can replace just this element's innerHTML client-
 * side, leaving the outer `<nav class="site-nav">` DOM node itself
 * untouched. That matters because getSiteSidebarResizerScript captures
 * that exact node once, at script-init time (`document.querySelector(
 * '.site-nav')`), and never re-queries it afterward -- replacing the whole
 * `<nav>` via outerHTML on every content edit would leave the resizer
 * silently holding a reference to a now-detached element, and dragging it
 * would do nothing. Site mode never needs this: its own page-switch
 * content-only update intentionally leaves the sidebar alone entirely (see
 * postSitePageUpdate's own comment) rather than refreshing it, so
 * renderSiteNavHtml stays the only entry point there.
 *
 * `collapsedIds` (nested-fold-and-highlight-plan.md item 3, persisted
 * collapse state) renders the matching rows already collapsed on arrival,
 * rather than rendering everything expanded and having a script collapse
 * them afterward -- that would flash open before snapping shut on every
 * load, exactly the "render collapsed initial state directly" requirement
 * the plan itself calls out. Membership is checked against
 * DocsiteNavEntry.id (buildBookNavManifest's stable id -- see its own
 * comment), which is also what gets stamped onto the row as
 * data-nav-id so the client can report it back after a toggle
 * (getSiteNavCollapseStateHelperScript's reportSiteNavCollapseState). A
 * hand-built manifest in a test that never sets `id` simply never
 * matches and never gets the attribute -- both are optional, not a
 * fallback onto title or position, for the exact reason buildBookNavManifest's
 * own id computation avoids title-keying: it would silently merge two
 * same-named branches' collapse state.
 */
export function renderSiteNavTreeHtml(
  manifest: DocsiteNavEntry[],
  currentAbsPath: string,
  toggleLabels: { expand: string; collapse: string } = { expand: 'Expand', collapse: 'Collapse' },
  collapsedIds: ReadonlySet<string> = new Set(),
  revealActive = false,
): string {
  const expandLabel = escapeAttr(toggleLabels.expand);
  const collapseLabel = escapeAttr(toggleLabels.collapse);

  const tree = buildSiteNavTree(manifest);

  // With revealActive (site mode), every ancestor of the active page is
  // rendered expanded whatever collapsedIds says. Site mode re-renders the
  // whole page, sidebar included, on every open and every edit; honouring a
  // persisted collapse on the branch that holds the page being read would
  // hide the one row that says where the reader is, with nothing to explain
  // why. Book mode leaves this off: its `currentAbsPath` is only the
  // initial highlight (the first topic) and book mode's own scroll-sync
  // decides what to reveal as the reader actually scrolls.
  const ancestorsOfActive = new Set<SiteNavTreeNode>();
  if (revealActive) {
    const mark = (nodes: SiteNavTreeNode[]): boolean => {
      let found = false;
      for (const n of nodes) {
        const inChildren = mark(n.children);
        if (inChildren) ancestorsOfActive.add(n);
        if (inChildren || (!n.entry.isGroup && n.entry.absPath !== undefined && n.entry.absPath === currentAbsPath)) found = true;
      }
      return found;
    };
    mark(tree);
  }

  // Roving tabindex (the ARIA tree pattern): the whole tree is ONE Tab stop,
  // and arrow keys move within it (getSiteNavKeyboardScript). Without it every
  // topic link and every fold toggle is its own stop, and a large map takes
  // hundreds of Tab presses to get past the sidebar. The stop starts on the
  // active page -- where the reader is -- or the first row when there is none
  // (book mode's initial highlight, a page the map no longer has). The client
  // script moves it as focus moves.
  const findActive = (nodes: SiteNavTreeNode[]): SiteNavTreeNode | undefined => {
    for (const n of nodes) {
      if (!n.entry.isGroup && n.entry.absPath !== undefined && n.entry.absPath === currentAbsPath) return n;
      const inChildren = findActive(n.children);
      if (inChildren) return inChildren;
    }
    return undefined;
  };
  const rovingNode = findActive(tree) ?? tree[0];

  const renderNode = (node: SiteNavTreeNode): string => {
    const entry = node.entry;
    const hasChildren = node.children.length > 0;
    const rowTabindex = node === rovingNode ? '0' : '-1';
    // The link's own padding-left carries the full indent, toggle slot
    // included, exactly as before this feature -- the toggle itself is a
    // sibling, absolutely positioned into that reserved slot (see
    // .site-nav-toggle/.site-nav-item in media/styles.css) rather than an
    // inline child of the link, so a click on it can be told apart from a
    // click on the link (the .site-nav-link click delegation only ever
    // matches inside the <a> itself).
    const indent = 8 + SITE_NAV_TOGGLE_SLOT + entry.depth * 16;
    const toggleLeft = 8 + entry.depth * 16;
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
    const navIdAttr = entry.id ? ` data-nav-id="${escapeAttr(entry.id)}"` : '';
    // Collapsed on arrival when this row's own id is in the persisted set
    // -- everything else defaults to expanded, matching the "only the
    // non-default state is ever stored" design (see MapViewerProvider.ts's
    // COLLAPSED_NAV_KEY comment). A row with no id (only possible from a
    // hand-built test manifest -- buildBookNavManifest always sets one)
    // can never match and is always rendered expanded, same as before
    // this feature existed.
    const isCollapsed = hasChildren && entry.id !== undefined && collapsedIds.has(entry.id) && !ancestorsOfActive.has(node);
    const toggleHtml = hasChildren
      ? `<button type="button" class="site-nav-toggle" style="left:${toggleLeft}px" aria-expanded="${isCollapsed ? 'false' : 'true'}" aria-label="${isCollapsed ? expandLabel : collapseLabel}" tabindex="-1" data-expand-label="${expandLabel}" data-collapse-label="${collapseLabel}"></button>`
      : '';
    const childrenHtml = hasChildren
      ? `<ul class="site-nav-children" role="group">${node.children.map(renderNode).join('')}</ul>`
      : '';
    const itemClass = hasChildren ? (isCollapsed ? ' has-children collapsed' : ' has-children') : '';
    const itemAriaExpanded = hasChildren ? ` aria-expanded="${isCollapsed ? 'false' : 'true'}"` : '';
    // A group entry (DocsiteNavEntry.isGroup -- a <topichead> or a bare
    // key-only topicref, see that field's own comment) has no topic file
    // to navigate to, so it renders as a plain non-clickable label -- no
    // <a>, no data-site-target, no href -- instead of renderSiteNavHtml's
    // usual link markup. Its own expand/collapse toggle (if it has
    // children) still works exactly like any other parent's; only the
    // click-to-navigate behavior is missing, matching how tree mode
    // already renders a topichead as a non-clickable heading
    // (map/topichead in mapTypeMap.ts) and book mode renders one as a
    // plain section heading (renderBookParts's own `struct:` branch).
    if (entry.isGroup) {
      const label = `<span class="site-nav-group-label" tabindex="${rowTabindex}" style="padding-left:${indent}px" title="${escapeAttr(entry.title)}">${roleChip}<span class="site-nav-link-text">${escapeHtml(entry.title)}</span></span>`;
      return `<li class="site-nav-item site-nav-item--group${itemClass}" role="treeitem"${itemAriaExpanded}${navIdAttr}>${toggleHtml}${label}${childrenHtml}</li>`;
    }
    const activeClass = entry.absPath === currentAbsPath ? ' active' : '';
    const currentAttr = activeClass ? ' aria-current="page"' : '';
    const link = `<a href="#" class="site-nav-link${activeClass}"${currentAttr} tabindex="${rowTabindex}" data-site-target="${escapeAttr(entry.absPath as string)}" style="padding-left:${indent}px" title="${escapeAttr(entry.title)}">${roleChip}${typeChip}<span class="site-nav-link-text">${escapeHtml(entry.title)}</span></a>`;
    return `<li class="site-nav-item${itemClass}" role="treeitem"${itemAriaExpanded}${navIdAttr}>${toggleHtml}${link}${childrenHtml}</li>`;
  };

  const items = tree.map(renderNode).join('');
  return `<ul class="site-nav-tree" role="tree">${items}</ul>`;
}

export function renderSiteNavHtml(
  manifest: DocsiteNavEntry[],
  currentAbsPath: string,
  navLabel: string,
  toggleLabels: { expand: string; collapse: string } = { expand: 'Expand', collapse: 'Collapse' },
  collapsedIds: ReadonlySet<string> = new Set(),
  revealActive = false,
): string {
  return wrapSiteNavTreeHtml(renderSiteNavTreeHtml(manifest, currentAbsPath, toggleLabels, collapsedIds, revealActive), navLabel);
}

/**
 * The <nav> a rendered sidebar tree goes in. Split out of renderSiteNavHtml
 * so a caller that also needs the bare tree (MSG_UPDATE_SIDEBAR sends the
 * tree alone) can render it once and wrap it, instead of rendering it twice.
 */
export function wrapSiteNavTreeHtml(treeHtml: string, navLabel: string): string {
  return `<nav class="site-nav" aria-label="${escapeAttr(navLabel)}">${treeHtml}</nav>`;
}

/**
 * Arrow-key navigation for the sidebar tree, book and docsite mode alike (the
 * ARIA tree pattern; the markup is renderSiteNavTreeHtml's, whose roving
 * tabindex makes the whole tree one Tab stop).
 *
 *   Down / Up      next / previous VISIBLE row (rows inside a collapsed branch
 *                  are not rows)
 *   Right          collapsed parent: expand; expanded parent: first child
 *   Left           expanded parent: collapse; anything else: the parent row
 *   Home / End     first / last visible row
 *   Enter / Space  a topic link: open it; a group: fold or unfold it
 *
 * The decision is siteNavKeyAction, a pure function over a simplified model of
 * the visible rows, so the unit tests run the same code the page does. The
 * rest is glue that builds that model from the DOM and carries the action out
 * -- and carries it out with the CONTROLS THE MOUSE USES: a fold is a click on
 * the row's toggle button, opening a topic is a click on its link. That keeps
 * one implementation of "fold a branch and remember it" (getSiteNavToggleScript,
 * which also reports the state to the extension) and of "open a page" (each
 * mode's own click handling), instead of a keyboard copy that could drift.
 *
 * Enter on a link, and Enter/Space on the toggle button, are left to the
 * browser: they already click, and handling them here as well would run the
 * action twice.
 *
 * Also keeps two things about the tree in step with what the other scripts do
 * to it: the Tab stop follows focus (and moves off a row whose branch was just
 * collapsed by mouse, so the tree can never end up with its only Tab stop
 * hidden), and aria-current follows the `active` class, however many places
 * change that.
 */
export function getSiteNavKeyboardScript(): string {
  return `
  // rows: the visible rows, top to bottom, as { hasChildren, expanded, parent }
  // where parent is the index of the parent row in the same array (-1 at the
  // top level). Returns { type, index } -- focus that row, expand it, collapse
  // it, or activate it -- or null when the key means nothing there.
  function siteNavKeyAction(rows, index, key) {
    var row = rows[index];
    if (!row) return null;
    switch (key) {
      case 'ArrowDown':
        return index + 1 < rows.length ? { type: 'focus', index: index + 1 } : null;
      case 'ArrowUp':
        return index > 0 ? { type: 'focus', index: index - 1 } : null;
      case 'Home':
        return index !== 0 ? { type: 'focus', index: 0 } : null;
      case 'End':
        return index !== rows.length - 1 ? { type: 'focus', index: rows.length - 1 } : null;
      case 'ArrowRight':
        if (!row.hasChildren) return null;
        if (!row.expanded) return { type: 'expand', index: index };
        return index + 1 < rows.length && rows[index + 1].parent === index ? { type: 'focus', index: index + 1 } : null;
      case 'ArrowLeft':
        if (row.hasChildren && row.expanded) return { type: 'collapse', index: index };
        return row.parent >= 0 ? { type: 'focus', index: row.parent } : null;
      case 'Enter':
      case ' ':
        return { type: 'activate', index: index };
    }
    return null;
  }

  // The element of a row that takes focus: its link, or a group's label -- not
  // the <li>, which wraps the whole subtree, and not the toggle, which is for
  // the mouse.
  function siteNavFocusEl(li) {
    for (var i = 0; i < li.children.length; i++) {
      var c = li.children[i];
      if (c.classList.contains('site-nav-link') || c.classList.contains('site-nav-group-label')) return c;
    }
    return null;
  }

  function siteNavToggleBtn(li) {
    for (var i = 0; i < li.children.length; i++) {
      if (li.children[i].classList.contains('site-nav-toggle')) return li.children[i];
    }
    return null;
  }

  function siteNavHasCollapsedAncestor(li) {
    for (var p = li.parentElement; p; p = p.parentElement) {
      if (p.classList && p.classList.contains('site-nav-item') && p.classList.contains('collapsed')) return true;
    }
    return false;
  }

  // The visible rows as parallel arrays: the <li>s, and the model
  // siteNavKeyAction takes.
  function siteNavVisibleRows() {
    var all = document.querySelectorAll('.site-nav-tree .site-nav-item');
    var lis = [];
    var model = [];
    for (var i = 0; i < all.length; i++) {
      var li = all[i];
      if (siteNavHasCollapsedAncestor(li)) continue;
      var parentLi = li.parentElement ? li.parentElement.closest('.site-nav-item') : null;
      var hasChildren = li.classList.contains('has-children');
      lis.push(li);
      model.push({
        hasChildren: hasChildren,
        expanded: hasChildren && !li.classList.contains('collapsed'),
        parent: parentLi ? lis.indexOf(parentLi) : -1,
      });
    }
    return { lis: lis, model: model };
  }

  document.addEventListener('keydown', function(e) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    var t = e.target;
    if (!t || !t.closest) return;
    var li = t.closest('.site-nav-tree .site-nav-item');
    if (!li) return;
    var rows = siteNavVisibleRows();
    var index = rows.lis.indexOf(li);
    if (index < 0) return;
    var action = siteNavKeyAction(rows.model, index, e.key);
    if (!action) return;
    var el = siteNavFocusEl(rows.lis[action.index]);
    if (action.type === 'activate') {
      // Native: Enter on a link and Enter/Space on the toggle button click on their own.
      if (t.tagName === 'BUTTON' || (e.key === 'Enter' && t.tagName === 'A')) return;
      e.preventDefault();
      var toggle = siteNavToggleBtn(li);
      if (el && el.classList.contains('site-nav-link')) el.click();
      else if (toggle) toggle.click();
      return;
    }
    e.preventDefault();
    if (action.type === 'focus') {
      if (el) el.focus();
    } else {
      var btn = siteNavToggleBtn(rows.lis[action.index]);
      if (btn) btn.click();
    }
  });

  // One Tab stop for the whole tree, and it follows focus.
  document.addEventListener('focusin', function(e) {
    var t = e.target;
    if (!t || !t.closest || !t.closest('.site-nav-tree')) return;
    if (!(t.classList.contains('site-nav-link') || t.classList.contains('site-nav-group-label'))) return;
    var stops = document.querySelectorAll('.site-nav-tree [tabindex="0"]');
    for (var i = 0; i < stops.length; i++) stops[i].setAttribute('tabindex', '-1');
    t.setAttribute('tabindex', '0');
  });

  // A fold click can hide the row that holds the only Tab stop; move the stop
  // to the nearest row that is still visible. Runs after the toggle handler
  // (registered earlier), and after expand/collapse-all, which are clicks too.
  document.addEventListener('click', function() {
    var stop = document.querySelector('.site-nav-tree [tabindex="0"]');
    if (!stop) return;
    var li = stop.closest('.site-nav-item');
    if (!li || !siteNavHasCollapsedAncestor(li)) return;
    var visible = li;
    for (var p = li.parentElement; p; p = p.parentElement) {
      if (p.classList && p.classList.contains('site-nav-item') && !siteNavHasCollapsedAncestor(p)) { visible = p; break; }
    }
    var el = siteNavFocusEl(visible);
    if (!el) return;
    stop.setAttribute('tabindex', '-1');
    el.setAttribute('tabindex', '0');
  });

  // aria-current follows the 'active' class. Three places flip that class
  // (a docsite page switch, a book-mode sidebar click, book-mode scroll sync);
  // watching the class keeps the attribute right without a fourth copy of the
  // rule in each. The server sets it on first render (renderSiteNavTreeHtml).
  (function() {
    var nav = document.querySelector('.site-nav');
    if (!nav || typeof MutationObserver !== 'function') return;
    new MutationObserver(function(records) {
      for (var i = 0; i < records.length; i++) {
        var el = records[i].target;
        if (!el.classList || !el.classList.contains('site-nav-link')) continue;
        if (el.classList.contains('active')) el.setAttribute('aria-current', 'page');
        else el.removeAttribute('aria-current');
      }
    }).observe(nav, { attributes: true, subtree: true, attributeFilter: ['class'] });
  })();
`;
}

/**
 * The webview half of MSG_UPDATE_SIDEBAR: defines applySidebarUpdate(html),
 * which puts a freshly rendered sidebar tree (renderSiteNavTreeHtml) in place.
 *
 * Always a full innerHTML replace of the tree, never a diff -- the sidebar is
 * cheap to rebuild -- and never a replace of the .site-nav ELEMENT itself
 * (nav.outerHTML = ...): getSiteSidebarResizerScript captured that node once
 * at script-init time and never re-queries it, so replacing it would leave
 * the resizer silently pointing at a detached element.
 *
 * Book mode's .site-nav holds nothing but the tree, so its inner content is
 * the thing to replace. Site mode's does not: getBookSearchScript inserts the
 * search box into it and moves the original links into .site-nav-links, so
 * replacing the nav's whole inner content there would delete the search box
 * and any results with it. Only the link list is replaced. Either way the
 * prev/next buttons derive their targets from the .site-nav-link elements
 * (updatePrevNextButtons), which are new nodes now.
 *
 * `site` gates the site-only half at generation time rather than with a
 * runtime typeof check: updatePrevNextButtons is declared by a script that is
 * only emitted in site mode, and the declaration and its use should appear or
 * disappear together. Extracted so it can be unit-tested; the message
 * listener that calls it lives in MapViewerProvider.ts.
 */
export function getSidebarUpdateScript(opts: { site: boolean }): string {
  return `
  function applySidebarUpdate(html) {
    var nav = document.querySelector('.site-nav');
    if (!nav) return;
    // Replacing the tree destroys the row that has keyboard focus, and with it
    // the reader's place in the sidebar. Note which row it was (by the same
    // stable id that keys the persisted fold state) and put focus on that row
    // of the new tree; focus that was not in the sidebar is left where it is.
    var focusedId = null;
    var current = document.activeElement;
    if (current && nav.contains(current)) {
      var focusedRow = current.closest('.site-nav-item');
      if (focusedRow) focusedId = focusedRow.getAttribute('data-nav-id');
    }
    ${opts.site
      ? `var links = nav.querySelector('.site-nav-links');
    (links || nav).innerHTML = html;
    updatePrevNextButtons();`
      : `nav.innerHTML = html;`}
    if (focusedId !== null) {
      var rows = nav.querySelectorAll('.site-nav-item');
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].getAttribute('data-nav-id') !== focusedId) continue;
        for (var k = 0; k < rows[i].children.length; k++) {
          var c = rows[i].children[k];
          if (c.classList.contains('site-nav-link') || c.classList.contains('site-nav-group-label')) { c.focus(); break; }
        }
        break;
      }
    }
  }
`;
}

/**
 * The back/forward history of docsite mode, as plain functions over plain
 * data: `{ entries: [{ target, scrollTop }], index }`, where target is a
 * page's absolute path (the same string as a sidebar link's data-site-target)
 * and scrollTop is where the reader was on it when they last left.
 *
 * Immutable -- every function returns a new history and never touches its
 * argument -- because the value is also what gets persisted through
 * vscode.setState, and because the caller's rule is "compute the new history,
 * then commit it once the navigation is really happening".
 *
 * Defined as a script (rather than TypeScript the webview script would have
 * to duplicate) so unit tests run the very code the webview runs; it uses no
 * DOM. What it does NOT know is whether a page still exists -- the map may
 * have been edited since the entry was made -- so the callers that need to
 * know pass `exists`, and entries that fail it are skipped over, not deleted:
 * a page that comes back (an undone edit) is reachable again.
 */
export function getSiteHistoryModelScript(): string {
  return `
  var SITE_HISTORY_LIMIT = 100;

  function siteHistoryCreate(target) {
    return { entries: [{ target: target, scrollTop: 0 }], index: 0 };
  }

  // Keeps the newest SITE_HISTORY_LIMIT entries; the index follows its entry.
  function siteHistoryClamp(entries, index) {
    var drop = entries.length - SITE_HISTORY_LIMIT;
    if (drop <= 0) return { entries: entries, index: index };
    return { entries: entries.slice(drop), index: Math.max(0, index - drop) };
  }

  // A new page reached by navigating (as opposed to stepping through the
  // history): forward entries are discarded, as in a browser, and the page
  // being left remembers where the reader was on it.
  function siteHistoryPush(h, target, leavingScrollTop) {
    if (h.entries[h.index].target === target) return h;
    var entries = h.entries.slice(0, h.index + 1);
    entries[h.index] = { target: entries[h.index].target, scrollTop: leavingScrollTop };
    entries.push({ target: target, scrollTop: 0 });
    return siteHistoryClamp(entries, entries.length - 1);
  }

  // The nearest entry in a direction (-1 back, +1 forward) that is worth
  // going to: its page still exists, and it is not the page already showing.
  function siteHistoryFind(h, dir, exists) {
    var here = h.entries[h.index].target;
    for (var i = h.index + dir; i >= 0 && i < h.entries.length; i += dir) {
      var t = h.entries[i].target;
      if (t !== here && exists(t)) return i;
    }
    return -1;
  }

  function siteHistoryCan(h, dir, exists) {
    return siteHistoryFind(h, dir, exists) >= 0;
  }

  // Moves through the history. Returns null when there is nowhere to go;
  // otherwise the new history and the entry to land on (with the scroll
  // position it was left at). The page being left records its own position,
  // which is what stepping the other way restores.
  function siteHistoryStep(h, dir, exists, leavingScrollTop) {
    var i = siteHistoryFind(h, dir, exists);
    if (i < 0) return null;
    var entries = h.entries.slice();
    entries[h.index] = { target: entries[h.index].target, scrollTop: leavingScrollTop };
    return { history: { entries: entries, index: i }, entry: entries[i] };
  }

  // What comes back from webview state after a reload is only trusted as far
  // as it checks out, and only if its current entry is the page that came up
  // (a theme switch reloads the same page; anything else means it is stale).
  function siteHistoryRestore(raw, activeTarget) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries) || raw.entries.length === 0) {
      return siteHistoryCreate(activeTarget);
    }
    var index = raw.index;
    if (typeof index !== 'number' || index % 1 !== 0 || index < 0 || index >= raw.entries.length) {
      return siteHistoryCreate(activeTarget);
    }
    var entries = [];
    for (var i = 0; i < raw.entries.length; i++) {
      var e = raw.entries[i];
      if (!e || typeof e.target !== 'string' || typeof e.scrollTop !== 'number' || !isFinite(e.scrollTop)) {
        return siteHistoryCreate(activeTarget);
      }
      entries.push({ target: e.target, scrollTop: e.scrollTop });
    }
    var clamped = siteHistoryClamp(entries, index);
    if (clamped.entries[clamped.index].target !== activeTarget) return siteHistoryCreate(activeTarget);
    return clamped;
  }
`;
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
  ${getSiteHistoryModelScript()}

  // Back/forward history (getSiteHistoryModelScript above). null until the
  // deferred init at the bottom of this script, which is when the active link
  // exists to seed it from.
  var siteHistory = null;

  // The content pane, not the window, is what scrolls (#dita-content-root.
  // site-main has its own overflow-y). Absent in the few fake documents that
  // exercise this script without one.
  function siteScrollTop() {
    var scroller = document.getElementById('dita-content-root');
    return scroller ? scroller.scrollTop : 0;
  }

  function siteLinkFor(target) {
    var links = document.querySelectorAll('.site-nav-link');
    for (var i = 0; i < links.length; i++) {
      if (links[i].getAttribute('data-site-target') === target) return links[i];
    }
    return null;
  }

  function siteHistoryExists(target) {
    return !!siteLinkFor(target);
  }

  // Kept across a full reload (theme switch, manual refresh, a trip through
  // another mode) in the webview's own state, next to whatever else is there.
  function persistSiteHistory() {
    if (!siteHistory || typeof vscode.setState !== 'function') return;
    var state = (typeof vscode.getState === 'function' && vscode.getState()) || {};
    state.siteHistory = siteHistory;
    vscode.setState(state);
  }

  // A no-op wherever the buttons don't exist, like updatePrevNextButtons.
  function updateHistoryButtons() {
    var backBtn = document.getElementById('__site-back-btn');
    var forwardBtn = document.getElementById('__site-forward-btn');
    var canBack = !!siteHistory && siteHistoryCan(siteHistory, -1, siteHistoryExists);
    var canForward = !!siteHistory && siteHistoryCan(siteHistory, 1, siteHistoryExists);
    if (backBtn) {
      backBtn.disabled = !canBack;
      backBtn.onclick = canBack ? function() { siteHistoryGo(-1); } : null;
    }
    if (forwardBtn) {
      forwardBtn.disabled = !canForward;
      forwardBtn.onclick = canForward ? function() { siteHistoryGo(1); } : null;
    }
  }

  // Back (-1) or forward (+1): the model picks the page (skipping ones the
  // book no longer has) and switchToSitePage does the switching, told not to
  // record it as new navigation.
  function siteHistoryGo(dir) {
    if (!siteHistory) return;
    var step = siteHistoryStep(siteHistory, dir, siteHistoryExists, siteScrollTop());
    if (!step) return;
    switchToSitePage(siteLinkFor(step.entry.target), '', step);
  }

  // The mouse's own back/forward buttons. Their default (navigating the
  // webview document itself) must not also run.
  document.addEventListener('mousedown', function(e) {
    if (e.button === 3 || e.button === 4) e.preventDefault();
  });
  document.addEventListener('mouseup', function(e) {
    if (e.button === 3) { e.preventDefault(); siteHistoryGo(-1); }
    else if (e.button === 4) { e.preventDefault(); siteHistoryGo(1); }
  });
  // Alt+Left / Alt+Right, the browser convention. Only the bare Alt chord:
  // anything with Ctrl, Meta or Shift is somebody else's shortcut.
  document.addEventListener('keydown', function(e) {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); siteHistoryGo(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); siteHistoryGo(1); }
  });

  // Shared by the sidebar's own click handler and the prev/next buttons
  // (getSitePrevNextButtonsScript below) -- switching pages always means
  // the same three things: flip which sidebar link is 'active', refresh
  // prev/next's own enabled state and click targets against the new
  // active link, and ask the extension host to render it. Takes the
  // .site-nav-link element itself (not just its target path) so
  // updatePrevNextButtons can read the *next* prev/next targets' own
  // title attribute for free.
  //
  // The optional anchor is for book-internal xref jumps (docsite design
  // doc, 3.2/4.5): a plain sidebar/prev-next click never has one. When
  // present, it's an element id on the TARGET page to scroll to once its
  // HTML actually lands -- remembered in pendingSiteAnchor rather than
  // acted on here, since the new content doesn't exist in the DOM yet at
  // click time (it's still an async render on the extension host side).
  function switchToSitePage(link, anchor, historyStep) {
    if (!link) return;
    if (link.classList.contains('active')) {
      // Same page already showing -- an xref jump still needs to scroll,
      // a plain nav click has no anchor and this is just a no-op.
      if (anchor) scrollToSiteAnchor(anchor);
      return;
    }
    var target = link.getAttribute('data-site-target');
    if (!target) return;
    var prevActive = document.querySelector('.site-nav-link.active');
    if (prevActive) prevActive.classList.remove('active');
    link.classList.add('active');
    // Reveal the row: prev/next and xref jumps can land inside a collapsed
    // branch, leaving the active highlight on an invisible row. DOM-only, not
    // reported to be persisted -- the reader navigated, they did not choose
    // to unfold those branches, and the next render keeps the path to the
    // active page open by itself (renderSiteNavTreeHtml's revealActive).
    var navItem = link.closest ? link.closest('.site-nav-item') : null;
    if (navItem && typeof expandSiteNavAncestorsOf === 'function') expandSiteNavAncestorsOf(navItem);
    if (link.scrollIntoView) link.scrollIntoView({ block: 'nearest' });
    updatePrevNextButtons();
    pendingSiteAnchor = anchor || null;
    if (historyStep) {
      // Stepping through the history: land where the reader was.
      siteHistory = historyStep.history;
      pendingSiteScroll = historyStep.entry.scrollTop;
    } else {
      if (siteHistory) siteHistory = siteHistoryPush(siteHistory, target, siteScrollTop());
      // A new page starts at its top. The content pane keeps its scroll
      // offset across a content swap, so without this the page opened at
      // wherever the previous one had been scrolled to. An anchor jump does
      // its own scrolling.
      pendingSiteScroll = anchor ? null : 0;
    }
    persistSiteHistory();
    updateHistoryButtons();
    vscode.postMessage({ type: '${opts.switchSitePageMsgType}', target: target });
  }

  // Set right before the page-switch postMessage above and consumed once
  // by the MSG_UPDATE_CONTENT handler when the new page's HTML actually
  // arrives (see getMapWebviewScript) -- cleared immediately after so a
  // later plain sidebar/prev-next switch (no anchor) doesn't accidentally
  // replay a stale scroll target.
  var pendingSiteAnchor = null;

  // The content pane's scrollTop to apply when the new page's HTML lands
  // (consumed once by the MSG_UPDATE_CONTENT handler, like pendingSiteAnchor).
  // null: leave the scroll alone -- the state of every content update that is
  // not a page switch, such as the in-place refresh after an edit.
  var pendingSiteScroll = null;

  function scrollToSiteAnchor(anchor) {
    var el = document.getElementById(anchor);
    if (el && el.scrollIntoView) el.scrollIntoView();
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

  // Book-internal cross-topic xref (docsite design doc, 3.2/4.5): the
  // renderer only ever emits data-dita-book-xref for a target it already
  // confirmed is part of this book (RenderContext.isInCurrentBook), so
  // the matching sidebar link should always exist -- if it doesn't
  // (shouldn't happen, but the manifest and the render pass could in
  // principle disagree), this silently does nothing rather than throwing.
  document.addEventListener('click', function(e) {
    var xrefLink = e.target.closest ? e.target.closest('[data-dita-book-xref]') : null;
    if (!xrefLink) return;
    e.preventDefault();
    var raw = xrefLink.getAttribute('data-dita-book-xref');
    if (!raw) return;
    var hashIdx = raw.indexOf('#');
    var targetPath = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
    var anchor = hashIdx >= 0 ? raw.slice(hashIdx + 1) : '';
    var navLinks = document.querySelectorAll('.site-nav-link');
    var navLink = null;
    for (var j = 0; j < navLinks.length; j++) {
      if (navLinks[j].getAttribute('data-site-target') === targetPath) { navLink = navLinks[j]; break; }
    }
    if (navLink) switchToSitePage(navLink, anchor);
  });

  // Deferred rather than called inline: this script is injected into the
  // page (MapViewerProvider.ts) before getSitePrevNextButtonsScript creates
  // the prev/next buttons and before they're appended to the toolbar, so an
  // inline call here used to run while document.getElementById('__site-
  // prev-btn') still returned null -- a silent no-op -- leaving the buttons
  // unresponsive until the first manual sidebar click called
  // updatePrevNextButtons() again (switchToSitePage above already does,
  // on every subsequent switch). setTimeout(..., 0) runs after the rest of
  // the synchronous page-load script finishes, by which point the buttons
  // exist no matter which order the two scripts happen to be assembled in.
  setTimeout(function() {
    updatePrevNextButtons();
    var activeLink = document.querySelector('.site-nav-link.active');
    var activeTarget = activeLink ? activeLink.getAttribute('data-site-target') : null;
    if (activeTarget) {
      var saved = typeof vscode.getState === 'function' ? vscode.getState() : null;
      siteHistory = siteHistoryRestore(saved && saved.siteHistory, activeTarget);
      persistSiteHistory();
    }
    updateHistoryButtons();
  }, 0);
`;
}

/**
 * Book mode's own sidebar click handler (nested-fold-and-highlight-plan.md
 * item 1) -- deliberately NOT getSiteNavClickHandlerScript's
 * switchToSitePage. Book mode is already one single page with every
 * topic's content already in the DOM (renderBookParts stamped a
 * data-book-anchor attribute onto each surviving entry's own root element,
 * matching this same sidebar link's own data-site-target -- both trace
 * back to the one shared computeManifestEntryPositions helper, see its own
 * comment), so a sidebar click here only needs to scroll to that element
 * locally; there is no separate page for the extension host to render, and
 * so no postMessage round-trip either.
 *
 * The target element is found by iterating every [data-book-anchor] node
 * and comparing its attribute value directly, rather than building a CSS
 * attribute-selector string (`document.querySelector('[data-book-anchor="'
 * + id + '"]')`): id is an absolute filesystem path, which on Windows
 * contains backslashes -- CSS-special inside a quoted attribute-selector
 * string the same way they are inside a JS string literal -- so a selector
 * built from one without CSS.escape (not universally available) would
 * mis-match or throw on exactly the paths this project's own Windows-path
 * tests already flag as a recurring gotcha (see resolveBookTopicPath's own
 * tests). Plain string comparison sidesteps that entirely.
 *
 * Only ever emitted for book mode (see getMapWebviewScript, which
 * generates a fresh script per mode rather than branching this one at
 * runtime) -- MapViewerProvider.ts's currentMode variable exists for the
 * mode-toggle button only, not to gate this.
 */
export function getBookNavClickHandlerScript(): string {
  return `
  function findBookAnchor(id) {
    var candidates = document.querySelectorAll('[data-book-anchor]');
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].getAttribute('data-book-anchor') === id) return candidates[i];
    }
    return null;
  }

  document.addEventListener('click', function(e) {
    var link = e.target.closest ? e.target.closest('.site-nav-link') : null;
    if (!link) return;
    e.preventDefault();
    var target = link.getAttribute('data-site-target');
    if (!target) return;
    var el = findBookAnchor(target);
    if (!el) return;
    var prevActive = document.querySelector('.site-nav-link.active');
    if (prevActive) prevActive.classList.remove('active');
    link.classList.add('active');
    if (el.scrollIntoView) el.scrollIntoView();
  });
`;
}

/**
 * Book mode's scroll-position -> sidebar highlight sync
 * (nested-fold-and-highlight-plan.md item 5). getBookNavClickHandlerScript
 * above only covers sidebar-click -> scroll; this is the reverse direction
 * -- scrolling the book's own content pane should keep the sidebar's
 * `.active` link (and, if necessary, the collapsed state around it)
 * pointed at whatever part is actually on screen, the same way a PDF
 * reader's bookmark panel tracks the current page.
 *
 * Only ever emitted for book mode, same one-script-per-mode convention as
 * getBookNavClickHandlerScript (see getMapWebviewScript) -- site mode has
 * no equivalent because each topic there is its own page load, so the
 * server-rendered `.active` class on load already IS the answer; nothing
 * to track as the reader scrolls one topic's own content.
 *
 * Picking the active anchor: `entries[i].isIntersecting` from
 * IntersectionObserver only tells you which anchors are inside the
 * observed band right now, not which one the reader would call "the
 * current part" -- for a long part that fills the whole viewport, that
 * band can hold exactly one anchor (itself) while a short part just above
 * or below it slips in and out. Comparing intersection *ratio* to break
 * ties would favor whichever part happens to be longer, not whichever one
 * is actually nearest the top of the reading area. Instead this keeps a
 * running `visibleIds` list (anchors currently inside the band, in
 * whatever order the observer reports them) and, every time that set
 * changes, re-derives the active id by walking `anchors` -- which is
 * already in document/reading order, see computeManifestEntryPositions'
 * own comment, renderBookParts stamps data-book-anchor while walking the
 * manifest linearly in that same order -- and taking the first one that's
 * currently in `visibleIds`. That is "the topmost visible anchor" without
 * ever touching getBoundingClientRect.
 *
 * `rootMargin: '0px 0px -70% 0px'` shrinks the observed band to the
 * viewport's own top 30% (root is #dita-content-root, the actual scrolling
 * element in book mode -- see media/styles.css's own
 * `#dita-content-root.site-main { overflow-y: auto }` -- not the window)
 * so a part only becomes "current" once its top has scrolled into that
 * region, rather than the moment any sliver of it appears at the very
 * bottom of the pane.
 *
 * applyActive bails out immediately when the newly-picked id is the same
 * one already active: besides being the obvious no-op, this is also the
 * only debouncing this needs. A fast scroll can fire the observer callback
 * many times in a row, but almost all of those calls still resolve to the
 * same topmost-visible id as last time (the set of anchors inside a fixed-
 * size band changes far less often than the callback fires), so the actual
 * DOM writes below (class flips, ancestor expansion) only happen on a
 * genuine change, not on every callback tick.
 *
 * A highlighted node whose sidebar row is hidden by a collapsed ancestor
 * is worse than no highlight at all -- it looks like the sync silently
 * broke. expandAncestorsOf walks up from the matching `.site-nav-item`
 * through every ancestor `.site-nav-item.collapsed` (there can be more
 * than one: media/styles.css only hides the DIRECT child
 * `.site-nav-children`, so a grandparent being collapsed hides everything
 * under it regardless of the immediate parent's own state -- same fact
 * getSiteNavCollapseStateHelperScript's own comment already relies on for
 * collapse-all) and un-collapses each one with the same
 * setSiteNavItemCollapsed helper the click-driven toggle and expand/
 * collapse-all buttons already share (getSiteNavCollapseStateHelperScript,
 * emitted once per script and relied on here rather than duplicated) --
 * one shared implementation for "flip a nav item's collapsed state",
 * whatever triggered the flip. If that expansion actually changed
 * anything. That expansion is DOM-only: it does not itself trigger a
 * report for persistence, since it follows from where the reader scrolled,
 * not from a choice about the tree, and book mode's sidebar is closed by
 * default, so persisting it would silently erase the folds the reader had
 * saved without their ever seeing it happen. The rows it opens are marked
 * (nav-auto-expanded) so that when a LATER manual toggle reports the whole
 * DOM state they still count as collapsed, i.e. the saved fold survives.
 * Site mode's page-switch reveal behaves the same way.
 *
 * The observer is rebound (sync() inside the script) whenever
 * #dita-content-root's subtree or .site-nav's children change, because a
 * live edit replaces anchor elements and MSG_UPDATE_SIDEBAR replaces every
 * link -- see sync()'s own comment. Anchors with no matching sidebar link
 * (topichead section headings) are never picked as active.
 *
 * Deliberately does not scroll the sidebar itself to reveal the newly-
 * active row: nothing asked for that, and doing it unconditionally could
 * fight a reader who has the sidebar scrolled somewhere on purpose.
 *
 * No-ops entirely (before ever constructing an IntersectionObserver) when
 * `#dita-content-root` or any `[data-book-anchor]` element is missing --
 * the same "book with an empty sidebar" cases getMapWebviewScript's other
 * book-only scripts already have to tolerate (a map of nothing but
 * resource-only entries or childless keydefs) -- and when IntersectionObserver
 * itself isn't defined, which no real target for this extension lacks
 * but keeps this from being the one script that throws first if it ever
 * ran somewhere unexpected.
 */
export function getBookScrollSyncScript(): string {
  return `
  (function() {
    var contentRoot = document.getElementById('dita-content-root');
    if (!contentRoot || typeof IntersectionObserver === 'undefined') return;

    var anchors = [];
    var visibleIds = [];
    var currentActiveId = null;
    var scrollObserver = null;

    function findNavLink(id) {
      var navLinks = document.querySelectorAll('.site-nav-link');
      for (var j = 0; j < navLinks.length; j++) {
        if (navLinks[j].getAttribute('data-site-target') === id) return navLinks[j];
      }
      return null;
    }

    // Topmost visible anchor THAT HAS A SIDEBAR LINK. renderBookParts also
    // stamps data-book-anchor onto topichead section headings, but a group
    // is a plain label in the sidebar, not a link -- picking one would
    // resolve to no link at all and (as this used to) wipe the highlight
    // every time a group heading was the topmost thing in the band.
    function pickActiveId() {
      for (var i = 0; i < anchors.length; i++) {
        var id = anchors[i].getAttribute('data-book-anchor');
        if (visibleIds.indexOf(id) !== -1 && findNavLink(id)) return id;
      }
      return null;
    }

    // A null pick (nothing with a link is in the band right now) keeps the
    // last-known active link rather than clearing it to nothing.
    function applyActive(id) {
      if (!id || id === currentActiveId) return;
      var navLink = findNavLink(id);
      if (!navLink) return;
      currentActiveId = id;
      var prevActive = document.querySelector('.site-nav-link.active');
      if (prevActive) prevActive.classList.remove('active');
      navLink.classList.add('active');
      var navItem = navLink.closest ? navLink.closest('.site-nav-item') : null;
      // DOM-only: see this function's doc comment (getBookScrollSyncScript).
      if (navItem) expandSiteNavAncestorsOf(navItem);
    }

    function onIntersect(entries) {
      for (var i = 0; i < entries.length; i++) {
        var id = entries[i].target.getAttribute('data-book-anchor');
        var idx = visibleIds.indexOf(id);
        if (entries[i].isIntersecting) {
          if (idx === -1) visibleIds.push(id);
        } else if (idx !== -1) {
          visibleIds.splice(idx, 1);
        }
      }
      applyActive(pickActiveId());
    }

    // (Re)binds the observer to whatever data-book-anchor elements exist
    // right now. Runs once at init and again after every DOM swap below:
    // a live edit replaces anchor elements (MSG_UPDATE_CONTENT swaps all
    // of them, MSG_PATCH_CONTENT the changed ones) and the host's
    // MSG_UPDATE_SIDEBAR replaces every sidebar link -- with the observer
    // bound once at init it would keep watching detached nodes and the
    // highlight would silently stop following the scroll.
    //
    // The previously-active id is re-applied synchronously: the sidebar
    // markup the host sends marks the FIRST link active (it has no idea
    // where the reader is), and waiting for the new observer's first
    // callback would leave that wrong mark on screen until then.
    function sync() {
      var prevActiveId = currentActiveId;
      if (scrollObserver) { scrollObserver.disconnect(); scrollObserver = null; }
      anchors = Array.prototype.slice.call(document.querySelectorAll('[data-book-anchor]'));
      visibleIds = [];
      currentActiveId = null;
      if (!anchors.length) return;
      scrollObserver = new IntersectionObserver(onIntersect, { root: contentRoot, rootMargin: '0px 0px -70% 0px', threshold: 0 });
      for (var k = 0; k < anchors.length; k++) scrollObserver.observe(anchors[k]);
      if (prevActiveId) applyActive(prevActiveId);
    }

    sync();

    // Self-contained swap detection rather than a call from each message
    // handler in MapViewerProvider.ts: one place owns this script's own
    // lifecycle, and a future third swap path can't forget to call it.
    if (typeof MutationObserver !== 'undefined') {
      var swapObserver = new MutationObserver(function() { sync(); });
      swapObserver.observe(contentRoot, { childList: true, subtree: true });
      var siteNav = document.querySelector('.site-nav');
      if (siteNav) swapObserver.observe(siteNav, { childList: true });
    }
  })();
`;
}

/**
 * Sidebar panel's initial open/collapsed state (nested-fold-and-highlight-
 * plan.md item 6) -- site mode starts open (unchanged), book mode starts
 * collapsed. Book mode already shows every topic's content in one page the
 * moment it opens (unlike site mode, which shows nothing useful until a
 * topic is picked); leaving its sidebar open by default made book mode
 * look like a second copy of site mode on first look, when the actual
 * point of book mode is to read, not to navigate. Matches a PDF reader's
 * own bookmark-panel default: closed until the reader asks for it.
 *
 * Deliberately session-only, the same way the sidebar toggle button
 * itself already is (see getSiteSidebarToggleScript's own comment: a
 * plain class flip on body, nothing posted to the extension host, nothing
 * read back on the next generateHtml) -- reopening this document starts
 * collapsed again in book mode regardless of whether the reader opened
 * the panel last time, same as a PDF reader's own panel does not remember
 * being opened across closing and reopening the file. This deliberately
 * does NOT reuse item 3's per-document globalState persistence: that
 * store keys individual fold-node ids that default to "expanded", so
 * bolting one more per-document boolean onto it for "was the whole panel
 * open" would be a second, differently-shaped piece of state riding along
 * on the same key for no behavior a reader asked for.
 *
 * A pure function of `mode` alone (no DOM, no vscode API) so it is
 * testable directly rather than only through generateHtml's own HTML
 * string -- same reasoning as clampSidebarWidth living here instead of
 * inline in getSiteSidebarResizerScript.
 */
export function getInitialSidebarBodyClass(mode: 'tree' | 'book' | 'site'): string {
  return mode === 'book' ? `mode-${mode} site-nav-collapsed` : `mode-${mode}`;
}

/**
 * Docsite mode's sidebar expand/collapse toggle (Oxygen-style triangle in
 * front of a parent entry) -- click delegation only, same one-listener-per-
 * concern pattern as the .site-nav-link and [data-dita-book-xref] listeners
 * in getSiteNavClickHandlerScript above (a separate function, and a
 * separate document-level listener, rather than folded into that one,
 * since this is a genuinely different concern: it never posts a message to
 * the extension host or touches which page is showing, only whether a
 * branch of the sidebar's own tree is visible).
 *
 * Purely a `collapsed` class flip on the entry's own <li class="site-nav-
 * item"> -- media/styles.css hides `.site-nav-item.collapsed >
 * .site-nav-children` (the direct child <ul>, so a collapsed grandparent's
 * hidden subtree doesn't need this script to separately walk into and
 * re-hide already-hidden descendants; the cascade is free). No state is
 * kept anywhere outside that class: renderSiteNavHtml (ditaRenderUtils.ts)
 * is called exactly once per mode-switch/refresh and always renders every
 * branch open, so collapsing a branch and then switching pages (which only
 * ever replaces the topic content pane, never re-renders the sidebar --
 * see renderSiteNavHtml's own doc comment) leaves it collapsed, same as a
 * real file explorer.
 *
 * The toggle button itself (renderSiteNavHtml) carries its own expand/
 * collapse aria-label strings as data-expand-label/data-collapse-label so
 * this script doesn't need its own copies threaded in as opts just to
 * flip aria-label text along with aria-expanded.
 */
/**
 * The one place that actually applies a collapsed/expanded state to a
 * sidebar <li class="site-nav-item">. Emitted once per webview script and
 * consumed by BOTH getSiteNavToggleScript (one item, on its own toggle
 * click) and getSiteNavExpandCollapseAllButtonsScript (every item at once)
 * -- a collapse touches four things that must move together (the item's
 * own `collapsed` class, aria-expanded on both the item and its toggle,
 * and the toggle's aria-label), and two copies of that bookkeeping would
 * drift the moment one of them gained a fifth. Callers must emit this
 * before/alongside either consumer; getMapWebviewScript does.
 *
 * Purely a `collapsed` class flip -- media/styles.css hides
 * `.site-nav-item.collapsed > .site-nav-children` (the DIRECT child <ul>),
 * so a collapsed ancestor's already-hidden subtree needs no separate walk;
 * the cascade is free. That is also why collapse-all can set the class on
 * every item indiscriminately without worrying about order.
 */
export function getSiteNavCollapseStateHelperScript(opts: { reportCollapseMsgType?: string } = {}): string {
  // reportSiteNavCollapseState -- item 3's persistence side channel. Called
  // once per user action (a toggle click, or a whole expand/collapse-all
  // sweep), not once per item mutated: it re-scans the DOM for the FULL
  // current set of collapsed ids and posts that whole set, rather than
  // sending an incremental {id, collapsed} delta per change. A whole-set
  // replace is simpler on the host side (one array write, no partial-
  // update bookkeeping to keep consistent with what a full render would
  // have produced) and collapse-all would otherwise fire the same number
  // of messages as items in the tree instead of one.
  //
  // Only emitted when a message type is supplied -- getSiteNavToggleScript
  // and getSiteNavExpandCollapseAllButtonsScript both guard their own call
  // to it with `typeof reportSiteNavCollapseState === 'function'`, so a
  // caller that renders a sidebar with no persistence wired up (or a test
  // exercising the toggle/batch scripts in isolation) gets the same
  // collapse/expand behavior as before this feature, just without the
  // report.
  const report = opts.reportCollapseMsgType
    ? `
  function reportSiteNavCollapseState() {
    var ids = [];
    var items = document.querySelectorAll('.site-nav-item.has-children[data-nav-id]');
    for (var i = 0; i < items.length; i++) {
      // 'nav-auto-expanded': opened by revealing the active page, not by the
      // reader (see expandSiteNavAncestorsOf). It is open on screen but the
      // reader's saved choice for it is still "collapsed", and since this
      // reports the WHOLE DOM state, counting it as expanded here would
      // overwrite that choice the next time they touch any chevron.
      if (items[i].classList.contains('collapsed') || items[i].classList.contains('nav-auto-expanded')) {
        ids.push(items[i].getAttribute('data-nav-id'));
      }
    }
    vscode.postMessage({ type: ${JSON.stringify(opts.reportCollapseMsgType)}, ids: ids });
  }
`
    : '';
  return `
  // Opens every collapsed ancestor of a sidebar row -- the one place that
  // knows how (site mode's page switch and book mode's scroll sync both
  // reveal a row this way). Returns whether it opened anything. What it
  // opens is marked auto-expanded so the persisted fold state can still say
  // "collapsed" for it -- see reportSiteNavCollapseState.
  function expandSiteNavAncestorsOf(navItem) {
    var changed = false;
    var parent = navItem && navItem.parentElement && navItem.parentElement.closest
      ? navItem.parentElement.closest('.site-nav-item.collapsed')
      : null;
    while (parent) {
      setSiteNavItemCollapsed(parent, false, true);
      changed = true;
      parent = parent.parentElement && parent.parentElement.closest
        ? parent.parentElement.closest('.site-nav-item.collapsed')
        : null;
    }
    return changed;
  }

  // autoExpanded is only ever true from expandSiteNavAncestorsOf. Every
  // other caller (a toggle click, expand-all, collapse-all) is the reader
  // deciding, which replaces the marker: it is cleared here.
  function setSiteNavItemCollapsed(item, collapsed, autoExpanded) {
    if (!item) return;
    if (collapsed) item.classList.add('collapsed');
    else item.classList.remove('collapsed');
    if (autoExpanded && !collapsed) item.classList.add('nav-auto-expanded');
    else item.classList.remove('nav-auto-expanded');
    item.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    var toggle = item.querySelector(':scope > .site-nav-toggle');
    if (!toggle) return;
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    var label = collapsed ? toggle.getAttribute('data-expand-label') : toggle.getAttribute('data-collapse-label');
    if (label) toggle.setAttribute('aria-label', label);
  }
${report}`;
}

// Expand All / Collapse All icons -- Oxygen's own icon (two overlapping
// "window" squares with a blue +/- badge) is the semantic reference for
// what these two actions should read as, not something copied verbatim:
// Oxygen's version is a fixed-color raster-style glyph (hardcoded gray/
// white/blue), which would sit as a flat, wrong-toned image next to
// every other button in this toolbar, all of which are themed through
// currentColor / the same --vscode-dropdown-* variables btnStyle itself
// uses (font size, width, tag tooltips, sidebar toggle, prev/next,
// search). These two keep that same two-overlapping-squares-plus-badge
// silhouette -- legible as "more than one node, all at once" the same
// way Oxygen's is -- but as inline <svg> using currentColor for the
// outline and the button's own --vscode-dropdown-background for the
// front square's fill, so the icon repaints itself with every theme
// switch exactly like the rest of the toolbar already does, rather than
// carrying a fixed palette of its own. Inline markup (not a data: URI on
// an <img>, this function's own previous approach) is what makes
// currentColor/var(...) resolution possible at all: an <img>'s SVG
// renders in its own separate resource context and cannot see the
// page's CSS custom properties or inherited color.
const NAV_ALL_ICON_SQUARES =
  '<rect x="1.5" y="1.5" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.1"/>' +
  '<rect x="6.5" y="6.5" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.1" fill="var(--vscode-dropdown-background,#333)"/>';
const EXPAND_ALL_ICON_SVG =
  `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${NAV_ALL_ICON_SQUARES}` +
  '<path d="M10.5 8.7V12.3M8.7 10.5H12.3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
const COLLAPSE_ALL_ICON_SVG =
  `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${NAV_ALL_ICON_SQUARES}` +
  '<path d="M8.7 10.5H12.3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

/**
 * Expand-all / collapse-all: two separate buttons (not one tri-state
 * toggle -- with a partly-expanded tree there is no defensible answer to
 * which direction a single button should go, and guessing wrong undoes
 * the reader's own work). Built but NOT appended to the toolbar here,
 * same convention as getToolbarFontWidthTagTooltipsButtonsScript and
 * getSitePrevNextButtonsScript: the caller decides placement.
 *
 * Operates on `.site-nav-item.has-children` only -- a leaf item has no
 * toggle and no children <ul>, so giving it a `collapsed` class would be
 * inert but misleading in the DOM. Shared verbatim by book and site mode:
 * both now render the same sidebar markup (renderSiteNavTreeHtml), so this
 * takes no mode parameter and needs no per-mode branch.
 */
export function getSiteNavExpandCollapseAllButtonsScript(opts: { expandAllTitle: string; collapseAllTitle: string }): string {
  const expandAllTitle = JSON.stringify(opts.expandAllTitle);
  const collapseAllTitle = JSON.stringify(opts.collapseAllTitle);
  return `
  function setAllSiteNavCollapsed(collapsed) {
    var items = document.querySelectorAll('.site-nav-item.has-children');
    for (var i = 0; i < items.length; i++) setSiteNavItemCollapsed(items[i], collapsed);
    if (typeof reportSiteNavCollapseState === 'function') reportSiteNavCollapseState();
  }

  var siteExpandAllBtn = document.createElement('button');
  siteExpandAllBtn.id = '__site-expand-all-btn';
  // aria-hidden on the <svg> itself (baked into the markup above) plus no
  // separate alt text here: the button's own title/aria-label already
  // carry the accessible name, so a screen reader would otherwise
  // announce it twice.
  siteExpandAllBtn.innerHTML = '${EXPAND_ALL_ICON_SVG}';
  siteExpandAllBtn.title = ${expandAllTitle};
  siteExpandAllBtn.setAttribute('aria-label', ${expandAllTitle});
  siteExpandAllBtn.style.cssText = btnStyle + 'padding:1px 6px;justify-content:center;';
  siteExpandAllBtn.addEventListener('click', function() { setAllSiteNavCollapsed(false); });

  var siteCollapseAllBtn = document.createElement('button');
  siteCollapseAllBtn.id = '__site-collapse-all-btn';
  siteCollapseAllBtn.innerHTML = '${COLLAPSE_ALL_ICON_SVG}';
  siteCollapseAllBtn.title = ${collapseAllTitle};
  siteCollapseAllBtn.setAttribute('aria-label', ${collapseAllTitle});
  siteCollapseAllBtn.style.cssText = btnStyle + 'padding:1px 6px;justify-content:center;';
  siteCollapseAllBtn.addEventListener('click', function() { setAllSiteNavCollapsed(true); });
`;
}


export function getSiteNavToggleScript(): string {
  return `
  document.addEventListener('click', function(e) {
    var toggle = e.target.closest ? e.target.closest('.site-nav-toggle') : null;
    if (!toggle) return;
    e.preventDefault();
    var item = toggle.closest ? toggle.closest('.site-nav-item') : null;
    if (!item) return;
    // Reads the current state off the class rather than using
    // classList.toggle's return value, so the actual state change goes
    // through the one shared setter (setSiteNavItemCollapsed) that
    // expand-all/collapse-all uses too.
    setSiteNavItemCollapsed(item, !item.classList.contains('collapsed'));
    if (typeof reportSiteNavCollapseState === 'function') reportSiteNavCollapseState();
  });
`;
}

/**
 * The toolbar's history buttons, created like getSitePrevNextButtonsScript's
 * (built here, appended by the caller, which decides where they go). Arrows
 * rather than the angle brackets the prev/next buttons use: those step through
 * the book's reading order, these through the pages the reader has visited,
 * and the two must not look like the same control. Wired up (enabled state and
 * click) by updateHistoryButtons in getSiteNavClickHandlerScript.
 */
export function getSiteHistoryButtonsScript(opts: { backLabel: string; backTitle: string; forwardLabel: string; forwardTitle: string }): string {
  const backLabel = JSON.stringify(opts.backLabel);
  const backTitle = JSON.stringify(opts.backTitle);
  const forwardLabel = JSON.stringify(opts.forwardLabel);
  const forwardTitle = JSON.stringify(opts.forwardTitle);
  return `
  var siteBackBtn = document.createElement('button');
  siteBackBtn.id = '__site-back-btn';
  siteBackBtn.textContent = ${backLabel};
  siteBackBtn.title = ${backTitle};
  siteBackBtn.setAttribute('aria-label', ${backTitle});
  siteBackBtn.disabled = true;
  siteBackBtn.style.cssText = btnStyle + 'font-size:14px;padding:1px 9px;justify-content:center;';

  var siteForwardBtn = document.createElement('button');
  siteForwardBtn.id = '__site-forward-btn';
  siteForwardBtn.textContent = ${forwardLabel};
  siteForwardBtn.title = ${forwardTitle};
  siteForwardBtn.setAttribute('aria-label', ${forwardTitle});
  siteForwardBtn.disabled = true;
  siteForwardBtn.style.cssText = btnStyle + 'font-size:14px;padding:1px 9px;justify-content:center;';
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
  sitePrevBtn.style.cssText = btnStyle + 'font-size:14px;padding:1px 9px;justify-content:center;';

  var siteNextBtn = document.createElement('button');
  siteNextBtn.id = '__site-next-btn';
  siteNextBtn.textContent = ${nextLabel};
  siteNextBtn.title = ${nextTitle};
  siteNextBtn.setAttribute('aria-label', ${nextTitle});
  siteNextBtn.style.cssText = btnStyle + 'font-size:14px;padding:1px 9px;justify-content:center;';
`;
}

/**
 * Docsite mode's sidebar collapse toggle -- a single button that flips
 * `site-nav-collapsed` on document.body. Site mode starts with the class
 * absent (sidebar open); book mode starts with it already present (sidebar
 * collapsed) -- see getInitialSidebarBodyClass, which both modes' initial
 * body tag is built from (nested-fold-and-highlight-plan.md item 6). This
 * button behaves identically either way: it is how a reader tucks the
 * sidebar away or gets it back, regardless of which state it started in.
 * Deliberately a plain class toggle on body rather than
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

/**
 * Docsite mode's mode-cycle toggle button (tree -> book -> site -> tree).
 * The button's label always names the CURRENT mode, not the mode a click
 * switches to -- an earlier version showed the target mode ("reads as a
 * destination button"), but in practice that reads backwards: seeing
 * "Site" while already in Book mode looks like the button is claiming
 * you're in Site mode, not offering to take you there. Relies on the
 * caller's own `currentMode` variable (declared once near the top of
 * getMapWebviewScript, updated by this same click handler) and `btnStyle`
 * (getToolbarScaffoldScript) already being in scope -- same closure
 * convention as the other button scripts in this file, and why this one
 * isn't reusable outside MapViewerProvider.ts's own script the way some of
 * the docsite-specific ones already aren't (getSiteNavClickHandlerScript's
 * switchToSitePage, for instance, also assumes an outer `vscode`).
 * Does not call toolbar.appendChild itself, same convention as
 * getSitePrevNextButtonsScript/getSiteSidebarToggleScript above.
 */
export function getModeToggleScript(opts: {
  switchModeTitle: string;
  modeOutline: string;
  modeBook: string;
  modeSite: string;
  switchModeMsgType: string; // raw, e.g. 'switchMode'
}): string {
  const switchModeTitle = JSON.stringify(opts.switchModeTitle);
  const modeOutline = JSON.stringify(opts.modeOutline);
  const modeBook = JSON.stringify(opts.modeBook);
  const modeSite = JSON.stringify(opts.modeSite);
  return `
  var modeBtn = document.createElement('button');
  modeBtn.title = ${switchModeTitle};
  modeBtn.setAttribute('aria-label', ${switchModeTitle});
  modeBtn.style.cssText = btnStyle + 'font-size:11px;';
  function nextMapMode(m) {
    return m === 'tree' ? 'book' : m === 'book' ? 'site' : 'tree';
  }
  function modeLabel(m) {
    return m === 'book' ? ${modeBook} : m === 'site' ? ${modeSite} : ${modeOutline};
  }
  function updateModeLabel() {
    modeBtn.textContent = modeLabel(currentMode);
  }
  updateModeLabel();
  modeBtn.addEventListener('click', function() {
    var newMode = nextMapMode(currentMode);
    currentMode = newMode;
    updateModeLabel();
    vscode.postMessage({ type: '${opts.switchModeMsgType}', mode: newMode });
  });
`;
}

/**
 * Clamps a docsite-mode sidebar width (px) a drag gesture produced to a
 * sane range. Pure and exported so the clamping math itself is unit
 * tested; the drag wiring around it (getSiteSidebarResizerScript below)
 * has no DOM in this test suite to actually drag through, same situation
 * as findTextMatches above -- this is the
 * piece of that feature that can be tested directly, so it is.
 */
export function clampSidebarWidth(width: number, min = 160, max = 560): number {
  if (width < min) return min;
  if (width > max) return max;
  return width;
}

/**
 * Docsite mode's sidebar resize handle -- lets a reader drag the sidebar
 * wider or narrower than its 240px default. A self-contained IIFE rather
 * than something that needs appending to a toolbar: #__site-nav-resizer is
 * already sitting in the page markup as a sibling of .site-nav (see
 * MapViewerProvider.ts's body markup), one per docsite-mode page, so this
 * only needs to find it and wire it up -- same "no-op if the element isn't
 * there" safety the other docsite scripts get from their own id lookups,
 * which is what makes it safe to always emit this call regardless of mode
 * (tree/book pages never have #__site-nav-resizer in the DOM at all).
 * Widens via el.style.flexBasis rather than a fixed width: .site-nav's own
 * `flex: 0 0 240px` rule already fixes flex-grow/flex-shrink at 0, so only
 * the flex-basis longhand needs an inline override to resize without also
 * fighting the flex layout on every other axis.
 * Keyboard support (ArrowLeft/ArrowRight nudge by 20px) comes from the
 * element's own role="separator" tabindex="0" in the markup -- a
 * mouse-only drag target with that role and no keyboard handler would be
 * reachable by keyboard but do nothing once focused, which is worse than
 * not being focusable at all.
 */
export function getSiteSidebarResizerScript(): string {
  return `
  (function() {
    var resizer = document.getElementById('__site-nav-resizer');
    var nav = document.querySelector('.site-nav');
    if (!resizer || !nav) return;
    var clampSidebarWidth = ${clampSidebarWidth.toString()};
    var startX = 0;
    var startWidth = 0;
    function onMouseMove(e) {
      nav.style.flexBasis = clampSidebarWidth(startWidth + (e.clientX - startX)) + 'px';
    }
    function onMouseUp() {
      resizer.classList.remove('resizing');
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }
    resizer.addEventListener('mousedown', function(e) {
      startX = e.clientX;
      startWidth = nav.getBoundingClientRect().width;
      resizer.classList.add('resizing');
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
    });
    resizer.addEventListener('keydown', function(e) {
      var current = nav.getBoundingClientRect().width;
      if (e.key === 'ArrowLeft') {
        nav.style.flexBasis = clampSidebarWidth(current - 20) + 'px';
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        nav.style.flexBasis = clampSidebarWidth(current + 20) + 'px';
        e.preventDefault();
      }
    });
  })();
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

  // The full set of topics this book contains, computed once up front --
  // deliberately NOT the same thing as `visited` above, which only grows
  // as the loop below reaches each entry. A topic near the start of the
  // book can legitimately xref one near the end (docsite design doc,
  // 3.2/4.5): by the time that early topic is rendered, `visited` would
  // not yet contain the later one, and an xref renderer keying off it
  // would wrongly treat an in-book target as outside the book. Same
  // one-entry-per-topic identity resolveBookTopicPath/buildBookNavManifest
  // already use, so this set agrees with the sidebar on exactly which
  // topics "this book" means. getStableBookMembers (not a plain `new
  // Set()` built inline here) keeps the same Set instance across passes
  // where membership hasn't actually changed -- see its own comment for
  // why that identity has to survive a re-render for renderTopicCached's
  // reuse to work at all.
  const bookMembers = getStableBookMembers(entries, docDir);

  // Parallel to `entries`: entries[i]'s stable sidebar-manifest id, or
  // undefined when buildBookNavManifest itself would drop this entry (a
  // duplicate reference, an external/.ditamap href, a childless hrefless
  // entry) -- see computeManifestEntryPositions' own comment. The
  // book-mode sidebar (nested-fold-and-highlight-plan.md item 1) scrolls
  // to `[data-book-anchor="id"]`, so every part whose entry buildBookNavManifest
  // keeps gets that same id stamped onto its own root element here, computed
  // once from the exact same shared helper the sidebar manifest itself is
  // built from -- not re-derived independently, so the two can never point
  // at different nodes for the same entry.
  const anchorIds = computeManifestEntryPositions(entries, docDir);

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
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const anchorId = anchorIds[i]?.id;
    if (entry.resourceOnly) continue; // exists purely to be pulled in via keyref/conref elsewhere, never its own page or heading
    if (entry.href) {
      // Sub-map reference: its contents were already inlined as child
      // entries by expandDitamapRefs — render a section heading only
      // instead of parsing the map file as a topic.
      const refPath = entry.href.split('#')[0];
      if (refPath.toLowerCase().endsWith('.ditamap')) {
        push(
          `map:${resolve(docDir, decodeHrefPart(refPath))}`,
          // anchorId is always undefined here -- computeManifestEntryPositions
          // resolves this same entry's absPath via resolveBookTopicPath too,
          // which returns undefined for a .ditamap href (see its own test),
          // so buildBookNavManifest drops this entry and the sidebar never
          // links to it. Passed through anyway for symmetry with the other
          // two renderBook* call sites, rather than hand-omitting it here.
          renderBookPlaceholder(entry.displayName, entry.depth, anchorId),
        );
        continue;
      }
      const absPath = resolveBookTopicPath(entry, docDir);
      if (!absPath) {
        // External resource (https:, mailto:, absolute path) -- a link, not
        // a book member; getStableBookMembers already excluded it, so there
        // is nothing to render inline.
        continue;
      }
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
        bookMembers,
      });

      if (result.error) {
        // Keyed like the topic it stands in for, so a topic that starts or
        // stops failing to parse patches that one entry in place instead of
        // forcing a whole-document replace. Still gets its anchorId (the
        // sidebar shows it under its fallback title regardless of whether
        // the topic file itself parses -- see buildBookNavManifest, which
        // doesn't condition on that either) so a broken topic is still
        // reachable by scrolling to it.
        push(`topic:${absPath}`, renderBookError(entry.displayName, result.error, entry.depth, anchorId));
      } else {
        // Book mode is just each referenced topic's own content, one
        // after another -- the same profiling/highlighting a topic
        // already renders when opened directly (via renderTopicCached
        // above) carries straight through here unchanged. No separate
        // topicref-level (ditamap-source) profiling layered on top of
        // it; that scope is exclusive to Outline mode's tree.
        push(`topic:${absPath}`, `<div class="book-entry"${bookAnchorAttr(anchorId)}>${result.html}</div>`);
      }
    } else {
      push(`struct:${entry.depth}:${entry.displayName}`, renderBookPlaceholder(entry.displayName, entry.depth, anchorId));
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
  var searchRanges = [];
  var currentMatch = -1;
  var useRegex = false;
  var caseSensitive = false;

  // CSS Custom Highlight API: matches are Range objects registered here,
  // never DOM elements spliced into the page. Two registrations rather than
  // one plus a per-range class, since Range has no classList -- 'current'
  // is just a second Highlight holding (at most) one of the same Range
  // objects, styled to stand out via ::highlight(dita-search-current)'s
  // higher-priority rule below.
  var searchHighlightAll = new Highlight();
  var searchHighlightCurrent = new Highlight();
  CSS.highlights.set('dita-search-all', searchHighlightAll);
  CSS.highlights.set('dita-search-current', searchHighlightCurrent);

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
  searchHlStyle.textContent = '::highlight(dita-search-all){background-color:rgba(255,213,0,0.35);color:inherit;}::highlight(dita-search-current){background-color:rgba(255,165,0,0.6);}';
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
    searchHighlightAll.clear();
    searchHighlightCurrent.clear();
    searchRanges = [];
    currentMatch = -1;
  }

  // Returns array of {start, end} match positions within a text string.
  // Core implementation is the exported findTextMatches (unit-tested TS),
  // injected here so webview and tests always run the same algorithm.
  var findTextMatchesCore = ${findTextMatches.toString()};
  function findMatchesInText(text, term) {
    return findTextMatchesCore(text, term, useRegex, caseSensitive);
  }

  // Most matches tracked (one Range each, all held in the highlight
  // registry). A one-letter query against a large book would otherwise
  // create hundreds of thousands; past this the counter reads "N/5000+".
  var MAX_SEARCH_MATCHES = 5000;
  var searchCapped = false;

  // preservePosition: this run is a refresh after the DOM changed under an
  // open search (a live edit, a profiling-filter change), not the reader
  // typing or toggling -- keep them on the match they were on, and don't
  // scroll, instead of resetting to the first match and jumping there.
  function performSearch(term, preservePosition) {
    var keepMatch = preservePosition ? currentMatch : -1;
    clearSearchHighlights();
    searchCapped = false;
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

    // Text under display:none (e.g. .profile-filtered-out) has no box: a
    // match there could be counted but never seen, and its rect is all zeros.
    var isRendered = function(el) {
      return typeof el.checkVisibility !== 'function' || el.checkVisibility();
    };

    // Whether an element's text flows into its neighbours' as one string.
    // The page's own layout decides: display:inline (or contents) does, any
    // block/flex/table/inline-block box does not, and <br> ends a line even
    // though it is display:inline. With no layout information available
    // every element is a boundary, i.e. the per-text-node behaviour this
    // replaced. Deliberately the safe default of the full-book index
    // (extractBodyText in bookSearchIndex.ts) too: a spurious boundary only
    // misses a cross-element match, while gluing two blocks would invent
    // matches ("Hello</p><p>World" containing "oW").
    function flowsInline(el) {
      if (el.tagName === 'BR') return false;
      if (typeof window.getComputedStyle !== 'function') return false;
      var d = window.getComputedStyle(el).display;
      return d === 'inline' || d === 'contents';
    }

    // Whether the browser collapses runs of source whitespace in this
    // element's text into a single space. Only known when there is layout
    // information; without it text is taken as it is. white-space is
    // inherited, so the value on an element is the one its text sees.
    function collapsesWhitespace(el) {
      if (typeof window.getComputedStyle !== 'function') return false;
      var ws = window.getComputedStyle(el).whiteSpace;
      return ws !== 'pre' && ws !== 'pre-wrap' && ws !== 'pre-line' && ws !== 'break-spaces';
    }

    function isExcluded(el) {
      var tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE') return true;
      if (el.id === '__toolbar' || el.id === '__search_bar') return true;
      // Docsite mode's sidebar (.site-nav) sits beside #dita-content-root
      // as a sibling under body, not inside it -- without this, Ctrl+F
      // would also match/highlight topic titles and chips in the
      // sidebar, which isn't "the page" the reader is searching.
      return !!(el.classList && el.classList.contains('site-nav'));
    }

    // Collect "runs": maximal stretches of text nodes that read as one
    // string, as the reader sees it -- source whitespace collapsed to single
    // spaces, as the full-book index does, so "Click<newline> <b>OK</b>" is
    // found by "Click OK". segs maps the run's text back onto the raw text
    // nodes: segment k covers text[segs[k].c .. segs[k+1].c) and corresponds
    // one-to-one to node.textContent from offset segs[k].o. A collapsed
    // whitespace run is a one-character segment pointing at the first raw
    // whitespace character.
    var runs = [];
    var run = null;
    function endRun() {
      if (run && run.text.trim()) runs.push(run);
      run = null;
    }
    var WS_OR_TEXT = /[ \\t\\n\\r\\f]+|[^ \\t\\n\\r\\f]+/g;
    function addText(node, collapse) {
      if (!run) run = { segs: [], text: '' };
      var raw = node.textContent;
      if (!collapse) {
        if (raw) run.segs.push({ c: run.text.length, n: node, o: 0 });
        run.text += raw;
        return;
      }
      WS_OR_TEXT.lastIndex = 0;
      var m;
      while ((m = WS_OR_TEXT.exec(raw)) !== null) {
        var chunk = m[0];
        if (chunk.charCodeAt(0) <= 32) {
          // Dropped at the start of a line and after a space already taken.
          if (run.text === '' || run.text.charAt(run.text.length - 1) === ' ') continue;
          chunk = ' ';
        }
        run.segs.push({ c: run.text.length, n: node, o: m.index });
        run.text += chunk;
      }
    }
    function collectRuns(parent, collapse) {
      var kids = parent.childNodes;
      for (var k = 0; k < kids.length; k++) {
        var kid = kids[k];
        if (kid.nodeType === 3) {
          addText(kid, collapse);
        } else if (kid.nodeType === 1) {
          var inline = flowsInline(kid);
          if (isExcluded(kid) || !isRendered(kid)) {
            // Taken out of the flow entirely: text either side of an
            // inline one still joins up, a block one splits it.
            if (!inline) endRun();
            continue;
          }
          if (!inline) endRun();
          collectRuns(kid, collapsesWhitespace(kid));
          if (!inline) endRun();
        }
      }
    }
    collectRuns(document.body, collapsesWhitespace(document.body));
    endRun();

    collect:
    for (var i = 0; i < runs.length; i++) {
      var r = runs[i];
      var matches = findMatchesInText(r.text, term);
      if (!matches || matches.length === 0) continue;

      var si = 0;
      for (var j = 0; j < matches.length; j++) {
        if (searchRanges.length >= MAX_SEARCH_MATCHES) { searchCapped = true; break collect; }
        var st = matches[j].start;
        var last = matches[j].end - 1;
        // Matches ascend, so the start segment only ever moves forward. The
        // end is found from the match's LAST character: a match ending
        // exactly on a node boundary stays in the earlier node rather than
        // opening an empty range in the next.
        while (si + 1 < r.segs.length && r.segs[si + 1].c <= st) si++;
        var ei = si;
        while (ei + 1 < r.segs.length && r.segs[ei + 1].c <= last) ei++;
        var sg = r.segs[si];
        var eg = r.segs[ei];
        var range = document.createRange();
        range.setStart(sg.n, sg.o + (st - sg.c));
        range.setEnd(eg.n, eg.o + (last - eg.c) + 1);
        searchRanges.push(range);
        searchHighlightAll.add(range);
      }
    }

    if (searchRanges.length > 0) {
      if (keepMatch >= 0) {
        currentMatch = Math.min(keepMatch, searchRanges.length - 1);
        updateCurrentMatch(false);
      } else {
        currentMatch = 0;
        updateCurrentMatch();
      }
    } else {
      currentMatch = -1;
      searchCount.textContent = '0/0';
    }
  }

  // Bumped on every navigation so a correction still pending from the
  // previous match (see recenterMatch) never fights the newer one.
  var scrollToken = 0;

  // The nearest ancestor that actually scrolls -- #dita-content-root in
  // site mode and in book mode with a sidebar, where body is overflow:hidden
  // -- or null when the document itself is the scroller.
  function findScroller(el) {
    for (var p = el; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      var oy = window.getComputedStyle(p).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
    }
    return null;
  }

  // Measure where the match actually is and nudge its scroller until it sits
  // at the centre of the visible area. One scrollIntoView is not enough in
  // book mode: entries use content-visibility:auto with a 600px size
  // ESTIMATE until first rendered, so the jump is aimed at estimated layout,
  // the entries near the destination then render at their real heights, and
  // the match lands anywhere from a little off-centre to entirely off-screen.
  // Reading the range's rect forces layout, so each pass sees the real
  // geometry. The passes keep running until a deadline rather than stopping
  // once the match is centred: in a real page the layout can shift again a
  // few frames AFTER the first settle (observed ~70ms later, moving the
  // match 170px), so "centred once" is not "stays centred". Any wheel, touch
  // or pointer press bumps scrollToken and ends the correction, so it never
  // fights a reader who has started scrolling themselves.
  var RECENTER_WINDOW_MS = 800;
  ['wheel', 'touchmove', 'pointerdown'].forEach(function(type) {
    document.addEventListener(type, function() { scrollToken++; }, { passive: true, capture: true });
  });

  function recenterMatch(range, token, deadline) {
    if (token !== scrollToken) return;
    if (typeof window.requestAnimationFrame !== 'function' || typeof window.getComputedStyle !== 'function') return;
    var el = range.startContainer && range.startContainer.parentElement;
    if (!el) return;
    var rect = range.getBoundingClientRect();
    // An all-zero rect means "no layout box" (hidden content), not "at the
    // top of the scroller" -- scrolling toward it would fling the view away.
    if (!rect.width && !rect.height) return;
    var scroller = findScroller(el);
    var boxTop = 0;
    var boxHeight = window.innerHeight;
    if (scroller) {
      var box = scroller.getBoundingClientRect();
      boxTop = box.top;
      boxHeight = box.height;
    }
    var delta = (rect.top + rect.height / 2) - (boxTop + boxHeight / 2);
    if (Math.abs(delta) > 4) {
      if (scroller) scroller.scrollTop += delta;
      else window.scrollBy(0, delta);
    }
    if (Date.now() < deadline) {
      window.requestAnimationFrame(function() { recenterMatch(range, token, deadline); });
    }
  }

  function updateCurrentMatch(scroll) {
    // Only ever holds one Range (or none) -- clear+add is already O(1),
    // there being no marks left to walk is what makes this simpler than the
    // <mark>-based version this replaced.
    searchHighlightCurrent.clear();
    scrollToken++;
    if (currentMatch >= 0 && searchRanges[currentMatch]) {
      var range = searchRanges[currentMatch];
      searchHighlightCurrent.add(range);
      // Range has no scrollIntoView (that's an Element method), so make the
      // coarse jump via the element the match sits in. NOT window.scrollTo:
      // in site mode and book mode with a sidebar, body is height:100vh;
      // overflow:hidden and the real scroller is #dita-content-root (see
      // media/styles.css), where window.scrollTo is a silent no-op.
      // Element.scrollIntoView finds whichever ancestor actually scrolls.
      // 'instant', not 'smooth': a smooth animation is aimed once at the
      // layout of the moment and is not corrected as content-visibility
      // entries render during it (see recenterMatch); the refinement below
      // then puts the match itself, not just its paragraph, at the centre.
      if (scroll !== false) {
        var scrollTarget = range.startContainer && range.startContainer.parentElement;
        if (scrollTarget && scrollTarget.scrollIntoView) {
          scrollTarget.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
        recenterMatch(range, scrollToken, Date.now() + RECENTER_WINDOW_MS);
      }
    }
    searchCount.textContent = (currentMatch + 1) + '/' + searchRanges.length + (searchCapped ? '+' : '');
  }

  function gotoNextMatch() {
    if (searchRanges.length === 0) return;
    currentMatch = (currentMatch + 1) % searchRanges.length;
    updateCurrentMatch();
  }

  function gotoPrevMatch() {
    if (searchRanges.length === 0) return;
    currentMatch = (currentMatch - 1 + searchRanges.length) % searchRanges.length;
    updateCurrentMatch();
  }

  // Re-runs the current search after the page's DOM changed underneath it
  // (a live edit swapped the content, a profiling filter showed/hid some).
  // The Ranges the old run held point into nodes that are gone or
  // hidden, so they must be rebuilt -- but the reader keeps their place.
  function refreshSearchAfterDomChange() {
    if (sb.style.display !== 'none' && searchInput.value) performSearch(searchInput.value, true);
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
            // Hidden text is not searchable, so the match set just changed.
            if (typeof refreshSearchAfterDomChange === 'function') refreshSearchAfterDomChange();
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

// ── Click-to-enlarge lightbox + image copy affordances ──
//
// Both previews render <img data-dita-src> content, and media/styles.css
// gives every such image `cursor: zoom-in` -- a promise that clicking will
// enlarge it. That promise was only kept in the single-topic preview, whose
// inline script carried the lightbox; the map preview (book/site/tree) never
// injected any of this, so its images showed the magnifying-glass cursor but
// clicking did nothing. Extracting the whole image surface here (error
// marking, lightbox, clipboard copy, right-click menu) lets both providers
// embed the identical behavior and keeps them from drifting apart again --
// the same reasoning that moved the search overlay and the profiling filter
// into this file.
//
// Content-swap safe by construction: every listener here is registered on
// `document` (delegation), never on the images themselves, so replacing
// #dita-content-root's HTML -- or book mode's per-entry outerHTML patches --
// never orphans them and nothing needs re-running from afterContentSwap /
// the topic viewer's own updateContent handler. lightboxCandidates()
// re-queries the DOM on every open, so a lightbox always steps through
// whatever content is currently on screen.
//
// Deliberately NOT here: the per-image zoom toolbar (enhanceImages/
// setImgZoom). That stays a single-topic-preview affordance -- the map
// preview's design keeps images at their natural rendered size -- but its
// maximize button calls openLightbox(), which is a hoisted function
// declaration inside each provider's IIFE, so embedding this chunk anywhere
// in the script keeps that call working.
//
// All six strings are raw values, quoted here internally -- same convention
// as getSearchOverlayScript/getProfilingFilterScript: sharedWebviewStrings()
// hands them out for both providers to pass into this call, so they belong
// to the raw-string group, not the pre-JSON.stringify'd group (see the
// comment on sharedWebviewStrings() itself for why the two groups aren't
// interchangeable).
export function getImageLightboxScript(opts: {
  copyMenuItem: string;
  copyDoneLabel: string;
  copyFailedLabel: string;
  copyUnsupportedLabel: string;
  copyToastDone: string;
  copyToastFailed: string;
}): string {
  const copyMenuItem = JSON.stringify(opts.copyMenuItem);
  const copyDone = JSON.stringify(opts.copyDoneLabel);
  const copyFailed = JSON.stringify(opts.copyFailedLabel);
  const copyUnsupported = JSON.stringify(opts.copyUnsupportedLabel);
  const toastDone = JSON.stringify(opts.copyToastDone);
  const toastFailed = JSON.stringify(opts.copyToastFailed);
  return `
  // Image error handling (event delegation, nonce-safe). Marks broken
  // images with data-load-error, which the lightbox and its candidates
  // below exclude -- without this, a broken image would open an empty
  // overlay. Also styles media/styles.css's img[data-load-error] rule
  // (cursor back to default) from the script side.
  document.addEventListener('error', function(e) {
    var img = e.target;
    if (img.tagName !== 'IMG' || !img.hasAttribute('data-dita-src')) return;
    var src = img.getAttribute('data-dita-src') || 'unknown';
    var msg = 'Image fail: ' + src;
    // Only use the failure text as alt if the author never supplied one —
    // a real DITA <alt>/@alt is more useful than a load-failure string and
    // shouldn't be overwritten by it. The failure is still surfaced via
    // title (hover) and the red outline either way.
    if (!img.getAttribute('alt')) img.alt = msg;
    img.title = msg;
    img.setAttribute('data-load-error', 'true');
    img.style.outline = '3px solid red';
    img.style.outlineOffset = '-1px';
  }, true);

  // Click-to-enlarge lightbox. The whole image is a click target
  // (cursor:zoom-in from styles.css hints this). Broken images are
  // excluded. While the lightbox is open, ←/→ step through every
  // eligible image on the page in document order without closing the
  // overlay, so browsing a page of screenshots doesn't require reopening
  // the lightbox for each one.
  var lightboxOverlay = null;
  var lightboxBigImg = null;
  var lightboxImgs = [];
  var lightboxIdx = -1;

  function lightboxCandidates() {
    return Array.prototype.slice.call(document.querySelectorAll('img[data-dita-src]:not([data-load-error])'));
  }

  function onLightboxKeydown(e) {
    if (e.key === 'Escape') { closeLightbox(); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); lightboxStep(-1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); lightboxStep(1); return; }
    // Ctrl+C / Cmd+C copies the currently-displayed image, mirroring what a
    // user would expect from any other "enlarged preview" surface — there's
    // no text selection to steal focus from inside the lightbox, so this
    // doesn't collide with a real copy-text intent the way it might
    // elsewhere on the page.
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      if (!lightboxBigImg) return;
      copyImageToClipboard(lightboxBigImg).then(function(ok) {
        showCenteredToast(ok ? ${toastDone} : ${toastFailed});
      });
      return;
    }
  }

  function closeLightbox() {
    if (!lightboxOverlay) return;
    lightboxOverlay.remove();
    lightboxOverlay = null;
    lightboxBigImg = null;
    lightboxImgs = [];
    lightboxIdx = -1;
    document.removeEventListener('keydown', onLightboxKeydown);
  }

  function showLightboxImage() {
    if (!lightboxBigImg || lightboxIdx < 0 || lightboxIdx >= lightboxImgs.length) return;
    var img = lightboxImgs[lightboxIdx];
    lightboxBigImg.src = img.src;
    lightboxBigImg.alt = img.alt || '';
  }

  function lightboxStep(delta) {
    if (lightboxImgs.length < 2) return;
    lightboxIdx = (lightboxIdx + delta + lightboxImgs.length) % lightboxImgs.length;
    showLightboxImage();
  }

  function openLightbox(img) {
    closeLightbox();
    lightboxImgs = lightboxCandidates();
    lightboxIdx = lightboxImgs.indexOf(img);
    if (lightboxIdx === -1) { lightboxImgs = [img]; lightboxIdx = 0; }
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
    var big = document.createElement('img');
    big.className = 'dita-lightbox-img';
    big.style.cssText = 'max-width:92vw;max-height:92vh;object-fit:contain;box-shadow:0 4px 24px rgba(0,0,0,0.5);border-radius:4px;';
    overlay.appendChild(big);
    overlay.addEventListener('click', closeLightbox);
    document.addEventListener('keydown', onLightboxKeydown);
    document.body.appendChild(overlay);
    lightboxOverlay = overlay;
    lightboxBigImg = big;
    showLightboxImage();
  }
  document.addEventListener('click', function(e) {
    var img = e.target.closest ? e.target.closest('img[data-dita-src]') : null;
    if (!img || img.getAttribute('data-load-error') === 'true') return;
    openLightbox(img);
  });

  // Copies the rendered image to the system clipboard. Chromium's Async
  // Clipboard API only reliably accepts image/png for image writes, so
  // anything else (jpg/gif/webp/svg/bmp) is decoded and re-encoded to PNG
  // first. Decoding goes through createImageBitmap() on the bytes fetched
  // directly from img.src -- NOT by drawing the existing <img> element onto
  // a canvas -- because a canvas fed from a cross-origin-flagged <img> (the
  // webview-resource: scheme this project's images load through) can come
  // back "tainted", throwing on toBlob/getImageData; a canvas built from
  // bytes the page fetched itself isn't subject to that. Resolves to
  // true/false rather than throwing, so every caller (right-click menu,
  // lightbox Ctrl+C) can show its own success/failure feedback without its
  // own try/catch.
  function copyImageToClipboard(img) {
    if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) {
      return Promise.resolve(false);
    }
    return fetch(img.currentSrc || img.src)
      .then(function(resp) { return resp.blob(); })
      .then(function(sourceBlob) {
        if (sourceBlob.type === 'image/png') return sourceBlob;
        return createImageBitmap(sourceBlob).then(function(bitmap) {
          var canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          canvas.getContext('2d').drawImage(bitmap, 0, 0);
          return new Promise(function(resolve, reject) {
            canvas.toBlob(function(pngBlob) {
              if (pngBlob) resolve(pngBlob); else reject(new Error('toBlob failed'));
            }, 'image/png');
          });
        });
      })
      .then(function(pngBlob) {
        return navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      })
      .then(function() { return true; })
      .catch(function() { return false; });
  }

  // Small floating pill used for feedback that isn't anchored to a
  // still-open menu item (the lightbox Ctrl+C copy path has no menu to
  // update), fixed at the bottom-center of the viewport so it reads fine
  // whether or not the lightbox overlay is open. Auto-removes itself; never
  // accumulates if fired repeatedly, since each call removes any toast
  // still showing before adding its own.
  function showCenteredToast(text) {
    var existing = document.querySelector('.dita-img-toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.className = 'dita-img-toast';
    toast.textContent = text;
    document.body.appendChild(toast);
    setTimeout(function() { toast.remove(); }, 1200);
  }

  // Custom right-click "Copy Image" menu for both the inline preview images
  // and the lightbox's enlarged image. A real browser/Electron context menu
  // isn't used here because VS Code webviews don't reliably expose a native
  // "Copy Image" item across every host (desktop Electron vs. vscode.dev's
  // browser-hosted iframe), so this reimplements just the one item needed,
  // reusing the exact same copyImageToClipboard() as the lightbox's Ctrl+C.
  var imgCtxMenu = null;

  function closeImgCtxMenu() {
    if (!imgCtxMenu) return;
    imgCtxMenu.remove();
    imgCtxMenu = null;
  }

  function openImgCtxMenu(img, x, y) {
    closeImgCtxMenu();
    var menu = document.createElement('div');
    menu.className = 'dita-img-ctxmenu';
    var item = document.createElement('button');
    item.type = 'button';
    item.className = 'dita-img-ctxmenu-item';
    item.textContent = ${copyMenuItem};
    item.addEventListener('click', function(e) {
      e.stopPropagation();
      if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) {
        item.textContent = ${copyUnsupported};
        setTimeout(closeImgCtxMenu, 900);
        return;
      }
      item.disabled = true;
      copyImageToClipboard(img).then(function(ok) {
        item.textContent = ok ? ${copyDone} : ${copyFailed};
        setTimeout(closeImgCtxMenu, 700);
      });
    });
    menu.appendChild(item);
    document.body.appendChild(menu);
    // Positioned and clamped after insertion, once its real size is known
    // (offsetWidth/Height are 0 before the element is in the DOM) -- clamped
    // to the viewport so a right-click near the right/bottom edge doesn't
    // open a menu that's partly cut off screen.
    var menuW = menu.offsetWidth, menuH = menu.offsetHeight;
    menu.style.left = Math.min(x, window.innerWidth - menuW - 4) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - menuH - 4) + 'px';
    imgCtxMenu = menu;
  }

  document.addEventListener('contextmenu', function(e) {
    var img = e.target.closest
      ? e.target.closest('img[data-dita-src]:not([data-load-error]), img.dita-lightbox-img')
      : null;
    if (!img) { closeImgCtxMenu(); return; }
    e.preventDefault();
    openImgCtxMenu(img, e.clientX, e.clientY);
  });
  document.addEventListener('click', function(e) {
    if (imgCtxMenu && !imgCtxMenu.contains(e.target)) closeImgCtxMenu();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeImgCtxMenu();
  });
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
  var ddStyle = 'box-sizing:border-box;height:18px;appearance:none;-webkit-appearance:none;padding:1px 4px;border-radius:3px;border:1px solid var(--vscode-dropdown-border,var(--vscode-widget-border,#555));background:var(--vscode-dropdown-background,#333);color:var(--vscode-dropdown-foreground,#eee);font-size:11px;outline:none;cursor:pointer;';
  var btnStyle = 'box-sizing:border-box;height:18px;padding:1px 5px;border-radius:3px;border:1px solid var(--vscode-dropdown-border,var(--vscode-widget-border,#555));background:var(--vscode-dropdown-background,#333);color:var(--vscode-dropdown-foreground,#eee);cursor:pointer;font-size:13px;line-height:1;outline:none;display:flex;align-items:center;';

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
    // #dita-content-root.site-main (docsite mode) has its own
    // max-width:var(--max-width); margin:0 auto -- a separate box from
    // body, which in site mode is just the outer flex row holding the
    // sidebar and the content pane side by side (see body.mode-site in
    // styles.css). Setting body.style.maxWidth above only ever affected
    // body itself, which is exactly the box site mode's own CSS already
    // resets to max-width:none -- so every width selection was a no-op
    // there: "Full" looked identical to "Auto" because neither one was
    // reaching the box that actually determines the reading column's
    // width. Setting the --max-width custom property instead reaches
    // both: body's own rule already reads max-width:var(--max-width) (the
    // property this used to set directly is now just a more specific
    // duplicate of what the variable already produces in tree/book mode),
    // and .site-main's rule, which the class-based override in site mode
    // never touched, now tracks the same selection.
    if (value) {
      document.body.style.setProperty('--max-width', value);
    } else {
      document.body.style.removeProperty('--max-width');
    }
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
