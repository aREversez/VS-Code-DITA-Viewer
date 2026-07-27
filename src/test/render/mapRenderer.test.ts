import * as assert from 'assert';
import { renderMapDocument } from '../../render/mapTypeMap';
import { parseDitamap, preprocessEntities } from '../../parser/ditaParser';

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
});
