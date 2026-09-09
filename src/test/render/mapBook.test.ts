import * as assert from 'assert';
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { collectMapEntries } from '../../render/mapTypeMap';
import type { MapEntry } from '../../render/mapTypeMap';
import { parseDitamap, preprocessEntities } from '../../parser/ditaParser';
import {
  renderBookPlaceholder,
  renderBookError,
  renderBookSkipMessage,
  renderBookEntries,
  renderBookParts,
  wrapBookParts,
  clearTopicRenderCache,
  resolveBookTopicPath,
  buildBookNavManifest,
  renderSiteNavHtml,
} from '../../editor/ditaRenderUtils';
import type { BookPart } from '../../editor/bookPatch';

const TEST_MAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE map PUBLIC "-//OASIS//DTD DITA Map//EN" "map.dtd">
<map>
    <title>Test</title>
    <keydef keys="name">
        <topicmeta>
            <keywords>
                <keyword>Rectangle</keyword>
            </keywords>
        </topicmeta>
    </keydef>
    <topicref keys="product_name" href="topics/db_overview.dita">
        <topicmeta><linktext>DatabaseX Pro v3.0</linktext></topicmeta>
    </topicref>
    <topicref keys="company_name">
        <topicmeta><linktext>ACME Corporation</linktext></topicmeta>
    </topicref>
    <topicref href="topics/db_overview.dita"/>
    <topicref href="topics/db_config.dita"/>
    <topicref href="topics/db_ui_test.dita"/>
    <topicref keys="product_version">
        <topicmeta>
            <linktext>V1.0.0</linktext>
        </topicmeta>
    </topicref>
