import * as assert from 'assert';
import { MapPanelController, MapPanelHost, PanelScheduler } from '../../editor/mapPanelController';
import type { GeneratedMapHtml, RenderedMapContent, SiteManifestCache } from '../../editor/mapRenderTypes';
import type { MapViewState } from '../../editor/mapViewState';
import type { BookPart } from '../../editor/bookPatch';
import { MSG_PATCH_CONTENT, MSG_SWITCH_MODE, MSG_UPDATE_CONTENT, MSG_UPDATE_SIDEBAR } from '../../editor/mapMessages';
import { SITE_HOME_TARGET } from '../../editor/webview/toolbarScripts';

/**
 * The per-panel state of a map preview -- which mode is on screen, what the
 * last render read, what is owed to a hidden panel, what to diff the next
 * refresh against -- used to live as ~15 `let`s inside
 * MapViewerProvider.resolveCustomTextEditor, reachable only by opening a real
 * VS Code. It is a class over an injected host now, so these cases drive it
 * with a fake one.
 */

type Posted = Record<string, unknown>;

interface Fake {
  host: MapPanelHost;
  html: string[];
  posted: Posted[];
  stored: MapViewState[];
  rendered: string[];
  calls: string[];
  timers: Array<() => void>;
  state: { visible: boolean; stored: MapViewState | undefined; full: (mode: string, page: string | undefined) => GeneratedMapHtml; content: (mode: string, page?: string) => RenderedMapContent; manifest: SiteManifestCache | undefined; topic: (page: string) => { html?: string; error?: string } };
  scheduler: PanelScheduler;
}

function fake(init: Partial<Fake['state']> = {}): Fake {
  const f: Fake = {
    html: [], posted: [], stored: [], rendered: [], calls: [], timers: [],
    state: {
      visible: true,
      stored: undefined,
      full: (mode) => ({ html: `<full ${mode}>` }),
      content: (mode) => ({ html: `<content ${mode}>` }),
      manifest: undefined,
      topic: (page) => ({ html: `<topic ${page}>` }),
      ...init,
    },
    host: undefined as unknown as MapPanelHost,
    scheduler: undefined as unknown as PanelScheduler,
  };
  f.scheduler = { set: (fn) => { f.timers.push(fn); return f.timers.length - 1; }, clear: (h) => { f.timers[h as number] = () => undefined; } };
  f.host = {
    isVisible: () => f.state.visible,
    setHtml: (h) => { f.html.push(h); f.calls.push('setHtml'); },
    post: (m) => { f.posted.push(m as Posted); },
    loadingHtml: () => '<loading>',
    generateHtml: (mode, page) => { f.calls.push(`full:${mode}`); return f.state.full(mode, page); },
    renderMapContent: (mode, page) => { f.calls.push(`content:${mode}`); return f.state.content(mode, page); },
    loadSiteManifest: () => f.state.manifest,
    renderSiteHome: () => '<home>',
    renderSiteTopic: (page) => f.state.topic(page) as { html: string },
    readViewState: () => f.state.stored,
    writeViewState: (s) => { f.stored.push(s); f.state.stored = s; },
    recordRenderedHtml: (h) => { f.rendered.push(h); },
    nextTick: () => Promise.resolve(),
  };
  return f;
}

const part = (key: string, html: string): BookPart => ({ key, html } as unknown as BookPart);
const manifest = (...paths: string[]): SiteManifestCache => ({
  manifest: paths.map((p) => ({ title: p, absPath: p, href: p, depth: 0 })) as unknown as SiteManifestCache['manifest'],
  keyMap: new Map(),
  bookMembers: new Set(paths),
});
const make = (f: Fake): MapPanelController => new MapPanelController(f.host, f.scheduler);

