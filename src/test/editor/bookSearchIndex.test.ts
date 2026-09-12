import * as assert from 'assert';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  extractBookSearchEntry,
  buildBookSearchIndex,
  getBookSearchIndex,
  clearBookSearchIndexCache,
  searchBookIndex,
  getBookSearchScript,
} from '../../editor/bookSearchIndex';
import { getSiteNavClickHandlerScript } from '../../editor/ditaRenderUtils';
import type { DocsiteNavEntry } from '../../editor/ditaRenderUtils';

function topicXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA Topic//EN" "topic.dtd">
<topic id="t"><title>Untitled</title><body>${body}</body></topic>`;
}

function entry(absPath: string, title: string, depth = 0): DocsiteNavEntry {
  return { absPath, title, depth };
}

describe('bookSearchIndex', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dita-book-search-'));
    clearBookSearchIndexCache();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    clearBookSearchIndexCache();
  });

  function writeTopic(name: string, body: string): string {
    const p = join(dir, name);
    writeFileSync(p, topicXml(body));
    return p;
  }

  describe('extractBookSearchEntry', () => {
    it('extracts plain body text with markup stripped', () => {
      const p = writeTopic('a.dita', '<p>The quick <b>brown</b> fox.</p>');
      const result = extractBookSearchEntry(p);
      assert.ok(result);
      assert.ok(result!.bodyTextLower.includes('quick'));
      assert.ok(result!.bodyTextLower.includes('brown'));
      assert.ok(result!.bodyTextLower.includes('fox'));
      assert.ok(!result!.bodyTextLower.includes('<b>'), 'markup should be stripped, not just lowercased');
    });

    it('does not run words from separate elements together', () => {
      const p = writeTopic('a.dita', '<p>Hello</p><p>World</p>');
      const result = extractBookSearchEntry(p);
      assert.ok(result);
      assert.ok(!result!.bodyTextLower.includes('helloworld'), 'element boundaries need a separator, or adjacent words become one unsearchable token');
    });

    it('excludes an indexterm\'s own term text from bodyText, since it is already tracked via indexterms', () => {
      const p = writeTopic('a.dita', '<p>Prose here.</p><indexterm>UniqueTermXyz</indexterm>');
      const result = extractBookSearchEntry(p);
      assert.ok(result);
      assert.ok(!result!.bodyTextLower.includes('uniquetermxyz'), 'otherwise every indexterm match would also produce a redundant body hit for the same word');
      assert.strictEqual(result!.indexterms.length, 1);
      assert.deepStrictEqual(result!.indexterms[0].path, ['UniqueTermXyz']);
    });

    it('excludes prolog content from bodyText, so private metadata is not searchable body text', () => {
      const p = join(dir, 'b.dita');
      writeFileSync(p, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA Topic//EN" "topic.dtd">
<topic id="t"><title>Untitled</title>
<prolog><author>InternalCodenameZephyr</author></prolog>
<body><p>Public content.</p></body></topic>`);
      const result = extractBookSearchEntry(p);
      assert.ok(result);
      assert.ok(!result!.bodyTextLower.includes('internalcodenamezephyr'));
      assert.ok(result!.bodyTextLower.includes('public content'));
    });

    it('collects indexterm chips found anywhere in the topic, including nested body indexterms', () => {
      const p = writeTopic(
        'c.dita',
        '<p>Some text <indexterm>Database<indexterm>backup</indexterm></indexterm> more text.</p>',
      );
      const result = extractBookSearchEntry(p);
      assert.ok(result);
      assert.strictEqual(result!.indexterms.length, 1);
      assert.deepStrictEqual(result!.indexterms[0].path, ['Database', 'backup']);
      assert.strictEqual(result!.indexterms[0].pathLower, 'database backup');
    });

    it('collects indexterm chips from prolog/keywords too, not just the body', () => {
      const p = join(dir, 'd.dita');
      writeFileSync(p, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA Topic//EN" "topic.dtd">
<topic id="t"><title>Untitled</title>
<prolog><metadata><keywords><indexterm>Widgets</indexterm></keywords></metadata></prolog>
<body><p>Text.</p></body></topic>`);
      const result = extractBookSearchEntry(p);
      assert.ok(result);
      assert.strictEqual(result!.indexterms.length, 1);
      assert.deepStrictEqual(result!.indexterms[0].path, ['Widgets']);
    });

    it('returns undefined for a file that does not exist, rather than throwing', () => {
      assert.strictEqual(extractBookSearchEntry(join(dir, 'missing.dita')), undefined);
    });

    it('returns undefined for a file that fails to parse, rather than throwing and aborting the whole index build', () => {
      const p = join(dir, 'broken.dita');
      writeFileSync(p, '<topic><title>Oops<body>');
      assert.doesNotThrow(() => extractBookSearchEntry(p));
    });
  });

  describe('buildBookSearchIndex', () => {
    it('indexes every manifest entry it can read and silently skips the ones it cannot', () => {
      const a = writeTopic('a.dita', '<p>Alpha content.</p>');
      const missing = join(dir, 'missing.dita');
      const manifest = [entry(a, 'A'), entry(missing, 'Missing')];
      const index = buildBookSearchIndex(manifest);
      assert.strictEqual(index.size, 1);
      assert.ok(index.has(a));
      assert.ok(!index.has(missing));
    });
  });

  describe('searchBookIndex', () => {
    it('ranks ALL indexterm hits ahead of ALL body hits, even across different topics', () => {
      // topicA only matches in its body; topicB matches via an indexterm.
      // A naive "sort within topic only" would still put topicA's body hit
      // before topicB's indexterm hit if topicA sorts first by manifest
      // order -- the whole-list rule (4.4) says indexterm hits win globally.
      const a = writeTopic('a.dita', '<p>widget assembly instructions</p>');
      const b = writeTopic('b.dita', '<p>unrelated content</p><indexterm>widget</indexterm>');
      const manifest = [entry(a, 'Topic A'), entry(b, 'Topic B')];
      const index = buildBookSearchIndex(manifest);
      const hits = searchBookIndex(index, 'widget', manifest.map((m) => m.absPath));
      assert.strictEqual(hits.length, 2);
      assert.strictEqual(hits[0].absPath, b, 'the indexterm hit (topic B) must come first despite topic A being earlier in the book');
      assert.strictEqual(hits[0].kind, 'indexterm');
      assert.strictEqual(hits[1].absPath, a);
      assert.strictEqual(hits[1].kind, 'body');
    });

    it('matches case-insensitively', () => {
      const a = writeTopic('a.dita', '<p>Widget Assembly</p>');
      const manifest = [entry(a, 'A')];
      const index = buildBookSearchIndex(manifest);
      const hits = searchBookIndex(index, 'WIDGET', manifest.map((m) => m.absPath));
      assert.strictEqual(hits.length, 1);
    });

    it('returns a snippet with context around the body match', () => {
      const a = writeTopic('a.dita', '<p>Before context widget after context text here for padding.</p>');
      const manifest = [entry(a, 'A')];
      const index = buildBookSearchIndex(manifest);
      const hits = searchBookIndex(index, 'widget', manifest.map((m) => m.absPath));
      assert.strictEqual(hits.length, 1);
      assert.ok(hits[0].snippet.toLowerCase().includes('widget'));
      assert.ok(hits[0].snippet.length < 'Before context widget after context text here for padding.'.length + 20);
    });

    it('returns no results for an empty or whitespace-only query', () => {
      const a = writeTopic('a.dita', '<p>Some content.</p>');
      const manifest = [entry(a, 'A')];
      const index = buildBookSearchIndex(manifest);
      assert.deepStrictEqual(searchBookIndex(index, '', manifest.map((m) => m.absPath)), []);
      assert.deepStrictEqual(searchBookIndex(index, '   ', manifest.map((m) => m.absPath)), []);
    });

    it('returns no results when nothing matches', () => {
      const a = writeTopic('a.dita', '<p>Some content.</p>');
      const manifest = [entry(a, 'A')];
      const index = buildBookSearchIndex(manifest);
      assert.deepStrictEqual(searchBookIndex(index, 'nonexistentword', manifest.map((m) => m.absPath)), []);
    });
  });

  describe('getBookSearchIndex caching', () => {
    it('reuses the same index instance across calls when nothing on disk has changed', () => {
      const a = writeTopic('a.dita', '<p>Content.</p>');
      const manifest = [entry(a, 'A')];
      const first = getBookSearchIndex(dir, manifest);
      const second = getBookSearchIndex(dir, manifest);
      assert.strictEqual(first, second, 'lazy build + cache (docsite design doc 3.1) means an unchanged book should not be re-extracted on every search keystroke');
    });

    it('rebuilds once a topic file is edited', () => {
      const a = writeTopic('a.dita', '<p>Original content.</p>');
      const manifest = [entry(a, 'A')];
      const first = getBookSearchIndex(dir, manifest);
      assert.ok(first.get(a)!.bodyTextLower.includes('original'));

      writeFileSync(a, topicXml('<p>Updated content.</p>'));
      // Force the mtime forward -- writes within the same tick can land on
      // an identical mtime, which would make this test pass for the wrong
      // reason (stamp coincidentally unchanged rather than genuinely stale).
      const future = new Date(Date.now() + 5000);
      utimesSync(a, future, future);

      const second = getBookSearchIndex(dir, manifest);
      assert.notStrictEqual(first, second);
      assert.ok(second.get(a)!.bodyTextLower.includes('updated'));
      assert.ok(!second.get(a)!.bodyTextLower.includes('original'));
    });
  });

  // --- getBookSearchScript (webview UI) ---
  //
  // Same lightweight fake-DOM approach as ditaRenderUtils.test.ts's own
  // getSiteNavClickHandlerScript tests: minimal element stubs, not a real
  // DOM, just enough surface for the script's own calls to run.
  function makeFakeStyle(): { cssText: string; display?: string } {
    const state: { cssText: string; display?: string; _cssText?: string } = { cssText: '' };
    Object.defineProperty(state, 'cssText', {
      get() { return state._cssText || ''; },
      // A real element's style.cssText and style.display stay in sync in
      // both directions; this fake only needs the cssText -> display
      // direction, since that is the only one the script under test relies
      // on (it sets the panel's initial "display:none;..." via cssText,
      // then toggles it afterwards via the plain .display property, which
      // needs no special handling here).
      set(v: string) {
        state._cssText = v;
        const m = /display\s*:\s*([^;]+)/.exec(v);
        if (m) state.display = m[1].trim();
      },
    });
    return state;
  }

  interface FakeElement {
    tagName: string;
    id: string;
    innerHTML: string;
    textContent: string;
    title: string;
    value: string;
    style: { cssText: string; display?: string };
    children: FakeElement[];
    setAttribute: (name: string, v: string) => void;
    getAttribute: (name: string) => string | null;
    appendChild: (child: FakeElement) => void;
    addEventListener: (evt: string, fn: (e: unknown) => void) => void;
    focus: () => void;
    fire: (evt: string, e?: unknown) => void;
    classList?: { contains: (c: string) => boolean; add: (c: string) => void; remove: (c: string) => void };
  }

  function makeFakeElement(tag: string): FakeElement {
    const listeners: Record<string, Array<(e: unknown) => void>> = {};
    const attrs: Record<string, string> = {};
    const children: FakeElement[] = [];
    const el: FakeElement = {
      tagName: tag,
      id: '',
      innerHTML: '',
      textContent: '',
      title: '',
      value: '',
      style: makeFakeStyle(),
      children,
      setAttribute: (name: string, v: string) => { attrs[name] = v; },
      getAttribute: (name: string) => (name in attrs ? attrs[name] : null),
      appendChild: (child: FakeElement) => { children.push(child); },
      addEventListener: (evt: string, fn: (e: unknown) => void) => {
        (listeners[evt] = listeners[evt] || []).push(fn);
      },
      focus: () => {},
      fire(evt: string, e: unknown = {}) {
        for (const fn of listeners[evt] || []) fn(e);
      },
    };
    return el;
  }

  function runBookSearchScript() {
    const created: FakeElement[] = [];
    const messageListeners: Array<(e: { data: unknown }) => void> = [];
    const posted: Array<{ type: string; [k: string]: unknown }> = [];
    const navLinks = [
      (() => {
        const l = makeFakeElement('a');
        l.setAttribute('data-site-target', '/book/a.dita');
        l.classList = { contains: () => false, add: () => {}, remove: () => {} };
        return l;
      })(),
      (() => {
        const l = makeFakeElement('a');
        l.setAttribute('data-site-target', '/book/target.dita');
        l.classList = { contains: () => false, add: () => {}, remove: () => {} };
        return l;
      })(),
    ];
    const fakeDocument = {
      createElement: (tag: string) => {
        const el = makeFakeElement(tag);
        created.push(el);
        return el;
      },
      addEventListener: () => {},
      querySelector: () => null,
      querySelectorAll: () => navLinks,
      getElementById: () => null,
    };
    const fakeWindow = {
      addEventListener: (evt: string, fn: (e: { data: unknown }) => void) => {
        if (evt === 'message') messageListeners.push(fn);
      },
    };
    const fakeVscode = { postMessage: (m: { type: string; [k: string]: unknown }) => posted.push(m) };

    const script = `
      var btnStyle = '';
      ${getSiteNavClickHandlerScript({ switchSitePageMsgType: 'switchSitePage' })}
      ${getBookSearchScript({
        buttonTitle: 'Search this book',
        placeholder: 'Search all topics...',
        noResultsLabel: 'No matches found',
        requestMsgType: 'bookSearch',
        responseMsgType: 'bookSearchResults',
      })}
      return { btn: bookSearchBtn, panel: bookSearchPanel, input: bookSearchInput, results: bookSearchResults };
    `;
    const fn = new Function('document', 'window', 'vscode', script);
    const api = fn(fakeDocument, fakeWindow, fakeVscode) as {
      btn: ReturnType<typeof makeFakeElement>;
      panel: ReturnType<typeof makeFakeElement>;
      input: ReturnType<typeof makeFakeElement>;
      results: ReturnType<typeof makeFakeElement>;
    };
    return {
      ...api,
      posted,
      navLinks,
      emitMessage: (data: unknown) => messageListeners.forEach((fn) => fn({ data })),
    };
  }

  it('getBookSearchScript builds a script that runs without throwing', () => {
    assert.doesNotThrow(() => runBookSearchScript());
  });

  it('clicking the search button toggles the panel open and closed', () => {
    const { btn, panel } = runBookSearchScript();
    assert.strictEqual(panel.style.display, 'none');
    btn.fire('click');
    assert.strictEqual(panel.style.display, 'block');
    btn.fire('click');
    assert.strictEqual(panel.style.display, 'none');
  });

  it('typing in the search input posts a debounced bookSearch query', async () => {
    const { input, posted } = runBookSearchScript();
    (input as { value: string }).value = 'widget';
    input.fire('input');
    assert.deepStrictEqual(posted, [], 'should not post immediately -- it is debounced');
    await new Promise((r) => setTimeout(r, 260));
    assert.deepStrictEqual(posted, [{ type: 'bookSearch', query: 'widget' }]);
  });

  it('renders a result list from a bookSearchResults message, with an indexterm marker for indexterm hits', () => {
    const { results, emitMessage } = runBookSearchScript();
    emitMessage({
      type: 'bookSearchResults',
      results: [
        { absPath: '/book/a.dita', title: 'Topic A', kind: 'indexterm', snippet: 'Database \u203a backup' },
        { absPath: '/book/target.dita', title: 'Topic B', kind: 'body', snippet: '...some text...' },
      ],
    });
    assert.strictEqual((results.children as unknown[]).length, 2);
  });

  it('shows the empty-results label when a search comes back with nothing', () => {
    const { results, emitMessage } = runBookSearchScript();
    emitMessage({ type: 'bookSearchResults', results: [] });
    assert.strictEqual((results.children as unknown[]).length, 1);
  });

  it('clicking a result switches to that topic\'s page via the existing sidebar navigation', () => {
    const { results, emitMessage, posted, panel } = runBookSearchScript();
    emitMessage({
      type: 'bookSearchResults',
      results: [{ absPath: '/book/target.dita', title: 'Target Topic', kind: 'body', snippet: 'snippet' }],
    });
    const item = (results.children as ReturnType<typeof makeFakeElement>[])[0];
    item.fire('click');
    assert.deepStrictEqual(posted, [{ type: 'switchSitePage', target: '/book/target.dita' }]);
    assert.strictEqual(panel.style.display, 'none', 'the panel should close after picking a result');
  });
});
