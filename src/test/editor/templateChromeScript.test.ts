import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * site-chrome.js's siteShell variant (the DITA-OT TEMPLATE export path driven
 * by injectTemplateChrome). Runs the real script through new Function with a
 * hand-built fake DOM, exposing the internal functions the same way
 * onPageTocRealMarkup.test.ts does -- no jsdom here. Covers only what the
 * template path adds: sidebar link rewriting, the persisted fold restore,
 * per-row fold toggling, and keeping body.template-dark in step with html.dark.
 */

const assetsDir = join(process.cwd(), 'media', 'transform-assets');
const rawScript = () => readFileSync(join(assetsDir, 'site-chrome.js'), 'utf-8');

function expose(featuresJson: string, manifestJson = '[]'): string {
  return rawScript()
    .replace('/* __DV_MANIFEST__ */', manifestJson)
    .replace('/* __DV_FEATURES__ */', featuresJson) +
    '\nreturn { initTemplateNavLinks, initTemplateNavFolds, setShellNavItemCollapsed, syncTemplateDark, rootPrefix };';
}

interface El {
  [key: string]: unknown;
  attrs: Record<string, string>;
  children: El[];
  classList: {
    add: (...cs: string[]) => void;
    remove: (...cs: string[]) => void;
    contains: (c: string) => boolean;
    toggle: (c: string) => boolean;
  };
  className: string;
  setAttribute: (k: string, v: string) => void;
  getAttribute: (k: string) => string | null;
  appendChild: (c: El) => El;
  scrollIntoView: () => void;
}

/** A minimal element: attribute map, classList over a Set, and a caller-
 *  supplied querySelector/querySelectorAll/contains. Enough for the handful
 *  of DOM APIs the siteShell functions touch -- nothing more. */