describe('MapPanelController: first render and the remembered view', () => {
  it('opens in the outline tree when nothing is remembered', async () => {
    const f = fake();
    const c = make(f);
    await c.start();
    assert.strictEqual(c.mode, 'tree');
    assert.deepStrictEqual(f.html, ['<full tree>']);
    assert.deepStrictEqual(f.rendered, ['<full tree>']);
  });

  it('opens in the remembered mode and page', async () => {
    const f = fake({ stored: { mode: 'site', sitePage: '/m/a.dita' } });
    const c = make(f);
    await c.start();
    assert.strictEqual(c.mode, 'site');
    assert.strictEqual(c.sitePage, '/m/a.dita');
  });

  it('book mode puts the placeholder up and yields before the synchronous render', async () => {
    const f = fake({ stored: { mode: 'book' } });
    const order: string[] = [];
    f.host.setHtml = (h) => { order.push(`html:${h}`); };
    f.host.nextTick = () => { order.push('tick'); return Promise.resolve(); };
    f.host.generateHtml = (m) => { order.push(`render:${m}`); return { html: '<book>' }; };
    await make(f).start();
    assert.deepStrictEqual(order, ['html:<loading>', 'tick', 'render:book', 'html:<book>']);
  });

  it('a panel disposed while the placeholder is up renders nothing', async () => {
    const f = fake({ stored: { mode: 'book' } });
    const c = make(f);
    f.host.nextTick = () => { c.dispose(); return Promise.resolve(); };
    await c.start();
    assert.ok(!f.calls.includes('full:book'));
  });

  it('a remembered mode whose first render fails falls back to the outline and keeps the memory', async () => {
    const f = fake({
      stored: { mode: 'site', sitePage: '/m/a.dita' },
      full: (mode) => (mode === 'site' ? { html: '<err>', failed: true } : { html: '<full tree>' }),
    });
    const c = make(f);
    await c.start();
    assert.strictEqual(c.mode, 'tree');
    assert.deepStrictEqual(f.html, ['<full tree>']);
    assert.deepStrictEqual(f.stored, [], 'the stopgap outline must not overwrite the remembered mode');
  });

  it('the same failure after a mode was already proven does not change the mode', async () => {
    const f = fake({ stored: { mode: 'site' } });
    const c = make(f);
    await c.start();
    f.state.full = () => ({ html: '<err>', failed: true });
    await c.requestFullRender();
    assert.strictEqual(c.mode, 'site');
    assert.deepStrictEqual(f.html, ['<full site>', '<err>']);
  });

  it('remembers the mode and page once a render succeeded, and only when they changed', async () => {
    const f = fake({ full: (mode) => ({ html: `<full ${mode}>`, resolvedSitePage: '/m/a.dita' }) });
    const c = make(f);
    await c.start();
    assert.deepStrictEqual(f.stored, [{ mode: 'tree', sitePage: '/m/a.dita' }]);
    await c.requestFullRender();
    assert.strictEqual(f.stored.length, 1, 'an unchanged view is not written again');
  });
});

