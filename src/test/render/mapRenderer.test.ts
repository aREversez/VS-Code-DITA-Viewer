import * as assert from 'assert';
import { getMapTitleText, renderMapDocument } from '../../render/mapTypeMap';
import { parseDitamap, preprocessEntities } from '../../parser/ditaParser';
import { expandDitamapRefs } from '../../editor/ditaRenderUtils';
import type { DitaNode } from '../../parser/domTypes';

function parseAndRender(xml: string): string {
  const doc = parseDitamap(preprocessEntities(xml));
  return renderMapDocument(doc.root, { docDir: '/test' });
}

describe('mapRenderer', () => {
  it('should render a basic map with title', () => {
    const xml = `<map><title>My Map</title></map>`;
    const html = parseAndRender(xml);
    assert.ok(html.includes('My Map'));
    assert.ok(html.includes('class="ditamap-container"'));
    assert.ok(html.includes('class="map-tree"'));
  });

  it('should escape map title text to prevent XSS', () => {
    const xml = `<map><title>Evil &lt;img src=x onerror=alert(1)&gt; Title</title></map>`;
    const html = parseAndRender(xml);
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'angle brackets should be escaped');
    assert.ok(!html.includes('<img'), 'no raw img tag should appear');
  });

  it('should render topicref with linktext as display name', () => {
    const xml = `<map>
      <topicref keys="product_name" href="topics/db_overview.dita">
        <topicmeta><linktext>DatabaseX Pro v3.0</linktext></topicmeta>
      </topicref>
    </map>`;
        const html = parseAndRender(xml);
        assert.ok(html.includes('DatabaseX Pro v3.0'));
        assert.ok(html.includes('map-tree-item--nav'));
        assert.ok(html.includes('data-href="topics/db_overview.dita"'));
  });

  it('should render keydef as non-navigable', () => {
    const xml = `<map>
      <keydef keys="name">
        <topicmeta>
          <keywords><keyword>Rectangle</keyword></keywords>
        </topicmeta>
      </keydef>
    </map>`;
        const html = parseAndRender(xml);
        assert.ok(html.includes('Rectangle'));
        assert.ok(html.includes('map-tree-item--keydef'));
        assert.ok(!html.includes('data-href'));
  });

  it('should render topicref with keys but no href as non-navigable', () => {
    const xml = `<map>
      <topicref keys="company_name">
        <topicmeta><linktext>ACME Corporation</linktext></topicmeta>
      </topicref>
    </map>`;
        const html = parseAndRender(xml);
        assert.ok(html.includes('ACME Corporation'));
        assert.ok(html.includes('map-tree-item--keydef'));
  });

  it('should fall back to href filename when no topicmeta exists', () => {
    const xml = `<map>
      <topicref href="topics/db_overview.dita"/>
    </map>`;
        const html = parseAndRender(xml);
        assert.ok(html.includes('db_overview'));
        // href value should appear in data-href attribute
        assert.ok(html.includes('data-href="topics/db_overview.dita"'));
  });

  it('should render nested topicrefs as sub-tree', () => {
    const xml = `<map>
      <topicref href="parent.dita">
        <topicmeta><linktext>Parent</linktext></topicmeta>
        <topicref href="child.dita">
          <topicmeta><linktext>Child</linktext></topicmeta>
        </topicref>
      </topicref>
    </map>`;
    const html = parseAndRender(xml);
    assert.ok(html.includes('Parent'));
    assert.ok(html.includes('Child'));
    // Nested ul should exist
    const nestedUlIndex = html.indexOf('<ul class="map-tree">', html.indexOf('Parent') + 10);
    assert.ok(nestedUlIndex >= 0, 'should have nested tree for child');
  });

  it('should escape href attribute to prevent XSS', () => {
    const xml = `<map>
      <topicref href='"><script>alert(1)</script>'>
        <topicmeta><linktext>XSS</linktext></topicmeta>
      </topicref>
    </map>`;
    const html = parseAndRender(xml);
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!html.includes('<script>alert(1)</script>'));
  });

  it('should escape keys attribute to prevent XSS', () => {
    const xml = `<map>
      <keydef keys='x"><script>alert(1)</script>'>
        <topicmeta>
          <keywords><keyword>safe</keyword></keywords>
        </topicmeta>
      </keydef>
    </map>`;
    const html = parseAndRender(xml);
    // The display name should be "safe" (from keyword), not the malicious keys
    assert.ok(html.includes('safe'));
    assert.ok(!html.includes('<script>alert(1)</script>'));
  });

  it('should render all linktext from test ditamap', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
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
    const html = parseAndRender(xml);
    assert.ok(html.includes('DatabaseX Pro v3.0'));
    assert.ok(html.includes('ACME Corporation'));
    assert.ok(html.includes('V1.0.0'));
    assert.ok(html.includes('Rectangle'));
    assert.ok(html.includes('db_overview'));
    assert.ok(html.includes('db_config'));
    assert.ok(html.includes('db_ui_test'));
  });

  it('should resolve ph keyref in the map title', () => {
    const xml = `<map><title><ph keyref="product_name"/> User Guide</title></map>`;
    const doc = parseDitamap(preprocessEntities(xml));
    const keyMap = new Map([['product_name', 'DatabaseX Pro v3.0']]);
    const html = renderMapDocument(doc.root, { docDir: '/test', resolveKey: (k) => keyMap.get(k) });
    assert.ok(html.includes('DatabaseX Pro v3.0 User Guide'), `expected resolved title, got: ${html}`);
  });

  it('should leave the title text intact when the keyref is unresolved', () => {
    const xml = `<map><title><ph keyref="missing_key"/> User Guide</title></map>`;
    const doc = parseDitamap(preprocessEntities(xml));
    const html = renderMapDocument(doc.root, { docDir: '/test', resolveKey: () => undefined });
    assert.ok(html.includes('User Guide'));
  });

  it('should escape a malicious key value substituted into the title (XSS guard)', () => {
    const xml = `<map><title><ph keyref="product_name"/></title></map>`;
    const doc = parseDitamap(preprocessEntities(xml));
    const keyMap = new Map([['product_name', '<img src=x onerror=alert(1)>']]);
    const html = renderMapDocument(doc.root, { docDir: '/test', resolveKey: (k) => keyMap.get(k) });
    assert.ok(!html.includes('<img'), 'raw tag must not appear');
    assert.ok(html.includes('&lt;img'), 'value must be escaped');
  });

  // ── BookMap rendering tests ──

  it('should render a bookmap with booktitle/mainbooktitle', () => {
    const xml = `<bookmap>
      <booktitle><mainbooktitle>My Book</mainbooktitle></booktitle>
      <chapter href="topics/intro.dita">
        <topicmeta><navtitle>Introduction</navtitle></topicmeta>
      </chapter>
    </bookmap>`;
    const html = parseAndRender(xml);
    assert.ok(html.includes('My Book'), 'book title should appear');
    assert.ok(html.includes('Introduction'), 'chapter navtitle should appear');
    assert.ok(html.includes('class="ditamap-container"'), 'should use map container');
    assert.ok(html.includes('map-tree-item--nav'), 'chapter should render as navigable');
    assert.ok(html.includes('data-href="topics/intro.dita"'), 'chapter href should appear');
  });

  it('should render mainbooktitle directly when no booktitle wrapper', () => {
    const xml = `<bookmap>
      <mainbooktitle>Direct Title</mainbooktitle>
    </bookmap>`;
    const html = parseAndRender(xml);
    assert.ok(html.includes('Direct Title'), 'mainbooktitle should appear as title');
  });

  it('should render chapter as navigable link', () => {
    const xml = `<bookmap>
      <chapter href="topics/ch1.dita"/>
      <appendix href="topics/appA.dita"/>
      <part href="topics/part1.dita"/>
    </bookmap>`;
    const html = parseAndRender(xml);
    assert.ok(html.includes('ch1'), 'chapter href filename fallback');
    assert.ok(html.includes('appA'), 'appendix href filename fallback');
    assert.ok(html.includes('part1'), 'part href filename fallback');
    assert.ok(html.includes('map-tree-item--nav'), 'should render as navigable');
  });

  it('should render frontmatter/booklists/toc as visible structural labels', () => {
    const xml = `<bookmap>
      <frontmatter>
        <booklists>
          <toc/>
        </booklists>
      </frontmatter>
    </bookmap>`;
    const html = parseAndRender(xml);
    // All three labels should appear capitalized
    assert.ok(html.includes('Frontmatter'), 'Frontmatter label should appear');
    assert.ok(html.includes('Booklists'), 'Booklists label should appear');
    assert.ok(html.includes('Toc'), 'Toc label should appear');
    // Should use the structural CSS class
    assert.ok(html.includes('map-tree-item--structural'), 'should use structural item class');
    assert.ok(html.includes('map-tree-label--structural'), 'should use structural label class');
    // Toc is empty — should not have a nested ul under it
    const tocIdx = html.indexOf('Toc');
    const afterToc = html.substring(tocIdx);
    assert.ok(!afterToc.includes('<ul class="map-tree">'), 'Toc should not have children');
  });

  it('should render frontmatter with structural labels and nested chapter', () => {
    const xml = `<bookmap>
      <frontmatter>
        <booklists>
          <toc/>
        </booklists>
        <chapter href="topics/preface.dita"/>
      </frontmatter>
    </bookmap>`;
    const html = parseAndRender(xml);
    assert.ok(html.includes('Frontmatter'), 'Frontmatter label should appear');
    assert.ok(html.includes('Booklists'), 'Booklists label should appear');
    assert.ok(html.includes('Toc'), 'Toc label should appear');
    assert.ok(html.includes('preface'), 'chapter inside frontmatter should still appear');
    assert.ok(html.includes('map-tree-item--nav'), 'chapter should render as navigable');
    // No stray h1 headings from booklists/toc
    assert.ok(!html.includes('class="map-title"'), 'should not have extra title headings from booklists/toc');
  });

  it('should render chapter with topicmeta linktext as display name', () => {
    const xml = `<bookmap>
      <chapter href="topics/ch1.dita">
        <topicmeta><linktext>Chapter One: Getting Started</linktext></topicmeta>
      </chapter>
    </bookmap>`;
    const html = parseAndRender(xml);
    assert.ok(html.includes('Chapter One: Getting Started'), 'linktext should be used as display name');
    assert.ok(html.includes('data-href="topics/ch1.dita"'));
  });

  it('should render nested chapters inside part', () => {
    const xml = `<bookmap>
      <part href="topics/part1.dita">
        <topicmeta><linktext>Part I</linktext></topicmeta>
        <chapter href="topics/ch1.dita">
          <topicmeta><linktext>Chapter 1</linktext></topicmeta>
        </chapter>
        <chapter href="topics/ch2.dita">
          <topicmeta><linktext>Chapter 2</linktext></topicmeta>
        </chapter>
      </part>
    </bookmap>`;
    const html = parseAndRender(xml);
    assert.ok(html.includes('Part I'), 'part linktext should appear');
    assert.ok(html.includes('Chapter 1'), 'chapter 1 should appear');
    assert.ok(html.includes('Chapter 2'), 'chapter 2 should appear');
    // Nested ul for chapters inside part
    const partIdx = html.indexOf('Part I');
    const nestedUlIdx = html.indexOf('<ul class="map-tree">', partIdx + 10);
    assert.ok(nestedUlIdx >= 0, 'should have nested tree for chapters inside part');
  });

  it('should not break standard map rendering when bookmap elements exist', () => {
    const xml = `<map>
      <title>Standard Map</title>
      <topicref href="topics/a.dita"/>
    </map>`;
    const html = parseAndRender(xml);
    assert.ok(html.includes('Standard Map'), 'standard map title should work');
    assert.ok(html.includes('class="ditamap-container"'));
    assert.ok(html.includes('data-href="topics/a.dita"'));
  });

  it('should render relheader relcolspec titles as th cells', () => {
    const xml = `<map>
      <reltable>
        <relheader>
          <relcolspec><title>Concepts</title></relcolspec>
          <relcolspec><title>Tasks</title></relcolspec>
        </relheader>
        <relrow>
          <relcell><topicref href="c.dita"/></relcell>
          <relcell><topicref href="t.dita"/></relcell>
        </relrow>
      </reltable>
    </map>`;
    const html = parseAndRender(xml);
    assert.ok(html.includes('<th>Concepts</th>'), `relcolspec title should be a th cell, got: ${html}`);
    assert.ok(html.includes('<th>Tasks</th>'), 'second relcolspec title should be a th cell');
    assert.ok(html.includes('class="relrow"'), 'relrow should still render');
  });

  it('should render an empty relheader row when relcolspec has no title', () => {
    const xml = `<map>
      <reltable>
        <relheader><relcolspec/></relheader>
        <relrow><relcell><topicref href="a.dita"/></relcell></relrow>
      </reltable>
    </map>`;
    const html = parseAndRender(xml);
    assert.ok(html.includes('<tr class="relheader"><th></th></tr>'), `expected empty th, got: ${html}`);
  });

  it('should resolve ph keyref inside a navtitle display name', () => {
    const xml = `<map>
      <topicref href="topics/a.dita">
        <topicmeta><navtitle>Configuring <ph keyref="product_name"/></navtitle></topicmeta>
      </topicref>
    </map>`;
    const doc = parseDitamap(preprocessEntities(xml));
    const keyMap = new Map([['product_name', 'DatabaseX Pro v3.0']]);
    const html = renderMapDocument(doc.root, { docDir: '/test', resolveKey: (k) => keyMap.get(k) });
    assert.ok(html.includes('Configuring DatabaseX Pro v3.0'), `expected resolved navtitle, got: ${html}`);
  });

  it('should elevate mainbooktitle to the headline with booktitlealt as subtitle', () => {
    const xml = `<bookmap>
      <booktitle>
        <mainbooktitle>Admin Guide</mainbooktitle>
        <booktitlealt>Version 3</booktitlealt>
      </booktitle>
      <chapter href="c1.dita"/>
    </bookmap>`;
    const html = parseAndRender(xml);
    assert.ok(html.includes('<div class="book-titlepage">'), `expected titlepage, got: ${html}`);
    assert.ok(html.includes('<h1 class="map-title">Admin Guide</h1>'), 'main title alone in h1');
    assert.ok(html.includes('<p class="book-subtitle">Version 3</p>'), 'alt title as subtitle');
    assert.ok(!html.includes('Admin GuideVersion 3'), 'titles must not be concatenated');
  });

  it('should apply an injected role formatter to tree badges', () => {
    const xml = `<bookmap>
      <chapter href="c1.dita"/>
      <chapter href="c2.dita"/>
    </bookmap>`;
    const doc = parseDitamap(preprocessEntities(xml));
    const html = renderMapDocument(doc.root, {
      docDir: '/test',
      roleFormat: (info) => `第 ${info.ordinal} 章`,
    });
    assert.ok(html.includes('<span class="map-tree-badge">第 1 章</span>'), `expected zh badge, got: ${html}`);
    assert.ok(html.includes('<span class="map-tree-badge">第 2 章</span>'));
  });

  it('should restart chapter numbering per nesting depth in rendered tree', () => {
    const xml = `<bookmap>
      <chapter href="c1.dita">
        <chapter href="c1-1.dita"/>
        <chapter href="c1-2.dita"/>
      </chapter>
      <chapter href="c2.dita">
        <chapter href="c2-1.dita"/>
      </chapter>
    </bookmap>`;
    const doc = parseDitamap(preprocessEntities(xml));
    const html = renderMapDocument(doc.root, { docDir: '/test' });
    assert.ok(html.includes('Chapter 1'), 'top-level Chapter 1');
    assert.ok(html.includes('Chapter 2'), 'top-level Chapter 2');
    // Count occurrences of each badge
    const ch1Count = (html.match(/map-tree-badge">Chapter 1<\/span>/g) || []).length;
    const ch2Count = (html.match(/map-tree-badge">Chapter 2<\/span>/g) || []).length;
    assert.strictEqual(ch1Count, 3, 'Chapter 1 should appear 3 times (c1, c1-1, c2-1)');
    assert.strictEqual(ch2Count, 2, 'Chapter 2 should appear 2 times (c2, c1-2)');
  });

  // ── ditamap-level profiling (Flags/Filter for topicref, not topic content) ──
  // A topicref's audience/platform/product/otherprops/etc. cascade down to
  // every descendant topicref that doesn't set its own value for the same
  // attribute -- reported scenario: a.dita has b.dita, c.dita, d.dita as
  // children; profiling a.dita's topicref should mark all three as
  // filterable too, not just a.dita itself.
  describe('ditamap-level profiling inheritance', () => {
    it('should stamp data-profile-keys on a topicref carrying its own profiling attribute', () => {
      const xml = `<map><topicref href="a.dita" audience="internal"/></map>`;
      const html = parseAndRender(xml);
      assert.ok(html.includes('data-profile-keys="audience:internal"'), 'a.dita\'s own audience should be encoded into data-profile-keys');
    });

    it('should NOT stamp data-profile-keys on a topicref with no profiling attribute and no inherited one', () => {
      const xml = `<map><topicref href="a.dita"/></map>`;
      const html = parseAndRender(xml);
      assert.ok(!html.includes('data-profile-keys'), 'a plain topicref should carry no filter marker at all');
    });

    it('should cascade a parent topicref\'s profiling attribute to child topicrefs that set nothing of their own (a > b, c, d)', () => {
      const xml = `<map>
        <topicref href="a.dita" audience="internal">
          <topicref href="b.dita"/>
          <topicref href="c.dita"/>
          <topicref href="d.dita"/>
        </topicref>
      </map>`;
      const html = parseAndRender(xml);
      const matchCount = (html.match(/data-profile-keys="audience:internal"/g) || []).length;
      assert.strictEqual(matchCount, 4, 'a, b, c, and d should all carry the inherited audience:internal key');
    });

    // Matches Oxygen's own display: a box (and its chip label) is only
    // drawn once, around the topicref that actually declares the
    // attribute, enclosing its whole subtree -- not repeated on every
    // descendant that merely inherited it. Reported: a compact tree
    // showing "Audience [internal]" on a AND on every one of b/c/d was
    // unreadable clutter for maps with any real depth.
    it('should draw the profiled box + chip label only on the topicref that declares its own attribute, not on children that only inherited it', () => {
      const xml = `<map>
        <topicref href="a.dita" audience="internal">
          <topicref href="b.dita"/>
        </topicref>
      </map>`;
      const html = parseAndRender(xml);
      const aIdx = html.indexOf('data-href="a.dita"');
      const bIdx = html.indexOf('data-href="b.dita"');
      const bCloseIdx = html.indexOf('</li>', bIdx);
      const aLi = html.slice(Math.max(0, aIdx - 200), bCloseIdx + 400);
      const bLi = html.slice(Math.max(0, bIdx - 50), bCloseIdx);
      assert.ok(aLi.includes(' profiled'), 'a.dita declares its own audience -- should get the .profiled box');
      assert.ok(aLi.includes('profiling-label') && aLi.includes('Audience') && aLi.includes('[internal]'), 'a.dita should show the chip label');
      assert.ok(!bLi.includes(' profiled'), 'b.dita only inherited audience -- should NOT get its own .profiled box (it\'s visually inside a\'s box already)');
      assert.ok(!bLi.includes('profiling-label'), 'b.dita should not repeat a\'s chip label');
      assert.ok(bLi.includes('data-profile-keys="audience:internal"'), 'b.dita must still carry data-profile-keys so the Filter panel can hide it too');
    });

    it('should give a child its own box + chip for an attribute it declares itself, without repeating the parent\'s inherited attribute in that chip', () => {
      const xml = `<map>
        <topicref href="a.dita" audience="internal">
          <topicref href="b.dita" product="pro"/>
        </topicref>
      </map>`;
      const html = parseAndRender(xml);
      const bIdx = html.indexOf('data-href="b.dita"');
      const bCloseIdx = html.indexOf('</li>', bIdx);
      const bLi = html.slice(Math.max(0, bIdx - 50), bCloseIdx);
      assert.ok(bLi.includes(' profiled'), 'b.dita declares its own product -- should get its own .profiled box');
      assert.ok(bLi.includes('Product') && bLi.includes('[pro]'), 'b.dita\'s chip should show its own product attribute');
      assert.ok(!bLi.includes('Audience') && !bLi.includes('[internal]'), 'b.dita\'s chip should NOT also show the inherited audience -- that\'s already shown once by a\'s own box');
      assert.ok(bLi.includes('data-profile-keys="product:pro,audience:internal"') || bLi.includes('data-profile-keys="audience:internal,product:pro"'), 'data-profile-keys (for filtering) should still be the full cascaded set regardless of what the visible chip shows');
    });

    it('should cascade through a map-of-maps in Outline/tree view: expandDitamapRefs flattens the submap first, then profiling inheritance runs over the merged tree', () => {
      // Reproduces the reported "all-in-one.ditamap only contains refs to
      // other ditamaps" scenario for Outline mode specifically -- this is
      // the mode the reported screenshot is about (a tree of topicrefs, as
      // opposed to Book mode, which composites topic content and does not
      // show topicref-level profiling at all). The outer topicref pointing
      // at the submap carries audience="internal"; b.dita only exists
      // inside the submap, spliced in by expandDitamapRefs, and must still
      // pick up that inherited attribute even though it was never
      // physically written next to it in any single file. Mirrors exactly
      // what MapViewerProvider.generateHtml does in production: run
      // expandDitamapRefs once, then hand the flattened tree to
      // renderMapDocument.
      const SUBMAP_XML = `<map><topicref href="b.dita"/></map>`;
      const outerNode: DitaNode = {
        type: 'element',
        baseType: 'map/topicref',
        attributes: { href: 'sub.ditamap', audience: 'internal' },
        children: [],
        sourceRange: { startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
      };
      expandDitamapRefs(outerNode, '/project', () => SUBMAP_XML);
      assert.strictEqual(outerNode.children.length, 1, 'sub.ditamap\'s topicref should have been spliced in as a child');

      const rootNode: DitaNode = {
        type: 'element',
        baseType: 'map/map',
        attributes: {},
        children: [outerNode],
        sourceRange: { startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
      };
      const html = renderMapDocument(rootNode, { docDir: '/test' });
      const bIdx = html.indexOf('data-href="b.dita"');
      assert.ok(bIdx !== -1, 'b.dita, injected from the submap, should appear in the rendered tree');
      const bCloseIdx = html.indexOf('</li>', bIdx);
      const bLi = html.slice(Math.max(0, bIdx - 50), bCloseIdx);
      assert.ok(bLi.includes('data-profile-keys="audience:internal"'), 'b.dita should inherit audience:internal through the flattened submap, for filtering purposes');
      assert.ok(!bLi.includes(' profiled'), 'b.dita only inherited the attribute -- should not get its own box (that lives on sub.ditamap\'s own entry, which declared it)');
    });

    it('should let a child topicref\'s own value override (not merge with) the inherited value for the same attribute', () => {
      const xml = `<map>
        <topicref href="a.dita" audience="internal">
          <topicref href="b.dita" audience="external"/>
        </topicref>
      </map>`;
      const html = parseAndRender(xml);
      assert.ok(html.includes('data-profile-keys="audience:internal"'), 'a.dita keeps its own audience:internal');
      assert.ok(html.includes('data-profile-keys="audience:external"'), 'b.dita\'s own audience:external should win, not be merged with the inherited value');
      assert.ok(!html.includes('audience:internal,audience:external') && !html.includes('audience:external,audience:internal'), 'b.dita should not carry both values -- own replaces inherited entirely');
    });

    it('should cascade through topicgroup and bookmap-structural containers even though they render no entry of their own', () => {
      const xml = `<bookmap>
        <frontmatter product="pro">
          <notices/>
        </frontmatter>
      </bookmap>`;
      const html = parseAndRender(xml);
      assert.ok(html.includes('data-profile-keys="product:pro"'), 'notices (nested inside frontmatter, a bookmap-structural container) should inherit frontmatter\'s product attribute');
    });

    it('should merge multiple distinct attributes from different ancestor levels rather than only keeping the nearest one', () => {
      const xml = `<map>
        <topicref href="a.dita" audience="internal">
          <topicref href="b.dita" platform="windows"/>
        </topicref>
      </map>`;
      const html = parseAndRender(xml);
      const bIdx = html.indexOf('b.dita');
      const bEntry = html.slice(Math.max(0, bIdx - 400), bIdx + 200);
      assert.ok(bEntry.includes('audience:internal'), 'b.dita should still carry the inherited audience from a.dita');
      assert.ok(bEntry.includes('platform:windows'), 'b.dita should carry its own platform in addition, not instead of, the inherited audience');
    });
  });

  describe('getMapTitleText', () => {
    it('returns the plain map title', () => {
      const doc = parseDitamap(preprocessEntities(`<map><title>My Map</title></map>`));
      assert.strictEqual(getMapTitleText(doc.root), 'My Map');
    });

    it('prefers mainbooktitle over the concatenated booktitle content', () => {
      const doc = parseDitamap(
        preprocessEntities(
          `<bookmap><booktitle><mainbooktitle>Admin Guide</mainbooktitle><booktitlealt>Version 3</booktitlealt></booktitle></bookmap>`,
        ),
      );
      assert.strictEqual(getMapTitleText(doc.root), 'Admin Guide');
    });

    it('returns undefined when the map has no title', () => {
      const doc = parseDitamap(preprocessEntities(`<map><topicref href="a.dita"/></map>`));
      assert.strictEqual(getMapTitleText(doc.root), undefined);
    });
  });
});
