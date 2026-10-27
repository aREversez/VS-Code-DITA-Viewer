import * as assert from 'assert';
import { isExcluded, parseDitaval, profileValuesOfKeys } from '@dita-viewer/core';
import { getProfilingFilterScript } from '../../editor/webview/profilingFilterScript';

/**
 * The Filter panel's DITAVAL layer. The panel is a string no compiler sees, so
 * it is run here against a small fake DOM and driven the way the host drives
 * it: window.__ditaval seeds the file at load, a `setDitaval` message replaces
 * it. What is pinned is what a person sees (which elements are hidden, which
 * boxes are unticked and disabled, which requests a click posts), and that the
 * script's decision agrees with the core's isExcluded -- the rule the Obsidian
 * preview applies -- on the same markup.
 */

interface Rule { att: string; val?: string; action: string }
interface WebviewDitaval { name: string; rules: Rule[]; error?: string }

class FakeEl {
  children: FakeEl[] = [];
  attrs: Record<string, string> = {};
  style: Record<string, string> = { cssText: '' };
  listeners: Record<string, Array<(e: unknown) => void>> = {};
  classes = new Set<string>();
  textContent = '';
  title = '';
  type = '';
  href = '';
  checked = false;
  disabled = false;
  removed = false;
  constructor(readonly tag: string) {}
  get classList(): { toggle(name: string, force: boolean): void } {
    return { toggle: (name, force) => { if (force) this.classes.add(name); else this.classes.delete(name); } };
  }
  appendChild(child: FakeEl): FakeEl { this.children.push(child); return child; }
  remove(): void { this.removed = true; }
  setAttribute(name: string, value: string): void { this.attrs[name] = value; }
  getAttribute(name: string): string | null { return name in this.attrs ? this.attrs[name] : null; }
  addEventListener(type: string, fn: (e: unknown) => void): void { (this.listeners[type] ||= []).push(fn); }
  getBoundingClientRect(): { bottom: number } { return { bottom: 30 }; }
  click(): void { (this.listeners['click'] ?? []).forEach((fn) => fn({ preventDefault() {} })); }
  all(): FakeEl[] { return [this, ...this.children.flatMap((c) => c.all())]; }
}

const keysOf = (attrs: Record<string, string>): string =>
  Object.entries(attrs)
    .flatMap(([att, raw]) => raw.split(/\s+/).filter(Boolean).map((v) => `${encodeURIComponent(att)}:${encodeURIComponent(v)}`))
    .join(',');

const ditaval = (name: string, rules: Rule[], error?: string): WebviewDitaval => ({ name, rules, ...(error ? { error } : {}) });
const exclude = (att: string, val?: string): Rule => (val === undefined ? { att, action: 'exclude' } : { att, val, action: 'exclude' });

function setup(profiled: Array<Record<string, string>>, seeded: WebviewDitaval | null = null) {
  const elements = profiled.map((attrs) => {
    const el = new FakeEl('p');
    el.setAttribute('data-profile-keys', keysOf(attrs));
    return el;
  });
  const posted: Array<{ type: string }> = [];
  const windowListeners: Array<(e: { data: unknown }) => void> = [];
  const appended: FakeEl[] = [];
  const toolbar = new FakeEl('div');
  const doc = {
    querySelectorAll: (): FakeEl[] => elements,
    createElement: (tag: string): FakeEl => new FakeEl(tag),
    body: { appendChild: (el: FakeEl): void => { appended.push(el); } },
  };
  const win = {
    __ditaval: seeded ?? undefined,
    addEventListener: (type: string, fn: (e: { data: unknown }) => void): void => { if (type === 'message') windowListeners.push(fn); },
  };
  const script = getProfilingFilterScript({
    buttonLabel: 'Filter',
    buttonTitle: 'Filter title',
    closeLabel: 'Close',
    emptyLabel: 'Empty',
    ditavalNone: 'None',
    ditavalChoose: 'Choose…',
    ditavalChange: 'Change…',
    ditavalClear: 'Clear',
    ditavalByFile: 'Left out by the DITAVAL file',
    chooseMsgType: 'chooseDitaval',
    clearMsgType: 'clearDitaval',
    setMsgType: 'setDitaval',
  });
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const api = new Function(
    'document', 'window', 'toolbar', 'btnStyle', 'vscode',
    `${script}; return { pfBuildPanel: pfBuildPanel, pfTogglePanel: pfTogglePanel, pfBtn: function() { return pfFilterBtn; }, hand: function(k) { pfExcluded[k] = true; pfApplyFilter(); } };`,
  )(doc, win, toolbar, 'BTN', { postMessage: (m: { type: string }) => posted.push(m) }) as {
    pfBuildPanel(): FakeEl;
    pfTogglePanel(): void;
    pfBtn(): FakeEl;
    hand(key: string): void;
  };
  const hidden = (): boolean[] => elements.map((e) => e.classes.has('profile-filtered-out'));
  const send = (msg: unknown): void => windowListeners.forEach((fn) => fn({ data: msg }));
  /** value label -> its checkbox, over everything the panel lists. */
  const boxes = (panel: FakeEl): Map<string, FakeEl> => {
    const out = new Map<string, FakeEl>();
    for (const row of panel.all().filter((n) => n.tag === 'label')) {
      const box = row.children.find((c) => c.tag === 'input');
      const text = row.children.find((c) => c.tag === 'span');
      if (box && text) out.set(text.textContent, box);
    }
    return out;
  };
  const buttons = (panel: FakeEl): FakeEl[] => panel.all().filter((n) => n.tag === 'button');
  return { api, elements, hidden, send, posted, boxes, buttons, appended };
}

