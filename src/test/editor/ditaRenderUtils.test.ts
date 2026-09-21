import * as assert from 'assert';
import { mkdtempSync, writeFileSync, rmSync, statSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { expandDitamapRefs, FileReader, makeConrefResolver, makeConrefRangeResolver, makeFileTitleResolver, makeFileTopicTypeResolver, findTextMatches, getSearchOverlayScript, getProfilingFilterScript, getToolbarScaffoldScript, getFontPrefsScript, getToolbarFontWidthTagTooltipsButtonsScript, getSiteNavClickHandlerScript, getBookNavClickHandlerScript, getBookScrollSyncScript, getInitialSidebarBodyClass, getSiteNavToggleScript, getSiteNavCollapseStateHelperScript, getSiteNavExpandCollapseAllButtonsScript, getSitePrevNextButtonsScript, getSiteSidebarToggleScript, getModeToggleScript, clampSidebarWidth, getSiteSidebarResizerScript, getImageLightboxScript, decodeHrefPart, detectNoteLabels, DEFAULT_NOTE_LABELS, ZH_NOTE_LABELS, readImageDimensions, clearImageDimensionsCache, IMAGE_DIMENSIONS_CACHE_MAX, renderTopicCached, clearTopicRenderCache, topicRenderCacheSize, topicRenderCacheBytesHeld, setTopicRenderCacheBudgetForTesting } from '../../editor/ditaRenderUtils';
import { parseDita, preprocessEntities } from '../../parser/ditaParser';
import { renderDocument } from '../../render/renderer';
import type { DitaNode } from '../../parser/domTypes';

function makeEl(baseType: string, attrs: Record<string, string>, children: DitaNode[] = []): DitaNode {
  return {
    type: 'element',
    baseType,
    attributes: attrs,
    children,
    sourceRange: { startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
  };
}

function textNode(text: string): DitaNode {
  return {
    type: 'text',
    text,
    children: [],
    sourceRange: { startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
  };
}

const KEYDEF_XML = `<?xml version="1.0" encoding="UTF-8"?>
<map>
  <keydef keys="product-name">
    <topicmeta>
      <keywords><keyword>My Product</keyword></keywords>
    </topicmeta>
  </keydef>
  <keydef keys="prod-version">
    <topicmeta>
      <keywords><keyword>2.0.1</keyword></keywords>
    </topicmeta>
  </keydef>
</map>`;

/**
 * A minimal but structurally real PNG: signature, IHDR carrying the
 * dimensions, IEND. The readers under test never validate the CRC, so a
 * correct one isn't needed -- only the length/tag/data layout they read.
 * Module-scoped because both the image-dimension tests and the topic-render
 * cache tests need real image files on disk.
 */
function writePng(path: string, width: number, height: number) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // bit depth
  ihdrData.writeUInt8(2, 9); // color type
  const chunk = (tag: string, data: Buffer) => {
    const tagBuf = Buffer.from(tag, 'ascii');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    return Buffer.concat([lenBuf, tagBuf, data, crcBuf]);
  };
  writeFileSync(path, Buffer.concat([sig, chunk('IHDR', ihdrData), chunk('IEND', Buffer.alloc(0))]));
}

describe('detectNoteLabels', () => {
  function makeRoot(attrs: Record<string, string>): DitaNode {
    return { type: 'element', attributes: attrs, children: [], sourceRange: { startLine: 0, startCol: 0, endLine: 0, endCol: 0 } };
  }

  it('should use the topic\'s own xml:lang when present', () => {
    const labels = detectNoteLabels(makeRoot({ 'xml:lang': 'zh-CN' }));
    assert.strictEqual(labels, ZH_NOTE_LABELS);
  });

  it('should default to English when neither xml:lang nor a uiLanguage fallback is available', () => {
    const labels = detectNoteLabels(makeRoot({}));
    assert.strictEqual(labels, DEFAULT_NOTE_LABELS);
  });

  // Most individual topic files don't repeat xml:lang on every file --
  // it's commonly set once, at the ditamap/bookmap level, and left
  // implicit on topics -- so a topic with no xml:lang of its own should
  // fall back to the editor's own display language rather than being
  // permanently stuck in English regardless of locale.
  it('should fall back to the uiLanguage parameter when the topic has no xml:lang of its own', () => {
    const labels = detectNoteLabels(makeRoot({}), 'zh-cn');
    assert.strictEqual(labels, ZH_NOTE_LABELS);
  });

  it('should prefer the topic\'s own xml:lang over the uiLanguage fallback when both are present', () => {
    const labels = detectNoteLabels(makeRoot({ 'xml:lang': 'en-US' }), 'zh-cn');
    assert.strictEqual(labels, DEFAULT_NOTE_LABELS);
  });

  it('should cover every DITA note/@type value in both languages, not just a partial subset', () => {
    const allTypes = ['note', 'notice', 'warning', 'danger', 'important', 'tip', 'restriction', 'attention', 'caution', 'fastpath', 'remember', 'trouble'];
    for (const t of allTypes) {
      assert.ok(DEFAULT_NOTE_LABELS[t], `DEFAULT_NOTE_LABELS is missing "${t}"`);
      assert.ok(ZH_NOTE_LABELS[t], `ZH_NOTE_LABELS is missing "${t}"`);
    }
  });
});

describe('readImageDimensions', () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'dita-viewer-img-dims-'));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeGif(path: string, width: number, height: number) {
    const buf = Buffer.alloc(13);
    buf.write('GIF89a', 0, 'ascii');
    buf.writeUInt16LE(width, 6);
    buf.writeUInt16LE(height, 8);
    writeFileSync(path, buf);
  }

  function writeBmp(path: string, width: number, height: number) {
    const buf = Buffer.alloc(26);
    buf.write('BM', 0, 'ascii');
    buf.writeUInt32LE(40, 14); // DIB header size
    buf.writeInt32LE(width, 18);
    buf.writeInt32LE(height, 22);
    writeFileSync(path, buf);
  }

  function writeJpeg(path: string, width: number, height: number) {
    // SOI, then an APP0/JFIF segment (to verify marker-skipping works),
    // then SOF0 carrying the real dimensions, then SOS + EOI.
    const app0 = Buffer.from('JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00', 'binary');
    const app0Header = Buffer.from([0xff, 0xe0, 0, 0]);
    app0Header.writeUInt16BE(app0.length + 2, 2);
    const sofPayload = Buffer.alloc(6);
    sofPayload.writeUInt8(8, 0);
    sofPayload.writeUInt16BE(height, 1);
    sofPayload.writeUInt16BE(width, 3);
    sofPayload.writeUInt8(1, 5);
    const sofHeader = Buffer.from([0xff, 0xc0, 0, 0]);
    sofHeader.writeUInt16BE(sofPayload.length + 2, 2);
    writeFileSync(path, Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      app0Header, app0,
      sofHeader, sofPayload,
      Buffer.from([0xff, 0xd9]),
    ]));
  }

  it('should read width/height from a real PNG file header', () => {
    const p = join(dir, 'a.png');
    writePng(p, 300, 200);
    assert.deepStrictEqual(readImageDimensions(p), { width: 300, height: 200 });
  });

  it('should read width/height from a real GIF file header', () => {
    const p = join(dir, 'a.gif');
    writeGif(p, 150, 100);
    assert.deepStrictEqual(readImageDimensions(p), { width: 150, height: 100 });
  });

  it('should read width/height from a real BMP file header, taking the absolute value of a top-down (negative) height', () => {
    const p = join(dir, 'a.bmp');
    writeBmp(p, 640, -480);
    assert.deepStrictEqual(readImageDimensions(p), { width: 640, height: 480 });
  });

  it('should read width/height from a real JPEG file, skipping past a JFIF/APP0 segment to find the SOF0 marker', () => {
    const p = join(dir, 'a.jpg');
    writeJpeg(p, 1024, 768);
    assert.deepStrictEqual(readImageDimensions(p), { width: 1024, height: 768 });
  });

  it('should read explicit width/height attributes from an SVG root element', () => {
    const p = join(dir, 'a.svg');
    writeFileSync(p, '<svg xmlns="http://www.w3.org/2000/svg" width="250" height="180" viewBox="0 0 250 180"><rect/></svg>');
    assert.deepStrictEqual(readImageDimensions(p), { width: 250, height: 180 });
  });

  it('should fall back to viewBox for an SVG with no explicit width/height attributes', () => {
    const p = join(dir, 'b.svg');
    writeFileSync(p, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect/></svg>');
    assert.deepStrictEqual(readImageDimensions(p), { width: 400, height: 300 });
  });

  it('should return undefined for a nonexistent file rather than throwing', () => {
    assert.strictEqual(readImageDimensions(join(dir, 'does-not-exist.png')), undefined);
  });

  it('should return undefined for an unsupported extension rather than throwing', () => {
    const p = join(dir, 'a.webp');
    writeFileSync(p, Buffer.from('RIFF....WEBPVP8 '));
    assert.strictEqual(readImageDimensions(p), undefined);
  });

  it('should return undefined for a truncated/corrupt PNG rather than throwing', () => {
    const p = join(dir, 'corrupt.png');
    writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    assert.strictEqual(readImageDimensions(p), undefined);
  });

  it('should return undefined for a JPEG with no SOF marker (e.g. truncated before it) rather than throwing', () => {
    const p = join(dir, 'nosof.jpg');
    writeFileSync(p, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    assert.strictEqual(readImageDimensions(p), undefined);
  });

  // Cache correctness: every source edit re-renders the whole topic, which
  // calls readImageDimensions again for every image in it -- most of which
  // had nothing to do with what was just typed. Caching by path + mtime
  // means those unrelated images should not need re-reading from disk.
  describe('caching', () => {
    it('should return a cached result for a file whose mtime has not changed, even if its on-disk content has (proving the cache, not a fresh read, is what answered)', () => {
      const p = join(dir, 'cache-a.png');
      // A single fixed reference timestamp applied identically both times,
      // rather than reading it back via statSync() in between -- fs.Stats'
      // mtimeMs can carry sub-millisecond precision on filesystems that
      // support it, but a JS Date (what statSync().mtime returns, and what
      // utimesSync ultimately applies) cannot represent that fraction, so
      // a read-then-reapply round trip can silently drift by a fraction of
      // a millisecond and never hit the cache at all -- flaky for reasons
      // that have nothing to do with whether the cache logic is correct.
      const fixedMtime = new Date('2024-01-01T00:00:00.000Z');
      writePng(p, 100, 80);
      utimesSync(p, fixedMtime, fixedMtime);
      const first = readImageDimensions(p);
      assert.deepStrictEqual(first, { width: 100, height: 80 });

      writePng(p, 999, 888); // different content, same file path
      utimesSync(p, fixedMtime, fixedMtime); // reapply the exact same Date value, not a re-read one

      const second = readImageDimensions(p);
      assert.deepStrictEqual(second, { width: 100, height: 80 }, 'mtime did not change, so the cached (old) dimensions should be returned rather than re-reading the (now different) file content');
    });

    it('should re-read and return fresh dimensions once mtime actually changes', () => {
      const p = join(dir, 'cache-b.png');
      writePng(p, 100, 80);
      assert.deepStrictEqual(readImageDimensions(p), { width: 100, height: 80 });

      writePng(p, 200, 160);
      const laterMtime = new Date(statSync(p).mtime.getTime() + 1000);
      utimesSync(p, laterMtime, laterMtime); // force a distinct, later mtime

      assert.deepStrictEqual(readImageDimensions(p), { width: 200, height: 160 }, 'a genuinely changed mtime should invalidate the cache and pick up the new content');
    });

    it('should not return a stale cached result for a file that has since been deleted', () => {
      const p = join(dir, 'cache-c.png');
      writePng(p, 100, 80);
      assert.deepStrictEqual(readImageDimensions(p), { width: 100, height: 80 });

      rmSync(p);
      assert.strictEqual(readImageDimensions(p), undefined, 'a deleted file must not keep returning its last-cached dimensions');
    });

    it('should cache a negative result (unreadable/unrecognized) too, not just successful reads', () => {
      const p = join(dir, 'cache-d.webp');
      writeFileSync(p, Buffer.from('not a real image'));
      assert.strictEqual(readImageDimensions(p), undefined);
      // Second call should also cleanly return undefined (from cache this
      // time) rather than erroring on a second attempt to parse garbage.
      assert.strictEqual(readImageDimensions(p), undefined);
    });

    it('should evict the least-recently-used entry once the cache fills past its cap, rather than growing without limit', () => {
      const p = join(dir, 'lru-victim.png');
      const fixedMtime = new Date('2024-01-01T00:00:00.000Z');
      writePng(p, 100, 80);
      utimesSync(p, fixedMtime, fixedMtime);
      assert.deepStrictEqual(readImageDimensions(p), { width: 100, height: 80 });

      // Push the victim out by reading enough distinct other images to
      // fill the cache past its cap (entries are tiny, so this is cheap).
      for (let i = 0; i < IMAGE_DIMENSIONS_CACHE_MAX; i++) {
        const q = join(dir, `lru-fill-${i}.png`);
        writePng(q, i + 1, i + 1);
        readImageDimensions(q);
      }

      // Same path, same mtime, but rewritten content: if the entry were
      // still cached the old dimensions would come back (see the mtime
      // test above), so fresh on-disk dimensions prove it was evicted.
      writePng(p, 320, 240);
      utimesSync(p, fixedMtime, fixedMtime);
      assert.deepStrictEqual(readImageDimensions(p), { width: 320, height: 240 }, 'the oldest entry should have been evicted once the cache filled past its cap, so a re-read from disk is what answers');
    });

    it('should re-read from disk after clearImageDimensionsCache(), even when mtime alone would not invalidate', () => {
      const p = join(dir, 'cache-clear.png');
      const fixedMtime = new Date('2024-06-01T00:00:00.000Z');
      writePng(p, 100, 80);
      utimesSync(p, fixedMtime, fixedMtime);
      assert.deepStrictEqual(readImageDimensions(p), { width: 100, height: 80 });

      writePng(p, 500, 400);
      utimesSync(p, fixedMtime, fixedMtime);
      clearImageDimensionsCache();

      assert.deepStrictEqual(readImageDimensions(p), { width: 500, height: 400 }, 'clearing the cache (the deactivation path) must force a fresh read even when mtime alone would not invalidate');
    });
  });
});

// Book mode re-renders every referenced topic on each pass, so this cache is
// what stands between "one keystroke in one topic" and "the whole book again".
// The tests below all pin mtime to a fixed timestamp (see the identical note
// in the image-dimensions caching block above) so that a cache hit and a cache
// miss are distinguishable by content alone -- otherwise every rewrite would
// invalidate on mtime and none of this would prove anything.
describe('renderTopicCached', () => {
  let dir: string;
  // Book mode hands the same keyMap instance to every topic in a pass, so a
  // shared one is the realistic fixture; the identity test passes its own.
  const keyMap = new Map<string, string>();
  const asWebviewUri = (relPath: string) => `https://vscode-resource/${relPath}`;
  const fixedMtime = new Date('2024-01-01T00:00:00.000Z');

  /** Writes (or rewrites) a one-paragraph topic and pins its mtime. */
  function writeTopic(name: string, body: string): string {
    const p = join(dir, name);
    const id = name.replace(/\.dita$/, '');
    writeFileSync(
      p,
      `<?xml version="1.0" encoding="UTF-8"?>\n<topic id="${id}"><title>${id}</title><body>${body}</body></topic>`,
    );
    utimesSync(p, fixedMtime, fixedMtime);
    return p;
  }

  function render(filePath: string, headingLevel = 1) {
    return renderTopicCached({ filePath, keyMap, asWebviewUri, headingLevel });
  }

  function bumpMtime(p: string) {
    const later = new Date(statSync(p).mtime.getTime() + 5000);
    utimesSync(p, later, later);
  }

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'dita-viewer-topic-cache-'));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
    clearTopicRenderCache();
  });
  // Module-level cache shared by every test in the file: start each one empty,
  // or a hit here could be explained by another test's leftovers.
  beforeEach(() => {
    clearTopicRenderCache();
  });
  afterEach(() => {
    setTopicRenderCacheBudgetForTesting(); // back to the production budget
    clearTopicRenderCache();
  });

  it('should return the cached HTML for an unchanged topic even after its on-disk content changed, proving the cache rather than a fresh render answered', () => {
    const a = writeTopic('a.dita', '<p>first</p>');
    assert.ok(render(a).html.includes('first'));

    // New content of the SAME LENGTH at the same pinned mtime: the stamp is
    // mtime:size, so a different length would (correctly) invalidate -- see
    // sourceText.test.ts. Equal length is what leaves nothing for the stamp
    // to notice.
    writeTopic('a.dita', '<p>other</p>');

    const again = render(a);
    assert.ok(again.html.includes('first'), 'no dependency changed, so the stored HTML is what should answer');
    assert.ok(!again.html.includes('other'), 'a re-render would have picked up the new content');
  });

  it('should re-render a topic once its own file mtime changes', () => {
    const a = writeTopic('own.dita', '<p>before</p>');
    assert.ok(render(a).html.includes('before'));

    writeTopic('own.dita', '<p>after</p>');
    bumpMtime(a);

    assert.ok(render(a).html.includes('after'), 'editing the topic itself must invalidate its own entry');
  });

  it('should re-render a topic when a conref target it pulled in changed, even though the topic file itself did not', () => {
    const shared = writeTopic('shared.dita', '<p id="sn">ORIGINAL</p>');
    const host = writeTopic('host.dita', '<p conref="shared.dita#shared/sn">fallback</p>');
    assert.ok(render(host).html.includes('ORIGINAL'), 'conref content is inlined into the referencing topic');

    // Only the target changed. A cache keyed on the topic file alone -- the
    // obvious design -- would serve stale HTML from here on.
    writeTopic('shared.dita', '<p id="sn">UPDATED</p>');
    bumpMtime(shared);

    const again = render(host);
    assert.ok(again.html.includes('UPDATED'), 'the conref target is a dependency of the referencing topic, so changing it must invalidate');
    assert.ok(!again.html.includes('ORIGINAL'));
  });

  it('should re-render a topic when an image it emitted natural dimensions for was replaced, since those dimensions are baked into the HTML', () => {
    const png = join(dir, 'dims.png');
    writePng(png, 300, 200);
    utimesSync(png, fixedMtime, fixedMtime);
    const a = writeTopic('img.dita', '<image href="dims.png"/>');
    assert.ok(render(a).html.includes('width="300"'), 'the natural size is emitted when the DITA source gives none');

    writePng(png, 640, 480);
    bumpMtime(png);

    assert.ok(render(a).html.includes('width="640"'), 'the image bytes are not in the output but its dimensions are, so a replaced image must invalidate the topic -- which never changed itself');
  });

  it('should treat a file that did not exist at render time as a dependency, so creating it invalidates', () => {
    const a = writeTopic('late-host.dita', '<image href="late.png"/>');
    assert.ok(!render(a).html.includes('width='), 'nothing to measure while the file is missing');

    writePng(join(dir, 'late.png'), 120, 90);

    assert.ok(render(a).html.includes('width="120"'), 'a dependency recorded as missing must invalidate when the file appears, or the topic stays dimension-less until something unrelated touches it');
  });

  it('should keep separate entries per headingLevel, since the same topic sits at different depths across two open books', () => {
    const a = writeTopic('depth.dita', '<p>x</p>');
    const shallow = render(a, 1);
    const deep = render(a, 2);

    assert.ok(/<h1[\s>]/.test(shallow.html), 'depth 1 renders an h1');
    assert.ok(/<h2[\s>]/.test(deep.html), 'depth 2 renders an h2');
    assert.strictEqual(topicRenderCacheSize(), 2, 'one entry per depth -- validating headingLevel instead of keying on it would make two open books evict each other every pass');

    assert.ok(render(a, 1).html.includes('<h1'), 'both entries stay independently valid');
    assert.ok(render(a, 2).html.includes('<h2'));
  });

  it('should re-render when handed a different keyMap instance even with equal contents, trading a false invalidation for never serving stale key values', () => {
    const a = writeTopic('keys.dita', '<p>one</p>');
    render(a);
    writeTopic('keys.dita', '<p>two</p>'); // new content, same pinned mtime

    assert.ok(render(a).html.includes('one'), 'same instance + unchanged mtimes = a hit');

    const freshMap = renderTopicCached({ filePath: a, keyMap: new Map(keyMap), asWebviewUri, headingLevel: 1 });
    assert.ok(freshMap.html.includes('two'), 'buildKeyMap rebuilds its Map when its own cache expires; treating an equal-but-distinct instance as "keys unchanged" would be an assumption this function cannot verify, so it re-renders instead');
  });

  it('should re-render when handed a different bookMembers set even with equal contents, since the same topic renders different HTML for a cross-file xref depending on whether the target is part of THIS book', () => {
    const other = writeTopic('other-target.dita', '<p>target</p>');
    const a = writeTopic('xref-host.dita', '<xref href="other-target.dita"/>');

    const inBook = new Set<string>([other]);
    const withBook = renderTopicCached({ filePath: a, keyMap, asWebviewUri, headingLevel: 1, bookMembers: inBook });
    assert.ok(withBook.html.includes('data-dita-book-xref'), 'target is in this book, so the xref should be a real link');

    // Same file, same pinned mtime, same keyMap instance -- everything the
    // OLD cache key considered is identical. Only the book membership
    // changed (this render's book does not contain the xref's target).
    const notInBook = new Set<string>();
    const withoutBook = renderTopicCached({ filePath: a, keyMap, asWebviewUri, headingLevel: 1, bookMembers: notInBook });
    assert.ok(!withoutBook.html.includes('data-dita-book-xref'), 'a cache keyed only on filePath+headingLevel+keyMap would wrongly reuse the first entry and still show a clickable link here');
    assert.ok(withoutBook.html.includes('xref-external'));
  });

  it('should not cache a failed render, so the next pass recovers once the file is there', () => {
    const missing = join(dir, 'not-yet.dita');
    const failed = render(missing);
    assert.ok(failed.error, 'a missing topic reports an error');
    assert.strictEqual(topicRenderCacheSize(), 0, 'a failure must not be pinned: the stamps would still match, because the file that failed is the very file whose mtime gets compared');

    const created = writeTopic('not-yet.dita', '<p>here now</p>');
    const recovered = render(created);
    assert.strictEqual(recovered.error, undefined);
    assert.ok(recovered.html.includes('here now'), 'a malformed or absent mid-edit save must not keep serving the error page after the file is fixed');
  });

  it('should not grow past the byte budget, evicting the oldest entry rather than growing without limit', () => {
    // Equal-length ids and bodies, so all three topics render to the same
    // number of bytes and the arithmetic below is exact rather than
    // approximate. Calibrating the budget against measured entries (rather
    // than a number guessed from the fixture markup) matters for the same
    // reason; filling the production 32MB with real renders would take
    // seconds and prove nothing this scale does not.
    const victim = writeTopic('victim.dita', '<p>vvvv</p>');
    render(victim);
    const fill0 = writeTopic('fill-0.dita', '<p>f0f0</p>');
    render(fill0);
    const budget = topicRenderCacheBytesHeld(); // exactly two entries' worth
    assert.ok(budget > 0);
    setTopicRenderCacheBudgetForTesting(budget);

    render(writeTopic('fill-1.dita', '<p>f1f1</p>'));

    assert.ok(topicRenderCacheBytesHeld() <= budget, 'the running total respects the budget');
    assert.ok(topicRenderCacheSize() < 3, 'the third entry did not simply grow the cache');

    writeTopic('victim.dita', '<p>v2v2</p>'); // new content, same pinned mtime
    assert.ok(render(victim).html.includes('v2v2'), 'only an eviction explains fresh output here, since nothing about the victim\'s stamps changed');
  });

  it('should skip caching a topic larger than the entire budget instead of evicting everything else to make room for it', () => {
    const small = writeTopic('small.dita', '<p>s</p>');
    render(small);
    const smallBytes = topicRenderCacheBytesHeld();
    const big = writeTopic('big.dita', '<p>b</p>');

    setTopicRenderCacheBudgetForTesting(1); // nothing at all can fit

    const result = render(big);
    assert.ok(result.html.includes('b'), 'it still renders correctly; only the caching is skipped');
    assert.strictEqual(topicRenderCacheSize(), 1, 'the entry that did fit survives');
    assert.strictEqual(topicRenderCacheBytesHeld(), smallBytes, 'and an impossible insert must not disturb the accounting');
  });

  it('should keep the byte total exact when an entry is replaced, not merely when one is added', () => {
    const a = writeTopic('acct.dita', '<p>one</p>');
    render(a);

    writeTopic('acct.dita', '<p>two, but longer</p>');
    bumpMtime(a);
    render(a);

    assert.strictEqual(topicRenderCacheSize(), 1);
    assert.strictEqual(
      topicRenderCacheBytesHeld(),
      Buffer.byteLength(render(a).html, 'utf8'),
      'the total must equal what is actually stored: an overwrite that only ever added would shrink the effective budget on every single edit',
    );
  });

  it('should re-render after clearTopicRenderCache(), even when mtime alone would not invalidate', () => {
    const a = writeTopic('cleared.dita', '<p>before</p>');
    render(a);
    writeTopic('cleared.dita', '<p>after</p>'); // new content, same pinned mtime

    clearTopicRenderCache();
    assert.strictEqual(topicRenderCacheSize(), 0, 'the deactivation path drops every entry');
    assert.strictEqual(topicRenderCacheBytesHeld(), 0, 'and resets the running total with them');
    assert.ok(render(a).html.includes('after'));
  });
});