</map>`;

function parseMap(xml: string) {
  return parseDitamap(preprocessEntities(xml));
}

describe('collectMapEntries', () => {
  it('should collect entries in document order', () => {
    const doc = parseMap(TEST_MAP_XML);
    const entries = collectMapEntries(doc.root);
    assert.strictEqual(entries.length, 7);

    // keydef: no href
    assert.strictEqual(entries[0].displayName, 'Rectangle');
    assert.strictEqual(entries[0].href, undefined);
    assert.strictEqual(entries[0].keys, 'name');

    // topicref with href+keys
    assert.strictEqual(entries[1].displayName, 'DatabaseX Pro v3.0');
    assert.strictEqual(entries[1].href, 'topics/db_overview.dita');
    assert.strictEqual(entries[1].keys, 'product_name');

    // topicref with keys only (no href)
    assert.strictEqual(entries[2].displayName, 'ACME Corporation');
    assert.strictEqual(entries[2].href, undefined);
    assert.strictEqual(entries[2].keys, 'company_name');

    // topicref with href only (filename fallback)
    assert.strictEqual(entries[3].displayName, 'db_overview');
    assert.strictEqual(entries[3].href, 'topics/db_overview.dita');

    assert.strictEqual(entries[4].displayName, 'db_config');
    assert.strictEqual(entries[4].href, 'topics/db_config.dita');

    assert.strictEqual(entries[5].displayName, 'db_ui_test');
    assert.strictEqual(entries[5].href, 'topics/db_ui_test.dita');

    // Last: keys only
    assert.strictEqual(entries[6].displayName, 'V1.0.0');
    assert.strictEqual(entries[6].href, undefined);
    assert.strictEqual(entries[6].keys, 'product_version');
  });

  it('should set depth correctly for flat entries', () => {
    const doc = parseMap(TEST_MAP_XML);
    const entries = collectMapEntries(doc.root);
    for (const entry of entries) {
      assert.strictEqual(entry.depth, 0, `${entry.displayName} should have depth 0`);
    }
  });

  it('should set depth correctly for nested entries', () => {
    const xml = `<map>
      <topicref href="parent.dita">
        <topicmeta><linktext>Parent</linktext></topicmeta>
        <topicref href="child.dita">
          <topicmeta><linktext>Child</linktext></topicmeta>
          <topicref href="grandchild.dita">
            <topicmeta><linktext>Grandchild</linktext></topicmeta>
          </topicref>
        </topicref>
      </topicref>
    </map>`;
    const doc = parseMap(xml);
    const entries = collectMapEntries(doc.root);
    assert.strictEqual(entries.length, 3);
    assert.strictEqual(entries[0].displayName, 'Parent');
    assert.strictEqual(entries[0].depth, 0);
    assert.strictEqual(entries[1].displayName, 'Child');
    assert.strictEqual(entries[1].depth, 1);
    assert.strictEqual(entries[2].displayName, 'Grandchild');
    assert.strictEqual(entries[2].depth, 2);
  });

  it('should skip reltable entries', () => {
    const xml = `<map>
      <topicref href="main.dita"><topicmeta><linktext>Main</linktext></topicmeta></topicref>
      <reltable>
        <relheader><relcolspec/><relcolspec/></relheader>
        <relrow><relcell><topicref href="related.dita"/></relcell><relcell/></relrow>
      </reltable>
    </map>`;
    const doc = parseMap(xml);
    const entries = collectMapEntries(doc.root);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].displayName, 'Main');
  });

  // ── BookMap collectMapEntries tests ──

  it('should collect chapter entries from a bookmap', () => {
    const xml = `<bookmap>
      <chapter href="topics/ch1.dita">
        <topicmeta><linktext>Chapter 1</linktext></topicmeta>
      </chapter>
      <chapter href="topics/ch2.dita">
        <topicmeta><linktext>Chapter 2</linktext></topicmeta>
      </chapter>
      <appendix href="topics/appA.dita"/>
    </bookmap>`;
    const doc = parseMap(xml);
    const entries = collectMapEntries(doc.root);
    assert.strictEqual(entries.length, 3);
    assert.strictEqual(entries[0].displayName, 'Chapter 1');
    assert.strictEqual(entries[0].href, 'topics/ch1.dita');
    assert.strictEqual(entries[0].depth, 0);
    assert.strictEqual(entries[1].displayName, 'Chapter 2');
    assert.strictEqual(entries[2].displayName, 'appA');
  });

  it('should pass through frontmatter/booklists/toc and collect their children at same depth', () => {
    const xml = `<bookmap>
      <frontmatter>
        <booklists>
          <toc/>
        </booklists>
        <chapter href="topics/preface.dita">
          <topicmeta><linktext>Preface</linktext></topicmeta>
        </chapter>
      </frontmatter>
      <chapter href="topics/ch1.dita">
        <topicmeta><linktext>Chapter 1</linktext></topicmeta>
      </chapter>
    </bookmap>`;
    const doc = parseMap(xml);
    const entries = collectMapEntries(doc.root);
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].displayName, 'Preface');
    assert.strictEqual(entries[0].depth, 0, 'chapter inside frontmatter should be at depth 0');
    assert.strictEqual(entries[1].displayName, 'Chapter 1');
    assert.strictEqual(entries[1].depth, 0);
  });

  it('should collect nested chapters inside part at correct depth', () => {
    const xml = `<bookmap>
      <part href="topics/part1.dita">
        <topicmeta><linktext>Part I</linktext></topicmeta>
        <chapter href="topics/ch1.dita">
          <topicmeta><linktext>Chapter 1</linktext></topicmeta>
        </chapter>
      </part>
    </bookmap>`;
    const doc = parseMap(xml);
    const entries = collectMapEntries(doc.root);
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].displayName, 'Part I');
    assert.strictEqual(entries[0].depth, 0);
    assert.strictEqual(entries[1].displayName, 'Chapter 1');
    assert.strictEqual(entries[1].depth, 1);
  });

  it('should handle backmatter with nested chapter', () => {
    const xml = `<bookmap>
      <backmatter>
        <chapter href="topics/appendix.dita">
          <topicmeta><linktext>Appendix</linktext></topicmeta>
        </chapter>
      </backmatter>
    </bookmap>`;
    const doc = parseMap(xml);
    const entries = collectMapEntries(doc.root);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].displayName, 'Appendix');
    assert.strictEqual(entries[0].depth, 0);
  });

  it('should handle topicgroup without adding its own entry', () => {
    const xml = `<map>
      <topicgroup>
        <topicref href="a.dita"><topicmeta><linktext>A</linktext></topicmeta></topicref>
        <topicref href="b.dita"><topicmeta><linktext>B</linktext></topicmeta></topicref>
      </topicgroup>
    </map>`;
    const doc = parseMap(xml);
    const entries = collectMapEntries(doc.root);
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].displayName, 'A');
    assert.strictEqual(entries[1].displayName, 'B');
  });

  it('should restart chapter numbering per nesting depth', () => {
    const xml = `<bookmap>
      <chapter href="c1.dita">
        <chapter href="c1-1.dita"/>
        <chapter href="c1-2.dita"/>
        <chapter href="c1-3.dita"/>
      </chapter>
      <chapter href="c2.dita">
        <chapter href="c2-1.dita"/>
        <chapter href="c2-2.dita"/>
        <chapter href="c2-3.dita"/>
        <chapter href="c2-4.dita"/>
      </chapter>
      <chapter href="c3.dita">
        <chapter href="c3-1.dita"/>
        <chapter href="c3-2.dita"/>
        <chapter href="c3-3.dita"/>
        <chapter href="c3-4.dita"/>
        <chapter href="c3-5.dita"/>
      </chapter>
    </bookmap>`;
    const doc = parseMap(xml);
    const entries = collectMapEntries(doc.root);
    // Top-level: Chapter 1, Chapter 2, Chapter 3
    assert.strictEqual(entries[0].role, 'Chapter 1'); // c1
    assert.strictEqual(entries[1].role, 'Chapter 1'); // c1-1
    assert.strictEqual(entries[2].role, 'Chapter 2'); // c1-2
    assert.strictEqual(entries[3].role, 'Chapter 3'); // c1-3
    assert.strictEqual(entries[4].role, 'Chapter 2'); // c2
    assert.strictEqual(entries[5].role, 'Chapter 1'); // c2-1
    assert.strictEqual(entries[6].role, 'Chapter 2'); // c2-2
    assert.strictEqual(entries[7].role, 'Chapter 3'); // c2-3
    assert.strictEqual(entries[8].role, 'Chapter 4'); // c2-4
    assert.strictEqual(entries[9].role, 'Chapter 3'); // c3
    assert.strictEqual(entries[10].role, 'Chapter 1'); // c3-1
    assert.strictEqual(entries[11].role, 'Chapter 2'); // c3-2
    assert.strictEqual(entries[12].role, 'Chapter 3'); // c3-3
    assert.strictEqual(entries[13].role, 'Chapter 4'); // c3-4
    assert.strictEqual(entries[14].role, 'Chapter 5'); // c3-5
  });

  it('should restart chapter numbering inside parts', () => {
    const xml = `<bookmap>
      <part href="p1.dita">
        <chapter href="c1.dita"/>
        <chapter href="c2.dita"/>
      </part>
      <part href="p2.dita">
        <chapter href="c3.dita"/>
        <chapter href="c4.dita"/>
      </part>
    </bookmap>`;
    const doc = parseMap(xml);
    const entries = collectMapEntries(doc.root);
    assert.strictEqual(entries[0].role, 'Part I');
    assert.strictEqual(entries[1].role, 'Chapter 1'); // under Part I
    assert.strictEqual(entries[2].role, 'Chapter 2'); // under Part I
    assert.strictEqual(entries[3].role, 'Part II');
    assert.strictEqual(entries[4].role, 'Chapter 1'); // under Part II (restarts)
    assert.strictEqual(entries[5].role, 'Chapter 2'); // under Part II
  });

  it('should restart chapter numbering through frontmatter', () => {
    const xml = `<bookmap>
      <frontmatter>
        <chapter href="preface.dita"/>
      </frontmatter>
      <chapter href="c1.dita">
        <chapter href="c1-1.dita"/>
      </chapter>
      <chapter href="c2.dita">
        <chapter href="c2-1.dita"/>
      </chapter>
    </bookmap>`;
    const doc = parseMap(xml);
    const entries = collectMapEntries(doc.root);
    // frontmatter chapter at depth 0
    assert.strictEqual(entries[0].role, 'Chapter 1');
    // c1 at depth 0: Chapter 2, nested c1-1 at depth 1: Chapter 1
    assert.strictEqual(entries[1].role, 'Chapter 2');
    assert.strictEqual(entries[2].role, 'Chapter 1');
    // c2 at depth 0: Chapter 3, nested c2-1 at depth 1: Chapter 1 (restarts)
    assert.strictEqual(entries[3].role, 'Chapter 3');
    assert.strictEqual(entries[4].role, 'Chapter 1');
  });
});

describe('bookRendering', () => {
  it('should render placeholder with escaped displayName (XSS guard)', () => {
    const html = renderBookPlaceholder('Evil <script>alert(1)</script>', 0);
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'angle brackets should be escaped');
    assert.ok(!html.includes('<script>'), 'no raw script tag');
    assert.ok(html.includes('class="book-section-heading"'));
    assert.ok(html.includes('<h1'));
  });

  it('should render placeholder with correct heading level from depth', () => {
    const h0 = renderBookPlaceholder('Section', 0);
    assert.ok(h0.includes('<h1'));
    const h2 = renderBookPlaceholder('Section', 2);
    assert.ok(h2.includes('<h3'));
    const deep = renderBookPlaceholder('Deep', 10);
    assert.ok(deep.includes('<h6'), 'should cap at h6');
  });

  it('should render skip message with escaped href (XSS guard)', () => {
    const html = renderBookSkipMessage('topics/<script>alert(1)</script>.dita');
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'angle brackets should be escaped');
    assert.ok(!html.includes('<script>'), 'no raw script tag');
  });

  it('should render error block with escaped displayName and error (XSS guard)', () => {
    const html = renderBookError(
      '<b>display</b>',
      'Error rendering /path/to/<script>alert(1)</script>.dita',
      0,
    );
    assert.ok(html.includes('&lt;b&gt;display&lt;/b&gt;'), 'displayName angle brackets escaped');
    assert.ok(!html.includes('<b>'), 'no raw displayName tags');
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'error path angle brackets escaped');
    assert.ok(!html.includes('<script>'), 'no raw script tag in error');
    assert.ok(html.includes('class="book-error"'));
  });
});

// The three helpers above cover book mode's markup; this covers the assembly
// loop that decides which of them (or a rendered topic) each map entry turns
// into. It used to be a private method on MapViewerProvider, reachable only by
// opening a .ditamap and clicking Book in the webview toolbar, so none of it
// was tested -- and scripts/bench-book-render.js kept its own hand-copy, which
// drifted. renderBookEntries is now the single copy both callers use.
describe('renderBookEntries', () => {
  let dir: string;
  // Book mode hands ONE keyMap instance to every topic in a pass (see
  // MapViewerProvider.collectBookParts). renderTopicCached compares it by
  // identity, so a shared instance is the realistic fixture.
  const keyMap = new Map<string, string>();
  const fixedMtime = new Date('2024-01-01T00:00:00.000Z');
  /** Absolute paths the assembly asked to have turned into webview URIs. */
  let uriRequests: string[] = [];
  const fileToWebviewUri = (absPath: string): string => {
    uriRequests.push(absPath);
    return `https://file+.vscode-resource.vscode-cdn.net${encodeURI(absPath)}`;
  };

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'dita-viewer-book-'));
    mkdirSync(join(dir, 'topics'), { recursive: true });
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
    clearTopicRenderCache();
  });
  beforeEach(() => {
    clearTopicRenderCache();
    uriRequests = [];
  });
  afterEach(() => {
    clearTopicRenderCache();
  });

  /**
   * Writes a one-paragraph topic and pins its mtime, so rewriting its content
   * alone does NOT invalidate the render cache -- that is what makes "the cache
   * answered" distinguishable from "it re-rendered and happened to match".
   */
  function writeTopic(relPath: string, body: string): string {
    const abs = join(dir, relPath);
    const id = relPath.replace(/\.dita$/, '').replace(/\W/g, '_');
    writeFileSync(
      abs,
      `<?xml version="1.0" encoding="UTF-8"?>\n<topic id="${id}"><title>${id}</title><body>${body}</body></topic>`,
    );
    utimesSync(abs, fixedMtime, fixedMtime);
    return abs;
  }

  function bumpMtime(abs: string): void {
    const later = new Date(statSync(abs).mtime.getTime() + 5000);
    utimesSync(abs, later, later);
  }

  function topicRef(href: string | undefined, displayName: string, depth = 0): MapEntry {
    return { href, displayName, depth };
  }

  function renderBook(entries: MapEntry[]): string {
    return renderBookEntries({ entries, docDir: dir, keyMap, fileToWebviewUri, uiLanguage: 'en' });
  }

  function countOf(haystack: string, needle: string): number {
    return haystack.split(needle).length - 1;
  }

  it('should assemble every referenced topic in map order inside the book container', () => {
    writeTopic('topics/order-a.dita', '<p>alpha</p>');
    writeTopic('topics/order-b.dita', '<p>beta</p>');

    const html = renderBook([
      topicRef('topics/order-a.dita', 'A'),
      topicRef('topics/order-b.dita', 'B'),
    ]);

    assert.ok(html.startsWith('<div class="ditamap-book">'), 'the wrapper styles.css and the toolbar script look for');
    assert.ok(html.endsWith('</div>'));
    assert.strictEqual(countOf(html, '<div class="book-entry">'), 2, 'one wrapper per rendered topic');
    assert.ok(html.indexOf('alpha') < html.indexOf('beta'), 'map order, not filesystem order');
  });

  it('should render an entry with no href as a placeholder, which is what keydefs and key-only topicrefs produce', () => {
    const html = renderBook([topicRef(undefined, 'ACME <b>Corp</b>')]);

    assert.ok(html.includes('book-entry--placeholder'));
    assert.ok(html.includes('book-section-heading'));
    assert.ok(html.includes('&lt;b&gt;Corp&lt;/b&gt;'), 'displayName is authoring data and must be escaped');
    assert.ok(!html.includes('<b>'), 'no raw markup from the map reaches the document');
    assert.ok(!html.includes('book-error'), 'having nothing to open is not an error');
  });

  it('should render a sub-map reference as a section heading rather than parsing the .ditamap as a topic', () => {
    writeFileSync(
      join(dir, 'topics', 'sub.ditamap'),
      '<?xml version="1.0" encoding="UTF-8"?>\n<map><title>SUBMAP_LEAKED</title><topicref href="order-a.dita"/></map>',
    );

    const html = renderBook([topicRef('topics/sub.ditamap', 'Sub Map')]);

    assert.ok(html.includes('book-entry--placeholder'), 'expandDitamapRefs already inlined its children as their own entries');
    assert.ok(html.includes('Sub Map'));
    assert.ok(!html.includes('SUBMAP_LEAKED'), 'a map is not a topic; rendering it as one would emit its title as body content');
    assert.ok(!html.includes('book-error'), 'and it is not a failure either');
  });

  it('should skip a topic the same book already included instead of emitting it twice', () => {
    writeTopic('topics/dup.dita', '<p>once</p>');
    writeTopic('topics/dup-other.dita', '<p>between</p>');

    const html = renderBook([
      topicRef('topics/dup.dita', 'Dup'),
      topicRef('topics/dup-other.dita', 'Other'),
      topicRef('topics/dup.dita', 'Dup'),
    ]);

    assert.strictEqual(countOf(html, '<div class="book-entry">'), 2, 'the repeat contributes no second copy');
    assert.strictEqual(countOf(html, 'once'), 1, 'a book that repeats a topic would also repeat its ids');
    assert.ok(html.includes('class="book-skip"'), 'and it says so, rather than silently dropping the reference');
    assert.ok(html.includes('topics/dup.dita'), 'the skip message names the href it skipped');
    assert.ok(html.indexOf('between') < html.indexOf('book-skip'), 'the skip lands where the third reference was');
  });

  it('should turn an unreadable topic into an inline error block and carry on with the rest of the book', () => {
    writeTopic('topics/after-missing.dita', '<p>still here</p>');

    const html = renderBook([
      topicRef('topics/nope.dita', 'Nope'),
      topicRef('topics/after-missing.dita', 'After'),
    ]);

    assert.ok(html.includes('book-entry--error'), 'a broken reference stays visible');
    assert.ok(html.includes('Nope'), 'named, so the author knows which one broke');
    assert.ok(html.includes('still here'), 'one bad reference must not cost the author the rest of the book');
  });

  it('should derive each heading level from the entry depth, capping at h6', () => {
    writeTopic('topics/level-0.dita', '<p>top</p>');
    writeTopic('topics/level-2.dita', '<p>mid</p>');
    writeTopic('topics/level-deep.dita', '<p>bottom</p>');

    const html = renderBook([
      topicRef('topics/level-0.dita', 'Top', 0),
      topicRef('topics/level-2.dita', 'Mid', 2),
      topicRef('topics/level-deep.dita', 'Bottom', 10),
    ]);

    assert.ok(/<h1[\s>]/.test(html), 'a depth-0 topic is the book\'s top level');
    assert.ok(/<h3[\s>]/.test(html), 'depth 2 sits two levels down');
    assert.ok(/<h6[\s>]/.test(html), 'however deep the map nests, the ceiling holds');
    assert.ok(!/<h7/.test(html), 'an uncapped 1 + depth would emit a tag that does not exist');
  });

  it('should resolve an image href against the topic file directory, not the map directory', () => {
    writeTopic('topics/img-host.dita', '<image href="../img/pic.png" alt="pic"/>');

    const html = renderBook([topicRef('topics/img-host.dita', 'Img')]);

    assert.ok(html.includes('<img'), 'the image is rendered');
    // The topic lives in <dir>/topics, so its ../img is <dir>/img. Resolving
    // against the map's directory instead would ask for a sibling of the whole
    // fixture -- same-looking code, wrong image, only visible in the webview.
    assert.ok(
      uriRequests.includes(join(dir, 'img', 'pic.png')),
      `expected the map-level img dir, asked for: ${uriRequests.join(', ')}`,
    );
  });

  it('should decode a percent-encoded href before looking for the file', () => {
    writeTopic('topics/my topic.dita', '<p>spaced</p>');

    const html = renderBook([topicRef('topics/my%20topic.dita', 'Spaced')]);

    assert.ok(html.includes('spaced'));
    assert.ok(!html.includes('book-entry--error'), 'spaces in filenames are legal and common in DITA shops');
  });

  it('should reuse each topic HTML across passes and re-render only what actually changed', () => {
    writeTopic('topics/reuse-a.dita', '<p>alpha</p>');
    const b = writeTopic('topics/reuse-b.dita', '<p>beta</p>');
    const entries = [topicRef('topics/reuse-a.dita', 'A'), topicRef('topics/reuse-b.dita', 'B')];

    const first = renderBook(entries);
    assert.ok(first.includes('alpha') && first.includes('beta'));

    // New bytes on disk, mtime pinned where it was: only a cached answer can
    // reproduce the previous pass exactly.
    writeTopic('topics/reuse-b.dita', '<p>beta rewritten</p>');
    assert.strictEqual(
      renderBook(entries),
      first,
      'no dependency changed, so the whole assembly is byte-identical -- this is the reuse a book left open while editing depends on',
    );

    bumpMtime(b);
    const third = renderBook(entries);
    assert.ok(third.includes('beta rewritten'), 'the edited topic is re-rendered');
    assert.ok(third.includes('alpha'), 'and the untouched one is still there');
  });

  it('should fall back to an empty src when a webview URI cannot be built, rather than losing the whole topic', () => {
    writeTopic('topics/throwing-uri.dita', '<image href="pic.png" alt="pic"/><p>survived</p>');
    const warnings: string[] = [];
    const realWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    let html: string;
    try {
      html = renderBookEntries({
        entries: [topicRef('topics/throwing-uri.dita', 'Throws')],
        docDir: dir,
        keyMap,
        fileToWebviewUri: () => {
          throw new Error('panel is gone');
        },
        uiLanguage: 'en',
      });
    } finally {
      console.warn = realWarn;
    }

    assert.ok(html.includes('survived'), 'a URI failure is per-image, not per-topic');
    assert.ok(html.includes('src=""'), 'the image stays visibly broken instead of disappearing');
    assert.ok(!html.includes('panel is gone'), 'an exception message is not document content');
    assert.strictEqual(warnings.length, 1, 'and the cause is logged, since an empty src alone is not debuggable');
  });

  // renderBookParts exists so MapViewerProvider can diff two renders of the
  // same map and send only the entries whose HTML changed (bookPatch.ts).
  // Everything below pins the property that makes such a diff meaningful: a
  // key says what a part is *about*, so it survives a content edit and moves
  // only when the entry sequence itself does. Get that backwards and every
  // keystroke looks structural -- the patch path never fires, and nothing
  // fails. It just silently stops doing anything.
  describe('part keys', () => {
    function renderParts(entries: MapEntry[]): BookPart[] {
      return renderBookParts({ entries, docDir: dir, keyMap, fileToWebviewUri, uiLanguage: 'en' });
    }

    it('should produce exactly one part per entry, in map order, which is what makes an index a valid way to address an entry', () => {
      writeTopic('topics/count-a.dita', '<p>alpha</p>');
      writeTopic('topics/count-b.dita', '<p>beta</p>');

      const parts = renderParts([
        topicRef('topics/count-a.dita', 'A'),
        topicRef(undefined, 'Keydef'),
        topicRef('topics/count-b.dita', 'B'),
      ]);

      assert.strictEqual(parts.length, 3, 'every branch of the assembly loop pushes exactly one part');
      assert.deepStrictEqual(
        parts.map((p) => p.key),
        [
          `topic:${join(dir, 'topics', 'count-a.dita')}`,
          'struct:0:Keydef',
          `topic:${join(dir, 'topics', 'count-b.dita')}`,
        ],
      );
    });

    it('should produce identical parts across two renders of an unchanged map, which is the case the diff answers with "nothing to send"', () => {
      writeTopic('topics/stable.dita', '<p>same</p>');
      const entries = [topicRef('topics/stable.dita', 'S'), topicRef(undefined, 'K')];

      assert.deepStrictEqual(renderParts(entries), renderParts(entries));
    });

    it("should keep keys identical when a topic's content changes, so an edit reads as content and not as structure", () => {
      const abs = writeTopic('topics/edited.dita', '<p>before</p>');
      const entries = [topicRef('topics/edited.dita', 'E')];
      const before = renderParts(entries);

      // Rewritten AND mtime-bumped: writeTopic pins mtime precisely so that a
      // rewrite alone is answered from the render cache, which would leave the
      // HTML unchanged and this assertion vacuous.
      writeFileSync(
        abs,
        '<?xml version="1.0" encoding="UTF-8"?>\n<topic id="edited"><title>edited</title><body><p>after</p></body></topic>',
      );
      bumpMtime(abs);
      const after = renderParts(entries);

      assert.notStrictEqual(before[0].html, after[0].html, 'the edit really did reach the rendered HTML');
      assert.strictEqual(before[0].key, after[0].key, 'and it is still the same entry, so it patches in place');
      assert.ok(after[0].html.includes('after') && !after[0].html.includes('before'));
    });

    it('should key each part by what it is about: topic path, sub-map path, or structural name', () => {
      writeTopic('topics/kinded.dita', '<p>x</p>');

      const parts = renderParts([
        topicRef('topics/kinded.dita', 'T'),
        topicRef('sub.ditamap', 'Sub Map'),
        topicRef(undefined, 'Head'),
      ]);

      assert.strictEqual(parts[0].key, `topic:${join(dir, 'topics', 'kinded.dita')}`);
      assert.strictEqual(parts[1].key, `map:${join(dir, 'sub.ditamap')}`, 'a sub-map renders as a heading but is still keyed by its own path');
      assert.strictEqual(parts[2].key, 'struct:0:Head', 'nothing to resolve, so depth and name are all the identity there is');
    });

    it('should give colliding structural entries distinct keys, and the same distinct keys on the next render', () => {
      // Two topicheads sharing a navtitle at the same depth are legal DITA and
      // produce the same base key. A repeated key would let the diff read two
      // different entries as one, so a collision earns a suffix -- derived from
      // the collision count, so it does not drift between renders.
      const entries = [topicRef(undefined, 'Dup'), topicRef(undefined, 'Dup')];

      const first = renderParts(entries).map((p) => p.key);
      const second = renderParts(entries).map((p) => p.key);

      assert.strictEqual(new Set(first).size, 2, 'both parts stay individually addressable');
      assert.deepStrictEqual(first, second);
    });

    it('should keep a duplicate-reference skip note keyed by the href it skipped', () => {
      writeTopic('topics/dup-ref.dita', '<p>once</p>');

      const parts = renderParts([
        topicRef('topics/dup-ref.dita', 'D'),
        topicRef('topics/dup-ref.dita', 'D again'),
      ]);

      assert.strictEqual(parts[0].key, `topic:${join(dir, 'topics', 'dup-ref.dita')}`);
      assert.strictEqual(parts[1].key, 'skip:topics/dup-ref.dita', 'keyed by the href as written; there is no second file to point at');
      assert.ok(parts[1].html.includes('book-skip'));
    });

    it('should key a failed topic exactly like the topic it stands in for, so fixing the reference patches that one entry', () => {
      const entries = [topicRef('topics/was-missing.dita', 'W')];

      clearTopicRenderCache();
      const broken = renderParts(entries);
      assert.ok(broken[0].html.includes('book-entry--error'), 'unreadable, so an inline error block');

      // The author creates the file the map was already pointing at.
      writeTopic('topics/was-missing.dita', '<p>now here</p>');
      clearTopicRenderCache();
      const fixed = renderParts(entries);

      assert.strictEqual(broken[0].key, fixed[0].key, 'same entry, so this is one patched entry rather than a new document');
      assert.ok(fixed[0].html.includes('now here') && !fixed[0].html.includes('book-entry--error'));
    });

    it('should give every part exactly one root element, so replacing one by index leaves the entry count -- and every other index -- intact', () => {
      writeTopic('topics/rooted.dita', '<p>x</p>');

      const parts = renderParts([
        topicRef('topics/rooted.dita', 'T'),
        topicRef(undefined, 'Head'),
        topicRef('topics/rooted.dita', 'T twice'),
        topicRef('sub.ditamap', 'Sub'),
      ]);

      // The webview patches with `entry.outerHTML = part.html`, which only
      // preserves the child count while a part is a single element. Asserted
      // rather than assumed, since a second root would shift every index after
      // it and corrupt the rest of the book.
      for (const part of parts) {
        const html = part.html.trim();
        const root = html.startsWith('<div') ? 'div' : html.startsWith('<p') ? 'p' : undefined;
        assert.ok(root, `part ${part.key} opens with a single root element, got: ${html.slice(0, 32)}`);
        assert.ok(html.endsWith(`</${root}>`), `part ${part.key} closes that same element and nothing follows it`);
      }
    });

    it('should join back into byte-identical output, so going incremental changes nothing about what a full render produces', () => {
      writeTopic('topics/wrapped.dita', '<p>x</p>');
      const entries = [
        topicRef('topics/wrapped.dita', 'W'),
        topicRef(undefined, 'K'),
        topicRef('topics/wrapped.dita', 'W again'),
      ];

      assert.strictEqual(wrapBookParts(renderParts(entries)), renderBook(entries));
    });
  });
});

