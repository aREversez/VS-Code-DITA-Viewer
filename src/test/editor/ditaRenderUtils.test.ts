import * as assert from 'assert';
import { expandDitamapRefs, FileReader } from '../../editor/ditaRenderUtils';
import type { DitaNode } from '../../parser/domTypes';

function makeEl(baseType: string, attrs: Record<string, string>, children: DitaNode[] = []): DitaNode {
  return {
    type: 'element',
    baseType,
    attributes: attrs,
    children,
    sourceRange: { startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
  };
}

function textNode(text: string): DitaNode {
  return {
    type: 'text',
    text,
    children: [],
    sourceRange: { startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
  };
}

const KEYDEF_XML = `<?xml version="1.0" encoding="UTF-8"?>
<map>
  <keydef keys="product-name">
    <topicmeta>
      <keywords><keyword>My Product</keyword></keywords>
    </topicmeta>
  </keydef>
  <keydef keys="prod-version">
    <topicmeta>
      <keywords><keyword>2.0.1</keyword></keywords>
    </topicmeta>
  </keydef>
</map>`;

const MAP_WITH_REFS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<map>
  <topicref href="keys.ditamap"/>
  <topicref href="overview.dita"/>
  <keydef keys="name">
    <topicmeta>
      <keywords><keyword>My Product</keyword></keywords>
    </topicmeta>
  </keydef>
</map>`;

describe('expandDitamapRefs', () => {
  it('should do nothing for non-element node', () => {
    const node = textNode('hello');
    expandDitamapRefs(node, '/dir', () => '');
    assert.strictEqual(node.text, 'hello');
  });

  it('should do nothing for element without href', () => {
    const node = makeEl('map/topicref', { keys: 'k1' });
    expandDitamapRefs(node, '/dir', () => '');
    assert.strictEqual(node.children.length, 0);
  });

  it('should do nothing for href to non-ditamap file', () => {
    const node = makeEl('map/topicref', { href: 'topic.dita' });
    expandDitamapRefs(node, '/dir', () => '');
    assert.strictEqual(node.children.length, 0);
  });

  it('should expand children from referenced ditamap', () => {
    const node = makeEl('map/topicref', { href: 'keys.ditamap' });
    const readFile: FileReader = (path, _enc) => {
      assert.ok(path.endsWith('keys.ditamap'));
      return KEYDEF_XML;
    };

    expandDitamapRefs(node, '/project', readFile);

    assert.strictEqual(node.children.length, 2);
    assert.strictEqual(node.children[0].baseType, 'map/keydef');
    assert.strictEqual(node.children[0].attributes?.keys, 'product-name');
    assert.strictEqual(node.children[1].attributes?.keys, 'prod-version');
  });

  it('should expand for keydef with href to ditamap', () => {
    const node = makeEl('map/keydef', { href: 'keys.ditamap', keys: 'global' });
    const readFile: FileReader = (_p, _e) => KEYDEF_XML;

    expandDitamapRefs(node, '/dir', readFile);

    assert.strictEqual(node.children.length, 2);
    assert.strictEqual(node.children[0].attributes?.keys, 'product-name');
  });

  it('should handle missing file gracefully', () => {
    const node = makeEl('map/topicref', { href: 'missing.ditamap' });
    const readFile: FileReader = () => { throw new Error('ENOENT'); };

    expandDitamapRefs(node, '/dir', readFile);

    assert.strictEqual(node.children.length, 0);
  });

  it('should handle circular references via visited set', () => {
    const node = makeEl('map/topicref', { href: 'a.ditamap' });
    const childA = makeEl('map/topicref', { href: 'b.ditamap' });
    node.children = [childA];

    const readFile: FileReader = (path, _e) => {
      if (path.endsWith('a.ditamap')) {
        return `<map><topicref href="b.ditamap"/></map>`;
      }
      if (path.endsWith('b.ditamap')) {
        return `<map><topicref href="a.ditamap"/></map>`;
      }
      return '';
    };

    const visited = new Set<string>();
    expandDitamapRefs(node, '/dir', readFile, visited);

    // a.ditamap expands: adds b.ditamap ref from file
    // Then b.ditamap ref is expanded: but a.ditamap is in visited set, so it stops
    assert.strictEqual(node.children.length, 2); // original child + expanded from a.ditamap
    assert.strictEqual(visited.size, 2); // a.ditamap and b.ditamap
  });

  it('should recurse into existing children', () => {
    const child = makeEl('map/topicref', { href: 'keys.ditamap' });
    const node = makeEl('map/topicref', { href: 'main.dita' }, [child]);
    const readFile: FileReader = (_p, _e) => KEYDEF_XML;

    expandDitamapRefs(node, '/dir', readFile);

    assert.strictEqual(node.children.length, 1);
    assert.strictEqual(child.children.length, 2);
    assert.strictEqual(child.children[0].attributes?.keys, 'product-name');
  });
});
