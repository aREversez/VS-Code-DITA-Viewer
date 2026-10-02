import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getImageMapSupportScript } from '../../editor/ditaRenderUtils';

// dist-test/test/editor/imageMapSupportScript.test.js -> repo root is three
// levels up.
const repoRoot = join(__dirname, '..', '..', '..');
const read = (rel: string): string => readFileSync(join(repoRoot, rel), 'utf8');

/**
 * The image-map support script is a string built by getImageMapSupportScript
 * and interpolated into both webviews, so none of its failure modes reach a
 * compiler or any other gate. Its two jobs are both browser-behavior
 * workarounds (Chromium hit-tests <area> coords against the image's natural
 * pixel space, and a bare relative href on an <area> navigates the webview
 * onto a vscode-webview:// 404), so the tests below run the real script body
 * against a minimal fake DOM -- same approach as siteNavKeyboard.test.ts --
 * asserting the coordinate math, the zoom-skip rule, the coords restore, and
 * which clicks get intercepted.
 */

interface FakeAttrs {
  get(name: string): string | null;
  set(name: string, value: string): void;
  has(name: string): boolean;
}

function fakeAttrs(initial: Record<string, string> = {}): FakeAttrs & { store: Record<string, string> } {
  const store: Record<string, string> = { ...initial };
  return {
    store,
    get(name: string): string | null {
      return Object.prototype.hasOwnProperty.call(store, name) ? store[name] : null;
    },
    set(name: string, value: string): void {
      store[name] = value;
    },
    has(name: string): boolean {
      return Object.prototype.hasOwnProperty.call(store, name);
    },
  };
}

// A minimal element stand-in speaking the DOM attribute API the script
// actually calls (getAttribute/setAttribute/hasAttribute), backed by a
// FakeAttrs store so tests can assert on the raw values.
function domElement(initial: Record<string, string> = {}) {
  const attrs = fakeAttrs(initial);
  return {
    store: attrs.store,
    getAttribute: (name: string): string | null => attrs.get(name),
    setAttribute: (name: string, value: string): void => attrs.set(name, value),
    hasAttribute: (name: string): boolean => attrs.has(name),
  };
}
type DomElement = ReturnType<typeof domElement>;

interface Harness {
  posted: Array<Record<string, unknown>>;
  click(e: { target: unknown; preventDefault(): void }): void;
  flush(): Promise<void>;
  setRect(width: number, height: number): void;
  fireWindowResize(): void;
  areas: DomElement[];
}

interface Options {
  naturalWidth?: number;
  naturalHeight?: number;
  rectWidth?: number;
  rectHeight?: number;
  zoom?: string;
  coords: string[];
}

