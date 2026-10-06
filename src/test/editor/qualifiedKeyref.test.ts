import * as assert from 'assert';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { collectMapKeys, buildKeySpace, KeyHrefDef } from '../../editor/keySpace';
import { renderTopicXml } from '../../editor/ditaRenderUtils';

const read = (p: string, enc: 'utf-8') => readFileSync(p, enc);

function keydef(keys: string, value: string): string {
  return `<keydef keys="${keys}"><topicmeta><keywords><keyword>${value}</keyword></keywords></topicmeta></keydef>`;
}

describe('qualified keyref names (keyscope)', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'qkey-test-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  function collect(files: Record<string, string>, main = 'root.ditamap') {
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(root, name), `<?xml version="1.0"?><map>${body}</map>`);
    }
    const keys = new Map<string, string>();
    const defs = new Map<string, KeyHrefDef>();
    collectMapKeys(join(root, main), keys, read, defs);
    return { keys, defs };
  }

  it('defines scope.key for a key inside a keyscope, next to the bare name', () => {
    const { keys } = collect({ 'root.ditamap': `<topicgroup keyscope="a">${keydef('k', 'Alpha')}</topicgroup>` });
    assert.strictEqual(keys.get('a.k'), 'Alpha');
    assert.strictEqual(keys.get('k'), 'Alpha');
  });

  it('keeps the same key in two scopes apart under their qualified names', () => {
    const { keys } = collect({
      'root.ditamap':
        `<topicgroup keyscope="a">${keydef('k', 'Alpha')}</topicgroup>` +
        `<topicgroup keyscope="b">${keydef('k', 'Beta')}</topicgroup>`,
    });
    assert.strictEqual(keys.get('a.k'), 'Alpha');
    assert.strictEqual(keys.get('b.k'), 'Beta');
  });

  it('a keyscope listing several names puts the key under each of them', () => {
    const { keys } = collect({ 'root.ditamap': `<topicgroup keyscope="a b">${keydef('k', 'V')}</topicgroup>` });
    assert.strictEqual(keys.get('a.k'), 'V');
    assert.strictEqual(keys.get('b.k'), 'V');
  });

  it('nested scopes answer to every suffix: x.a.k from outside, a.k from inside x', () => {
    const { keys } = collect({
      'root.ditamap': `<topicgroup keyscope="x"><topicgroup keyscope="a">${keydef('k', 'V')}</topicgroup></topicgroup>`,
    });
    assert.strictEqual(keys.get('x.a.k'), 'V');
    assert.strictEqual(keys.get('a.k'), 'V');
    assert.strictEqual(keys.get('x.k'), undefined, 'a is not skipped over');
  });

  it('a keyscope on the keydef element itself scopes its own keys', () => {
    const { keys } = collect({
      'root.ditamap': `<keydef keyscope="s" keys="k"><topicmeta><keywords><keyword>V</keyword></keywords></topicmeta></keydef>`,
    });
    assert.strictEqual(keys.get('s.k'), 'V');
  });

  it('a mapref carrying keyscope scopes the keys of the referenced map', () => {
    const { keys } = collect({
      'root.ditamap': `<mapref href="brand.ditamap" keyscope="acme"/>`,
      'brand.ditamap': keydef('name', 'Acme'),
    });
    assert.strictEqual(keys.get('acme.name'), 'Acme');
  });

  it('records the resource target under the qualified name too (for conkeyref)', () => {
    const { defs } = collect({
      'root.ditamap': `<topicgroup keyscope="a"><keydef keys="k" href="t.dita"/></topicgroup>`,
    });
    assert.strictEqual(defs.get('a.k')?.href, 't.dita');
  });

  it('first definition of a qualified name wins', () => {
    const { keys } = collect({
      'root.ditamap':
        `<topicgroup keyscope="a">${keydef('k', 'First')}</topicgroup>` +
        `<topicgroup keyscope="a">${keydef('k', 'Second')}</topicgroup>`,
    });
    assert.strictEqual(keys.get('a.k'), 'First');
  });

  it('a key outside any scope gets no qualified name', () => {
    const { keys } = collect({ 'root.ditamap': keydef('k', 'V') });
    assert.deepStrictEqual([...keys.keys()], ['k']);
  });

  describe('through the preview render path', () => {
    const TOPIC =
      '<?xml version="1.0"?><topic id="t"><body><p>Brand: <ph keyref="a.name"/> / <ph keyref="b.name"/></p></body></topic>';

    it('substitutes a qualified keyref with that scope\'s value', () => {
      writeFileSync(
        join(root, 'root.ditamap'),
        '<?xml version="1.0"?><map>' +
          `<topicgroup keyscope="a">${keydef('name', 'Acme')}</topicgroup>` +
          `<topicgroup keyscope="b">${keydef('name', 'Globex')}</topicgroup></map>`,
      );
      const { keys } = buildKeySpace(join(root, 'root.ditamap'), [], read);
      const html = renderTopicXml({
        xml: TOPIC, docDir: root, keyMap: keys, asWebviewUri: (p) => p, headingLevel: 1, uiLanguage: 'en',
      }).html;
      assert.ok(html.includes('Acme') && html.includes('Globex'), html);
    });
  });
});
