import * as assert from 'assert';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseConrefJumpMessage, MSG_OPEN_CONREF_TARGET } from '../../editor/conrefJump';
import { renderTopicToHtml } from '../../editor/topicRender';
import { getConrefJumpScript } from '../../editor/webview/conrefJumpScript';

// The conref jump button, end to end below the webview: the renderer marks
// conref'd content (only when the preview opts in), and the host validates
// the click message. The in-webview hit-testing is exercised separately at
// the bottom against a minimal fake DOM.

describe('parseConrefJumpMessage', () => {
  const file = process.platform === 'win32' ? 'C:\\proj\\reuse.dita' : '/proj/reuse.dita';

  it('accepts an absolute DITA path with a position', () => {
    assert.deepStrictEqual(parseConrefJumpMessage({ type: MSG_OPEN_CONREF_TARGET, file, line: 4, col: 2 }), { file, line: 4, col: 2 });
  });

  it('defaults a missing or bad column to 0', () => {
    assert.strictEqual(parseConrefJumpMessage({ file, line: 4 })?.col, 0);
    assert.strictEqual(parseConrefJumpMessage({ file, line: 4, col: -3 })?.col, 0);
  });

  it('rejects what the webview must not be able to make the host open', () => {
    assert.strictEqual(parseConrefJumpMessage({ file: 'reuse.dita', line: 1 }), undefined, 'relative path');
    assert.strictEqual(parseConrefJumpMessage({ file: file.replace(/\.dita$/, '.exe'), line: 1 }), undefined, 'not a DITA source');
    assert.strictEqual(parseConrefJumpMessage({ file, line: -1 }), undefined, 'negative line');
    assert.strictEqual(parseConrefJumpMessage({ file, line: 1.5 }), undefined, 'fractional line');
    assert.strictEqual(parseConrefJumpMessage({ file, line: '1' }), undefined, 'non-numeric line');
    assert.strictEqual(parseConrefJumpMessage({ file: 42, line: 1 }), undefined, 'non-string file');
  });
});

describe('conref marking in a real render', () => {
  let dir: string;
  let mainFile: string;
  let reuseFile: string;

  const reuse = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<topic id="r">',
    '  <title>Reuse</title>',
    '  <body>',
    '    <p id="para">Shared paragraph</p>', // line 4
    '    <p id="a">First of run</p>', // line 5
    '    <p id="b">Second of run</p>', // line 6
    '    <p><ph id="phrase">shared phrase</ph></p>', // ph starts line 7
    '  </body>',
    '</topic>',
    '',
  ].join('\n');

  const main = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<topic id="m">',
    '  <title>Main</title>',
    '  <body>',
    '    <p conref="reuse.dita#r/para"/>',
    '    <p conref="reuse.dita#r/a" conrefend="reuse.dita#r/b"/>',
    '    <p>Before <ph conref="reuse.dita#r/phrase"/> after</p>',
    '    <p id="local">Local source</p>',
    '    <p conref="#m/local"/>',
    '    <p>Plain, not conref\'d</p>',
    '  </body>',
    '</topic>',
    '',
  ].join('\n');

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'conref-jump-'));
    mkdirSync(dir, { recursive: true });
    mainFile = join(dir, 'main.dita');
    reuseFile = join(dir, 'reuse.dita');
    writeFileSync(mainFile, main);
    writeFileSync(reuseFile, reuse);
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  const render = (markConrefs: boolean) => {
    const r = renderTopicToHtml({
      filePath: mainFile,
      keyMap: new Map(),
      asWebviewUri: (p) => p,
      headingLevel: 1,
      markConrefs,
    });
    assert.strictEqual(r.error, undefined);
    return r.html;
  };

  const marksOf = (html: string) =>
    [...html.matchAll(/data-conref="(\w+)" data-conref-file="([^"]*)" data-conref-line="(\d+)" data-conref-col="(\d+)"/g)].map((m) => ({
      kind: m[1], file: m[2], line: Number(m[3]), col: Number(m[4]),
    }));

  it('emits no data-conref at all unless the caller opts in (export and diff stay plain)', () => {
    assert.ok(!render(false).includes('data-conref'));
  });

  it('marks each kind of conref with the TARGET\'s file and position, not the referencing tag\'s', () => {
    const marks = marksOf(render(true));
    // single-target block, 2-member conrefend run, inline ph, same-file conref
    assert.strictEqual(marks.length, 5, JSON.stringify(marks));

    const [para, runA, runB, phrase, local] = marks;
    assert.deepStrictEqual([para.kind, para.file, para.line], ['block', reuseFile, 4]);
    assert.deepStrictEqual([runA.kind, runA.file, runA.line], ['block', reuseFile, 5]);
    assert.deepStrictEqual([runB.kind, runB.file, runB.line], ['block', reuseFile, 6]);
    assert.deepStrictEqual([phrase.kind, phrase.file, phrase.line], ['inline', reuseFile, 7]);
    // Same-document target lives in the file being rendered.
    assert.deepStrictEqual([local.kind, local.file, local.line], ['block', mainFile, 7]);
  });

  it('keeps the source-sync range on the referencing tag (data-line is untouched by the mark)', () => {
    const html = render(true);
    // <p conref="reuse.dita#r/para"/> is on 0-based line 4 of main.dita too, so
    // pick a case where the two files disagree: the ph (main line 6, reuse line 7).
    const m = /<span[^>]*data-conref="inline"[^>]*>/.exec(html);
    assert.ok(m, 'inline conref element present');
    assert.ok(/data-line="6"/.test(m[0]), m[0]);
    assert.ok(/data-conref-line="7"/.test(m[0]), m[0]);
  });

  it('does not mark plain content', () => {
    const html = render(true);
    const plain = /<p[^>]*>Plain, not conref'd/.exec(html);
    assert.ok(plain && !plain[0].includes('data-conref'));
  });
});

