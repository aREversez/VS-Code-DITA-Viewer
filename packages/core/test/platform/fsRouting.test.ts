import * as assert from 'assert';
import { collectDiagnostics } from '../../src/diagnostics';
import { collectDitamapFilesUpward } from '../../src/editor/topicRender';
import { readImageDimensions, clearImageDimensionsCache } from '../../src/editor/refResolvers';
import { clearAllSourceOverlays, readSourceText, setSourceOverlay, sourceStamp } from '../../src/editor/sourceText';
import { renderTopicXml } from '../../src/editor/topicRender';
import { createMemoryFileSystem } from '../../src/memoryFileSystem';
import { isPathInside } from '../../src/pathContainment';
import { posixPath } from '../../src/posixPath';
import type { FileSystem, PathOps, Platform } from '../../src/platform';
import { createRuntime, withRuntime } from '../../src/runtime';
import { utf8ByteLength } from '../../src/utf8';

// Core's file access must follow the active runtime, not Node's fs. Every test
// here runs on a memory file system whose files do not exist on the real disk.
describe('file access goes through the active runtime', () => {
  const memory = (files: Record<string, string | Uint8Array>, path: PathOps = posixPath) =>
    createRuntime({ fs: createMemoryFileSystem(files), path });

  afterEach(() => clearAllSourceOverlays());

  it('readSourceText reads from the platform file system', () => {
    const rt = memory({ '/virtual/a.dita': '<topic id="a"/>' });
    assert.strictEqual(withRuntime(rt, () => readSourceText('/virtual/a.dita')), '<topic id="a"/>');
    assert.throws(() => withRuntime(rt, () => readSourceText('/virtual/missing.dita')), /ENOENT/);
  });

  it('keeps a BOM, like readFileSync', () => {
    const rt = memory({ '/virtual/bom.dita': '\uFEFF<topic/>' });
    assert.strictEqual(withRuntime(rt, () => readSourceText('/virtual/bom.dita')), '\uFEFF<topic/>');
  });

  it('sourceStamp changes when the platform file changes, and is "?" when it is gone', () => {
    const fs = createMemoryFileSystem({ '/virtual/a.dita': 'one' });
    const rt = createRuntime({ fs, path: posixPath });
    const s1 = withRuntime(rt, () => sourceStamp('/virtual/a.dita'));
    fs.set('/virtual/a.dita', 'one');
    const s2 = withRuntime(rt, () => sourceStamp('/virtual/a.dita'));
    assert.notStrictEqual(s1, s2);
    assert.strictEqual(withRuntime(rt, () => sourceStamp('/virtual/none.dita')), '?');
  });

  it('path keys follow caseSensitive: an overlay set under another case is found only when it is false', () => {
    const insensitive: PathOps = { ...posixPath, caseSensitive: false };
    const files = { '/virtual/A.dita': 'on disk' };
    withRuntime(memory(files, insensitive), () => {
      setSourceOverlay('/virtual/A.dita', 'in the editor');
      assert.strictEqual(readSourceText('/virtual/a.dita'), 'in the editor');
    });
    clearAllSourceOverlays();
    withRuntime(memory(files, posixPath), () => {
      setSourceOverlay('/virtual/A.dita', 'in the editor');
      assert.strictEqual(readSourceText('/virtual/A.dita'), 'in the editor');
      assert.throws(() => readSourceText('/virtual/a.dita'), /ENOENT/);
    });
  });

  it('collectDiagnostics defaults its existence test to the platform', () => {
    const rt = memory({ '/virtual/other.dita': '<topic id="o"/>' });
    const xml = '<topic id="t"><title>T</title><body><p><xref href="other.dita"/><xref href="gone.dita"/></p></body></topic>';
    const messages = withRuntime(rt, () => collectDiagnostics({ xml, absPath: '/virtual/t.dita' })).map((d) => d.message);
    assert.ok(messages.some((m) => m.includes('gone.dita')), messages.join('\n'));
    assert.ok(!messages.some((m) => m.includes('other.dita')), messages.join('\n'));
  });

  it('isPathInside uses the platform realPath when there is one', () => {
    const real: FileSystem = { ...createMemoryFileSystem({ '/ws/link/x.dita': '' }), realPath: (p) => (p.startsWith('/ws/link') ? p.replace('/ws/link', '/secret') : p) };
    const platform: Platform = { fs: real, path: posixPath };
    assert.strictEqual(withRuntime(createRuntime(platform), () => isPathInside('/ws', '/ws/link/x.dita')), false);
    assert.strictEqual(withRuntime(memory({ '/ws/link/x.dita': '' }), () => isPathInside('/ws', '/ws/link/x.dita')), true);
  });

  it('collectDitamapFilesUpward walks directories through the platform', () => {
    const rt = memory({ '/ws/maps/a.ditamap': '', '/ws/maps/deep/b.DITAMAP': '', '/ws/maps/t.dita': '', '/ws/c.ditamap': '' });
    const found = withRuntime(rt, () => collectDitamapFilesUpward('/ws/maps', '/ws', false));
    assert.deepStrictEqual([...found].sort(), ['/ws/c.ditamap', '/ws/maps/a.ditamap', '/ws/maps/deep/b.DITAMAP']);
  });

  it('renderTopicXml resolves an image against the platform file system', () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0x2c, 0, 0, 0, 0x64]);
    const rt = memory({ '/virtual/img/p.png': png });
    const xml = '<topic id="t"><title>T</title><body><fig><image href="img/p.png"/></fig></body></topic>';
    const html = withRuntime(rt, () => renderTopicXml({ xml, docDir: '/virtual', keyMap: new Map(), asWebviewUri: (p) => `vsc:${p}`, headingLevel: 1 })).html;
    assert.match(html, /width="300"/);
    assert.match(html, /height="100"/);
  });
});

