import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getWebhelpChromeScript } from '../../editor/webview/webhelpChromeScript';

// Route B step 6: the header's top menu, the breadcrumb and the prev/next
// links of the WebHelp-style page are DERIVED from the sidebar (the one place
// that knows the tree and which page is active), and a click on any of them
// is proxied to the matching sidebar link, so page switching, scrolling and
// history keep their one implementation. These tests run the pure parts of
// the real script on plain data (jsdom is not a dependency here).

interface Row { depth: number; label: string; linked: boolean; active: boolean }
interface Model {
  topMenu: Array<{ row: number; label: string; target: number; active: boolean }>;
  crumbs: Array<{ row: number; label: string; linked: boolean }>;
  activeRow: number;
}
interface Api {
  webhelpChromeModel(rows: Row[]): Model;
  webhelpChromeHtml(m: Model): { menuHtml: string; crumbHtml: string };
  webhelpChromeClickRow(attr: string | null, nLinks: number): number;
}

function load(): Api {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    'document',
    'MutationObserver',
    `${getWebhelpChromeScript({ crumbLabel: 'Breadcrumb' })}\nreturn { webhelpChromeModel, webhelpChromeHtml, webhelpChromeClickRow };`,
  ) as (d: unknown, m: unknown) => Api;
  // No wh_topic_page body: the glue must stay inert and not touch anything else.
  return factory({ body: { classList: { contains: () => false } }, addEventListener: () => {} }, undefined);
}

const r = (depth: number, label: string, linked = true, active = false): Row => ({ depth, label, linked, active });

//  0  Intro                 (page)
//  1  Guide                 (group)
//  2    Setup               (page)
//  3    Usage               (group)
//  4      Basics            (page, active)
//  5  Empty group           (group, no pages)
//  6  Reference             (page)
const ROWS: Row[] = [
  r(0, 'Intro'),
  r(0, 'Guide', false),
  r(1, 'Setup'),
  r(1, 'Usage', false),
  r(2, 'Basics', true, true),
  r(0, 'Empty group', false),
  r(0, 'Reference'),
];

describe('webhelp chrome: the model', () => {
  const api = load();

  it('the top menu is the first-level rows, in order', () => {
    assert.deepStrictEqual(api.webhelpChromeModel(ROWS).topMenu.map((m) => m.label), ['Intro', 'Guide', 'Empty group', 'Reference']);
  });

  it('a page row targets itself; a group targets its first page; an empty group targets nothing', () => {
    const t = api.webhelpChromeModel(ROWS).topMenu.map((m) => [m.label, m.target]);
    assert.deepStrictEqual(t, [['Intro', 0], ['Guide', 2], ['Empty group', -1], ['Reference', 6]]);
  });

  it('only the menu item whose branch holds the active page is active', () => {
    assert.deepStrictEqual(api.webhelpChromeModel(ROWS).topMenu.map((m) => m.active), [false, true, false, false]);
  });

  it('no active page: no active menu item, no breadcrumb', () => {
    const none = ROWS.map((x) => ({ ...x, active: false }));
    const m = api.webhelpChromeModel(none);
    assert.strictEqual(m.activeRow, -1);
    assert.deepStrictEqual(m.topMenu.map((x) => x.active), [false, false, false, false]);
    assert.deepStrictEqual(m.crumbs, []);
  });

  it('the breadcrumb is the active row\'s ancestors, then the row itself', () => {
    const c = api.webhelpChromeModel(ROWS).crumbs;
    assert.deepStrictEqual(c.map((x) => x.label), ['Guide', 'Usage', 'Basics']);
    assert.deepStrictEqual(c.map((x) => x.linked), [false, false, true]);
  });

  it('a sibling that merely comes earlier is not an ancestor', () => {
    const rows = [r(0, 'Top', false), r(1, 'Sibling'), r(1, 'Here', true, true)];
    assert.deepStrictEqual(api.webhelpChromeModel(rows).crumbs.map((x) => x.label), ['Top', 'Here']);
  });

  it('a first-level active page is a one-item breadcrumb', () => {
    const rows = [r(0, 'A'), r(0, 'B', true, true)];
    assert.deepStrictEqual(api.webhelpChromeModel(rows).crumbs.map((x) => x.label), ['B']);
  });

  it('no rows at all gives empty results', () => {
    const m = api.webhelpChromeModel([]);
    assert.deepStrictEqual([m.topMenu, m.crumbs, m.activeRow], [[], [], -1]);
  });
});