describe('Filter panel: DITAVAL layer', () => {
  it('hides nothing and lights nothing without a file', () => {
    const t = setup([{ audience: 'admin' }]);
    assert.deepStrictEqual(t.hidden(), [false]);
    assert.strictEqual(t.api.pfBtn().style['background'], '');
  });

  it('applies a seeded file at load and lights the Filter button', () => {
    const t = setup([{ audience: 'admin' }, { audience: 'user' }, {}], ditaval('release.ditaval', [exclude('audience', 'admin')]));
    assert.deepStrictEqual(t.hidden(), [true, false, false]);
    assert.strictEqual(t.api.pfBtn().style['background'], 'var(--color-profiling-label-bg)');
  });

  it('applies a file the host sends, and drops it again on null', () => {
    const t = setup([{ audience: 'admin' }, { audience: 'user' }]);
    t.send({ type: 'setDitaval', ditaval: ditaval('a.ditaval', [exclude('audience', 'admin')]) });
    assert.deepStrictEqual(t.hidden(), [true, false]);
    t.send({ type: 'setDitaval', ditaval: null });
    assert.deepStrictEqual(t.hidden(), [false, false]);
    assert.strictEqual(t.api.pfBtn().style['background'], '');
  });

  it('ignores messages of other types', () => {
    const t = setup([{ audience: 'admin' }], ditaval('a.ditaval', [exclude('audience', 'admin')]));
    t.send({ type: 'updateContent', html: '' });
    t.send(null);
    assert.deepStrictEqual(t.hidden(), [true]);
  });

  it('keeps what was unticked by hand when the file is cleared', () => {
    const t = setup([{ audience: 'admin' }, { platform: 'linux' }], ditaval('a.ditaval', [exclude('audience', 'admin')]));
    t.api.hand(keysOf({ platform: 'linux' }));
    assert.deepStrictEqual(t.hidden(), [true, true]);
    t.send({ type: 'setDitaval', ditaval: null });
    assert.deepStrictEqual(t.hidden(), [false, true]);
  });

  it('leaves an element with a second, kept value of the same attribute showing', () => {
    const t = setup([{ audience: 'internal admin' }, { audience: 'admin' }], ditaval('a.ditaval', [exclude('audience', 'admin')]));
    assert.deepStrictEqual(t.hidden(), [false, true]);
  });

  it('lets an attribute-wide default exclude, and an explicit include override it', () => {
    const rules: Rule[] = [exclude('platform'), { att: 'platform', val: 'linux', action: 'include' }];
    const t = setup([{ platform: 'linux' }, { platform: 'windows' }], ditaval('a.ditaval', rules));
    assert.deepStrictEqual(t.hidden(), [false, true]);
  });

  it('never acts on base, importance, rev or status, as DITA-OT does not', () => {
    const rules: Rule[] = [exclude('status', 'draft'), exclude('rev'), exclude('importance', 'high'), exclude('base')];
    const t = setup([{ status: 'draft' }, { rev: '2' }, { importance: 'high' }, { base: 'x' }], ditaval('a.ditaval', rules));
    assert.deepStrictEqual(t.hidden(), [false, false, false, false]);
  });

  it('reads a value written through props="platform(…)" as that attribute', () => {
    // The renderer splits props on whitespace, so the keys carry `platform(linux` and `windows)`.
    const el = { props: 'platform(linux windows)' };
    const one = setup([el], ditaval('a.ditaval', [exclude('platform', 'linux')]));
    assert.deepStrictEqual(one.hidden(), [false], 'windows is still in');
    const both = setup([el], ditaval('a.ditaval', [exclude('platform', 'linux'), exclude('platform', 'windows')]));
    assert.deepStrictEqual(both.hidden(), [true]);
  });

  it('applies no rules from a file that did not read cleanly, and says why', () => {
    const t = setup([{ audience: 'admin' }], ditaval('bad.ditaval', [], 'The DITAVAL file does not exist.'));
    assert.deepStrictEqual(t.hidden(), [false]);
    const panel = t.api.pfBuildPanel();
    assert.ok(panel.all().some((n) => n.textContent === 'The DITAVAL file does not exist.'));
  });

  describe('the panel', () => {
    it('unticks and disables a value the file leaves out, and leaves the rest tickable', () => {
      const t = setup([{ audience: 'admin' }, { audience: 'user' }], ditaval('a.ditaval', [exclude('audience', 'admin')]));
      const boxes = t.boxes(t.api.pfBuildPanel());
      assert.strictEqual(boxes.get('admin')!.checked, false);
      assert.strictEqual(boxes.get('admin')!.disabled, true);
      assert.strictEqual(boxes.get('user')!.checked, true);
      assert.strictEqual(boxes.get('user')!.disabled, false);
    });

    it('rebuilds an open panel when a file arrives, so the ticks follow it', () => {
      const t = setup([{ audience: 'admin' }, { audience: 'user' }]);
      t.api.pfTogglePanel();
      const before = t.appended[0];
      assert.strictEqual(t.boxes(before).get('admin')!.checked, true);
      t.send({ type: 'setDitaval', ditaval: ditaval('a.ditaval', [exclude('audience', 'admin')]) });
      assert.ok(before.removed, 'the stale panel is removed');
      const after = t.appended[1];
      assert.strictEqual(t.boxes(after).get('admin')!.checked, false);
      assert.strictEqual(t.boxes(after).get('admin')!.disabled, true);
      t.send({ type: 'setDitaval', ditaval: null });
      assert.strictEqual(t.boxes(t.appended[2]).get('admin')!.checked, true);
    });

    it('shows None and a Choose button without a file, and posts the request on click', () => {
      const t = setup([{ audience: 'admin' }]);
      const panel = t.api.pfBuildPanel();
      assert.ok(panel.all().some((n) => n.textContent === 'None'));
      const buttons = t.buttons(panel);
      assert.deepStrictEqual(buttons.map((b) => b.textContent), ['Choose…']);
      buttons[0].click();
      assert.deepStrictEqual(t.posted, [{ type: 'chooseDitaval' }]);
    });

    it('shows the file name with Change and Clear, and each posts its own request', () => {
      const t = setup([{ audience: 'admin' }], ditaval('release.ditaval', [exclude('audience', 'admin')]));
      const panel = t.api.pfBuildPanel();
      assert.ok(panel.all().some((n) => n.textContent === 'release.ditaval'));
      const buttons = t.buttons(panel);
      assert.deepStrictEqual(buttons.map((b) => b.textContent), ['Change…', 'Clear']);
      buttons[0].click();
      buttons[1].click();
      assert.deepStrictEqual(t.posted, [{ type: 'chooseDitaval' }, { type: 'clearDitaval' }]);
    });

    it('offers the DITAVAL row even when the page carries no profiled content', () => {
      const t = setup([]);
      const panel = t.api.pfBuildPanel();
      assert.deepStrictEqual(t.buttons(panel).map((b) => b.textContent), ['Choose…']);
      assert.ok(panel.all().some((n) => n.textContent === 'Empty'));
    });
  });

  describe('agrees with the core', () => {
    // The same decision the Obsidian preview makes: isExcluded over the values
    // read back from data-profile-keys. A table rather than a random walk, so a
    // failure names the case.
    const files: Array<[string, string]> = [
      ['exclude one value', '<val><prop att="audience" val="admin" action="exclude"/></val>'],
      ['exclude by default, include one', '<val><prop att="platform" action="exclude"/><prop att="platform" val="linux" action="include"/></val>'],
      ['flag only', '<val><prop att="audience" val="admin" action="flag"/></val>'],
      ['two attributes', '<val><prop att="audience" val="admin" action="exclude"/><prop att="product" val="pro" action="exclude"/></val>'],
      ['non-filterable attribute', '<val><prop att="status" val="draft" action="exclude"/></val>'],
      ['generalised attribute', '<val><prop att="region" val="eu" action="exclude"/></val>'],
    ];
    const pages: Array<Record<string, string>> = [
      {},
      { audience: 'admin' },
      { audience: 'internal admin' },
      { audience: 'user', product: 'pro' },
      { platform: 'linux' },
      { platform: 'windows' },
      { platform: 'linux windows' },
      { product: 'pro' },
      { status: 'draft' },
      { props: 'region(eu us)' },
      { props: 'region(eu)' },
      { props: 'misc region(eu)' },
      { audience: 'admin', platform: 'linux' },
    ];
    for (const [name, xml] of files) {
      it(`${name}: every page element is judged as the core judges it`, () => {
        const parsed = parseDitaval(xml);
        assert.strictEqual(parsed.error, undefined);
        const payload = ditaval('f.ditaval', parsed.rules.map((r) => (r.val === undefined ? { att: r.att, action: r.action } : { att: r.att, val: r.val, action: r.action })));
        const t = setup(pages, payload);
        const expected = pages.map((attrs) => isExcluded(profileValuesOfKeys(keysOf(attrs)), { ditaval: parsed }));
        assert.deepStrictEqual(t.hidden(), expected);
      });
    }
  });
});
