import { closeSync, cpSync, existsSync, mkdtempSync, openSync, readdirSync, readSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { extname, join } from 'path';
import { readImageDimensions } from './ditaRenderUtils';

// ── Image metrics for the PDF customization ─────────────────────────────
//
// The PDF pipeline (org.dita.pdf2 + FOP) needs an image's natural size to
// fit it onto the page the way a reader expects: honour @scale first, then
// shrink whatever still overflows the column, and keep a tall portrait shot
// from filling a page at full column width. FOP can only scale-down-to-fit
// a *width*; and XSLT (Saxon-HE, as bundled with DITA-OT) has no way to read
// a binary file's header (unparsed-text rejects the control bytes in every
// PNG signature, and reflexive Java calls are disabled in HE), so the sizes
// are measured here and handed to the stylesheet as a sidecar XML file
// (`image-sizes.xml`) that lives next to the staged customization folder.
//
// The stylesheet degrades gracefully: an image absent from the sidecar (or a
// missing sidecar) keeps the previous FOP scale-down-to-fit behaviour.

export const IMAGE_SIZES_FILE = 'image-sizes.xml';

export interface ImageMetrics {
  /** Path key, see imageSizeKey (must match the stylesheet's vdv:image-key). */
  key: string;
  width: number;
  height: number;
  /** Pixels per inch recorded in the file, or the default for the format. */
  dpi: number;
}

/** FOP's default source resolution, used when a bitmap records no density. */
const DEFAULT_BITMAP_DPI = 72;
/** SVG user units are CSS pixels (96 per inch) for both Batik and FOP. */
const SVG_DPI = 96;
const MAX_IMAGES = 5000;
const MAX_DIRS = 20000;
const SKIPPED_DIRS = new Set(['node_modules', '.git', '.svn', '.hg']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg']);
const HEADER_BYTES = 65536;

/**
 * Normalised comparison key for an image location: no `file:` scheme, no
 * leading slashes, forward slashes, `.`/`..` segments resolved, percent-
 * encoded the way DITA-OT writes URLs, lower-cased. The XSLT side applies the
 * same recipe to the URL it is about to hand to FOP (vdv:image-key), so both
 * `file:/tmp/a.png` and `file:///tmp/a.png` and the local path meet here.
 */
export function imageSizeKey(pathOrUrl: string): string {
  let p = pathOrUrl.replace(/\\/g, '/').replace(/^file:/i, '').replace(/^\/+/, '');
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { out.pop(); continue; }
    out.push(seg);
  }
  p = out.join('/');
  // A local path is raw text; a URL is already encoded. Encoding an already
  // encoded string would double-escape '%', so only encode when it is raw.
  if (!/%[0-9a-f]{2}/i.test(p)) p = encodeURI(p);
  return p.toLowerCase();
}

function readHeader(filePath: string): Buffer | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(HEADER_BYTES);
    const n = readSync(fd, buf, 0, HEADER_BYTES, 0);
    return buf.subarray(0, n);
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* already closed */ }
    }
  }
}

/** PNG pHYs chunk (pixels per metre) -> dpi, when the unit is the metre. */
export function readPngDpi(buf: Buffer): number | undefined {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return undefined;
  let offset = 8;
  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    if (type === 'pHYs' && offset + 8 + 9 <= buf.length) {
      const ppuX = buf.readUInt32BE(offset + 8);
      const unit = buf[offset + 16];
      return unit === 1 && ppuX > 0 ? (ppuX * 0.0254) : undefined;
    }
    if (type === 'IDAT' || type === 'IEND') return undefined; // pHYs must precede IDAT
    offset += 12 + length;
  }
  return undefined;
}

/** JFIF APP0 density -> dpi (units 1 = dpi, 2 = dots per cm). */
export function readJpegDpi(buf: Buffer): number | undefined {
  if (buf.length < 4 || buf.readUInt16BE(0) !== 0xffd8) return undefined;
  let offset = 2;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) { offset++; continue; }
    const marker = buf[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    const length = buf.readUInt16BE(offset + 2);
    if (marker === 0xe0 && offset + 16 <= buf.length && buf.toString('ascii', offset + 4, offset + 8) === 'JFIF') {
      const units = buf[offset + 11];
      const x = buf.readUInt16BE(offset + 12);
      if (x <= 0) return undefined;
      if (units === 1) return x;
      if (units === 2) return x * 2.54;
      return undefined; // aspect-ratio only
    }
    if (marker === 0xda) return undefined;
    offset += 2 + length;
  }
  return undefined;
}

export function readImageMetrics(filePath: string): Omit<ImageMetrics, 'key'> | undefined {
  const dims = readImageDimensions(filePath);
  if (!dims || !(dims.width > 0) || !(dims.height > 0)) return undefined;
  const ext = extname(filePath).toLowerCase();
  if (ext === '.svg') return { width: dims.width, height: dims.height, dpi: SVG_DPI };
  const header = readHeader(filePath);
  let dpi: number | undefined;
  if (header) {
    if (ext === '.png') dpi = readPngDpi(header);
    else if (ext === '.jpg' || ext === '.jpeg') dpi = readJpegDpi(header);
  }
  // Guard against nonsense densities (a stray 1 or 0.1 dpi would explode the size).
  if (!dpi || !(dpi >= 24 && dpi <= 1200)) dpi = DEFAULT_BITMAP_DPI;
  return { width: dims.width, height: dims.height, dpi: Math.round(dpi * 100) / 100 };
}

/** Measure every image under `rootDir` (bounded; unreadable files are skipped). */
export function collectImageMetrics(rootDir: string, limit: number = MAX_IMAGES): ImageMetrics[] {
  const result: ImageMetrics[] = [];
  const stack = [rootDir];
  let visited = 0;
  while (stack.length > 0 && result.length < limit && visited++ < MAX_DIRS) {
    const dir = stack.pop() as string;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (result.length >= limit) break;
      const full = join(dir, name);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        if (!SKIPPED_DIRS.has(name)) stack.push(full);
        continue;
      }
      if (!IMAGE_EXTENSIONS.has(extname(name).toLowerCase())) continue;
      const metrics = readImageMetrics(full);
      if (metrics) result.push({ key: imageSizeKey(full), ...metrics });
    }
  }
  return result;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function buildImageSizesXml(entries: readonly ImageMetrics[]): string {
  const rows = entries.map(
    (e) => `  <image key="${escapeAttr(e.key)}" width="${e.width}" height="${e.height}" dpi="${e.dpi}"/>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<images>\n${rows.join('\n')}\n</images>\n`;
}

/**
 * Copy the bundled customization folder into a fresh temp folder and drop the
 * measured image sizes beside it. Returns the staged folder (the caller
 * removes it when the transformation ends), or undefined when staging failed
 * and the caller should use the pristine folder (images then fall back to the
 * width-only fit).
 */
export function stagePdfCustomization(sourceDir: string, imageRoot: string): string | undefined {
  try {
    if (!existsSync(sourceDir)) return undefined;
    const staged = mkdtempSync(join(tmpdir(), 'dita-viewer-pdf-'));
    cpSync(sourceDir, staged, { recursive: true });
    writeFileSync(join(staged, IMAGE_SIZES_FILE), buildImageSizesXml(collectImageMetrics(imageRoot)), 'utf-8');
    return staged;
  } catch {
    return undefined;
  }
}