// Docsite mode design doc (step 1 of the implementation order): the nav
// sidebar/prev-next data source has to agree with renderBookEntries above on
// exactly which topics a book contains, or the sidebar could list a topic
// the book doesn't render (or omit one it does). Both now go through
// resolveBookTopicPath, so this suite is mostly about confirming that
// shared resolution rule and the manifest built on top of it, not
// re-testing renderBookEntries' own assembly.
describe('resolveBookTopicPath / buildBookNavManifest (docsite nav manifest)', () => {
  const docDir = '/proj/docs';

  it('resolves a plain .dita href against docDir', () => {
    const entry: MapEntry = { href: 'topics/intro.dita', displayName: 'Intro', depth: 0 };
    assert.strictEqual(resolveBookTopicPath(entry, docDir), join(docDir, 'topics/intro.dita'));
  });

  it('strips a #fragment before resolving', () => {
    const entry: MapEntry = { href: 'topics/intro.dita#section2', displayName: 'Intro', depth: 0 };
    assert.strictEqual(resolveBookTopicPath(entry, docDir), join(docDir, 'topics/intro.dita'));
  });

  it('returns undefined for an entry with no href (a keydef with no target, a topichead heading, ...)', () => {
    const entry: MapEntry = { href: undefined, displayName: 'Section heading', depth: 0 };
    assert.strictEqual(resolveBookTopicPath(entry, docDir), undefined);
  });

  it('returns undefined for a .ditamap href -- expandDitamapRefs should have flattened it before entries reach here', () => {
    const entry: MapEntry = { href: 'submaps/appendix.ditamap', displayName: 'Appendix', depth: 0 };
    assert.strictEqual(resolveBookTopicPath(entry, docDir), undefined);
  });

  it('decodes a URL-encoded href the same way renderBookEntries does', () => {
    const entry: MapEntry = { href: 'topics/caf%C3%A9.dita', displayName: 'Café', depth: 0 };
    assert.strictEqual(resolveBookTopicPath(entry, docDir), join(docDir, 'topics/café.dita'));
  });

  it('builds one manifest entry per topic, in document order, carrying title/depth/role through', () => {
    const entries: MapEntry[] = [
      { href: 'topics/ch1.dita', displayName: 'Chapter One', depth: 0, role: 'Chapter 1' },
      { href: 'topics/ch1-s1.dita', displayName: 'Section 1.1', depth: 1 },
      { href: undefined, displayName: 'No target', depth: 0 }, // e.g. a keydef
    ];
    const manifest = buildBookNavManifest(entries, docDir);
    assert.deepStrictEqual(manifest, [
      { absPath: join(docDir, 'topics/ch1.dita'), title: 'Chapter One', depth: 0, role: 'Chapter 1' },
      { absPath: join(docDir, 'topics/ch1-s1.dita'), title: 'Section 1.1', depth: 1, role: undefined },
    ]);
  });

  it('de-duplicates a topic referenced twice, keeping only its first occurrence -- same rule renderBookEntries applies via its own visited set', () => {
    const entries: MapEntry[] = [
      { href: 'topics/shared.dita', displayName: 'First mention', depth: 0 },
      { href: 'topics/shared.dita', displayName: 'Second mention (should not appear)', depth: 1 },
    ];
    const manifest = buildBookNavManifest(entries, docDir);
    assert.strictEqual(manifest.length, 1);
    assert.strictEqual(manifest[0].title, 'First mention');
  });

  it('excludes .ditamap entries from the manifest the same way it excludes them from resolution', () => {
    const entries: MapEntry[] = [
      { href: 'submaps/appendix.ditamap', displayName: 'Appendix (submap ref)', depth: 0 },
      { href: 'topics/real.dita', displayName: 'Real topic', depth: 0 },
    ];
    const manifest = buildBookNavManifest(entries, docDir);
    assert.strictEqual(manifest.length, 1);
    assert.strictEqual(manifest[0].title, 'Real topic');
  });

  it('agrees with renderBookEntries on which topics a real map produces (regression guard against the two drifting apart)', () => {
    const doc = parseMap(TEST_MAP_XML);
    const entries = collectMapEntries(doc.root);
    const manifest = buildBookNavManifest(entries, docDir);
    // TEST_MAP_XML references topics/db_overview.dita twice (once via a
    // keys-only topicref with no href of its own, once bare) -- see the
    // fixture at the top of this file -- so the manifest should contain it
    // only once, plus db_config.dita and db_ui_test.dita.
    assert.strictEqual(manifest.length, 3, 'db_overview (deduped), db_config, db_ui_test');
    assert.deepStrictEqual(
      manifest.map((m) => m.absPath),
      [
        join(docDir, 'topics/db_overview.dita'),
        join(docDir, 'topics/db_config.dita'),
        join(docDir, 'topics/db_ui_test.dita'),
      ],
    );
  });
});

