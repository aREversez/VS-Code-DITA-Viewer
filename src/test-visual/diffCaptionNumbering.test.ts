/**
 * Figure / table numbering in the diff panel, in real Chromium.
 *
 * The preview resets its counters on `article.topic`; the diff panel renders a
 * topic as a run of separate blocks with no article around them, so without a
 * reset of its own every figure instantiated a fresh counter and read
 * "Figure 1." (every table "Table 1."). Each column is its own document, so
 * each column resets. The real engine output (diffTopics + renderDiffColumns)
 * is loaded with the real stylesheets inside the panel's own column markup and
 * the generated text is read back through the DevTools DOM snapshot, as in
 * captionNumbering.test.ts. Needs the downloaded Chromium; `npm run test:visual`.
 */
import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { chromium, type Browser } from 'playwright';
import { renderElement, type RenderContext } from '@dita-viewer/core';
import { diffTopics, type DiffTopicsInput } from '../editor/ditaDiffEngine';
import { renderDiffColumns, diffColumnLangAttr } from '../editor/ditaDiffRender';

const media = join(resolve(__dirname, '..', '..'), 'media');
const css = readFileSync(join(media, 'styles.css'), 'utf-8') + readFileSync(join(media, 'diff-styles.css'), 'utf-8');

const ctx0: RenderContext = { headingLevel: 1, asWebviewUri: (p) => p, documentDir: '/tmp' };
const renderBlockFactory = (() => (node: never, parentBaseType: string, headingLevel: number) =>
  renderElement(node, { ...ctx0, headingLevel, parentBaseType })) as unknown as DiffTopicsInput['renderBlockFactory'];

const tbl = (t: string, c: string): string =>
  `<table><title>${t}</title><tgroup cols="1"><tbody><row><entry>${c}</entry></row></tbody></tgroup></table>`;
const topic = (c: string): string =>
  `<?xml version="1.0"?><topic id="t"><title>S</title><body>` +
  `<fig><title>F1</title><image href="a.png"/></fig>${tbl('T1', c)}<p>mid</p>` +
  `<fig><title>F2</title><image href="a.png"/></fig>${tbl('T2', 'same')}</body></topic>`;

describe('figure and table numbering in the diff panel (real Chromium)', function () {
  this.timeout(60000);
  let browser: Browser;
  before(async () => {
    browser = await chromium.launch();
  });
  after(async () => {
    if (browser) await browser.close();
  });

  it('counts up inside each column instead of reading 1 everywhere', async () => {
    const result = diffTopics({
      leftXml: topic('a'),
      rightXml: topic('b'),
      leftDocDir: '/tmp',
      rightDocDir: '/tmp',
      renderBlockFactory,
    } as DiffTopicsInput);
    const cols = renderDiffColumns(result.rows);
    const page = await browser.newPage();
    try {
      await page.setContent(
        `<!doctype html><html><head><style>${css}</style></head><body><div class="diff-columns">` +
          `<div class="diff-col diff-col--left">${cols.left}</div>` +
          `<div class="diff-col diff-col--right">${cols.right}</div></div></body></html>`,
      );
      const cdp = await page.context().newCDPSession(page);
      const snap = (await cdp.send('DOMSnapshot.captureSnapshot', { computedStyles: [] })) as {
        strings: string[];
        documents: { layout: { text: number[] } }[];
      };
      const tk = snap.documents.flatMap((d) => d.layout.text).filter((t) => t >= 0).map((t) => snap.strings[t]);
      const out: string[] = [];
      for (let i = 0; i + 3 < tk.length; i++) {
        if (/^(Figure|Table) $/.test(tk[i]) && /^\d+$/.test(tk[i + 1]) && tk[i + 2] === '. ') {
          out.push(`${tk[i]}${tk[i + 1]}. ${tk[i + 3]}`);
          i += 3;
        }
      }
      const column = ['Figure 1. F1', 'Table 1. T1', 'Figure 2. F2', 'Table 2. T2'];
      assert.deepStrictEqual(out, [...column, ...column]);
    } finally {
      await page.close();
    }
  });

  it('labels follow each column\'s topic language, not the host page\'s', async () => {
    // The host page declares a fixed lang="en"; only the column's own lang
    // (from that side's xml:lang) can make :lang(zh) / :lang(zh-TW) match.
    // The two sides deliberately differ to prove the attribute is per column.
    const zh = (lang: string, c: string): string =>
      `<?xml version="1.0"?><topic id="t" xml:lang="${lang}"><title>S</title><body>` +
      `<fig><title>F1</title><image href="a.png"/></fig>${tbl('T1', c)}</body></topic>`;
    const result = diffTopics({
      leftXml: zh('zh-CN', 'a'),
      rightXml: zh('zh-TW', 'b'),
      leftDocDir: '/tmp',
      rightDocDir: '/tmp',
      renderBlockFactory,
    } as DiffTopicsInput);
    const cols = renderDiffColumns(result.rows);
    const page = await browser.newPage();
    try {
      await page.setContent(
        `<!doctype html><html lang="en"><head><style>${css}</style></head><body><div class="diff-columns">` +
          `<div class="diff-col diff-col--left"${diffColumnLangAttr(result.leftLang)}>${cols.left}</div>` +
          `<div class="diff-col diff-col--right"${diffColumnLangAttr(result.rightLang)}>${cols.right}</div></div></body></html>`,
      );
      const cdp = await page.context().newCDPSession(page);
      const snap = (await cdp.send('DOMSnapshot.captureSnapshot', { computedStyles: [] })) as {
        strings: string[];
        documents: { layout: { text: number[] } }[];
      };
      const tk = snap.documents.flatMap((d) => d.layout.text).filter((t) => t >= 0).map((t) => snap.strings[t]);
      const out: string[] = [];
      for (let i = 0; i + 3 < tk.length; i++) {
        if (/^(Figure|Table|图|表|圖) $/.test(tk[i]) && /^\d+$/.test(tk[i + 1]) && tk[i + 2] === '. ') {
          out.push(`${tk[i]}${tk[i + 1]}. ${tk[i + 3]}`);
          i += 3;
        }
      }
      assert.deepStrictEqual(out, ['图 1. F1', '表 1. T1', '圖 1. F1', '表 1. T1']);
    } finally {
      await page.close();
    }
  });
});
