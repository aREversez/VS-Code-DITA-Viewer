import * as assert from 'assert';
import { collectMapEntries } from '../../render/mapTypeMap';
import { parseDitamap, preprocessEntities } from '../../parser/ditaParser';
import { renderBookPlaceholder, renderBookError, renderBookSkipMessage, expandDitamapRefs } from '../../editor/ditaRenderUtils';
import type { DitaNode } from '../../parser/domTypes';

function makeMapNode(baseType: string, attrs: Record<string, string>, children: DitaNode[] = []): DitaNode {
  return {
    type: 'element',
    baseType,
    attributes: attrs,
    children,
    sourceRange: { startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
  };
}

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

// ── ditamap-level profiling for book mode ──
describe('collectMapEntries profiling', () => {
  it('should attach profileKeys/profileChipsHtml for a topicref carrying its own profiling attribute', () => {
    const doc = parseMap(`<map><topicref href="a.dita" audience="internal"/></map>`);
    const entries = collectMapEntries(doc.root);
    assert.strictEqual(entries[0].profileKeys, 'audience:internal');
    assert.ok(entries[0].profileChipsHtml?.includes('Audience'));
    assert.ok(entries[0].profileChipsHtml?.includes('[internal]'));
  });

  it('should leave profileKeys undefined for an entry with no profiling attribute and nothing inherited', () => {
    const doc = parseMap(`<map><topicref href="a.dita"/></map>`);
    const entries = collectMapEntries(doc.root);
    assert.strictEqual(entries[0].profileKeys, undefined);
  });

  it('should cascade a.dita\'s profiling attribute to child entries b.dita, c.dita, and d.dita', () => {
    const doc = parseMap(`<map>
      <topicref href="a.dita" audience="internal">
        <topicref href="b.dita"/>
        <topicref href="c.dita"/>
        <topicref href="d.dita"/>
      </topicref>
    </map>`);
    const entries = collectMapEntries(doc.root);
    assert.strictEqual(entries.length, 4);
    for (const e of entries) {
      assert.strictEqual(e.profileKeys, 'audience:internal', `${e.href} should inherit audience:internal from a.dita`);
    }
  });

  it('should let a topicref\'s own value override an inherited value for the same attribute rather than merging', () => {
    const doc = parseMap(`<map>
      <topicref href="a.dita" audience="internal">
        <topicref href="b.dita" audience="external"/>
      </topicref>
    </map>`);
    const entries = collectMapEntries(doc.root);
    assert.strictEqual(entries[0].profileKeys, 'audience:internal');
    assert.strictEqual(entries[1].profileKeys, 'audience:external');
  });

  it('should cascade through a map-of-maps: expandDitamapRefs flattens the submap first, then profiling inheritance runs over the merged tree', () => {
    // Reproduces the reported "all-in-one.ditamap only contains refs to
    // other ditamaps" scenario: the outer topicref that points at the
    // submap carries audience="internal", and b.dita (which only exists
    // inside the submap, injected as a child by expandDitamapRefs) must
    // still pick up that inherited attribute even though it was never
    // physically written next to it in any single file.
    const SUBMAP_XML = `<map><topicref href="b.dita"/></map>`;
    const outerNode = makeMapNode('map/topicref', { href: 'sub.ditamap', audience: 'internal' });
    expandDitamapRefs(outerNode, '/project', () => SUBMAP_XML);
    assert.strictEqual(outerNode.children.length, 1, 'sub.ditamap\'s topicref should have been spliced in as a child');

    const rootNode = makeMapNode('map/map', {}, [outerNode]);
    const entries = collectMapEntries(rootNode);
    // entries[0] = the sub.ditamap reference itself, entries[1] = b.dita from inside it
    assert.strictEqual(entries[0].href, 'sub.ditamap');
    assert.strictEqual(entries[0].profileKeys, 'audience:internal');
    assert.strictEqual(entries[1].href, 'b.dita');
    assert.strictEqual(entries[1].profileKeys, 'audience:internal', 'b.dita, injected from the submap, should still inherit the outer topicref\'s audience');
  });
});

describe('bookRendering profiling', () => {
  it('should attach data-profile-keys and chip markup to a placeholder entry', () => {
    const html = renderBookPlaceholder('Sub Map', 0, 'audience:internal', '<span class="profiling-chip">Audience [internal]</span>');
    assert.ok(html.includes('data-profile-keys="audience:internal"'));
    assert.ok(html.includes('map-profiling-badges'));
  });

  it('should omit data-profile-keys entirely from a placeholder when no profiling attribute applies', () => {
    const html = renderBookPlaceholder('Plain Section', 0);
    assert.ok(!html.includes('data-profile-keys'));
    assert.ok(!html.includes('map-profiling-badges'));
  });

  it('should attach data-profile-keys to an error entry too', () => {
    const html = renderBookError('Broken', 'File not found', 0, 'platform:windows', '<span class="profiling-chip">Platform [windows]</span>');
    assert.ok(html.includes('data-profile-keys="platform:windows"'));
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
