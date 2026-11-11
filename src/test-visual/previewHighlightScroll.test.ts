/**
 * Real-Chromium check of the single-topic preview's highlightLine scroll: what
 * the source editor's cursor (a go-to-definition jump above all) makes the
 * preview do on a page with many lazy images and a section several screens tall.
 *
 * jsdom has no layout, so topicHighlightWiring.test.ts can only pin the
 * decisions (which element, where it should sit, when to correct). This runs
 * the real generated webview script against the real renderer's markup and
 * reads where the target ACTUALLY ends up. Like visual.test.ts it needs the
 * downloaded Chromium (`npm run playwright:install`) and is not part of
 * `npm test`; run it with `npm run test:visual`.
 *
 * The bug it guards: clicking a link to a later <section> centered the whole
 * section (its middle on screen, its heading screens above), and a smooth
 * scroll aimed before the lazy images shrank landed hundreds of pixels off on
 * top of that. Clicking back and forth between the reference and the section
 * then alternated between the reference and the off-target landing.
 */
import * as assert from 'assert';
import Module = require('module');
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { deflateSync } from 'zlib';
import { chromium, type Browser, type Page } from 'playwright';
import { renderTopicXml } from '../editor/ditaRenderUtils';

const repoRoot = resolve(__dirname, '..', '..');
const baseCss = readFileSync(join(repoRoot, 'media', 'styles.css'), 'utf-8');

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
/** A solid-colour PNG, so the images really decode (and really shrink) in the page. */
function solidPng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The real webview script, loaded with `vscode` stubbed for the one call it makes at load. */
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

function buildDoc(): { xml: string } {
  const lines = ['<topic id="t"><title>Doc</title><body>'];
  lines.push('<p id="r">Jump to <xref href="#t/sec">the target</xref> now.</p>');
  for (let i = 0; i < 30; i++) lines.push(`<p><image href="img${i % 6}.png"/></p>`);
  lines.push('<section id="sec"><title>Target section</title>');
  for (let i = 0; i < 14; i++) lines.push(`<p>Paragraph ${i}. ${'Lorem ipsum dolor sit amet. '.repeat(12)}</p>`);
  lines.push('</section></body></topic>');
  return { xml: lines.join('\n') };
}

