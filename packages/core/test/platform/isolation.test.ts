import * as assert from 'assert';
import { readImageDimensions } from '../../src/editor/refResolvers';
import { clearAllSourceOverlays, readSourceText, setSourceOverlay, sourceOverlaySize, sourceStamp, trackSourceReads } from '../../src/editor/sourceText';
import { clearTopicRenderCache, renderTopicCached, topicRenderCacheBytesHeld, topicRenderCacheSize } from '../../src/editor/topicRender';
import { createMemoryFileSystem, type MemoryFileSystem } from '../../src/memoryFileSystem';
import { isReadAllowed, setReadRoots } from '../../src/pathContainment';
import { posixPath } from '../../src/posixPath';
import { createRuntime, withRuntime, type Runtime } from '../../src/runtime';
import { renderTopicXml } from '../../src/editor/topicRender';

// Two runtimes in one process must not see each other: the default one (the
// package entry point's) and any other (an engine's). DESIGN.md 3.7, item 3.
describe('per-runtime state', () => {
  const make = (files: Record<string, string | Uint8Array>): { rt: Runtime; fs: MemoryFileSystem } => {
    const fs = createMemoryFileSystem(files);
    return { rt: createRuntime({ fs, path: posixPath }), fs };
  };
  afterEach(() => {
    clearAllSourceOverlays();
    clearTopicRenderCache();
    setReadRoots(undefined);
  });

  it('a source overlay set in one runtime is invisible to another and to the default', () => {
    const a = make({ '/ws/t.dita': 'disk A' });
    const b = make({ '/ws/t.dita': 'disk B' });
    withRuntime(a.rt, () => setSourceOverlay('/ws/t.dita', 'editor A'));
    assert.strictEqual(withRuntime(a.rt, () => readSourceText('/ws/t.dita')), 'editor A');
    assert.strictEqual(withRuntime(b.rt, () => readSourceText('/ws/t.dita')), 'disk B');
    assert.strictEqual(withRuntime(b.rt, () => sourceOverlaySize()), 0);
    assert.strictEqual(sourceOverlaySize(), 0, 'the default runtime is untouched');
  });

  it('an overlay set on the default runtime does not reach an engine', () => {
    const a = make({ '/ws/t.dita': 'disk A' });
    setSourceOverlay('/ws/t.dita', 'default editor');
    assert.strictEqual(withRuntime(a.rt, () => readSourceText('/ws/t.dita')), 'disk A');
    assert.strictEqual(sourceOverlaySize(), 1);
  });

  it('overlay revisions are per runtime: stamps in one do not advance the other', () => {
    const a = make({});
    const b = make({});
    withRuntime(a.rt, () => setSourceOverlay('/x.dita', '1'));
    withRuntime(a.rt, () => setSourceOverlay('/x.dita', '2'));
    withRuntime(b.rt, () => setSourceOverlay('/x.dita', '1'));
    assert.strictEqual(withRuntime(a.rt, () => sourceStamp('/x.dita')), 'dirty:2');
    assert.strictEqual(withRuntime(b.rt, () => sourceStamp('/x.dita')), 'dirty:1');
  });

  it('source read tracking is per runtime, and a read in another runtime is not recorded', () => {
    const a = make({ '/ws/a.dita': 'a' });
    const b = make({ '/ws/b.dita': 'b' });
    const { files } = withRuntime(a.rt, () =>
      trackSourceReads(() => {
        readSourceText('/ws/a.dita');
        withRuntime(b.rt, () => readSourceText('/ws/b.dita'));
      }),
    );
    assert.deepStrictEqual([...files], ['/ws/a.dita']);
  });

  it('read roots are per runtime', () => {
    const a = make({});
    const b = make({});
    withRuntime(a.rt, () => setReadRoots(['/ws/a']));
    assert.strictEqual(withRuntime(a.rt, () => isReadAllowed('/elsewhere/x.dita')), false);
    assert.strictEqual(withRuntime(b.rt, () => isReadAllowed('/elsewhere/x.dita')), true);
    assert.strictEqual(isReadAllowed('/elsewhere/x.dita'), true, 'the default runtime has no boundary');
  });

  it('the topic render cache is per runtime: same path, different content, rendered interleaved', () => {
    const topic = (word: string) => `<topic id="t"><title>${word}</title><body><p>${word}</p></body></topic>`;
    const a = make({ '/ws/t.dita': topic('alpha') });
    const b = make({ '/ws/t.dita': topic('bravo') });
    const render = (r: Runtime) =>
      withRuntime(r, () => renderTopicCached({ filePath: '/ws/t.dita', keyMap: new Map(), asWebviewUri: (p) => p, headingLevel: 1 })).html;
    for (let i = 0; i < 3; i++) {
      assert.match(render(a.rt), /alpha/);
      assert.match(render(b.rt), /bravo/);
    }
    assert.strictEqual(withRuntime(a.rt, () => topicRenderCacheSize()), 1);
    assert.strictEqual(withRuntime(b.rt, () => topicRenderCacheSize()), 1);
    assert.strictEqual(topicRenderCacheSize(), 0, 'the default runtime cached nothing');
    withRuntime(a.rt, () => clearTopicRenderCache());
    assert.strictEqual(withRuntime(a.rt, () => topicRenderCacheBytesHeld()), 0);
    assert.strictEqual(withRuntime(b.rt, () => topicRenderCacheSize()), 1, 'clearing one runtime leaves the other');
  });

  it('the image-dimension cache is per runtime: a stale entry in one cannot answer for another', () => {
    const png = (w: number) => {
      const b = new Uint8Array(24);
      b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, w >> 8, w & 255, 0, 0, 0, 10]);
      return b;
    };
    const a = make({ '/i/p.png': png(100) });
    const b = make({ '/i/p.png': png(200) });
    // Both file systems give this path the same mtimeMs (1) and size, so only a per-runtime cache keeps the answers apart.
    assert.strictEqual(a.fs.stat('/i/p.png')?.mtimeMs, b.fs.stat('/i/p.png')?.mtimeMs);
    assert.strictEqual(withRuntime(a.rt, () => readImageDimensions('/i/p.png'))?.width, 100);
    assert.strictEqual(withRuntime(b.rt, () => readImageDimensions('/i/p.png'))?.width, 200);
    assert.strictEqual(withRuntime(a.rt, () => readImageDimensions('/i/p.png'))?.width, 100);
  });

  it('imagemap ids count per runtime, so an engine\'s output does not depend on what else rendered in the process', () => {
    const xml = '<topic id="t"><title>T</title><body><imagemap><image href="a.png"/><area><shape>rect</shape><coords>0,0,1,1</coords></area></imagemap></body></topic>';
    const ids = (r: Runtime) => {
      const html = withRuntime(r, () => renderTopicXml({ xml, docDir: '/ws', keyMap: new Map(), asWebviewUri: (p) => p, headingLevel: 1 })).html;
      return [...html.matchAll(/dita-imagemap-(\d+)/g)].map((m) => m[1]);
    };
    const a = make({});
    const b = make({});
    const first = ids(a.rt);
    assert.ok(first.length > 0, 'the imagemap rendered');
    ids(a.rt);
    ids(a.rt);
    assert.deepStrictEqual(ids(b.rt), first, 'a fresh runtime starts counting from the beginning');
    assert.notDeepStrictEqual(ids(a.rt), first, 'within one runtime the count keeps going');
  });
});