describe('decodeHrefPart', () => {
  it('should decode %20 to a space', () => {
    assert.strictEqual(decodeHrefPart('images/db%20topology.png'), 'images/db topology.png');
  });

  it('should return strings without percent signs unchanged', () => {
    assert.strictEqual(decodeHrefPart('images/db_topology.png'), 'images/db_topology.png');
  });

  it('should decode UTF-8 escape sequences', () => {
    assert.strictEqual(decodeHrefPart('%E5%9B%BE%E7%89%87.png'), '图片.png');
  });

  it('should return malformed escape sequences unchanged', () => {
    assert.strictEqual(decodeHrefPart('50%zz.png'), '50%zz.png');
  });
});

describe('expandDitamapRefs', () => {
  it('should do nothing for non-element node', () => {
    const node = textNode('hello');
    expandDitamapRefs(node, '/dir', () => '');
    assert.strictEqual(node.text, 'hello');
  });

  it('should do nothing for element without href', () => {
    const node = makeEl('map/topicref', { keys: 'k1' });
    expandDitamapRefs(node, '/dir', () => '');
    assert.strictEqual(node.children.length, 0);
  });

  it('should do nothing for href to non-ditamap file', () => {
    const node = makeEl('map/topicref', { href: 'topic.dita' });
    expandDitamapRefs(node, '/dir', () => '');
    assert.strictEqual(node.children.length, 0);
  });

  it('should percent-decode encoded submap hrefs before reading the file', () => {
    const node = makeEl('map/mapref', { href: 'sub%20maps/key%20defs.ditamap', format: 'ditamap' });
    const seen: string[] = [];
    const readFile: FileReader = (p) => {
      seen.push(p);
      return KEYDEF_XML;
    };
    expandDitamapRefs(node, '/dir', readFile);
    assert.strictEqual(seen.length, 1);
    assert.ok(seen[0].includes('sub maps'), `decoded dir, got: ${seen[0]}`);
    assert.ok(seen[0].endsWith('key defs.ditamap'), `decoded file, got: ${seen[0]}`);
  });

  it('should expand children from referenced ditamap', () => {
    const node = makeEl('map/topicref', { href: 'keys.ditamap' });
    const readFile: FileReader = (path, _enc) => {
      assert.ok(path.endsWith('keys.ditamap'));
      return KEYDEF_XML;
    };

    expandDitamapRefs(node, '/project', readFile);

    assert.strictEqual(node.children.length, 2);
    assert.strictEqual(node.children[0].baseType, 'map/keydef');
    assert.strictEqual(node.children[0].attributes?.keys, 'product-name');
    assert.strictEqual(node.children[1].attributes?.keys, 'prod-version');
  });

  it('should expand for keydef with href to ditamap', () => {
    const node = makeEl('map/keydef', { href: 'keys.ditamap', keys: 'global' });
    const readFile: FileReader = (_p, _e) => KEYDEF_XML;

    expandDitamapRefs(node, '/dir', readFile);

    assert.strictEqual(node.children.length, 2);
    assert.strictEqual(node.children[0].attributes?.keys, 'product-name');
  });

  it('should handle missing file gracefully', () => {
    const node = makeEl('map/topicref', { href: 'missing.ditamap' });
    const readFile: FileReader = () => { throw new Error('ENOENT'); };

    expandDitamapRefs(node, '/dir', readFile);

    assert.strictEqual(node.children.length, 0);
  });

  it('should handle circular references via visited set', () => {
    const node = makeEl('map/topicref', { href: 'a.ditamap' });
    const childA = makeEl('map/topicref', { href: 'b.ditamap' });
    node.children = [childA];

    const readFile: FileReader = (path, _e) => {
      if (path.endsWith('a.ditamap')) {
        return `<map><topicref href="b.ditamap"/></map>`;
      }
      if (path.endsWith('b.ditamap')) {
        return `<map><topicref href="a.ditamap"/></map>`;
      }
      return '';
    };

    const visited = new Set<string>();
    expandDitamapRefs(node, '/dir', readFile, visited);

    // a.ditamap expands: adds b.ditamap ref from file
    // Then b.ditamap ref is expanded: but a.ditamap is in visited set, so it stops
    assert.strictEqual(node.children.length, 2); // original child + expanded from a.ditamap
    assert.strictEqual(visited.size, 2); // a.ditamap and b.ditamap
  });

  it('should still expand children when the node itself points at a visited map', () => {
    const child = makeEl('map/mapref', { href: 'b.ditamap' });
    const node = makeEl('map/mapref', { href: 'a.ditamap' }, [child]);
    const readFile: FileReader = (path) => {
      if (path.replace(/\\/g, '/').endsWith('b.ditamap')) return KEYDEF_XML;
      throw new Error('visited map must not be re-read: ' + path);
    };

    // a.ditamap was already inlined elsewhere; the old early-return skipped
    // the whole subtree, leaving b.ditamap unexpanded.
    const visited = new Set<string>([resolve('/dir', 'a.ditamap')]);
    expandDitamapRefs(node, '/dir', readFile, visited);

    assert.strictEqual(node.children.length, 1, 'a.ditamap itself must not be re-inlined');
    assert.strictEqual(child.children.length, 2);
    assert.strictEqual(child.children[0].attributes?.keys, 'product-name');
  });

  it('should recurse into existing children', () => {
    const child = makeEl('map/topicref', { href: 'keys.ditamap' });
    const node = makeEl('map/topicref', { href: 'main.dita' }, [child]);
    const readFile: FileReader = (_p, _e) => KEYDEF_XML;

    expandDitamapRefs(node, '/dir', readFile);

    assert.strictEqual(node.children.length, 1);
    assert.strictEqual(child.children.length, 2);
    assert.strictEqual(child.children[0].attributes?.keys, 'product-name');
  });

  it('should expand a keydef map living in a sub-folder', () => {
    const node = makeEl('map/topicref', { href: 'common/keys.ditamap' });
    const readFile: FileReader = (path, _enc) => {
      assert.ok(path.replace(/\\/g, '/').endsWith('/project/common/keys.ditamap'));
      return KEYDEF_XML;
    };

    expandDitamapRefs(node, '/project', readFile);

    assert.strictEqual(node.children.length, 2);
    assert.strictEqual(node.children[0].attributes?.keys, 'product-name');
  });

  it('should expand mapref elements', () => {
    const node = makeEl('map/mapref', { href: 'keys.ditamap' });
    const readFile: FileReader = (_p, _e) => KEYDEF_XML;

    expandDitamapRefs(node, '/dir', readFile);

    assert.strictEqual(node.children.length, 2);
    assert.strictEqual(node.children[0].attributes?.keys, 'product-name');
  });

  it('should rebase topic hrefs from a sub-folder map onto the root map dir', () => {
    const node = makeEl('map/topicref', { href: 'sub/inner.ditamap' });
    const readFile: FileReader = (path, _enc) => {
      const p = path.replace(/\\/g, '/');
      if (p.endsWith('/project/sub/inner.ditamap')) {
        return `<map>
          <topicref href="topics/a.dita"/>
          <topicref href="../shared/b.dita"/>
          <topicref href="http://example.com/x.dita" scope="external"/>
        </map>`;
      }
      throw new Error('unexpected: ' + path);
    };

    expandDitamapRefs(node, '/project', readFile);

    assert.strictEqual(node.children.length, 3);
    assert.strictEqual(node.children[0].attributes?.href, 'sub/topics/a.dita');
    assert.strictEqual(node.children[1].attributes?.href, 'shared/b.dita');
    // external hrefs must not be rewritten
    assert.strictEqual(node.children[2].attributes?.href, 'http://example.com/x.dita');
  });

  it('should resolve nested map refs relative to the including map', () => {
    const node = makeEl('map/topicref', { href: 'sub/inner.ditamap' });
    const readFile: FileReader = (path, _enc) => {
      const p = path.replace(/\\/g, '/');
      if (p.endsWith('/project/sub/inner.ditamap')) {
        // keys.ditamap is relative to sub/, not to the root map
        return `<map><topicref href="keys.ditamap"/></map>`;
      }
      if (p.endsWith('/project/sub/keys.ditamap')) {
        return KEYDEF_XML;
      }
      throw new Error('unexpected: ' + path);
    };

    expandDitamapRefs(node, '/project', readFile);

    assert.strictEqual(node.children.length, 1);
    const inner = node.children[0];
    assert.strictEqual(inner.attributes?.href, 'sub/keys.ditamap');
    assert.strictEqual(inner.children.length, 2);
    assert.strictEqual(inner.children[0].attributes?.keys, 'product-name');
  });
});

describe('makeFileTitleResolver', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'dita-title-'));
    writeFileSync(join(dir, 'topic.dita'), `<topic id="t1"><title>Real Topic Title</title></topic>`);
    // File deliberately named like a bare id — must NOT be picked up
    writeFileSync(join(dir, 'someid'), `<topic id="someid"><title>Ghost Title</title></topic>`);
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('should resolve the root title of a local .dita href', () => {
    const resolver = makeFileTitleResolver(dir);
    assert.strictEqual(resolver('topic.dita'), 'Real Topic Title');
  });

  it('should return undefined for external URLs instead of probing the filesystem', () => {
    const resolver = makeFileTitleResolver(dir);
    assert.strictEqual(resolver('https://example.com/page.dita'), undefined);
    assert.strictEqual(resolver('mailto:someone@example.com'), undefined);
  });

  it('should return undefined for absolute paths', () => {
    const resolver = makeFileTitleResolver(dir);
    assert.strictEqual(resolver(join(dir, 'topic.dita')), undefined);
  });

  it('should not treat a bare id as a filename even when a matching file exists', () => {
    const resolver = makeFileTitleResolver(dir);
    assert.strictEqual(resolver('someid'), undefined);
  });
});

describe('makeFileTopicTypeResolver (sniffRootTagName)', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'dita-type-'));
    writeFileSync(join(dir, 'concept.dita'), `<concept id="c1"><title>C</title></concept>`);
    writeFileSync(join(dir, 'task.dita'), `<task id="t1"><title>T</title></task>`);
    writeFileSync(join(dir, 'reference.dita'), `<reference id="r1"><title>R</title></reference>`);
    writeFileSync(join(dir, 'troubleshooting.dita'), `<troubleshooting id="tb1"><title>TB</title></troubleshooting>`);
    writeFileSync(join(dir, 'glossentry.dita'), `<glossentry id="g1"><glossterm>G</glossterm></glossentry>`);
    writeFileSync(join(dir, 'generic.dita'), `<topic id="t1"><title>Plain Topic</title></topic>`);
    // Full DITA preamble -- XML declaration, a DOCTYPE with a small
    // internal entity subset, and a leading comment -- all ahead of the
    // root element, exercising every branch of PREAMBLE_CONSTRUCT_RE at
    // once rather than one preamble construct per fixture file.
    writeFileSync(
      join(dir, 'full-preamble.dita'),
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<!DOCTYPE concept PUBLIC "-//OASIS//DTD DITA Concept//EN" "concept.dtd" [\n` +
        `  <!ENTITY product "Widget">\n` +
        `]>\n` +
        `<!-- generated file, do not edit -->\n` +
        `<concept id="c2"><title>Full preamble</title></concept>`,
    );
    // File deliberately named like a bare id — must NOT be picked up.
    writeFileSync(join(dir, 'someid'), `<concept id="someid"><title>Ghost</title></concept>`);
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('should resolve the root tag of a local .dita href to its capitalized type label, for each common specialization', () => {
    const resolver = makeFileTopicTypeResolver(dir);
    assert.strictEqual(resolver('concept.dita'), 'Concept');
    assert.strictEqual(resolver('task.dita'), 'Task');
    assert.strictEqual(resolver('reference.dita'), 'Reference');
    assert.strictEqual(resolver('troubleshooting.dita'), 'Troubleshooting');
    assert.strictEqual(resolver('glossentry.dita'), 'Glossentry');
  });

  it('should see past an XML declaration, a DOCTYPE with an internal entity subset, and a leading comment to find the root element', () => {
    const resolver = makeFileTopicTypeResolver(dir);
    assert.strictEqual(resolver('full-preamble.dita'), 'Concept');
  });

  it('should return undefined for the generic <topic> root, since the default labeler drops it to avoid a row of identical chips with no information', () => {
    const resolver = makeFileTopicTypeResolver(dir);
    assert.strictEqual(resolver('generic.dita'), undefined);
  });

  it('should let a custom labeler override the default (e.g. localize, or hide tags the default would show)', () => {
    // A labeler that hides everything except "concept" -- a contrived but
    // representative case for the localized labeler in MapViewerProvider,
    // which both translates known tags and falls back to capitalized for
    // unknown ones.
    const resolver = makeFileTopicTypeResolver(dir, (tagName) =>
      tagName === 'concept' ? 'Concept (custom)' : undefined,
    );
    assert.strictEqual(resolver('concept.dita'), 'Concept (custom)');
    assert.strictEqual(resolver('task.dita'), undefined);
  });

  it('should return undefined for external URLs instead of probing the filesystem', () => {
    const resolver = makeFileTopicTypeResolver(dir);
    assert.strictEqual(resolver('https://example.com/page.dita'), undefined);
    assert.strictEqual(resolver('mailto:someone@example.com'), undefined);
  });

  it('should return undefined for absolute paths', () => {
    const resolver = makeFileTopicTypeResolver(dir);
    assert.strictEqual(resolver(join(dir, 'concept.dita')), undefined);
  });

  it('should not treat a bare id as a filename even when a matching file exists', () => {
    const resolver = makeFileTopicTypeResolver(dir);
    assert.strictEqual(resolver('someid'), undefined);
  });

  it('should return undefined for a missing file rather than throwing', () => {
    const resolver = makeFileTopicTypeResolver(dir);
    assert.strictEqual(resolver('does-not-exist.dita'), undefined);
  });

  it('should return undefined for an href with a fragment (points inside a topic, not at a file root) but still report the file\'s own root type', () => {
    const resolver = makeFileTopicTypeResolver(dir);
    // The fragment points at a nested topic inside the file; the resolver
    // deliberately resolves the file's *root* tag, not the fragment's, so
    // this still returns the file's root type. The contract is "what kind
    // of file is this", not "what kind of element does the fragment point
    // at" -- the sidebar links to files.
    assert.strictEqual(resolver('concept.dita#nested'), 'Concept');
  });

  it('caches a resolved tag name per absolute path, reading each file at most once', () => {
    writeFileSync(join(dir, 'counted.dita'), `<task id="ct1"><title>Counted</title></task>`);
    const resolver = makeFileTopicTypeResolver(dir);
    assert.strictEqual(resolver('counted.dita'), 'Task');
    // Mutate the file after the first call -- if the resolver were re-
    // reading on every call, this second call would see 'Concept'
    // instead. Getting 'Task' back proves it served the cached answer
    // without touching the file again.
    writeFileSync(join(dir, 'counted.dita'), `<concept id="ct1"><title>Counted</title></concept>`);
    assert.strictEqual(resolver('counted.dita'), 'Task', 'second call should be served from cache, not re-read the mutated file');
  });

  it('still finds the root tag when a huge DOCTYPE internal subset pushes it past the bounded sniff chunk, by falling back to the whole file', () => {
    // A comment well past ROOT_TAG_SNIFF_BYTES (8192) worth of padding
    // ahead of the root element -- the bounded read alone won't reach it.
    const padding = '<!-- ' + 'x'.repeat(9000) + ' -->\n';
    writeFileSync(join(dir, 'huge-preamble.dita'), padding + `<reference id="huge"><title>Huge</title></reference>`);
    const resolver = makeFileTopicTypeResolver(dir);
    assert.strictEqual(resolver('huge-preamble.dita'), 'Reference');
  });
});

describe('makeConrefResolver', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'dita-conref-'));
    writeFileSync(join(dir, 'reuse.dita'), `<topic id="conref_topic">
  <title>Reuse Topic</title>
  <body>
    <p id="note_script"><b>Important</b> note text</p>
    <plentry id="plentry_1">
      <pt>Parameter A</pt>
      <pd>Value A</pd>
    </plentry>
    <ph id="element_only"><image href="icon.png"/></ph>
  </body>
</topic>`);
    writeFileSync(join(dir, 'reuse_gemesh.dita'), `<topic id="conref_gemesh">
  <title>Gemesh Topic</title>
  <body>
    <plentry id="plentry_dg5">
      <pt>DB Host</pt>
      <pd>localhost</pd>
    </plentry>
  </body>
</topic>`);
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('should resolve ph conref returning the target element', () => {
    const resolver = makeConrefResolver(dir);
    const el = resolver('reuse.dita#conref_topic/note_script');
    assert.ok(el, 'should return resolved element');
    assert.strictEqual(el!.type, 'element');
    // Children should contain a <b> element and note text
    const childElements = (el!.children || []).filter((n) => n.type === 'element');
    const childTexts = (el!.children || []).filter((n) => n.type === 'text');
    assert.ok(childElements.some((n) => n.baseType === 'topic/b'), 'should contain a b element');
    assert.ok(childTexts.some((n) => (n.text || '').includes('note text')), 'should contain note text');
  });

  it('should resolve plentry conref returning target element with pt/pd children', () => {
    const resolver = makeConrefResolver(dir);
    const el = resolver('reuse.dita#conref_topic/plentry_1');
    assert.ok(el, 'should return resolved element');
    assert.strictEqual(el!.baseType, 'topic/plentry');
    const childElements = (el!.children || []).filter((n) => n.type === 'element');
    assert.ok(childElements.some((n) => n.baseType === 'topic/pt'), 'should contain a pt element');
    assert.ok(childElements.some((n) => n.baseType === 'topic/pd'), 'should contain a pd element');
    // Verify pt and pd appear in correct order
    const ptIdx = childElements.findIndex((n) => n.baseType === 'topic/pt');
    const pdIdx = childElements.findIndex((n) => n.baseType === 'topic/pd');
    assert.ok(ptIdx < pdIdx, 'pt should come before pd');
  });

  it('should return target element even when it has only element children', () => {
    const resolver = makeConrefResolver(dir);
    const el = resolver('reuse.dita#conref_topic/element_only');
    assert.ok(el, 'should return resolved element, not undefined');
    assert.strictEqual(el!.baseType, 'topic/ph');
    const childElements = (el!.children || []).filter((n) => n.type === 'element');
    assert.ok(childElements.some((n) => n.baseType === 'topic/image'), 'should contain an image element');
  });

  it('should resolve conref with only element id (no topic id)', () => {
    const resolver = makeConrefResolver(dir);
    const el = resolver('reuse.dita#note_script');
    assert.ok(el, 'should resolve with bare element id');
    assert.strictEqual(el!.attributes?.id, 'note_script');
  });

  it('should return undefined for missing file', () => {
    const resolver = makeConrefResolver(dir);
    const el = resolver('nonexistent.dita#some_id');
    assert.strictEqual(el, undefined);
  });

  it('should return undefined for missing element id', () => {
    const resolver = makeConrefResolver(dir);
    const el = resolver('reuse.dita#conref_topic/nonexistent_id');
    assert.strictEqual(el, undefined);
  });

  it('should resolve a same-document bare-id conref against the passed-in root, without touching the filesystem', () => {
    const ownDoc = parseDita(`<topic id="t1"><body><note id="note_xxx">Own-file note</note><p conref="#note_xxx"/></body></topic>`);
    const resolver = makeConrefResolver(dir, ownDoc.root);
    const el = resolver('#note_xxx');
    assert.ok(el, 'should resolve same-document conref');
    assert.strictEqual(el!.attributes?.id, 'note_xxx');
  });

  it('should resolve the "#./id" same-document shorthand some authors use', () => {
    const ownDoc = parseDita(`<topic id="t1"><body><note id="note_xxx">Own-file note</note><p conref="#./note_xxx"/></body></topic>`);
    const resolver = makeConrefResolver(dir, ownDoc.root);
    const el = resolver('#./note_xxx');
    assert.ok(el, 'should resolve "#./id" shorthand');
    assert.strictEqual(el!.attributes?.id, 'note_xxx');
  });

  it('should return undefined for a same-document conref when no root was passed in (rather than throwing)', () => {
    const resolver = makeConrefResolver(dir);
    assert.doesNotThrow(() => resolver('#note_xxx'));
    assert.strictEqual(resolver('#note_xxx'), undefined);
  });

  it('should render ph conref with filepath child as span.filepath (end-to-end)', () => {
    // Create a target file with <ph id="note_script"><filepath>.fscript</filepath></ph>
    writeFileSync(join(dir, 'conref.dita'), `<topic id="conref">
  <title>Conref Reuse</title>
  <body>
    <ph id="note_script"><filepath>.fscript</filepath></ph>
  </body>
</topic>`);

    const conrefResolver = makeConrefResolver(dir);
    // Source document: <ph conref="conref.dita#conref/note_script">
    const sourceXml = `<topic id="main_topic">
  <title>Main</title>
  <body>
    <p>Run the <ph conref="conref.dita#conref/note_script"/> now.</p>
  </body>
</topic>`;
    const doc = parseDita(preprocessEntities(sourceXml));
    const html = renderDocument(doc.root, {
      headingLevel: 1,
      asWebviewUri: (p: string) => `vscode-resource:${p}`,
      documentDir: dir,
      resolveConref: (conref: string) => conrefResolver(conref),
    });
    // Same-type conref: <ph> target, children (including <filepath>) are pulled in
    assert.ok(html.includes('class="filepath"'), `should contain span.filepath, got: ${html}`);
    assert.ok(html.includes('.fscript'), 'should contain .fscript text');
    assert.ok(!html.includes('conref'), 'conref attribute should be stripped');
  });

  it('should render ph conref with filepath as cross-type target (end-to-end)', () => {
    // Target file where the element with id is a <filepath> itself (different type)
    writeFileSync(join(dir, 'conref_fp.dita'), `<topic id="conref_fp">
  <title>Conref FP</title>
  <body>
    <p>Run the <filepath id="fp_script">.fscript</filepath> file.</p>
  </body>
</topic>`);

    const conrefResolver = makeConrefResolver(dir);
    // Source: <ph conref="conref_fp.dita#conref_fp/fp_script">
    const sourceXml = `<topic id="main_topic2">
  <title>Main2</title>
  <body>
    <p>Use <ph conref="conref_fp.dita#conref_fp/fp_script"/> today.</p>
  </body>
</topic>`;
    const doc = parseDita(preprocessEntities(sourceXml));
    const html = renderDocument(doc.root, {
      headingLevel: 1,
      asWebviewUri: (p: string) => `vscode-resource:${p}`,
      documentDir: dir,
      resolveConref: (conref: string) => conrefResolver(conref),
    });
    // Cross-type conref: <ph> referencing <filepath> — the <filepath> tag
    // replaces the <ph>, so span.filepath should be rendered.
    assert.ok(html.includes('class="filepath"'), `should contain span.filepath (cross-type), got: ${html}`);
    assert.ok(html.includes('.fscript'), 'should contain .fscript text');
    assert.ok(!html.includes('conref'), 'conref attribute should be stripped');
  });

  it('should resolve ph conref from file with DOCTYPE and entities (end-to-end)', () => {
    // Target file with DOCTYPE and entity declarations (typical DITA file)
    writeFileSync(join(dir, 'conref_doctype.dita'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA Topic//EN" "topic.dtd" [
  <!ENTITY prod "SuperApp">
]>
<topic id="conref_dt">
  <title>Conref DT</title>
  <body>
    <p id="note_script_dt">Run &prod; with <filepath>.fscript</filepath></p>
  </body>
</topic>`);

    const conrefResolver = makeConrefResolver(dir);
    const sourceXml = `<topic id="main_dt">
  <title>Main</title>
  <body>
    <p>Use <ph conref="conref_doctype.dita#conref_dt/note_script_dt"/> now.</p>
  </body>
</topic>`;
    const doc = parseDita(preprocessEntities(sourceXml));
    const html = renderDocument(doc.root, {
      headingLevel: 1,
      asWebviewUri: (p: string) => `vscode-resource:${p}`,
      documentDir: dir,
      resolveConref: (conref: string) => conrefResolver(conref),
    });
    assert.ok(html.includes('SuperApp'), `should contain resolved entity value, got: ${html}`);
    assert.ok(html.includes('.fscript'), 'should contain filepath text');
    assert.ok(html.includes('class="filepath"'), 'filepath element should be rendered');
    assert.ok(!html.includes('conref'), 'conref attribute should be stripped');
  });
});

