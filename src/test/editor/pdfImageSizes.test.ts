import * as assert from 'assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  IMAGE_SIZES_FILE,
  buildImageSizesXml,
  collectImageMetrics,
  imageSizeKey,
  readJpegDpi,
  readPngDpi,
  stagePdfCustomization,
} from '../../editor/pdfImageSizes';

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A PNG header with IHDR, optional pHYs (pixels per metre), and an empty IDAT/IEND. */
function png(width: number, height: number, ppm?: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)];
  if (ppm !== undefined) {
    const phys = Buffer.alloc(9);
    phys.writeUInt32BE(ppm, 0);
    phys.writeUInt32BE(ppm, 4);
    phys[8] = 1;
    parts.push(chunk('pHYs', phys));
  }
  parts.push(chunk('IDAT', Buffer.alloc(0)), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

describe('pdfImageSizes: imageSizeKey', () => {
  it('makes a local path and the file: URLs DITA-OT emits meet at one key', () => {
    const want = 'tmp/repro/images/a%20b.png';
    assert.strictEqual(imageSizeKey('/tmp/repro/images/a b.png'), want);
    assert.strictEqual(imageSizeKey('file:/tmp/repro/images/a%20b.png'), want);
    assert.strictEqual(imageSizeKey('file:///tmp/repro/images/a%20b.png'), want);
    assert.strictEqual(imageSizeKey('file:/tmp/repro/topics/../images/./a%20b.png'), want);
  });

  it('is case-insensitive and treats Windows separators like slashes', () => {
    assert.strictEqual(imageSizeKey('C:\\Docs\\Img\\Pic.PNG'), imageSizeKey('file:/C:/docs/img/pic.png'));
  });
});

describe('pdfImageSizes: density readers', () => {
  it('reads PNG pHYs in pixels per metre as dpi', () => {
    assert.ok(Math.abs((readPngDpi(png(10, 10, 11811)) ?? 0) - 300) < 0.1);
  });

  it('returns undefined for a PNG without pHYs, or a non-PNG', () => {
    assert.strictEqual(readPngDpi(png(10, 10)), undefined);
    assert.strictEqual(readPngDpi(Buffer.from('nope')), undefined);
  });

  it('reads JFIF density in dpi and in dots per cm, ignoring aspect-ratio-only', () => {
    const jfif = (units: number, x: number): Buffer => {
      const b = Buffer.alloc(24);
      b.writeUInt16BE(0xffd8, 0);
      b.writeUInt16BE(0xffe0, 2);
      b.writeUInt16BE(16, 4);
      b.write('JFIF\0', 6, 'ascii');
      b[13] = units;
      b.writeUInt16BE(x, 14);
      b.writeUInt16BE(x, 16);
      return b;
    };
    assert.strictEqual(readJpegDpi(jfif(1, 150)), 150);
    assert.ok(Math.abs((readJpegDpi(jfif(2, 118)) ?? 0) - 299.72) < 0.01);
    assert.strictEqual(readJpegDpi(jfif(0, 1)), undefined);
  });
});

describe('pdfImageSizes: collect and stage', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pdf-img-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('measures nested images, uses 72 dpi when none is recorded, skips junk and node_modules', () => {
    mkdirSync(join(root, 'images', 'deep'), { recursive: true });
    mkdirSync(join(root, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(root, 'images', 'tall.png'), png(600, 3000));
    writeFileSync(join(root, 'images', 'deep', 'hi.png'), png(1200, 800, 11811));
    writeFileSync(join(root, 'images', 'broken.png'), Buffer.from('not a png'));
    writeFileSync(join(root, 'node_modules', 'x', 'ignored.png'), png(10, 10));
    writeFileSync(join(root, 'notes.txt'), 'x');
    writeFileSync(join(root, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"/>');

    const found = collectImageMetrics(root);
    const byName = new Map(found.map((e) => [e.key.split('/').pop(), e]));
    assert.deepStrictEqual([...byName.keys()].sort(), ['hi.png', 'logo.svg', 'tall.png']);
    assert.deepStrictEqual(
      { w: byName.get('tall.png')?.width, h: byName.get('tall.png')?.height, dpi: byName.get('tall.png')?.dpi },
      { w: 600, h: 3000, dpi: 72 },
    );
    assert.ok(Math.abs((byName.get('hi.png')?.dpi ?? 0) - 300) < 0.1);
    assert.strictEqual(byName.get('logo.svg')?.dpi, 96);
  });

  it('honours the limit', () => {
    for (let i = 0; i < 5; i++) writeFileSync(join(root, `i${i}.png`), png(4, 4));
    assert.strictEqual(collectImageMetrics(root, 3).length, 3);
  });

  it('escapes attribute values in the sidecar', () => {
    const xml = buildImageSizesXml([{ key: 'a"b<c&d.png', width: 1, height: 2, dpi: 72 }]);
    assert.ok(xml.includes('key="a&quot;b&lt;c&amp;d.png"'));
  });

  it('stages a copy of the customization folder plus the sidecar, leaving the source untouched', () => {
    const src = join(root, 'custom');
    mkdirSync(join(src, 'fo'), { recursive: true });
    writeFileSync(join(src, 'catalog.xml'), '<catalog/>');
    const imgs = join(root, 'proj');
    mkdirSync(imgs);
    writeFileSync(join(imgs, 'p.png'), png(30, 40));

    const staged = stagePdfCustomization(src, imgs);
    assert.ok(staged);
    try {
      assert.strictEqual(readFileSync(join(staged, 'catalog.xml'), 'utf-8'), '<catalog/>');
      const xml = readFileSync(join(staged, IMAGE_SIZES_FILE), 'utf-8');
      assert.ok(/width="30" height="40" dpi="72"/.test(xml));
      assert.throws(() => readFileSync(join(src, IMAGE_SIZES_FILE)), 'the bundled folder must not be modified');
    } finally {
      rmSync(staged, { recursive: true, force: true });
    }
  });

  it('returns undefined instead of throwing when the source folder is missing', () => {
    assert.strictEqual(stagePdfCustomization(join(root, 'nope'), root), undefined);
  });
});
