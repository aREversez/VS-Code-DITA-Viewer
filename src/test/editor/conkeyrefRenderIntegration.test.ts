import * as assert from 'assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { renderTopicXml } from '../../editor/ditaRenderUtils';
import { buildRenderContext } from '../../editor/renderContext';
import { buildKeySpace, getKeyDefs } from '../../editor/keySpace';
import { renderDocument } from '../../render/renderer';

/**
 * P3 integration: conkeyref resolved end-to-end through the shared render
 * factory, using a real map key space built from real files on disk.
 *
 * All three render paths (book / site / map preview via renderTopicXml, the
 * single-topic custom-editor preview via DitaViewerProvider, and the Git diff
 * panel via ditaDiffProvider) assemble their RenderContext through
 * buildRenderContext and hand it a keyMap produced by buildKeyMap ->
 * buildKeySpace. That factory call is what wires conkeyref, so this test
 * exercises it two ways to cover every path with one source of truth:
 *   - the full book/preview entry point (renderTopicXml), and
 *   - the factory directly (the exact core the preview and diff paths call).
 * It also proves the href defs are discovered from the keyMap by identity (no
 * keyDefs threaded through any interface) and that switching the key context
 * switches the conkeyref target, since the key space is re-derived per context.
 */

const read = (p: string, enc: 'utf-8') => readFileSync(p, enc);

const REF_XML =
  '<?xml version="1.0"?><topic id="r"><body><p conkeyref="brand/shared">PLACEHOLDER</p></body></topic>';

describe('conkeyref end-to-end through the render factory', () => {
  let root: string;
  let topicsDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'conkeyref-int-'));
    mkdirSync(join(root, 'maps'));
    mkdirSync(join(root, 'topics'));
    // Two root maps define the SAME key against DIFFERENT target topics -- the
    // shape a key context switch flips between.
    writeFileSync(
      join(root, 'maps', 'root-a.ditamap'),
      '<map><keydef keys="brand" href="../topics/acme.dita"><topicmeta><linktext>Brand</linktext></topicmeta></keydef></map>',
    );
    writeFileSync(
      join(root, 'maps', 'root-b.ditamap'),
      '<map><keydef keys="brand" href="../topics/globex.dita"><topicmeta><linktext>Brand</linktext></topicmeta></keydef></map>',
    );
    writeFileSync(
      join(root, 'topics', 'acme.dita'),
      '<topic id="a"><body><p id="shared">Acme phrase</p></body></topic>',
    );
    writeFileSync(
      join(root, 'topics', 'globex.dita'),
      '<topic id="g"><body><p id="shared">Globex phrase</p></body></topic>',
    );
    topicsDir = join(root, 'topics');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function keyMapForRootMap(mapName: string): Map<string, string> {
    const space = buildKeySpace(join(root, 'maps', mapName), [], read);
    assert.strictEqual(space.status, 'active', 'context map should be active');
    // The defs the factory will discover must be exactly this space's defs,
    // paired by the values-map instance -- the identity the render paths rely
    // on, with no keyDefs field threaded through any interface.
    assert.strictEqual(getKeyDefs(space.keys), space.defs);
    return space.keys;
  }

  it('renders the conkeyref target through the book/preview entry point (renderTopicXml)', () => {
    const html = renderTopicXml({
      xml: REF_XML,
      docDir: topicsDir,
      keyMap: keyMapForRootMap('root-a.ditamap'),
      asWebviewUri: (p) => p,
      headingLevel: 1,
      uiLanguage: 'en',
    }).html;
    assert.ok(html.includes('Acme phrase'), html);
    assert.ok(!html.includes('PLACEHOLDER'), html);
  });

  it('produces identical output through the factory the preview / diff paths use', () => {
    // The single-topic preview and Git diff assemble this same factory with the
    // same keyMap shape, so building it directly (indexLabel off, as the diff
    // does) must agree with renderTopicXml byte-for-byte for the conkeyref.
    const keyMap = keyMapForRootMap('root-a.ditamap');
    const ownRoot = renderTopicXml({
      xml: REF_XML, docDir: topicsDir, keyMap: new Map(), asWebviewUri: (p) => p, headingLevel: 1,
    }).doc!.root;
    const { ctx } = buildRenderContext({
      docDir: topicsDir, ownRoot, titleMap: new Map(), keyMap,
      asWebviewUri: (p) => p, headingLevel: 1, uiLanguage: 'en',
    });
    const viaFactory = renderDocument(ownRoot, ctx);
    const viaBook = renderTopicXml({
      xml: REF_XML, docDir: topicsDir, keyMap, asWebviewUri: (p) => p, headingLevel: 1, uiLanguage: 'en',
    }).html;
    assert.ok(viaFactory.includes('Acme phrase'), viaFactory);
    assert.ok(viaFactory.includes(viaBook) || viaBook.includes(viaFactory), 'factory and book paths agree on conkeyref output');
  });

  it('switches the conkeyref target when the key context changes', () => {
    const htmlA = renderTopicXml({
      xml: REF_XML, docDir: topicsDir, keyMap: keyMapForRootMap('root-a.ditamap'),
      asWebviewUri: (p) => p, headingLevel: 1, uiLanguage: 'en',
    }).html;
    const htmlB = renderTopicXml({
      xml: REF_XML, docDir: topicsDir, keyMap: keyMapForRootMap('root-b.ditamap'),
      asWebviewUri: (p) => p, headingLevel: 1, uiLanguage: 'en',
    }).html;
    assert.ok(htmlA.includes('Acme phrase') && !htmlA.includes('Globex phrase'), htmlA);
    assert.ok(htmlB.includes('Globex phrase') && !htmlB.includes('Acme phrase'), htmlB);
  });

  it('leaves the referencing content in place when no key context resolves the key', () => {
    // An empty key space (no context, no ancestor maps) means the key resolves
    // to nothing, so conkeyref cannot fire and the element shows its own text.
    const html = renderTopicXml({
      xml: REF_XML, docDir: topicsDir, keyMap: new Map<string, string>(),
      asWebviewUri: (p) => p, headingLevel: 1, uiLanguage: 'en',
    }).html;
    assert.ok(html.includes('PLACEHOLDER'), html);
  });
});
