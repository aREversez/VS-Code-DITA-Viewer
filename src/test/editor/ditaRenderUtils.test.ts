import * as assert from 'assert';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { expandDitamapRefs, FileReader, makeConrefResolver, makeFileTitleResolver, findTextMatches, decodeHrefPart } from '../../editor/ditaRenderUtils';
import { parseDita, preprocessEntities } from '../../parser/ditaParser';
import { renderDocument } from '../../render/renderer';
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

describe('decodeHrefPart', () => {
  it('should decode %20 to a space', () => {
    assert.strictEqual(decodeHrefPart('images/db%20topology.png'), 'images/db topology.png');
  });

  it('should return strings without percent signs unchanged', () => {
    assert.strictEqual(decodeHrefPart('images/db_topology.png'), 'images/db_topology.png');
  });

  it('should decode UTF-8 escape sequences', () => {
    assert.strictEqual(decodeHrefPart('%E5%9B%BE%E7%89%87.png'), '图片.png');
  });

  it('should return malformed escape sequences unchanged', () => {
    assert.strictEqual(decodeHrefPart('50%zz.png'), '50%zz.png');
  });
});

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

  it('should percent-decode encoded submap hrefs before reading the file', () => {
    const node = makeEl('map/mapref', { href: 'sub%20maps/key%20defs.ditamap', format: 'ditamap' });
    const seen: string[] = [];
    const readFile: FileReader = (p) => {
      seen.push(p);
      return KEYDEF_XML;
    };
    expandDitamapRefs(node, '/dir', readFile);
    assert.strictEqual(seen.length, 1);
    assert.ok(seen[0].includes('sub maps'), `decoded dir, got: ${seen[0]}`);
    assert.ok(seen[0].endsWith('key defs.ditamap'), `decoded file, got: ${seen[0]}`);
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

  it('should still expand children when the node itself points at a visited map', () => {
    const child = makeEl('map/mapref', { href: 'b.ditamap' });
    const node = makeEl('map/mapref', { href: 'a.ditamap' }, [child]);
    const readFile: FileReader = (path) => {
      if (path.replace(/\\/g, '/').endsWith('b.ditamap')) return KEYDEF_XML;
      throw new Error('visited map must not be re-read: ' + path);
    };

    // a.ditamap was already inlined elsewhere; the old early-return skipped
    // the whole subtree, leaving b.ditamap unexpanded.
    const visited = new Set<string>([resolve('/dir', 'a.ditamap')]);
    expandDitamapRefs(node, '/dir', readFile, visited);

    assert.strictEqual(node.children.length, 1, 'a.ditamap itself must not be re-inlined');
    assert.strictEqual(child.children.length, 2);
    assert.strictEqual(child.children[0].attributes?.keys, 'product-name');
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

describe('makeConrefResolver', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'dita-conref-'));
    writeFileSync(join(dir, 'reuse.dita'), `<topic id="conref_topic">
  <title>Reuse Topic</title>
  <body>
    <p id="note_script"><b>Important</b> note text</p>
    <plentry id="plentry_1">
      <pt>Parameter A</pt>
      <pd>Value A</pd>
    </plentry>
    <ph id="element_only"><image href="icon.png"/></ph>
  </body>
</topic>`);
    writeFileSync(join(dir, 'reuse_gemesh.dita'), `<topic id="conref_gemesh">
  <title>Gemesh Topic</title>
  <body>
    <plentry id="plentry_dg5">
      <pt>DB Host</pt>
      <pd>localhost</pd>
    </plentry>
  </body>
</topic>`);
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('should resolve ph conref returning the target element', () => {
    const resolver = makeConrefResolver(dir);
    const el = resolver('reuse.dita#conref_topic/note_script');
    assert.ok(el, 'should return resolved element');
    assert.strictEqual(el!.type, 'element');
    // Children should contain a <b> element and note text
    const childElements = (el!.children || []).filter((n) => n.type === 'element');
    const childTexts = (el!.children || []).filter((n) => n.type === 'text');
    assert.ok(childElements.some((n) => n.baseType === 'topic/b'), 'should contain a b element');
    assert.ok(childTexts.some((n) => (n.text || '').includes('note text')), 'should contain note text');
  });

  it('should resolve plentry conref returning target element with pt/pd children', () => {
    const resolver = makeConrefResolver(dir);
    const el = resolver('reuse.dita#conref_topic/plentry_1');
    assert.ok(el, 'should return resolved element');
    assert.strictEqual(el!.baseType, 'topic/plentry');
    const childElements = (el!.children || []).filter((n) => n.type === 'element');
    assert.ok(childElements.some((n) => n.baseType === 'topic/pt'), 'should contain a pt element');
    assert.ok(childElements.some((n) => n.baseType === 'topic/pd'), 'should contain a pd element');
    // Verify pt and pd appear in correct order
    const ptIdx = childElements.findIndex((n) => n.baseType === 'topic/pt');
    const pdIdx = childElements.findIndex((n) => n.baseType === 'topic/pd');
    assert.ok(ptIdx < pdIdx, 'pt should come before pd');
  });

  it('should return target element even when it has only element children', () => {
    const resolver = makeConrefResolver(dir);
    const el = resolver('reuse.dita#conref_topic/element_only');
    assert.ok(el, 'should return resolved element, not undefined');
    assert.strictEqual(el!.baseType, 'topic/ph');
    const childElements = (el!.children || []).filter((n) => n.type === 'element');
    assert.ok(childElements.some((n) => n.baseType === 'topic/image'), 'should contain an image element');
  });

  it('should resolve conref with only element id (no topic id)', () => {
    const resolver = makeConrefResolver(dir);
    const el = resolver('reuse.dita#note_script');
    assert.ok(el, 'should resolve with bare element id');
    assert.strictEqual(el!.attributes?.id, 'note_script');
  });

  it('should return undefined for missing file', () => {
    const resolver = makeConrefResolver(dir);
    const el = resolver('nonexistent.dita#some_id');
    assert.strictEqual(el, undefined);
  });

  it('should return undefined for missing element id', () => {
    const resolver = makeConrefResolver(dir);
    const el = resolver('reuse.dita#conref_topic/nonexistent_id');
    assert.strictEqual(el, undefined);
  });

  it('should render ph conref with filepath child as span.filepath (end-to-end)', () => {
    // Create a target file with <ph id="note_script"><filepath>.fscript</filepath></ph>
    writeFileSync(join(dir, 'conref.dita'), `<topic id="conref">
  <title>Conref Reuse</title>
  <body>
    <ph id="note_script"><filepath>.fscript</filepath></ph>
  </body>
</topic>`);

    const conrefResolver = makeConrefResolver(dir);
    // Source document: <ph conref="conref.dita#conref/note_script">
    const sourceXml = `<topic id="main_topic">
  <title>Main</title>
  <body>
    <p>Run the <ph conref="conref.dita#conref/note_script"/> now.</p>
  </body>
</topic>`;
    const doc = parseDita(preprocessEntities(sourceXml));
    const html = renderDocument(doc.root, {
      headingLevel: 1,
      asWebviewUri: (p: string) => `vscode-resource:${p}`,
      documentDir: dir,
      resolveConref: (conref: string) => conrefResolver(conref),
    });
    // Same-type conref: <ph> target, children (including <filepath>) are pulled in
    assert.ok(html.includes('class="filepath"'), `should contain span.filepath, got: ${html}`);
    assert.ok(html.includes('.fscript'), 'should contain .fscript text');
    assert.ok(!html.includes('conref'), 'conref attribute should be stripped');
  });

  it('should render ph conref with filepath as cross-type target (end-to-end)', () => {
    // Target file where the element with id is a <filepath> itself (different type)
    writeFileSync(join(dir, 'conref_fp.dita'), `<topic id="conref_fp">
  <title>Conref FP</title>
  <body>
    <p>Run the <filepath id="fp_script">.fscript</filepath> file.</p>
  </body>
</topic>`);

    const conrefResolver = makeConrefResolver(dir);
    // Source: <ph conref="conref_fp.dita#conref_fp/fp_script">
    const sourceXml = `<topic id="main_topic2">
  <title>Main2</title>
  <body>
    <p>Use <ph conref="conref_fp.dita#conref_fp/fp_script"/> today.</p>
  </body>
</topic>`;
    const doc = parseDita(preprocessEntities(sourceXml));
    const html = renderDocument(doc.root, {
      headingLevel: 1,
      asWebviewUri: (p: string) => `vscode-resource:${p}`,
      documentDir: dir,
      resolveConref: (conref: string) => conrefResolver(conref),
    });
    // Cross-type conref: <ph> referencing <filepath> — the <filepath> tag
    // replaces the <ph>, so span.filepath should be rendered.
    assert.ok(html.includes('class="filepath"'), `should contain span.filepath (cross-type), got: ${html}`);
    assert.ok(html.includes('.fscript'), 'should contain .fscript text');
    assert.ok(!html.includes('conref'), 'conref attribute should be stripped');
  });

  it('should resolve ph conref from file with DOCTYPE and entities (end-to-end)', () => {
    // Target file with DOCTYPE and entity declarations (typical DITA file)
    writeFileSync(join(dir, 'conref_doctype.dita'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA Topic//EN" "topic.dtd" [
  <!ENTITY prod "SuperApp">
]>
<topic id="conref_dt">
  <title>Conref DT</title>
  <body>
    <p id="note_script_dt">Run &prod; with <filepath>.fscript</filepath></p>
  </body>
</topic>`);

    const conrefResolver = makeConrefResolver(dir);
    const sourceXml = `<topic id="main_dt">
  <title>Main</title>
  <body>
    <p>Use <ph conref="conref_doctype.dita#conref_dt/note_script_dt"/> now.</p>
  </body>
</topic>`;
    const doc = parseDita(preprocessEntities(sourceXml));
    const html = renderDocument(doc.root, {
      headingLevel: 1,
      asWebviewUri: (p: string) => `vscode-resource:${p}`,
      documentDir: dir,
      resolveConref: (conref: string) => conrefResolver(conref),
    });
    assert.ok(html.includes('SuperApp'), `should contain resolved entity value, got: ${html}`);
    assert.ok(html.includes('.fscript'), 'should contain filepath text');
    assert.ok(html.includes('class="filepath"'), 'filepath element should be rendered');
    assert.ok(!html.includes('conref'), 'conref attribute should be stripped');
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