function makeEl(opts: {
  class?: string;
  attrs?: Record<string, string>;
  children?: El[];
  querySelector?: (sel: string) => El | null;
  querySelectorAll?: (sel: string) => El[];
  contains?: (other: El) => boolean;
} = {}): El {
  const attrs: Record<string, string> = { ...(opts.attrs || {}) };
  const classes = new Set<string>((opts.class || '').split(/\s+/).filter(Boolean));
  const el: El = {
    tagName: 'DIV',
    attrs,
    className: '',
    children: opts.children || [],
    style: {},
    textContent: '',
    scrollIntoViewCalls: 0,
    classList: {
      add: (...cs: string[]) => cs.forEach((c) => c && classes.add(c)),
      remove: (...cs: string[]) => cs.forEach((c) => classes.delete(c)),
      contains: (c: string) => classes.has(c),
      toggle: (c: string) => { if (classes.has(c)) { classes.delete(c); return false; } classes.add(c); return true; },
    },
    setAttribute: (k: string, v: string) => { attrs[k] = v; },
    getAttribute: (k: string) => (k in attrs ? attrs[k] : null),
    appendChild: (c: El) => { (el.children as El[]).push(c); return c; },
    addEventListener: () => {},
    scrollIntoView: () => { (el.scrollIntoViewCalls as number)++; },
  };
  Object.defineProperty(el, 'className', {
    configurable: true,
    get: () => [...classes].join(' '),
    set: (v: string) => { classes.clear(); (v || '').split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
  });
  if (opts.querySelector) el.querySelector = opts.querySelector;
  if (opts.querySelectorAll) el.querySelectorAll = opts.querySelectorAll;
  if (opts.contains) el.contains = opts.contains;
  return el;
}

function boot(featuresJson: string, doc: unknown, storage: Record<string, string> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('document', 'window', 'location', 'localStorage', 'navigator', expose(featuresJson)) as
    (d: unknown, w: unknown, l: unknown, ls: unknown, n: unknown) => Record<string, (...a: unknown[]) => unknown>;
  const appended: El[] = [];
  const documentElement = makeEl();
  const body = makeEl();
  body.appendChild = (c: El) => { appended.push(c); return c; };
  const fakeDoc = {
    documentElement,
    body,
    createElement: (_t: string) => makeEl({}),
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    ...((doc || {}) as object),
  };
  const fakeLocation = { pathname: '/topics/a.html', href: '', hash: '' };
  const ls = { getItem: (k: string) => (k in storage ? storage[k] : null), setItem: (k: string, v: string) => { storage[k] = v; } };
  const api = fn(
    fakeDoc,
    { addEventListener() {}, scrollY: 0 },
    fakeLocation,
    ls,
    { language: 'en' },
  );
  return { api, appended, documentElement, body, storage };
}

const SITE_SHELL = '{"navToolbar":false,"sidebar":false,"onPageToc":false,"copyCode":false,"backToTop":false,"darkMode":false,"siteShell":true}';

describe('site-chrome.js template shell: sidebar link rewriting', () => {
  it('turns each _root_ data-site-target into a real root-relative href and reveals the active row', () => {
    const a = makeEl({ attrs: { 'data-site-target': '_root_/topics/a.html' } });
    const b = makeEl({ class: 'active', attrs: { 'data-site-target': '_root_/topics/b.html' } });
    const nav = makeEl({
      querySelectorAll: (sel) => (sel === '.site-nav-link[data-site-target]' ? [a, b] : []),
      querySelector: (sel) => (sel === '.site-nav-link.active' ? b : null),
    });
    const { api } = boot(SITE_SHELL, { querySelector: (sel: string) => (sel === '.site-nav' ? nav : null) });
    api.initTemplateNavLinks();
    // No chrome asset link in the stub -> rootPrefix() is '', so targets land
    // at the site root relative to this (root-level) page.
    assert.strictEqual(a.attrs.href, 'topics/a.html');
    assert.strictEqual(b.attrs.href, 'topics/b.html');
    assert.ok((b.scrollIntoViewCalls as number) >= 1, 'active row scrolled into view');
  });

  it('prefixes the rewritten hrefs with the depth back-to-root path from the chrome link', () => {
    const a = makeEl({ attrs: { 'data-site-target': '_root_/topics/a.html' } });
    const nav = makeEl({ querySelectorAll: () => [a], querySelector: () => null });
    const rootLink = makeEl({ attrs: { href: '../../dita-viewer-site-shell.css' } });
    const { api } = boot(SITE_SHELL, {
      querySelector: (sel: string) => {
        if (sel === '.site-nav') return nav;
        if (sel.indexOf('dita-viewer') >= 0) return rootLink;
        return null;
      },
    });
    assert.strictEqual(api.rootPrefix(), '../../');
    api.initTemplateNavLinks();
    assert.strictEqual(a.attrs.href, '../../topics/a.html');
  });

  it('leaves a data-site-target that is not a _root_ path (a home tile) alone', () => {
    // A home tile ships an href="="# placeholder; initTemplateNavLinks must
    // skip it (not a _root_/ target) so its original href survives untouched.
    const t = makeEl({ attrs: { 'data-site-target': '@@dita-viewer-site-home@@', href: '#' } });
    const nav = makeEl({ querySelectorAll: () => [t], querySelector: () => null });
    const { api } = boot(SITE_SHELL, { querySelector: (sel: string) => (sel === '.site-nav' ? nav : null) });
    api.initTemplateNavLinks();
    assert.strictEqual(t.attrs.href, '#', 'non-_root_ target keeps its original href');
    assert.ok(!String(t.attrs.href ?? '').includes('site-home'), 'target string never leaks into href');
  });
});

describe('site-chrome.js template shell: persisted folds', () => {
  it('restores the stored collapsed branches, sparing the active row\'s ancestors', () => {
    const active = makeEl();
    const toggle = makeEl();
    const ch1 = makeEl({ class: 'site-nav-item has-children', attrs: { 'data-nav-id': '/abs/ch1.dita' }, contains: (o) => o === active });
    const ch2 = makeEl({ class: 'site-nav-item has-children', attrs: { 'data-nav-id': '/abs/ch2.dita' }, contains: () => false });
    ch1.querySelector = () => toggle;
    ch2.querySelector = () => toggle;
    const nav = makeEl({
      querySelector: (sel) => (sel === '.site-nav-link.active' ? active : null),
      querySelectorAll: (sel) => (sel.indexOf('has-children') >= 0 ? [ch1, ch2] : []),
    });
    nav.addEventListener = () => {};
    const storage = { 'dv-site-nav-collapsed': JSON.stringify(['/abs/ch1.dita', '/abs/ch2.dita']) };
    const { api } = boot(SITE_SHELL, { querySelector: (sel: string) => (sel === '.site-nav' ? nav : null) }, storage);
    api.initTemplateNavFolds();
    // ch1 is the active row's ancestor -- never collapsed, even though stored.
    assert.ok(!(ch1.classList as { contains: (c: string) => boolean }).contains('collapsed'), 'active ancestor stays expanded');
    assert.ok((ch2.classList as { contains: (c: string) => boolean }).contains('collapsed'), 'unrelated stored branch folds');
  });

  it('setShellNavItemCollapsed mirrors the folded state onto the row and its toggle', () => {
    const toggle = makeEl({ attrs: { 'data-expand-label': 'Expand', 'data-collapse-label': 'Collapse' } });
    const item = makeEl({ class: 'site-nav-item has-children' });
    item.querySelector = () => toggle;
    const { api } = boot(SITE_SHELL, { querySelector: () => null });
    api.setShellNavItemCollapsed(item, true);
    assert.ok((item.classList as { contains: (c: string) => boolean }).contains('collapsed'));
    assert.strictEqual(item.attrs['aria-expanded'], 'false');
    assert.strictEqual(toggle.attrs['aria-label'], 'Expand');
    api.setShellNavItemCollapsed(item, false);
    assert.ok(!(item.classList as { contains: (c: string) => boolean }).contains('collapsed'));
    assert.strictEqual(toggle.attrs['aria-label'], 'Collapse');
  });
});

describe('site-chrome.js template shell: dark palette sync', () => {
  it('adds body.template-dark when html.dark is set', () => {
    const { api, documentElement, body } = boot(SITE_SHELL, { querySelector: () => null });
    (documentElement.classList as { add: (...c: string[]) => void }).add('dark');
    api.syncTemplateDark();
    assert.ok(/(^|\s)template-dark(\s|$)/.test(body.className), 'body gains template-dark');
  });

  it('removes body.template-dark when html.dark is cleared', () => {
    const { api, body } = boot(SITE_SHELL, { querySelector: () => null });
    body.className = 'mode-site site-shell template-dark';
    api.syncTemplateDark(); // html.dark is absent in the fresh stub
    assert.ok(!/(^|\s)template-dark(\s|$)/.test(body.className), 'template-dark removed');
    assert.ok(/mode-site/.test(body.className), 'other body classes preserved');
  });
});

describe('site-chrome.js template shell: the layout toggles stay off', () => {
  it('builds no dv-toolbar / dv-sidebar when siteShell runs with those flags false', () => {
    // The whole script boots with the template-mode flag set and both layout
    // flags off; nothing the layout code appends may appear.
    const { appended } = boot(SITE_SHELL, undefined);
    for (const el of appended) {
      assert.notStrictEqual(el.className, 'dv-toolbar');
      assert.notStrictEqual(el.className, 'dv-sidebar');
    }
  });
});