describe('renderSiteNavHtml', () => {
  const manifest = [
    { absPath: '/proj/docs/topics/a.dita', title: 'Topic A', depth: 0 },
    { absPath: '/proj/docs/topics/b.dita', title: 'Topic B', depth: 1 },
  ];

  it('renders one link per manifest entry, each carrying its absPath as the click target', () => {
    const html = renderSiteNavHtml(manifest, manifest[0].absPath, 'Topics');
    assert.strictEqual((html.match(/class="site-nav-link/g) || []).length, 2);
    assert.ok(html.includes('data-site-target="/proj/docs/topics/a.dita"'));
    assert.ok(html.includes('data-site-target="/proj/docs/topics/b.dita"'));
  });

  it('marks only the current page active', () => {
    const html = renderSiteNavHtml(manifest, manifest[1].absPath, 'Topics');
    assert.ok(!/class="site-nav-link active"[^>]*data-site-target="\/proj\/docs\/topics\/a\.dita"/.test(html), 'a.dita should not be active');
    assert.ok(/class="site-nav-link active"[^>]*data-site-target="\/proj\/docs\/topics\/b\.dita"/.test(html), 'b.dita should be active');
  });

  it('renders with no active link when currentAbsPath matches nothing, rather than throwing', () => {
    assert.doesNotThrow(() => renderSiteNavHtml(manifest, '/proj/docs/topics/gone.dita', 'Topics'));
    const html = renderSiteNavHtml(manifest, '/proj/docs/topics/gone.dita', 'Topics');
    assert.ok(!html.includes(' active'));
  });

  it('indents deeper entries further', () => {
    const html = renderSiteNavHtml(manifest, manifest[0].absPath, 'Topics');
    const aStyle = /data-site-target="\/proj\/docs\/topics\/a\.dita" style="padding-left:(\d+)px"/.exec(html);
    const bStyle = /data-site-target="\/proj\/docs\/topics\/b\.dita" style="padding-left:(\d+)px"/.exec(html);
    assert.ok(aStyle && bStyle);
    assert.ok(Number(bStyle![1]) > Number(aStyle![1]), 'depth 1 should indent further than depth 0');
  });

  it('escapes title/aria-label/path for XSS (title used for both link text and its title= attribute)', () => {
    const evil = [{ absPath: '/proj/"><script>x</script>.dita', title: '<script>alert(1)</script>', depth: 0 }];
    const html = renderSiteNavHtml(evil, evil[0].absPath, '<script>y</script>');
    assert.ok(!html.includes('<script>'), 'no raw script tag anywhere');
    assert.ok(html.includes('&lt;script&gt;'));
  });
});
