import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * dita-viewer-chrome.js's initOnPageToc() looks for `section[id]` and
 * `h1[id]` to build the "on this page" list. Adeline's real transform
 * output (webhelp-output.zip) confirms neither <section> nor its
 * h2.sectiontitle/h3.sectiontitle ever carries an id in DITA-OT's own html5
 * output -- only <h1> does -- so the section loop always finds zero items,
 * h1 never gets added (gated on the section loop having found something
 * first), and the feature silently never renders. This runs the real script
 * body (via new Function, same approach as imageMapSupportScript.test.ts)
 * against a fake DOM that mirrors that real shape precisely: `section[id]`
 * matches nothing, `section` matches both sections, `h1[id]` matches (h1
 * does have one already).
 */

const assetsDir = join(process.cwd(), 'media', 'transform-assets');
const rawScript = () => readFileSync(join(assetsDir, 'site-chrome.js'), 'utf-8');

function scriptWithPlaceholdersFilled(): string {
  // Only onPageToc enabled -- isolates the function under test from
  // initNavToolbar/initSidebar/initCodeLabels/initBackToTop/initDarkMode,
  // none of which this fake DOM needs to support.
  return rawScript()
    .replace('/* __DV_MANIFEST__ */', '[]')
    .replace(
      '/* __DV_FEATURES__ */',
      '{"navToolbar":false,"sidebar":false,"onPageToc":true,"copyCode":false,"backToTop":false,"darkMode":false}',
    );
}

function fakeElement(tag: string) {
  return {
    tagName: tag.toUpperCase(),
    id: '',
    className: '',
    textContent: '',
    href: '',
    onclick: null as null | ((e: unknown) => void),
    children: [] as unknown[],
    appendChild(child: unknown) {
      this.children.push(child);
    },
  };
}
type FakeHeading = { id: string; textContent: string };

function runOnPageToc(sections: Array<{ heading: FakeHeading | null }>, h1: FakeHeading | null) {
  const appended: ReturnType<typeof fakeElement>[] = [];
  const fakeDocument = {
    documentElement: { lang: 'zh-CN' },
    body: { appendChild: (el: ReturnType<typeof fakeElement>) => appended.push(el) },
    createElement: (tag: string) => fakeElement(tag),
    querySelectorAll(selector: string) {
      // Mirrors the real output precisely: "section[id]" never matches
      // (no <section> carries an id), plain "section" matches every one.
      if (selector === 'section[id]') return [];
      if (selector === 'section') {
        return sections.map((s) => ({
          querySelector: (sel: string) =>
            sel.indexOf('sectiontitle') >= 0 ? s.heading : null,
        }));
      }
      return [];
    },
    querySelector(selector: string) {
      if (selector === 'h1[id]' || selector === 'h1') return h1;
      return null;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const boot = new Function(
    'document',
    'window',
    'location',
    'localStorage',
    scriptWithPlaceholdersFilled() + '\nreturn typeof initOnPageToc === "function" ? initOnPageToc : null;',
  ) as (d: unknown, w: unknown, l: unknown, ls: unknown) => (() => void) | null;
  const fakeWindow = { addEventListener() {}, scrollY: 0 };
  const fakeLocation = { pathname: '/topics/product_intro.html' };
  const fakeLocalStorage = { getItem: () => null, setItem() {} };
  const init = boot(fakeDocument, fakeWindow, fakeLocation, fakeLocalStorage);
  assert.ok(init, 'initOnPageToc should be defined at top level');
  init!();
  return appended;
}

describe('site-chrome.js on-page TOC vs. real DITA-OT output (no ids on section/heading)', () => {
  it('still builds the "on this page" list when sections and their headings carry no id at all, like real output does', () => {
    const sections = [
      { heading: { id: '', textContent: '核心能力' } },
      { heading: { id: '', textContent: '典型应用场景' } },
    ];
    const h1 = { id: 'ariaid-title1', textContent: '产品简介' };
    const appended = runOnPageToc(sections, h1);
    const toc = appended.find((el) => el.className === 'dv-page-toc');
    assert.ok(toc, 'expected a .dv-page-toc element to be appended to <body>');
  });

  it('synthesises an id on a heading that has none, rather than requiring DITA-OT to have provided one', () => {
    const sections = [
      { heading: { id: '', textContent: '核心能力' } },
      { heading: { id: '', textContent: '典型应用场景' } },
    ];
    const h1 = { id: 'ariaid-title1', textContent: '产品简介' };
    runOnPageToc(sections, h1);
    // The heading objects are mutated in place by ensureId(); an id was
    // assigned so the on-page link's #href has something real to jump to.
    assert.ok(sections[0].heading!.id, 'expected an id to be synthesised on the first section heading');
    assert.ok(sections[1].heading!.id, 'expected an id to be synthesised on the second section heading');
    assert.notStrictEqual(sections[0].heading!.id, sections[1].heading!.id, 'synthesised ids must be unique');
  });

  it('still returns without building anything when there is truly only one heading on the page (h1 alone)', () => {
    const h1 = { id: 'ariaid-title1', textContent: '产品简介' };
    const appended = runOnPageToc([], h1);
    const toc = appended.find((el) => el.className === 'dv-page-toc');
    assert.strictEqual(toc, undefined, 'a single-heading page should still get no on-page TOC');
  });
});
