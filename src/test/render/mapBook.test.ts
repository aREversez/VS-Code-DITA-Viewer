import * as assert from 'assert';
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
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
  clearBookMembersCache,
  resolveBookTopicPath,
  buildBookNavManifest,
  renderSiteNavHtml,
  renderSiteNavTreeHtml,
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

  it('marks displayNameExplicit correctly: true for a real navtitle/linktext/keyword, false for a filename fallback', () => {
    const doc = parseMap(TEST_MAP_XML);
    const entries = collectMapEntries(doc.root);
    // entries[1]: keys="product_name" href="topics/db_overview.dita" with a
    // <topicmeta><linktext>DatabaseX Pro v3.0</linktext></topicmeta> -- a
    // real, explicit name.
    assert.strictEqual(entries[1].displayNameExplicit, true);
    // entries[3]: bare href, no topicmeta at all -- filename fallback.
    assert.strictEqual(entries[3].displayNameExplicit, false);
    // entries[6]: keys="product_version" with its own
    // <topicmeta><linktext>V1.0.0</linktext></topicmeta> -- explicit too,
    // even though there's no href (a keydef-style entry can still name
    // itself).
    assert.strictEqual(entries[6].displayNameExplicit, true);
  });

  it('marks displayNameExplicit false for the raw `keys` value fallback (no href, no topicmeta at all)', () => {
    const doc = parseMap('<map><title>T</title><topicref keys="bare_key"/></map>');
    const entries = collectMapEntries(doc.root);
    assert.strictEqual(entries[0].displayName, 'bare_key');
    assert.strictEqual(entries[0].displayNameExplicit, false);
  });

  it('resolves the attribute-form @navtitle on a structural topichead (no href, no topicmeta child) instead of falling back to "(unnamed)"', () => {
    // @navtitle is a valid DITA attribute-form alternative to
    // <topicmeta><navtitle>, and it is the *only* way to name a topichead
    // that has no topicmeta at all -- ditaLanguageUtils.ts's getMapRefName
    // (the outline/tree-view path) already reads this attribute, but
    // collectMapEntries' own displayName resolution (getDisplayNameInfo)
    // used by book/site mode and HTML export did not, so any topichead
    // written this way rendered as a literal "(unnamed)" heading in those
    // views while showing correctly in the outline.
    const doc = parseMap('<map><title>T</title><topichead navtitle="Chapter 1 Intro"><topicref href="a.dita"/></topichead></map>');
    const entries = collectMapEntries(doc.root);
    assert.strictEqual(entries[0].displayName, 'Chapter 1 Intro');
    assert.strictEqual(entries[0].displayNameExplicit, true, '@navtitle is authored content, same as <topicmeta><navtitle>');
  });

  it('prefers <topicmeta><navtitle> over a coexisting @navtitle attribute (topicmeta is the more specific, more capable form)', () => {
    const doc = parseMap('<map><title>T</title><topichead navtitle="Attr Title"><topicmeta><navtitle>Meta Title</navtitle></topicmeta><topicref href="a.dita"/></topichead></map>');
    const entries = collectMapEntries(doc.root);
    assert.strictEqual(entries[0].displayName, 'Meta Title');
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

  // --- resourceOnly (processing-role) ---

  it('marks a <keydef> resourceOnly by default even with no processing-role attribute of its own (DITA spec default)', () => {
    const doc = parseMap('<map><title>T</title><keydef keys="k" href="a.dita"/></map>');
    const entries = collectMapEntries(doc.root);
    assert.strictEqual(entries[0].resourceOnly, true);
  });

  it('does not mark a plain topicref resourceOnly by default -- only <keydef> gets that implicit default', () => {
    const doc = parseMap('<map><title>T</title><topicref href="a.dita"/></map>');
    const entries = collectMapEntries(doc.root);
    assert.strictEqual(entries[0].resourceOnly, false);
  });

  it('respects an explicit processing-role="resource-only" on a plain topicref', () => {
    const doc = parseMap('<map><title>T</title><topicref href="a.dita" processing-role="resource-only"/></map>');
    const entries = collectMapEntries(doc.root);
    assert.strictEqual(entries[0].resourceOnly, true);
  });

  it('lets an explicit processing-role="normal" on a <keydef> override its own resource-only default', () => {
    const doc = parseMap('<map><title>T</title><keydef keys="k" href="a.dita" processing-role="normal"/></map>');
    const entries = collectMapEntries(doc.root);
    assert.strictEqual(entries[0].resourceOnly, false);
  });

  it('inherits resourceOnly down to children with no processing-role of their own', () => {
    const doc = parseMap('<map><title>T</title><topicref href="a.dita" processing-role="resource-only"><topicref href="b.dita"/></topicref></map>');
    const entries = collectMapEntries(doc.root);
    assert.strictEqual(entries[0].resourceOnly, true);
    assert.strictEqual(entries[1].resourceOnly, true, 'child inherits from its resource-only parent');
  });

  it('lets a child override an inherited resourceOnly back to normal with its own explicit processing-role', () => {
    const doc = parseMap('<map><title>T</title><topicref href="a.dita" processing-role="resource-only"><topicref href="b.dita" processing-role="normal"/></topicref></map>');
    const entries = collectMapEntries(doc.root);
    assert.strictEqual(entries[0].resourceOnly, true);
    assert.strictEqual(entries[1].resourceOnly, false, 'explicit override wins over the inherited value');
  });

  it('never burns a role/chapter-number slot on a resource-only chapter', () => {
    const doc = parseMap('<bookmap><chapter href="a.dita" processing-role="resource-only"/><chapter href="b.dita"/></bookmap>');
    const entries = collectMapEntries(doc.root);
    assert.strictEqual(entries[0].role, undefined, 'resource-only chapter gets no role at all');
    assert.strictEqual(entries[1].role, 'Chapter 1', 'and the next real chapter is still 1, not 2 -- no slot was consumed');
  });

  // --- isDitamapRef depth-transparency (mapref/keydef/chapter pointing at another .ditamap) ---

  it('recurses into a <mapref href="...ditamap"> at the SAME depth as the mapref itself, not one level deeper', () => {
    // Hand-authoring the mapref's own children directly here rather than
    // going through expandDitamapRefs + real files on disk -- this is
    // exactly the shape expandDitamapRefs leaves behind (the referenced
    // map's own top-level children spliced in as this node's DOM
    // children), and collectEntriesRecursive doesn't care how they got
    // there.
    const doc = parseMap(`<bookmap>
      <chapter href="local1.dita"/>
      <mapref href="sub.ditamap">
        <chapter href="sub1.dita"/>
        <chapter href="sub2.dita"/>
      </mapref>
      <chapter href="local2.dita"/>
    </bookmap>`);
    const entries = collectMapEntries(doc.root);
    // The mapref itself never becomes its own entry (a .ditamap href is
    // never a real topic), so all four chapters land as siblings, same
    // depth, numbered continuously.
    assert.strictEqual(entries.length, 4);
    assert.deepStrictEqual(entries.map((e) => e.href), ['local1.dita', 'sub1.dita', 'sub2.dita', 'local2.dita']);
    assert.deepStrictEqual(entries.map((e) => e.depth), [0, 0, 0, 0]);
    assert.deepStrictEqual(entries.map((e) => e.role), ['Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4']);
  });

  it('applies the same depth-transparency to a <chapter href="...ditamap" format="ditamap"> (the more common real-world authoring pattern than a bare <mapref>)', () => {
    const doc = parseMap(`<bookmap>
      <chapter href="local1.dita"/>
      <chapter href="sub.ditamap" format="ditamap">
        <chapter href="sub1.dita"/>
      </chapter>
    </bookmap>`);
    const entries = collectMapEntries(doc.root);
    assert.strictEqual(entries.length, 2, 'the wrapper chapter itself never becomes an entry -- a .ditamap href is never a real topic');
    assert.deepStrictEqual(entries.map((e) => e.href), ['local1.dita', 'sub1.dita']);
    assert.deepStrictEqual(entries.map((e) => e.role), ['Chapter 1', 'Chapter 2'], 'sub1 continues the outer sequence rather than nesting as a new "Chapter 1" one level deeper');
  });

  it('does not apply depth-transparency to an ordinary nested topicref/chapter with real (non-ditamap) content -- normal nesting still restarts the counter one level deeper', () => {
    const doc = parseMap(`<bookmap>
      <chapter href="a.dita">
        <chapter href="a1.dita"/>
      </chapter>
    </bookmap>`);
    const entries = collectMapEntries(doc.root);
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].depth, 0);
    assert.strictEqual(entries[1].depth, 1, 'a real (non-ditamap-ref) nested chapter still goes one level deeper');
    assert.strictEqual(entries[1].role, 'Chapter 1', 'and still gets its own restarted counter at that deeper level');
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
    clearBookMembersCache();
  });
  beforeEach(() => {
    clearTopicRenderCache();
    clearBookMembersCache();
    uriRequests = [];
  });
  afterEach(() => {
    clearTopicRenderCache();
    clearBookMembersCache();
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
    return { href, displayName, displayNameExplicit: true, depth };
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
    assert.strictEqual((html.match(/<div class="book-entry"/g) || []).length, 2, 'one wrapper per rendered topic');
    assert.ok(html.indexOf('alpha') < html.indexOf('beta'), 'map order, not filesystem order');
    // Each topic's own resolved path doubles as its book-mode scroll anchor
    // (nested-fold-and-highlight-plan.md item 1) -- the exact same id
    // buildBookNavManifest would give the same entry in its own manifest,
    // computed from the one shared computeManifestEntryPositions helper
    // rather than re-derived here, so the sidebar and the book content can
    // never disagree about where a topic's anchor sits.
    assert.ok(html.includes(`data-book-anchor="${join(dir, 'topics', 'order-a.dita')}"`));
    assert.ok(html.includes(`data-book-anchor="${join(dir, 'topics', 'order-b.dita')}"`));
  });

  it('should render a book-internal cross-file xref as a clickable link even when it points FORWARD to a topic later in reading order (membership must be known for the whole book up front, not built incrementally as each topic is rendered)', () => {
    // order-a (rendered first) links to order-b, which the render loop has
    // not reached yet at the time order-a is rendered -- an incrementally
    // built "visited so far" set would wrongly treat order-b as outside
    // the book here.
    writeTopic('topics/order-a.dita', '<p><xref href="order-b.dita"/></p>');
    writeTopic('topics/order-b.dita', '<p>beta</p>');

    const html = renderBook([
      topicRef('topics/order-a.dita', 'A'),
      topicRef('topics/order-b.dita', 'B'),
    ]);

    assert.ok(html.includes('data-dita-book-xref'), 'order-b is part of this book, just not rendered yet -- the xref should still be a real link');
    assert.ok(!html.includes('xref-external'));
  });

  it('should leave a cross-file xref to a topic OUTSIDE this book as the existing non-clickable hint', () => {
    writeTopic('topics/order-a.dita', '<p><xref href="not-in-book.dita"/></p>');
    // Deliberately never referenced by any topicref below.
    writeTopic('topics/not-in-book.dita', '<p>elsewhere</p>');

    const html = renderBook([topicRef('topics/order-a.dita', 'A')]);

    assert.ok(html.includes('xref-external'));
    assert.ok(!html.includes('data-dita-book-xref'));
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

    assert.strictEqual((html.match(/<div class="book-entry"/g) || []).length, 2, 'the repeat contributes no second copy');
    assert.strictEqual(countOf(html, 'once'), 1, 'a book that repeats a topic would also repeat its ids');
    assert.ok(html.includes('class="book-skip"'), 'and it says so, rather than silently dropping the reference');
    assert.ok(html.includes('topics/dup.dita'), 'the skip message names the href it skipped');
    assert.ok(html.indexOf('between') < html.indexOf('book-skip'), 'the skip lands where the third reference was');
    // The duplicate reference itself gets no second anchor -- there is only
    // ever one manifest entry (and one sidebar row) for a repeated topic.
    assert.strictEqual(
      countOf(html, `data-book-anchor="${join(dir, 'topics', 'dup.dita')}"`),
      1,
      'the repeated reference does not get its own anchor',
    );
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

    // New bytes on disk -- the same number of them, since the stamp is
    // mtime:size -- with mtime pinned where it was: only a cached answer can
    // reproduce the previous pass exactly.
    writeTopic('topics/reuse-b.dita', '<p>zeta</p>');
    assert.strictEqual(
      renderBook(entries),
      first,
      'no dependency changed, so the whole assembly is byte-identical -- this is the reuse a book left open while editing depends on',
    );

    bumpMtime(b);
    const third = renderBook(entries);
    assert.ok(third.includes('zeta'), 'the edited topic is re-rendered');
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

    // nested-fold-and-highlight-plan.md item 1: book mode's own sidebar
    // scrolls to a part by this same id, computed by the one shared helper
    // buildBookNavManifest itself builds its ids from (computeManifestEntryPositions,
    // not exported -- exercised here through renderBookParts' own output
    // and cross-checked against buildBookNavManifest directly below).
    describe('anchor ids (data-book-anchor)', () => {
      it("should stamp a navigable topic's part with its own resolved path, matching buildBookNavManifest's id for the same entry", () => {
        writeTopic('topics/anchor-a.dita', '<p>a</p>');
        const entries = [topicRef('topics/anchor-a.dita', 'A')];

        const parts = renderParts(entries);
        const manifest = buildBookNavManifest(entries, dir);

        const expectedId = join(dir, 'topics', 'anchor-a.dita');
        assert.ok(parts[0].html.includes(`data-book-anchor="${expectedId}"`));
        assert.strictEqual(manifest[0].id, expectedId, 'sidebar and book content must agree on this entry\'s id');
      });

      it('should stamp a hrefless group heading (one with real descendants) with its positional grp: id, matching buildBookNavManifest', () => {
        const entries = [
          topicRef(undefined, 'Chapter 1: Intro'),
          topicRef('topics/anchor-b.dita', 'About', 1),
        ];
        writeTopic('topics/anchor-b.dita', '<p>b</p>');

        const parts = renderParts(entries);
        const manifest = buildBookNavManifest(entries, dir);

        assert.ok(parts[0].html.includes('data-book-anchor="grp:0"'));
        assert.strictEqual(manifest[0].id, 'grp:0');
      });

      it('should NOT stamp a childless hrefless entry (a bare key-only topicref) -- buildBookNavManifest drops it, so the sidebar never links to it', () => {
        const entries = [topicRef(undefined, 'V1.0.0')];

        const parts = renderParts(entries);
        const manifest = buildBookNavManifest(entries, dir);

        assert.ok(!parts[0].html.includes('data-book-anchor'));
        assert.strictEqual(manifest.length, 0, 'confirms this entry really has no sidebar row to scroll to');
      });

      it('should NOT stamp the second of two references to the same topic -- there is only one manifest entry (and sidebar row) for it', () => {
        writeTopic('topics/anchor-dup.dita', '<p>d</p>');
        const entries = [
          topicRef('topics/anchor-dup.dita', 'D'),
          topicRef('topics/anchor-dup.dita', 'D again'),
        ];

        const parts = renderParts(entries);

        assert.ok(parts[0].html.includes('data-book-anchor='));
        assert.ok(!parts[1].html.includes('data-book-anchor'), 'the skip note is not a second addressable copy');
      });

      it('should NOT stamp an unreadable/.ditamap-referencing entry with no absPath of its own', () => {
        writeFileSync(
          join(dir, 'topics', 'anchor-sub.ditamap'),
          '<?xml version="1.0" encoding="UTF-8"?>\n<map><title>X</title></map>',
        );
        const entries = [topicRef('topics/anchor-sub.ditamap', 'Sub')];

        const parts = renderParts(entries);

        assert.ok(!parts[0].html.includes('data-book-anchor'));
      });
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
  // Must be a genuinely absolute path -- with a drive letter on Windows --
  // the same shape dirname(document.uri.fsPath) always produces in real
  // usage. A bare '/proj/docs' *looks* absolute but has no drive letter, so
  // on Windows path.resolve() (which resolveBookTopicPath uses) silently
  // anchors it to whatever drive the process happens to be running from,
  // while path.join() (used below for expected values) doesn't -- the two
  // only diverge in this corner case, and only on Windows, which is why
  // this passed on Linux/macOS CI for a long time before windows-latest
  // caught it.
  const docDir = resolve('/proj/docs');

  it('resolves a plain .dita href against docDir', () => {
    const entry: MapEntry = { href: 'topics/intro.dita', displayName: 'Intro', displayNameExplicit: true, depth: 0 };
    assert.strictEqual(resolveBookTopicPath(entry, docDir), join(docDir, 'topics/intro.dita'));
  });

  it('strips a #fragment before resolving', () => {
    const entry: MapEntry = { href: 'topics/intro.dita#section2', displayName: 'Intro', displayNameExplicit: true, depth: 0 };
    assert.strictEqual(resolveBookTopicPath(entry, docDir), join(docDir, 'topics/intro.dita'));
  });

  it('returns undefined for an entry with no href (a keydef with no target, a topichead heading, ...)', () => {
    const entry: MapEntry = { href: undefined, displayName: 'Section heading', displayNameExplicit: true, depth: 0 };
    assert.strictEqual(resolveBookTopicPath(entry, docDir), undefined);
  });

  it('returns undefined for a .ditamap href -- expandDitamapRefs should have flattened it before entries reach here', () => {
    const entry: MapEntry = { href: 'submaps/appendix.ditamap', displayName: 'Appendix', displayNameExplicit: true, depth: 0 };
    assert.strictEqual(resolveBookTopicPath(entry, docDir), undefined);
  });

  it('decodes a URL-encoded href the same way renderBookEntries does', () => {
    const entry: MapEntry = { href: 'topics/caf%C3%A9.dita', displayName: 'Café', displayNameExplicit: true, depth: 0 };
    assert.strictEqual(resolveBookTopicPath(entry, docDir), join(docDir, 'topics/café.dita'));
  });

  it('builds one manifest entry per topic, in document order, carrying title/depth/role through', () => {
    const entries: MapEntry[] = [
      { href: 'topics/ch1.dita', displayName: 'Chapter One', displayNameExplicit: true, depth: 0, role: 'Chapter 1' },
      { href: 'topics/ch1-s1.dita', displayName: 'Section 1.1', displayNameExplicit: true, depth: 1 },
      { href: undefined, displayName: 'No target', displayNameExplicit: true, depth: 0 }, // childless keys-only topicref, not a topichead -- see buildBookNavManifest's own comment
    ];
    const manifest = buildBookNavManifest(entries, docDir);
    assert.deepStrictEqual(manifest, [
      { id: join(docDir, 'topics/ch1.dita'), absPath: join(docDir, 'topics/ch1.dita'), title: 'Chapter One', depth: 0, role: 'Chapter 1', topicType: undefined },
      { id: join(docDir, 'topics/ch1-s1.dita'), absPath: join(docDir, 'topics/ch1-s1.dita'), title: 'Section 1.1', depth: 1, role: undefined, topicType: undefined },
      // The trailing hrefless entry has nothing deeper following it, so
      // it's dropped rather than becoming an empty group header.
    ]);
  });

  it('keeps a hrefless entry as a non-navigable group header when it has real descendants nested under it (a <topichead>, in practice)', () => {
    const entries: MapEntry[] = [
      { href: undefined, displayName: 'Chapter 1: Intro', displayNameExplicit: true, depth: 0 },
      { href: 'topics/about.dita', displayName: 'About', displayNameExplicit: true, depth: 1 },
      { href: 'topics/overview.dita', displayName: 'Overview', displayNameExplicit: true, depth: 1 },
    ];
    const manifest = buildBookNavManifest(entries, docDir);
    assert.deepStrictEqual(manifest, [
      { id: 'grp:0', title: 'Chapter 1: Intro', depth: 0, role: undefined, isGroup: true },
      { id: join(docDir, 'topics/about.dita'), absPath: join(docDir, 'topics/about.dita'), title: 'About', depth: 1, role: undefined, topicType: undefined },
      { id: join(docDir, 'topics/overview.dita'), absPath: join(docDir, 'topics/overview.dita'), title: 'Overview', depth: 1, role: undefined, topicType: undefined },
    ]);
  });

  it('drops a hrefless entry with no descendants (a bare key-only topicref/keydef used only for keyref substitution) rather than showing an empty group', () => {
    const entries: MapEntry[] = [
      { href: undefined, displayName: 'V1.0.0', displayNameExplicit: true, depth: 0 },
      { href: 'topics/real.dita', displayName: 'Real Topic', displayNameExplicit: true, depth: 0 },
    ];
    const manifest = buildBookNavManifest(entries, docDir);
    assert.strictEqual(manifest.length, 1, 'the childless hrefless entry contributes nothing');
    assert.strictEqual(manifest[0].title, 'Real Topic');
  });

  it('drops a trailing hrefless entry with no descendants even when it is the very last entry in the map (no entries[i+1] to look at at all)', () => {
    const entries: MapEntry[] = [
      { href: 'topics/real.dita', displayName: 'Real Topic', displayNameExplicit: true, depth: 0 },
      { href: undefined, displayName: 'V1.0.0', displayNameExplicit: true, depth: 0 },
    ];
    assert.doesNotThrow(() => buildBookNavManifest(entries, docDir));
    const manifest = buildBookNavManifest(entries, docDir);
    assert.strictEqual(manifest.length, 1);
  });

  it('a resource-only hrefless entry never becomes a group header, even with real descendants nested under it -- and its surviving child is promoted up to depth 0, not stranded at depth 1', () => {
    const entries: MapEntry[] = [
      { href: undefined, displayName: 'Hidden Group', displayNameExplicit: true, depth: 0, resourceOnly: true },
      { href: 'topics/child.dita', displayName: 'Child', displayNameExplicit: true, depth: 1 },
    ];
    const manifest = buildBookNavManifest(entries, docDir);
    assert.strictEqual(manifest.length, 1, 'the resource-only group header itself is skipped, but its child is not resource-only and still shows');
    assert.strictEqual(manifest[0].title, 'Child');
    assert.strictEqual(manifest[0].depth, 0, 'depth is compacted -- with no surviving ancestor left in the manifest, the child is promoted to depth 0 rather than stranded at its original depth 1');
  });

  // --- depth compaction (a skipped ancestor must not strand its surviving descendants one level too deep) ---

  it('promotes every descendant of a skipped resource-only group by exactly one level, keeping siblings at their own relative depths', () => {
    const entries: MapEntry[] = [
      { href: undefined, displayName: 'Hidden Group', displayNameExplicit: true, depth: 0, resourceOnly: true },
      { href: 'topics/a.dita', displayName: 'A', displayNameExplicit: true, depth: 1 },
      { href: 'topics/a1.dita', displayName: 'A1', displayNameExplicit: true, depth: 2 },
      { href: 'topics/b.dita', displayName: 'B', displayNameExplicit: true, depth: 1 },
    ];
    const manifest = buildBookNavManifest(entries, docDir);
    assert.strictEqual(manifest.length, 3);
    assert.deepStrictEqual(manifest.map((e) => [e.title, e.depth]), [
      ['A', 0],
      ['A1', 1],
      ['B', 0],
    ]);
  });

  it('promotes descendants by two levels when two nested resource-only ancestors are both skipped', () => {
    const entries: MapEntry[] = [
      { href: undefined, displayName: 'Outer', displayNameExplicit: true, depth: 0, resourceOnly: true },
      { href: undefined, displayName: 'Inner', displayNameExplicit: true, depth: 1, resourceOnly: true },
      { href: 'topics/leaf.dita', displayName: 'Leaf', displayNameExplicit: true, depth: 2 },
    ];
    const manifest = buildBookNavManifest(entries, docDir);
    assert.strictEqual(manifest.length, 1);
    assert.strictEqual(manifest[0].title, 'Leaf');
    assert.strictEqual(manifest[0].depth, 0, 'both ancestors were skipped, so Leaf is promoted all the way to depth 0');
  });

  it('does not promote a surviving sibling that sits alongside (not under) a skipped entry', () => {
    const entries: MapEntry[] = [
      { href: 'topics/kept-parent.dita', displayName: 'Kept Parent', displayNameExplicit: true, depth: 0 },
      { href: undefined, displayName: 'Hidden Group', displayNameExplicit: true, depth: 1, resourceOnly: true },
      { href: 'topics/child.dita', displayName: 'Child', displayNameExplicit: true, depth: 2 },
    ];
    const manifest = buildBookNavManifest(entries, docDir);
    assert.strictEqual(manifest.length, 2);
    assert.deepStrictEqual(manifest.map((e) => [e.title, e.depth]), [
      ['Kept Parent', 0],
      // Child's own immediate parent (Hidden Group, depth 1) was skipped,
      // but Kept Parent (depth 0) is still a surviving ancestor above it --
      // Child is promoted only past the one skipped level, landing at
      // depth 1 (nested under Kept Parent), not all the way to depth 0.
      ['Child', 1],
    ]);
  });

  it('promotes descendants past a deduplicated (already-seen) topic the same way it does past a resource-only one', () => {
    const entries: MapEntry[] = [
      { href: 'topics/dup.dita', displayName: 'First occurrence', displayNameExplicit: true, depth: 0 },
      { href: 'topics/dup.dita', displayName: 'Second occurrence (dup)', displayNameExplicit: true, depth: 0 },
      { href: 'topics/child.dita', displayName: 'Child of the duplicate', displayNameExplicit: true, depth: 1 },
    ];
    const manifest = buildBookNavManifest(entries, docDir);
    assert.strictEqual(manifest.length, 2, 'the duplicate itself is dropped, its child is not');
    assert.deepStrictEqual(manifest.map((e) => [e.title, e.depth]), [
      ['First occurrence', 0],
      ['Child of the duplicate', 0],
    ]);
  });

  it('calls resolveTopicType for every entry with a real href and stores its return as topicType, regardless of whether role is also present', () => {
    const entries: MapEntry[] = [
      // Chapter that happens to be a <task> -- both chips should fire.
      { href: 'topics/ch1.dita', displayName: 'Chapter One', displayNameExplicit: true, depth: 0, role: 'Chapter 1' },
      // Plain topicref whose target is a <concept> -- only the type chip fires.
      { href: 'topics/c.dita', displayName: 'Concept X', displayNameExplicit: true, depth: 1 },
      // Childless keys-only topicref, no href -- no file to read, no type
      // chip, and (per buildBookNavManifest's own comment) not even
      // surfaced as a group header since it has nothing nested under it.
      { href: undefined, displayName: 'No target', displayNameExplicit: true, depth: 0 },
    ];
    const calls: string[] = [];
    const manifest = buildBookNavManifest(entries, docDir, undefined, (href) => {
      calls.push(href);
      // Pretend ch1.dita is a <task> and c.dita is a <concept>.
      if (href === 'topics/ch1.dita') return 'Task';
      if (href === 'topics/c.dita') return 'Concept';
      return undefined;
    });
    // resolveTopicType was called for both real-href entries, NOT the
    // hrefless one (which never reached the resolver -- it has no href
    // to pass it in the first place).
    assert.deepStrictEqual(calls, ['topics/ch1.dita', 'topics/c.dita']);
    assert.strictEqual(manifest.length, 2, 'the childless hrefless entry was dropped, manifest has the two real-href entries');
    assert.strictEqual(manifest[0].topicType, 'Task', 'chapter entry still gets its topic type');
    assert.strictEqual(manifest[1].topicType, 'Concept', 'plain topicref gets its topic type');
  });

  it('does not call resolveTopicType at all when none is passed -- the docsite-only cost stays opt-in, parallel to resolveTopicTitle', () => {
    const entries: MapEntry[] = [
      { href: 'topics/c.dita', displayName: 'Concept X', displayNameExplicit: true, depth: 0 },
    ];
    assert.doesNotThrow(() => buildBookNavManifest(entries, docDir));
    const manifest = buildBookNavManifest(entries, docDir);
    assert.strictEqual(manifest[0].topicType, undefined);
  });

  it('de-duplicates a topic referenced twice, keeping only its first occurrence -- same rule renderBookEntries applies via its own visited set', () => {
    const entries: MapEntry[] = [
      { href: 'topics/shared.dita', displayName: 'First mention', displayNameExplicit: true, depth: 0 },
      { href: 'topics/shared.dita', displayName: 'Second mention (should not appear)', displayNameExplicit: true, depth: 1 },
    ];
    const manifest = buildBookNavManifest(entries, docDir);
    assert.strictEqual(manifest.length, 1);
    assert.strictEqual(manifest[0].title, 'First mention');
  });

  it('excludes .ditamap entries from the manifest the same way it excludes them from resolution', () => {
    const entries: MapEntry[] = [
      { href: 'submaps/appendix.ditamap', displayName: 'Appendix (submap ref)', displayNameExplicit: true, depth: 0 },
      { href: 'topics/real.dita', displayName: 'Real topic', displayNameExplicit: true, depth: 0 },
    ];
    const manifest = buildBookNavManifest(entries, docDir);
    assert.strictEqual(manifest.length, 1);
    assert.strictEqual(manifest[0].title, 'Real topic');
  });

  it('resolveTopicTitle is consulted for every entry with an href, even one the map gave an explicit navtitle/linktext/keyword -- the sidebar shows the topic\'s own <title>, not the map\'s label for it', () => {
    const entries: MapEntry[] = [
      { href: 'topics/named.dita', displayName: 'A Map-Authored Navtitle', displayNameExplicit: true, depth: 0 },
      { href: 'topics/unnamed.dita', displayName: 'unnamed', displayNameExplicit: false, depth: 0 },
    ];
    const calls: string[] = [];
    const manifest = buildBookNavManifest(entries, docDir, (href) => {
      calls.push(href);
      return 'Resolved: ' + href;
    });
    assert.deepStrictEqual(calls, ['topics/named.dita', 'topics/unnamed.dita'], 'resolveTopicTitle should be called for every entry that has an href, explicit navtitle or not');
    assert.strictEqual(manifest[0].title, 'Resolved: topics/named.dita', 'the topic\'s own <title> wins over the map\'s navtitle/linktext/keyword');
    assert.strictEqual(manifest[1].title, 'Resolved: topics/unnamed.dita', 'fallback title gets replaced with the resolved one');
  });

  it('falls back to the map\'s displayName (navtitle or otherwise) when resolveTopicTitle finds no real <title> -- an explicit navtitle is still better than nothing', () => {
    const entries: MapEntry[] = [
      { href: 'topics/named.dita', displayName: 'A Map-Authored Navtitle', displayNameExplicit: true, depth: 0 },
    ];
    const manifest = buildBookNavManifest(entries, docDir, () => undefined);
    assert.strictEqual(manifest[0].title, 'A Map-Authored Navtitle');
  });

  it('keeps the fallback title when resolveTopicTitle finds nothing (topic has no <title> either, or the file failed to read)', () => {
    const entries: MapEntry[] = [
      { href: 'topics/unnamed.dita', displayName: 'unnamed', displayNameExplicit: false, depth: 0 },
    ];
    const manifest = buildBookNavManifest(entries, docDir, () => undefined);
    assert.strictEqual(manifest[0].title, 'unnamed');
  });

  it('does not call resolveTopicTitle at all when none is passed -- the docsite-only cost stays opt-in', () => {
    const entries: MapEntry[] = [
      { href: 'topics/unnamed.dita', displayName: 'unnamed', displayNameExplicit: false, depth: 0 },
    ];
    assert.doesNotThrow(() => buildBookNavManifest(entries, docDir));
    const manifest = buildBookNavManifest(entries, docDir);
    assert.strictEqual(manifest[0].title, 'unnamed');
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

  // --- stable id (sidebar collapsed-state persistence keys off this) ---

  it('gives every entry a stable, unique id -- navigable entries use their absPath, group entries a positional grp: path', () => {
    const entries: MapEntry[] = [
      { href: undefined, displayName: 'Chapter 1', displayNameExplicit: true, depth: 0 },
      { href: 'topics/a.dita', displayName: 'A', displayNameExplicit: true, depth: 1 },
      // Second top-level group shares the exact same title as the first --
      // title can't be the id (two <topichead>s commonly share text, and
      // the title itself is re-localized when the UI language changes),
      // so this must not collide with the first group's id.
      { href: undefined, displayName: 'Chapter 1', displayNameExplicit: true, depth: 0 },
      { href: 'topics/b.dita', displayName: 'B', displayNameExplicit: true, depth: 1 },
    ];
    const manifest = buildBookNavManifest(entries, docDir);
    assert.strictEqual(manifest.length, 4);
    const ids = manifest.map((e) => e.id);
    assert.strictEqual(new Set(ids).size, 4, 'all four ids must be unique even though two group headers share the exact same title');
    assert.strictEqual(manifest[0].id, 'grp:0');
    assert.strictEqual(manifest[1].id, join(docDir, 'topics/a.dita'));
    assert.strictEqual(manifest[2].id, 'grp:1', 'the second same-titled group header gets a different positional id, not the first one\'s');
    assert.strictEqual(manifest[3].id, join(docDir, 'topics/b.dita'));
  });

  it('id is deterministic across repeated builds of the exact same entries', () => {
    const entries: MapEntry[] = [
      { href: undefined, displayName: 'Group', displayNameExplicit: true, depth: 0 },
      { href: 'topics/x.dita', displayName: 'X', displayNameExplicit: true, depth: 1 },
    ];
    const first = buildBookNavManifest(entries, docDir).map((e) => e.id);
    const second = buildBookNavManifest(entries, docDir).map((e) => e.id);
    assert.deepStrictEqual(first, second);
  });

  it('nested group ids are dot-joined by ancestor position, not just their own sibling index', () => {
    const entries: MapEntry[] = [
      { href: undefined, displayName: 'Outer', displayNameExplicit: true, depth: 0 },
      { href: undefined, displayName: 'Inner', displayNameExplicit: true, depth: 1 },
      { href: 'topics/leaf.dita', displayName: 'Leaf', displayNameExplicit: true, depth: 2 },
    ];
    const manifest = buildBookNavManifest(entries, docDir);
    assert.strictEqual(manifest[0].id, 'grp:0');
    assert.strictEqual(manifest[1].id, 'grp:0.0');
    assert.strictEqual(manifest[2].id, join(docDir, 'topics/leaf.dita'));
  });
});

describe('renderSiteNavHtml', () => {
  const manifest = [
    { absPath: '/proj/docs/topics/a.dita', title: 'Topic A', depth: 0 },
    { absPath: '/proj/docs/topics/b.dita', title: 'Topic B', depth: 1 },
  ];

  it('renders one link per manifest entry, each carrying its absPath as the click target', () => {
    const html = renderSiteNavHtml(manifest, manifest[0].absPath, 'Topics');
    // Match only the <a> tags' class attribute, not the inner <span
    // class="site-nav-link-text"> -- the [\s"] after "site-nav-link"
    // rejects "site-nav-link-text" by requiring a space or closing quote
    // where the span has a hyphen.
    assert.strictEqual((html.match(/class="site-nav-link[\s"]/g) || []).length, 2);
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

  it('wraps the title in a span so the flex layout can ellipsis the title without clipping chips', () => {
    const html = renderSiteNavHtml(manifest, manifest[0].absPath, 'Topics');
    assert.ok(/<span class="site-nav-link-text">Topic A<\/span>/.test(html), 'title text is in a dedicated span');
  });

  it('emits no chip markup at all when neither role nor topicType is present on an entry', () => {
    const html = renderSiteNavHtml(manifest, manifest[0].absPath, 'Topics');
    assert.ok(!html.includes('site-nav-chip'), 'no chip classes when both role and topicType are undefined');
  });

  it('emits a role chip (and only a role chip) when only role is present', () => {
    const withRole = [
      { absPath: '/proj/docs/topics/a.dita', title: 'Topic A', depth: 0, role: 'Chapter 1' },
    ];
    const html = renderSiteNavHtml(withRole, withRole[0].absPath, 'Topics');
    assert.ok(/<span class="site-nav-chip site-nav-chip--role">Chapter 1<\/span>/.test(html), 'role chip is present and labelled');
    assert.ok(!html.includes('site-nav-chip--type'), 'no type chip when topicType is absent');
  });

  it('emits a type chip (and only a type chip) when only topicType is present', () => {
    const withType = [
      { absPath: '/proj/docs/topics/a.dita', title: 'Topic A', depth: 0, topicType: 'Concept' },
    ];
    const html = renderSiteNavHtml(withType, withType[0].absPath, 'Topics');
    assert.ok(/<span class="site-nav-chip site-nav-chip--type">Concept<\/span>/.test(html), 'type chip is present and labelled');
    assert.ok(!html.includes('site-nav-chip--role'), 'no role chip when role is absent');
  });

  it('emits both chips in order role, type, title when both are present on the same entry', () => {
    const both = [
      { absPath: '/proj/docs/topics/a.dita', title: 'Topic A', depth: 0, role: 'Chapter 1', topicType: 'Task' },
    ];
    const html = renderSiteNavHtml(both, both[0].absPath, 'Topics');
    // Role chip first, then type chip, then title text -- the order is the
    // visual order on screen, and the order in which a screen reader
    // announces them.
    assert.ok(/<span class="site-nav-chip site-nav-chip--role">Chapter 1<\/span><span class="site-nav-chip site-nav-chip--type">Task<\/span><span class="site-nav-link-text">Topic A<\/span>/.test(html), 'chips precede title in the right order');
  });

  it('escapes title/aria-label/path AND chip text for XSS (a labeler fed a malicious tag name must not inject markup)', () => {
    const evil = [
      {
        absPath: '/proj/"><script>x</script>.dita',
        title: '<script>alert(1)</script>',
        depth: 0,
        role: '<script>r</script>',
        topicType: '<script>t</script>',
      },
    ];
    const html = renderSiteNavHtml(evil, evil[0].absPath, '<script>y</script>');
    assert.ok(!html.includes('<script>'), 'no raw script tag anywhere');
    assert.ok(html.includes('&lt;script&gt;'), 'title text is escaped');
    assert.ok(html.includes('site-nav-chip--role'), 'role chip is present');
    assert.ok(html.includes('site-nav-chip--type'), 'type chip is present');
    // The chip text itself must also be escaped, not just the title.
    const roleChipMatch = html.match(/site-nav-chip--role[^<]*<[^>]*>([^<]*)</);
    assert.ok(roleChipMatch, 'role chip has text content');
    assert.ok(!roleChipMatch![1].includes('<script>'), 'role chip text is escaped');
  });

  // --- collapsible tree structure (Oxygen-style expand/collapse toggle) ---

  it('nests a depth-1 entry inside its depth-0 parent\'s own <ul class="site-nav-children">, not as a flat sibling', () => {
    const html = renderSiteNavHtml(manifest, manifest[0].absPath, 'Topics');
    // manifest here is [depth 0 "a", depth 1 "b"] -- b must be inside a's
    // own children list. A flat list (the pre-tree implementation) would
    // never produce a site-nav-children element at all.
    const parentLi = /<li class="site-nav-item has-children"[^>]*>.*<\/li>/s.exec(html);
    assert.ok(parentLi, 'the parent entry should render as a has-children <li>');
    assert.ok(parentLi![0].includes('site-nav-children'), 'the parent <li> should contain a site-nav-children wrapper');
    assert.ok(parentLi![0].includes('data-site-target="/proj/docs/topics/b.dita"'), 'the child link should be inside the parent\'s own <li>, not a sibling of it');
  });

  it('gives a parent entry a toggle button and a leaf entry none', () => {
    const html = renderSiteNavHtml(manifest, manifest[0].absPath, 'Topics');
    assert.strictEqual((html.match(/class="site-nav-toggle"/g) || []).length, 1, 'only the one parent entry (depth 0, with a depth-1 child) should get a toggle');
  });

  it('renders a leaf-only manifest (no entry has children) with zero toggle buttons', () => {
    const flat = [
      { absPath: '/proj/docs/topics/a.dita', title: 'Topic A', depth: 0 },
      { absPath: '/proj/docs/topics/b.dita', title: 'Topic B', depth: 0 },
    ];
    const html = renderSiteNavHtml(flat, flat[0].absPath, 'Topics');
    assert.ok(!html.includes('site-nav-toggle'), 'no entry has children, so no toggle should render at all');
    assert.ok(!html.includes('has-children'));
  });

  it('starts every parent entry expanded (aria-expanded="true", no collapsed class) so nothing is hidden on first render', () => {
    const html = renderSiteNavHtml(manifest, manifest[0].absPath, 'Topics');
    assert.ok(!html.includes('collapsed'), 'nothing should start collapsed');
    assert.ok(/<button type="button" class="site-nav-toggle"[^>]*aria-expanded="true"/.test(html));
  });

  it('groups a three-level manifest (0/1/2) so the depth-2 entry nests under the depth-1 entry, which itself nests under the depth-0 entry', () => {
    const nested = [
      { absPath: '/proj/docs/topics/a.dita', title: 'Topic A', depth: 0 },
      { absPath: '/proj/docs/topics/b.dita', title: 'Topic B', depth: 1 },
      { absPath: '/proj/docs/topics/c.dita', title: 'Topic C', depth: 2 },
    ];
    const html = renderSiteNavHtml(nested, nested[0].absPath, 'Topics');
    // c's own link must appear textually after b's own <ul class="site-nav-children">
    // opening tag and before b's own </li> -- i.e. c is inside b's subtree,
    // not a sibling of b under a.
    const bStart = html.indexOf('data-site-target="/proj/docs/topics/b.dita"');
    const bChildrenOpen = html.indexOf('site-nav-children', bStart);
    const cLink = html.indexOf('data-site-target="/proj/docs/topics/c.dita"');
    assert.ok(bStart > -1 && bChildrenOpen > -1 && cLink > -1);
    assert.ok(cLink > bChildrenOpen, 'c should be nested inside b\'s own children list, not a', );
  });

  it('handles an irregular depth jump (0 straight to 2) without throwing, nesting the depth-2 entry as a child of the depth-0 entry', () => {
    const irregular = [
      { absPath: '/proj/docs/topics/a.dita', title: 'Topic A', depth: 0 },
      { absPath: '/proj/docs/topics/c.dita', title: 'Topic C', depth: 2 },
    ];
    assert.doesNotThrow(() => renderSiteNavHtml(irregular, irregular[0].absPath, 'Topics'));
    const html = renderSiteNavHtml(irregular, irregular[0].absPath, 'Topics');
    assert.ok(html.includes('has-children'), 'a should still be recognized as having a child even though the depth jumped by 2');
  });

  it('uses the supplied expand/collapse labels for the toggle\'s data attributes and initial aria-label instead of the English defaults', () => {
    const html = renderSiteNavHtml(manifest, manifest[0].absPath, 'Topics', { expand: '\u5c55\u5f00', collapse: '\u6298\u53e0' });
    assert.ok(html.includes('data-expand-label="\u5c55\u5f00"'));
    assert.ok(html.includes('data-collapse-label="\u6298\u53e0"'));
    // Starts expanded, so the initial aria-label should be the collapse verb
    // (what clicking it right now would do), same convention as a real
    // file explorer's own expand/collapse control.
    assert.ok(html.includes('aria-label="\u6298\u53e0"'));
  });

  it('escapes the expand/collapse labels for XSS the same way title/chip text is escaped', () => {
    const evil = { expand: '<script>e</script>', collapse: '<script>c</script>' };
    const html = renderSiteNavHtml(manifest, manifest[0].absPath, 'Topics', evil);
    assert.ok(!html.includes('<script>'), 'no raw script tag anywhere, including from the toggle labels');
    assert.ok(html.includes('&lt;script&gt;'));
  });

  // --- group entries (DocsiteNavEntry.isGroup -- a topichead, in practice) ---

  it('renders a group entry as a non-clickable label -- no <a>, no data-site-target -- with its real children nested under it', () => {
    const withGroup = [
      { title: 'Chapter 1: Intro', depth: 0, isGroup: true },
      { absPath: '/proj/docs/topics/about.dita', title: 'About', depth: 1 },
    ];
    const html = renderSiteNavHtml(withGroup, withGroup[1].absPath as string, 'Topics');
    const groupLi = /<li class="site-nav-item site-nav-item--group[^>]*>.*<\/li>/s.exec(html);
    assert.ok(groupLi, 'the group entry should render with the site-nav-item--group class');
    assert.ok(!groupLi![0].startsWith('') || !/<a[ >]/.test(groupLi![0].split('site-nav-children')[0]), 'no <a> tag before the nested children -- the group label itself is not a link');
    assert.ok(groupLi![0].includes('data-site-target="/proj/docs/topics/about.dita"'), 'the real child link should still be nested inside the group\'s own <li>');
    assert.ok(!html.includes('data-site-target="Chapter 1: Intro"'), 'the group entry itself never gets a data-site-target');
  });

  it('still gives a group entry with children an expand/collapse toggle, same as any other parent', () => {
    const withGroup = [
      { title: 'Chapter 1', depth: 0, isGroup: true },
      { absPath: '/proj/docs/topics/a.dita', title: 'A', depth: 1 },
    ];
    const html = renderSiteNavHtml(withGroup, withGroup[1].absPath as string, 'Topics');
    assert.strictEqual((html.match(/class="site-nav-toggle"/g) || []).length, 1);
  });

  it('a group entry with no children at all still renders (no toggle, just the bare label) rather than throwing', () => {
    const bareGroup = [{ title: 'Empty Section', depth: 0, isGroup: true }];
    assert.doesNotThrow(() => renderSiteNavHtml(bareGroup, '', 'Topics'));
    const html = renderSiteNavHtml(bareGroup, '', 'Topics');
    assert.ok(!html.includes('site-nav-toggle'));
    assert.ok(html.includes('Empty Section'));
  });

  it('escapes a group entry\'s own title the same way a real link\'s title is escaped', () => {
    const evilGroup = [{ title: '<script>alert(1)</script>', depth: 0, isGroup: true }];
    const html = renderSiteNavHtml(evilGroup, '', 'Topics');
    assert.ok(!html.includes('<script>alert'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  it('nests two sibling groups\' children correctly (the manual.ditamap regression this feature exists for): each topichead\'s own topics stay under it, not flattened together', () => {
    const twoChapters = [
      { title: 'Chapter 1', depth: 0, isGroup: true },
      { absPath: '/proj/docs/topics/a.dita', title: 'A', depth: 1 },
      { absPath: '/proj/docs/topics/b.dita', title: 'B', depth: 1 },
      { title: 'Chapter 2', depth: 0, isGroup: true },
      { absPath: '/proj/docs/topics/c.dita', title: 'C', depth: 1 },
    ];
    const html = renderSiteNavHtml(twoChapters, twoChapters[1].absPath as string, 'Topics');
    // Two top-level <li>s (one per chapter), not four/five flattened siblings.
    assert.strictEqual((html.match(/class="site-nav-item site-nav-item--group/g) || []).length, 2);
    const chapter1Li = /<li class="site-nav-item site-nav-item--group[^"]*"[^>]*>.*?(?=<li class="site-nav-item site-nav-item--group)/s.exec(html);
    assert.ok(chapter1Li, 'chapter 1\'s own <li> should be extractable up to the start of chapter 2\'s');
    assert.ok(chapter1Li![0].includes('data-site-target="/proj/docs/topics/a.dita"'));
    assert.ok(chapter1Li![0].includes('data-site-target="/proj/docs/topics/b.dita"'));
    assert.ok(!chapter1Li![0].includes('data-site-target="/proj/docs/topics/c.dita"'), 'chapter 2\'s topic C must not leak into chapter 1\'s own subtree');
  });
});

// nested-fold-and-highlight-plan.md item 1's side-channel sidebar refresh
// (MapViewerProvider.ts MSG_UPDATE_SIDEBAR) replaces .site-nav's innerHTML
// with renderSiteNavTreeHtml's output directly, leaving the <nav> element
// itself untouched -- so composition with the <nav> wrapper has to be
// exact, not just visually equivalent, or the refresh would leave the
// wrapper's own content duplicated or mismatched.
describe('renderSiteNavTreeHtml (extracted for MapViewerProvider\'s incremental sidebar refresh)', () => {
  const manifest = [
    { absPath: '/proj/docs/topics/a.dita', title: 'Topic A', depth: 0 },
    { absPath: '/proj/docs/topics/b.dita', title: 'Topic B', depth: 1 },
  ];

  it('renderSiteNavHtml is exactly <nav class="site-nav" aria-label="...">renderSiteNavTreeHtml(...)</nav>, byte for byte', () => {
    const treeHtml = renderSiteNavTreeHtml(manifest, manifest[0].absPath, { expand: 'Expand', collapse: 'Collapse' });
    const navHtml = renderSiteNavHtml(manifest, manifest[0].absPath, 'Topics', { expand: 'Expand', collapse: 'Collapse' });
    assert.strictEqual(navHtml, `<nav class="site-nav" aria-label="Topics">${treeHtml}</nav>`);
  });

  it('starts with <ul class="site-nav-tree" and ends with </ul>, with no <nav> wrapper of its own', () => {
    const treeHtml = renderSiteNavTreeHtml(manifest, manifest[0].absPath, { expand: 'Expand', collapse: 'Collapse' });
    assert.ok(treeHtml.startsWith('<ul class="site-nav-tree"'));
    assert.ok(treeHtml.endsWith('</ul>'));
    assert.ok(!treeHtml.includes('<nav'));
  });

  it('defaults toggleLabels the same way renderSiteNavHtml does, when called with none', () => {
    const grouped = [
      { title: 'Chapter 1', depth: 0, isGroup: true },
      { absPath: '/proj/docs/topics/a.dita', title: 'A', depth: 1 },
    ];
    const treeHtml = renderSiteNavTreeHtml(grouped, grouped[1].absPath as string);
    assert.ok(treeHtml.includes('data-expand-label="Expand"'));
    assert.ok(treeHtml.includes('data-collapse-label="Collapse"'));
  });

  // nested-fold-and-highlight-plan.md item 3: persisted collapse state.
  // Rendering the matching rows already collapsed on arrival is what makes
  // this "persisted" rather than "collapsed then immediately expanded"
  // (there is no script pass that walks the tree collapsing rows after
  // load -- everything here happens in the markup renderSiteNavTreeHtml
  // itself produces).
  describe('data-nav-id and collapsedIds', () => {
    const grouped = [
      { id: 'grp:0', title: 'Chapter 1', depth: 0, isGroup: true },
      { id: '/proj/docs/topics/a.dita', absPath: '/proj/docs/topics/a.dita', title: 'A', depth: 1 },
    ];

    it('stamps data-nav-id from DocsiteNavEntry.id on every row that has one, group and link alike', () => {
      const treeHtml = renderSiteNavTreeHtml(grouped, grouped[1].absPath as string);
      assert.ok(treeHtml.includes('data-nav-id="grp:0"'));
      assert.ok(treeHtml.includes('data-nav-id="/proj/docs/topics/a.dita"'));
    });

    it('omits data-nav-id entirely for a hand-built entry with no id, rather than falling back to title or position', () => {
      const noId = [{ title: 'Chapter 1', depth: 0, isGroup: true }];
      const treeHtml = renderSiteNavTreeHtml(noId, '');
      assert.ok(!treeHtml.includes('data-nav-id'));
    });

    it('a group entry whose id is in collapsedIds renders collapsed on arrival: the class, both aria-expanded attributes, and the expand-label all set together', () => {
      // Active page is elsewhere: a group that CONTAINS the active page is
      // deliberately never rendered collapsed (see the describe block below).
      const treeHtml = renderSiteNavTreeHtml(
        grouped,
        '/proj/docs/topics/elsewhere.dita',
        { expand: 'Expand', collapse: 'Collapse' },
        new Set(['grp:0']),
      );
      const itemMatch = /<li class="site-nav-item site-nav-item--group has-children collapsed" role="treeitem" aria-expanded="false"[^>]*>/.exec(treeHtml);
      assert.ok(itemMatch, 'the <li> itself carries both the collapsed class and aria-expanded="false"');
      assert.ok(treeHtml.includes('aria-expanded="false" aria-label="Expand"'), 'the toggle button itself is also collapsed, offering to expand');
      // The children <ul> is still rendered (media/styles.css hides it via
      // the .collapsed cascade, not a server-side omission) -- so a
      // collapsed group's contents are still in the DOM for
      // getBookNavClickHandlerScript/full-book search to find, just
      // visually hidden.
      assert.ok(treeHtml.includes('data-site-target="/proj/docs/topics/a.dita"'));
    });

    it('an id in collapsedIds that does not belong to any has-children row (e.g. a leaf, or one from a map that has since changed) is silently ignored', () => {
      const leafOnly = [{ id: '/proj/docs/topics/a.dita', absPath: '/proj/docs/topics/a.dita', title: 'A', depth: 0 }];
      assert.doesNotThrow(() => renderSiteNavTreeHtml(leafOnly, '', undefined, new Set(['/proj/docs/topics/a.dita', 'grp:99'])));
      const treeHtml = renderSiteNavTreeHtml(leafOnly, '', undefined, new Set(['/proj/docs/topics/a.dita']));
      assert.ok(!treeHtml.includes('collapsed'), 'a leaf never gets a toggle or a collapsed class regardless of collapsedIds');
    });

    it('defaults to an empty set (everything expanded) when collapsedIds is omitted, unchanged from before this feature', () => {
      const treeHtml = renderSiteNavTreeHtml(grouped, grouped[1].absPath as string);
      assert.ok(!treeHtml.includes('collapsed'));
      assert.ok(treeHtml.includes('aria-expanded="true"'));
    });

    it('renderSiteNavHtml threads collapsedIds through to renderSiteNavTreeHtml unchanged', () => {
      const withHelper = renderSiteNavTreeHtml(grouped, '', { expand: 'Expand', collapse: 'Collapse' }, new Set(['grp:0']));
      const navHtml = renderSiteNavHtml(grouped, '', 'Topics', { expand: 'Expand', collapse: 'Collapse' }, new Set(['grp:0']));
      assert.strictEqual(navHtml, `<nav class="site-nav" aria-label="Topics">${withHelper}</nav>`);
    });
  });

  // A persisted collapsed set is only ever applied to rows OFF the path to the
  // page being shown. Site mode re-renders the whole page (sidebar included)
  // on every edit and on every open, so honouring a persisted collapse on an
  // ancestor of the active topic would hide the row that says where the
  // reader is, with no way to tell why.
  describe('collapsedIds never hides the path to the active page', () => {
    const nested = [
      { id: 'grp:0', title: 'Part', depth: 0, isGroup: true },
      { id: 'grp:0.0', title: 'Chapter', depth: 1, isGroup: true },
      { id: '/p/a.dita', absPath: '/p/a.dita', title: 'A', depth: 2 },
      { id: 'grp:1', title: 'Other part', depth: 0, isGroup: true },
      { id: '/p/b.dita', absPath: '/p/b.dita', title: 'B', depth: 1 },
    ];
    const collapsedAll = new Set(['grp:0', 'grp:0.0', 'grp:1']);
    const itemClass = (html: string, id: string): string => {
      const m = new RegExp(`<li class="([^"]*)"[^>]*data-nav-id="${id.replace(/[.:]/g, '\\$&')}"`).exec(html);
      assert.ok(m, `row ${id} not found`);
      return m![1];
    };

    it('renders every collapsed ancestor of the active page expanded, however deep', () => {
      const html = renderSiteNavTreeHtml(nested, '/p/a.dita', undefined, collapsedAll, true);
      assert.ok(!itemClass(html, 'grp:0').includes('collapsed'), 'the part containing the active page');
      assert.ok(!itemClass(html, 'grp:0.0').includes('collapsed'), 'the chapter containing the active page');
    });

    it('still renders collapsed the branches that do not contain the active page', () => {
      const html = renderSiteNavTreeHtml(nested, '/p/a.dita', undefined, collapsedAll, true);
      assert.ok(itemClass(html, 'grp:1').includes('collapsed'));
    });

    it('leaves the persisted collapse alone when revealActive is off (book mode: its currentAbsPath is only the initial highlight)', () => {
      const html = renderSiteNavTreeHtml(nested, '/p/a.dita', undefined, collapsedAll);
      assert.ok(itemClass(html, 'grp:0').includes('collapsed'));
      assert.ok(itemClass(html, 'grp:0.0').includes('collapsed'));
    });

    it('applies the persisted collapse again once the active page is somewhere else', () => {
      const html = renderSiteNavTreeHtml(nested, '/p/b.dita', undefined, collapsedAll, true);
      assert.ok(itemClass(html, 'grp:0').includes('collapsed'));
      assert.ok(itemClass(html, 'grp:0.0').includes('collapsed'));
      assert.ok(!itemClass(html, 'grp:1').includes('collapsed'));
    });
  });
});