describe('makeConrefRangeResolver', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'dita-conrefend-'));
    // Mirrors the reported real-world case: a repair topic with several
    // sibling <section> elements, referenced as a range from the first
    // through a later one (not the last), by id path.
    writeFileSync(join(dir, 'surface.dita'), `<topic id="repair">
  <title>Repair</title>
  <body>
    <section id="section_uph_nys_jgc"><title>Remove cover</title><p>Step one text</p></section>
    <section id="section_mid"><title>Replace part</title><p>Step two text</p></section>
    <section id="section_4rf_hyf_o9j"><title>Reattach cover</title><p>Step three text</p></section>
    <section id="section_after"><title>Not in range</title><p>Should not appear</p></section>
  </body>
</topic>`);
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('should resolve the full run of siblings from conref through conrefend, inclusive', () => {
    const resolver = makeConrefRangeResolver(dir);
    const range = resolver(
      'surface.dita#repair/section_uph_nys_jgc',
      'surface.dita#repair/section_4rf_hyf_o9j',
    );
    assert.ok(range, 'should resolve a range');
    assert.strictEqual(range!.length, 3, 'should include start, middle, and end sections');
    assert.strictEqual(range![0].attributes?.id, 'section_uph_nys_jgc');
    assert.strictEqual(range![1].attributes?.id, 'section_mid');
    assert.strictEqual(range![2].attributes?.id, 'section_4rf_hyf_o9j');
  });

  it('should return undefined when conref and conrefend are not siblings under the same parent', () => {
    writeFileSync(join(dir, 'mismatched.dita'), `<topic id="mismatched">
  <title>Mismatched</title>
  <body>
    <section id="outer_a"><p id="inner_b">nested</p></section>
    <section id="outer_c"><p>other</p></section>
  </body>
</topic>`);
    const resolver = makeConrefRangeResolver(dir);
    // inner_b's parent is the first <section>, not <body> -- not a sibling
    // of outer_c, which sits directly under <body>.
    const range = resolver('mismatched.dita#mismatched/inner_b', 'mismatched.dita#mismatched/outer_c');
    assert.strictEqual(range, undefined);
  });

  it('should return undefined when conrefend appears before conref in document order', () => {
    const resolver = makeConrefRangeResolver(dir);
    const range = resolver(
      'surface.dita#repair/section_4rf_hyf_o9j',
      'surface.dita#repair/section_uph_nys_jgc',
    );
    assert.strictEqual(range, undefined);
  });

  it('should resolve a same-document conrefend range against the passed-in root, without touching the filesystem', () => {
    const ownDoc = parseDita(`<topic id="t1"><body><section id="s1"><p>One</p></section><section id="s2"><p>Two</p></section><section id="s3"><p>Three</p></section></body></topic>`);
    const resolver = makeConrefRangeResolver(dir, ownDoc.root);
    const range = resolver('#s1', '#s2');
    assert.ok(range, 'should resolve a same-document range');
    assert.deepStrictEqual(range!.map((n) => n.attributes?.id), ['s1', 's2']);
  });

  it('should resolve the "#./id" same-document shorthand for conref/conrefend, same as makeConrefResolver does for a single conref', () => {
    const ownDoc = parseDita(`<topic id="t1"><body><section id="s1"><p>One</p></section><section id="s2"><p>Two</p></section><section id="s3"><p>Three</p></section></body></topic>`);
    const resolver = makeConrefRangeResolver(dir, ownDoc.root);
    const range = resolver('#./s1', '#./s2');
    assert.ok(range, 'should resolve a same-document range written with the "./" shorthand');
    assert.deepStrictEqual(range!.map((n) => n.attributes?.id), ['s1', 's2']);
  });

  it('should return undefined for a same-document conrefend range when no root was passed in (rather than throwing)', () => {
    const resolver = makeConrefRangeResolver(dir);
    assert.doesNotThrow(() => resolver('#s1', '#s2'));
    assert.strictEqual(resolver('#s1', '#s2'), undefined);
  });

  it('should render the full conrefend range end-to-end, matching only the first element to the referencing element', () => {
    const rangeResolver = makeConrefRangeResolver(dir);
    const sourceXml = `<topic id="main">
  <title>Main</title>
  <body>
    <section id="ref-local-id" conref="surface.dita#repair/section_uph_nys_jgc" conrefend="surface.dita#repair/section_4rf_hyf_o9j"/>
  </body>
</topic>`;
    const doc = parseDita(preprocessEntities(sourceXml));
    const html = renderDocument(doc.root, {
      headingLevel: 1,
      asWebviewUri: (p: string) => `vscode-resource:${p}`,
      documentDir: dir,
      resolveConrefRange: (conref: string, conrefend: string) => rangeResolver(conref, conrefend),
    });
    assert.ok(html.includes('Step one text'), 'first section in range should render');
    assert.ok(html.includes('Step two text'), 'middle section in range should render');
    assert.ok(html.includes('Step three text'), 'last section in range should render');
    assert.ok(!html.includes('Should not appear'), 'section after conrefend must not be included');
    assert.ok(!html.includes('conref='), 'conref/conrefend attributes should be stripped from the rendered output');
    // Only the referencing element's own local id should appear once (on
    // the first range member); it must not be duplicated across every
    // element in the range, and the range targets' own ids (section_mid
    // etc.) must not leak through on a same-type merge either.
    const occurrences = (html.match(/ref-local-id/g) || []).length;
    assert.strictEqual(occurrences, 1, 'ref-local-id should appear exactly once, on the first range member only');
  });
});

describe('findTextMatches', () => {
  it('should find case-sensitive plain-text matches', () => {
    const m = findTextMatches('abc ABC abc', 'abc', false, true);
    assert.deepStrictEqual(m, [
      { start: 0, end: 3 },
      { start: 8, end: 11 },
    ]);
  });

  it('should find case-insensitive plain-text matches', () => {
    const m = findTextMatches('abc ABC', 'abc', false, false);
    assert.deepStrictEqual(m, [
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ]);
  });

  it('should keep offsets correct when the text contains length-changing Unicode case folds', () => {
    // 'İ'.toLowerCase() has length 2 — the old lowerText-index approach
    // shifted every later match by one position per İ
    const text = 'İİİ abc';
    const m = findTextMatches(text, 'abc', false, false);
    assert.deepStrictEqual(m, [{ start: 4, end: 7 }]);
    assert.strictEqual(text.substring(4, 7), 'abc');
  });

  it('should treat regex metacharacters literally in plain-text mode', () => {
    const m = findTextMatches('cost is $5 (approx)', '$5 (approx)', false, true);
    assert.deepStrictEqual(m, [{ start: 8, end: 19 }]);
  });

  it('should support regex mode', () => {
    const m = findTextMatches('v1.2 and v3.4', 'v\\d+\\.\\d+', true, true);
    assert.deepStrictEqual(m, [
      { start: 0, end: 4 },
      { start: 9, end: 13 },
    ]);
  });

  it('should return null for an invalid regex', () => {
    assert.strictEqual(findTextMatches('abc', '(unclosed', true, true), null);
  });

  it('should not loop forever on zero-width regex matches', () => {
    const m = findTextMatches('bbb', 'a*', true, true);
    assert.deepStrictEqual(m, []);
  });

  it('should cap matches per text node at 1000', () => {
    const m = findTextMatches('a'.repeat(5000), 'a', false, true);
    assert.strictEqual(m!.length, 1000);
  });
});

