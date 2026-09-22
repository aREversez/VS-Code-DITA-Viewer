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
import { buildTemplateSnapshotHtml } from '../editor/templateSnapshot';

// dist-test-visual/test-visual/visual.test.js -> repo root is two levels up,
// same convention as src/test-e2e/preview.test.ts.
const repoRoot = resolve(__dirname, '..', '..');
const baseCss = readFileSync(join(repoRoot, 'media', 'styles.css'), 'utf-8');
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
    await browser.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('kill test: a template that overrides content-visibility is caught', async () => {
    // A hand-built template, not one of the shipped ones -- its css directly
    // does the thing README tells template authors not to do. If this
    // assertion did not fail here, it would not be trustworthy against the
    // real built-ins checked below either.
    const badTemplate: SiteTemplate = {
      id: 'kill-test-bad',
      names: { '': 'Kill Test' },
      defaultDark: false,
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
          const html = buildTemplateSnapshotHtml({ baseCss, template, readFile, toUri, mode, dark });
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
      const lightHtml = buildTemplateSnapshotHtml({ baseCss, template, readFile, toUri, mode: 'site', dark: false });
      const darkHtml = buildTemplateSnapshotHtml({ baseCss, template, readFile, toUri, mode: 'site', dark: true });

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
