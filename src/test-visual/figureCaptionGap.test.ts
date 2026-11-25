/**
 * Real-Chromium check that a figure's caption sits right under its picture, and
 * a table's caption right above its table, in the LIVE preview.
 *
 * The preview does not show the renderer's markup as it is: enhanceImages() in
 * the webview script wraps every image in an inline-block span.dita-img-wrap,
 * after which a rule written against `figure > img.image` matches nothing and
 * the image-break margin (1rem) stays inside the wrapper -- a 30px gap where the
 * stylesheet promises about 6px. captionNumbering.test.ts pins the selectors;
 * this runs the real script over the real markup and measures the outcome, which
 * a page.setContent of raw renderer output would bypass. Needs the downloaded
 * Chromium (`npm run playwright:install`); run with `npm run test:visual`.
 */
import * as assert from 'assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import Module from 'module';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { chromium, type Browser, type Page } from 'playwright';
import { renderTopicXml } from '../editor/ditaRenderUtils';

const baseCss = readFileSync(join(resolve(__dirname, '..', '..'), 'media', 'styles.css'), 'utf-8');

function loadWebviewScript(): string {
  const M = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
  const realLoad = M._load;
  M._load = function (request: string, ...rest: unknown[]) {
    if (request === 'vscode') return { l10n: { t: (s: string) => s } };
    return realLoad.call(this, request, ...rest);
  };
  try {
    const mod = require('../editor/webview/topicScript') as { getWebviewScript(): string };
    return mod.getWebviewScript();
  } finally {
    M._load = realLoad;
  }
}

const xml =
  '<topic id="t"><title>T</title><body>' +
  '<fig id="brk"><title>Break</title><image href="p.svg" placement="break" width="200" height="100"/></fig>' +
  '<fig id="inl"><title>Inline</title><image href="p.svg" width="200" height="100"/></fig>' +
  '<table id="tb"><title>Sizes</title><tgroup cols="1"><tbody><row><entry>cell</entry></row></tbody></tgroup></table>' +
  '<table id="td"><title>Torque</title><desc>Maximum values for each fastener size.</desc><tgroup cols="1"><tbody><row><entry>cell</entry></row></tbody></tgroup></table>' +
  '</body></topic>';

describe('figure and table caption spacing in the live preview (real Chromium)', function () {
  this.timeout(60000);
  let browser: Browser;
  let tmpDir: string;
  let page: Page;

  before(async () => {
    browser = await chromium.launch();
    tmpDir = mkdtempSync(join(tmpdir(), 'dita-caption-gap-'));
    writeFileSync(
      join(tmpDir, 'p.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#9cf"/></svg>',
    );
    const html = renderTopicXml({
      xml,
      docDir: tmpDir,
      keyMap: new Map(),
      asWebviewUri: (p) => p,
      headingLevel: 1,
      uiLanguage: 'en',
    }).html;
    const base = 'file://' + tmpDir.replace(/\\/g, '/') + '/';
    const shim =
      'window.__msgs=[];window.acquireVsCodeApi=function(){return{postMessage:function(m){window.__msgs.push(m);},getState:function(){},setState:function(){}}};';
    writeFileSync(
      join(tmpDir, 'page.html'),
      `<!doctype html><html><head><meta charset="utf-8"><base href="${base}"><style>${baseCss}</style></head>` +
        `<body><div id="dita-content-root">${html}</div><script>${shim}</script><script>${loadWebviewScript()}</script></body></html>`,
    );
    page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await page.goto(base + 'page.html');
    await page.waitForTimeout(400);
  });

  after(async () => {
    if (browser) await browser.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('the webview script has wrapped the images (so this test exercises the live DOM)', async () => {
    assert.strictEqual(await page.locator('figure .dita-img-wrap').count(), 2);
  });

  for (const id of ['brk', 'inl']) {
    it(`${id}: the caption is within 8px of the picture`, async () => {
      const gap = await page.$eval(`figure#${id}`, (fig) => {
        const img = fig.querySelector('img') as HTMLElement;
        const cap = fig.querySelector('figcaption') as HTMLElement;
        return cap.getBoundingClientRect().top - img.getBoundingClientRect().bottom;
      });
      assert.ok(gap >= 0 && gap <= 8, `gap ${gap}px`);
    });
  }

  it('the wrapper hugs the image, so the hover toolbar stays on the picture', async () => {
    const [w, imgW] = await page.$eval('figure#brk', (fig) => [
      (fig.querySelector('.dita-img-wrap') as HTMLElement).getBoundingClientRect().width,
      (fig.querySelector('img') as HTMLElement).getBoundingClientRect().width,
    ]);
    assert.ok(Math.abs(w - imgW) <= 1, `wrapper ${w}px vs image ${imgW}px`);
  });

  it('the table caption is within 8px of the table', async () => {
    const gap = await page.$eval('table#tb', (t) => {
      const cap = t.querySelector('caption') as HTMLElement;
      const body = t.querySelector('tbody') as HTMLElement;
      return body.getBoundingClientRect().top - cap.getBoundingClientRect().bottom;
    });
    assert.ok(gap >= 0 && gap <= 8, `gap ${gap}px`);
  });

  // The desc follows the title inside the caption. Inline, the two ran together
  // ("Table 2. Torque Maximum values ...") and read as one sentence; it is a block
  // now, starting on the line below the title.
  it('a table desc starts on its own line, below the title, and the caption stays against the table', async () => {
    const m = await page.$eval('table#td', (t) => {
      const cap = t.querySelector('caption') as HTMLElement;
      const desc = cap.querySelector('.desc') as HTMLElement;
      const body = t.querySelector('tbody') as HTMLElement;
      const c = cap.getBoundingClientRect();
      const d = desc.getBoundingClientRect();
      return { below: d.top - c.top, gap: body.getBoundingClientRect().top - d.bottom };
    });
    assert.ok(m.below >= 12, `desc is ${m.below}px below the top of the caption (should be on a second line)`);
    assert.ok(m.gap >= 0 && m.gap <= 10, `desc to table ${m.gap}px`);
  });
});
