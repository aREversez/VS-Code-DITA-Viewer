import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { carryViewState, initialViewState } from '../../editor/diffVersionPick';

const root = join(__dirname, '..', '..', '..');
const script = readFileSync(join(root, 'media/diff-webview.js'), 'utf8');
const provider = readFileSync(join(root, 'src/editor/ditaDiffProvider.ts'), 'utf8');

describe('diff view state across a re-render', () => {
  it('keeps Aa and the position on swap, keeps only Aa on a new comparison', () => {
    const ui = { inline: false, idx: 3 };
    assert.deepStrictEqual(carryViewState(ui, 'swap'), { inline: false, idx: 3 });
    assert.deepStrictEqual(carryViewState(ui, 'recompare'), { inline: false, idx: -1 });
    assert.deepStrictEqual(carryViewState(undefined, 'recompare'), initialViewState());
    assert.deepStrictEqual(initialViewState(), { inline: true, idx: -1 });
  });

  it('is fed by the webview and replayed into the next page', () => {
    assert.ok(/msg\.type === 'viewState'/.test(provider), 'provider listens for viewState');
    assert.ok(/data-initial-idx/.test(provider), 'the position is written into the page');
    assert.ok(/show-inline/.test(provider));
  });

  describe('script', () => {
    type Listener = (e: { key?: string; target?: unknown; preventDefault: () => void }) => void;
    function boot(bodyAttrs: Record<string, string>, bodyClasses: string[], changeIdxs: number[]) {
      const posted: Array<Record<string, unknown>> = [];
      const listeners: Record<string, Record<string, Listener>> = {};
      const makeEl = (id: string) => {
        const el = {
          id,
          value: '',
          addEventListener: (t: string, fn: Listener) => { (listeners[id] ||= {})[t] = fn; },
          setAttribute: () => undefined,
          appendChild: () => undefined,
          removeChild: () => undefined,
          firstChild: null,
          textContent: '',
          offsetParent: {},
          select: () => undefined,
          blur: () => undefined,
          scrollIntoView: () => undefined,
          getBoundingClientRect: () => ({ top: 0, height: 0, width: 40 }),
        };
        return el;
      };
      const byId: Record<string, ReturnType<typeof makeEl>> = {};
      const classes = new Set(bodyClasses);
      const changeEls = changeIdxs.map((i) => ({
        getAttribute: () => String(i),
        classList: { add: () => undefined, remove: () => undefined, toggle: () => undefined },
        scrollIntoView: () => undefined,
        closest: () => null,
        querySelector: () => null,
      }));
      const doc = {
        body: {
          getAttribute: (k: string) => bodyAttrs[k] ?? null,
          classList: {
            toggle: (c: string) => { if (classes.has(c)) { classes.delete(c); return false; } classes.add(c); return true; },
            contains: (c: string) => classes.has(c),
            add: (c: string) => classes.add(c),
            remove: (c: string) => classes.delete(c),
          },
        },
        getElementById: (id: string) => byId[id] || (byId[id] = makeEl(id)),
        querySelector: () => makeEl('cols'),
        querySelectorAll: (sel: string) => (sel.startsWith('[data-diff-idx]') && !sel.includes('=') ? changeEls : []),
        createElementNS: () => makeEl('n'),
        addEventListener: () => undefined,
      };
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const run = new Function('document', 'window', 'requestAnimationFrame', 'ResizeObserver', 'acquireVsCodeApi', script);
      run(doc, { addEventListener: () => undefined }, () => 0, undefined, () => ({ postMessage: (m: Record<string, unknown>) => posted.push(m) }));
      return { posted, listeners, byId, classes };
    }

    it('restores the position it is handed instead of starting at 0', () => {
      const env = boot({ 'data-initial-idx': '2' }, ['show-inline'], [0, 1, 2, 3]);
      assert.strictEqual(env.byId['nav-counter'].value, '3 / 4');
    });

    it('starts at 0 when it is handed nothing', () => {
      const env = boot({}, ['show-inline'], [0, 1, 2, 3]);
      assert.strictEqual(env.byId['nav-counter'].value, '0 / 4');
    });

    it('reports a navigation and an Aa toggle so the next page can restore them', () => {
      const env = boot({}, ['show-inline'], [0, 1, 2]);
      env.listeners['btn-next']['click']({ preventDefault: () => undefined });
      assert.deepStrictEqual(env.posted.pop(), { type: 'viewState', inline: true, idx: 0 });
      env.listeners['btn-inline']['click']({ preventDefault: () => undefined });
      assert.deepStrictEqual(env.posted.pop(), { type: 'viewState', inline: false, idx: 0 });
    });
  });
});
