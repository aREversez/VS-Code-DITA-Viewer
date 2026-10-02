import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

// Same real-script-via-new-Function approach as themeSwitcherScript.test.ts /
// onPageTocRealMarkup.test.ts (jsdom is not a dependency of this project).

const assetsDir = join(process.cwd(), 'media', 'transform-assets');
const rawScript = () => readFileSync(join(assetsDir, 'site-chrome.js'), 'utf-8');

function scriptWithPlaceholdersFilled(manifest: unknown): string {
  return rawScript()
    .replace('/* __DV_MANIFEST__ */', JSON.stringify(manifest))
    .replace(
      '/* __DV_FEATURES__ */',
      '{"navToolbar":true,"sidebar":false,"onPageToc":false,"copyCode":false,"backToTop":false,"darkMode":false}',
    );
}

function fakeElement(tag: string) {
  const elAttrs: Record<string, string> = {};
  const el: Record<string, unknown> = {
    tagName: tag.toUpperCase(),
    value: '',
    title: '',
    textContent: '',
    className: '',
    onclick: null,
    onchange: null,
    children: [] as unknown[],
  };
  el.appendChild = (child: unknown) => (el.children as unknown[]).push(child);
  el.setAttribute = (k: string, v: string) => { elAttrs[k] = v; };
  el.getAttribute = (k: string) => elAttrs[k] ?? null;
  return el;
}

function run(pathname: string, initialLayoutAttr: string | null) {
  const appendedToBody: ReturnType<typeof fakeElement>[] = [];
  const attrs: Record<string, string> = initialLayoutAttr ? { 'data-dv-index-layout': initialLayoutAttr } : {};
  const storage: Record<string, string> = {};
  const fakeDocument = {
    documentElement: {
      lang: 'zh-CN',
      getAttribute: (k: string) => attrs[k] ?? null,
      setAttribute: (k: string, v: string) => { attrs[k] = v; },
      removeAttribute: (k: string) => { delete attrs[k]; },
    },
    body: { appendChild: (el: ReturnType<typeof fakeElement>) => appendedToBody.push(el) },
    createElement: (tag: string) => fakeElement(tag),
    querySelector: () => null,
    addEventListener() {},
  };
  const fakeWindow = { addEventListener() {}, scrollY: 0 };
  const fakeLocation = { pathname, href: '', hash: '' };
  const fakeLocalStorage = {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => { storage[k] = v; },
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const boot = new Function(
    'document', 'window', 'location', 'localStorage', 'navigator',
    scriptWithPlaceholdersFilled([{ file: 'product_intro.html', title: 't' }]),
  ) as (d: unknown, w: unknown, l: unknown, ls: unknown, n: unknown) => void;
  boot(fakeDocument, fakeWindow, fakeLocation, fakeLocalStorage, { language: 'zh-CN' });
  const bar = appendedToBody.find((el) => el.className === 'dv-toolbar');
  const selects = bar ? (bar.children as ReturnType<typeof fakeElement>[]).filter((c) => c.tagName === 'SELECT') : [];
  // The accent-theme <select> is also in the toolbar (classic/aurora/reader);
  // the layout switcher is the other one, identified by its own option set.
  const layoutSelect = selects.find((s) => (s.children as { value: string }[]).some((o) => o.value === 'tile'));
  return { layoutSelect, attrs, storage };
}

describe('site-chrome.js toolbar index-layout <select> (tree/tile homepage layout)', () => {
  it('adds a layout <select> with tree/tile options to the toolbar on the index page', () => {
    const { layoutSelect } = run('/index.html', null);
    assert.ok(layoutSelect, 'expected a layout <select> in the toolbar');
    const values = (layoutSelect!.children as { value: string }[]).map((o) => o.value);
    assert.deepStrictEqual(values, ['tree', 'tile']);
  });

  it('does not add the layout <select> on a topic page (the layout only applies to the index page)', () => {
    const { layoutSelect } = run('/topics/product_intro.html', null);
    assert.strictEqual(layoutSelect, undefined);
  });

  it('initialises its displayed value from the data-dv-index-layout attribute the bootstrap script already applied', () => {
    const { layoutSelect } = run('/index.html', 'tile');
    assert.strictEqual(layoutSelect!.value, 'tile');
  });

  it('defaults to "tree" when no layout attribute was applied', () => {
    const { layoutSelect } = run('/index.html', null);
    assert.strictEqual(layoutSelect!.value, 'tree');
  });

  it('picking "tile" sets data-dv-index-layout and persists it to localStorage for the next page load', () => {
    const { layoutSelect, attrs, storage } = run('/index.html', null);
    layoutSelect!.value = 'tile';
    (layoutSelect!.onchange as () => void)();
    assert.strictEqual(attrs['data-dv-index-layout'], 'tile');
    assert.strictEqual(storage['dv-index-layout'], 'tile');
  });

  it('picking "tree" again removes the attribute rather than setting data-dv-index-layout="tree"', () => {
    const { layoutSelect, attrs } = run('/index.html', 'tile');
    layoutSelect!.value = 'tree';
    (layoutSelect!.onchange as () => void)();
    assert.strictEqual(attrs['data-dv-index-layout'], undefined);
  });
});