describe('webhelp chrome: the markup', () => {
  const api = load();
  const html = () => api.webhelpChromeHtml(api.webhelpChromeModel(ROWS));

  it('menu items link to the row they target, and the active one is marked', () => {
    const { menuHtml } = html();
    assert.ok(menuHtml.includes('<li class="active"><a href="#" data-wh-row="2">Guide</a></li>'), menuHtml);
    assert.ok(menuHtml.includes('<li><a href="#" data-wh-row="0">Intro</a></li>'), menuHtml);
  });

  it('an item with nothing to open is plain text, not a link', () => {
    assert.ok(html().menuHtml.includes('<li><span>Empty group</span></li>'));
  });

  it('breadcrumb: groups are text, the last item is the current page and not a link, separators between', () => {
    const { crumbHtml } = html();
    assert.ok(crumbHtml.includes('<span class="wh_breadcrumb_item">Guide</span>'), crumbHtml);
    assert.ok(crumbHtml.includes('<span class="wh_breadcrumb_item" aria-current="page">Basics</span>'), crumbHtml);
    assert.strictEqual((crumbHtml.match(/wh_breadcrumb_sep/g) ?? []).length, 2);
  });

  it('a linked ancestor in the breadcrumb is a link to its row', () => {
    const rows = [r(0, 'Part'), r(1, 'Chapter', true, true)];
    const { crumbHtml } = api.webhelpChromeHtml(api.webhelpChromeModel(rows));
    assert.ok(crumbHtml.includes('<a class="wh_breadcrumb_item" href="#" data-wh-row="0">Part</a>'), crumbHtml);
  });

  it('labels cannot become markup', () => {
    const rows = [r(0, '<img src=x onerror=1> & "q"', true, true)];
    const { menuHtml, crumbHtml } = api.webhelpChromeHtml(api.webhelpChromeModel(rows));
    for (const h of [menuHtml, crumbHtml]) {
      assert.ok(!h.includes('<img'), h);
      assert.ok(h.includes('&lt;img src=x onerror=1&gt; &amp; &quot;q&quot;'), h);
    }
  });

  it('nothing to show renders as empty strings', () => {
    assert.deepStrictEqual(api.webhelpChromeHtml(api.webhelpChromeModel([])), { menuHtml: '', crumbHtml: '' });
  });
});

describe('webhelp chrome: the click proxy', () => {
  const api = load();
  it('reads a row index and rejects anything that is not one inside the list', () => {
    assert.strictEqual(api.webhelpChromeClickRow('3', 7), 3);
    assert.strictEqual(api.webhelpChromeClickRow('0', 7), 0);
    for (const bad of [null, '', '-1', '7', '1.5', 'x', '2e0', ' 2']) assert.strictEqual(api.webhelpChromeClickRow(bad, 7), -1, String(bad));
  });
});

