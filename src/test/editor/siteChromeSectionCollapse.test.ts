import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

// Executes the real media/transform-assets/site-chrome.js (the same template
// injectSiteChrome copies into a DITA-OT export) against a hand-built fake
// DOM, the established pattern for browser-side chrome JS in this repo (see
// ditaOtUtils.test.ts's bootstrap describes) -- tsc/eslint/npm test never
// otherwise run this file.
const assetsDir = join(process.cwd(), 'media', 'transform-assets');

interface FakeEl {
  tag: string;
  classes: Set<string>;
  attrs: Record<string, string>;
  children: FakeEl[];
  parent: FakeEl | null;
  nodeType: number;
  textContent: string;
  title: string;
  style: Record<string, string>;
  onclick: ((this: FakeEl) => void) | null;
  id: string;
  hiddenByStyle: boolean;
  scrolled: number;
  classList: {
    add(c: string): void;
    remove(c: string): void;
    contains(c: string): boolean;
    toggle(c: string, force?: boolean): void;
  };
  get className(): string;
  get parentElement(): FakeEl | null;
  get offsetParent(): FakeEl | null;
  matches(sel: string): boolean;
  closest(sel: string): FakeEl | null;
  appendChild(c: FakeEl): FakeEl;
  getAttribute(n: string): string | undefined;
  setAttribute(n: string, v: string): void;
  scrollIntoView(): void;
}

function el(tag: string, classes: string[] = [], attrs: Record<string, string> = {}): FakeEl {
  const node = {
    tag,
    classes: new Set(classes),
    attrs: { ...attrs },
    children: [],
    parent: null,
    nodeType: 1,
    textContent: '',
    title: '',
    style: {},
    onclick: null,
    id: attrs.id ?? '',
    hiddenByStyle: false,
    scrolled: 0,
  } as unknown as FakeEl;
  node.classList = {
    add: (c: string) => node.classes.add(c),
    remove: (c: string) => node.classes.delete(c),
    contains: (c: string) => node.classes.has(c),
    toggle: (c: string, force?: boolean) => {
      if (force === undefined ? !node.classes.has(c) : force) node.classes.add(c);
      else node.classes.delete(c);
    },
  };
  Object.defineProperty(node, 'className', {
    get: () => [...node.classes].join(' ').trim(),
    set: (v: string) => { node.classes = new Set(v.split(/\s+/).filter(Boolean)); },
  });
  Object.defineProperty(node, 'parentElement', { get: () => node.parent });
  // Mirrors the site-chrome.css collapse cascade: hidden when a standalone
  // `display:none` rule (or the test harness) flags it, or when any ANCESTOR
  // is a collapsed section and this element is not that section's heading
  // child (headings stay visible as the collapsed section's affordance).
  Object.defineProperty(node, 'offsetParent', {
    get: () => (isVisible(node) ? node : null),
  });
  node.matches = (sel: string) => {
    for (const part of sel.split('.')) {
      if (!part) continue;
      if (!(part === node.tag || node.classes.has(part))) return false;
    }
    return true;
  };
  node.closest = (sel: string) => {
    let n: FakeEl | null = node;
    while (n) {
      if (n.matches(sel)) return n;
      n = n.parent;
    }
    return null;
  };
  node.appendChild = (c: FakeEl) => { c.parent = node; node.children.push(c); return c; };
  node.getAttribute = (name: string) => node.attrs[name];
  node.setAttribute = (name: string, v: string) => { node.attrs[name] = v; };
  node.scrollIntoView = () => { node.scrolled++; };
  return node;
}
function textNode(parent: FakeEl, s: string): FakeEl {
  const t = el('#text');
  t.nodeType = 3;
  t.textContent = s;
  t.parent = parent;
  parent.children.push(t);
  return t;
}
function isVisible(node: FakeEl): boolean {
  if (node.hiddenByStyle) return false;
  for (let p = node.parent; p; p = p.parent) {
    if (p.classes.has('dv-collapsed') && p.classes.has('section') && !/^h[1-6]$/.test(node.tag)) return false;
  }
  return !node.classes.has('dv-collapsed') ? true : true;
}