describe('getSearchOverlayScript', () => {
  const opts = {
    placeholder: 'Find',
    nextMatch: 'Next match',
    prevMatch: 'Previous match',
    close: 'Close',
    matchCase: 'Match case',
    useRegex: 'Use regular expression',
    invalidRegex: 'Invalid regular expression',
  };

  it('emits a script that parses as JavaScript', () => {
    // The overlay is one long template literal with a dozen interpolations in
    // it, so a stray backtick or an unescaped interpolation anywhere ships a
    // search bar that silently never runs. new Function parses the body
    // without running it, so this only catches syntax errors -- the fake-DOM
    // harness further below is what actually executes it.
    assert.doesNotThrow(() => new Function(getSearchOverlayScript(opts)));
  });

  it('injects the exported findTextMatches verbatim rather than a second copy of its rules', () => {
    // The comment at the injection site promises webview and tests always run
    // the same matching algorithm. Comparing the emitted text against the
    // function's own source is what makes that promise load-bearing instead
    // of decorative: it fails the moment someone hand-copies the regex logic
    // into the template, which is the natural way for the two to drift.
    const script = getSearchOverlayScript(opts);
    assert.ok(
      script.includes('var findTextMatchesCore = ' + findTextMatches.toString() + ';'),
      'expected the overlay script to inject the exported findTextMatches verbatim',
    );
  });

  it('excludes docsite mode\'s sidebar (.site-nav) from search matches, not just the toolbar/search bar', () => {
    // Source-text regression guard, kept alongside the behavioral fake-DOM
    // test below ('does not create highlight ranges inside the .site-nav
    // sidebar') which exercises the same rule end to end.
    const script = getSearchOverlayScript(opts);
    assert.ok(script.includes("classList.contains('site-nav')"), 'the search text collection should exclude the sidebar');
  });

  // ── CSS Custom Highlight API behavior ──
  // The e2e harness only captures rendered HTML strings -- it cannot reach
  // into a webview to run script and read state back (see extension.ts's own
  // _test export comment), and jsdom is not a dependency of this project. So,
  // same spirit as getImageLightboxScript's fake DOM further down this file,
  // this hand-rolls just enough of document/Range/CSS.highlights to actually
  // execute performSearch and assert on what it did, rather than only
  // pinning source text.
  interface FakeTextNode {
    nodeType: 3;
    textContent: string;
    parentNode: FakeElement | null;
    parentElement: FakeElement | null;
  }
  type FakeNode = FakeElement | FakeTextNode;
  interface FakeElement {
    nodeType: 1;
    tagName: string;
    id: string;
    classListSet: Set<string>;
    classList: { contains: (c: string) => boolean; add: (c: string) => void; remove: (c: string) => void };
    style: Record<string, string>;
    children: FakeNode[];
    childNodes: FakeNode[];
    parentNode: FakeElement | null;
    parentElement: FakeElement | null;
    listeners: Record<string, Array<(e: Record<string, unknown>) => void>>;
    attrs: Record<string, string>;
    textContent: string;
    innerHTML: string;
    title: string;
    placeholder: string;
    value: string;
    scrollIntoViewCalls: Array<Record<string, unknown> | undefined>;
    scrollIntoView: (opts?: Record<string, unknown>) => void;
    checkVisibility?: () => boolean;
    focus: () => void;
    select: () => void;
    appendChild: <T extends FakeNode>(child: T) => T;
    setAttribute: (name: string, value: string) => void;
    addEventListener: (type: string, fn: (e: Record<string, unknown>) => void) => void;
  }

  function makeFakeText(text: string): FakeTextNode {
    const node: FakeTextNode = {
      nodeType: 3,
      textContent: text,
      parentNode: null,
      get parentElement() { return node.parentNode; },
    };
    return node;
  }

  function makeFakeElement(tag: string): FakeElement {
    const el: FakeElement = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      id: '',
      classListSet: new Set<string>(),
      classList: undefined as unknown as FakeElement['classList'],
      style: {},
      children: [],
      get childNodes() { return el.children; },
      parentNode: null,
      get parentElement() { return el.parentNode; },
      listeners: {},
      attrs: {},
      textContent: '',
      innerHTML: '',
      title: '',
      placeholder: '',
      value: '',
      scrollIntoViewCalls: [],
      scrollIntoView(opts) { el.scrollIntoViewCalls.push(opts); },
      focus() {},
      select() {},
      appendChild(child) {
        child.parentNode = el;
        el.children.push(child);
        return child;
      },
      setAttribute(name, value) { el.attrs[name] = value; },
      addEventListener(type, fn) {
        if (!el.listeners[type]) el.listeners[type] = [];
        el.listeners[type].push(fn);
      },
    };
    el.classList = {
      contains: (c) => el.classListSet.has(c),
      add: (c) => { el.classListSet.add(c); },
      remove: (c) => { el.classListSet.delete(c); },
    };
    return el;
  }

  function collectTextNodes(root: FakeElement): FakeTextNode[] {
    const out: FakeTextNode[] = [];
    (function walk(node: FakeElement) {
      for (const c of node.children) {
        if (c.nodeType === 3) out.push(c);
        else walk(c);
      }
    })(root);
    return out;
  }

  /** Fake Range: only what performSearch/updateCurrentMatch actually use --
   *  setStart/setEnd on a single text node, toString() for the matched
   *  substring, and a stubbed rect (scroll-position math isn't asserted on
   *  here, only that scrollTo gets called). */
  class FakeRange {
    get startContainer(): FakeTextNode | null { return this.startNode; }
    startNode: FakeTextNode | null = null;
    startOffset = 0;
    endNode: FakeTextNode | null = null;
    endOffset = 0;
    setStart(node: FakeTextNode, offset: number): void { this.startNode = node; this.startOffset = offset; }
    setEnd(node: FakeTextNode, offset: number): void { this.endNode = node; this.endOffset = offset; }
    toString(): string {
      const { startNode, endNode } = this;
      if (!startNode || !endNode) return '';
      if (startNode === endNode) return startNode.textContent.substring(this.startOffset, this.endOffset);
      // Across nodes: the tail of the first, every text node between them in
      // document order, the head of the last -- what a real Range stringifies to.
      let root: FakeElement = startNode.parentNode!;
      while (root.parentNode) root = root.parentNode;
      const all = collectTextNodes(root);
      const from = all.indexOf(startNode);
      const to = all.indexOf(endNode);
      let out = startNode.textContent.substring(this.startOffset);
      for (let i = from + 1; i < to; i++) out += all[i].textContent;
      return out + endNode.textContent.substring(0, this.endOffset);
    }
    /** Tests that care about geometry install a function here; the default
     *  (all zeros) is what an unlaid-out/hidden range reports. */
    static rectFn: () => { top: number; left: number; width: number; height: number } = () => ({ top: 0, left: 0, width: 0, height: 0 });
    getBoundingClientRect() { return FakeRange.rectFn(); }
  }

  /** Fake Highlight: a plain Set of ranges is all the real Highlight class
   *  is from the outside (it implements Set<Range>), and all this script
   *  ever does with one. */
  class FakeHighlight {
    items = new Set<FakeRange>();
    add(r: FakeRange): void { this.items.add(r); }
    clear(): void { this.items.clear(); }
  }


  /** Runs the overlay script against a fake body tree and returns the
   *  CSS.highlights registry (a real Map -- HighlightRegistry is Map-shaped
   *  from the outside), every fake element the script created (so the test
   *  can find its search input/buttons the same way a real DOM query would),
   *  and every window.scrollTo call. */
  function runOverlay(body: FakeElement, winExtras: Record<string, unknown> = {}) {
    const created: FakeElement[] = [];
    const docListeners: Record<string, Array<() => void>> = {};
    const head = makeFakeElement('head');
    const doc = {
      body,
      head,
      createElement: (tag: string) => { const el = makeFakeElement(tag); created.push(el); return el; },
      createRange: () => new FakeRange(),
      addEventListener: (type: string, fn: () => void) => { (docListeners[type] ||= []).push(fn); },
      querySelectorAll: () => [] as FakeElement[],
    };
    const highlights = new Map<string, FakeHighlight>();
    const css = { highlights };
    const scrollCalls: Record<string, unknown>[] = [];
    const win = { scrollY: 0, innerHeight: 768, scrollTo: (o: Record<string, unknown>) => { scrollCalls.push(o); }, ...winExtras };
    const script = getSearchOverlayScript(opts);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const api = new Function('document', 'window', 'CSS', 'Highlight', script + '\nreturn { refresh: typeof refreshSearchAfterDomChange === "function" ? refreshSearchAfterDomChange : function() {}, open: openSearchBar };')(
      doc, win, css, FakeHighlight,
    ) as { refresh: () => void; open: () => void };
    return { highlights, elements: created, scrollCalls, docListeners, ...api };
  }

  function findInput(elements: FakeElement[]): FakeElement {
    return elements.find((e) => e.tagName === 'INPUT')!;
  }
  function findCaseBtn(elements: FakeElement[]): FakeElement {
    return elements.find((e) => e.tagName === 'BUTTON' && e.textContent === 'Aa')!;
  }
  function findNextBtn(elements: FakeElement[]): FakeElement {
    return elements.find((e) => e.tagName === 'BUTTON' && e.innerHTML === '&darr;')!;
  }
  function findCloseBtn(elements: FakeElement[]): FakeElement {
    return elements.find((e) => e.tagName === 'BUTTON' && e.innerHTML === '&times;')!;
  }
  /** Runs a search the same way a reader toggling "Match case" would --
   *  that click handler calls performSearch synchronously, unlike the
   *  search input's own debounced 'input' listener. */
  function runSearch(elements: FakeElement[], term: string): void {
    findInput(elements).value = term;
    findCaseBtn(elements).listeners['click'][0]({});
  }

  it('highlights matches via CSS.highlights instead of wrapping them in <mark> elements', () => {
    const body = makeFakeElement('body');
    const p = body.appendChild(makeFakeElement('p'));
    p.appendChild(makeFakeText('the quick fox and the quick hare'));

    const { highlights, elements } = runOverlay(body);
    runSearch(elements, 'quick');

    const allHl = highlights.get('dita-search-all')!;
    assert.ok(allHl, 'expected an "all matches" highlight to be registered');
    assert.strictEqual(allHl.items.size, 2, 'expected two "quick" matches to be registered as highlight ranges');
    assert.deepStrictEqual(
      Array.from(allHl.items).map((r) => r.toString()).sort(),
      ['quick', 'quick'],
    );
    assert.ok(!elements.some((e) => e.tagName === 'MARK'), 'expected no <mark> elements to be created');
  });

  it('tracks the current match in a separate CSS.highlights entry from all matches, and advances it on next', () => {
    const body = makeFakeElement('body');
    const p = body.appendChild(makeFakeElement('p'));
    p.appendChild(makeFakeText('cat cat cat'));

    const { highlights, elements } = runOverlay(body);
    runSearch(elements, 'cat');

    const currentOffset = () => {
      const cur = Array.from(highlights.get('dita-search-current')!.items)[0];
      return cur ? cur.startOffset : -1;
    };
    assert.strictEqual(highlights.get('dita-search-current')!.items.size, 1);
    assert.strictEqual(currentOffset(), 0);
    assert.strictEqual(p.scrollIntoViewCalls.length, 1, 'expected the initial match to scroll into view once');

    const nextBtn = findNextBtn(elements);
    nextBtn.listeners['click'][0]({});
    assert.strictEqual(currentOffset(), 4);
    nextBtn.listeners['click'][0]({});
    assert.strictEqual(currentOffset(), 8);
    nextBtn.listeners['click'][0]({});
    assert.strictEqual(currentOffset(), 0, 'expected next to wrap back to the first match');
  });

  it('scrolls the match via its own element, not window.scrollTo (site/book mode scrolls #dita-content-root, body is overflow:hidden)', () => {
    const body = makeFakeElement('body');
    const p = body.appendChild(makeFakeElement('p'));
    p.appendChild(makeFakeText('cat cat'));

    const { elements, scrollCalls } = runOverlay(body);
    runSearch(elements, 'cat');
    findNextBtn(elements).listeners['click'][0]({});

    assert.strictEqual(scrollCalls.length, 0, 'window.scrollTo is a no-op when the scroller is #dita-content-root; must not be relied on');
    assert.strictEqual(p.scrollIntoViewCalls.length, 2, 'expected one scrollIntoView on the match\'s element per navigation');
    assert.strictEqual(p.scrollIntoViewCalls[0]?.block, 'center');
    assert.strictEqual(
      p.scrollIntoViewCalls[0]?.behavior,
      'instant',
      'a smooth animation is computed against layout that content-visibility:auto entries change while it runs, so it lands short/long of the match',
    );
  });

  it('re-centers the match when the first jump lands off-center, because skipped content-visibility entries change height once rendered', () => {
    // Real cause (book mode, content-visibility:auto entries with a 600px
    // size estimate): scrollIntoView aims using the estimated layout, the
    // entries near the viewport then render at their real height, and the
    // match ends up far from where it was aimed. Measure after the jump and
    // correct the scroller until the match sits at the viewport's centre.
    const body = makeFakeElement('body');
    const root = body.appendChild(makeFakeElement('div'));
    root.id = 'dita-content-root';
    const scroller = Object.assign(root, {
      scrollTop: 0,
      scrollHeight: 5000,
      clientHeight: 700,
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 900, height: 700 }),
    });
    const p = root.appendChild(makeFakeElement('p'));
    p.appendChild(makeFakeText('cat'));

    // The match really sits 1000px down the scroller; scrollIntoView (a
    // no-op in this fake) is the "landed wrong" coarse jump.
    FakeRange.rectFn = () => ({ left: 0, width: 30, height: 20, top: 1000 - scroller.scrollTop });
    const frames: Array<() => void> = [];
    const { elements } = runOverlay(body, {
      requestAnimationFrame: (cb: () => void) => { frames.push(cb); return frames.length; },
      getComputedStyle: (el: FakeElement) => ({ overflowY: el === root ? 'auto' : 'visible' }),
    });
    try {
      runSearch(elements, 'cat');
      for (let i = 0; i < 10 && frames.length; i++) frames.shift()!();

      const centre = FakeRange.rectFn().top + 10;
      assert.ok(Math.abs(centre - 350) <= 4, `expected the match centred in the 700px scroller, but its centre is at ${centre}`);
    } finally {
      FakeRange.rectFn = () => ({ top: 0, left: 0, width: 0, height: 0 });
    }
  });

  it('stops correcting once the reader scrolls (wheel) so it never fights them', () => {
    const body = makeFakeElement('body');
    const root = body.appendChild(makeFakeElement('div'));
    root.id = 'dita-content-root';
    const scroller = Object.assign(root, {
      scrollTop: 0,
      scrollHeight: 5000,
      clientHeight: 700,
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 900, height: 700 }),
    });
    const p = root.appendChild(makeFakeElement('p'));
    p.appendChild(makeFakeText('cat'));
    FakeRange.rectFn = () => ({ left: 0, width: 30, height: 20, top: 1000 - scroller.scrollTop });
    const frames: Array<() => void> = [];
    const { elements, docListeners } = runOverlay(body, {
      requestAnimationFrame: (cb: () => void) => { frames.push(cb); return frames.length; },
      getComputedStyle: (el: FakeElement) => ({ overflowY: el === root ? 'auto' : 'visible' }),
    });
    try {
      runSearch(elements, 'cat');
      const settled = scroller.scrollTop;
      // Layout shifts again after the first settle, but the reader has grabbed the wheel.
      FakeRange.rectFn = () => ({ left: 0, width: 30, height: 20, top: 1500 - scroller.scrollTop });
      docListeners['wheel'].forEach((fn) => fn());
      for (let i = 0; i < 10 && frames.length; i++) frames.shift()!();
      assert.strictEqual(scroller.scrollTop, settled, 'a pending correction must not yank the view after the reader scrolled');
    } finally {
      FakeRange.rectFn = () => ({ top: 0, left: 0, width: 0, height: 0 });
    }
  });

  it('keeps correcting after the first settle, because layout can shift again a few frames later', () => {
    const body = makeFakeElement('body');
    const root = body.appendChild(makeFakeElement('div'));
    root.id = 'dita-content-root';
    const scroller = Object.assign(root, {
      scrollTop: 0,
      scrollHeight: 5000,
      clientHeight: 700,
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 900, height: 700 }),
    });
    const p = root.appendChild(makeFakeElement('p'));
    p.appendChild(makeFakeText('cat'));
    let shift = 0;
    FakeRange.rectFn = () => ({ left: 0, width: 30, height: 20, top: 1000 + shift - scroller.scrollTop });
    const frames: Array<() => void> = [];
    const { elements } = runOverlay(body, {
      requestAnimationFrame: (cb: () => void) => { frames.push(cb); return frames.length; },
      getComputedStyle: (el: FakeElement) => ({ overflowY: el === root ? 'auto' : 'visible' }),
    });
    try {
      runSearch(elements, 'cat');
      frames.shift()!(); frames.shift()!(); // settled, then...
      shift = 170; // ...content-visibility entries finish rendering and push the match down
      for (let i = 0; i < 10 && frames.length; i++) frames.shift()!();
      const centre = FakeRange.rectFn().top + 10;
      assert.ok(Math.abs(centre - 350) <= 4, `expected the late shift to be corrected, centre is at ${centre}`);
    } finally {
      FakeRange.rectFn = () => ({ top: 0, left: 0, width: 0, height: 0 });
    }
  });

  it('does not match text inside content that is not rendered (display:none, e.g. profile-filtered-out), which has no box to highlight or scroll to', () => {
    const body = makeFakeElement('body');
    const shown = body.appendChild(makeFakeElement('p'));
    shown.appendChild(makeFakeText('cat here'));
    const hidden = body.appendChild(makeFakeElement('p'));
    hidden.checkVisibility = () => false;
    hidden.appendChild(makeFakeText('cat hidden'));

    const { elements, highlights } = runOverlay(body);
    runSearch(elements, 'cat');

    assert.strictEqual(highlights.get('dita-search-all')!.items.size, 1, 'only the rendered match counts');
    assert.strictEqual(elements.find((e) => e.textContent === '1/1') !== undefined, true, 'and the counter agrees');
  });

  describe('re-running the search after the DOM changed underneath it', () => {
    function setup(text: string) {
      const body = makeFakeElement('body');
      const p = body.appendChild(makeFakeElement('p'));
      const node = makeFakeText(text);
      p.appendChild(node);
      const env = runOverlay(body);
      const counter = () => env.elements.find((e) => e.tagName === 'SPAN')!.textContent;
      return { ...env, p, node, counter };
    }

    it('keeps the match the reader was on and does not scroll -- a live edit must not yank the preview back to the first match', () => {
      const { elements, p, counter, open, refresh } = setup('cat cat cat');
      runSearch(elements, 'cat');
      findNextBtn(elements).listeners['click'][0]({});
      assert.strictEqual(counter(), '2/3');
      const scrolls = p.scrollIntoViewCalls.length;

      open();
      refresh();

      assert.strictEqual(counter(), '2/3', 'still on the second match');
      assert.strictEqual(p.scrollIntoViewCalls.length, scrolls, 'no scroll: the reader has not asked to go anywhere');
    });

    it('clamps to the last match when the edit removed matches at or after the current one', () => {
      const { elements, node, counter, open, refresh } = setup('cat cat cat');
      runSearch(elements, 'cat');
      findNextBtn(elements).listeners['click'][0]({});
      findNextBtn(elements).listeners['click'][0]({});
      assert.strictEqual(counter(), '3/3');

      node.textContent = 'cat';
      open();
      refresh();

      assert.strictEqual(counter(), '1/1');
    });

    it('does nothing while the search bar is closed', () => {
      const { elements, counter, refresh } = setup('cat cat');
      runSearch(elements, 'cat');
      findCloseBtn(elements).listeners['click'][0]({});
      refresh();
      assert.strictEqual(counter(), '');
    });
  });

  it('caps the number of matches it tracks, and says the count is a floor', () => {
    const body = makeFakeElement('body');
    // findTextMatches already stops at 1000 per text node, so it takes several nodes to reach the overall cap.
    for (let i = 0; i < 6; i++) body.appendChild(makeFakeElement('p')).appendChild(makeFakeText('a'.repeat(1000)));
    const { elements, highlights } = runOverlay(body);
    runSearch(elements, 'a');
    assert.strictEqual(highlights.get('dita-search-all')!.items.size, 5000);
    assert.ok(elements.some((e) => e.textContent === '1/5000+'), 'the counter must not claim 5000 is the total');
  });

  it('re-runs the page search when a profiling-filter checkbox changes what is displayed', () => {
    const script = getProfilingFilterScript({ buttonLabel: 'Filter', buttonTitle: 'Filter', closeLabel: 'Close', emptyLabel: 'None' });
    assert.ok(
      /addEventListener\('change'[\s\S]{0,300}pfApplyFilter\(\);[\s\S]{0,250}refreshSearchAfterDomChange/.test(script),
      'the checkbox change handler must refresh the page search after pfApplyFilter: hidden/shown content changes the match set',
    );
  });

  it('does not scroll toward a match that has no layout box (hidden content reports an all-zero rect)', () => {
    const body = makeFakeElement('body');
    const root = body.appendChild(makeFakeElement('div'));
    root.id = 'dita-content-root';
    const scroller = Object.assign(root, {
      scrollTop: 500,
      scrollHeight: 5000,
      clientHeight: 700,
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 900, height: 700 }),
    });
    const p = root.appendChild(makeFakeElement('p'));
    p.appendChild(makeFakeText('cat'));
    const frames: Array<() => void> = [];
    const { elements } = runOverlay(body, {
      requestAnimationFrame: (cb: () => void) => { frames.push(cb); return frames.length; },
      getComputedStyle: (el: FakeElement) => ({ overflowY: el === root ? 'auto' : 'visible' }),
    });
    runSearch(elements, 'cat');
    for (let i = 0; i < 10 && frames.length; i++) frames.shift()!();
    assert.strictEqual(scroller.scrollTop, 500, 'a zero rect means "not laid out", not "at the top of the scroller"');
  });

  it('clears both highlight registries when the search bar is closed', () => {
    const body = makeFakeElement('body');
    const p = body.appendChild(makeFakeElement('p'));
    p.appendChild(makeFakeText('dog dog'));

    const { highlights, elements } = runOverlay(body);
    runSearch(elements, 'dog');
    assert.strictEqual(highlights.get('dita-search-all')!.items.size, 2);
    assert.strictEqual(highlights.get('dita-search-current')!.items.size, 1);

    findCloseBtn(elements).listeners['click'][0]({});

    assert.strictEqual(highlights.get('dita-search-all')!.items.size, 0);
    assert.strictEqual(highlights.get('dita-search-current')!.items.size, 0);
  });

  it('does not create highlight ranges inside the .site-nav sidebar', () => {
    const body = makeFakeElement('body');
    const nav = body.appendChild(makeFakeElement('div'));
    nav.classList.add('site-nav');
    nav.appendChild(makeFakeText('quick reference'));
    const p = body.appendChild(makeFakeElement('p'));
    p.appendChild(makeFakeText('a quick fox'));

    const { highlights, elements } = runOverlay(body);
    runSearch(elements, 'quick');

    assert.strictEqual(
      highlights.get('dita-search-all')!.items.size,
      1,
      'expected the sidebar\'s own "quick" text to be excluded from search matches',
    );
  });

  // ── Matches that cross inline element boundaries (F1) ──
  // Whether two adjacent pieces of text read as one string is decided by the
  // page's own layout: an element whose computed display is 'inline' (or
  // 'contents') flows into its neighbours; anything else is a boundary. The
  // fake getComputedStyle below stands in for that, keyed by tag.
  const INLINE_TAGS = new Set(['STRONG', 'EM', 'SPAN', 'CODE', 'A']);
  const layoutExtras = {
    getComputedStyle: (el: FakeElement) => ({
      display: INLINE_TAGS.has(el.tagName) ? 'inline' : 'block',
      overflowY: 'visible',
    }),
  };
  function ranges(highlights: Map<string, FakeHighlight>): FakeRange[] {
    return Array.from(highlights.get('dita-search-all')!.items);
  }
  function counter(elements: FakeElement[]): string {
    return elements.find((e) => e.tagName === 'SPAN')!.textContent;
  }

  it('matches a term that spans an inline element boundary as ONE range from the first text node to the last', () => {
    const body = makeFakeElement('body');
    const p = body.appendChild(makeFakeElement('p'));
    const before = p.appendChild(makeFakeText('Click '));
    const strong = p.appendChild(makeFakeElement('strong'));
    strong.appendChild(makeFakeText('OK'));
    const after = p.appendChild(makeFakeText(' now'));

    const { highlights, elements } = runOverlay(body, layoutExtras);
    runSearch(elements, 'Click OK now');

    const rs = ranges(highlights);
    assert.strictEqual(rs.length, 1);
    assert.strictEqual(rs[0].toString(), 'Click OK now');
    assert.strictEqual(rs[0].startNode, before);
    assert.strictEqual(rs[0].startOffset, 0);
    assert.strictEqual(rs[0].endNode, after);
    assert.strictEqual(rs[0].endOffset, 4);
    assert.strictEqual(counter(elements), '1/1');
  });

  it('works for CJK text with an inline element in the middle (no whitespace to lean on)', () => {
    const body = makeFakeElement('body');
    const p = body.appendChild(makeFakeElement('p'));
    p.appendChild(makeFakeText('点击'));
    p.appendChild(makeFakeElement('strong')).appendChild(makeFakeText('确定'));
    p.appendChild(makeFakeText('按钮'));

    const { highlights, elements } = runOverlay(body, layoutExtras);
    runSearch(elements, '击确定按');

    assert.deepStrictEqual(ranges(highlights).map((r) => r.toString()), ['击确定按']);
  });

  it('maps several matches in one run to the right nodes, including one that straddles a boundary', () => {
    const body = makeFakeElement('body');
    const p = body.appendChild(makeFakeElement('p'));
    p.appendChild(makeFakeText('bar and ba'));
    p.appendChild(makeFakeElement('em')).appendChild(makeFakeText('r'));
    p.appendChild(makeFakeText(' and bar'));

    const { highlights, elements } = runOverlay(body, layoutExtras);
    runSearch(elements, 'bar');

    assert.deepStrictEqual(ranges(highlights).map((r) => r.toString()), ['bar', 'bar', 'bar']);
    assert.strictEqual(counter(elements), '1/3');
  });

  it('ends a match at the end of its own text node instead of starting an empty range in the next one', () => {
    const body = makeFakeElement('body');
    const p = body.appendChild(makeFakeElement('p'));
    const first = p.appendChild(makeFakeText('ab'));
    p.appendChild(makeFakeElement('strong')).appendChild(makeFakeText('cd'));

    const { highlights, elements } = runOverlay(body, layoutExtras);
    runSearch(elements, 'ab');

    const [r] = ranges(highlights);
    assert.strictEqual(r.endNode, first);
    assert.strictEqual(r.endOffset, 2);
  });

  it('never matches across a block boundary: \"Hello</p><p>World\" does not contain \"oW\"', () => {
    const body = makeFakeElement('body');
    body.appendChild(makeFakeElement('p')).appendChild(makeFakeText('Hello'));
    body.appendChild(makeFakeElement('p')).appendChild(makeFakeText('World'));

    const { highlights, elements } = runOverlay(body, layoutExtras);
    runSearch(elements, 'oW');

    assert.strictEqual(ranges(highlights).length, 0);
    assert.strictEqual(counter(elements), '0/0');
  });

  it('a block child splits its parent\'s text: \"A<p>B</p>C\" does not contain \"AC\" or \"AB\"', () => {
    const body = makeFakeElement('body');
    const li = body.appendChild(makeFakeElement('li'));
    li.appendChild(makeFakeText('A'));
    li.appendChild(makeFakeElement('p')).appendChild(makeFakeText('B'));
    li.appendChild(makeFakeText('C'));

    const { highlights, elements } = runOverlay(body, layoutExtras);
    for (const term of ['AC', 'AB', 'BC']) {
      runSearch(elements, term);
      assert.strictEqual(ranges(highlights).length, 0, `\"${term}\" must not match across the block boundary`);
    }
    runSearch(elements, 'B');
    assert.strictEqual(ranges(highlights).length, 1);
  });

  it('a line break is a boundary even though <br> is display:inline', () => {
    const body = makeFakeElement('body');
    const p = body.appendChild(makeFakeElement('p'));
    p.appendChild(makeFakeText('one'));
    p.appendChild(makeFakeElement('br'));
    p.appendChild(makeFakeText('two'));
    const { highlights, elements } = runOverlay(body, {
      getComputedStyle: () => ({ display: 'inline', overflowY: 'visible' }),
    });
    runSearch(elements, 'onetwo');
    assert.strictEqual(ranges(highlights).length, 0);
  });

  it('text around a hidden inline element reads as one string, while the hidden text itself stays unsearchable', () => {
    const body = makeFakeElement('body');
    const p = body.appendChild(makeFakeElement('p'));
    p.appendChild(makeFakeText('foo'));
    const hidden = p.appendChild(makeFakeElement('span'));
    hidden.checkVisibility = () => false;
    hidden.appendChild(makeFakeText('XYZ'));
    p.appendChild(makeFakeText('bar'));

    const { highlights, elements } = runOverlay(body, layoutExtras);
    runSearch(elements, 'XYZ');
    assert.strictEqual(ranges(highlights).length, 0, 'hidden text stays unsearchable');
    runSearch(elements, 'foobar');
    assert.strictEqual(ranges(highlights).length, 1, 'display:none removes it from the flow, so the text around it reads as one string');
  });

  it('without layout information every element is a boundary, i.e. matching stays per text node', () => {
    const body = makeFakeElement('body');
    const p = body.appendChild(makeFakeElement('p'));
    p.appendChild(makeFakeText('Click '));
    p.appendChild(makeFakeElement('strong')).appendChild(makeFakeText('OK'));

    const { highlights, elements } = runOverlay(body);
    runSearch(elements, 'Click OK');
    assert.strictEqual(ranges(highlights).length, 0);
    runSearch(elements, 'OK');
    assert.strictEqual(ranges(highlights).length, 1);
  });

  it('whitespace between inline siblings is part of the string, whitespace-only blocks are not searchable', () => {
    const body = makeFakeElement('body');
    const p = body.appendChild(makeFakeElement('p'));
    p.appendChild(makeFakeElement('code')).appendChild(makeFakeText('a'));
    p.appendChild(makeFakeText(' '));
    p.appendChild(makeFakeElement('code')).appendChild(makeFakeText('b'));
    body.appendChild(makeFakeElement('div')).appendChild(makeFakeText('   '));

    const { highlights, elements } = runOverlay(body, layoutExtras);
    runSearch(elements, 'a b');
    assert.deepStrictEqual(ranges(highlights).map((r) => r.toString()), ['a b']);
    runSearch(elements, '   ');
    assert.strictEqual(ranges(highlights).length, 0, 'an indentation-only block was never searchable and still is not');
  });

  // ── Whitespace the browser collapses (F1 follow-up) ──
  // Source indentation ("Click\n    <b>OK</b>") renders as one space, and the
  // full-book index collapses it too, so a term typed with single spaces has
  // to find it. Ranges keep pointing at the RAW text.
  it('finds a term across a newline+indent inside one text node and ranges over the raw characters', () => {
    const body = makeFakeElement('body');
    const p = body.appendChild(makeFakeElement('p'));
    const t = p.appendChild(makeFakeText('Click\n      OK now'));

    const { highlights, elements } = runOverlay(body, layoutExtras);
    runSearch(elements, 'Click OK');

    const [r] = ranges(highlights);
    assert.strictEqual(ranges(highlights).length, 1);
    assert.strictEqual(r.startNode, t);
    assert.strictEqual(r.startOffset, 0);
    assert.strictEqual(r.endOffset, 'Click\n      OK'.length);
  });

  it('collapses whitespace that spans a node boundary into a single space', () => {
    const body = makeFakeElement('body');
    const p = body.appendChild(makeFakeElement('p'));
    const before = p.appendChild(makeFakeText('Click\n'));
    const strong = p.appendChild(makeFakeElement('strong'));
    const inner = strong.appendChild(makeFakeText('   OK'));

    const { highlights, elements } = runOverlay(body, layoutExtras);
    runSearch(elements, 'Click OK');

    const [r] = ranges(highlights);
    assert.strictEqual(ranges(highlights).length, 1);
    assert.strictEqual(r.startNode, before);
    assert.strictEqual(r.startOffset, 0);
    assert.strictEqual(r.endNode, inner);
    assert.strictEqual(r.endOffset, '   OK'.length);
  });

  it('a match that starts right after leading whitespace starts at the first visible character', () => {
    const body = makeFakeElement('body');
    const p = body.appendChild(makeFakeElement('p'));
    const t = p.appendChild(makeFakeText('\n     Hello'));

    const { highlights, elements } = runOverlay(body, layoutExtras);
    runSearch(elements, 'Hello');

    const [r] = ranges(highlights);
    assert.strictEqual(r.startNode, t);
    assert.strictEqual(r.startOffset, 6);
    assert.strictEqual(r.endOffset, 11);
  });

  it('does not collapse inside white-space:pre, where every space is real', () => {
    const body = makeFakeElement('body');
    body.appendChild(makeFakeElement('pre')).appendChild(makeFakeText('a  b'));
    const { highlights, elements } = runOverlay(body, {
      getComputedStyle: (el: FakeElement) => ({
        display: el.tagName === 'PRE' ? 'block' : 'block',
        whiteSpace: el.tagName === 'PRE' ? 'pre' : 'normal',
        overflowY: 'visible',
      }),
    });
    runSearch(elements, 'a  b');
    assert.strictEqual(ranges(highlights).length, 1);
    runSearch(elements, 'a b');
    assert.strictEqual(ranges(highlights).length, 0);
  });

  it('still excludes the toolbar and search bar when they sit between inline content', () => {
    const body = makeFakeElement('body');
    const bar = body.appendChild(makeFakeElement('div'));
    bar.id = '__toolbar';
    bar.appendChild(makeFakeText('quick toolbar'));
    body.appendChild(makeFakeElement('p')).appendChild(makeFakeText('a quick fox'));

    const { highlights, elements } = runOverlay(body, layoutExtras);
    runSearch(elements, 'quick');
    assert.strictEqual(ranges(highlights).length, 1);
  });
});

