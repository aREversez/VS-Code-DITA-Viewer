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
  clearTopicRenderCache,
} from '../../editor/ditaRenderUtils';

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
  // MapViewerProvider.renderBookContent). renderTopicCached compares it by
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
});
