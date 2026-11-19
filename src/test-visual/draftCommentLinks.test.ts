/**
 * Real-Chromium check that a link inside a <draft-comment> review box stays
 * legible under every built-in template, light and dark.
 *
 * styles.css gives such a link the box's own text colour (8.68:1 light, 9.01:1
 * dark; --color-link on the light green is only 3.8:1), but that rule sits in
 * @layer dv-base and every template's css is unlayered, so a template's
 * `body[data-template="..."] #dita-content-root a { color: ... }` beats it at
 * any specificity. styles.css repeats the rule unlayered, one class stronger.
 * draftCommentStyles.test.ts pins the selector shapes that outcome depends on;
 * this asserts the outcome itself -- the computed colour, with the real
 * renderer's markup and the real template stylesheets -- so a template that
 * reached for !important, a new link state, or a different variable cannot
 * slip past a string check. Like visual.test.ts it needs the downloaded
 * Chromium (`npm run playwright:install`) and is not part of `npm test`; run
 * it with `npm run test:visual`.
 */
import * as assert from 'assert';
import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { chromium, type Browser, type Page } from 'playwright';
import { renderTopicXml } from '../editor/ditaRenderUtils';

const repoRoot = resolve(__dirname, '..', '..');
const mediaDir = join(repoRoot, 'media');
const baseCss = readFileSync(join(mediaDir, 'styles.css'), 'utf-8');
const templates = readdirSync(join(mediaDir, 'templates'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

// An xref to a section of the same topic is what the renderer turns into a real
// <a class="xref"> (an external or cross-file one is a plain span in the preview).
const xml =
  '<?xml version="1.0"?><topic id="t"><title>T</title><body>' +
  '<p>Outside <xref href="#t/s">control</xref></p>' +
  '<p>Before <draft-comment author="EBP">see <xref href="#t/s">inside</xref></draft-comment> after</p>' +
  '<draft-comment author="EBP"><p>block <xref href="#t/s">inside block</xref></p></draft-comment>' +
  '<section id="s"><title>S</title></section>' +
  '</body></topic>';

function lum(rgb: string): number {
  const [r, g, b] = (rgb.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('draft-comment links under every template (real Chromium)', function () {
  this.timeout(60000);
  let browser: Browser;
  let page: Page;
  let body: string;

  before(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
    body = renderTopicXml({ xml, docDir: repoRoot, keyMap: new Map(), asWebviewUri: (p) => p, headingLevel: 1, uiLanguage: 'en' }).html;
  });
  after(async () => {
    await browser.close();
  });

  it('finds the built-in templates', () => {
    assert.ok(templates.length >= 7, templates.join(', '));
  });

  for (const dark of [false, true]) {
    for (const name of templates) {
      it(`${name}, ${dark ? 'dark' : 'light'}: links in the box take the box text colour and stay underlined`, async () => {
        const css = readFileSync(join(mediaDir, 'templates', name, `${name}.css`), 'utf-8');
        await page.setContent(
          `<!doctype html><html class="${dark ? 'vscode-dark' : ''}"><head><style>${baseCss}</style><style>${css}</style></head>` +
            `<body data-template="${name}" class="mode-site"><div id="dita-content-root">${body}</div></body></html>`,
        );
        const links = await page.$$eval('.draft-comment a', (els) =>
          els.map((e) => {
            const s = getComputedStyle(e);
            const box = getComputedStyle(e.closest('.draft-comment') as Element);
            return { color: s.color, line: s.textDecorationLine, boxColor: box.color, boxBg: box.backgroundColor };
          }),
        );
        assert.strictEqual(links.length, 2, 'one link in the inline box, one in the block box');
        for (const l of links) {
          assert.strictEqual(l.color, l.boxColor, 'link colour is the box text colour');
          assert.ok(/underline/.test(l.line), 'still reads as a link');
          assert.ok(contrast(l.color, l.boxBg) >= 4.5, `AA contrast ${contrast(l.color, l.boxBg).toFixed(2)}`);
        }
        // Hover is a different cascade path (a:hover rules), so check it too.
        await page.hover('.draft-comment a');
        const hovered = await page.$eval('.draft-comment a', (e) => ({
          c: getComputedStyle(e).color,
          box: getComputedStyle(e.closest('.draft-comment') as Element).color,
        }));
        assert.strictEqual(hovered.c, hovered.box, 'hover keeps the box text colour');
        // The fix must not leak: a link outside the box keeps the template's own colour.
        const [outside, boxColor] = await page.evaluate(() => [
          getComputedStyle(document.querySelector('#dita-content-root p a') as Element).color,
          getComputedStyle(document.querySelector('.draft-comment') as Element).color,
        ]);
        assert.notStrictEqual(outside, boxColor, 'a link outside the box is not recoloured');
      });
    }
  }
});