describe('toolbar scaffold/font-prefs/font-width-tag-tooltips scripts (a3\' extraction)', () => {
  // These three cover the code both DitaViewerProvider.ts and
  // MapViewerProvider.ts used to carry two byte-for-byte copies of. Same
  // reasoning as getSearchOverlayScript above: there is no DOM here to
  // actually run these against, so new Function's parse-only check is the
  // cheapest thing that still catches a broken template literal.

  it('getToolbarScaffoldScript emits a script that parses as JavaScript', () => {
    assert.doesNotThrow(() => new Function(getToolbarScaffoldScript({ previewToolbar: 'Preview toolbar' })));
  });

  it('gives every toolbar button and dropdown the same fixed, border-box height', () => {
    // Root cause of the reported unevenness: btnStyle used line-height:1
    // with no explicit height, so a button's rendered height tracked
    // whatever font-size it happened to carry -- and toolbar buttons carry
    // several different ones (11/12/13/14px, see fontBtn/fontResetBtn/
    // fsDown/siteSidebarToggleBtn etc. below in this same file). Pinning
    // the box height directly, via box-sizing:border-box, makes every
    // button's box the same regardless of its own font-size or padding
    // overrides layered on afterward in the same cssText string.
    const script = getToolbarScaffoldScript({ previewToolbar: 'Preview toolbar' });
    const btnStyleMatch = /var btnStyle = '([^']*)'/.exec(script);
    const ddStyleMatch = /var ddStyle = '([^']*)'/.exec(script);
    assert.ok(btnStyleMatch, 'expected to find the btnStyle declaration');
    assert.ok(ddStyleMatch, 'expected to find the ddStyle declaration');
    const btnStyle = btnStyleMatch![1];
    const ddStyle = ddStyleMatch![1];

    const heightOf = (style: string) => /height:(\d+px)/.exec(style)?.[1];
    assert.ok(btnStyle.includes('box-sizing:border-box'), 'btnStyle should fix its own box height regardless of padding/font-size');
    assert.ok(ddStyle.includes('box-sizing:border-box'), 'ddStyle should fix its own box height regardless of padding/font-size');
    assert.ok(heightOf(btnStyle), 'btnStyle should set an explicit height');
    assert.strictEqual(
      heightOf(btnStyle),
      heightOf(ddStyle),
      'buttons and dropdowns (select elements) should share the exact same height so the toolbar reads as one even row',
    );
  });

  it('strips native <select> chrome from the dropdown style so its box height actually matches a button\'s', () => {
    // box-sizing/height alone don't reach a <select>'s own UA styling (the
    // built-in chevron and its reserved padding) in every browser -- without
    // appearance:none, the two dropdowns (theme CSS, page width) can still
    // render taller than a same-height button even with identical CSS height.
    const script = getToolbarScaffoldScript({ previewToolbar: 'Preview toolbar' });
    const ddStyleMatch = /var ddStyle = '([^']*)'/.exec(script);
    assert.ok(ddStyleMatch, 'expected to find the ddStyle declaration');
    const ddStyle = ddStyleMatch![1];
    assert.ok(ddStyle.includes('appearance:none'), 'expected ddStyle to neutralize the select\'s native appearance');
  });

  it('getFontPrefsScript emits a script that parses as JavaScript', () => {
    assert.doesNotThrow(() => new Function(getFontPrefsScript({ setFontPrefsMsgType: 'setFontPrefs' })));
  });

  const buttonsOpts = {
    decreaseFontSize: 'Decrease font size',
    increaseFontSize: 'Increase font size',
    fontSans: 'Sans',
    fontSerif: 'Serif',
    fontCurrentSans: 'Current: Sans-serif',
    fontCurrentSerif: 'Current: Serif',
    fontSizeButtonExtraStyle: '',
    includeFontReset: false,
    widthAuto: 'Auto',
    widthFull: 'Full',
    widthWide: 'Wide',
    widthDesktop: 'Desktop',
    widthNarrow: 'Narrow',
    pageWidth: 'Page width',
    setWidthSelectionMsgType: 'setWidthSelection',
    tagTooltipsLabel: 'Tags',
    tagTooltipsOnTitle: 'Tags on',
    tagTooltipsOffTitle: 'Tags off',
    setTagTooltipsMsgType: 'setTagTooltips',
  };

  it('getToolbarFontWidthTagTooltipsButtonsScript emits a script that parses as JavaScript, with and without the font-reset button', () => {
    assert.doesNotThrow(() => new Function(getToolbarFontWidthTagTooltipsButtonsScript(buttonsOpts)));
    assert.doesNotThrow(() => new Function(getToolbarFontWidthTagTooltipsButtonsScript({
      ...buttonsOpts,
      includeFontReset: true,
      resetFont: 'Reset font',
    })));
  });

  it('includes a font-reset button only when includeFontReset is true -- the topic viewer has one, the map viewer does not', () => {
    const without = getToolbarFontWidthTagTooltipsButtonsScript(buttonsOpts);
    assert.ok(!without.includes('fontResetBtn'), 'expected no fontResetBtn when includeFontReset is false');
    const withReset = getToolbarFontWidthTagTooltipsButtonsScript({
      ...buttonsOpts,
      includeFontReset: true,
      resetFont: 'Reset font',
    });
    assert.ok(withReset.includes('fontResetBtn'), 'expected fontResetBtn when includeFontReset is true');
  });

  it('applies fontSizeButtonExtraStyle to the font-size buttons only -- the map viewer bolds them, the topic viewer does not', () => {
    const plain = getToolbarFontWidthTagTooltipsButtonsScript(buttonsOpts);
    assert.ok(plain.includes("fsDown.style.cssText = btnStyle + '';"));
    assert.ok(plain.includes("fsUp.style.cssText = btnStyle + '';"));
    const bold = getToolbarFontWidthTagTooltipsButtonsScript({ ...buttonsOpts, fontSizeButtonExtraStyle: 'font-weight:bold;' });
    assert.ok(bold.includes("fsDown.style.cssText = btnStyle + 'font-weight:bold;';"));
    assert.ok(bold.includes("fsUp.style.cssText = btnStyle + 'font-weight:bold;';"));
  });

  it('applies the page-width selection as the --max-width custom property (not just body.style.maxWidth), so it also reaches #dita-content-root.site-main in docsite mode -- body.style.maxWidth alone only ever affected the outer flex row body becomes in site mode, which site mode\'s own CSS already resets to none, making every width selection a no-op there', () => {
    const script = getToolbarFontWidthTagTooltipsButtonsScript(buttonsOpts);
    const setProps: Array<[string, string]> = [];
    const removedProps: string[] = [];
    const fakeSelect = {
      style: {},
      setAttribute: () => {},
      appendChild: () => {},
      addEventListener: () => {},
    };
    const fakeOption = { value: '', textContent: '', selected: false };
    const fakeButtons: Array<{ style: Record<string, unknown>; setAttribute: () => void; addEventListener: () => void }> = [];
    const fakeDocument = {
      createElement: (tag: string) => {
        if (tag === 'select') return fakeSelect;
        if (tag === 'option') return { ...fakeOption };
        const btn = { style: {}, setAttribute: () => {}, addEventListener: () => {} };
        fakeButtons.push(btn);
        return btn;
      },
      getElementById: () => null,
    };
    const bodyStyle = {
      maxWidth: '',
      margin: '',
      fontSize: '',
      fontFamily: '',
      setProperty: (name: string, value: string) => { setProps.push([name, value]); },
      removeProperty: (name: string) => { removedProps.push(name); },
    };
    // fontSize/isSerif/SERIF_STACK are declared by getFontPrefsScript in
    // production, always concatenated ahead of this one (see
    // MapViewerProvider.ts/DitaViewerProvider.ts's own script assembly);
    // stub them the same way here since this script alone references them
    // (fontBtn's initial label) without declaring them itself.
    const fontPrefsStub = 'var fontSize = 100; var isSerif = false; var SERIF_STACK = "serif";';
    const fn = new Function(
      'document', 'btnStyle', 'ddStyle', 'window',
      fontPrefsStub + script + '; return applyWidth;',
    );
    const applyWidth = fn(fakeDocument, '', '', { __fontPrefs: undefined, __widthSelection: undefined, __tagTooltips: undefined });
    // applyWidth is a closure over the real document.body from the script's
    // own top-level scope in production; here it closes over whatever
    // `document` this test handed the function, so point document.body at
    // the fake style object before calling it.
    (fakeDocument as unknown as { body: { style: typeof bodyStyle } }).body = { style: bodyStyle };
    applyWidth('1400px');
    assert.deepStrictEqual(setProps, [['--max-width', '1400px']], 'expected the CSS custom property to be set, not just body.style.maxWidth');
    applyWidth('');
    assert.deepStrictEqual(removedProps, ['--max-width'], 'expected the property to be cleared (falling back to :root\'s default), not set to an empty/invalid value');
  });

  it('does not append any of its buttons to a toolbar itself -- ordering stays with the caller', () => {
    // The two providers interleave these buttons with their own
    // (theme CSS dropdown, mode toggle, refresh, Flags, Filter) in
    // different orders; this function only builds and wires them up.
    const script = getToolbarFontWidthTagTooltipsButtonsScript(buttonsOpts);
    assert.ok(!script.includes('toolbar.appendChild'));
  });
});

describe('getSiteNavClickHandlerScript (docsite mode)', () => {
  // The script registers its arrow-key page turning on the window (which a key
  // reaches after every document-level handler); nothing here needs it to fire.
  const fakeWindow = { addEventListener: () => {} };

  it('emits a script that parses as JavaScript', () => {
    assert.doesNotThrow(() => new Function(getSiteNavClickHandlerScript({ switchSitePageMsgType: 'switchSitePage' })));
  });

  it('posts the configured message type, not a hardcoded one', () => {
    const script = getSiteNavClickHandlerScript({ switchSitePageMsgType: 'someOtherType' });
    assert.ok(script.includes("type: 'someOtherType'"));
    assert.ok(!script.includes("type: 'switchSitePage'"));
  });

  it('defines updatePrevNextButtons as a no-op when neither prev/next button exists in the DOM', () => {
    // Combined with getSitePrevNextButtonsScript below, this is what lets
    // tree/book mode run the exact same click-handler script as site mode
    // without erroring on document.getElementById returning null for
    // buttons that were never appended there.
    const script = getSiteNavClickHandlerScript({ switchSitePageMsgType: 'switchSitePage' });
    const fn = new Function('document', 'window', 'vscode', script + '; return typeof updatePrevNextButtons;');
    const fakeDocument = {
      getElementById: () => null,
      querySelectorAll: () => [],
      // The deferred init looks for the active link to seed the history from.
      querySelector: () => null,
      addEventListener: () => {},
    };
    assert.doesNotThrow(() => fn(fakeDocument, fakeWindow, { postMessage: () => {} }));
  });

  it('does not try to wire up prev/next buttons until they actually exist in the DOM (deferred to next tick)', () => {
    // Regression test for a reported bug: MapViewerProvider.ts injects
    // getSiteNavClickHandlerScript (which is what calls
    // updatePrevNextButtons() to establish initial state) *before*
    // getSitePrevNextButtonsScript creates the prev/next buttons and before
    // the toolbar containing them is appended to the page. Calling
    // updatePrevNextButtons() synchronously at that point, as it used to,
    // ran while document.getElementById('__site-prev-btn') still returned
    // null -- a silent no-op (see the test above) -- so the buttons were
    // left with no onclick handler at all until the first manual sidebar
    // click called updatePrevNextButtons() again, by which point the
    // buttons did exist. Reported symptom: prev/next do nothing until you
    // switch topics once by hand.
    //
    // Deferring the initial call to a macrotask means it always runs after
    // the rest of the synchronous page-load script (wherever the buttons
    // get created) has finished, regardless of which order the two scripts
    // happen to be textually assembled in -- so this is simulated here by
    // running the script against a document where the buttons genuinely
    // don't exist yet, then only creating them before letting the deferred
    // callback fire, the same way the real page-load script creates them
    // later than this one runs.
    const timers: Array<() => void> = [];
    const fakeSetTimeout = (fn: () => void) => { timers.push(fn); return 0; };
    const bTopic = makeFakeElement({ classes: ['site-nav-link'], attrs: { 'data-site-target': '/book/b.dita' } });
    const aTopic = makeFakeElement({ classes: ['site-nav-link', 'active'], attrs: { 'data-site-target': '/book/a.dita' } });
    const elementsById: Record<string, { scrollIntoView?: () => void; disabled?: boolean; onclick?: (() => void) | null }> = {};
    const { document } = makeFakeSiteDocument([aTopic, bTopic], elementsById);

    const script = getSiteNavClickHandlerScript({ switchSitePageMsgType: 'switchSitePage' });
    new Function('document', 'window', 'vscode', 'setTimeout', script)(document, fakeWindow, { postMessage: () => {} }, fakeSetTimeout);

    assert.strictEqual(timers.length, 1, 'expected the initial updatePrevNextButtons() call to be deferred exactly once');

    const nextBtn = { disabled: true, onclick: null as (() => void) | null };
    elementsById['__site-next-btn'] = nextBtn;

    timers[0]();

    assert.strictEqual(nextBtn.disabled, false, 'expected next to be enabled once the buttons exist when the deferred call actually runs');
    assert.strictEqual(typeof nextBtn.onclick, 'function', 'expected next to have a click handler wired up on the very first load, not only after a manual sidebar click');
  });

  // --- book-internal cross-topic xref clicks (docsite design doc, 3.2/4.5) ---
  //
  // These simulate real DOM click delegation (multiple document-level
  // 'click' listeners, each independently checking e.target.closest(...))
  // rather than calling switchToSitePage directly, since the thing under
  // test IS the delegation wiring: does a click on a data-dita-book-xref
  // link actually find the matching sidebar link and drive it the same
  // way a real sidebar click would.
  function makeFakeElement(opts: { classes?: string[]; attrs?: Record<string, string> }) {
    const classes = new Set(opts.classes || []);
    const attrs = opts.attrs || {};
    const el = {
      classList: {
        contains: (c: string) => classes.has(c),
        add: (c: string) => classes.add(c),
        remove: (c: string) => classes.delete(c),
      },
      getAttribute: (name: string) => (name in attrs ? attrs[name] : null),
      closest(selector: string): unknown {
        if (selector.startsWith('.')) return classes.has(selector.slice(1)) ? el : null;
        if (selector.startsWith('[') && selector.endsWith(']')) {
          const attr = selector.slice(1, -1);
          return attr in attrs ? el : null;
        }
        return null;
      },
    };
    return el;
  }

  function makeFakeSiteDocument(navLinks: ReturnType<typeof makeFakeElement>[], elementsById: Record<string, { scrollIntoView?: () => void; disabled?: boolean; onclick?: (() => void) | null }>) {
    const listeners: Record<string, Array<(e: unknown) => void>> = {};
    const document = {
      addEventListener: (evt: string, fn: (e: unknown) => void) => {
        (listeners[evt] = listeners[evt] || []).push(fn);
      },
      querySelectorAll: (sel: string) => (sel === '.site-nav-link' ? navLinks : []),
      querySelector: (sel: string) =>
        sel === '.site-nav-link.active' ? navLinks.find((l) => l.classList.contains('active')) ?? null : null,
      getElementById: (id: string) => elementsById[id] ?? null,
    };
    return {
      document,
      click(target: ReturnType<typeof makeFakeElement>) {
        for (const fn of listeners['click'] || []) fn({ target, preventDefault: () => {} });
      },
    };
  }

  it('clicking a book-xref link switches to the matching sidebar page and posts its target', () => {
    const posted: Array<{ type: string; target: string }> = [];
    const bTopic = makeFakeElement({ classes: ['site-nav-link'], attrs: { 'data-site-target': '/book/b.dita' } });
    const aTopic = makeFakeElement({ classes: ['site-nav-link', 'active'], attrs: { 'data-site-target': '/book/a.dita' } });
    const { document, click } = makeFakeSiteDocument([aTopic, bTopic], {});
    const script = getSiteNavClickHandlerScript({ switchSitePageMsgType: 'switchSitePage' });
    new Function('document', 'window', 'vscode', script)(document, fakeWindow, { postMessage: (m: { type: string; target: string }) => posted.push(m) });

    const xrefLink = makeFakeElement({ attrs: { 'data-dita-book-xref': '/book/b.dita#sec1' } });
    click(xrefLink);

    assert.deepStrictEqual(posted, [{ type: 'switchSitePage', target: '/book/b.dita' }]);
    assert.strictEqual(bTopic.classList.contains('active'), true, 'clicking the xref should switch the sidebar to the target page');
    assert.strictEqual(aTopic.classList.contains('active'), false);
  });

  it('clicking a book-xref link to the page already open just scrolls, without posting a page switch', () => {
    const posted: unknown[] = [];
    const scrolled: string[] = [];
    const aTopic = makeFakeElement({ classes: ['site-nav-link', 'active'], attrs: { 'data-site-target': '/book/a.dita' } });
    const { document, click } = makeFakeSiteDocument([aTopic], {
      'sec2': { scrollIntoView: () => scrolled.push('sec2') },
    });
    const script = getSiteNavClickHandlerScript({ switchSitePageMsgType: 'switchSitePage' });
    new Function('document', 'window', 'vscode', script)(document, fakeWindow, { postMessage: (m: unknown) => posted.push(m) });

    const xrefLink = makeFakeElement({ attrs: { 'data-dita-book-xref': '/book/a.dita#sec2' } });
    click(xrefLink);

    assert.deepStrictEqual(posted, [], 'the target page is already open -- no page switch to ask for');
    assert.deepStrictEqual(scrolled, ['sec2'], 'but it should still scroll to the anchor on the current page');
  });

  it('clicking a book-xref with no matching sidebar entry does nothing, rather than throwing', () => {
    const posted: unknown[] = [];
    const { document, click } = makeFakeSiteDocument([], {});
    const script = getSiteNavClickHandlerScript({ switchSitePageMsgType: 'switchSitePage' });
    new Function('document', 'window', 'vscode', script)(document, fakeWindow, { postMessage: (m: unknown) => posted.push(m) });

    const xrefLink = makeFakeElement({ attrs: { 'data-dita-book-xref': '/book/nowhere.dita' } });
    assert.doesNotThrow(() => click(xrefLink));
    assert.deepStrictEqual(posted, []);
  });

  it('clicking a book-xref with no fragment switches pages without attempting to scroll to an empty id', () => {
    const scrolled: string[] = [];
    const bTopic = makeFakeElement({ classes: ['site-nav-link'], attrs: { 'data-site-target': '/book/b.dita' } });
    const aTopic = makeFakeElement({ classes: ['site-nav-link', 'active'], attrs: { 'data-site-target': '/book/a.dita' } });
    const { document, click } = makeFakeSiteDocument([aTopic, bTopic], {
      '': { scrollIntoView: () => scrolled.push('') },
    });
    const script = getSiteNavClickHandlerScript({ switchSitePageMsgType: 'switchSitePage' });
    new Function('document', 'window', 'vscode', script)(document, fakeWindow, { postMessage: () => {} });

    const xrefLink = makeFakeElement({ attrs: { 'data-dita-book-xref': '/book/b.dita' } });
    click(xrefLink);

    assert.strictEqual(bTopic.classList.contains('active'), true);
  });

  // --- revealing the newly-active row inside collapsed branches ---
  interface NavNode {
    parentElement: NavNode | null;
    classList: { contains: (c: string) => boolean; add: (c: string) => void; remove: (c: string) => void };
    getAttribute: (n: string) => string | null;
    setAttribute: (n: string, v: string) => void;
    querySelector: (s: string) => unknown;
    closest: (s: string) => unknown;
    scrollIntoViewCalls: Array<Record<string, unknown> | undefined>;
    scrollIntoView: (o?: Record<string, unknown>) => void;
  }
  function makeNavNode(classes: string[], attrs: Record<string, string> = {}, parent: NavNode | null = null): NavNode {
    const cls = new Set(classes);
    const at: Record<string, string> = { ...attrs };
    const node: NavNode = {
      parentElement: parent,
      classList: { contains: (c) => cls.has(c), add: (c) => cls.add(c), remove: (c) => cls.delete(c) },
      getAttribute: (n) => (n in at ? at[n] : null),
      setAttribute: (n, v) => { at[n] = v; },
      querySelector: () => null,
      closest(sel: string): unknown {
        const need = sel.split('.').filter(Boolean);
        for (let el: NavNode | null = node; el; el = el.parentElement) if (need.every((c) => el!.classList.contains(c))) return el;
        return null;
      },
      scrollIntoViewCalls: [],
      scrollIntoView(o) { node.scrollIntoViewCalls.push(o); },
    };
    return node;
  }

  function buildCollapsedBranch() {
    // Part(collapsed) > ul > Chapter(collapsed) > ul > leaf > <a>
    const part = makeNavNode(['site-nav-item', 'has-children', 'collapsed']);
    const partUl = makeNavNode(['site-nav-children'], {}, part);
    const chapter = makeNavNode(['site-nav-item', 'has-children', 'collapsed'], {}, partUl);
    const chapterUl = makeNavNode(['site-nav-children'], {}, chapter);
    const leaf = makeNavNode(['site-nav-item'], {}, chapterUl);
    const hidden = makeNavNode(['site-nav-link'], { 'data-site-target': '/book/deep.dita' }, leaf);
    const visible = makeNavNode(['site-nav-link', 'active'], { 'data-site-target': '/book/top.dita' });
    return { part, chapter, hidden, visible };
  }

  function runSiteScript(navLinks: NavNode[], posted: Array<{ type: string }>) {
    const listeners: Array<(e: unknown) => void> = [];
    const document = {
      addEventListener: (evt: string, fn: (e: unknown) => void) => { if (evt === 'click') listeners.push(fn); },
      querySelectorAll: (sel: string) => (sel === '.site-nav-link' ? navLinks : []),
      querySelector: (sel: string) => (sel === '.site-nav-link.active' ? navLinks.find((l) => l.classList.contains('active')) ?? null : null),
      getElementById: () => null,
    };
    // Same assembly as MapViewerProvider.ts: one scope, collapse helper alongside the click handler.
    const script =
      getSiteNavCollapseStateHelperScript({ reportCollapseMsgType: 'setNavCollapsed' }) +
      getSiteNavClickHandlerScript({ switchSitePageMsgType: 'switchSitePage' });
    new Function('document', 'window', 'vscode', 'setTimeout', script)(document, fakeWindow, { postMessage: (m: { type: string }) => posted.push(m) }, () => 0);
    return (target: unknown) => listeners.forEach((fn) => fn({ target, preventDefault: () => {} }));
  }

  it('expands every collapsed ancestor of the page switched to, so the active row is actually visible (prev/next and xref jumps walk into collapsed branches)', () => {
    const { part, chapter, hidden, visible } = buildCollapsedBranch();
    const click = runSiteScript([visible, hidden], []);
    click(hidden);

    assert.strictEqual(hidden.classList.contains('active'), true);
    assert.strictEqual(chapter.classList.contains('collapsed'), false, 'the direct parent branch must open');
    assert.strictEqual(part.classList.contains('collapsed'), false, 'and so must its own collapsed parent');
    assert.strictEqual(chapter.getAttribute('aria-expanded'), 'true');
  });

  it('scrolls the sidebar just enough to bring the newly-active row into view', () => {
    const { hidden, visible } = buildCollapsedBranch();
    runSiteScript([visible, hidden], [])(hidden);
    assert.strictEqual(hidden.scrollIntoViewCalls.length, 1);
    assert.strictEqual(hidden.scrollIntoViewCalls[0]?.block, 'nearest', "'nearest' so an already-visible row does not jump");
  });

  it('does not persist the expansion: the reader only navigated, they did not choose to unfold those branches', () => {
    const { hidden, visible } = buildCollapsedBranch();
    const posted: Array<{ type: string }> = [];
    runSiteScript([visible, hidden], posted)(hidden);
    assert.deepStrictEqual(posted.map((m) => m.type), ['switchSitePage'], 'only the page switch is posted, no setNavCollapsed');
  });
});

