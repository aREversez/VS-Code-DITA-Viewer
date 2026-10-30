import * as assert from 'assert';
import { basename, resolve } from 'path';
import { crawlMaps, CrawlHost } from '../../editor/mapCrawl';
import { runChecks, DEFAULT_COMPLETENESS_OPTIONS, CompletenessOptions, Issue } from '../../editor/mapChecks';

// R066: a key resolves in the key scope of the place that uses it. A key defined
// inside a keyscope is visible there (bare) and from outside only through its
// qualified name; a topic takes the scope of the topicref that publishes it.

const P = (p: string) => resolve('/proj', p);

function makeHost(files: Record<string, string>): CrawlHost {
  const abs = new Map(Object.entries(files).map(([k, v]) => [P(k), v]));
  return {
    platform: 'linux',
    readFile: async (p) => {
      const v = abs.get(p);
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    exists: async (p) => abs.has(p),
  };
}

const NONE: CompletenessOptions = {
  ...DEFAULT_COMPLETENESS_OPTIONS,
  batchValidate: false, checkNonDita: false, reportUnreferencedLinks: false, reportTableProblems: false,
};

const topic = (id: string, body = '') => `<?xml version="1.0"?><topic id="${id}"><title>T</title><body>${body}</body></topic>`;
const root = (inner: string) => `<map>${inner}</map>`;

async function crawl(files: Record<string, string>) {
  return crawlMaps([P('root.ditamap')], makeHost(files));
}

const undefinedOf = (c: Awaited<ReturnType<typeof crawl>>): string[] =>
  c.undefinedKeys.map((u) => `${basename(u.file)}:${u.key}`).sort();

describe('key scope resolution (R066)', () => {
  it('a bare key defined only inside a keyscope is undefined for a topic outside it', async () => {
    const c = await crawl({
      'root.ditamap': root('<topicgroup keyscope="s1"><keydef keys="k1" href="t1.dita"/></topicgroup><topicref href="out.dita"/>'),
      't1.dita': topic('t1'),
      'out.dita': topic('out', '<p><xref keyref="k1"/></p>'),
    });
    assert.deepStrictEqual(undefinedOf(c), ['out.dita:k1']);
  });

  it('the same topic, published inside the scope, resolves the bare key', async () => {
    const c = await crawl({
      'root.ditamap': root('<topicgroup keyscope="s1"><keydef keys="k1" href="t1.dita"/><topicref href="in.dita"/></topicgroup>'),
      't1.dita': topic('t1'),
      'in.dita': topic('in', '<p><xref keyref="k1"/></p>'),
    });
    assert.deepStrictEqual(undefinedOf(c), []);
    assert.ok(c.refs.some((r) => r.viaKeyref && basename(r.file) === 'in.dita' && r.target === P('t1.dita')));
  });

  it('a topic outside the scope reaches the key through its qualified name', async () => {
    const c = await crawl({
      'root.ditamap': root('<topicgroup keyscope="s1"><keydef keys="k1" href="t1.dita"/></topicgroup><topicref href="out.dita"/>'),
      't1.dita': topic('t1'),
      'out.dita': topic('out', '<p><xref keyref="s1.k1"/></p>'),
    });
    assert.deepStrictEqual(undefinedOf(c), []);
  });

  it('the nearest scope wins over a same-named key further out', async () => {
    const c = await crawl({
      'root.ditamap': root(
        '<keydef keys="k" href="outer.dita"/>' +
          '<topicgroup keyscope="s1"><keydef keys="k" href="inner.dita"/><topicref href="in.dita"/></topicgroup>' +
          '<topicref href="out.dita"/>',
      ),
      'outer.dita': topic('outer'),
      'inner.dita': topic('inner'),
      'in.dita': topic('in', '<p><xref keyref="k"/></p>'),
      'out.dita': topic('out', '<p><xref keyref="k"/></p>'),
    });
    const target = (from: string) => c.refs.find((r) => r.viaKeyref && basename(r.file) === from)?.target;
    assert.strictEqual(target('in.dita'), P('inner.dita'));
    assert.strictEqual(target('out.dita'), P('outer.dita'));
  });

  it('a topic published in two scopes is checked in each: undefined in the one that lacks the key', async () => {
    const c = await crawl({
      'root.ditamap': root(
        '<topicgroup keyscope="s1"><keydef keys="k1" href="t1.dita"/><topicref href="shared.dita"/></topicgroup>' +
          '<topicgroup keyscope="s2"><topicref href="shared.dita"/></topicgroup>',
      ),
      't1.dita': topic('t1'),
      'shared.dita': topic('shared', '<p><xref keyref="k1"/></p>'),
    });
    assert.deepStrictEqual(undefinedOf(c), ['shared.dita:k1']);
  });

  it('a topic published in two scopes that each define the key is clean and reaches both targets', async () => {
    const c = await crawl({
      'root.ditamap': root(
        '<topicgroup keyscope="s1"><keydef keys="k" href="a.dita"/><topicref href="shared.dita"/></topicgroup>' +
          '<topicgroup keyscope="s2"><keydef keys="k" href="b.dita"/><topicref href="shared.dita"/></topicgroup>',
      ),
      'a.dita': topic('a'),
      'b.dita': topic('b'),
      'shared.dita': topic('shared', '<p><xref keyref="k"/></p>'),
    });
    assert.deepStrictEqual(undefinedOf(c), []);
    const targets = c.refs.filter((r) => r.viaKeyref && basename(r.file) === 'shared.dita').map((r) => r.target).sort();
    assert.deepStrictEqual(targets, [P('a.dita'), P('b.dita')]);
  });

  it('a keyref on a map element is scoped the same way', async () => {
    const c = await crawl({
      'root.ditamap': root('<topicgroup keyscope="s"><keydef keys="k" href="t.dita"/></topicgroup><topicref keyref="k"/><topicref keyref="s.k"/>'),
      't.dita': topic('t'),
    });
    assert.deepStrictEqual(undefinedOf(c), ['root.ditamap:k']);
  });

  it('a conkeyref is scoped like a keyref', async () => {
    const c = await crawl({
      'root.ditamap': root('<topicgroup keyscope="s"><keydef keys="lib" href="lib.dita"/></topicgroup><topicref href="out.dita"/>'),
      'lib.dita': topic('lib', '<p id="p1">x</p>'),
      'out.dita': topic('out', '<p conkeyref="lib/p1"/>'),
    });
    assert.deepStrictEqual(undefinedOf(c), ['out.dita:lib']);
  });

  it('a keyscope on a mapref scopes the keys of the referenced map', async () => {
    const c = await crawl({
      'root.ditamap': root('<mapref href="sub.ditamap" keyscope="x"/><topicref href="a.dita"/><topicref href="b.dita"/>'),
      'sub.ditamap': root('<keydef keys="k" href="t.dita"/>'),
      't.dita': topic('t'),
      'a.dita': topic('a', '<p><xref keyref="k"/></p>'),
      'b.dita': topic('b', '<p><xref keyref="x.k"/></p>'),
    });
    assert.deepStrictEqual(undefinedOf(c), ['a.dita:k']);
  });

  it('keys at the root and unscoped maps behave as before', async () => {
    const c = await crawl({
      'root.ditamap': root('<keydef keys="k" href="t.dita"/><topicref href="a.dita"/>'),
      't.dita': topic('t'),
      'a.dita': topic('a', '<p><xref keyref="k"/><xref keyref="missing"/></p>'),
    });
    assert.deepStrictEqual(undefinedOf(c), ['a.dita:missing']);
  });

  it('reports the undefined key as an undefined-key finding on the topic', async () => {
    const files = {
      'root.ditamap': root('<topicgroup keyscope="s1"><keydef keys="k1" href="t1.dita"/></topicgroup><topicref href="out.dita"/>'),
      't1.dita': topic('t1'),
      'out.dita': topic('out', '<p><xref keyref="k1"/></p>'),
    };
    const host = makeHost(files);
    const issues: Issue[] = await runChecks(await crawlMaps([P('root.ditamap')], host), NONE, { host });
    const hits = issues.filter((i) => i.category === 'undefined-key');
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(basename(hits[0].file), 'out.dita');
  });
  // Corpus 6's q-twice and q-unused-pos asked Oxygen about both; README, "The key-scope tail",
  // records the answers these two now follow.
  it('crawls a map reached twice under different keyscopes once, but its keys belong to both scopes', async () => {
    const c = await crawl({
      'root.ditamap': root('<mapref href="keys.ditamap" keyscope="x"/><mapref href="keys.ditamap" keyscope="y"/><topicref href="ux.dita"/><topicref href="uy.dita"/>'),
      'keys.ditamap': root('<keydef keys="k" href="t.dita"/>'),
      't.dita': topic('t'),
      'ux.dita': topic('ux', '<p><xref keyref="x.k"/></p>'),
      'uy.dita': topic('uy', '<p><xref keyref="y.k"/></p>'),
    });
    assert.deepStrictEqual(undefinedOf(c), []);
    // One definition, not one per scope: two would collide under R010's duplicate-key check.
    assert.strictEqual(c.keyDefs.length, 1);
  });

  it('replays a twice-reached map per key name, so one element may define several', async () => {
    const c = await crawl({
      'root.ditamap': root('<mapref href="keys.ditamap" keyscope="x"/><mapref href="keys.ditamap" keyscope="y"/><topicref href="u.dita"/>'),
      'keys.ditamap': root('<keydef keys="k1 k2" href="t.dita"/>'),
      't.dita': topic('t'),
      'u.dita': topic('u', '<p><xref keyref="x.k1"/><xref keyref="y.k2"/></p>'),
    });
    assert.deepStrictEqual(undefinedOf(c), []);
    assert.deepStrictEqual(c.keyDefs.map((d) => d.key).sort(), ['k1', 'k2']);
    for (const def of c.keyDefs) {
      for (const q of [`x.${def.key}`, `y.${def.key}`]) assert.ok(def.qualified.includes(q), `${q} in ${def.qualified.join()}`);
    }
  });

  it("leaves a key's definition unreferenced when every use of its name fails in its scope", async () => {
    const files = {
      'root.ditamap': root('<topicgroup keyscope="s1"><keydef keys="k" href="t.dita"/></topicgroup><topicref href="out.dita"/>'),
      't.dita': topic('t'),
      'out.dita': topic('out', '<p><xref keyref="k"/></p>'),
    };
    const host = makeHost(files);
    const issues = await runChecks(await crawlMaps([P('root.ditamap')], host), { ...NONE, reportUnreferencedKeys: true }, { host });
    assert.strictEqual(issues.filter((i) => i.category === 'undefined-key').length, 1);
    assert.strictEqual(issues.filter((i) => i.category === 'unreferenced-key').length, 1);
  });
  // Corpus 6's r-dk2 and r-dk3 asked whether a clash across files files the first definition
  // too, and Oxygen filed every participant (README, "Duplicate keys across files").
  it('files a clash between two files on every definition that takes part', async () => {
    const files = {
      'root.ditamap': root('<mapref href="keys.ditamap"/><keydef keys="k" href="b.dita"/><topicref href="u.dita"/>'),
      'keys.ditamap': root('<keydef keys="k" href="a.dita"/>'),
      'a.dita': topic('a'), 'b.dita': topic('b'),
      'u.dita': topic('u', '<p><xref keyref="k"/></p>'),
    };
    const host = makeHost(files);
    const issues = await runChecks(await crawlMaps([P('root.ditamap')], host), { ...NONE, reportDuplicateKeys: true }, { host });
    const dup = issues.filter((i) => i.category === 'duplicate-key');
    assert.deepStrictEqual(dup.map((i) => basename(i.file)), ['keys.ditamap', 'root.ditamap']);
    // Each one names the other, so a reader in either file sees where the clash lies.
    assert.deepStrictEqual(dup.map((i) => basename(i.related![0].file)), ['root.ditamap', 'keys.ditamap']);
  });

  // Corpus 6's r-dkt (same map twice) and r-dkn (root plus two submaps) drew nothing from
  // Oxygen, so the second scope pass still registers keys only, never a second definition.
  it('does not call a key map reached twice in one scope a clash', async () => {
    const files = {
      'root.ditamap': root('<mapref href="keys.ditamap"/><mapref href="keys.ditamap"/><topicref href="u.dita"/>'),
      'keys.ditamap': root('<keydef keys="k" href="a.dita"/>'),
      'a.dita': topic('a'),
      'u.dita': topic('u', '<p><xref keyref="k"/></p>'),
    };
    const host = makeHost(files);
    const issues = await runChecks(await crawlMaps([P('root.ditamap')], host), { ...NONE, reportDuplicateKeys: true }, { host });
    assert.strictEqual(issues.filter((i) => i.category === 'duplicate-key').length, 0);
  });
});
