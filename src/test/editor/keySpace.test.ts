import * as assert from 'assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { collectMapKeys } from '../../editor/keySpace';

const read = (p: string, enc: 'utf-8') => readFileSync(p, enc);

function keydef(keys: string, value?: string): string {
  const meta = value ? `<topicmeta><keywords><keyword>${value}</keyword></keywords></topicmeta>` : '';
  return `<keydef keys="${keys}">${meta}</keydef>`;
}

describe('collectMapKeys', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'keyspace-test-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeMap(name: string, body: string): string {
    const p = join(root, name);
    writeFileSync(p, `<?xml version="1.0"?><map>${body}</map>`);
    return p;
  }

  it('reads a keydef value from its keyword', () => {
    const m = writeMap('a.ditamap', keydef('brand', 'Acme'));
    const into = new Map<string, string>();
    collectMapKeys(m, into, read);
    assert.strictEqual(into.get('brand'), 'Acme');
  });

  it('defines every name in a space-separated keys attribute, not one key called "a b"', () => {
    const m = writeMap('a.ditamap', keydef('brand company', 'Acme'));
    const into = new Map<string, string>();
    collectMapKeys(m, into, read);
    assert.strictEqual(into.get('brand'), 'Acme');
    assert.strictEqual(into.get('company'), 'Acme');
    assert.strictEqual(into.has('brand company'), false);
  });

  it('splits on any run of whitespace, including newlines and tabs', () => {
    const m = writeMap('a.ditamap', keydef('one\n  two\tthree', 'V'));
    const into = new Map<string, string>();
    collectMapKeys(m, into, read);
    assert.deepStrictEqual([...into.keys()].sort(), ['one', 'three', 'two']);
  });

  it('applies the same split to a topicref that carries keys', () => {
    const m = writeMap(
      'a.ditamap',
      '<topicref keys="x y" href="t.dita"><topicmeta><linktext>Title</linktext></topicmeta></topicref>',
    );
    const into = new Map<string, string>();
    collectMapKeys(m, into, read);
    assert.strictEqual(into.get('x'), 'Title');
    assert.strictEqual(into.get('y'), 'Title');
  });

  it('keeps the first definition of a key, per name, in document order', () => {
    const m = writeMap('a.ditamap', keydef('a b', 'first') + keydef('b c', 'second'));
    const into = new Map<string, string>();
    collectMapKeys(m, into, read);
    assert.strictEqual(into.get('a'), 'first');
    assert.strictEqual(into.get('b'), 'first');
    assert.strictEqual(into.get('c'), 'second');
  });

  it('does not overwrite a key already present in the target map', () => {
    const m = writeMap('a.ditamap', keydef('brand', 'Later'));
    const into = new Map<string, string>([['brand', 'Earlier']]);
    collectMapKeys(m, into, read);
    assert.strictEqual(into.get('brand'), 'Earlier');
  });

  it('falls back to the key name when the definition has no value', () => {
    const m = writeMap('a.ditamap', keydef('p q'));
    const into = new Map<string, string>();
    collectMapKeys(m, into, read);
    assert.strictEqual(into.get('p'), 'p');
    assert.strictEqual(into.get('q'), 'q');
  });

  it('follows referenced ditamaps', () => {
    mkdirSync(join(root, 'sub'));
    writeFileSync(join(root, 'sub', 'brand.ditamap'), `<map>${keydef('logo alt', 'Acme')}</map>`);
    const m = writeMap('all.ditamap', '<mapref href="sub/brand.ditamap" format="ditamap"/>');
    const into = new Map<string, string>();
    collectMapKeys(m, into, read);
    assert.strictEqual(into.get('logo'), 'Acme');
    assert.strictEqual(into.get('alt'), 'Acme');
  });
});
