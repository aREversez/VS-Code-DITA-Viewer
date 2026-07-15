import * as assert from 'assert';
import { parseDitamap, preprocessEntities } from '../../parser/ditaParser';

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

describe('mapParser', () => {
  it('should parse a minimal map with title', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<map>
  <title>Test Map</title>
</map>`;
    const doc = parseDitamap(xml);
    assert.strictEqual(doc.root.baseType, 'map/map');
    assert.strictEqual(doc.root.tagName, 'map');
  });

  it('should parse keydef with keyword text', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<map>
  <keydef keys="name">
    <topicmeta>
      <keywords><keyword>Rectangle</keyword></keywords>
    </topicmeta>
  </keydef>
</map>`;
    const doc = parseDitamap(xml);
    const keydef = doc.root.children.find(
      (c) => c.type === 'element' && c.baseType === 'map/keydef',
    );
    assert.ok(keydef, 'keydef element not found');
    assert.strictEqual(keydef!.attributes?.keys, 'name');

    const topicmeta = keydef!.children.find(
      (c) => c.type === 'element' && c.baseType === 'map/topicmeta',
    );
    assert.ok(topicmeta, 'topicmeta not found');
    const keywords = topicmeta!.children.find(
      (c) => c.type === 'element' && c.baseType === 'map/keywords',
    );
    assert.ok(keywords, 'keywords not found');
    const keyword = keywords!.children.find(
      (c) => c.type === 'element' && c.baseType === 'map/keyword',
    );
    assert.ok(keyword, 'keyword not found');
    const text = keyword!.children.find((c) => c.type === 'text');
    assert.strictEqual(text?.text, 'Rectangle');
  });

  it('should parse topicref with keys, href and linktext', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<map>
  <topicref keys="product_name" href="topics/db_overview.dita">
    <topicmeta><linktext>DatabaseX Pro v3.0</linktext></topicmeta>
  </topicref>
</map>`;
    const doc = parseDitamap(xml);
    const ref = doc.root.children.find(
      (c) => c.type === 'element' && c.baseType === 'map/topicref',
    );
    assert.ok(ref);
    assert.strictEqual(ref!.attributes?.keys, 'product_name');
    assert.strictEqual(ref!.attributes?.href, 'topics/db_overview.dita');

    const topicmeta = ref!.children.find(
      (c) => c.type === 'element' && c.baseType === 'map/topicmeta',
    );
    assert.ok(topicmeta);
    const linktext = topicmeta!.children.find(
      (c) => c.type === 'element' && c.baseType === 'map/linktext',
    );
    assert.ok(linktext);
    const text = linktext!.children.find((c) => c.type === 'text');
    assert.strictEqual(text?.text, 'DatabaseX Pro v3.0');
  });

  it('should parse topicref with only keys, no href', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<map>
  <topicref keys="company_name">
    <topicmeta><linktext>ACME Corporation</linktext></topicmeta>
  </topicref>
</map>`;
    const doc = parseDitamap(xml);
    const ref = doc.root.children.find(
      (c) => c.type === 'element' && c.baseType === 'map/topicref',
    );
    assert.ok(ref);
    assert.strictEqual(ref!.attributes?.keys, 'company_name');
    assert.strictEqual(ref!.attributes?.href, undefined);
  });

  it('should parse topicref with href but no topicmeta', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<map>
  <topicref href="topics/db_overview.dita"/>
</map>`;
    const doc = parseDitamap(xml);
    const ref = doc.root.children.find(
      (c) => c.type === 'element' && c.baseType === 'map/topicref',
    );
    assert.ok(ref);
    assert.strictEqual(ref!.attributes?.href, 'topics/db_overview.dita');
    assert.strictEqual(ref!.attributes?.keys, undefined);
  });

  it('should parse real test.ditamap content', () => {
    const doc = parseDitamap(preprocessEntities(TEST_MAP_XML));
    assert.strictEqual(doc.root.baseType, 'map/map');

    const titleEl = doc.root.children.find(
      (c) => c.type === 'element' && c.baseType === 'map/map-title',
    );
    assert.ok(titleEl, 'title element not found');

    const keydefs = doc.root.children.filter(
      (c) => c.type === 'element' && c.baseType === 'map/keydef',
    );
    assert.strictEqual(keydefs.length, 1);
    assert.strictEqual(keydefs[0].attributes?.keys, 'name');

    const refs = doc.root.children.filter(
      (c) => c.type === 'element' && (c.baseType === 'map/topicref'),
    );
    assert.strictEqual(refs.length, 6);

    const prodRef = refs.find((r) => r.attributes?.keys === 'product_name');
    assert.ok(prodRef);
    assert.strictEqual(prodRef!.attributes?.href, 'topics/db_overview.dita');
  });
});
