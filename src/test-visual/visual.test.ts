/**
 * Real-browser check for the site/book template feature, item 7 of
 * site-book-templates-plan.md ("Playwright 真实 Chromium 截图验证").
 *
 * Deliberately NOT part of `npm test`: it needs a downloaded Chromium
 * (`npm run playwright:install`) and is slower than the rest of the suite.
 * Run it on its own with `npm run test:visual`. See README's "Templates for
 * Docsite and Book view" section for how to run it and what it checks.
 *
 * Why this exists rather than extending src/test-e2e: @vscode/test-electron
 * runs in the extension host process and can only read what the extension
 * itself captured before handing HTML to the webview (see
 * getLastRenderedMapHtmlForTesting) -- it has no way to read the webview's
 * live computed style or take a screenshot of it. This check sidesteps that
 * by loading the SAME pure output (buildTemplateSnapshotHtml, built from the
 * same buildTemplateStyleText/renderChrome the real preview calls) directly
 * into a plain Chromium page, where computed style and screenshots are
 * ordinary Playwright calls.
 *
 * It is not a golden-image pixel diff (no baseline images are committed):
 * screenshots are written for you to look at, and the assertions below are
 * the automated part -- structural/computed-style invariants a broken
 * template's css could plausibly violate.
 */
import * as assert from 'assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { chromium, type Browser, type Page } from 'playwright';
import { discoverTemplates, type SiteTemplate } from '../editor/siteTemplates';
import { buildTemplateSnapshotHtml, type SnapshotOptions } from '../editor/templateSnapshot';
import { renderTopicXml } from '../editor/ditaRenderUtils';
import { getWebhelpChromeScript } from '../editor/webview/webhelpChromeScript';

// dist-test-visual/test-visual/visual.test.js -> repo root is two levels up,
// same convention as src/test-e2e/preview.test.ts.
const repoRoot = resolve(__dirname, '..', '..');
const baseCss = readFileSync(join(repoRoot, 'media', 'styles.css'), 'utf-8');
// The real map preview links webhelp-compat.css on EVERY page, whatever the
// template's dom, because an in-place site<->book switch must not rebuild
// <head> (MapViewerProvider's `compatUri`). Its rules are all scoped under
// body.wh_topic_page, so passing it for a route A template changes nothing --
// but the snapshot now loads the same three sheets in the same order the
// preview does, which is the whole subject of the route B assertions below.
const compatCss = readFileSync(join(repoRoot, 'media', 'webhelp-compat.css'), 'utf-8');
const screenshotDir = join(repoRoot, 'test-visual', '__screenshots__');

function readFile(p: string): string {
  return readFileSync(p, 'utf-8');
}
function toUri(absPath: string): string {
  return 'file://' + absPath.replace(/\\/g, '/');
}

/** Writes the snapshot HTML to a temp file and navigates to it -- page.goto,
 * not page.setContent, because file:// resolution for the template's own
 * logo/banner images needs a real document URL, not an in-memory one. */
async function openSnapshot(page: Page, tmpDir: string, name: string, html: string): Promise<void> {
  const file = join(tmpDir, `${name}.html`);
  writeFileSync(file, html, 'utf-8');
  await page.goto('file://' + file.replace(/\\/g, '/'));
}

/** The one property the plan calls out by name: a template must never make
 * the book content-visibility rule stop applying (media/styles.css:
 * `.ditamap-book > .book-entry { content-visibility: auto; ... }`). */
async function bookEntryContentVisibility(page: Page): Promise<string> {
  return page.$eval('#fixture-book-entry', (el) => getComputedStyle(el).contentVisibility);
}

/** Reads a computed style back as a string, so a failure message can name the
 *  element it came from instead of printing an anonymous rgb(). */
async function computed(page: Page, selector: string, property: string): Promise<string> {
  const value = page.$eval(selector, (el, p) => getComputedStyle(el).getPropertyValue(p), property);
  return value;
}

/* --------------------------------------------------------------------------
 * The route B (webhelp DOM) fixture pieces the webhelp suite below assembles.
 * Kept next to each other because all three are here to stop the snapshot from
 * being a hand-written copy of something the renderer owns.
 * ------------------------------------------------------------------------ */

/** One of every element the acceptance template's css addresses, through the
 *  real renderer: `h1.topictitle1`, `.note__title`, `pre.codeblock` and the
 *  rest are M2's output, so a hand fixture would check the fixture instead of
 *  the renderer. */