describe('getBookNavClickHandlerScript (book mode sidebar, nested-fold-and-highlight-plan.md item 1)', () => {
  it('emits a script that parses as JavaScript', () => {
    assert.doesNotThrow(() => new Function(getBookNavClickHandlerScript()));
  });

  // Book mode has no separate page-fetch to simulate (unlike
  // getSiteNavClickHandlerScript's switchToSitePage) -- clicking a sidebar
  // link should just find the matching [data-book-anchor] element already
  // sitting in the DOM and scroll to it, so the fakes here model that
  // directly rather than a page-switch postMessage.
  function makeFakeElement(opts: { classes?: string[]; attrs?: Record<string, string> }) {
    const classes = new Set(opts.classes || []);
    const attrs = opts.attrs || {};
    const el = {
      classList: {
        contains: (c: string) => classes.has(c),
        add: (c: string) => classes.add(c),
        remove: (c: string) => classes.delete(c),
      },
      getAttribute: (name: string) => (name in attrs ? attrs[name] : null),
      closest(selector: string): unknown {
        if (selector.startsWith('.')) return classes.has(selector.slice(1)) ? el : null;
        return null;
      },
    };
    return el;
  }

  function makeFakeAnchor(id: string, scrolled: string[]) {
    return {
      getAttribute: (name: string) => (name === 'data-book-anchor' ? id : null),
      scrollIntoView: () => scrolled.push(id),
    };
  }

  function makeFakeBookDocument(
    navLinks: ReturnType<typeof makeFakeElement>[],
    anchors: ReturnType<typeof makeFakeAnchor>[],
  ) {
    const listeners: Array<(e: unknown) => void> = [];
    const document = {
      addEventListener: (evt: string, fn: (e: unknown) => void) => {
        if (evt === 'click') listeners.push(fn);
      },
      querySelectorAll: (sel: string) => (sel === '[data-book-anchor]' ? anchors : []),
      querySelector: (sel: string) =>
        sel === '.site-nav-link.active' ? navLinks.find((l) => l.classList.contains('active')) ?? null : null,
    };
    return {
      document,
      click(target: ReturnType<typeof makeFakeElement>) {
        for (const fn of listeners) fn({ target, preventDefault: () => {} });
      },
    };
  }

  it('scrolls to the matching data-book-anchor element and marks the clicked link active', () => {
    const scrolled: string[] = [];
    const bLink = makeFakeElement({ classes: ['site-nav-link'], attrs: { 'data-site-target': '/book/b.dita' } });
    const aLink = makeFakeElement({ classes: ['site-nav-link', 'active'], attrs: { 'data-site-target': '/book/a.dita' } });
    const bAnchor = makeFakeAnchor('/book/b.dita', scrolled);
    const { document, click } = makeFakeBookDocument([aLink, bLink], [makeFakeAnchor('/book/a.dita', scrolled), bAnchor]);
    const script = getBookNavClickHandlerScript();
    new Function('document', script)(document);

    click(bLink);

    assert.deepStrictEqual(scrolled, ['/book/b.dita']);
    assert.strictEqual(bLink.classList.contains('active'), true);
    assert.strictEqual(aLink.classList.contains('active'), false, 'the previously active link loses it');
  });

  it('compares data-book-anchor by exact string value rather than building a CSS selector, so a Windows-style backslash path matches instead of throwing or silently mismatching', () => {
    const scrolled: string[] = [];
    const target = 'C:\\proj\\docs\\topics\\ch1.dita';
    const link = makeFakeElement({ classes: ['site-nav-link'], attrs: { 'data-site-target': target } });
    const anchor = makeFakeAnchor(target, scrolled);
    const { document, click } = makeFakeBookDocument([link], [anchor]);
    const script = getBookNavClickHandlerScript();
    new Function('document', script)(document);

    assert.doesNotThrow(() => click(link));
    assert.deepStrictEqual(scrolled, [target]);
  });

  it('does nothing when the clicked link has no matching anchor in the DOM, rather than throwing', () => {
    const link = makeFakeElement({ classes: ['site-nav-link'], attrs: { 'data-site-target': '/book/missing.dita' } });
    const { document, click } = makeFakeBookDocument([link], []);
    const script = getBookNavClickHandlerScript();
    new Function('document', script)(document);

    assert.doesNotThrow(() => click(link));
    assert.strictEqual(link.classList.contains('active'), false, 'no anchor found, so no state change either');
  });

  it('ignores a click outside .site-nav-link entirely', () => {
    const scrolled: string[] = [];
    const { document, click } = makeFakeBookDocument([], [makeFakeAnchor('/book/a.dita', scrolled)]);
    const script = getBookNavClickHandlerScript();
    new Function('document', script)(document);

    const outsideEl = makeFakeElement({});
    assert.doesNotThrow(() => click(outsideEl));
    assert.deepStrictEqual(scrolled, []);
  });
});

describe('getBookScrollSyncScript (book mode sidebar, nested-fold-and-highlight-plan.md item 5)', () => {
  it('emits a script that parses as JavaScript', () => {
    assert.doesNotThrow(() => new Function(getBookScrollSyncScript()));
  });

  // Generic-enough fakes to model the actual nested markup
  // renderSiteNavTreeHtml produces (an <a class="site-nav-link"> inside a
  // <li class="site-nav-item">, itself possibly nested inside another
  // <li class="site-nav-item collapsed">'s <ul class="site-nav-children">)
  // rather than the flatter, closest-only fakes
  // getBookNavClickHandlerScript's own describe block above uses -- this
  // suite specifically needs to walk parentElement chains for
  // expandAncestorsOf.
  interface FakeNode {
    parentElement: FakeNode | null;
    classList: { contains: (c: string) => boolean; add: (c: string) => void; remove: (c: string) => void };
    getAttribute: (name: string) => string | null;
    setAttribute: (name: string, value: string) => void;
    querySelector: (selector: string) => unknown;
    closest: (selector: string) => unknown;
  }

  function makeNode(opts: { classes?: string[]; attrs?: Record<string, string> } = {}): FakeNode {
    const classes = new Set(opts.classes || []);
    const attrs: Record<string, string> = { ...(opts.attrs || {}) };
    const node: FakeNode = {
      parentElement: null,
      classList: {
        contains: (c: string) => classes.has(c),
        add: (c: string) => classes.add(c),
        remove: (c: string) => classes.delete(c),
      },
      getAttribute: (name: string) => (name in attrs ? attrs[name] : null),
      setAttribute: (name: string, value: string) => {
        attrs[name] = value;
      },
      querySelector: () => null, // no .site-nav-toggle in these fakes -- setSiteNavItemCollapsed tolerates that
      closest(selector: string): unknown {
        const required = selector.split('.').filter(Boolean);
        let el: FakeNode | null = node;
        while (el) {
          if (required.every((c) => el!.classList.contains(c))) return el;
          el = el.parentElement;
        }
        return null;
      },
    };
    return node;
  }

  function makeFakeAnchor(id: string) {
    return { getAttribute: (name: string) => (name === 'data-book-anchor' ? id : null) };
  }

  function makeFakeBookScrollDocument(opts: {
    contentRoot: unknown;
    anchors: ReturnType<typeof makeFakeAnchor>[];
    navLinks: ReturnType<typeof makeNode>[];
  }) {
    return {
      getElementById: (id: string) => (id === 'dita-content-root' ? opts.contentRoot : null),
      querySelectorAll: (sel: string) => {
        if (sel === '[data-book-anchor]') return opts.anchors;
        if (sel === '.site-nav-link') return opts.navLinks;
        return [];
      },
      querySelector: (sel: string) =>
        sel === '.site-nav-link.active' ? opts.navLinks.find((l) => l.classList.contains('active')) ?? null : null,
    };
  }

  class FakeIntersectionObserver {
    static instances: FakeIntersectionObserver[] = [];
    observed: unknown[] = [];
    callback: (entries: Array<{ target: unknown; isIntersecting: boolean }>) => void;
    options: unknown;
    constructor(callback: (entries: Array<{ target: unknown; isIntersecting: boolean }>) => void, options: unknown) {
      this.callback = callback;
      this.options = options;
      FakeIntersectionObserver.instances.push(this);
    }
    disconnected = false;
    observe(el: unknown) {
      this.observed.push(el);
    }
    disconnect() {
      this.disconnected = true;
    }
    trigger(entries: Array<{ target: unknown; isIntersecting: boolean }>) {
      this.callback(entries);
    }
  }

  class FakeMutationObserver {
    static instances: FakeMutationObserver[] = [];
    observed: Array<{ target: unknown; options: unknown }> = [];
    callback: () => void;
    constructor(callback: () => void) {
      this.callback = callback;
      FakeMutationObserver.instances.push(this);
    }
    observe(target: unknown, options: unknown) {
      this.observed.push({ target, options });
    }
    trigger() {
      this.callback();
    }
  }

  function run(document: unknown, vscode: unknown = { postMessage: () => {} }, withMutationObserver = false) {
    FakeIntersectionObserver.instances.length = 0;
    FakeMutationObserver.instances.length = 0;
    const script = getSiteNavCollapseStateHelperScript({ reportCollapseMsgType: 'setNavCollapsed' }) + getBookScrollSyncScript();
    new Function('document', 'IntersectionObserver', 'vscode', 'MutationObserver', script)(
      document, FakeIntersectionObserver, vscode, withMutationObserver ? FakeMutationObserver : undefined,
    );
    return FakeIntersectionObserver.instances[0];
  }

  it('does nothing (and never constructs an observer) when there are no data-book-anchor elements', () => {
    const document = makeFakeBookScrollDocument({ contentRoot: {}, anchors: [], navLinks: [] });
    assert.doesNotThrow(() => run(document));
    assert.strictEqual(FakeIntersectionObserver.instances.length, 0);
  });

  it('does nothing when #dita-content-root is missing', () => {
    const document = makeFakeBookScrollDocument({ contentRoot: null, anchors: [makeFakeAnchor('/a.dita')], navLinks: [] });
    assert.doesNotThrow(() => run(document));
    assert.strictEqual(FakeIntersectionObserver.instances.length, 0);
  });

  it('observes every data-book-anchor element against #dita-content-root with a top-weighted rootMargin', () => {
    const contentRoot = {};
    const anchorA = makeFakeAnchor('/a.dita');
    const anchorB = makeFakeAnchor('/b.dita');
    const document = makeFakeBookScrollDocument({ contentRoot, anchors: [anchorA, anchorB], navLinks: [] });
    const observer = run(document);
    assert.strictEqual(observer.observed.length, 2);
    assert.deepStrictEqual(observer.options, { root: contentRoot, rootMargin: '0px 0px -70% 0px', threshold: 0 });
  });

  it('marks the topmost currently-intersecting anchor active, not whichever the callback happens to report last', () => {
    const anchorA = makeFakeAnchor('/a.dita');
    const anchorB = makeFakeAnchor('/b.dita');
    const anchorC = makeFakeAnchor('/c.dita');
    const linkA = makeNode({ classes: ['site-nav-link'], attrs: { 'data-site-target': '/a.dita' } });
    const linkB = makeNode({ classes: ['site-nav-link'], attrs: { 'data-site-target': '/b.dita' } });
    const linkC = makeNode({ classes: ['site-nav-link'], attrs: { 'data-site-target': '/c.dita' } });
    const document = makeFakeBookScrollDocument({
      contentRoot: {},
      anchors: [anchorA, anchorB, anchorC], // document order
      navLinks: [linkA, linkB, linkC],
    });
    const observer = run(document);

    // B and C both currently visible (e.g. B is a short part just above C,
    // both inside the top-weighted band at once) -- document order says B
    // is topmost, so B, not C, should win even though the callback lists
    // C's entry first.
    observer.trigger([
      { target: anchorC, isIntersecting: true },
      { target: anchorB, isIntersecting: true },
    ]);
    assert.strictEqual(linkB.classList.contains('active'), true);
    assert.strictEqual(linkC.classList.contains('active'), false);

    // B scrolls out, leaving only C -- C becomes active and B loses it.
    observer.trigger([{ target: anchorB, isIntersecting: false }]);
    assert.strictEqual(linkB.classList.contains('active'), false);
    assert.strictEqual(linkC.classList.contains('active'), true);
  });

  it('expands every collapsed ancestor of the newly-active link, in the DOM only -- scrolling must not rewrite the persisted fold state (book mode\'s sidebar is closed by default, so the reader cannot even see it happen)', () => {
    const anchorB = makeFakeAnchor('/b.dita');
    const outerGroup = makeNode({ classes: ['site-nav-item', 'has-children', 'collapsed'], attrs: { 'data-nav-id': 'grp:0' } });
    const childrenUl = makeNode({ classes: ['site-nav-children'] });
    childrenUl.parentElement = outerGroup;
    const innerItem = makeNode({ classes: ['site-nav-item', 'has-children'] });
    innerItem.parentElement = childrenUl;
    const linkB = makeNode({ classes: ['site-nav-link'], attrs: { 'data-site-target': '/b.dita' } });
    linkB.parentElement = innerItem;

    const document = makeFakeBookScrollDocument({ contentRoot: {}, anchors: [anchorB], navLinks: [linkB] });
    const posted: Array<{ type: string; ids: string[] }> = [];
    const observer = run(document, { postMessage: (m: { type: string; ids: string[] }) => posted.push(m) });

    observer.trigger([{ target: anchorB, isIntersecting: true }]);

    assert.strictEqual(linkB.classList.contains('active'), true);
    assert.strictEqual(outerGroup.classList.contains('collapsed'), false, 'the collapsed ancestor should auto-expand');
    assert.deepStrictEqual(posted, [], 'the auto-expand is a consequence of where the reader scrolled, not a choice about the tree, so it is not reported for persistence');
  });

  it('does not report a collapse-state change when no ancestor needed expanding', () => {
    const anchorA = makeFakeAnchor('/a.dita');
    const linkA = makeNode({ classes: ['site-nav-link'], attrs: { 'data-site-target': '/a.dita' } });
    const document = makeFakeBookScrollDocument({ contentRoot: {}, anchors: [anchorA], navLinks: [linkA] });
    const posted: unknown[] = [];
    const observer = run(document, { postMessage: (m: unknown) => posted.push(m) });

    observer.trigger([{ target: anchorA, isIntersecting: true }]);

    assert.strictEqual(linkA.classList.contains('active'), true);
    assert.deepStrictEqual(posted, []);
  });

  it('rebinds to the new anchors when a live edit swaps the book\'s DOM out from under the observer', () => {
    // MSG_UPDATE_CONTENT / MSG_PATCH_CONTENT replace anchor elements; an
    // observer bound once at init keeps watching detached nodes, so the
    // sidebar highlight silently stops following the scroll.
    const oldAnchor = makeFakeAnchor('/a.dita');
    const linkA = makeNode({ classes: ['site-nav-link'], attrs: { 'data-site-target': '/a.dita' } });
    const opts = { contentRoot: {}, anchors: [oldAnchor], navLinks: [linkA] };
    const document = makeFakeBookScrollDocument(opts);
    const oldObserver = run(document, undefined, true);
    assert.strictEqual(FakeMutationObserver.instances.length, 1, 'expected a MutationObserver watching for DOM swaps');

    const newAnchor = makeFakeAnchor('/a.dita');
    opts.anchors = [newAnchor];
    FakeMutationObserver.instances[0].trigger();

    const observers = FakeIntersectionObserver.instances;
    assert.strictEqual(observers.length, 2, 'expected a fresh IntersectionObserver after the swap');
    assert.strictEqual(oldObserver.disconnected, true, 'the stale observer should be disconnected');
    assert.deepStrictEqual(observers[1].observed, [newAnchor]);
    observers[1].trigger([{ target: newAnchor, isIntersecting: true }]);
    assert.strictEqual(linkA.classList.contains('active'), true);
  });

  it('keeps the reader\'s current highlight when the sidebar\'s own markup is replaced (MSG_UPDATE_SIDEBAR marks the first link active)', () => {
    const anchorA = makeFakeAnchor('/a.dita');
    const anchorB = makeFakeAnchor('/b.dita');
    const oldLinkA = makeNode({ classes: ['site-nav-link'], attrs: { 'data-site-target': '/a.dita' } });
    const oldLinkB = makeNode({ classes: ['site-nav-link'], attrs: { 'data-site-target': '/b.dita' } });
    const opts = { contentRoot: {}, anchors: [anchorA, anchorB], navLinks: [oldLinkA, oldLinkB] };
    const observer = run(makeFakeBookScrollDocument(opts), undefined, true);
    observer.trigger([{ target: anchorB, isIntersecting: true }]);
    assert.strictEqual(oldLinkB.classList.contains('active'), true);

    // Host re-renders the sidebar with navigable[0] active, as collectBookParts does.
    const newLinkA = makeNode({ classes: ['site-nav-link', 'active'], attrs: { 'data-site-target': '/a.dita' } });
    const newLinkB = makeNode({ classes: ['site-nav-link'], attrs: { 'data-site-target': '/b.dita' } });
    opts.navLinks = [newLinkA, newLinkB];
    FakeMutationObserver.instances[0].trigger();

    assert.strictEqual(newLinkB.classList.contains('active'), true, 'reader is still on B');
    assert.strictEqual(newLinkA.classList.contains('active'), false, 'the host\'s default first-link mark must not survive the swap');
  });

  it('skips a group-heading anchor (no sidebar link) instead of clearing the highlight when it is the topmost visible one', () => {
    const groupAnchor = makeFakeAnchor('grp:0');
    const anchorA = makeFakeAnchor('/a.dita');
    const linkA = makeNode({ classes: ['site-nav-link'], attrs: { 'data-site-target': '/a.dita' } });
    const document = makeFakeBookScrollDocument({ contentRoot: {}, anchors: [groupAnchor, anchorA], navLinks: [linkA] });
    const observer = run(document);

    observer.trigger([
      { target: groupAnchor, isIntersecting: true },
      { target: anchorA, isIntersecting: true },
    ]);
    assert.strictEqual(linkA.classList.contains('active'), true, 'the first topic under the group heading should be active');

    // Reader scrolls so only the (link-less) heading of the next group is in the band.
    observer.trigger([{ target: anchorA, isIntersecting: false }]);
    observer.trigger([{ target: groupAnchor, isIntersecting: true }]);
    assert.strictEqual(linkA.classList.contains('active'), true, 'a heading with no link must not wipe the last-known active link');
  });

  it('does nothing when no anchor is currently visible, rather than clearing active for an unrelated reason', () => {
    const anchorA = makeFakeAnchor('/a.dita');
    const linkA = makeNode({ classes: ['site-nav-link', 'active'], attrs: { 'data-site-target': '/a.dita' } });
    const document = makeFakeBookScrollDocument({ contentRoot: {}, anchors: [anchorA], navLinks: [linkA] });
    const observer = run(document);

    observer.trigger([{ target: anchorA, isIntersecting: false }]);

    assert.strictEqual(linkA.classList.contains('active'), true, 'losing the only visible anchor keeps the last-known active link rather than clearing it to nothing');
  });
});

describe('getInitialSidebarBodyClass (nested-fold-and-highlight-plan.md item 6)', () => {
  it('adds site-nav-collapsed for book mode, so the sidebar starts closed like a PDF reader\'s bookmark panel', () => {
    assert.strictEqual(getInitialSidebarBodyClass('book'), 'mode-book site-nav-collapsed');
  });

  it('leaves site mode starting open, unchanged from before this feature', () => {
    assert.strictEqual(getInitialSidebarBodyClass('site'), 'mode-site');
  });

  it('leaves tree mode alone -- it has no sidebar to collapse', () => {
    assert.strictEqual(getInitialSidebarBodyClass('tree'), 'mode-tree');
  });
});

describe('getSiteNavToggleScript (docsite mode)', () => {
  it('emits a script that parses as JavaScript', () => {
    assert.doesNotThrow(() => new Function(getSiteNavCollapseStateHelperScript() + getSiteNavToggleScript()));
  });

  // Minimal standalone fakes (deliberately not reusing
  // getSiteNavClickHandlerScript's own makeFakeElement above, which is
  // scoped to that describe block) -- a fake .site-nav-item with a real
  // Set-backed classList (so classList.toggle's own add/remove-and-report
  // semantics are exercised, not just stubbed to a fixed return value) and
  // a fake .site-nav-toggle button whose closest('.site-nav-item') points
  // back at it, mirroring the actual parent/child DOM shape
  // renderSiteNavHtml produces.
  function makeFakeItem() {
    const classes = new Set<string>();
    const attrs: Record<string, string> = {};
    return {
      classList: {
        contains: (c: string) => classes.has(c),
        add: (c: string) => classes.add(c),
        remove: (c: string) => classes.delete(c),
        toggle: (c: string) => {
          if (classes.has(c)) { classes.delete(c); return false; }
          classes.add(c);
          return true;
        },
      },
      getAttribute: (name: string) => (name in attrs ? attrs[name] : null),
      setAttribute: (name: string, val: string) => { attrs[name] = val; },
      // The shared setter (getSiteNavCollapseStateHelperScript) reaches the
      // row's own toggle by querying down from the item rather than taking
      // it as an argument, since expand-all has no click event to read it
      // off. makeFakeToggle wires this up once it exists.
      querySelector: (_sel: string): unknown => null,
      attrs,
    };
  }

  function makeFakeToggle(item: ReturnType<typeof makeFakeItem>, initialAttrs?: Record<string, string>) {
    const attrs: Record<string, string> = { ...(initialAttrs || {}) };
    const toggle: { getAttribute: (n: string) => string | null; setAttribute: (n: string, v: string) => void; closest: (s: string) => unknown } = {
      getAttribute: (name: string) => (name in attrs ? attrs[name] : null),
      setAttribute: (name: string, val: string) => { attrs[name] = val; },
      closest: (selector: string) => {
        if (selector === '.site-nav-toggle') return toggle;
        if (selector === '.site-nav-item') return item;
        return null;
      },
    };
    item.querySelector = (sel: string) => (sel === ':scope > .site-nav-toggle' ? toggle : null);
    return toggle;
  }

  function makeFakeToggleDocument() {
    const listeners: Array<(e: unknown) => void> = [];
    const document = {
      addEventListener: (evt: string, fn: (e: unknown) => void) => { if (evt === 'click') listeners.push(fn); },
    };
    return {
      document,
      click(target: unknown) {
        for (const fn of listeners) fn({ target, preventDefault: () => {} });
      },
    };
  }

  it('clicking a toggle collapses its own .site-nav-item and flips its aria-expanded to false', () => {
    const item = makeFakeItem();
    item.setAttribute('aria-expanded', 'true');
    const toggle = makeFakeToggle(item, { 'aria-expanded': 'true', 'data-expand-label': 'Expand', 'data-collapse-label': 'Collapse' });
    const { document, click } = makeFakeToggleDocument();
    new Function('document', getSiteNavCollapseStateHelperScript() + getSiteNavToggleScript())(document);

    click(toggle);

    assert.strictEqual(item.classList.contains('collapsed'), true);
    assert.strictEqual(toggle.getAttribute('aria-expanded'), 'false');
    assert.strictEqual(item.getAttribute('aria-expanded'), 'false');
  });

  it('clicking an already-collapsed toggle expands it again, restoring aria-expanded to true', () => {
    const item = makeFakeItem();
    const toggle = makeFakeToggle(item, { 'aria-expanded': 'true', 'data-expand-label': 'Expand', 'data-collapse-label': 'Collapse' });
    const { document, click } = makeFakeToggleDocument();
    new Function('document', getSiteNavCollapseStateHelperScript() + getSiteNavToggleScript())(document);

    click(toggle); // collapse
    click(toggle); // expand again

    assert.strictEqual(item.classList.contains('collapsed'), false);
    assert.strictEqual(toggle.getAttribute('aria-expanded'), 'true');
  });

  it('swaps the toggle\'s aria-label between its data-collapse-label and data-expand-label as it flips', () => {
    const item = makeFakeItem();
    const toggle = makeFakeToggle(item, { 'aria-expanded': 'true', 'data-expand-label': '\u5c55\u5f00', 'data-collapse-label': '\u6298\u53e0' });
    const { document, click } = makeFakeToggleDocument();
    new Function('document', getSiteNavCollapseStateHelperScript() + getSiteNavToggleScript())(document);

    click(toggle); // now collapsed -- label should offer the "expand" verb
    assert.strictEqual(toggle.getAttribute('aria-label'), '\u5c55\u5f00');

    click(toggle); // expanded again -- label should offer the "collapse" verb
    assert.strictEqual(toggle.getAttribute('aria-label'), '\u6298\u53e0');
  });

  it('a click that does not hit a .site-nav-toggle (e.g. the link itself) does nothing, rather than throwing', () => {
    const item = makeFakeItem();
    const { document, click } = makeFakeToggleDocument();
    new Function('document', getSiteNavCollapseStateHelperScript() + getSiteNavToggleScript())(document);

    const link = { closest: () => null };
    assert.doesNotThrow(() => click(link));
    assert.strictEqual(item.classList.contains('collapsed'), false);
  });
});

