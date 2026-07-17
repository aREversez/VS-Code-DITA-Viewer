import * as assert from 'assert';
import { collectMapEntries } from '../../render/mapTypeMap';
import { parseDitamap, preprocessEntities } from '../../parser/ditaParser';
import { renderBookPlaceholder, renderBookError, renderBookSkipMessage } from '../../editor/ditaRenderUtils';

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
