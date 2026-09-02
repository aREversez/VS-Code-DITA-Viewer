import { existsSync, readFileSync, openSync, readSync, closeSync, statSync } from 'fs';
import { resolve, dirname, relative, isAbsolute, extname, normalize } from 'path';
import { DitaNode } from '../parser/domTypes';
import { parseDita, parseDitamap, preprocessEntities } from '../parser/ditaParser';
import { renderDocument } from '../render/renderer';

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

  return { loadFile, findElementById, findTitleOfElement };
}

export function makeConrefResolver(
  docDir: string,
  ownRoot?: DitaNode,
): (conref: string) => DitaNode | undefined {
  const cache = makeFileCache(docDir);

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
): (conref: string, conrefend: string) => DitaNode[] | undefined {
  const cache = makeFileCache(docDir);

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

export function makeFileTitleResolver(docDir: string): (href: string) => string | undefined {
  const cache = makeFileCache(docDir);

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
  const { xml, docDir, keyMap, asWebviewUri, headingLevel, uiLanguage } = input;
  try {
    const preprocessedXml = preprocessEntities(xml);
    const ditaDoc = parseDita(preprocessedXml);
    const titleMap = buildTitleMap(ditaDoc.root);
    const noteLabels = detectNoteLabels(ditaDoc.root, uiLanguage);
    const indexLabel = detectIndexLabel(ditaDoc.root, uiLanguage);

    const conrefResolver = makeConrefResolver(docDir, ditaDoc.root);
    const conrefRangeResolver = makeConrefRangeResolver(docDir, ditaDoc.root);
    const fileTitleResolver = makeFileTitleResolver(docDir);

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
      getImageDimensions: (relPath: string) => {
        try {
          return readImageDimensions(resolve(docDir, decodeHrefPart(relPath)));
        } catch {
          return undefined;
        }
      },
    });

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
  const { filePath, keyMap, asWebviewUri, headingLevel, uiLanguage } = input;
  try {
    if (!existsSync(filePath)) {
      return { html: '', error: `File not found: ${filePath}` };
    }
    const rawXml = readFileSync(filePath, 'utf-8');
    const result = renderTopicXml({
      xml: rawXml,
      docDir: dirname(filePath),
      keyMap,
      asWebviewUri,
      headingLevel,
      uiLanguage,
    });
    return { html: result.html, title: result.title, error: result.error };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { html: '', error: `Error rendering ${filePath}: ${message}` };
  }
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
  }

  // Returns array of {start, end} match positions within a text string.
  // Core implementation is the exported findTextMatches (unit-tested TS),
  // injected here so webview and tests always run the same algorithm.
  var findTextMatchesCore = ${findTextMatches.toString()};
  function findMatchesInText(text, term) {
    return findTextMatchesCore(text, term, useRegex, caseSensitive);
  }

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
    for (var i = 0; i < searchMarks.length; i++) {
      if (i === currentMatch) {
        searchMarks[i].classList.add('__current');
      } else {
        searchMarks[i].classList.remove('__current');
      }
    }
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
