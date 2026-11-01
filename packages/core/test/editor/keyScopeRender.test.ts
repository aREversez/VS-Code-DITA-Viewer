import * as assert from 'assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildKeySpace } from '../../src/editor/keySpace';
import { clearTopicRenderCache, renderTopicCached, renderTopicToHtml } from '../../src/editor/topicRender';
import { collectMapEntries } from '../../src/render/mapTypeMap';
import { expandDitamapRefs } from '../../src/editor/refResolvers';
import { parseDitamap, preprocessEntities } from '../../src/parser/ditaParser';

const read = (p: string, enc: 'utf-8') => readFileSync(p, enc);

describe('keyref and conkeyref in the key scope a topic sits in', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'keyscope-render-'));
    clearTopicRenderCache();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const write = (name: string, text: string): string => {
    const p = join(root, name);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, text);
    return p;
  };
  const kw = (keys: string, value: string, href?: string): string =>
    `<keydef keys="${keys}"${href ? ` href="${href}"` : ''}><topicmeta><keywords><keyword>${value}</keyword></keywords></topicmeta></keydef>`;
  const topic = (body: string): string =>
    `<?xml version="1.0"?><topic id="t"><title>T</title><body>${body}</body></topic>`;
  const map = (body: string): string => write('a.ditamap', `<?xml version="1.0"?><map>${body}</map>`);

  function html(topicPath: string, mapPath: string, keyScope?: string[][]): string {
    const space = buildKeySpace(mapPath, [], read);
    const r = renderTopicToHtml({
      filePath: topicPath, keyMap: space.keys, asWebviewUri: (p) => p, headingLevel: 1, keyScope,
    });
    assert.ok(!r.error, r.error);
    return r.html;
  }

  const KEYREF = topic('<p><ph keyref="k"/></p>');
  const twoScopes = (): { m: string; t1: string; t2: string; tRoot: string } => {
    const t1 = write('t1.dita', KEYREF);
    const t2 = write('t2.dita', KEYREF);
    const tRoot = write('troot.dita', KEYREF);
    const m = map(
      `${kw('k', 'ROOTVAL')}` +
        `<topicgroup keyscope="s1">${kw('k', 'S1VAL')}<topicref href="t1.dita"/></topicgroup>` +
        `<topicgroup keyscope="s2">${kw('k', 'S2VAL')}<topicref href="t2.dita"/></topicgroup>` +
        `<topicref href="troot.dita"/>`,
    );
    return { m, t1, t2, tRoot };
  };

  it('a topic published in a scope takes that scope\'s value for a bare key', () => {
    const { m, t1, t2, tRoot } = twoScopes();
    assert.ok(html(t1, m).includes('S1VAL'));
    assert.ok(html(t2, m).includes('S2VAL'));
    assert.ok(html(tRoot, m).includes('ROOTVAL'));
  });

  it('a topic no map publishes sits in the root scope, not in whichever scope came first', () => {
    const stray = write('stray.dita', KEYREF);
    const m = map(`<topicgroup keyscope="s1">${kw('k', 'S1VAL')}</topicgroup>${kw('k', 'ROOTVAL')}`);
    assert.ok(html(stray, m).includes('ROOTVAL'));
  });

  it('a key defined only inside a scope is not found by its bare name from outside it', () => {
    const t = write('t.dita', topic('<p><ph keyref="inner"/></p>'));
    const m = map(`<topicgroup keyscope="s1">${kw('inner', 'INNERVAL')}</topicgroup><topicref href="t.dita"/>`);
    assert.ok(!html(t, m).includes('INNERVAL'));
  });

  it('the same key is found from outside by its qualified name', () => {
    const t = write('t.dita', topic('<p><ph keyref="s1.inner"/></p>'));
    const m = map(`<topicgroup keyscope="s1">${kw('inner', 'INNERVAL')}</topicgroup><topicref href="t.dita"/>`);
    assert.ok(html(t, m).includes('INNERVAL'));
  });

  it('a topic published in two scopes takes the first one in the map', () => {
    const t = write('t.dita', KEYREF);
    const m = map(
      `<topicgroup keyscope="s1">${kw('k', 'S1VAL')}</topicgroup>` +
        `<topicgroup keyscope="s2">${kw('k', 'S2VAL')}<topicref href="t.dita"/></topicgroup>` +
        `<topicgroup keyscope="s1"><topicref href="t.dita"/></topicgroup>`,
    );
    assert.ok(html(t, m).includes('S2VAL'));
  });

  it('an explicit scope (where a book put the topic) wins over the first publishing one', () => {
    const { m, t1 } = twoScopes();
    assert.ok(html(t1, m, [['s2']]).includes('S2VAL'));
  });

  it('a hand-built key map without a scope index resolves as before', () => {
    const t = write('t.dita', KEYREF);
    const r = renderTopicToHtml({
      filePath: t, keyMap: new Map([['k', 'FLATVAL']]), asWebviewUri: (p) => p, headingLevel: 1,
    });
    assert.ok(r.html.includes('FLATVAL'));
  });

  it('a conkeyref follows the same definition as the text in that scope', () => {
    write('one.dita', topic('<p id="p1">ONEBODY</p>'));
    write('two.dita', topic('<p id="p1">TWOBODY</p>'));
    const ck = write('ck.dita', topic('<p conkeyref="k/p1"/>'));
    const m = map(
      `<topicgroup keyscope="s1">${kw('k', 'x', 'one.dita#t')}</topicgroup>` +
        `<topicgroup keyscope="s2">${kw('k', 'x', 'two.dita#t')}<topicref href="ck.dita"/></topicgroup>`,
    );
    assert.ok(html(ck, m).includes('TWOBODY'));
    assert.ok(html(ck, m, [['s1']]).includes('ONEBODY'));
  });

  it('a key that redirects an xref href resolves in the scope too', () => {
    write('a.dita', topic('<p>A</p>'));
    write('b.dita', topic('<p>B</p>'));
    const x = write('x.dita', topic('<p><xref keyref="k"/></p>'));
    const m = map(
      `<topicgroup keyscope="s1">${kw('k', 'LA', 'a.dita')}</topicgroup>` +
        `<topicgroup keyscope="s2">${kw('k', 'LB', 'b.dita')}</topicgroup>`,
    );
    const space = buildKeySpace(m, [], read);
    const target = (keyScope: string[][]): string | undefined =>
      renderTopicToHtml({
        filePath: x, keyMap: space.keys, asWebviewUri: (p) => p, headingLevel: 1, keyScope, clickableExternalXrefs: true,
      }).html.match(/data-dita-href="([^"]*)"/)?.[1];
    assert.strictEqual(target([['s1']]), 'a.dita');
    assert.strictEqual(target([['s2']]), 'b.dita');
  });

  it('the render cache keeps one entry per scope for the same topic', () => {
    const { m, t1 } = twoScopes();
    const space = buildKeySpace(m, [], read);
    const render = (keyScope?: string[][]) =>
      renderTopicCached({ filePath: t1, keyMap: space.keys, asWebviewUri: (p) => p, headingLevel: 1, keyScope }).html;
    const inS1 = render([['s1']]);
    const inS2 = render([['s2']]);
    assert.ok(inS1.includes('S1VAL') && !inS1.includes('S2VAL'));
    assert.ok(inS2.includes('S2VAL') && !inS2.includes('S1VAL'));
    // and a repeat is still served from the cache, with its own scope's text
    assert.ok(render([['s1']]).includes('S1VAL'));
  });
});