// ── the webview half ──

interface Rect { left: number; top: number; right: number; bottom: number }
interface FakeEl {
  attrs: Record<string, string>;
  parent: FakeEl | null;
  rects: Rect[];
  style: { borderLeftWidth: string; borderTopWidth: string };
  title: string | null;
  getAttribute(n: string): string | null;
  setAttribute(n: string, v: string): void;
  removeAttribute(n: string): void;
  getClientRects(): Rect[];
  closest(sel: string): FakeEl | null;
  parentElement: FakeEl | null;
}

function runScript() {
  const handlers: Record<string, (e: unknown) => void> = {};
  const posted: unknown[] = [];
  const hot = new Set<string>();
  const docEl = { classList: { toggle: (c: string, on: boolean) => void (on ? hot.add(c) : hot.delete(c)), remove: (c: string) => void hot.delete(c) } };

  function el(attrs: Record<string, string>, rects: Rect[], parent: FakeEl | null = null): FakeEl {
    const e: FakeEl = {
      attrs: { ...attrs },
      parent,
      parentElement: parent,
      rects,
      style: { borderLeftWidth: '0px', borderTopWidth: '0px' },
      title: null,
      getAttribute(n) { return n in e.attrs ? e.attrs[n] : null; },
      setAttribute(n, v) { e.attrs[n] = v; },
      removeAttribute(n) { delete e.attrs[n]; },
      getClientRects() { return e.rects; },
      closest(sel) {
        assert.strictEqual(sel, '[data-conref]');
        for (let cur: FakeEl | null = e; cur; cur = cur.parent) if ('data-conref' in cur.attrs) return cur;
        return null;
      },
    };
    return e;
  }

  const fakeDocument = { documentElement: docEl, addEventListener: (t: string, h: (e: unknown) => void) => void (handlers[t] = h) };
  const src = getConrefJumpScript({ openMsgType: MSG_OPEN_CONREF_TARGET, title: 'Open it' });
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('document', 'vscode', 'getComputedStyle', src)(
    fakeDocument,
    { postMessage: (m: unknown) => posted.push(m) },
    (e: FakeEl) => e.style,
  );

  const click = (target: FakeEl, x: number, y: number) => {
    let prevented = false;
    handlers.click({ target, clientX: x, clientY: y, button: 0, preventDefault: () => { prevented = true; }, stopPropagation: () => undefined });
    return prevented;
  };
  const move = (target: FakeEl, x: number, y: number) => handlers.mousemove({ target, clientX: x, clientY: y });
  return { el, click, move, posted, hot };
}

describe('conrefJumpScript (webview hit-testing)', () => {
  const attrs = (kind: string, line = 4) => ({ 'data-conref': kind, 'data-conref-file': '/p/reuse.dita', 'data-conref-line': String(line), 'data-conref-col': '4' });

  it('a click on a block conref\'s top-left icon posts the target; a click on its text does not', () => {
    const t = runScript();
    const block = t.el(attrs('block'), [{ left: 100, top: 200, right: 700, bottom: 260 }]);
    assert.strictEqual(t.click(block, 110, 210), true, 'icon click is claimed');
    assert.deepStrictEqual(t.posted, [{ type: MSG_OPEN_CONREF_TARGET, file: '/p/reuse.dita', line: 4, col: 4 }]);

    t.posted.length = 0;
    assert.strictEqual(t.click(block, 300, 240), false, 'text area is left alone');
    assert.strictEqual(t.click(block, 110, 240), false, 'below the icon line is left alone');
    assert.deepStrictEqual(t.posted, []);
  });

  it('an inline conref\'s icon is at the right end of its LAST line box', () => {
    const t = runScript();
    // wrapped across two lines
    const inl = t.el(attrs('inline', 7), [
      { left: 400, top: 100, right: 800, bottom: 120 },
      { left: 100, top: 120, right: 200, bottom: 140 },
    ]);
    t.click(inl, 500, 110); // end of the first line: not the icon
    assert.deepStrictEqual(t.posted, []);
    t.click(inl, 195, 130); // end of the last line
    assert.strictEqual((t.posted[0] as { line: number }).line, 7);
  });

  it('inside a nested conref, the outer icon still works when the point is not on the inner one', () => {
    const t = runScript();
    const outer = t.el(attrs('block', 4), [{ left: 100, top: 200, right: 700, bottom: 400 }]);
    const inner = t.el(attrs('block', 9), [{ left: 100, top: 250, right: 700, bottom: 300 }], outer);
    t.click(inner, 110, 210); // on outer's icon (pointer is over the outer element's own box)
    assert.strictEqual((t.posted[0] as { line: number }).line, 4);
    t.posted.length = 0;
    t.click(inner, 110, 260); // on inner's icon
    assert.strictEqual((t.posted[0] as { line: number }).line, 9);
  });

  it('hovering the icon lights the pointer cursor and borrows then restores the title', () => {
    const t = runScript();
    const block = t.el({ ...attrs('block'), title: 'tag-name' }, [{ left: 100, top: 200, right: 700, bottom: 260 }]);
    t.move(block, 110, 210);
    assert.ok(t.hot.has('dv-conref-hot'));
    assert.strictEqual(block.attrs.title, 'Open it');
    t.move(block, 300, 240);
    assert.ok(!t.hot.has('dv-conref-hot'));
    assert.strictEqual(block.attrs.title, 'tag-name', 'the Tags toggle\'s title is given back');
  });
});