const WH_TOPIC_HTML = renderTopicXml({
  xml: `<topic id="t"><title>Getting Started</title><body>
<shortdesc>What this page is about.</shortdesc>
<p>A fixture paragraph so the body typography is visible.</p>
<note type="tip">A fixture note.</note>
<section id="s"><title>A section</title><p>x</p></section>
<ul><li>one</li></ul>
<ol><li>one</li></ol>
<fig id="f"><title>Figure</title><image href="a.png"/></fig>
<table><tgroup cols="1"><thead><row><entry>Head</entry></row></thead><tbody><row><entry>Cell</entry></row></tbody></tgroup></table>
<codeblock>fixture code</codeblock>
</body></topic>`,
  docDir: repoRoot,
  keyMap: new Map(),
  asWebviewUri: (p) => p,
  headingLevel: 1,
  uiLanguage: 'en',
}).html;

/** The sidebar rows the snapshot's tree is built from -- exactly
 *  templateSnapshot's FIXTURE_NAV_MANIFEST, which is what the chrome script
 *  derives the menu and breadcrumb from. Kept here as data because the two
 *  places must stay in step: the active row is the one whose branch the header
 *  highlights. */
const WH_NAV_ROWS = [
  { depth: 0, label: 'Getting Started', linked: true, active: true },
  { depth: 1, label: 'Installation', linked: true, active: false },
  { depth: 1, label: 'Quick Start', linked: true, active: false },
  { depth: 0, label: 'Reference', linked: true, active: false },
  { depth: 1, label: 'API', linked: true, active: false },
];

/**
 * The top menu and the breadcrumb are not in the shell markup -- the webview
 * script builds them from the sidebar at runtime. A snapshot without them would
 * show two empty bars, and nothing could be asserted about the header a template
 * is supposed to be able to style, so the real script's own pure builders run
 * here (the same way src/test/editor/webhelpChromeScript.test.ts drives them)
 * and the result is injected into the page the way update() does.
 */
function webhelpChrome(): { menuHtml: string; crumbHtml: string } {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    'document',
    'MutationObserver',
    `${getWebhelpChromeScript({ crumbLabel: 'Breadcrumb' })}\nreturn { webhelpChromeModel, webhelpChromeHtml };`,
  ) as (d: unknown, m: unknown) => {
    webhelpChromeModel(rows: typeof WH_NAV_ROWS): unknown;
    webhelpChromeHtml(m: unknown): { menuHtml: string; crumbHtml: string };
  };
  const api = factory({ body: { classList: { contains: () => false } }, addEventListener: () => {} }, undefined);
  return api.webhelpChromeHtml(api.webhelpChromeModel(WH_NAV_ROWS));
}

/** Opens a webhelp snapshot with the client-generated chrome written in, so the
 *  header and breadcrumb are the ones a reader sees rather than empty bars. */
async function openWebhelpSnapshot(page: Page, tmp: string, name: string, html: string): Promise<void> {
  await openSnapshot(page, tmp, name, html);
  const chrome = webhelpChrome();
  await page.evaluate((c) => {
    const menu = document.querySelector('.wh_top_menu');
    const crumb = document.querySelector('.wh_breadcrumb');
    if (menu) menu.innerHTML = c.menuHtml;
    if (crumb) crumb.innerHTML = c.crumbHtml;
  }, chrome);
}