describe('MapPanelController: switching mode in place', () => {
  const stage = { mode: 'book', bodyClass: 'mode-book', templateCss: '', templateDataAttr: '', selectedTemplate: '', shellHtml: '<b/>', isShell: true };

  it('renders the target mode, commits its state and posts the stage without reloading', async () => {
    const f = fake({ full: (mode) => ({ html: `<full ${mode}>`, stage: { ...stage, mode: mode as 'book' } }) });
    const c = make(f);
    await c.start();
    f.html.length = 0;
    c.switchMode('book');
    assert.strictEqual(c.mode, 'book');
    assert.deepStrictEqual(f.html, []);
    assert.deepStrictEqual(f.posted, [{ type: MSG_SWITCH_MODE, stage: { ...stage, mode: 'book' } }]);
    assert.strictEqual(f.rendered[f.rendered.length - 1], '<full book>');
  });

  it('a render that failed reloads the document in the new mode instead', async () => {
    const f = fake();
    const c = make(f);
    await c.start();
    f.state.full = () => ({ html: '<err>', failed: true });
    c.switchMode('site');
    assert.strictEqual(c.mode, 'site');
    assert.deepStrictEqual(f.posted, []);
    assert.strictEqual(f.html[f.html.length - 1], '<err>');
  });

  it('a render with no stage reloads too', async () => {
    const f = fake();
    const c = make(f);
    await c.start();
    c.switchMode('site');
    assert.deepStrictEqual(f.posted, []);
    assert.strictEqual(f.html[f.html.length - 1], '<full site>');
  });

  it('onto the error page reloads, because that page has no script to receive a message', async () => {
    const f = fake({ full: () => ({ html: '<err>', failed: true }) });
    const c = make(f);
    await c.start();
    f.state.full = (mode) => ({ html: `<full ${mode}>`, stage: { ...stage, mode: mode as 'book' } });
    c.switchMode('site');
    assert.deepStrictEqual(f.posted, []);
    assert.strictEqual(f.html[f.html.length - 1], '<full site>');
  });

  it("the person's own switch clears the fallback's hold on the remembered view", async () => {
    const f = fake({
      stored: { mode: 'site' },
      full: (mode) => (mode === 'site' ? { html: '<err>', failed: true } : { html: `<full ${mode}>`, stage: { ...stage, mode: mode as 'book' } }),
    });
    const c = make(f);
    await c.start();
    assert.deepStrictEqual(f.stored, []);
    c.switchMode('book');
    assert.deepStrictEqual(f.stored, [{ mode: 'book' }]);
  });
});

describe('MapPanelController: a source edit in outline and book mode', () => {
  it('outline mode sends the whole content', async () => {
    const f = fake();
    const c = make(f);
    await c.start();
    c.requestUpdate('content');
    assert.deepStrictEqual(f.posted, [{ type: MSG_UPDATE_CONTENT, html: '<content tree>' }]);
  });

  it('a failed render falls back to a full reload', async () => {
    const f = fake();
    const c = make(f);
    await c.start();
    f.state.content = () => ({ error: 'bad map' });
    f.html.length = 0;
    c.requestUpdate('content');
    assert.deepStrictEqual(f.posted, []);
    assert.deepStrictEqual(f.html, ['<full tree>']);
  });

  it('once the page on screen is the error page, a content update escalates to a full one', async () => {
    const f = fake({ full: () => ({ html: '<err>', failed: true }) });
    const c = make(f);
    await c.start();
    f.state.full = () => ({ html: '<ok>' });
    c.requestUpdate('content');
    assert.deepStrictEqual(f.posted, []);
    assert.strictEqual(f.html[f.html.length - 1], '<ok>');
  });

  describe('book mode', () => {
    const book = (parts: BookPart[], sidebar?: string): RenderedMapContent => ({ html: '<book>', parts, sidebarTreeHtml: sidebar });

    it('patches only what changed, and sends the sidebar only when it did', async () => {
      const f = fake({
        stored: { mode: 'book' },
        full: () => ({ html: '<book>', parts: [part('a', '1'), part('b', '2')], sidebarTreeHtml: '<ul>1</ul>' }),
        content: () => book([part('a', '1'), part('b', 'CHANGED')], '<ul>1</ul>'),
      });
      const c = make(f);
      await c.start();
      c.requestUpdate('content');
      assert.strictEqual(f.posted.length, 1);
      assert.strictEqual(f.posted[0].type, MSG_PATCH_CONTENT);
      assert.strictEqual(f.posted[0].count, 2);
    });

    it('sends a changed sidebar even when no part changed', async () => {
      const f = fake({
        stored: { mode: 'book' },
        full: () => ({ html: '<book>', parts: [part('a', '1')], sidebarTreeHtml: '<ul>old</ul>' }),
        content: () => book([part('a', '1')], '<ul>new</ul>'),
      });
      const c = make(f);
      await c.start();
      c.requestUpdate('content');
      assert.deepStrictEqual(f.posted, [{ type: MSG_UPDATE_SIDEBAR, html: '<ul>new</ul>' }]);
    });

    it('remembers the sidebar it sent, so a second edit that leaves it alone does not resend it', async () => {
      let sidebar = '<ul>new</ul>';
      const f = fake({
        stored: { mode: 'book' },
        full: () => ({ html: '<book>', parts: [part('a', '1')], sidebarTreeHtml: '<ul>old</ul>' }),
        content: () => book([part('a', '1')], sidebar),
      });
      const c = make(f);
      await c.start();
      c.requestUpdate('content');
      c.requestUpdate('content');
      assert.deepStrictEqual(f.posted, [{ type: MSG_UPDATE_SIDEBAR, html: '<ul>new</ul>' }]);
      sidebar = '<ul>newer</ul>';
      c.requestUpdate('content');
      assert.strictEqual(f.posted.length, 2);
      assert.strictEqual(f.posted[1].html, '<ul>newer</ul>');
    });

    it('sends nothing when neither parts nor sidebar changed', async () => {
      const f = fake({
        stored: { mode: 'book' },
        full: () => ({ html: '<book>', parts: [part('a', '1')], sidebarTreeHtml: '<ul/>' }),
        content: () => book([part('a', '1')], '<ul/>'),
      });
      const c = make(f);
      await c.start();
      c.requestUpdate('content');
      assert.deepStrictEqual(f.posted, []);
    });

    it('sends the whole document when there is no baseline to diff against', async () => {
      const f = fake({ stored: { mode: 'book' }, full: () => ({ html: '<book>' }), content: () => book([part('a', '1')]) });
      const c = make(f);
      await c.start();
      c.requestUpdate('content');
      assert.deepStrictEqual(f.posted, [{ type: MSG_UPDATE_CONTENT, html: '<book>' }]);
    });
  });
});