function runScript(opts: Options): Harness {
  const imgAttrs = fakeAttrs({ usemap: '#map-1' });
  const areas = opts.coords.map((c) => domElement({ coords: c }));
  const fakeMap = {
    tagName: 'MAP',
    getElementsByTagName(tag: string) {
      return tag === 'AREA' ? areas : [];
    },
  };
  let rect = { width: opts.rectWidth ?? 300, height: opts.rectHeight ?? 200 };
  const zoomVal = { value: opts.zoom ?? '1' };
  const fakeImg = {
    tagName: 'IMG',
    naturalWidth: opts.naturalWidth ?? 300,
    naturalHeight: opts.naturalHeight ?? 200,
    getAttribute: imgAttrs.get,
    setAttribute: imgAttrs.set,
    hasAttribute: imgAttrs.has,
    getBoundingClientRect() {
      return rect;
    },
  };
  const clickHandlers: Array<(e: unknown) => void> = [];
  const fakeDocument = {
    addEventListener(_type: string, fn: (e: unknown) => void) {
      if (_type === 'click' || _type === 'load') clickHandlers.push(fn);
    },
    getElementById(id: string) {
      return id === 'map-1' ? fakeMap : null;
    },
    documentElement: {},
    querySelectorAll(selector: string) {
      return selector.includes('img[usemap]') ? [fakeImg] : [];
    },
  };
  const posted: Array<Record<string, unknown>> = [];
  const fakeVscode = {
    postMessage(msg: Record<string, unknown>) {
      posted.push(msg);
    },
  };
  const resizeHandlers: Array<() => void> = [];
  const fakeWindow = {
    addEventListener(type: string, fn: () => void) {
      if (type === 'resize') resizeHandlers.push(fn);
    },
    getComputedStyle() {
      return { zoom: zoomVal.value };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const boot = new Function(
    'document',
    'window',
    'vscode',
    'ResizeObserver',
    'MutationObserver',
    getImageMapSupportScript({ openMsgType: 'openImagemapLink' }),
  ) as (d: unknown, w: unknown, v: unknown, ro: unknown, mo: unknown) => void;
  boot(fakeDocument, fakeWindow, fakeVscode, undefined, undefined);
  return {
    posted,
    areas,
    click(e: { target: unknown; preventDefault(): void }): void {
      for (const fn of clickHandlers) fn(e);
    },
    flush(): Promise<void> {
      // The rescaler debounces through a 50ms setTimeout; give it room.
      return new Promise((resolve) => setTimeout(resolve, 120));
    },
    setRect(width: number, height: number): void {
      rect = { width, height };
    },
    fireWindowResize(): void {
      for (const fn of resizeHandlers) fn();
    },
  };
}

describe('image map support script', () => {
  it('is JavaScript that parses', () => {
    // Compiles without running: the IIFE body only touches its fakes when
    // actually booted, which the other tests below do.
    assert.doesNotThrow(() => new Function(getImageMapSupportScript({ openMsgType: 'openImagemapLink' })));
  });

  it('rescales hotspot coords by the rendered/natural ratio and caches the originals', async () => {
    const h = runScript({
      naturalWidth: 300,
      naturalHeight: 200,
      rectWidth: 150,
      rectHeight: 100,
      coords: ['2,0,53,59', '120,154,29', '246,39,200,35,173,52'],
    });
    await h.flush();
    assert.strictEqual(h.areas[0].getAttribute('coords'), '1,0,27,30', 'rect pair list scales per axis');
    assert.strictEqual(h.areas[0].getAttribute('data-dita-coords'), '2,0,53,59', 'original coords cached');
    assert.strictEqual(
      h.areas[1].getAttribute('coords'),
      '60,77,15',
      'circle: cx,cy scale, lone radius takes the mean ratio',
    );
    assert.strictEqual(h.areas[2].getAttribute('coords'), '123,20,100,18,87,26', 'poly pair list scales throughout');
  });

  it('restores the author coords once the image is back at its natural size', async () => {
    const h = runScript({
      naturalWidth: 300,
      naturalHeight: 200,
      rectWidth: 150,
      rectHeight: 100,
      coords: ['2,0,53,59'],
    });
    await h.flush();
    assert.strictEqual(h.areas[0].getAttribute('coords'), '1,0,27,30');
    h.setRect(300, 200);
    h.fireWindowResize();
    await h.flush();
    assert.strictEqual(
      h.areas[0].getAttribute('coords'),
      '2,0,53,59',
      'restored from the cached original, not re-scaled',
    );
  });

  it('leaves coords alone when CSS zoom is active (Chromium compensates by itself)', async () => {
    const h = runScript({
      naturalWidth: 300,
      naturalHeight: 200,
      rectWidth: 150,
      rectHeight: 100,
      zoom: '0.5',
      coords: ['2,0,53,59'],
    });
    await h.flush();
    assert.strictEqual(h.areas[0].getAttribute('coords'), '2,0,53,59', 'zoomed image must not be rescaled on top');
    assert.strictEqual(h.areas[0].getAttribute('data-dita-coords'), null, 'nothing cached either -- untouched');
  });

  it('routes non-fragment hotspot clicks to the host and preventDefaults them', () => {
    const h = runScript({ coords: ['2,0,53,59'] });
    const area = domElement({ href: 'test.html' });
    let prevented = false;
    h.click({ target: { closest: () => area }, preventDefault: () => (prevented = true) });
    assert.strictEqual(prevented, true, 'the webview must not navigate itself');
    assert.deepStrictEqual(h.posted, [{ type: 'openImagemapLink', href: 'test.html' }]);
  });

  it('leaves fragment and book-internal hotspot clicks to their own handlers', () => {
    const h = runScript({ coords: ['2,0,53,59'] });
    // Fragment: the browser's anchor jump (or the preview's smooth-scroll
    // handler) owns it -- the guard must not touch it.
    const frag = domElement({ href: '#section-1' });
    let fragPrevented = false;
    h.click({ target: { closest: () => frag }, preventDefault: () => (fragPrevented = true) });
    assert.strictEqual(fragPrevented, false);
    assert.deepStrictEqual(h.posted, []);
    // Book-internal: href="#" + data-dita-book-xref, owned by the site/book
    // click handlers running on the same event.
    const book = domElement({ href: '#', 'data-dita-book-xref': 'd1-s1.dita' });
    let bookPrevented = false;
    h.click({ target: { closest: () => book }, preventDefault: () => (bookPrevented = true) });
    assert.strictEqual(bookPrevented, false);
    assert.deepStrictEqual(h.posted, []);
  });
});

describe('image map support wiring', () => {
  const preview = read('src/editor/DitaViewerProvider.ts');
  const mapViewer = read('src/editor/MapViewerProvider.ts');

  // Both webviews render imagemaps (baseTypeMap renderers are shared), so
  // both need the script -- dropping it from either re-exposes that
  // webview's hotspots to the misalignment and white-page behaviors.
  it('is interpolated into both webview scripts with the same message type', () => {
    for (const [name, src] of [
      ['DitaViewerProvider', preview],
      ['MapViewerProvider', mapViewer],
    ] as const) {
      assert.ok(
        src.includes("getImageMapSupportScript({ openMsgType: 'openImagemapLink' })"),
        `${name} must inject the image-map support script`,
      );
      assert.ok(
        src.includes("message.type === 'openImagemapLink'"),
        `${name} must handle the openImagemapLink message host-side`,
      );
      assert.ok(src.includes('openHrefTarget('), `${name} must route the href through openHrefTarget`);
    }
  });
});
