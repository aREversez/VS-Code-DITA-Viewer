import * as assert from 'assert';
import { mkdtempSync, writeFileSync, rmSync, statSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { expandDitamapRefs, FileReader, makeConrefResolver, makeConrefRangeResolver, makeFileTitleResolver, findTextMatches, decodeHrefPart, detectNoteLabels, DEFAULT_NOTE_LABELS, ZH_NOTE_LABELS, readImageDimensions } from '../../editor/ditaRenderUtils';
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

  function writePng(path: string, width: number, height: number) {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(width, 0);
    ihdrData.writeUInt32BE(height, 4);
    ihdrData.writeUInt8(8, 8); // bit depth
    ihdrData.writeUInt8(2, 9); // color type
    // The reader here never validates the CRC, so a real one isn't needed
    // for this test -- only the length/tag/data layout it actually reads.
    const chunk = (tag: string, data: Buffer) => {
      const tagBuf = Buffer.from(tag, 'ascii');
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32BE(data.length, 0);
      const crcBuf = Buffer.alloc(4);
      return Buffer.concat([lenBuf, tagBuf, data, crcBuf]);
    };
    writeFileSync(path, Buffer.concat([sig, chunk('IHDR', ihdrData), chunk('IEND', Buffer.alloc(0))]));
  }

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