describe('MapPanelController: site mode', () => {
  const siteFull = (page = '/m/a.dita'): ((mode: string) => GeneratedMapHtml) => (mode) => ({
    html: `<full ${mode}>`,
    resolvedSitePage: page,
    siteManifest: manifest('/m/a.dita', '/m/b.dita').manifest,
    siteKeyMap: new Map(),
    siteBookMembers: new Set(['/m/a.dita', '/m/b.dita']),
    siteRender: { sidebarTreeHtml: '<ul>1</ul>', pageHtml: '<p>a</p>' },
    files: new Set(['/m/a.ditamap', '/m/a.dita', '/m/b.dita']),
    pageFiles: new Set(['/m/a.dita']),
  });
  const siteContent = (sidebar: string, page: string): RenderedMapContent => ({
    html: page,
    sidebarTreeHtml: sidebar,
    resolvedSitePage: '/m/a.dita',
    siteManifest: manifest('/m/a.dita', '/m/b.dita').manifest,
    siteKeyMap: new Map(),
    siteBookMembers: new Set(['/m/a.dita', '/m/b.dita']),
    files: new Set(['/m/a.dita']),
    pageFiles: new Set(['/m/a.dita']),
  });

  it('adopts the page the render resolved, so a stale remembered page does not stick', async () => {
    const f = fake({ stored: { mode: 'site', sitePage: '/gone.dita' }, full: siteFull('/m/a.dita') });
    const c = make(f);
    await c.start();
    assert.strictEqual(c.sitePage, '/m/a.dita');
  });

  it('an edit refreshes in place: sidebar first, then page, each only if it differs', async () => {
    const f = fake({ stored: { mode: 'site' }, full: siteFull(), content: () => siteContent('<ul>2</ul>', '<p>b</p>') });
    const c = make(f);
    await c.start();
    c.requestUpdate('content');
    assert.deepStrictEqual(f.posted, [
      { type: MSG_UPDATE_SIDEBAR, html: '<ul>2</ul>' },
      { type: MSG_UPDATE_CONTENT, html: '<p>b</p>' },
    ]);
  });

  it('sends nothing for an edit that changed neither half', async () => {
    const f = fake({ stored: { mode: 'site' }, full: siteFull(), content: () => siteContent('<ul>1</ul>', '<p>a</p>') });
    const c = make(f);
    await c.start();
    c.requestUpdate('content');
    assert.deepStrictEqual(f.posted, []);
  });

  it('a render that cannot refresh in place reloads instead', async () => {
    const f = fake({ stored: { mode: 'site' }, full: siteFull(), content: () => ({ html: 'x' }) });
    const c = make(f);
    await c.start();
    f.html.length = 0;
    c.requestUpdate('content');
    assert.deepStrictEqual(f.posted, []);
    assert.deepStrictEqual(f.html, ['<full site>']);
  });

  describe('switching page', () => {
    it('renders the chosen topic from the cached manifest and posts only the content', async () => {
      const f = fake({ stored: { mode: 'site' }, full: siteFull() });
      const c = make(f);
      await c.start();
      c.switchSitePage('/m/b.dita');
      assert.strictEqual(c.sitePage, '/m/b.dita');
      assert.deepStrictEqual(f.posted, [{ type: MSG_UPDATE_CONTENT, html: '<topic /m/b.dita>' }]);
      assert.deepStrictEqual(f.stored[f.stored.length - 1], { mode: 'site', sitePage: '/m/b.dita' });
    });

    it('ignores a switch to the page already shown', async () => {
      const f = fake({ stored: { mode: 'site' }, full: siteFull() });
      const c = make(f);
      await c.start();
      c.switchSitePage('/m/a.dita');
      assert.deepStrictEqual(f.posted, []);
    });

    it('the home sentinel goes home rather than falling back to the first topic', async () => {
      const f = fake({ stored: { mode: 'site' }, full: siteFull() });
      const c = make(f);
      await c.start();
      c.switchSitePage(SITE_HOME_TARGET);
      assert.deepStrictEqual(f.posted, [{ type: MSG_UPDATE_CONTENT, html: '<home>' }]);
      assert.strictEqual(c.sitePage, SITE_HOME_TARGET);
    });

    it('a page the manifest does not have falls back to the first topic', async () => {
      const f = fake({ stored: { mode: 'site' }, full: siteFull('/m/b.dita') });
      const c = make(f);
      await c.start();
      c.switchSitePage('/m/zzz.dita');
      assert.strictEqual(c.sitePage, '/m/a.dita');
    });

    it('a topic that fails to render reloads to show the error', async () => {
      const f = fake({ stored: { mode: 'site' }, full: siteFull(), topic: () => ({ error: 'boom' }) });
      const c = make(f);
      await c.start();
      f.html.length = 0;
      c.switchSitePage('/m/b.dita');
      assert.deepStrictEqual(f.posted, []);
      assert.deepStrictEqual(f.html, ['<full site>']);
    });
  });
});