function walkAll(root: FakeEl): FakeEl[] {
  const out: FakeEl[] = [];
  (function visit(n: FakeEl) {
    for (const c of n.children) { out.push(c); visit(c); }
  })(root);
  return out;
}

interface Env {
  doc: FakeEl;
  location: { pathname: string; hash: string };
  store: Map<string, string>;
  clickHandlers: Array<(e: unknown) => void>;
  hashChangeHandlers: Array<() => void>;
  buttons: FakeEl[];
  api: {
    initSectionCollapsePreference(): void;
    initAnchorReveal(): void;
    initNavToolbar(): void;
    syncSectionToggleState(): void;
  };
}

// Book-with-nested-sections fixture:
//   sec-1 (h1 + p + nested sec-1a with its own h2/p)
//   sec-2 (h2 + p, with a style-hidden extra paragraph)
function buildPage(): FakeEl {
  const doc = el('html', [], { lang: 'zh' });
  const body = el('body');
  doc.appendChild(body);
  const main = el('main');
  body.appendChild(main);
  const sec1 = el('section', ['section'], { id: 'sec-1' });
  main.appendChild(sec1);
  sec1.appendChild(textNode(sec1, ''));
  const h1 = el('h1', ['title'], { id: 'h1' });
  sec1.appendChild(h1);
  const p1 = el('p', [], { id: 'p1' });
  sec1.appendChild(p1);
  const sec1a = el('section', ['section'], { id: 'sec-1a' });
  sec1.appendChild(sec1a);
  const h1a = el('h2', ['sectiontitle']);
  sec1a.appendChild(h1a);
  const p1a = el('p', [], { id: 'p1a' });
  sec1a.appendChild(p1a);
  const sec2 = el('section', ['section'], { id: 'sec-2' });
  main.appendChild(sec2);
  const h2 = el('h2', ['sectiontitle']);
  sec2.appendChild(h2);
  const p2 = el('p', [], { id: 'p2' });
  sec2.appendChild(p2);
  const p2b = el('p', [], { id: 'p2b' });
  p2b.hiddenByStyle = true;
  sec2.appendChild(p2b);
  return doc;
}

function setup(opts: { stored: string | null; hash?: string }): Env {
  const doc = buildPage();
  const location = { pathname: '/book/topic.html', hash: opts.hash ?? '' };
  const store = new Map<string, string>();
  if (opts.stored !== null) store.set('dv-section-collapse', opts.stored);
  const clickHandlers: Array<(e: unknown) => void> = [];
  const hashChangeHandlers: Array<() => void> = [];
  const buttons: FakeEl[] = [];
  const fakeDocument = {
    documentElement: doc,
    body: doc.children[0],
    lang: 'zh',
    addEventListener: (t: string, fn: (e: unknown) => void) => { if (t === 'click') clickHandlers.push(fn); },
    createElement: (tag: string) => {
      const b = el(tag);
      b.attrs.__tag = tag;
      if (tag === 'button') buttons.push(b);
      return b;
    },
    createTextNode: (s: string) => { const t = el('#text'); t.textContent = s; return t; },
    querySelectorAll: (sel: string) => walkAll(doc).filter((n) => n.nodeType === 1 && n.matches(sel)),
    querySelector: (sel: string) => walkAll(doc).find((n) => n.nodeType === 1 && n.matches(sel)) ?? null,
    getElementById: (id: string) => walkAll(doc).find((n) => n.id === id) ?? null,
  };
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
  };
  const windowObj = {
    scrollY: 0,
    matchMedia: () => ({ matches: false }),
    addEventListener: (t: string, fn: () => void) => { if (t === 'hashchange') hashChangeHandlers.push(fn); },
  };
  const raw = readFileSync(join(assetsDir, 'site-chrome.js'), 'utf-8')
    .replace('/* __DV_MANIFEST__ */', '[]')
    // All-false FEATURES: the file's bottom self-install block must stay
    // dormant -- each test drives the init functions by hand (in the order
    // it wants) and captures their listeners/handlers through the fakes.
    .replace('/* __DV_FEATURES__ */', '{"navToolbar":false,"sidebar":false,"onPageToc":false,"copyCode":false,"backToTop":false,"darkMode":false}');
  const api = new Function('document', 'location', 'navigator', 'window', 'localStorage', raw + `
    ;return { initSectionCollapsePreference: initSectionCollapsePreference, initAnchorReveal: initAnchorReveal, initNavToolbar: initNavToolbar, syncSectionToggleState: syncSectionToggleState };`)
    (fakeDocument, location, { language: 'zh' }, windowObj, localStorage);
  return { doc, location, store, clickHandlers, hashChangeHandlers, buttons, api };
}

