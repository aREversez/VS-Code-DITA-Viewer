import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getCodeCopyScript } from '../../editor/webview/codeCopyScript';

// dist-test/test/editor/codeCopyScript.test.js -> repo root is three levels up.
const repoRoot = join(__dirname, '..', '..', '..');
const read = (rel: string): string => readFileSync(join(repoRoot, rel), 'utf8');

/**
 * The code-copy script is a string interpolated into the topic and map
 * webviews, so no compiler or linter sees it. These cases run the real script
 * body against a minimal fake DOM (same approach as the other webview-script
 * tests: jsdom is not a dependency) and pin the behavior: clicking the
 * language chip of a <codeblock> copies that block's code, gives feedback on
 * the chip, and falls back to execCommand when the async clipboard is
 * unavailable.
 */

type Listener = (e: unknown) => void;

interface FakeEl {
  textContent: string;
  title: string;
  attrs: Record<string, string>;
  closest(sel: string): FakeEl | null;
  querySelector(sel: string): FakeEl | null;
  getAttribute(n: string): string | null;
  setAttribute(n: string, v: string): void;
  removeAttribute(n: string): void;
}

interface FakeNode extends FakeEl {
  cls: string;
  parent: FakeNode | null;
  kids: FakeNode[];
}

function el(cls: string, text = ''): FakeNode {
  const self: FakeNode = {
    cls,
    parent: null,
    kids: [],
    textContent: text,
    title: '',
    attrs: {},
    closest(sel: string) {
      const want = sel.replace('.', '');
      let cur: FakeNode | null = self;
      while (cur) {
        if (cur.cls.split(' ').includes(want)) return cur;
        cur = cur.parent;
      }
      return null;
    },
    querySelector(sel: string) {
      return self.kids.find((k) => k.cls.split(' ').includes(sel)) ?? null;
    },
    getAttribute: (n) => (n in self.attrs ? self.attrs[n] : null),
    setAttribute: (n, v) => { self.attrs[n] = v; },
    removeAttribute: (n) => { delete self.attrs[n]; },
  };
  return self;
}

function block(lang: string, code: string) {
  const wrap = el('codeblock-wrap');
  const pre = el('pre', code);
  const chip = el('codeblock-lang', lang);
  pre.parent = wrap;
  chip.parent = wrap;
  wrap.kids = [pre, chip];
  return { wrap, pre, chip };
}

interface Harness {
  fire(type: string, target: unknown): void;
  rootClasses: string[];
  timers: Array<() => void>;
  runTimers(): void;
  copied: string[];
  legacyCopied: string[];
}

function load(opts: { clipboard: 'ok' | 'reject' | 'none'; legacyOk?: boolean }): Harness {
  const listeners: Record<string, Listener[]> = {};
  const rootClasses: string[] = [];
  const copied: string[] = [];
  const legacyCopied: string[] = [];
  const timers: Array<() => void> = [];
  const doc = {
    documentElement: { classList: { add: (c: string) => rootClasses.push(c) } },
    addEventListener: (t: string, fn: Listener) => { (listeners[t] ||= []).push(fn); },
    createElement: () => {
      const ta = { value: '', style: {} as Record<string, string>, setAttribute() {}, select() {}, remove() {} };
      return ta;
    },
    body: {
      appendChild(ta: { value: string }) { legacyCopied.push(ta.value); },
    },
    execCommand: () => opts.legacyOk !== false,
  };
  const nav: { clipboard?: { writeText(t: string): Promise<void> } } = {};
  if (opts.clipboard !== 'none') {
    nav.clipboard = {
      writeText: (t: string) => {
        if (opts.clipboard === 'reject') return Promise.reject(new Error('denied'));
        copied.push(t);
        return Promise.resolve();
      },
    };
  }
  const setT = (fn: () => void) => { timers.push(fn); return timers.length; };
  new Function('document', 'navigator', 'setTimeout', 'clearTimeout', getCodeCopyScript({
    copyTitle: 'Copy code',
    doneLabel: 'Copied!',
    failedLabel: 'Copy failed',
  }))(doc, nav, setT, () => {});
  return {
    fire: (type, target) => (listeners[type] || []).forEach((fn) => fn({ target })),
    rootClasses,
    timers,
    runTimers: () => { while (timers.length) (timers.shift() as () => void)(); },
    copied,
    legacyCopied,
  };
}

const flush = () => new Promise<void>((r) => setImmediate(r));

