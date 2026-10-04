import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getProfilingToggleScript } from '../../editor/webview/profilingToggleScript';

// dist-test/test/editor -> repo root is three levels up.
const repoRoot = join(__dirname, '..', '..', '..');
const read = (rel: string): string => readFileSync(join(repoRoot, rel), 'utf8');

/**
 * The Flags (profiling highlight) toggle used to be written out twice,
 * line for line, in DitaViewerProvider.ts and MapViewerProvider.ts. It is now
 * one shared script. These tests pin both halves of that: the shared script
 * behaves (run against a fake DOM, since the body is a string no compiler
 * sees), and neither provider carries its own copy again.
 */

interface FakeButton {
  textContent: string;
  title: string;
  style: { cssText: string; background: string; color: string };
  attrs: Record<string, string>;
  listeners: Record<string, Array<() => void>>;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, fn: () => void): void;
}

function run(): { btn: FakeButton; bodyClasses: Set<string>; appended: FakeButton[]; click: () => void } {
  const bodyClasses = new Set<string>();
  const appended: FakeButton[] = [];
  let created: FakeButton | undefined;
  const document = {
    body: {
      classList: {
        toggle(name: string, force: boolean): void {
          if (force) bodyClasses.add(name);
          else bodyClasses.delete(name);
        },
      },
    },
    createElement(): FakeButton {
      const el: FakeButton = {
        textContent: '',
        title: '',
        style: { cssText: '', background: '', color: '' },
        attrs: {},
        listeners: {},
        setAttribute(name: string, value: string): void {
          el.attrs[name] = value;
        },
        addEventListener(type: string, fn: () => void): void {
          (el.listeners[type] ||= []).push(fn);
        },
      };
      created = el;
      return el;
    },
  };
  const toolbar = { appendChild: (b: FakeButton): void => { appended.push(b); } };
  const script = getProfilingToggleScript({
    label: 'Flags',
    onTitle: 'on-title',
    offTitle: 'off-title',
  });
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('document', 'toolbar', 'btnStyle', script)(document, toolbar, 'BTN-STYLE');
  const btn = created as FakeButton;
  return { btn, bodyClasses, appended, click: () => btn.listeners['click'].forEach((fn) => fn()) };
}

describe('getProfilingToggleScript', () => {
  it('adds a labelled, styled button to the toolbar, highlighting on by default', () => {
    const { btn, bodyClasses, appended } = run();
    assert.deepStrictEqual(appended, [btn]);
    assert.strictEqual(btn.textContent, 'Flags');
    assert.strictEqual(btn.style.cssText, 'BTN-STYLE');
    assert.strictEqual(btn.style.background, 'var(--color-profiling-label-bg)');
    assert.strictEqual(btn.style.color, 'var(--color-profiling-label-text)');
    assert.strictEqual(btn.title, 'on-title');
    assert.strictEqual(btn.attrs['aria-label'], 'on-title');
    assert.ok(!bodyClasses.has('hide-profiling'));
  });

  it('quotes the strings it is given, so a title with quotes cannot break out of the script', () => {
    const script = getProfilingToggleScript({ label: 'L', onTitle: 'say "hi"', offTitle: "it's off" });
    assert.ok(script.includes('"say \\"hi\\""'));
    assert.ok(script.includes('"it\'s off"'));
  });

  it('a click hides the highlighting and a second click brings it back', () => {
    const { btn, bodyClasses, click } = run();
    click();
    assert.ok(bodyClasses.has('hide-profiling'));
    assert.strictEqual(btn.style.background, '');
    assert.strictEqual(btn.style.color, '');
    assert.strictEqual(btn.title, 'off-title');
    assert.strictEqual(btn.attrs['aria-label'], 'off-title');
    click();
    assert.ok(!bodyClasses.has('hide-profiling'));
    assert.strictEqual(btn.title, 'on-title');
    assert.strictEqual(btn.style.background, 'var(--color-profiling-label-bg)');
  });
});

describe('Flags toggle is shared, not copied', () => {
  for (const file of ['src/editor/webview/topicScript.ts', 'src/editor/webview/mapScript.ts']) {
    it(`${file} uses getProfilingToggleScript and defines no toggle of its own`, () => {
      const source = read(file);
      assert.ok(source.includes('${getProfilingToggleScript('), 'expected the shared script to be interpolated');
      assert.ok(!source.includes('function applyProfilingToggle'), 'inline copy must be gone');
      assert.ok(!source.includes("classList.toggle('hide-profiling'"), 'inline copy must be gone');
    });
  }
});