describe('getSitePrevNextButtonsScript (docsite mode)', () => {
  const opts = { prevLabel: '\u2039', prevTitle: 'Previous topic', nextLabel: '\u203a', nextTitle: 'Next topic' };

  it('emits a script that parses as JavaScript', () => {
    assert.doesNotThrow(() => new Function(getSitePrevNextButtonsScript(opts)));
  });

  it('creates elements with the ids getSiteNavClickHandlerScript looks them up by', () => {
    const script = getSitePrevNextButtonsScript(opts);
    assert.ok(script.includes("sitePrevBtn.id = '__site-prev-btn'"));
    assert.ok(script.includes("siteNextBtn.id = '__site-next-btn'"));
  });

  it('does not append the buttons to a toolbar itself -- same convention as the other shared button scripts, caller decides whether/where', () => {
    const script = getSitePrevNextButtonsScript(opts);
    assert.ok(!script.includes('toolbar.appendChild'));
  });

  it('uses the configured labels/titles, not hardcoded English text', () => {
    const custom = { prevLabel: 'PREV', prevTitle: 'Go back', nextLabel: 'NEXT', nextTitle: 'Go forward' };
    const script = getSitePrevNextButtonsScript(custom);
    assert.ok(script.includes(JSON.stringify('PREV')));
    assert.ok(script.includes(JSON.stringify('Go back')));
    assert.ok(script.includes(JSON.stringify('NEXT')));
    assert.ok(script.includes(JSON.stringify('Go forward')));
  });
});

describe('getSiteSidebarToggleScript (docsite mode)', () => {
  const opts = { toggleTitle: 'Toggle topic list' };

  it('emits a script that parses as JavaScript', () => {
    assert.doesNotThrow(() => new Function(getSiteSidebarToggleScript(opts)));
  });

  it('creates a button with the id the click handler can be wired to', () => {
    const script = getSiteSidebarToggleScript(opts);
    assert.ok(script.includes("siteSidebarToggleBtn.id = '__site-sidebar-toggle-btn'"));
  });

  it('toggles the site-nav-collapsed class on body when clicked', () => {
    const script = getSiteSidebarToggleScript(opts);
    const listeners: Record<string, () => void> = {};
    const fakeBtn = {
      style: {},
      setAttribute: () => {},
      addEventListener: (evt: string, fn: () => void) => { listeners[evt] = fn; },
    };
    const fakeBody = {
      classList: {
        toggled: false,
        toggle(cls: string) { if (cls === 'site-nav-collapsed') this.toggled = !this.toggled; },
      },
    };
    const fn = new Function('document', 'btnStyle', script + '; return siteSidebarToggleBtn;');
    const fakeDocument = { createElement: () => fakeBtn, body: fakeBody };
    const btn = fn(fakeDocument, '');
    assert.strictEqual(btn, fakeBtn);
    listeners['click']();
    assert.strictEqual(fakeBody.classList.toggled, true, 'clicking the button should flip site-nav-collapsed on body');
  });

  it('does not append the button to a toolbar itself -- same convention as the other shared button scripts, caller decides whether/where', () => {
    const script = getSiteSidebarToggleScript(opts);
    assert.ok(!script.includes('toolbar.appendChild'));
  });

  it('uses the configured title, not hardcoded English text', () => {
    const custom = { toggleTitle: 'Afficher/masquer les sujets' };
    const script = getSiteSidebarToggleScript(custom);
    assert.ok(script.includes(JSON.stringify('Afficher/masquer les sujets')));
  });
});

describe('getModeToggleScript (docsite mode)', () => {
  const opts = {
    switchModeTitle: 'Switch mode',
    modeOutline: 'Outline',
    modeBook: 'Book',
    modeSite: 'Site',
    switchModeMsgType: 'switchMode',
  };

  it('emits a script that parses as JavaScript', () => {
    assert.doesNotThrow(() => new Function('currentMode', opts.switchModeMsgType, getModeToggleScript(opts)));
  });

  function run(currentMode: string) {
    const script = getModeToggleScript(opts);
    const fakeBtn = { style: {}, setAttribute: () => {}, addEventListener: () => {} };
    const fakeDocument = { createElement: () => fakeBtn };
    const fn = new Function('currentMode', 'btnStyle', 'document', 'vscode', script + '; return { btn: modeBtn, getMode: function() { return currentMode; } };');
    return fn(currentMode, '', fakeDocument, { postMessage: () => {} });
  }

  it('labels the button with the CURRENT mode, not the mode a click switches to -- the earlier version showed the target mode, which read backwards', () => {
    assert.strictEqual(run('book').btn.textContent, 'Book', 'in book mode, the button should say "Book", not "Site" (the mode a click would switch to)');
    assert.strictEqual(run('site').btn.textContent, 'Site');
    assert.strictEqual(run('tree').btn.textContent, 'Outline');
  });

  it('cycles outline (tree) -> site -> book -> outline (tree) on click, and posts the new mode', () => {
    const posted: Array<{ type: string; mode: string }> = [];
    const script = getModeToggleScript(opts);
    const listeners: Record<string, () => void> = {};
    const fakeBtn = {
      style: {},
      setAttribute: () => {},
      addEventListener: (evt: string, fn: () => void) => { listeners[evt] = fn; },
    };
    const fakeDocument = { createElement: () => fakeBtn };
    const fn = new Function('currentMode', 'btnStyle', 'document', 'vscode', script + '; return modeBtn;');
    const btn = fn('tree', '', fakeDocument, { postMessage: (m: { type: string; mode: string }) => posted.push(m) });
    assert.strictEqual(btn.textContent, 'Outline');
    listeners['click']();
    assert.strictEqual(btn.textContent, 'Site', 'first click from tree should switch to site and relabel to the new current mode');
    listeners['click']();
    assert.strictEqual(btn.textContent, 'Book');
    listeners['click']();
    assert.strictEqual(btn.textContent, 'Outline');
    assert.deepStrictEqual(posted.map(m => m.mode), ['site', 'book', 'tree']);
    assert.ok(posted.every(m => m.type === 'switchMode'));
  });

  it('does not append the button to a toolbar itself', () => {
    const script = getModeToggleScript(opts);
    assert.ok(!script.includes('toolbar.appendChild'));
  });
});

describe('clampSidebarWidth (docsite mode sidebar resize)', () => {
  it('passes values already inside the range through unchanged', () => {
    assert.strictEqual(clampSidebarWidth(300), 300);
  });

  it('clamps to the default minimum (160) and maximum (560)', () => {
    assert.strictEqual(clampSidebarWidth(50), 160);
    assert.strictEqual(clampSidebarWidth(9999), 560);
  });

  it('honors explicit min/max overrides', () => {
    assert.strictEqual(clampSidebarWidth(50, 100, 200), 100);
    assert.strictEqual(clampSidebarWidth(9999, 100, 200), 200);
    assert.strictEqual(clampSidebarWidth(150, 100, 200), 150);
  });
});

describe('getSiteSidebarResizerScript (docsite mode)', () => {
  it('emits a script that parses as JavaScript', () => {
    assert.doesNotThrow(() => new Function('document', getSiteSidebarResizerScript()));
  });

  it('no-ops without throwing when the resizer/.site-nav elements are not in the DOM (tree/book mode pages)', () => {
    const fakeDocument = { getElementById: () => null, querySelector: () => null };
    const fn = new Function('document', getSiteSidebarResizerScript());
    assert.doesNotThrow(() => fn(fakeDocument));
  });

  it('injects the exported clampSidebarWidth rather than re-deriving the clamp math inline', () => {
    const script = getSiteSidebarResizerScript();
    assert.ok(
      script.includes('var clampSidebarWidth = ' + clampSidebarWidth.toString() + ';'),
      'expected the resizer script to inject the exported clampSidebarWidth verbatim',
    );
  });
});

describe('getImageLightboxScript', () => {
  // A minimal, hand-rolled fake DOM -- same spirit as
  // getSiteNavClickHandlerScript/getSiteNavToggleScript's own fake
  // elements above, just enough real behavior (attributes, classList,
  // a small CSS-selector matcher for the handful of selectors this
  // script actually uses, event delegation via document-level
  // listeners) to exercise the synchronous, clipboard/fetch-independent
  // parts of the lightbox: opening/closing, arrow-key stepping, error
  // marking, and the right-click menu's own open/close/label.
  //
  // NOT covered here: copyImageToClipboard's own body (fetch +
  // createImageBitmap + navigator.clipboard.write) -- those are real
  // browser APIs with no meaningful fake in a plain Node test, so the
  // Ctrl+C-copies / right-click "Copy Image" *outcome* isn't
  // exercised, only that the menu opens with the right label and can
  // be dismissed.

  /** Minimal stand-in for a DOM Event -- just the fields
   *  getImageLightboxScript's own handlers actually read. */
  interface FakeDomEvent {
    target?: FakeElement;
    key?: string;
    clientX?: number;
    clientY?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
    preventDefault?: () => void;
  }

  interface FakeElement {
    tagName: string;
    attrs: Record<string, string>;
    style: Record<string, string>;
    classListSet: Set<string>;
    children: FakeElement[];
    parentNode: FakeElement | FakeDocument | null;
    listeners: Record<string, Array<(e: FakeDomEvent) => void>>;
    src: string;
    alt: string;
    title: string;
    textContent: string;
    disabled: boolean;
    offsetWidth: number;
    offsetHeight: number;
    getAttribute(name: string): string | null;
    setAttribute(name: string, value: string): void;
    hasAttribute(name: string): boolean;
    removeAttribute(name: string): void;
    classList: { add(c: string): void; contains(c: string): boolean; remove(c: string): void };
    appendChild(child: FakeElement): FakeElement;
    remove(): void;
    addEventListener(type: string, fn: (e: FakeDomEvent) => void): void;
    closest(selector: string): FakeElement | null;
    contains(el: FakeElement): boolean;
  }

  interface FakeDocument {
    body: FakeElement;
    listeners: Record<string, Array<(e: FakeDomEvent) => void>>;
    createElement(tag: string): FakeElement;
    addEventListener(type: string, fn: (e: FakeDomEvent) => void, _capture?: boolean): void;
    removeEventListener(type: string, fn: (e: FakeDomEvent) => void): void;
    querySelector(selector: string): FakeElement | null;
    querySelectorAll(selector: string): FakeElement[];
    dispatch(type: string, e: FakeDomEvent): void;
  }

  // Supports exactly the selectors getImageLightboxScript's own source
  // uses: a tag name, [attr]/: not([attr]), and .class, ORed together
  // with commas ('a, b'). Not a general CSS engine -- just enough to
  // drive this one script's own delegation logic faithfully.
  function matchesSimple(el: FakeElement, simple: string): boolean {
    const tagMatch = simple.match(/^[a-zA-Z]+/);
    if (tagMatch && el.tagName.toLowerCase() !== tagMatch[0].toLowerCase()) return false;
    const classMatches = simple.match(/\.[\w-]+/g) || [];
    for (const c of classMatches) if (!el.classListSet.has(c.slice(1))) return false;
    const notMatches = simple.match(/:not\(\[([\w-]+)\]\)/g) || [];
    for (const n of notMatches) {
      const attr = /:not\(\[([\w-]+)\]\)/.exec(n)![1];
      if (el.attrs[attr] !== undefined) return false;
    }
    const attrPresence = simple.replace(/:not\(\[[\w-]+\]\)/g, '').match(/\[([\w-]+)\]/g) || [];
    for (const a of attrPresence) {
      const attr = /\[([\w-]+)\]/.exec(a)![1];
      if (el.attrs[attr] === undefined) return false;
    }
    return true;
  }

  function matches(el: FakeElement, selector: string): boolean {
    return selector.split(',').some((s) => matchesSimple(el, s.trim()));
  }

  function makeFakeElement(tag: string): FakeElement {
    const el: FakeElement = {
      tagName: tag.toUpperCase(),
      attrs: {},
      style: {},
      classListSet: new Set<string>(),
      children: [],
      parentNode: null,
      listeners: {},
      src: '',
      alt: '',
      title: '',
      textContent: '',
      disabled: false,
      offsetWidth: 100,
      offsetHeight: 40,
      getAttribute(name) { return name in el.attrs ? el.attrs[name] : null; },
      setAttribute(name, value) { el.attrs[name] = value; },
      hasAttribute(name) { return name in el.attrs; },
      removeAttribute(name) { delete el.attrs[name]; },
      classList: undefined as unknown as FakeElement['classList'],
      appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
      remove() {
        if (el.parentNode && 'children' in el.parentNode) {
          const idx = (el.parentNode as FakeElement).children.indexOf(el);
          if (idx !== -1) (el.parentNode as FakeElement).children.splice(idx, 1);
        }
        el.parentNode = null;
      },
      addEventListener(type, fn) {
        if (!el.listeners[type]) el.listeners[type] = [];
        el.listeners[type].push(fn);
      },
      closest(selector) {
        let cur: FakeElement | null = el;
        while (cur) {
          if (matches(cur, selector)) return cur;
          cur = cur.parentNode && 'children' in cur.parentNode ? (cur.parentNode as FakeElement) : null;
        }
        return null;
      },
      contains(other) {
        let cur: FakeElement | null = other;
        while (cur) {
          if (cur === el) return true;
          cur = cur.parentNode && 'children' in cur.parentNode ? (cur.parentNode as FakeElement) : null;
        }
        return false;
      },
    };
    el.classList = {
      add: (c: string) => el.classListSet.add(c),
      contains: (c: string) => el.classListSet.has(c),
      remove: (c: string) => el.classListSet.delete(c),
    };
    // className is read by matchesSimple via classListSet directly, but
    // the real DOM also lets code set `el.className = '...'` --
    // getImageLightboxScript only ever uses el.className = 'x' (single
    // class) for its own created elements, so mirror that one case.
    Object.defineProperty(el, 'className', {
      set(v: string) { el.classListSet = new Set(v.split(/\s+/).filter(Boolean)); },
      get() { return Array.from(el.classListSet).join(' '); },
    });
    return el;
  }

  function walk(el: FakeElement, out: FakeElement[]): void {
    out.push(el);
    for (const c of el.children) walk(c, out);
  }

  function makeFakeDocument(): FakeDocument {
    const body = makeFakeElement('body');
    const doc: FakeDocument = {
      body,
      listeners: {},
      createElement: (tag: string) => makeFakeElement(tag),
      addEventListener(type, fn) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(fn);
      },
      removeEventListener(type, fn) {
        if (!this.listeners[type]) return;
        const idx = this.listeners[type].indexOf(fn);
        if (idx !== -1) this.listeners[type].splice(idx, 1);
      },
      querySelector(selector) {
        const all: FakeElement[] = [];
        walk(body, all);
        return all.find((el) => el !== body && matches(el, selector)) || null;
      },
      querySelectorAll(selector) {
        const all: FakeElement[] = [];
        walk(body, all);
        return all.filter((el) => el !== body && matches(el, selector));
      },
      dispatch(type, e) {
        for (const fn of (this.listeners[type] || []).slice()) fn(e);
      },
    };
    return doc;
  }

  const opts = {
    copyMenuItem: 'Copy Image',
    copyDoneLabel: 'Copied',
    copyFailedLabel: 'Copy failed',
    copyUnsupportedLabel: 'Not supported',
    copyToastDone: 'Copied to clipboard',
    copyToastFailed: 'Copy failed',
  };

  function run(doc: FakeDocument) {
    const fakeWindow = { innerWidth: 1024, innerHeight: 768 };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('document', 'window', getImageLightboxScript(opts))(doc, fakeWindow);
  }

  it('emits a script that parses as JavaScript', () => {
    assert.doesNotThrow(() => new Function(getImageLightboxScript(opts)));
  });

  it('marks a broken data-dita-src image with data-load-error, an alt/title failure message, and a red outline', () => {
    const doc = makeFakeDocument();
    run(doc);
    const img = makeFakeElement('img');
    img.setAttribute('data-dita-src', 'diagram.png');
    doc.dispatch('error', { target: img });
    assert.strictEqual(img.getAttribute('data-load-error'), 'true');
    assert.ok(img.alt.includes('diagram.png'));
    assert.ok(img.title.includes('diagram.png'));
    assert.strictEqual(img.style.outline, '3px solid red');
  });

  it('does not overwrite an image\'s own pre-existing alt text with the failure message', () => {
    const doc = makeFakeDocument();
    run(doc);
    const img = makeFakeElement('img');
    img.setAttribute('data-dita-src', 'diagram.png');
    img.setAttribute('alt', 'A real DITA <alt>');
    doc.dispatch('error', { target: img });
    // The script's guard reads via getAttribute('alt') and only assigns
    // img.alt = msg when that's falsy -- asserting the .alt property was
    // never touched (still its default) is the real signal that the
    // guard actually short-circuited, not just that nothing called
    // setAttribute('alt', ...) afterward (this fake element's .alt
    // property and its 'alt' attribute aren't auto-reflected the way a
    // real DOM element's are, so checking getAttribute alone wouldn't
    // prove the assignment itself was skipped).
    assert.strictEqual(img.alt, '', 'img.alt = msg should never have run');
    assert.ok(img.title.includes('diagram.png'), 'title still gets the failure text even though alt is left alone');
  });

  it('ignores an error event whose target is not an IMG, or an IMG with no data-dita-src', () => {
    const doc = makeFakeDocument();
    run(doc);
    const div = makeFakeElement('div');
    assert.doesNotThrow(() => doc.dispatch('error', { target: div }));
    assert.strictEqual(div.getAttribute('data-load-error'), null);
    const plainImg = makeFakeElement('img');
    doc.dispatch('error', { target: plainImg });
    assert.strictEqual(plainImg.getAttribute('data-load-error'), null);
  });

  it('clicking an eligible image opens the lightbox: an overlay + enlarged <img> appended to body, src/alt copied from the clicked image', () => {
    const doc = makeFakeDocument();
    run(doc);
    const img = makeFakeElement('img');
    img.setAttribute('data-dita-src', 'diagram.png');
    img.src = 'webview-resource://diagram.png';
    img.alt = 'A diagram';
    doc.body.appendChild(img);
    doc.dispatch('click', { target: img, preventDefault() {} });
    assert.strictEqual(doc.body.children.length, 2, 'the overlay should be appended alongside the clicked image');
    const overlay = doc.body.children[1];
    assert.strictEqual(overlay.children.length, 1);
    const big = overlay.children[0];
    assert.strictEqual(big.tagName, 'IMG');
    assert.strictEqual(big.src, 'webview-resource://diagram.png');
    assert.strictEqual(big.alt, 'A diagram');
  });

  it('clicking a broken (data-load-error) image does not open the lightbox', () => {
    const doc = makeFakeDocument();
    run(doc);
    const img = makeFakeElement('img');
    img.setAttribute('data-dita-src', 'diagram.png');
    img.setAttribute('data-load-error', 'true');
    doc.body.appendChild(img);
    doc.dispatch('click', { target: img, preventDefault() {} });
    assert.strictEqual(doc.body.children.length, 1, 'only the original image, no overlay was added');
  });

  it('clicking a plain non-image element does nothing', () => {
    const doc = makeFakeDocument();
    run(doc);
    const div = makeFakeElement('div');
    doc.body.appendChild(div);
    assert.doesNotThrow(() => doc.dispatch('click', { target: div, preventDefault() {} }));
    assert.strictEqual(doc.body.children.length, 1);
  });

  it('pressing Escape while the lightbox is open closes it (overlay removed from body)', () => {
    const doc = makeFakeDocument();
    run(doc);
    const img = makeFakeElement('img');
    img.setAttribute('data-dita-src', 'a.png');
    doc.body.appendChild(img);
    doc.dispatch('click', { target: img, preventDefault() {} });
    assert.strictEqual(doc.body.children.length, 2);
    doc.dispatch('keydown', { key: 'Escape', preventDefault() {} });
    assert.strictEqual(doc.body.children.length, 1, 'the overlay should have removed itself');
  });

  it('clicking the overlay background closes the lightbox', () => {
    const doc = makeFakeDocument();
    run(doc);
    const img = makeFakeElement('img');
    img.setAttribute('data-dita-src', 'a.png');
    doc.body.appendChild(img);
    doc.dispatch('click', { target: img, preventDefault() {} });
    const overlay = doc.body.children[1];
    // The overlay's own click listener was registered directly on it
    // (addEventListener('click', closeLightbox)), not via document
    // delegation -- fire it the same way a real click would.
    overlay.listeners.click[0]({ target: overlay });
    assert.strictEqual(doc.body.children.length, 1);
  });

  it('ArrowRight/ArrowLeft step through every eligible image on the page, in document order, wrapping around', () => {
    const doc = makeFakeDocument();
    run(doc);
    const imgs = ['a.png', 'b.png', 'c.png'].map((src) => {
      const img = makeFakeElement('img');
      img.setAttribute('data-dita-src', src);
      img.src = src;
      doc.body.appendChild(img);
      return img;
    });
    doc.dispatch('click', { target: imgs[0], preventDefault() {} });
    const overlay = doc.body.children[doc.body.children.length - 1];
    const big = overlay.children[0];
    assert.strictEqual(big.src, 'a.png');
    doc.dispatch('keydown', { key: 'ArrowRight', preventDefault() {} });
    assert.strictEqual(big.src, 'b.png');
    doc.dispatch('keydown', { key: 'ArrowRight', preventDefault() {} });
    assert.strictEqual(big.src, 'c.png');
    doc.dispatch('keydown', { key: 'ArrowRight', preventDefault() {} });
    assert.strictEqual(big.src, 'a.png', 'wraps back around to the first image');
    doc.dispatch('keydown', { key: 'ArrowLeft', preventDefault() {} });
    assert.strictEqual(big.src, 'c.png', 'wraps the other direction too');
  });

  it('ArrowRight skips images marked data-load-error when stepping', () => {
    const doc = makeFakeDocument();
    run(doc);
    const a = makeFakeElement('img');
    a.setAttribute('data-dita-src', 'a.png');
    a.src = 'a.png';
    const broken = makeFakeElement('img');
    broken.setAttribute('data-dita-src', 'broken.png');
    broken.setAttribute('data-load-error', 'true');
    const c = makeFakeElement('img');
    c.setAttribute('data-dita-src', 'c.png');
    c.src = 'c.png';
    doc.body.appendChild(a);
    doc.body.appendChild(broken);
    doc.body.appendChild(c);
    doc.dispatch('click', { target: a, preventDefault() {} });
    const overlay = doc.body.children[doc.body.children.length - 1];
    const big = overlay.children[0];
    doc.dispatch('keydown', { key: 'ArrowRight', preventDefault() {} });
    assert.strictEqual(big.src, 'c.png', 'broken.png was never a lightbox candidate to begin with');
  });

  it('right-clicking an eligible image opens the copy-image menu with the supplied copyMenuItem label, positioned near the click', () => {
    const doc = makeFakeDocument();
    run(doc);
    const img = makeFakeElement('img');
    img.setAttribute('data-dita-src', 'a.png');
    doc.body.appendChild(img);
    doc.dispatch('contextmenu', { target: img, clientX: 50, clientY: 60, preventDefault() {} });
    const menu = doc.querySelector('.dita-img-ctxmenu');
    assert.ok(menu, 'the context menu should have been appended to the document');
    assert.strictEqual(menu!.children[0].textContent, 'Copy Image');
  });

  it('right-clicking a non-image element closes any open menu instead of opening a new one', () => {
    const doc = makeFakeDocument();
    run(doc);
    const img = makeFakeElement('img');
    img.setAttribute('data-dita-src', 'a.png');
    doc.body.appendChild(img);
    doc.dispatch('contextmenu', { target: img, clientX: 0, clientY: 0, preventDefault() {} });
    assert.ok(doc.querySelector('.dita-img-ctxmenu'));
    const div = makeFakeElement('div');
    doc.body.appendChild(div);
    doc.dispatch('contextmenu', { target: div, clientX: 0, clientY: 0, preventDefault() {} });
    assert.strictEqual(doc.querySelector('.dita-img-ctxmenu'), null);
  });

  it('clicking outside the open context menu closes it', () => {
    const doc = makeFakeDocument();
    run(doc);
    const img = makeFakeElement('img');
    img.setAttribute('data-dita-src', 'a.png');
    doc.body.appendChild(img);
    doc.dispatch('contextmenu', { target: img, clientX: 0, clientY: 0, preventDefault() {} });
    assert.ok(doc.querySelector('.dita-img-ctxmenu'));
    const outside = makeFakeElement('div');
    doc.body.appendChild(outside);
    doc.dispatch('click', { target: outside, preventDefault() {} });
    assert.strictEqual(doc.querySelector('.dita-img-ctxmenu'), null);
  });

  it('pressing Escape closes an open context menu', () => {
    const doc = makeFakeDocument();
    run(doc);
    const img = makeFakeElement('img');
    img.setAttribute('data-dita-src', 'a.png');
    doc.body.appendChild(img);
    doc.dispatch('contextmenu', { target: img, clientX: 0, clientY: 0, preventDefault() {} });
    assert.ok(doc.querySelector('.dita-img-ctxmenu'));
    doc.dispatch('keydown', { key: 'Escape' });
    assert.strictEqual(doc.querySelector('.dita-img-ctxmenu'), null);
  });

  it('embeds each opts string via JSON.stringify -- a value containing quotes/backslashes still round-trips exactly, rather than breaking the generated script', () => {
    const tricky = { ...opts, copyMenuItem: 'Copy "the" image\\thing' };
    const doc = makeFakeDocument();
    const fakeWindow = { innerWidth: 1024, innerHeight: 768 };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    assert.doesNotThrow(() => new Function('document', 'window', getImageLightboxScript(tricky))(doc, fakeWindow));
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('document', 'window', getImageLightboxScript(tricky))(doc, fakeWindow);
    const img = makeFakeElement('img');
    img.setAttribute('data-dita-src', 'a.png');
    doc.body.appendChild(img);
    doc.dispatch('contextmenu', { target: img, clientX: 0, clientY: 0, preventDefault() {} });
    const menu = doc.querySelector('.dita-img-ctxmenu');
    assert.strictEqual(menu!.children[0].textContent, 'Copy "the" image\\thing');
  });
});