describe('getCodeCopyScript', () => {
  it('is syntactically valid even with quotes and backslashes in the labels', () => {
    assert.doesNotThrow(() => new Function(getCodeCopyScript({ copyTitle: 'a"b\\c\'d', doneLabel: '`x`', failedLabel: '</script>' })));
  });

  it('marks the document so styles.css can make the chip clickable', () => {
    const h = load({ clipboard: 'ok' });
    assert.deepStrictEqual(h.rootClasses, ['dv-code-copy']);
  });

  it('clicking the language chip copies the block\'s code, not the label', async () => {
    const h = load({ clipboard: 'ok' });
    const b = block('cpp', 'int main() {\n  return 0;\n}\n');
    h.fire('click', b.chip);
    await flush();
    assert.deepStrictEqual(h.copied, ['int main() {\n  return 0;\n}\n']);
  });

  it('shows the done label on the chip, then restores the language after the timeout', async () => {
    const h = load({ clipboard: 'ok' });
    const b = block('xml', '<a/>');
    h.fire('click', b.chip);
    await flush();
    assert.strictEqual(b.chip.textContent, 'Copied!');
    h.runTimers();
    assert.strictEqual(b.chip.textContent, 'xml');
    assert.strictEqual(b.chip.getAttribute('data-orig-label'), null);
  });

  it('a second click during the feedback never overwrites the remembered language', async () => {
    const h = load({ clipboard: 'ok' });
    const b = block('xml', '<a/>');
    h.fire('click', b.chip);
    await flush();
    h.fire('click', b.chip);
    await flush();
    h.runTimers();
    assert.strictEqual(b.chip.textContent, 'xml');
  });

  it('ignores clicks that are not on a language chip (including the code itself)', async () => {
    const h = load({ clipboard: 'ok' });
    const b = block('xml', '<a/>');
    h.fire('click', b.pre);
    h.fire('click', el('p', 'text'));
    h.fire('click', null);
    await flush();
    assert.deepStrictEqual(h.copied, []);
    assert.strictEqual(b.chip.textContent, 'xml');
  });

  it('falls back to execCommand when the async clipboard rejects', async () => {
    const h = load({ clipboard: 'reject' });
    const b = block('sh', 'ls -la');
    h.fire('click', b.chip);
    await flush();
    assert.deepStrictEqual(h.legacyCopied, ['ls -la']);
    assert.strictEqual(b.chip.textContent, 'Copied!');
  });

  it('falls back to execCommand when there is no async clipboard at all', async () => {
    const h = load({ clipboard: 'none' });
    const b = block('sh', 'pwd');
    h.fire('click', b.chip);
    await flush();
    assert.deepStrictEqual(h.legacyCopied, ['pwd']);
  });

  it('reports failure on the chip when both copy paths fail', async () => {
    const h = load({ clipboard: 'reject', legacyOk: false });
    const b = block('sh', 'pwd');
    h.fire('click', b.chip);
    await flush();
    assert.strictEqual(b.chip.textContent, 'Copy failed');
    h.runTimers();
    assert.strictEqual(b.chip.textContent, 'sh');
  });

  it('gives the chip a tooltip on hover, without clobbering an existing one', () => {
    const h = load({ clipboard: 'ok' });
    const b = block('xml', '<a/>');
    h.fire('mouseover', b.chip);
    assert.strictEqual(b.chip.title, 'Copy code');
    b.chip.title = 'custom';
    h.fire('mouseover', b.chip);
    assert.strictEqual(b.chip.title, 'custom');
  });
});

describe('code copy wiring', () => {
  it('both previews embed the script with the localized strings', () => {
    for (const f of ['src/editor/webview/topicScript.ts', 'src/editor/webview/mapScript.ts']) {
      const src = read(f);
      assert.ok(src.includes('getCodeCopyScript({'), `${f} embeds getCodeCopyScript`);
      assert.ok(src.includes('L.codeCopyTitle'), `${f} passes the tooltip string`);
    }
  });

  it('the shared l10n table defines the tooltip and styles.css makes the chip clickable only when the script ran', () => {
    assert.ok(/codeCopyTitle:\s*vscode\.l10n\.t\('Copy code'\)/.test(read('src/editor/webviewL10n.ts')));
    const css = read('media/styles.css');
    assert.ok(/\.dv-code-copy \.codeblock-lang\s*\{[^}]*pointer-events:\s*auto/.test(css));
    assert.ok(/\.codeblock-lang\s*\{[^}]*pointer-events:\s*none/.test(css), 'default stays inert for hosts without the script');
  });
});
