import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

// Same real-script-via-new-Function approach as onPageTocRealMarkup.test.ts /
// imageMapSupportScript.test.ts (jsdom is not a dependency of this project).

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
  return el;
}

function run(initialThemeAttr: string | null) {
  const appendedToBody: ReturnType<typeof fakeElement>[] = [];
  const attrs: Record<string, string> = initialThemeAttr ? { 'data-dv-theme': initialThemeAttr } : {};
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
  };
  const fakeWindow = { addEventListener() {}, scrollY: 0 };
  const fakeLocation = { pathname: '/topics/product_intro.html', href: '' };
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
  const select = bar ? (bar.children as ReturnType<typeof fakeElement>[]).find((c) => c.tagName === 'SELECT') : undefined;
  return { select, attrs, storage };
}

describe('site-chrome.js toolbar theme <select> (aurora/reader accent themes)', () => {
  it('adds a theme <select> with classic/aurora/reader options to the toolbar', () => {
    const { select } = run(null);
    assert.ok(select, 'expected a <select> in the toolbar');
    const values = (select!.children as { value: string }[]).map((o) => o.value);
    assert.deepStrictEqual(values, ['classic', 'aurora', 'reader']);
  });

  it('initialises its displayed value from the data-dv-theme attribute the bootstrap script already applied', () => {
    const { select } = run('aurora');
    assert.strictEqual(select!.value, 'aurora');
  });

  it('defaults to "classic" when no theme attribute was applied', () => {
    const { select } = run(null);
    assert.strictEqual(select!.value, 'classic');
  });

  it('picking a theme sets data-dv-theme and persists it to localStorage for the next page load', () => {
    const { select, attrs, storage } = run(null);
    select!.value = 'reader';
    (select!.onchange as () => void)();
    assert.strictEqual(attrs['data-dv-theme'], 'reader');
    assert.strictEqual(storage['dv-chrome-theme'], 'reader');
  });

  it('picking "classic" again removes the attribute rather than setting data-dv-theme="classic"', () => {
    const { select, attrs } = run('aurora');
    select!.value = 'classic';
    (select!.onchange as () => void)();
    assert.strictEqual(attrs['data-dv-theme'], undefined);
  });
});
