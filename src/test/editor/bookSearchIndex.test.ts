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
    it('extracts plain body text with markup stripped, in its original casing', () => {
      const p = writeTopic('a.dita', '<p>The Quick <b>Brown</b> Fox.</p>');
      const result = extractBookSearchEntry(p);
      assert.ok(result);
      assert.ok(result!.bodyText.includes('Quick'));
      assert.ok(result!.bodyText.includes('Brown'));
      assert.ok(result!.bodyText.includes('Fox'));
      assert.ok(!result!.bodyText.includes('<b>'), 'markup should be stripped');
    });

    it('does not run words from separate elements together', () => {
      const p = writeTopic('a.dita', '<p>Hello</p><p>World</p>');
      const result = extractBookSearchEntry(p);
      assert.ok(result);
      assert.ok(!result!.bodyText.includes('HelloWorld'), 'element boundaries need a separator, or adjacent words become one unsearchable token');
    });

    it('excludes an indexterm\'s own term text from bodyText, since it is already tracked via indexterms', () => {
      const p = writeTopic('a.dita', '<p>Prose here.</p><indexterm>UniqueTermXyz</indexterm>');
      const result = extractBookSearchEntry(p);
      assert.ok(result);
      assert.ok(!result!.bodyText.includes('UniqueTermXyz'), 'otherwise every indexterm match would also produce a redundant body hit for the same word');
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
      assert.ok(!result!.bodyText.includes('InternalCodenameZephyr'));
      assert.ok(result!.bodyText.includes('Public content'));
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
      assert.strictEqual(result!.indexterms[0].pathText, 'Database backup');
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
      const { hits } = searchBookIndex(index, 'widget', manifest.map((m) => m.absPath));
      assert.strictEqual(hits.length, 2);
      assert.strictEqual(hits[0].absPath, b, 'the indexterm hit (topic B) must come first despite topic A being earlier in the book');
      assert.strictEqual(hits[0].kind, 'indexterm');
      assert.strictEqual(hits[1].absPath, a);
      assert.strictEqual(hits[1].kind, 'body');
    });

    it('matches case-insensitively by default', () => {
      const a = writeTopic('a.dita', '<p>Widget Assembly</p>');
      const manifest = [entry(a, 'A')];
      const index = buildBookSearchIndex(manifest);
      const { hits } = searchBookIndex(index, 'WIDGET', manifest.map((m) => m.absPath));
      assert.strictEqual(hits.length, 1);
    });

    it('respects caseSensitive: true, matching only the exact case', () => {
      const a = writeTopic('a.dita', '<p>Widget Assembly</p>');
      const manifest = [entry(a, 'A')];
      const index = buildBookSearchIndex(manifest);
      const insensitive = searchBookIndex(index, 'WIDGET', manifest.map((m) => m.absPath), { caseSensitive: true });
      assert.strictEqual(insensitive.hits.length, 0, 'wrong case should not match once case sensitivity is on');
      const sensitive = searchBookIndex(index, 'Widget', manifest.map((m) => m.absPath), { caseSensitive: true });
      assert.strictEqual(sensitive.hits.length, 1);
    });

    it('supports useRegex, including finding matches a literal search could not express', () => {
      const a = writeTopic('a.dita', '<p>widget1 widget2 gadget3</p>');
      const manifest = [entry(a, 'A')];
      const index = buildBookSearchIndex(manifest);
      const { hits } = searchBookIndex(index, '\\w+get\\d', manifest.map((m) => m.absPath), { useRegex: true });
      assert.strictEqual(hits.length, 1);
    });

    it('reports an invalid-regex error rather than silently returning zero results', () => {
      const a = writeTopic('a.dita', '<p>Some content that would otherwise match plenty.</p>');
      const manifest = [entry(a, 'A')];
      const index = buildBookSearchIndex(manifest);
      const result = searchBookIndex(index, '(unterminated', manifest.map((m) => m.absPath), { useRegex: true });
      assert.strictEqual(result.error, 'invalid-regex');
      assert.deepStrictEqual(result.hits, []);
    });

    it('an indexterm chip also matches under the same case/regex rules as body text', () => {
      const a = writeTopic('a.dita', '<indexterm>Widget</indexterm>');
      const manifest = [entry(a, 'A')];
      const index = buildBookSearchIndex(manifest);
      const insensitiveMiss = searchBookIndex(index, 'widget', manifest.map((m) => m.absPath), { caseSensitive: true });
      assert.strictEqual(insensitiveMiss.hits.length, 0);
      const hit = searchBookIndex(index, 'Widget', manifest.map((m) => m.absPath), { caseSensitive: true });
      assert.strictEqual(hit.hits.length, 1);
      assert.strictEqual(hit.hits[0].kind, 'indexterm');
    });

    it('returns a snippet with context around the body match', () => {
      const a = writeTopic('a.dita', '<p>Before context widget after context text here for padding.</p>');
      const manifest = [entry(a, 'A')];
      const index = buildBookSearchIndex(manifest);
      const { hits } = searchBookIndex(index, 'widget', manifest.map((m) => m.absPath));
      assert.strictEqual(hits.length, 1);
      assert.ok(hits[0].snippet.toLowerCase().includes('widget'));
      assert.ok(hits[0].snippet.length < 'Before context widget after context text here for padding.'.length + 20);
    });

    it('returns no results for an empty or whitespace-only query', () => {
      const a = writeTopic('a.dita', '<p>Some content.</p>');
      const manifest = [entry(a, 'A')];
      const index = buildBookSearchIndex(manifest);
      assert.deepStrictEqual(searchBookIndex(index, '', manifest.map((m) => m.absPath)).hits, []);
      assert.deepStrictEqual(searchBookIndex(index, '   ', manifest.map((m) => m.absPath)).hits, []);
    });

    it('returns no results when nothing matches', () => {
      const a = writeTopic('a.dita', '<p>Some content.</p>');
      const manifest = [entry(a, 'A')];
      const index = buildBookSearchIndex(manifest);
      assert.deepStrictEqual(searchBookIndex(index, 'nonexistentword', manifest.map((m) => m.absPath)).hits, []);
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
      assert.ok(first.get(a)!.bodyText.includes('Original'));

      writeFileSync(a, topicXml('<p>Updated content.</p>'));
      // Force the mtime forward -- writes within the same tick can land on
      // an identical mtime, which would make this test pass for the wrong
      // reason (stamp coincidentally unchanged rather than genuinely stale).
      const future = new Date(Date.now() + 5000);
      utimesSync(a, future, future);

      const second = getBookSearchIndex(dir, manifest);
      assert.notStrictEqual(first, second);
      assert.ok(second.get(a)!.bodyText.includes('Updated'));
      assert.ok(!second.get(a)!.bodyText.includes('Original'));
    });
  });

  // --- getBookSearchScript (webview UI) ---
  //
  // A minimal but real tree-shaped fake DOM (not just isolated element
  // stubs): the script under test moves real nodes around
  // (appendChild/insertBefore actually relocate a link from .site-nav
  // into the new wrapper div) and queries by selector from a document
  // root, and the thing worth testing IS that relocation + query
  // behavior, not just "does it throw".
  class FakeNode {
    tagName: string;
    id = '';
    innerHTML = '';
    textContent = '';
    title = '';
    value = '';
    placeholder = '';
    style: { cssText: string; display?: string };
    children: FakeNode[] = [];
    parentNode: FakeNode | null = null;
    private attrs: Record<string, string> = {};
    private classSet = new Set<string>();
    private listeners: Record<string, Array<(e: unknown) => void>> = {};

    constructor(tag: string) {
      this.tagName = tag;
      this.style = (() => {
        const s: { cssText: string; display?: string; _cssText?: string } = { cssText: '' };
        Object.defineProperty(s, 'cssText', {
          get() { return s._cssText || ''; },
          set(v: string) {
            s._cssText = v;
            const m = /display\s*:\s*([^;]+)/.exec(v);
            if (m) s.display = m[1].trim();
          },
        });
        return s;
      })();
    }

    get classList() {
      return {
        contains: (c: string) => this.classSet.has(c),
        add: (c: string) => { this.classSet.add(c); },
        remove: (c: string) => { this.classSet.delete(c); },
      };
    }
    set className(v: string) { this.classSet = new Set(v.split(/\s+/).filter(Boolean)); }
    get className(): string { return Array.from(this.classSet).join(' '); }

    setAttribute(name: string, v: string) {
      this.attrs[name] = v;
      if (name === 'class') this.className = v;
    }
    getAttribute(name: string): string | null { return name in this.attrs ? this.attrs[name] : null; }

    get firstChild(): FakeNode | null { return this.children[0] ?? null; }

    appendChild(child: FakeNode) {
      if (child.parentNode) child.parentNode.removeChild(child);
      this.children.push(child);
      child.parentNode = this;
    }
    insertBefore(newNode: FakeNode, ref: FakeNode | null) {
      if (newNode.parentNode) newNode.parentNode.removeChild(newNode);
      const idx = ref ? this.children.indexOf(ref) : -1;
      if (idx === -1) this.children.push(newNode);
      else this.children.splice(idx, 0, newNode);
      newNode.parentNode = this;
    }
    removeChild(child: FakeNode) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) this.children.splice(idx, 1);
      child.parentNode = null;
    }

    addEventListener(evt: string, fn: (e: unknown) => void) {
      (this.listeners[evt] = this.listeners[evt] || []).push(fn);
    }
    fire(evt: string, e: unknown = {}) {
      for (const fn of this.listeners[evt] || []) fn(e);
    }
    focus() {}

    private matches(selector: string): boolean {
      if (selector.startsWith('.')) return selector.slice(1).split('.').every((c) => this.classList.contains(c));
      if (selector.startsWith('[') && selector.endsWith(']')) return this.getAttribute(selector.slice(1, -1)) !== null;
      return false;
    }
    querySelectorAll(selector: string): FakeNode[] {
      const results: FakeNode[] = [];
      const walk = (n: FakeNode) => {
        for (const c of n.children) {
          if (c.matches(selector)) results.push(c);
          walk(c);
        }
      };
      walk(this);
      return results;
    }
    querySelector(selector: string): FakeNode | null {
      return this.querySelectorAll(selector)[0] ?? null;
    }
  }

  function makeFakeSiteDocument(navLinks: Array<{ absPath: string; active?: boolean }>) {
    const root = new FakeNode('root');
    const siteNav = new FakeNode('nav');
    siteNav.className = 'site-nav';
    navLinks.forEach((nl) => {
      const link = new FakeNode('a');
      link.className = 'site-nav-link' + (nl.active ? ' active' : '');
      link.setAttribute('data-site-target', nl.absPath);
      siteNav.appendChild(link);
    });
    root.appendChild(siteNav);

    const globalListeners: Record<string, Array<(e: unknown) => void>> = {};
    const messageListeners: Array<(e: { data: unknown }) => void> = [];
    const posted: Array<{ type: string; [k: string]: unknown }> = [];

    const document = {
      createElement: (tag: string) => new FakeNode(tag),
      querySelector: (sel: string) => root.querySelector(sel),
      querySelectorAll: (sel: string) => root.querySelectorAll(sel),
      getElementById: () => null,
      addEventListener: (evt: string, fn: (e: unknown) => void) => {
        (globalListeners[evt] = globalListeners[evt] || []).push(fn);
      },
    };
    const window = {
      addEventListener: (evt: string, fn: (e: { data: unknown }) => void) => {
        if (evt === 'message') messageListeners.push(fn);
      },
    };
    const vscode = { postMessage: (m: { type: string; [k: string]: unknown }) => posted.push(m) };

    return {
      document,
      window,
      vscode,
      root,
      siteNav,
      posted,
      fireGlobalClick: (target: FakeNode) => {
        for (const fn of globalListeners['click'] || []) fn({ target, preventDefault: () => {} });
      },
      emitMessage: (data: unknown) => messageListeners.forEach((fn) => fn({ data })),
    };
  }

  function runBookSearchScript(navLinks: Array<{ absPath: string; active?: boolean }> = []) {
    const env = makeFakeSiteDocument(navLinks);
    const script = `
      ${getSiteNavClickHandlerScript({ switchSitePageMsgType: 'switchSitePage' })}
      ${getBookSearchScript({
        searchLabel: 'Search this book',
        placeholder: 'Search all topics...',
        noResultsLabel: 'No matches found',
        matchCaseLabel: 'Match case',
        useRegexLabel: 'Use regex',
        invalidRegexLabel: 'Invalid regex',
        requestMsgType: 'bookSearch',
        responseMsgType: 'bookSearchResults',
      })}
      return { siteNavRef: siteNav, input: bookSearchInput, results: bookSearchResults, linksWrap: bsLinksWrap, caseBtn: bsCaseBtn, regexBtn: bsRegexBtn };
    `;
    const fn = new Function('document', 'window', 'vscode', script);
    const api = fn(env.document, env.window, env.vscode) as {
      siteNavRef: FakeNode;
      input: FakeNode;
      results: FakeNode;
      linksWrap: FakeNode;
      caseBtn: FakeNode;
      regexBtn: FakeNode;
    };
    return { ...env, ...api };
  }

  it('builds a script that runs without throwing even with no .site-nav present (tree/book mode)', () => {
    const script = `
      ${getSiteNavClickHandlerScript({ switchSitePageMsgType: 'switchSitePage' })}
      ${getBookSearchScript({
        searchLabel: 'Search this book',
        placeholder: 'Search all topics...',
        noResultsLabel: 'No matches found',
        matchCaseLabel: 'Match case',
        useRegexLabel: 'Use regex',
        invalidRegexLabel: 'Invalid regex',
        requestMsgType: 'bookSearch',
        responseMsgType: 'bookSearchResults',
      })}
    `;
    const fakeDocument = { querySelector: () => null, addEventListener: () => {}, getElementById: () => null };
    const fakeWindow = { addEventListener: () => {} };
    assert.doesNotThrow(() => new Function('document', 'window', 'vscode', script)(fakeDocument, fakeWindow, {}));
  });

  it('inserts the search box above the existing topic links, without losing any of them', () => {
    const { siteNavRef, linksWrap } = runBookSearchScript([{ absPath: '/book/a.dita', active: true }, { absPath: '/book/b.dita' }]);
    assert.strictEqual(linksWrap.children.length, 2, 'both original links should have moved into the wrapper, none lost');
    assert.ok(siteNavRef.children.indexOf(linksWrap) > 0, 'the search box (whatever precedes it) should sit above the link wrapper');
  });

  it('typing a query posts a debounced bookSearch request with the case/regex toggle state', async () => {
    const { input, posted } = runBookSearchScript([{ absPath: '/book/a.dita' }]);
    (input as { value: string }).value = 'widget';
    input.fire('input');
    assert.deepStrictEqual(posted, [], 'should not post immediately -- it is debounced');
    await new Promise((r) => setTimeout(r, 260));
    assert.deepStrictEqual(posted, [{ type: 'bookSearch', query: 'widget', caseSensitive: false, useRegex: false }]);
  });

  it('toggling case/regex buttons changes the flags sent with the next query', async () => {
    const { input, caseBtn, regexBtn, posted } = runBookSearchScript([{ absPath: '/book/a.dita' }]);
    caseBtn.fire('click');
    regexBtn.fire('click');
    (input as { value: string }).value = '\\d+';
    input.fire('input');
    await new Promise((r) => setTimeout(r, 260));
    assert.deepStrictEqual(posted, [{ type: 'bookSearch', query: '\\d+', caseSensitive: true, useRegex: true }]);
  });

  it('clearing the query back to empty hides results and restores the topic list', async () => {
    const { input, results, linksWrap, posted } = runBookSearchScript([{ absPath: '/book/a.dita' }]);
    (input as { value: string }).value = '';
    input.fire('input');
    await new Promise((r) => setTimeout(r, 260));
    assert.deepStrictEqual(posted, [], 'an empty query should not even ask the extension host');
    assert.strictEqual(results.style.display, 'none');
    assert.strictEqual(linksWrap.style.display, '');
  });

  it('renders results and hides the topic list while a non-empty result set is showing', () => {
    const { results, linksWrap, emitMessage } = runBookSearchScript([{ absPath: '/book/a.dita' }]);
    emitMessage({
      type: 'bookSearchResults',
      results: [
        { absPath: '/book/a.dita', title: 'Topic A', kind: 'indexterm', snippet: 'Database \u203a backup' },
        { absPath: '/book/target.dita', title: 'Topic B', kind: 'body', snippet: '...some text...' },
      ],
    });
    assert.strictEqual(results.children.length, 2);
    assert.strictEqual(linksWrap.style.display, 'none');
  });

  it('shows the empty-results label when a search comes back with nothing', () => {
    const { results, emitMessage } = runBookSearchScript();
    emitMessage({ type: 'bookSearchResults', results: [] });
    assert.strictEqual(results.children.length, 1);
    assert.strictEqual(results.children[0].textContent, 'No matches found');
  });

  it('shows the invalid-regex message distinctly from an empty result set', () => {
    const { results, emitMessage } = runBookSearchScript();
    emitMessage({ type: 'bookSearchResults', error: 'invalid-regex' });
    assert.strictEqual(results.children.length, 1);
    assert.strictEqual(results.children[0].textContent, 'Invalid regex');
  });

  // --- integration with the page-level search overlay ---
  //
  // These stub out getSearchOverlayScript's own surface (performSearch,
  // openSearchBar, caseSensitive, useRegex, searchInput, caseBtn, regexBtn,
  // updateToggleVisual) rather than including the real script: that
  // overlay does its own document.createTreeWalker-based DOM text search,
  // already covered by its own tests elsewhere, and simulating a full text
  // tree here would test that mechanism a second time instead of what is
  // actually new -- whether a result click correctly hands off to it (or,
  // for the already-open page, calls it immediately) with the right term
  // and flags.
  function overlayStubScript(): { calls: { openSearchBar: number; performSearch: string[] }; prelude: string } {
    const calls = { openSearchBar: 0, performSearch: [] as string[] };
    const prelude = `
      var caseSensitive = false;
      var useRegex = false;
      var searchInput = { value: '' };
      var caseBtn = {}; var regexBtn = {};
      function updateToggleVisual(btn, active) {}
      function openSearchBar() { __overlayCalls.openSearchBar++; }
      function performSearch(term) { __overlayCalls.performSearch.push(term); }
    `;
    return { calls, prelude };
  }

  function runIntegrationScript(navLinks: Array<{ absPath: string; active?: boolean }>) {
    const env = makeFakeSiteDocument(navLinks);
    const { calls, prelude } = overlayStubScript();
    const script = `
      ${prelude}
      ${getSiteNavClickHandlerScript({ switchSitePageMsgType: 'switchSitePage' })}
      ${getBookSearchScript({
        searchLabel: 'Search this book',
        placeholder: 'Search all topics...',
        noResultsLabel: 'No matches found',
        matchCaseLabel: 'Match case',
        useRegexLabel: 'Use regex',
        invalidRegexLabel: 'Invalid regex',
        requestMsgType: 'bookSearch',
        responseMsgType: 'bookSearchResults',
      })}
      return { input: bookSearchInput, results: bookSearchResults, applyPageSearch: bsApplyPageSearch, getPending: function() { return pendingSiteSearchHighlight; } };
    `;
    const fn = new Function('document', 'window', 'vscode', '__overlayCalls', script);
    const api = fn(env.document, env.window, env.vscode, calls) as {
      input: FakeNode;
      results: FakeNode;
      applyPageSearch: (opts: unknown) => void;
      getPending: () => unknown;
    };
    return { ...env, ...api, overlayCalls: calls };
  }

  it('clicking a result for the page already open applies the page-level search immediately (no page switch to wait for)', () => {
    const { results, emitMessage, posted, input, overlayCalls } = runIntegrationScript([{ absPath: '/book/a.dita', active: true }]);
    (input as { value: string }).value = 'widget';
    emitMessage({
      type: 'bookSearchResults',
      results: [{ absPath: '/book/a.dita', title: 'A', kind: 'body', snippet: 'snippet' }],
    });
    results.children[0].fire('click');
    assert.deepStrictEqual(posted, [], 'already on this page -- no page switch to post');
    assert.strictEqual(overlayCalls.openSearchBar, 1);
    assert.deepStrictEqual(overlayCalls.performSearch, ['widget']);
  });

  it('clicking a result for a different page defers the search-highlight via pendingSiteSearchHighlight, applied once MSG_UPDATE_CONTENT would consume it', () => {
    const { results, emitMessage, posted, input, getPending, applyPageSearch, overlayCalls } = runIntegrationScript([
      { absPath: '/book/a.dita', active: true },
      { absPath: '/book/target.dita' },
    ]);
    (input as { value: string }).value = 'widget';
    emitMessage({
      type: 'bookSearchResults',
      results: [{ absPath: '/book/target.dita', title: 'Target', kind: 'body', snippet: 'snippet' }],
    });
    results.children[0].fire('click');
    assert.deepStrictEqual(posted, [{ type: 'switchSitePage', target: '/book/target.dita' }]);
    assert.strictEqual(overlayCalls.openSearchBar, 0, 'not applied yet -- the target page has not loaded');
    const pending = getPending() as { term: string } | null;
    assert.ok(pending);
    assert.strictEqual(pending!.term, 'widget');

    // Simulates the other half of the hand-off, which lives in
    // MapViewerProvider.ts's MSG_UPDATE_CONTENT handler: once the new
    // page's HTML has actually landed, it calls bsApplyPageSearch with
    // the pending request.
    applyPageSearch(pending);
    assert.strictEqual(overlayCalls.openSearchBar, 1);
    assert.deepStrictEqual(overlayCalls.performSearch, ['widget']);
  });
});
