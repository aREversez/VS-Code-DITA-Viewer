// Finds a topic file's type from its root tag without parsing the whole file.
// Split out of ditaRenderUtils.ts, which re-exports every name here.

import { closeSync, openSync, readFileSync, readSync } from 'fs';
import { isAbsolute, resolve } from 'path';
import { decodeHrefPart, noteSourceDependencies, URL_SCHEME_RE } from '@dita-viewer/core';

/**
 * Default topic-type labeler used when no localized labeler is injected.
 * Returns a simple capitalized tag name for every root, the generic
 * `<topic>` included (`concept` -> "Concept", `task` -> "Task", `topic` ->
 * "Topic", ...): in a map that mixes specializations with plain topics, the
 * plain ones being the only rows with no chip read as "type unknown" rather
 * than "generic topic". Callers that want localized labels
 * (MapViewerProvider in VS Code) inject their own labeler; pure-function
 * tests use this default to stay vscode-free.
 */
export function defaultTopicTypeLabel(tagName: string): string | undefined {
  if (!tagName) return undefined;
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

// ── Escaping (single source of truth for non-renderer code) ──