describe('MapPanelController: a hidden panel', () => {
  it('defers an edit and settles it once when it comes back', async () => {
    const f = fake();
    const c = make(f);
    await c.start();
    f.state.visible = false;
    c.requestUpdate('content');
    c.requestUpdate('content');
    assert.deepStrictEqual(f.posted, []);
    f.state.visible = true;
    c.onVisibilityChanged();
    assert.strictEqual(f.posted.length, 1);
    c.onVisibilityChanged();
    assert.strictEqual(f.posted.length, 1, 'the debt is cleared once settled');
  });

  it('a full request is never downgraded by an edit that lands after it', async () => {
    const f = fake();
    const c = make(f);
    await c.start();
    f.state.visible = false;
    c.requestUpdate('full');
    c.requestUpdate('content');
    f.html.length = 0;
    f.state.visible = true;
    c.onVisibilityChanged();
    assert.deepStrictEqual(f.html, ['<full tree>']);
  });

  it('does nothing on becoming visible when nothing is owed', async () => {
    const f = fake();
    const c = make(f);
    await c.start();
    f.calls.length = 0;
    c.onVisibilityChanged();
    assert.deepStrictEqual(f.calls, []);
  });
});

describe('MapPanelController: what concerns this panel', () => {
  const siteState = (): Partial<Fake['state']> => ({
    stored: { mode: 'site' },
    full: () => ({
      html: '<full site>',
      resolvedSitePage: '/m/a.dita',
      siteManifest: manifest('/m/a.dita').manifest,
      siteKeyMap: new Map(),
      siteBookMembers: new Set(['/m/a.dita']),
      siteRender: { sidebarTreeHtml: '<ul/>', pageHtml: '<p/>' },
      files: new Set(['/m/a.ditamap', '/m/a.dita', '/m/other.dita']),
      pageFiles: new Set(['/m/a.dita']),
    }),
    content: () => ({
      html: '<p/>', sidebarTreeHtml: '<ul/>', resolvedSitePage: '/m/a.dita',
      siteManifest: manifest('/m/a.dita').manifest, siteKeyMap: new Map(), siteBookMembers: new Set(['/m/a.dita']),
      files: new Set(['/m/a.dita']), pageFiles: new Set(['/m/a.dita']),
    }),
  });

  it('typing in the map itself schedules a debounced content refresh', async () => {
    const f = fake();
    const c = make(f);
    await c.start();
    c.onDocumentChanged();
    c.onDocumentChanged();
    assert.strictEqual(f.timers.length, 2, 'each keystroke re-arms the timer');
    f.timers[1]();
    assert.strictEqual(f.posted.length, 1);
  });

  it('ignores a change to a file the last render did not read', async () => {
    const f = fake(siteState());
    const c = make(f);
    await c.start();
    c.onReferencedFileEvent({ kind: 'change', fromEditor: true }, '/elsewhere/unrelated.dita');
    assert.deepStrictEqual(f.timers, []);
  });

  it('unsaved text in another file the page did not read leaves a site panel alone', async () => {
    const f = fake(siteState());
    const c = make(f);
    await c.start();
    c.onReferencedFileEvent({ kind: 'change', fromEditor: true }, '/m/other.dita');
    assert.deepStrictEqual(f.timers, []);
  });

  it('unsaved text in a file the page read refreshes just the page', async () => {
    const f = fake(siteState());
    const c = make(f);
    await c.start();
    c.onReferencedFileEvent({ kind: 'change', fromEditor: true }, '/m/a.dita');
    assert.strictEqual(f.timers.length, 1);
    f.timers[0]();
    assert.deepStrictEqual(f.posted, [{ type: MSG_UPDATE_CONTENT, html: '<topic /m/a.dita>' }]);
  });

  it('a saved change to any dependency refreshes the sidebar too', async () => {
    const f = fake(siteState());
    const c = make(f);
    await c.start();
    f.calls.length = 0;
    c.onReferencedFileEvent({ kind: 'change', fromEditor: false }, '/m/a.dita');
    f.timers[0]();
    assert.ok(f.calls.includes('content:site'), 'a whole-map render, not a page switch');
  });

  it('a key-context change is treated as a map edit', async () => {
    const f = fake(siteState());
    const c = make(f);
    await c.start();
    f.calls.length = 0;
    c.onKeyContextChanged();
    assert.ok(f.calls.includes('content:site'));
  });

  it('after dispose nothing renders or posts', async () => {
    const f = fake();
    const c = make(f);
    await c.start();
    f.calls.length = 0;
    c.dispose();
    c.requestUpdate('full');
    c.requestUpdate('content');
    c.switchSitePage('/x');
    c.onReferencedFileEvent({ kind: 'create' }, '/m/a.dita');
    assert.deepStrictEqual(f.calls, []);
    assert.deepStrictEqual(f.posted, []);
  });
});