describe('single-topic preview highlight scroll (real Chromium)', function () {
  this.timeout(60000);
  let browser: Browser;
  let tmpDir: string;
  let page: Page;

  before(async () => {
    browser = await chromium.launch();
    tmpDir = mkdtempSync(join(tmpdir(), 'dita-highlight-scroll-'));
    for (let i = 0; i < 6; i++) writeFileSync(join(tmpDir, `img${i}.png`), solidPng(800, 500, [40 + i * 30, 120, 200 - i * 20]));
    const html = renderTopicXml({
      xml: buildDoc().xml,
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

  async function pos(sel: string): Promise<{ line: number; col: number }> {
    return page.$eval(sel, (el) => ({
      line: parseInt(el.getAttribute('data-line') as string, 10),
      col: parseInt(el.getAttribute('data-start-col') as string, 10),
    }));
  }
  async function highlight(at: { line: number; col: number }): Promise<void> {
    await page.evaluate((a) => window.postMessage({ type: 'highlightLine', line: a.line, col: a.col }, '*'), at);
    await page.waitForTimeout(1800); // smooth scroll + settle
  }
  async function top(sel: string): Promise<number> {
    return page.$eval(sel, (el) => Math.round(el.getBoundingClientRect().top));
  }

  it('lands a tall section by its top, every time, going back and forth with the reference', async () => {
    const ref = await pos('#r, p.p');
    const sec = await pos('section');
    for (let round = 0; round < 3; round++) {
      await highlight(ref);
      await highlight(sec);
      const t = await top('section');
      // 20% of the 700px viewport is the target; the first round is the one the
      // lazy images used to throw off by ~500px, the rest the centering bug.
      assert.ok(t >= 100 && t <= 180, `round ${round}: the section's top landed at ${t}px, expected near 140px`);
    }
  });

  async function post(at: { line: number; col: number }): Promise<void> {
    await page.evaluate((a) => window.postMessage({ type: 'highlightLine', line: a.line, col: a.col }, '*'), at);
  }

  it('ends at the target when the click on the link and the jump it triggers arrive a moment apart', async () => {
    // A click on a link places the cursor at the link, and the go-to-
    // definition jump follows. The second highlight used to find the target
    // "on screen" (the page was only just leaving it), ask for nothing, and
    // let the scroll toward the link finish -- the preview ended at the link.
    const ref = await pos('#r, p.p');
    const sec = await pos('section');
    for (const gap of [60, 150, 400]) {
      await highlight(sec); // park at the target
      const parked = await page.evaluate(() => Math.round(scrollY));
      await post(ref);
      await page.waitForTimeout(gap);
      await post(sec);
      let lowest = parked;
      const t0 = Date.now();
      while (Date.now() - t0 < 2200) {
        lowest = Math.min(lowest, await page.evaluate(() => Math.round(scrollY)));
        await page.waitForTimeout(40);
      }
      const end = await page.evaluate(() => Math.round(scrollY));
      assert.ok(Math.abs(end - parked) <= 12, `gap ${gap}ms: ended at ${end}px, expected the target at ${parked}px`);
      if (gap <= 150) {
        assert.ok(parked - lowest <= 40, `gap ${gap}ms: the preview slid ${parked - lowest}px toward the link before turning around`);
      }
    }
  });

  it('puts a short far-away element in the middle of the screen as before', async () => {
    await highlight({ line: 1, col: 0 });
    const target = await page.$$eval('section p', (els) => {
      const el = els[10];
      return { line: parseInt(el.getAttribute('data-line') as string, 10), col: parseInt(el.getAttribute('data-start-col') as string, 10) };
    });
    await highlight(target);
    const { t, want } = await page.$$eval('section p', (els) => {
      const r = els[10].getBoundingClientRect();
      return { t: Math.round(r.top), want: Math.round((innerHeight - r.height) / 2) };
    });
    assert.ok(Math.abs(t - want) <= 12, `centered paragraph at ${t}px, expected near ${want}px`);
  });

  it('does not report its own scrolling, and still reports the reader\'s', async () => {
    await page.evaluate(() => ((window as unknown as { __msgs: unknown[] }).__msgs.length = 0));
    await highlight(await pos('section'));
    const own = await page.evaluate(() => (window as unknown as { __msgs: unknown[] }).__msgs.length);
    assert.strictEqual(own, 0, 'a programmatic scroll leaked out as scrollSync');
    await page.mouse.move(400, 300);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(900);
    const theirs = await page.evaluate(() => (window as unknown as { __msgs: { type: string }[] }).__msgs.map((m) => m.type));
    assert.ok(theirs.includes('scrollSync'), 'the reader\'s own scroll was swallowed');
  });

  it('stays at the revealed line when the source scrolls inside the highlight settle window', async () => {
    // Scrolling the source editor right after a jump posts revealLine for the
    // editor's new top line. The highlight correction is still pending at that
    // point, so correcting on the reveal's own scrollend pulled the page back
    // to the section: the preview followed the source, then snapped away from
    // it, once per source scroll for the rest of the 3s window.
    await highlight(await pos('section')); // parked at the top edge, correction still pending
    const parked = await page.evaluate(() => Math.round(scrollY));
    const reveals = await page.$$eval('section p', (els) => {
      const el = els[6];
      return {
        line: parseInt(el.getAttribute('data-line') as string, 10),
        // Where the page has to end up: block:'start' puts this paragraph's
        // top at 0, so scrollY must equal its document offset.
        want: Math.round(scrollY + el.getBoundingClientRect().top),
      };
    });
    assert.ok(Math.abs(reveals.want - parked) > 400, 'the reveal target has to sit well away from the parked section');
    await page.evaluate((line) => window.postMessage({ type: 'revealLine', line }, '*'), reveals.line);
    await page.waitForTimeout(1200); // past the smooth scroll, its scrollend and any correction
    const end = await page.evaluate(() => Math.round(scrollY));
    assert.ok(
      Math.abs(end - reveals.want) <= 12,
      `ended at ${end}px, expected the revealed line at ${reveals.want}px (back at the highlight would be ${parked}px)`,
    );
  });
});
