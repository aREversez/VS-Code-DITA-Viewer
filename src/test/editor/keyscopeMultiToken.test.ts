import * as assert from 'assert';
import { resolve } from 'path';
import { crawlMaps, CrawlHost, qualifiedNamesMulti } from '../../editor/mapCrawl';
import { runChecks, DEFAULT_COMPLETENESS_OPTIONS, CompletenessOptions, Issue } from '../../editor/mapChecks';

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

const topic = (id: string) => `<?xml version="1.0"?><topic id="${id}"><title>T</title><body/></topic>`;

async function crawl(files: Record<string, string>) {
  return crawlMaps([P('root.ditamap')], makeHost(files));
}

async function check(files: Record<string, string>, opts: Partial<CompletenessOptions>): Promise<Issue[]> {
  const host = makeHost(files);
  const c = await crawlMaps([P('root.ditamap')], host);
  return runChecks(c, { ...NONE, ...opts }, { host });
}

describe('keyscope with several tokens', () => {
  it('registers a key under every scope name: a.k and b.k both resolve', async () => {
    const c = await crawl({
      'root.ditamap': '<map><topicgroup keyscope="a b"><keydef keys="k" href="t.dita"/></topicgroup></map>',
      't.dita': topic('t'),
    });
    assert.strictEqual(c.keyDefs.length, 1);
    const q = c.keyDefs[0].qualified;
    assert.ok(q.includes('k'), q.join());
    assert.ok(q.includes('a.k'), q.join());
    assert.ok(q.includes('b.k'), q.join());
    assert.deepStrictEqual([...c.keyDefs[0].scopeIds].sort(), ['a', 'b']);
  });

  it('crosses parallel tokens with nested scopes (outer "a b", inner "c d")', async () => {
    const c = await crawl({
      'root.ditamap':
        '<map><topicgroup keyscope="a b"><topicgroup keyscope="c d"><keydef keys="k" href="t.dita"/></topicgroup></topicgroup></map>',
      't.dita': topic('t'),
    });
    const q = new Set(c.keyDefs[0].qualified);
    for (const name of ['k', 'c.k', 'd.k', 'a.c.k', 'a.d.k', 'b.c.k', 'b.d.k']) assert.ok(q.has(name), `${name} in ${[...q].join()}`);
    assert.strictEqual(c.keyDefs[0].scopeIds.length, 4);
  });

  it('a single token and no token behave as before', async () => {
    const c = await crawl({
      'root.ditamap': '<map><keydef keys="r" href="t.dita"/><topicgroup keyscope="s"><keydef keys="k" href="t.dita"/></topicgroup></map>',
      't.dita': topic('t'),
    });
    assert.deepStrictEqual(c.keyDefs[0].qualified, ['r']);
    assert.strictEqual(c.keyDefs[0].scopeId, '');
    assert.deepStrictEqual(c.keyDefs[1].qualified, ['k', 's.k']);
    assert.strictEqual(c.keyDefs[1].scopeId, 's');
  });

  it('duplicate detection: same key in scope "a b" and in scope "b" collides in b only, reported once', async () => {
    const issues = await check(
      {
        'root.ditamap':
          '<map><topicgroup keyscope="a b"><keydef keys="k" href="t.dita"/></topicgroup><topicgroup keyscope="b"><keydef keys="k" href="t.dita"/></topicgroup></map>',
        't.dita': topic('t'),
      },
      { reportDuplicateKeys: true },
    );
    assert.strictEqual(issues.filter((i) => i.category === 'duplicate-key').length, 1);
  });

  it('duplicate detection: scopes "a" and "b" do not collide', async () => {
    const issues = await check(
      {
        'root.ditamap':
          '<map><topicgroup keyscope="a"><keydef keys="k" href="t.dita"/></topicgroup><topicgroup keyscope="b"><keydef keys="k" href="t.dita"/></topicgroup></map>',
        't.dita': topic('t'),
      },
      { reportDuplicateKeys: true },
    );
    assert.strictEqual(issues.filter((i) => i.category === 'duplicate-key').length, 0);
  });

  it('unreferenced: a keyref of b.k counts as a use of the key defined in scope "a b"', async () => {
    const issues = await check(
      {
        'root.ditamap':
          '<map><topicgroup keyscope="a b"><keydef keys="k" href="t.dita"/></topicgroup><topicref keyref="b.k"/></map>',
        't.dita': topic('t'),
      },
      { reportUnreferencedKeys: true },
    );
    assert.strictEqual(issues.filter((i) => i.category === 'unreferenced-key').length, 0);
  });

  it('qualifiedNamesMulti de-duplicates and keeps the bare name first', () => {
    assert.deepStrictEqual(qualifiedNamesMulti('k', [['a'], ['b']]), ['k', 'a.k', 'b.k']);
    assert.deepStrictEqual(qualifiedNamesMulti('k', [[]]), ['k']);
  });
});