describe('collectMapEntries scope chains', () => {
  const entriesOf = (xml: string) => {
    const root = parseDitamap(preprocessEntities(`<?xml version="1.0"?><map>${xml}</map>`)).root;
    return collectMapEntries(root);
  };

  it('gives each entry the scopes it sits in, a keyscope applying to its own element and below', () => {
    const e = entriesOf(
      '<topicref href="a.dita"/>' +
        '<topicgroup keyscope="s1"><topicref href="b.dita"><topicref href="c.dita"/></topicref></topicgroup>' +
        '<topicref href="d.dita" keyscope="s2 s3"/>',
    );
    const byHref = Object.fromEntries(e.map((x) => [x.href, x.scopeChains]));
    assert.deepStrictEqual(byHref['a.dita'], [[]]);
    assert.deepStrictEqual(byHref['b.dita'], [['s1']]);
    assert.deepStrictEqual(byHref['c.dita'], [['s1']]);
    assert.deepStrictEqual(byHref['d.dita'], [['s2'], ['s3']]);
  });

  it('nests scopes outermost first', () => {
    const e = entriesOf('<topicgroup keyscope="x"><topicgroup keyscope="y"><topicref href="a.dita"/></topicgroup></topicgroup>');
    assert.deepStrictEqual(e[0].scopeChains, [['x', 'y']]);
  });

  it('carries the including mapref\'s scope into the topicrefs of an expanded submap', () => {
    const dir = mkdtempSync(join(tmpdir(), 'keyscope-entries-'));
    try {
      writeFileSync(join(dir, 'sub.ditamap'), '<?xml version="1.0"?><map><topicref href="in-sub.dita"/></map>');
      const root = parseDitamap(
        preprocessEntities('<?xml version="1.0"?><map><mapref href="sub.ditamap" keyscope="s1"/></map>'),
      ).root;
      expandDitamapRefs(root, dir, read);
      const e = collectMapEntries(root).filter((x) => x.href === 'in-sub.dita');
      assert.deepStrictEqual(e[0].scopeChains, [['s1']]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