describe('webhelp chrome: binds before the shell is on (late shell init)', () => {
  // Regression guard for the DOM glue. It used to bail out at load whenever the
  // body lacked wh_topic_page, so it never installed the observer that notices
  // the shell arriving later -- a Site<->Book mode swap that overlays the shell
  // by toggling the body class, or a cold-start restore that first builds the
  // webview on a non-shell page -- leaving the menu and breadcrumb empty forever
  // (and with no error, exactly the "frozen chrome" seen in the smoke test). Now
  // the glue always watches the body and stays inert until wh_topic_page is set.
  function glueRun(shellOnAtLoad: boolean): { observingBody: boolean } {
    const observed: unknown[] = [];
    class MutationObserverStub {
      constructor(_cb: unknown) {}
      observe(target: unknown) {
        observed.push(target);
      }
      disconnect() {}
    }
    // classList carries toggle as well as contains: the landing-page token
    // sync (M3-10) writes wh_main_page through it, and a fake without toggle
    // would throw out of the scheduled update() instead of proving the glue
    // stays inert off a webhelp page.
    const body = {
      classList: {
        contains: (c: string) => c === 'wh_topic_page' && shellOnAtLoad,
        toggle: () => false,
      },
    };
    const doc = {
      body,
      addEventListener: () => {},
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function('document', 'MutationObserver', getWebhelpChromeScript({ crumbLabel: 'x' })) as (
      d: unknown,
      m: unknown,
    ) => void;
    factory(doc, MutationObserverStub);
    return { observingBody: observed.includes(body) };
  }

  it('installs the body observer when the shell is NOT on yet, so a later swap initialises the chrome', () => {
    assert.ok(glueRun(false).observingBody, 'the glue must still watch the body when wh_topic_page is absent at load');
  });

  it('and installs it when the shell is already on', () => {
    assert.ok(glueRun(true).observingBody);
  });
});

describe('webhelp chrome: landing-page body token follows the content (M3-10)', () => {
  // A page switch replaces only #dita-content-root's children, and the body
  // class is document-level, so wh_main_page cannot come from the host on that
  // path -- the glue re-derives it from the content on every update. These run
  // the real script against a fake DOM and let the scheduled update() land.
  interface WhDomOpts { home: boolean; shellOn: boolean }

  function runTokenSync(o: WhDomOpts): { toggled: Array<[string, boolean]> } {
    const toggled: Array<[string, boolean]> = [];
    const body = {
      classList: {
        contains: (c: string) => c === 'wh_topic_page' && o.shellOn,
        toggle: (name: string, on: boolean) => {
          toggled.push([name, on]);
          return on;
        },
      },
    };
    const el = () => ({ innerHTML: '', setAttribute: () => {}, getAttribute: () => null });
    const doc = {
      body,
      addEventListener: () => {},
      getElementById: () => null,
      querySelector: (sel: string) => (sel === '.wh_top_menu' || sel === '.wh_breadcrumb' ? el() : sel === '#dita-content-root .site-home' && o.home ? el() : null),
      querySelectorAll: () => [],
    };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function('document', 'MutationObserver', getWebhelpChromeScript({ crumbLabel: 'x' })) as (
      d: unknown,
      m: unknown,
    ) => void;
    factory(doc, undefined);
    return { toggled };
  }

  const tick = () => new Promise((r) => setTimeout(r, 5));

  it('a webhelp landing page gets the token', async () => {
    const r = runTokenSync({ home: true, shellOn: true });
    await tick();
    assert.ok(r.toggled.some(([n, on]) => n === 'wh_main_page' && on === true), JSON.stringify(r.toggled));
  });

  it('kill test: an ordinary webhelp topic page gets it REMOVED, not left on', () => {
    // Without the `off` half, coming back to a topic from the home page would
    // leave the whole site looking like a landing page to a template's home
    // rules -- the toggle must be two-way.
    const r = runTokenSync({ home: false, shellOn: true });
    return tick().then(() => {
      assert.ok(r.toggled.some(([n, on]) => n === 'wh_main_page' && on === false), JSON.stringify(r.toggled));
    });
  });

  it('an own-DOM (route A) landing page never grows the token', async () => {
    // The home page of a non-webhelp template is the same .site-home markup;
    // syncing there would put a contract class on a page that promises route
    // A's DOM unchanged.
    const r = runTokenSync({ home: true, shellOn: false });
    await tick();
    assert.deepStrictEqual(r.toggled, []);
  });

  it('the content root is observed, so a swap re-derives the token', () => {
    const observed: unknown[] = [];
    class Observer {
      constructor(_cb: unknown) {}
      observe(target: unknown) {
        observed.push(target);
      }
      disconnect() {}
    }
    const content = { id: 'dita-content-root' };
    const body = { classList: { contains: () => true, toggle: () => false } };
    const doc = {
      body,
      addEventListener: () => {},
      getElementById: (id: string) => (id === 'dita-content-root' ? content : null),
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function('document', 'MutationObserver', getWebhelpChromeScript({ crumbLabel: 'x' })) as (
      d: unknown,
      m: unknown,
    ) => void;
    factory(doc, Observer);
    assert.ok(observed.includes(content), 'the glue must watch the content root, not only the toc');
  });
});

describe('webhelp chrome: wiring', () => {
  // mapScript.ts imports vscode, so, like the other wiring tests, read the source.
  const root = join(__dirname, '..', '..', '..');
  const mapScript = readFileSync(join(root, 'src', 'editor', 'webview', 'mapScript.ts'), 'utf8');

  it('the map webview script includes the chrome script, labelled through l10n', () => {
    assert.ok(mapScript.includes("import { getWebhelpChromeScript } from './webhelpChromeScript';"));
    assert.ok(/\$\{getWebhelpChromeScript\(\{[^}]*crumbLabel: L\.siteBreadcrumb/.test(mapScript));
    assert.ok(mapScript.includes("siteBreadcrumb: vscode.l10n.t('Breadcrumb')"));
  });

  it('both l10n bundles carry the breadcrumb label', () => {
    for (const f of ['bundle.l10n.json', 'bundle.l10n.zh-cn.json']) {
      const bundle = JSON.parse(readFileSync(join(root, 'l10n', f), 'utf8')) as Record<string, string>;
      assert.ok(typeof bundle['Breadcrumb'] === 'string' && bundle['Breadcrumb'] !== '', f);
    }
  });

  it('the generated script is valid JavaScript on its own', () => {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    assert.doesNotThrow(() => new Function('document', 'MutationObserver', getWebhelpChromeScript({ crumbLabel: 'x' })));
  });
});