describe('site/book template visual check (real Chromium)', function () {
  this.timeout(30000);
  let browser: Browser;
  let tmpDir: string;

  before(async () => {
    browser = await chromium.launch();
    tmpDir = mkdtempSync(join(tmpdir(), 'dita-template-visual-'));
    mkdirSync(screenshotDir, { recursive: true });
  });

  after(async () => {
    // before can die before either variable is assigned -- Chromium not
    // downloaded yet is the everyday case (chromium.launch throws before
    // `browser =` lands, leaving tmpDir unassigned too). Cleaning up
    // unconditionally here buried that real failure under a TypeError from
    // this hook (and would trip over the undefined tmpDir next), so guard
    // both and let the launch error stand alone.
    if (browser) await browser.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('kill test: a template that overrides content-visibility is caught', async () => {
    // A hand-built template, not one of the shipped ones -- its css directly
    // does the thing README tells template authors not to do. If this
    // assertion did not fail here, it would not be trustworthy against the
    // real built-ins checked below either.
    const badTemplate: SiteTemplate = {
      id: 'kill-test-bad',
      names: { '': 'Kill Test' },
      dom: 'own',
      defaultDark: false,
      outline: false,
      css: ['/virtual/bad.css'],
      dir: '/virtual',
      builtin: false,
    };
    const badReadFile = () => '.book-entry { content-visibility: visible !important; }';
    const html = buildTemplateSnapshotHtml({ baseCss, template: badTemplate, readFile: badReadFile, toUri, mode: 'book', dark: false });

    const page = await browser.newPage();
    try {
      await openSnapshot(page, tmpDir, 'kill-test-bad', html);
      const value = await bookEntryContentVisibility(page);
      assert.notStrictEqual(value, 'auto', 'expected the deliberately-bad template to actually break content-visibility (if this fails, the check below cannot be trusted)');
    } finally {
      await page.close();
    }
  });

  const { templates } = discoverTemplates([{ dir: join(repoRoot, 'media', 'templates'), builtin: true }]);
  assert.ok(templates.length >= 3, 'expected the three built-in templates to be discovered from media/templates');

  for (const template of templates) {
    for (const mode of ['site', 'book'] as const) {
      for (const dark of [false, true]) {
        const label = `${template.id} / ${mode} / ${dark ? 'dark' : 'light'}`;

        it(`${label}: renders without breaking content-visibility, and a header/footer (if any) is visible`, async () => {
          const html = buildTemplateSnapshotHtml({ baseCss, compatCss, template, readFile, toUri, mode, dark });
          const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
          try {
            await openSnapshot(page, tmpDir, `${template.id}-${mode}-${dark ? 'dark' : 'light'}`, html);

            const value = await bookEntryContentVisibility(page);
            assert.strictEqual(value, 'auto', `${label}: template css must not override .book-entry's content-visibility`);

            if (template.header) {
              const box = await page.$eval('.tpl-header', (el) => el.getBoundingClientRect());
              assert.ok(box.height > 0, `${label}: header is present in the descriptor but rendered with zero height`);
              const topbarBottom = await page.$eval('#__topbar', (el) => el.getBoundingClientRect().bottom);
              assert.ok(box.top >= topbarBottom - 1, `${label}: template header overlaps the toolbar top bar`);
            }

            if (template.footer) {
              const box = await page.$eval('.tpl-footer', (el) => el.getBoundingClientRect());
              assert.ok(box.height > 0, `${label}: footer is present in the descriptor but rendered with zero height`);
            }

            const screenshotPath = join(screenshotDir, `${template.id}-${mode}-${dark ? 'dark' : 'light'}.png`);
            await page.screenshot({ path: screenshotPath });
          } finally {
            await page.close();
          }
        });
      }
    }
  }

  it('the same template looks different in light vs dark (its dark palette actually applies)', async () => {
    for (const template of templates) {
      const lightHtml = buildTemplateSnapshotHtml({ baseCss, compatCss, template, readFile, toUri, mode: 'site', dark: false });
      const darkHtml = buildTemplateSnapshotHtml({ baseCss, compatCss, template, readFile, toUri, mode: 'site', dark: true });

      const page = await browser.newPage();
      try {
        await openSnapshot(page, tmpDir, `${template.id}-cmp-light`, lightHtml);
        const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        await openSnapshot(page, tmpDir, `${template.id}-cmp-dark`, darkHtml);
        const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        assert.notStrictEqual(lightBg, darkBg, `${template.id}: expected a different body background between the light and dark run`);
      } finally {
        await page.close();
      }
    }
  });
});

/* ===========================================================================
 * Route B (webhelp DOM), milestone 3 step 11.
 *
 * The static half of this check -- every selector of the acceptance template's
 * css matched against markup the real renderer emitted -- runs in `npm test`
 * without a browser (src/test/editor/webhelpContractTemplate.test.ts). What is
 * here is the other half: that a real layout engine applies the three sheets in
 * the promised order, so a hook a template reaches for by name is not merely
 * present in the DOM but painted the way the template says.
 *
 * Two templates are opened, both from test-dita-file/manual/templates (never
 * bundled into the extension):
 *   - webhelp-plain: an empty template sheet. Whatever styling appears here
 *     comes from webhelp-compat.css alone, which is §2.3's "usable default
 *     layout and theme surface" promise -- and it is the contrast that makes
 *     the next template's assertions mean something.
 *   - webhelp-contract: the acceptance template, whose sheet styles the contract
 *     by name. Each region gets a border colour no other sheet uses, so the
 *     colour read back IS the proof that the hook name resolved.
 * ------------------------------------------------------------------------ */
describe('webhelp DOM visual check (real Chromium, route B M3-11)', function () {
  this.timeout(60000);
  let browser: Browser;
  let tmpDir: string;

  before(async () => {
    browser = await chromium.launch();
    tmpDir = mkdtempSync(join(tmpdir(), 'dita-webhelp-visual-'));
    mkdirSync(screenshotDir, { recursive: true });
  });

  after(async () => {
    if (browser) await browser.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  const manual = discoverTemplates([{ dir: join(repoRoot, 'test-dita-file', 'manual', 'templates'), builtin: false }]);
  const acceptance = manual.templates.find((t) => t.id === 'webhelp-contract');
  const plain = manual.templates.find((t) => t.id === 'webhelp-plain');
  assert.ok(acceptance && plain, 'both webhelp manual templates must be discoverable');

  /** The content root for every webhelp snapshot: the real renderer's topic,
   *  plus the fixture book entry the content-visibility invariant is read from.
   *  Kept in one string so the same page is what site, landing-adjacent and book
   *  runs all open. */
  const contentHtml = `${WH_TOPIC_HTML}\n<div class="ditamap-book"><div class="book-entry" id="fixture-book-entry"><h2>Installation</h2><p>Fixture book entry.</p></div></div>`;

  /** Builds and opens one webhelp snapshot: the acceptance (or plain) template,
   *  site or book, light or dark, topic page or landing page. */
  async function open(t: SiteTemplate, kind: 'topic' | 'landing' | 'book', dark: boolean): Promise<Page> {
    const options: SnapshotOptions = {
      baseCss,
      compatCss,
      template: t,
      readFile,
      toUri,
      mode: kind === 'book' ? 'book' : 'site',
      dark,
      landingPage: kind === 'landing',
      contentHtml,
    };
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await openWebhelpSnapshot(page, tmpDir, `${t.id}-${kind}-${dark ? 'dark' : 'light'}`, buildTemplateSnapshotHtml(options));
    await page.screenshot({ path: join(screenshotDir, `${t.id}-${kind}-${dark ? 'dark' : 'light'}.png`) });
    return page;
  }

  it('webhelp-plain: the compat sheet alone lays the page out (the §2.3 default)', async () => {
    const page = await open(plain!, 'topic', false);
    try {
      // The shell is a column of bars and three flexible columns -- that is
      // webhelp-compat.css talking, since this template's sheet is empty.
      assert.strictEqual(await computed(page, 'body', 'flex-direction'), 'column', 'body must be a column: the compat layer owns the page frame');
      // The contract's own theme surface, at its shipped light defaults.
      assert.strictEqual(await computed(page, 'header.wh_header', 'background-color'), 'rgb(43, 108, 176)', '#2b6cb0 is --header-bg-color in webhelp-compat.css');
      assert.strictEqual(await computed(page, 'nav#wh_publication_toc', 'width'), '280px', 'the toc column is the compat sheet\'s 280px');
      assert.ok(!(await computed(page, 'body', 'font-family')).includes('Georgia'), 'an empty template sheet must not be styling anything');
      // The scroller invariant the smoke-test defect was about (see
      // src/test/media/webhelpScroller.test.ts for the css tripwires).
      assert.strictEqual(await computed(page, '#dita-content-root', 'overflow-y'), 'auto');
      assert.strictEqual(await computed(page, '#wh_topic_body', 'overflow'), 'hidden', 'styles.css pins the topic column as a non-scroller');
    } finally {
      await page.close();
    }
  });

  it('webhelp-contract: every region paints the colour its own sheet declares, with no !important', async () => {
    const page = await open(acceptance!, 'topic', false);
    try {
      const border = async (sel: string, side: string) => (await computed(page, sel, `border-${side}-color`)) + '/' + (await computed(page, sel, `border-${side}-width`));

      // Region colours, one per hook family -- each value comes from the hook
      // named in the selector, so a renamed hook stops the assertion.
      assert.strictEqual(await border('header.wh_header', 'bottom'), 'rgb(26, 95, 180)/4px', 'header');
      assert.strictEqual(await border('nav.wh_tools', 'bottom'), 'rgb(193, 102, 43)/4px', 'tools');
      assert.strictEqual(await border('nav#wh_publication_toc', 'right'), 'rgb(97, 53, 131)/4px', 'publication toc');
      assert.strictEqual(await border('nav#wh_topic_toc', 'left'), 'rgb(15, 124, 124)/4px', 'on-this-page outline');
      assert.strictEqual(await border('footer.wh_footer', 'top'), 'rgb(160, 48, 48)/4px', 'footer');
      assert.strictEqual(await border('#wh_topic_body', 'left'), 'rgb(47, 107, 63)/4px', 'topic body');
      assert.strictEqual(await computed(page, '#wh_topic_container', 'outline-style'), 'dashed', 'page container');

      // The header and breadcrumb the client script fills in.
      assert.strictEqual(await border('.wh_navigation_links a', 'top'), 'rgb(193, 102, 43)/1px', 'prev/next links');
      assert.strictEqual(await computed(page, '.wh_breadcrumb', 'text-transform'), 'uppercase', 'breadcrumb is filled by the webview script');
      assert.strictEqual(await computed(page, '.wh_top_menu li.active > a', 'background-color'), 'rgb(20, 48, 77)', 'the active top-menu item, from the menu the script injects');

      // The logo the shell emits for an .opt descriptor that names one.
      assert.strictEqual(await computed(page, '.wh_logo img', 'max-height'), '34px', '.wh_logo is an optional hook the template styles');

      // The sidebar's double-classed rows (§2.2): behaviour keys off site-nav-*,
      // the template css keys off topicref -- both have to be on the same node.
      assert.strictEqual(await computed(page, 'li.topicref.has-children > .site-nav-link', 'font-weight'), '600', 'li.topicref and .site-nav-link on one node');
      assert.strictEqual(await computed(page, 'li.topicref.active > .site-nav-link', 'color'), 'rgb(97, 53, 131)', 'the active row, through the topicref name');
      assert.strictEqual(await computed(page, 'li.topicref.expanded', 'background-color'), 'rgb(247, 242, 251)', 'the expanded state, light palette');

      // M2's body-content classes, reached by their org.dita.html5 names.
      assert.strictEqual(await border('.title.topictitle1', 'bottom'), 'rgb(20, 48, 77)/3px', 'h1.topictitle1');
      assert.strictEqual(await computed(page, '.title.sectiontitle', 'color'), 'rgb(47, 107, 63)', '.sectiontitle');
      assert.strictEqual(await computed(page, 'p.shortdesc', 'font-style'), 'italic', '.shortdesc');
      assert.strictEqual(await computed(page, '.note .note__title', 'letter-spacing'), '0.8px', '.note__title (the template\'s 0.05em, over the 16px it inherits)');
      assert.strictEqual(await border('pre.pre.codeblock', 'left'), 'rgb(124, 29, 111)/4px', 'pre.codeblock');
      assert.strictEqual(await computed(page, '.table.cals-table thead .entry', 'background-color'), 'rgb(232, 242, 232)', 'cals table head cell');

      // §2.3's cascade promise, read from the template side: an unlayered sheet
      // that sets nothing with !important still beats both layers.
      assert.ok((await computed(page, 'body', 'font-family')).includes('Georgia'), 'the template sheet must override dv-base --body-font without !important');
      assert.strictEqual(await computed(page, '.wh_topic_content', 'padding-top'), '16px', 'wh-compat padding survives, so the sheet is not simply winning everything');

      // The route B promise to route A: nothing here may break the base sheet.
      assert.strictEqual(await bookEntryContentVisibility(page), 'auto');
    } finally {
      await page.close();
    }
  });

  it('webhelp-contract: the contract variables drive the compat sheet, and the dark variant applies', async () => {
    const light = await open(acceptance!, 'topic', false);
    let lightBg = '';
    let lightToc = '';
    let lightExpanded = '';
    try {
      lightBg = await computed(light, 'body', 'background-color');
      lightToc = await computed(light, 'nav#wh_publication_toc', 'background-color');
      lightExpanded = await computed(light, 'li.topicref.expanded', 'background-color');
      // The template only sets custom properties here; every consumer is a
      // webhelp-compat.css rule. That is what "a template can restyle the base
      // sheet without touching a selector" has to mean in practice.
      assert.strictEqual(lightBg, 'rgb(255, 255, 255)', '--body-bg-color, at the compat default (the template does not override it)');
      assert.strictEqual(lightToc, 'rgb(243, 232, 255)', '--toc-bg-color, overridden by the template to #f3e8ff');
    } finally {
      await light.close();
    }

    const dark = await open(acceptance!, 'topic', true);
    try {
      assert.strictEqual(await computed(dark, 'body', 'background-color'), 'rgb(30, 30, 30)', 'the compat dark --body-bg-color');
      assert.strictEqual(await computed(dark, 'header.wh_header', 'background-color'), 'rgb(29, 11, 38)', 'the template dark --header-bg-color (#1d0b26)');
      assert.strictEqual(await computed(dark, 'header.wh_header', 'color'), 'rgb(240, 166, 255)', 'the template dark --header-color');
      assert.strictEqual(await computed(dark, 'nav#wh_publication_toc', 'background-color'), 'rgb(36, 16, 49)', 'the template dark --toc-bg-color (#241031)');
      assert.strictEqual(await computed(dark, 'li.topicref.expanded', 'background-color'), 'rgb(42, 23, 53)', 'the template dark variant of the expanded row');
      assert.notStrictEqual(lightBg, await computed(dark, 'body', 'background-color'), 'light vs dark body background');
      assert.notStrictEqual(lightToc, await computed(dark, 'nav#wh_publication_toc', 'background-color'), 'light vs dark toc background');
      assert.notStrictEqual(lightExpanded, await computed(dark, 'li.topicref.expanded', 'background-color'), 'light vs dark expanded row');
    } finally {
      await dark.close();
    }
  });

  it('webhelp-contract landing page: the home hooks paint, over both body tokens', async () => {
    // Both palettes are checked: the light tile background and the template's
    // dark --tile-bg-color override, read back off the same compat-sheet rule,
    // show the home hooks work under html.vscode-dark too.
    for (const dark of [false, true]) {
      const page = await open(acceptance!, 'landing', dark);
      try {
        // The additive token: a landing page is a wh_main_page AND a
        // wh_topic_page, which is what keeps the shell rules above working here
        // (webhelpShell.ts's mainPage comment).
        assert.ok((await page.$eval('body', (el) => el.className)).includes('wh_topic_page wh_main_page'), 'both tokens on the landing body');

        // The template's tile sheet must beat the compat sheet's tile rules --
        // same nodes, layered vs unlayered, template wins.
        assert.strictEqual(await computed(page, '.wh_tile', 'border-top-color'), 'rgb(184, 134, 11)', 'template border on .wh_tile');
        assert.strictEqual(await computed(page, '.wh_tile', 'border-radius'), '0px', 'template radius beats compat 4px');
        assert.strictEqual(await computed(page, '.wh_tile', 'background-color'), dark ? 'rgb(51, 36, 12)' : 'rgb(255, 243, 205)', '--tile-bg-color, set by the template for each palette, read by the compat rule');
        assert.match(await computed(page, '.wh_tile', 'box-shadow'), /80,\s*0,\s*80/, '--elevation-shadow, set by the template');
        assert.strictEqual(await computed(page, '.wh_tiles', 'gap'), '24px', 'template gap beats compat 1.25rem');
        assert.strictEqual(await computed(page, '.wh_tile_text', 'text-transform'), 'uppercase', 'template rule on the tile meta line');
        assert.strictEqual(await computed(page, '.wh_tile_text', 'opacity'), '1', 'template opacity beats compat 0.75');
        assert.strictEqual(await computed(page, '.site-home-title', 'border-bottom-style'), 'double', 'the heading, styled through the own-mode class');
        // The tiles are still the renderer's own markup, so the click delegation
        // (siteNavScripts.ts) keeps working: data-site-target must be there.
        assert.ok(await page.$('.wh_tile[data-site-target]'), 'a wh_tile is still a .site-home-tile with its target');
      } finally {
        await page.close();
      }
    }
  });

  it('webhelp-contract in book mode keeps the base sheet\'s content-visibility (只加不减)', async () => {
    for (const dark of [false, true]) {
      const page = await open(acceptance!, 'book', dark);
      try {
        assert.strictEqual(await bookEntryContentVisibility(page), 'auto', `book mode, ${dark ? 'dark' : 'light'}`);
        assert.strictEqual(await computed(page, 'nav#wh_publication_toc', 'border-right-width'), '4px', 'the shell is still the webhelp shell in book mode');
      } finally {
        await page.close();
      }
    }
  });
});