function sections(env: Env): Record<string, FakeEl> {
  const byId: Record<string, FakeEl> = {};
  for (const n of walkAll(env.doc)) if (n.id) byId[n.id] = n;
  return byId;
}
function toggleButton(env: Env): FakeEl {
  // The first <button> carrying an aria-pressed (the section toggle) -- the
  // toolbar <div> gets one too, hence the tag filter.
  return env.buttons.find((b) => b.tag === 'button' && b.attrs['aria-pressed'] !== undefined)!;
}

describe('site-chrome.js section-collapse persistence + anchor reveal', () => {
  it('applies the stored collapse-all preference on load, marking top-level sections only', () => {
    const env = setup({ stored: '1' });
    env.api.initSectionCollapsePreference();
    env.api.initNavToolbar();
    const s = sections(env);
    assert.ok(s['sec-1'].classes.has('dv-collapsed') && s['sec-2'].classes.has('dv-collapsed'), 'both top-level sections collapsed from storage');
    assert.ok(!s['sec-1a'].classes.has('dv-collapsed'), 'nested section not marked -- hidden by the CSS cascade through its parent');
    const tb = toggleButton(env);
    assert.strictEqual(tb.textContent, '\u229F', 'button renders the collapsed state the DOM actually has');
    assert.strictEqual(tb.attrs['aria-pressed'], 'true');
  });

  it('the button click persists, and a mixed hand-collapsed page still collapses everything in one direction', () => {
    const env = setup({ stored: null });
    env.api.initSectionCollapsePreference();
    env.api.initNavToolbar();
    const tb = toggleButton(env);
    tb.onclick!.call(tb);
    assert.strictEqual(env.store.get('dv-section-collapse'), '1');
    assert.strictEqual(sections(env)['sec-1'].classes.has('dv-collapsed'), true);
    tb.onclick!.call(tb);
    assert.strictEqual(env.store.get('dv-section-collapse'), '0');
    assert.strictEqual(sections(env)['sec-1'].classes.has('dv-collapsed'), false);
    // Mixed state: one section hand-collapsed (the stragglers case), one not.
    const s = sections(env);
    s['sec-2'].classes.add('dv-collapsed');
    env.api.syncSectionToggleState();
    assert.strictEqual(toggleButton(env).textContent, '\u229F', 'button reads the DOM, not its own last click');
    tb.onclick!.call(tb);
    // From the mixed state the button shows ⊟ ("some collapsed"), so its click
    // expands everything -- NOT the old per-section lockstep inversion that
    // would have collapsed the visible sec-1 while opening sec-2.
    assert.strictEqual(s['sec-1'].classes.has('dv-collapsed'), false, 'the visible section was left visible, not toggled shut');
    assert.strictEqual(s['sec-2'].classes.has('dv-collapsed'), false, 'the collapsed section opened');
    assert.strictEqual(env.store.get('dv-section-collapse'), '0');
  });

  it('a load-time hash into one section expands its ancestor chain over the stored preference, without rewriting it', () => {
    const env = setup({ stored: '1', hash: '#sec-1a' });
    env.api.initSectionCollapsePreference();
    env.api.initNavToolbar();
    const s = sections(env);
    assert.strictEqual(s['sec-1'].classes.has('dv-collapsed'), false, 'ancestor of the hash target stays visible');
    assert.strictEqual(s['sec-2'].classes.has('dv-collapsed'), true, 'unrelated sections keep the stored collapse');
    assert.strictEqual(env.store.get('dv-section-collapse'), '1', 'the auto-expansion is navigation, not a new preference');
    const tb = toggleButton(env);
    assert.strictEqual(tb.textContent, '\u229F');
    assert.strictEqual(tb.title, '\u5C55\u5F00\u5168\u90E8\u7AE0\u8282');
    tb.onclick!.call(tb);
    assert.strictEqual(s['sec-2'].classes.has('dv-collapsed'), false, 'button reads ⊟ (some collapsed), so its click expands everything');
    assert.strictEqual(s['sec-1'].classes.has('dv-collapsed'), false);
    assert.strictEqual(env.store.get('dv-section-collapse'), '0');
  });

  it('same-document anchor clicks into a collapsed section: expand ancestors, preventDefault, scroll the target', () => {
    const env = setup({ stored: '1' });
    env.api.initSectionCollapsePreference();
    env.api.initAnchorReveal();
    env.api.initNavToolbar();
    const s = sections(env);
    const link = el('a', [], { href: '#p1' });
    s['sec-2'].appendChild(link);
    const ev = { target: { closest: (sel: string) => (sel === 'a' ? link : null) }, preventDefaultCalled: false, preventDefault() { this.preventDefaultCalled = true; } };
    env.clickHandlers[0](ev);
    assert.strictEqual(ev.preventDefaultCalled, true, 'jump to a hidden target is intercepted');
    // (pass the event object itself -- spreading it would hand the handler a
    // copy whose preventDefault flag the assertion could never see)
    assert.strictEqual(s['sec-1'].classes.has('dv-collapsed'), false);
    assert.strictEqual(s['sec-1'].scrolled, 0);
    assert.strictEqual(sections(env)['p1'].scrolled, 1, 'the named paragraph is scrolled into view');
    assert.strictEqual(toggleButton(env).attrs['aria-pressed'], 'true', 'button re-syncs: sec-2 is still collapsed');
    assert.strictEqual(env.store.get('dv-section-collapse'), '1', 'interception does not rewrite the preference');
  });

  it('anchor clicks whose target is already visible are left to the browser', () => {
    const env = setup({ stored: null });
    env.api.initSectionCollapsePreference();
    env.api.initAnchorReveal();
    env.api.initNavToolbar();
    const s = sections(env);
    const link = el('a', [], { href: '#h1' });
    s['sec-2'].appendChild(link);
    const ev = { target: { closest: (sel: string) => (sel === 'a' ? link : null) }, preventDefaultCalled: false, preventDefault() { this.preventDefaultCalled = true; } };
    env.clickHandlers[0](ev);
    assert.strictEqual(ev.preventDefaultCalled, false);
    assert.strictEqual(s['h1'].scrolled, 0);
  });

  it('hashchange into a section hidden only by an ancestor expand + re-jumps; a style-hidden target is still nudged', () => {
    const env = setup({ stored: '1' });
    env.api.initSectionCollapsePreference();
    env.api.initAnchorReveal();
    env.api.initNavToolbar();
    const s = sections(env);
    env.location.hash = '#p2b';
    env.hashChangeHandlers[0]();
    assert.strictEqual(s['sec-2'].classes.has('dv-collapsed'), false, 'ancestor expanded');
    assert.strictEqual(s['p2b'].scrolled, 1);
    // Second hit, sec-2 already expanded: the target is hidden purely by its
    // own style (nothing to expand up the chain), so the hashchange handler
    // falls to its !offsetParent nudge branch rather than silently doing
    // nothing.
    env.location.hash = '#p2b';
    env.hashChangeHandlers[0]();
    assert.strictEqual(s['p2b'].scrolled, 2);
  });
});
