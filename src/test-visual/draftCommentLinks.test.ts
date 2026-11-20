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
    // launch() throwing (Chromium not downloaded) leaves browser undefined;
    // closing it would bury the real startup error under a TypeError. Same
    // guard as visual.test.ts.
    if (browser) await browser.close();
  });

  it('finds the built-in templates', () => {
    assert.ok(templates.length >= 7, templates.join(', '));
  });

  for (const dark of [false, true]) {
    for (const name of templates) {
      it(`${name}, ${dark ? 'dark' : 'light'}: links in the box take the box text colour and stay underlined`, async () => {
        // Load exactly the files the preview concatenates: template.json's css
        // list, in order -- not a guessed `${name}/${name}.css`, so a template
        // that splits its css cannot hide a rule from this matrix (same source
        // as the unit tripwire and buildTemplateStyleText).
        const manifest = JSON.parse(readFileSync(join(mediaDir, 'templates', name, 'template.json'), 'utf-8')) as { css: string[] };
        assert.ok(Array.isArray(manifest.css) && manifest.css.length > 0, `${name}: template.json has a css list`);
        const css = manifest.css.map((f) => readFileSync(join(mediaDir, 'templates', name, f), 'utf-8')).join('\n');
        await page.setContent(
          `<!doctype html><html class="${dark ? 'vscode-dark' : ''}"><head><style>${baseCss}</style><style>${css}</style></head>` +
            `<body data-template="${name}" class="mode-site"><div id="dita-content-root">${body}</div></body></html>`,
        );
        const links = await page.$$eval('.draft-comment a', (els) =>
          els.map((e) => {
            const s = getComputedStyle(e);
            const box = getComputedStyle(e.closest('.draft-comment') as Element);
            // Contrast baseline is the link's EFFECTIVE background: every
            // painted layer from the link up to the root, translucent ones
            // composited over what lies beneath (white canvas at the bottom).
            const parse = (c: string): number[] => (c.match(/[\d.]+/g) || []).map(Number);
            const layers: number[][] = [];
            for (let n: Element | null = e; n; n = n.parentElement) {
              const [r, g, b, a = 1] = parse(getComputedStyle(n).backgroundColor);
              if (a > 0) layers.push([r, g, b, a]);
              if (a === 1) break;
            }
            let acc = [255, 255, 255];
            for (const [r, g, b, a] of layers.reverse()) acc = [r * a + acc[0] * (1 - a), g * a + acc[1] * (1 - a), b * a + acc[2] * (1 - a)];
            const effBg = `rgb(${acc.map(Math.round).join(', ')})`;
            // Properties that hide a link without changing its computed colour,
            // on the link or anything between it and the box: the contrast of
            // colour vs background cannot see them, so each must be inert.
            const hiding: string[] = [];
            for (let n: Element | null = e; n && n !== e.closest('.draft-comment'); n = n.parentElement) {
              const cs = getComputedStyle(n);
              const who = n.tagName.toLowerCase();
              if (cs.opacity !== '1') hiding.push(`${who} opacity ${cs.opacity}`);
              if (cs.backgroundImage !== 'none') hiding.push(`${who} background-image`);
              if (cs.textShadow !== 'none') hiding.push(`${who} text-shadow`);
              if (cs.filter !== 'none') hiding.push(`${who} filter`);
              if (cs.mixBlendMode !== 'normal') hiding.push(`${who} mix-blend-mode ${cs.mixBlendMode}`);
              if (cs.webkitTextFillColor !== cs.color) hiding.push(`${who} text-fill-color`);
            }
            return { color: s.color, line: s.textDecorationLine, boxColor: box.color, effBg, hiding };
          }),
        );
        assert.strictEqual(links.length, 2, 'one link in the inline box, one in the block box');
        for (const l of links) {
          assert.strictEqual(l.color, l.boxColor, 'link colour is the box text colour');
          assert.ok(/underline/.test(l.line), 'still reads as a link');
          assert.deepStrictEqual(l.hiding, [], 'nothing hides the link outside its colour');
          assert.ok(contrast(l.color, l.effBg) >= 4.5, `AA contrast ${contrast(l.color, l.effBg).toFixed(2)}`);
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
