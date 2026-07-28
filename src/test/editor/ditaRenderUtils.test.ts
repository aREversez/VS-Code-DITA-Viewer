import * as assert from 'assert';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { expandDitamapRefs, FileReader, makeFileTitleResolver, findTextMatches } from '../../editor/ditaRenderUtils';
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

  it('should expand a keydef map living in a sub-folder', () => {
    const node = makeEl('map/topicref', { href: 'common/keys.ditamap' });
    const readFile: FileReader = (path, _enc) => {
      assert.ok(path.replace(/\\/g, '/').endsWith('/project/common/keys.ditamap'));
      return KEYDEF_XML;
    };

    expandDitamapRefs(node, '/project', readFile);

    assert.strictEqual(node.children.length, 2);
    assert.strictEqual(node.children[0].attributes?.keys, 'product-name');
  });

  it('should expand mapref elements', () => {
    const node = makeEl('map/mapref', { href: 'keys.ditamap' });
    const readFile: FileReader = (_p, _e) => KEYDEF_XML;

    expandDitamapRefs(node, '/dir', readFile);

    assert.strictEqual(node.children.length, 2);
    assert.strictEqual(node.children[0].attributes?.keys, 'product-name');
  });

  it('should rebase topic hrefs from a sub-folder map onto the root map dir', () => {
    const node = makeEl('map/topicref', { href: 'sub/inner.ditamap' });
    const readFile: FileReader = (path, _enc) => {
      const p = path.replace(/\\/g, '/');
      if (p.endsWith('/project/sub/inner.ditamap')) {
        return `<map>
          <topicref href="topics/a.dita"/>
          <topicref href="../shared/b.dita"/>
          <topicref href="http://example.com/x.dita" scope="external"/>
        </map>`;
      }
      throw new Error('unexpected: ' + path);
    };

    expandDitamapRefs(node, '/project', readFile);

    assert.strictEqual(node.children.length, 3);
    assert.strictEqual(node.children[0].attributes?.href, 'sub/topics/a.dita');
    assert.strictEqual(node.children[1].attributes?.href, 'shared/b.dita');
    // external hrefs must not be rewritten
    assert.strictEqual(node.children[2].attributes?.href, 'http://example.com/x.dita');
  });

  it('should resolve nested map refs relative to the including map', () => {
    const node = makeEl('map/topicref', { href: 'sub/inner.ditamap' });
    const readFile: FileReader = (path, _enc) => {
      const p = path.replace(/\\/g, '/');
      if (p.endsWith('/project/sub/inner.ditamap')) {
        // keys.ditamap is relative to sub/, not to the root map
        return `<map><topicref href="keys.ditamap"/></map>`;
      }
      if (p.endsWith('/project/sub/keys.ditamap')) {
        return KEYDEF_XML;
      }
      throw new Error('unexpected: ' + path);
    };

    expandDitamapRefs(node, '/project', readFile);

    assert.strictEqual(node.children.length, 1);
    const inner = node.children[0];
    assert.strictEqual(inner.attributes?.href, 'sub/keys.ditamap');
    assert.strictEqual(inner.children.length, 2);
    assert.strictEqual(inner.children[0].attributes?.keys, 'product-name');
  });
});

describe('makeFileTitleResolver', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'dita-title-'));
    writeFileSync(join(dir, 'topic.dita'), `<topic id="t1"><title>Real Topic Title</title></topic>`);
    // File deliberately named like a bare id — must NOT be picked up
    writeFileSync(join(dir, 'someid'), `<topic id="someid"><title>Ghost Title</title></topic>`);
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('should resolve the root title of a local .dita href', () => {
    const resolver = makeFileTitleResolver(dir);
    assert.strictEqual(resolver('topic.dita'), 'Real Topic Title');
  });

  it('should return undefined for external URLs instead of probing the filesystem', () => {
    const resolver = makeFileTitleResolver(dir);
    assert.strictEqual(resolver('https://example.com/page.dita'), undefined);
    assert.strictEqual(resolver('mailto:someone@example.com'), undefined);
  });

  it('should return undefined for absolute paths', () => {
    const resolver = makeFileTitleResolver(dir);
    assert.strictEqual(resolver(join(dir, 'topic.dita')), undefined);
  });

  it('should not treat a bare id as a filename even when a matching file exists', () => {
    const resolver = makeFileTitleResolver(dir);
    assert.strictEqual(resolver('someid'), undefined);
  });
});

describe('findTextMatches', () => {
  it('should find case-sensitive plain-text matches', () => {
    const m = findTextMatches('abc ABC abc', 'abc', false, true);
    assert.deepStrictEqual(m, [
      { start: 0, end: 3 },
      { start: 8, end: 11 },
    ]);
  });

  it('should find case-insensitive plain-text matches', () => {
    const m = findTextMatches('abc ABC', 'abc', false, false);
    assert.deepStrictEqual(m, [
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ]);
  });

  it('should keep offsets correct when the text contains length-changing Unicode case folds', () => {
    // 'İ'.toLowerCase() has length 2 — the old lowerText-index approach
    // shifted every later match by one position per İ
    const text = 'İİİ abc';
    const m = findTextMatches(text, 'abc', false, false);
    assert.deepStrictEqual(m, [{ start: 4, end: 7 }]);
    assert.strictEqual(text.substring(4, 7), 'abc');
  });

  it('should treat regex metacharacters literally in plain-text mode', () => {
    const m = findTextMatches('cost is $5 (approx)', '$5 (approx)', false, true);
    assert.deepStrictEqual(m, [{ start: 8, end: 19 }]);
  });

  it('should support regex mode', () => {
    const m = findTextMatches('v1.2 and v3.4', 'v\\d+\\.\\d+', true, true);
    assert.deepStrictEqual(m, [
      { start: 0, end: 4 },
      { start: 9, end: 13 },
    ]);
  });

  it('should return null for an invalid regex', () => {
    assert.strictEqual(findTextMatches('abc', '(unclosed', true, true), null);
  });

  it('should not loop forever on zero-width regex matches', () => {
    const m = findTextMatches('bbb', 'a*', true, true);
    assert.deepStrictEqual(m, []);
  });

  it('should cap matches per text node at 1000', () => {
    const m = findTextMatches('a'.repeat(5000), 'a', false, true);
    assert.strictEqual(m!.length, 1000);
  });
});