describe('image headers read as plain bytes', () => {
  const dims = (name: string, bytes: Uint8Array) => {
    const rt = createRuntime({ fs: createMemoryFileSystem({ [`/i/${name}`]: bytes }), path: posixPath });
    clearImageDimensionsCache();
    return withRuntime(rt, () => readImageDimensions(`/i/${name}`));
  };
  const text = (s: string) => new TextEncoder().encode(s);

  it('PNG', () => {
    const b = new Uint8Array(24);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x02, 0x80, 0, 0, 0x01, 0xe0]);
    assert.deepStrictEqual(dims('a.png', b), { width: 640, height: 480 });
  });
  it('GIF (little endian)', () => {
    const b = new Uint8Array([...text('GIF89a'), 0x20, 0x03, 0x58, 0x02, 0, 0]);
    assert.deepStrictEqual(dims('a.gif', b), { width: 800, height: 600 });
  });
  it('BMP, with a negative (top-down) height', () => {
    const b = new Uint8Array(26);
    b.set(text('BM'));
    new DataView(b.buffer).setInt32(18, 320, true);
    new DataView(b.buffer).setInt32(22, -200, true);
    assert.deepStrictEqual(dims('a.bmp', b), { width: 320, height: 200 });
  });
  it('JPEG, past an APP0 segment', () => {
    const b = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03]);
    assert.deepStrictEqual(dims('a.jpg', b), { width: 400, height: 300 });
  });
  it('SVG: attributes, then viewBox; a BOM does not matter', () => {
    assert.deepStrictEqual(dims('a.svg', text('<svg width="120px" height="80"></svg>')), { width: 120, height: 80 });
    assert.deepStrictEqual(dims('b.svg', text('\uFEFF<svg viewBox="0 0 50 25"></svg>')), { width: 50, height: 25 });
  });
  it('a file that is not an image gives undefined; a missing one too', () => {
    assert.strictEqual(dims('c.png', text('not a png at all, just some text here')), undefined);
    const rt = createRuntime({ fs: createMemoryFileSystem(), path: posixPath });
    assert.strictEqual(withRuntime(rt, () => readImageDimensions('/i/none.png')), undefined);
  });
});

describe('utf8ByteLength', () => {
  it('equals Buffer.byteLength, including astral characters and lone surrogates', () => {
    for (const s of ['', 'abc', 'é', '€', '你好，世界', '😀', 'a😀b', '\uD800', '\uDC00x', 'x\uD800', '\uD83D\uDE00\uD83D', '\u0000\u007f\u0080\u07ff\u0800\uffff']) {
      assert.strictEqual(utf8ByteLength(s), Buffer.byteLength(s, 'utf8'), JSON.stringify(s));
    }
  });
});