describe('getSiteNavExpandCollapseAllButtonsScript + getSiteNavCollapseStateHelperScript', () => {
  // The buttons script depends on setSiteNavItemCollapsed, declared by the
  // helper script and shared with getSiteNavToggleScript -- so these run
  // the two (or three) emitted pieces together, the way
  // getMapWebviewScript concatenates them, rather than in isolation.
  const helper = getSiteNavCollapseStateHelperScript();
  const buttons = getSiteNavExpandCollapseAllButtonsScript({
    expandAllTitle: 'Expand all topics', collapseAllTitle: 'Collapse all topics',
  });

  interface FakeToggle { attrs: Record<string, string>; getAttribute(n: string): string | null; setAttribute(n: string, v: string): void }
  interface FakeItem {
    classes: Set<string>;
    attrs: Record<string, string>;
    toggle: FakeToggle | null;
    classList: { add(c: string): void; remove(c: string): void; contains(c: string): boolean };
    setAttribute(n: string, v: string): void;
    querySelector(sel: string): FakeToggle | null;
  }

  function makeItem(hasToggle = true): FakeItem {
    const classes = new Set<string>(['site-nav-item', 'has-children']);
    const toggle: FakeToggle | null = hasToggle
      ? {
          attrs: { 'data-expand-label': 'Expand', 'data-collapse-label': 'Collapse', 'aria-expanded': 'true' },
          getAttribute(n: string) { return n in this.attrs ? this.attrs[n] : null; },
          setAttribute(n: string, v: string) { this.attrs[n] = v; },
        }
      : null;
    return {
      classes,
      attrs: {},
      toggle,
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
      setAttribute(n: string, v: string) { this.attrs[n] = v; },
      querySelector(sel: string) { return sel === ':scope > .site-nav-toggle' ? this.toggle : null; },
    };
  }

  it('emits scripts that parse as JavaScript, helper and buttons together', () => {
    assert.doesNotThrow(() => new Function('document', 'btnStyle', helper + buttons));
  });

  it('keeps the expand/collapse buttons a little tighter than the shared toolbar while leaving the toolbar itself shorter overall', () => {
    assert.ok(buttons.includes("siteExpandAllBtn.style.cssText = btnStyle + 'padding:1px 6px;justify-content:center;';"), 'expand-all button should stay compact without fighting the shared control height');
    assert.ok(buttons.includes("siteCollapseAllBtn.style.cssText = btnStyle + 'padding:1px 6px;justify-content:center;';"), 'collapse-all button should stay compact without fighting the shared control height');
    assert.ok(buttons.includes('width="14" height="14"'), 'icons stay readable while being slightly tighter than the prior 16px versions');
  });

  // Oxygen's own icons (nested-fold-and-highlight-plan.md item 2 follow-up
  // -- matched pixel-for-pixel rather than a from-scratch design, per this
  // project's Oxygen-as-reference-standard convention), embedded as base64
  // data URIs rather than the text glyphs every other toolbar button here
  // uses.
  it('sets each button\'s own icon via an inline <svg> using currentColor/theme variables, not a fixed-color image, and the two icons differ from each other', () => {
    const expandChunk = buttons.split('__site-collapse-all-btn')[0];
    const collapseChunk = buttons.split('__site-collapse-all-btn')[1];
    const expandSvg = /innerHTML = '(<svg[^;]+<\/svg>)'/.exec(expandChunk);
    const collapseSvg = /innerHTML = '(<svg[^;]+<\/svg>)'/.exec(collapseChunk);
    assert.ok(expandSvg, 'expand-all button gets an inline <svg> icon');
    assert.ok(collapseSvg, 'collapse-all button gets an inline <svg> icon');
    assert.notStrictEqual(expandSvg![1], collapseSvg![1], 'the two icons must not be identical');
    // currentColor (not a hardcoded hex) is what lets the icon repaint
    // itself on a theme switch along with the rest of this toolbar's
    // already-themed buttons -- a regression back to a fixed palette
    // would not be caught by "the script parses" alone.
    for (const svg of [expandSvg![1], collapseSvg![1]]) {
      assert.ok(svg.includes('stroke="currentColor"'), 'outline follows the button\'s own text color');
      // A hex color is fine as a var(...) fallback (the same pattern
      // btnStyle's own color/background already use) but not as a
      // standalone attribute value -- that would be a fixed color baked
      // into the icon regardless of theme, the exact thing this redesign
      // moved away from.
      assert.ok(!/="#[0-9a-fA-F]{3,6}"/.test(svg), 'no color attribute is a bare hex value');
    }
    // No <img>/data: URI at all -- that approach cannot resolve
    // currentColor or var(...) in the first place, since an <img>'s SVG
    // renders in its own separate resource context.
    assert.ok(!buttons.includes('<img'));
    assert.ok(!buttons.includes('data:image'));
  });

  it('collapse-all sets collapsed on every has-children item, and expand-all clears it, keeping both aria-expanded attributes and the toggle aria-label in step', () => {
    const items = [makeItem(), makeItem(), makeItem()];
    const clicks: Record<string, () => void> = {};
    const document = {
      querySelectorAll: (sel: string) => (sel === '.site-nav-item.has-children' ? items : []),
      createElement: () => {
        const el = { id: '', style: { cssText: '' }, setAttribute: () => {}, addEventListener(_e: string, fn: () => void) { clicks[el.id] = fn; } };
        return el;
      },
    };
    new Function('document', 'btnStyle', helper + buttons)(document, '');

    clicks['__site-collapse-all-btn']();
    for (const it of items) {
      assert.strictEqual(it.classes.has('collapsed'), true);
      assert.strictEqual(it.attrs['aria-expanded'], 'false');
      assert.strictEqual(it.toggle!.attrs['aria-expanded'], 'false');
      assert.strictEqual(it.toggle!.attrs['aria-label'], 'Expand', 'a collapsed row offers to expand');
    }

    clicks['__site-expand-all-btn']();
    for (const it of items) {
      assert.strictEqual(it.classes.has('collapsed'), false);
      assert.strictEqual(it.attrs['aria-expanded'], 'true');
      assert.strictEqual(it.toggle!.attrs['aria-expanded'], 'true');
      assert.strictEqual(it.toggle!.attrs['aria-label'], 'Collapse');
    }
  });

  it('is idempotent: collapse-all twice leaves the same state, rather than toggling back open', () => {
    const items = [makeItem()];
    const clicks: Record<string, () => void> = {};
    const document = {
      querySelectorAll: () => items,
      createElement: () => {
        const el = { id: '', style: { cssText: '' }, setAttribute: () => {}, addEventListener(_e: string, fn: () => void) { clicks[el.id] = fn; } };
        return el;
      },
    };
    new Function('document', 'btnStyle', helper + buttons)(document, '');

    clicks['__site-collapse-all-btn']();
    clicks['__site-collapse-all-btn']();

    assert.strictEqual(items[0].classes.has('collapsed'), true, 'a set-to-state API, not a per-item toggle');
  });

  it('does not throw on an item with no toggle element', () => {
    const items = [makeItem(false)];
    const clicks: Record<string, () => void> = {};
    const document = {
      querySelectorAll: () => items,
      createElement: () => {
        const el = { id: '', style: { cssText: '' }, setAttribute: () => {}, addEventListener(_e: string, fn: () => void) { clicks[el.id] = fn; } };
        return el;
      },
    };
    new Function('document', 'btnStyle', helper + buttons)(document, '');

    assert.doesNotThrow(() => clicks['__site-collapse-all-btn']());
    assert.strictEqual(items[0].classes.has('collapsed'), true, 'the class still lands even without a toggle to relabel');
  });

  it('getSiteNavToggleScript routes its own single-item flip through the same shared setter rather than declaring its own', () => {
    const toggleScript = getSiteNavToggleScript();
    assert.ok(toggleScript.includes('setSiteNavItemCollapsed'), 'uses the shared setter');
    assert.ok(!/function\s+setSiteNavItemCollapsed/.test(toggleScript), 'does not declare a second copy of it');
    assert.ok(/function\s+setSiteNavItemCollapsed/.test(helper), 'the helper script is the one declaring it');
  });

  // nested-fold-and-highlight-plan.md item 3: persisted collapse state.
  // reportSiteNavCollapseState is only declared when a message type is
  // supplied -- these exercise that opt-in path specifically, wiring it
  // together with the toggle/batch scripts the same way getMapWebviewScript
  // does, since reportSiteNavCollapseState's own correctness only matters
  // in combination with what calls it.
  describe('reportSiteNavCollapseState (nested-fold-and-highlight-plan.md item 3)', () => {
    const helperWithReport = getSiteNavCollapseStateHelperScript({ reportCollapseMsgType: 'setNavCollapsed' });

    function makeItemWithId(id: string | null, hasToggle = true): FakeItem & { navId: string | null } {
      const it = makeItem(hasToggle) as FakeItem & { navId: string | null };
      it.navId = id;
      return it;
    }

    function makeReportDocument(items: (FakeItem & { navId: string | null })[]) {
      const posted: unknown[] = [];
      const vscode = { postMessage: (m: unknown) => posted.push(m) };
      const document = {
        querySelectorAll: (sel: string) =>
          sel === '.site-nav-item.has-children[data-nav-id]' ? items.filter((it) => it.navId !== null) : items,
      };
      // getAttribute('data-nav-id') added directly on the fakes here rather
      // than in the shared makeItem helper above -- only this describe
      // block's tests care about it.
      for (const it of items) {
        const original = it.attrs;
        (it as unknown as { getAttribute(n: string): string | null }).getAttribute = (n: string) =>
          n === 'data-nav-id' ? it.navId : (n in original ? original[n] : null);
      }
      return { document, vscode, posted };
    }

    it('is not declared at all when no message type is supplied, so calling it is left to the typeof guard', () => {
      assert.ok(!/function\s+reportSiteNavCollapseState/.test(helper));
    });

    it('reports only the collapsed ids among has-children[data-nav-id] items, omitting expanded ones and items with no id', () => {
      const collapsedWithId = makeItemWithId('grp:0');
      collapsedWithId.classes.add('collapsed');
      const expandedWithId = makeItemWithId('grp:1');
      const collapsedNoId = makeItemWithId(null);
      collapsedNoId.classes.add('collapsed');
      const { document, vscode, posted } = makeReportDocument([collapsedWithId, expandedWithId, collapsedNoId]);

      new Function('document', 'vscode', helperWithReport + '\nreportSiteNavCollapseState();')(document, vscode);

      assert.strictEqual(posted.length, 1);
      assert.deepStrictEqual(posted[0], { type: 'setNavCollapsed', ids: ['grp:0'] });
    });

    it('a single toggle click reports the resulting full set exactly once', () => {
      const grpA = makeItemWithId('grp:0');
      const { document: qDoc } = makeReportDocument([grpA]);
      const posted: unknown[] = [];
      const vscode = { postMessage: (m: unknown) => posted.push(m) };
      const listeners: Array<(e: unknown) => void> = [];
      const document = {
        addEventListener: (evt: string, fn: (e: unknown) => void) => { if (evt === 'click') listeners.push(fn); },
        querySelectorAll: qDoc.querySelectorAll,
      };
      // A minimal click-capable pair: getSiteNavToggleScript's own handler
      // walks target -> closest('.site-nav-toggle') -> closest('.site-nav-item'),
      // which the shared FakeItem/FakeToggle above were never built for
      // (they only support the batch scripts' querySelectorAll-based path).
      const toggleEl = {
        closest: (sel: string) => {
          if (sel === '.site-nav-toggle') return toggleEl;
          if (sel === '.site-nav-item') return grpA;
          return null;
        },
      };
      new Function('document', 'vscode', helperWithReport + getSiteNavToggleScript())(document, vscode);

      for (const fn of listeners) fn({ target: toggleEl, preventDefault: () => {} });

      assert.strictEqual(posted.length, 1, 'exactly one report per click, not one per DOM item scanned');
      assert.deepStrictEqual(posted[0], { type: 'setNavCollapsed', ids: ['grp:0'] });
    });

    describe('rows auto-expanded to reveal the active page (site page switch, book scroll sync)', () => {
      // The report is the whole DOM state, so without a marker an auto-
      // expanded branch would be recorded as EXPANDED the next time the
      // reader touched any chevron -- silently overwriting the fold they had
      // saved. An auto-expanded row keeps reporting as collapsed until the
      // reader explicitly decides otherwise.
      function setup() {
        const grp = makeItemWithId('grp:0');
        grp.classes.add('collapsed');
        const other = makeItemWithId('grp:1'); // expanded all along, not an ancestor
        const { document, vscode, posted } = makeReportDocument([grp, other]);
        // The row whose ancestor is `grp`.
        const navItem = { parentElement: { closest: (sel: string) => (sel === '.site-nav-item.collapsed' && grp.classes.has('collapsed') ? grp : null) } };
        const run = (code: string) =>
          new Function('document', 'vscode', 'navItem', helperWithReport + '\n' + code)(document, vscode, navItem);
        return { grp, other, posted, run };
      }

      it('opens the row in the DOM but still reports it as collapsed', () => {
        const { grp, posted, run } = setup();
        run('expandSiteNavAncestorsOf(navItem); reportSiteNavCollapseState();');
        assert.strictEqual(grp.classes.has('collapsed'), false, 'visibly open');
        assert.deepStrictEqual(posted, [{ type: 'setNavCollapsed', ids: ['grp:0'] }], 'the saved fold is untouched');
      });

      it('reports it as expanded once the reader expands it themselves', () => {
        const { posted, grp, run } = setup();
        run('expandSiteNavAncestorsOf(navItem); setSiteNavItemCollapsed(document.querySelectorAll("x")[0], false); reportSiteNavCollapseState();');
        assert.deepStrictEqual(posted, [{ type: 'setNavCollapsed', ids: [] }]);
        assert.strictEqual(grp.classes.has('collapsed'), false);
      });

      it('reports it as collapsed when the reader collapses it again, and stays that way after a later expand', () => {
        const { posted, run } = setup();
        run('expandSiteNavAncestorsOf(navItem); var g = document.querySelectorAll("x")[0]; setSiteNavItemCollapsed(g, true); reportSiteNavCollapseState(); setSiteNavItemCollapsed(g, false); reportSiteNavCollapseState();');
        assert.deepStrictEqual(posted, [
          { type: 'setNavCollapsed', ids: ['grp:0'] },
          { type: 'setNavCollapsed', ids: [] },
        ]);
      });

      it('does not make a row that was never collapsed report as collapsed', () => {
        const { posted, run } = setup();
        run('expandSiteNavAncestorsOf(navItem); reportSiteNavCollapseState();');
        assert.ok(!(posted[0] as { ids: string[] }).ids.includes('grp:1'));
      });

      it('expand-all is an explicit choice and clears the marker', () => {
        const { grp, other } = setup();
        const posted: unknown[] = [];
        const clicks: Record<string, () => void> = {};
        const document = {
          querySelectorAll: (sel: string) => (sel === '.site-nav-item.has-children[data-nav-id]' ? [grp, other] : [grp, other]),
          createElement: () => {
            const el = { id: '', innerHTML: '', title: '', style: { cssText: '' }, setAttribute: () => {}, addEventListener(_e: string, fn: () => void) { clicks[el.id] = fn; } };
            return el;
          },
        };
        for (const it of [grp, other]) (it as unknown as { getAttribute(n: string): string | null }).getAttribute = (n: string) => (n === 'data-nav-id' ? it.navId : null);
        const navItem = { parentElement: { closest: (sel: string) => (sel === '.site-nav-item.collapsed' && grp.classes.has('collapsed') ? grp : null) } };
        const buttons = getSiteNavExpandCollapseAllButtonsScript({ expandAllTitle: 'E', collapseAllTitle: 'C' });
        new Function('document', 'btnStyle', 'vscode', 'navItem', helperWithReport + buttons + '\nexpandSiteNavAncestorsOf(navItem);\nreturn null;')(
          document, '', { postMessage: (m: unknown) => posted.push(m) }, navItem,
        );
        clicks['__site-expand-all-btn']();
        assert.deepStrictEqual(posted, [{ type: 'setNavCollapsed', ids: [] }]);
      });
    });

    it('collapse-all reports the full set exactly once for the whole batch, not once per item', () => {
      const items = [makeItemWithId('a'), makeItemWithId('b'), makeItemWithId('c')];
      const { document: qDoc } = makeReportDocument(items);
      const posted: unknown[] = [];
      const vscode = { postMessage: (m: unknown) => posted.push(m) };
      const clicks: Record<string, () => void> = {};
      const document = {
        querySelectorAll: qDoc.querySelectorAll,
        createElement: () => {
          const el = { id: '', style: { cssText: '' }, setAttribute: () => {}, addEventListener(_e: string, fn: () => void) { clicks[el.id] = fn; } };
          return el;
        },
      };
      const buttonsScript = getSiteNavExpandCollapseAllButtonsScript({
        expandAllTitle: 'Expand all', collapseAllTitle: 'Collapse all',
      });
      new Function('document', 'btnStyle', 'vscode', helperWithReport + buttonsScript)(document, '', vscode);

      clicks['__site-collapse-all-btn']();

      assert.strictEqual(posted.length, 1, 'one message for the whole sweep, not three');
      const ids = (posted[0] as { ids: string[] }).ids.slice().sort();
      assert.deepStrictEqual(ids, ['a', 'b', 'c']);
    });
  });
});
