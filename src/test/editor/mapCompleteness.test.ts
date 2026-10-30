import * as assert from 'assert';
import { basename, dirname, resolve } from 'path';
import { crawlMaps, CrawlHost } from '../../editor/mapCrawl';
import {
  runChecks,
  DEFAULT_COMPLETENESS_OPTIONS,
  DEFAULT_ENABLED_CHECKS,
  CHECK_IDS,
  CompletenessOptions,
  Issue,
  ProfilingPreferences,
  optionsFromSettings,
  normalizeEnabled,
  toStoredPath,
  resolveStoredPath,
} from '../../editor/mapChecks';
import { parseDitaval } from '../../editor/ditaval';

const P = (p: string) => resolve('/proj', p);

function makeHost(files: Record<string, string>, dirs: string[] = []): CrawlHost {
  const abs = new Map(Object.entries(files).map(([k, v]) => [P(k), v]));
  const dirSet = new Set(dirs.map(P));
  return {
    platform: 'linux',
    readFile: async (p) => {
      const v = abs.get(p);
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    exists: async (p) => abs.has(p) || dirSet.has(p),
    isDirectory: async (p) => dirSet.has(p),
    readDir: async (p) => {
      const names: string[] = [];
      for (const k of [...abs.keys(), ...dirSet]) {
        if (dirname(k) === p && !names.includes(basename(k))) names.push(basename(k));
      }
      return names.length ? names : undefined;
    },
  };
}

const NONE: CompletenessOptions = {
  ...DEFAULT_COMPLETENESS_OPTIONS,
  batchValidate: false, checkNonDita: false, reportUnreferencedLinks: false, reportTableProblems: false,
};

async function check(files: Record<string, string>, opts: Partial<CompletenessOptions>, root = 'root.ditamap', dirs: string[] = []): Promise<Issue[]> {
  const host = makeHost(files, dirs);
  const crawl = await crawlMaps([P(root)], host);
  return runChecks(crawl, { ...NONE, ...opts }, { host });
}

const topic = (id: string, body = '') =>
  `<?xml version="1.0"?><topic id="${id}"><title>T</title><body>${body}</body></topic>`;

/**
 * The same pipeline with the parts a batch 3 probe needs: a DITAVAL filter applied
 * while crawling, profiling preferences, and the filter files the run uses (the
 * findings on them are reported from the options, not from the crawl).
 */
async function checkWith(
  files: Record<string, string>,
  opts: Partial<CompletenessOptions>,
  extra: {
    filterXml?: string;
    preferences?: ProfilingPreferences;
    ditavalFiles?: string[];
    root?: string;
  } = {},
): Promise<Issue[]> {
  const host = makeHost(files);
  const crawl = await crawlMaps([P(extra.root ?? 'root.ditamap')], host, {
    filter: extra.filterXml ? parseDitaval(extra.filterXml) : undefined,
  });
  const options: CompletenessOptions = { ...NONE, ditavalFiles: extra.ditavalFiles ?? [], ...opts };
  return runChecks(crawl, options, { host, preferences: extra.preferences });
}

describe('completeness: references', () => {
  it('reports a topicref to a missing topic and a missing image', async () => {
    const issues = await check(
      {
        'root.ditamap': '<map>\n<topicref href="a.dita"/>\n<topicref href="gone.dita"/>\n</map>',
        'a.dita': topic('a', '<p><image href="img/x.png"/></p>'),
      },
      { checkNonDita: true },
    );
    const msgs = issues.map((i) => `${i.category}:${i.line}:${i.message}`);
    assert.ok(msgs.some((m) => m.startsWith('missing-reference:3:') && m.includes('gone.dita')), msgs.join('\n'));
    assert.ok(msgs.some((m) => m.startsWith('missing-resource:') && m.includes('img/x.png')), msgs.join('\n'));
  });

  it('does not report missing images when the option is off', async () => {
    const issues = await check(
      { 'root.ditamap': '<map><topicref href="a.dita"/></map>', 'a.dita': topic('a', '<image href="x.png"/>') },
      { checkNonDita: false },
    );
    assert.strictEqual(issues.filter((i) => i.category === 'missing-resource').length, 0);
  });

  it('follows submaps and reports references outside the map folder', async () => {
    const issues = await check(
      {
        'root.ditamap': '<map><mapref href="sub/sub.ditamap"/></map>',
        'sub/sub.ditamap': '<map><topicref href="../../shared/x.dita"/></map>',
        '../shared/x.dita': topic('x'),
      },
      { reportOutsideMapFolder: true },
    );
    const out = issues.filter((i) => i.category === 'outside-folder');
    assert.strictEqual(out.length, 1);
    assert.ok(out[0].file.endsWith('sub.ditamap'));
  });

  it('reports xrefs to topics no map references, but not ones that are', async () => {
    const issues = await check(
      {
        'root.ditamap': '<map><topicref href="a.dita"/><topicref href="b.dita"/></map>',
        'a.dita': topic('a', '<p><xref href="b.dita"/><xref href="orphan.dita"/></p>'),
        'b.dita': topic('b'),
        'orphan.dita': topic('o'),
      },
      { reportUnreferencedLinks: true },
    );
    const links = issues.filter((i) => i.category === 'unreferenced-link');
    assert.strictEqual(links.length, 1);
    assert.ok(links[0].message.includes('orphan.dita'));
  });

  it('reports related links in a reltable whose target is not in the map', async () => {
    const issues = await check(
      {
        'root.ditamap':
          '<map><topicref href="a.dita"/><reltable><relrow><relcell><topicref href="a.dita"/></relcell><relcell><topicref href="z.dita"/></relcell></relrow></reltable></map>',
        'a.dita': topic('a'),
        'z.dita': topic('z'),
      },
      { reportUnreferencedLinks: true },
    );
    const links = issues.filter((i) => i.category === 'unreferenced-link');
    assert.strictEqual(links.length, 1);
    assert.ok(links[0].message.includes('z.dita'));
  });
});

describe('completeness: key references', () => {
  it('resolves a topicref keyref so the topic counts as referenced twice', async () => {
    const issues = await check(
      {
        'root.ditamap': '<map><keydef keys="k" href="t.dita"/><topicref keyref="k"/><topicref keyref="k"/></map>',
        't.dita': topic('t'),
      },
      { reportMultipleRefs: true },
    );
    assert.strictEqual(issues.filter((i) => i.category === 'multiple-reference').length, 1);
  });

  it('reports a keyref that matches no key definition', async () => {
    const issues = await check(
      { 'root.ditamap': '<map><topicref keyref="nope"/></map>' },
      {},
    );
    const un = issues.filter((i) => i.category === 'undefined-key');
    assert.strictEqual(un.length, 1);
    assert.ok(un[0].message.includes('nope'));
  });

  it('does not report a keyref that resolves to a text-only key', async () => {
    const issues = await check(
      { 'root.ditamap': '<map><keydef keys="prod">Product</keydef><topicref keyref="prod"/></map>' },
      {},
    );
    assert.strictEqual(issues.filter((i) => i.category === 'undefined-key').length, 0);
  });

  it('falls back to @href when the keyref names no key', async () => {
    const issues = await check(
      { 'root.ditamap': '<map><topicref keyref="nosuch" href="gone.dita"/></map>' },
      {},
    );
    assert.ok(issues.some((i) => i.category === 'missing-reference' && i.message.includes('gone.dita')));
  });

  it('ignores @href when the keyref resolves to a text-only key', async () => {
    const issues = await check(
      {
        'root.ditamap':
          '<map><keydef keys="k"><topicmeta><keywords><keyword>x</keyword></keywords></topicmeta></keydef><topicref keyref="k" href="gone.dita"/></map>',
      },
      {},
    );
    assert.strictEqual(issues.filter((i) => i.category === 'missing-reference').length, 0);
  });

  it('does not count a <ph keyref> as a second reference to the key target', async () => {
    const issues = await check(
      {
        'root.ditamap': '<map><keydef keys="k" href="t.dita"/><topicref href="t.dita"/><topicref href="u.dita"/></map>',
        't.dita': topic('t'),
        'u.dita': topic('u', '<p><ph keyref="k"/></p>'),
      },
      { reportMultipleRefs: true },
    );
    assert.strictEqual(issues.filter((i) => i.category === 'multiple-reference').length, 0);
  });

  it('does not count a keydef that redirects through @keyref as a topicref', async () => {
    const issues = await check(
      {
        'root.ditamap': '<map><keydef keys="b" href="t.dita"/><keydef keys="a" keyref="b"/><topicref href="t.dita"/></map>',
        't.dita': topic('t'),
      },
      { reportMultipleRefs: true },
    );
    assert.strictEqual(issues.filter((i) => i.category === 'multiple-reference').length, 0);
  });

  it('reports a missing file behind a keyref', async () => {
    const issues = await check(
      { 'root.ditamap': '<map><keydef keys="k" href="gone.dita"/><topicref keyref="k"/></map>' },
      {},
    );
    assert.ok(issues.some((i) => i.category === 'missing-reference' && i.message.includes('gone.dita')));
  });

  it('reports a missing file behind a conkeyref on the element that reaches it', async () => {
    // Oxygen files the unresolvable target twice: once on the keydef that writes the
    // href and once on the element that reaches it through the key (corpus 3, R019).
    const issues = await check(
      {
        'root.ditamap': '<map><topicref href="a.dita"/><keydef keys="k" href="gone.dita"/></map>',
        'a.dita': topic('a', '<p conkeyref="k/x"/>'),
      },
      {},
    );
    const miss = issues.filter((i) => i.category === 'missing-reference');
    assert.strictEqual(miss.length, 2, miss.map((i) => `${i.file}:${i.line}`).join('\n'));
    assert.ok(miss.some((i) => i.file.endsWith('root.ditamap') && i.message.includes('gone.dita')));
    assert.ok(miss.some((i) => i.file.endsWith('a.dita') && i.message.includes('gone.dita')), JSON.stringify(miss.map((i) => i.message)));
  });

  it('does not report a conkeyref whose key target exists', async () => {
    const issues = await check(
      {
        'root.ditamap': '<map><topicref href="a.dita"/><keydef keys="k" href="lib.dita"/></map>',
        'a.dita': topic('a', '<p conkeyref="k/x"/>'),
        'lib.dita': topic('lib', '<p id="x">x</p>'),
      },
      {},
    );
    assert.deepStrictEqual(issues.filter((i) => i.category === 'missing-reference'), []);
  });
});

describe('completeness: multiple references', () => {
  const map = (second: string) =>
    `<map><topicref href="t.dita"/>${second}</map>`;
  it('flags a second reference to the same topic', async () => {
    const issues = await check(
      { 'root.ditamap': map('<topicref href="t.dita"/>'), 't.dita': topic('t') },
      { reportMultipleRefs: true },
    );
    assert.strictEqual(issues.filter((i) => i.category === 'multiple-reference').length, 1);
  });
  it('does not flag a reference with a unique @copy-to (Oxygen doc example)', async () => {
    const issues = await check(
      { 'root.ditamap': map('<topicref href="t.dita" copy-to="t2.dita"/>'), 't.dita': topic('t') },
      { reportMultipleRefs: true },
    );
    assert.strictEqual(issues.filter((i) => i.category === 'multiple-reference').length, 0);
  });
  it('flags two references sharing the same @copy-to', async () => {
    const issues = await check(
      {
        'root.ditamap': '<map><topicref href="t.dita" copy-to="c.dita"/><topicref href="t.dita" copy-to="c.dita"/></map>',
        't.dita': topic('t'),
      },
      { reportMultipleRefs: true },
    );
    assert.strictEqual(issues.filter((i) => i.category === 'multiple-reference').length, 1);
  });
  // Corpus 6's six probes (its README, "The duplicate probes"): Oxygen files
  // dmv.dup.topic by (target, scope chain), so a container changes nothing and a
  // different key scope is what separates two publications of one topic (R008).
  it('counts a duplicate across two topicgroups, so a container is not the boundary', async () => {
    const issues = await check(
      {
        'root.ditamap':
          '<map><topicgroup><topicref href="t.dita"/></topicgroup><topicgroup><topicref href="t.dita"/></topicgroup></map>',
        't.dita': topic('t'),
      },
      { reportMultipleRefs: true },
    );
    assert.strictEqual(issues.filter((i) => i.category === 'multiple-reference').length, 1);
  });
  it('counts a duplicate inside one keyscope, so a scope is not the boundary either', async () => {
    const issues = await check(
      {
        'root.ditamap':
          '<map><topicgroup keyscope="s1"><topicref href="t.dita"/><topicref href="t.dita"/></topicgroup></map>',
        't.dita': topic('t'),
      },
      { reportMultipleRefs: true },
    );
    assert.strictEqual(issues.filter((i) => i.category === 'multiple-reference').length, 1);
  });
  it('does not flag one topic published in each of two key scopes', async () => {
    const issues = await check(
      {
        'root.ditamap':
          '<map><topicgroup keyscope="s1"><topicref href="t.dita"/></topicgroup><topicgroup keyscope="s2"><topicref href="t.dita"/></topicgroup></map>',
        't.dita': topic('t'),
      },
      { reportMultipleRefs: true },
    );
    assert.strictEqual(issues.filter((i) => i.category === 'multiple-reference').length, 0);
  });
  it('does not flag two references whose own @keyscope differ', async () => {
    const issues = await check(
      {
        'root.ditamap': '<map><topicref href="t.dita" keyscope="s1"/><topicref href="t.dita" keyscope="s2"/></map>',
        't.dita': topic('t'),
      },
      { reportMultipleRefs: true },
    );
    assert.strictEqual(issues.filter((i) => i.category === 'multiple-reference').length, 0);
  });
  // The shapes below were extrapolated from the six probes until corpus 6's p-dup-g..j
  // were run. Oxygen is silent on all four, so g, h and i confirm the rule as written and
  // j showed that the order of the names counts (R008).
  it('does not flag one topic at the root scope and once inside a keyscope', async () => {
    const issues = await check(
      {
        'root.ditamap': '<map><topicref href="t.dita"/><topicgroup keyscope="s1"><topicref href="t.dita"/></topicgroup></map>',
        't.dita': topic('t'),
      },
      { reportMultipleRefs: true },
    );
    assert.strictEqual(issues.filter((i) => i.category === 'multiple-reference').length, 0);
  });
  it('does not flag one topic in a scope and again in a scope nested inside it', async () => {
    const issues = await check(
      {
        'root.ditamap':
          '<map><topicgroup keyscope="s1"><topicref href="t.dita"/><topicgroup keyscope="s2"><topicref href="t.dita"/></topicgroup></topicgroup></map>',
        't.dita': topic('t'),
      },
      { reportMultipleRefs: true },
    );
    assert.strictEqual(issues.filter((i) => i.category === 'multiple-reference').length, 0);
  });
  it('treats "a b" against "a" and "a b" against "b a" as different scopes', async () => {
    const run = (second: string) =>
      check(
        {
          'root.ditamap': `<map><topicgroup keyscope="a b"><topicref href="t.dita"/></topicgroup><topicgroup keyscope="${second}"><topicref href="t.dita"/></topicgroup></map>`,
          't.dita': topic('t'),
        },
        { reportMultipleRefs: true },
      );
    assert.strictEqual((await run('a')).filter((i) => i.category === 'multiple-reference').length, 0);
    assert.strictEqual((await run('b a')).filter((i) => i.category === 'multiple-reference').length, 0);
  });
  // The fourth report answers the question this shape was written for: two separate
  // keyscope="a b" declarations list the same names in the same order, and Oxygen files
  // the pair (p-dup-l), so the names are the identity, not the declaring element.
  it('counts two keyscope groups that list the same names in the same order', async () => {
    const issues = await check(
      {
        'root.ditamap':
          '<map><topicgroup keyscope="a b"><topicref href="t.dita"/></topicgroup><topicgroup keyscope="a b"><topicref href="t.dita"/></topicgroup></map>',
        't.dita': topic('t'),
      },
      { reportMultipleRefs: true },
    );
    assert.strictEqual(issues.filter((i) => i.category === 'multiple-reference').length, 1);
  });
  // Both were asked in the fourth report: p-dup-m is silent, so the identity is the whole
  // chain rather than its innermost name, and p-dup-n is filed, so the names are parsed on
  // whitespace rather than compared as attribute text.
  it('treats the same innermost scope under two different outer scopes as different scopes', async () => {
    const issues = await check(
      {
        'root.ditamap':
          '<map><topicgroup keyscope="s1"><topicgroup keyscope="x"><topicref href="t.dita"/></topicgroup></topicgroup><topicgroup keyscope="s2"><topicgroup keyscope="x"><topicref href="t.dita"/></topicgroup></topicgroup></map>',
        't.dita': topic('t'),
      },
      { reportMultipleRefs: true },
    );
    assert.strictEqual(issues.filter((i) => i.category === 'multiple-reference').length, 0);
  });
  it('splits keyscope names on any whitespace, so "a b" and "a  b" are one scope', async () => {
    const issues = await check(
      {
        'root.ditamap':
          '<map><topicgroup keyscope="a b"><topicref href="t.dita"/></topicgroup><topicgroup keyscope="a  b"><topicref href="t.dita"/></topicgroup></map>',
        't.dita': topic('t'),
      },
      { reportMultipleRefs: true },
    );
    assert.strictEqual(issues.filter((i) => i.category === 'multiple-reference').length, 1);
  });
  it('counts a topicref @keyref in the scope of the element that carries it', async () => {
    const run = (second: string) =>
      check(
        {
          'root.ditamap': `<map><keydef keys="k" href="t.dita"/>${second}<topicref keyref="k"/></map>`,
          't.dita': topic('t'),
        },
        { reportMultipleRefs: true },
      );
    // The keydef's own href is not a plain topicref; the two keyref uses are what repeat.
    assert.strictEqual((await run('<topicref keyref="k"/>')).filter((i) => i.category === 'multiple-reference').length, 1);
    assert.strictEqual(
      (await run('<topicgroup keyscope="s1"><topicref keyref="k"/></topicgroup>')).filter((i) => i.category === 'multiple-reference').length,
      0,
    );
  });
});

describe('completeness: ids and keys', () => {
  it('reports duplicate topic ids on every file that shares the id, related to the others', async () => {
    const issues = await check(
      {
        'root.ditamap': '<map><topicref href="a.dita"/><topicref href="b.dita"/></map>',
        'a.dita': topic('same'),
        'b.dita': topic('same'),
      },
      { checkDuplicateTopicIds: true },
    );
    const dup = issues.filter((i) => i.category === 'duplicate-id');
    assert.strictEqual(dup.length, 2);
    assert.deepStrictEqual(
      dup.map((i) => (i.file.endsWith('a.dita') ? 'a' : 'b')).sort(),
      ['a', 'b'],
    );
    for (const i of dup) {
      assert.strictEqual(i.related!.length, 1);
      assert.ok(i.related![0].file.endsWith(i.file.endsWith('a.dita') ? 'b.dita' : 'a.dita'));
    }
  });

  it('duplicate keys: reports same-scope duplicates, not the same key in a key scope (Oxygen doc example)', async () => {
    const issues = await check(
      {
        // One definition per line, as a real map writes them: findings on one line collapse.
        'root.ditamap':
          '<map>\n<topicref href="t2.dita" keys="k2"/>\n<topicgroup keyscope="ks"><topicref href="t2.dita" keys="k2"/></topicgroup>\n<topicref href="t2.dita" keys="dup"/>\n<topicref href="t2.dita" keys="dup"/>\n</map>',
        't2.dita': topic('t2'),
      },
      { reportDuplicateKeys: true },
    );
    const dup = issues.filter((i) => i.category === 'duplicate-key');
    assert.strictEqual(dup.length, 2);
    assert.ok(dup.every((i) => i.message.includes('"dup"')));
    // Every participant is filed, each pointing at the other one.
    assert.deepStrictEqual(dup.map((i) => i.line), [4, 5]);
    const lines = dup.map((i) => i.line);
    for (const i of dup) {
      assert.deepStrictEqual(i.related!.map((r) => r.line), lines.filter((l) => l !== i.line));
    }
  });

  it('unreferenced keys: counts keyref in topics, conkeyref, and keyref in the map', async () => {
    const issues = await check(
      {
        'root.ditamap':
          '<map><keydef keys="used-x" href="x.dita"/><keydef keys="used-c" href="c.dita"/><keydef keys="unused" href="u.dita"/><keydef keys="alias" keyref="used-x"/></map>',
        'x.dita': topic('x'),
        'c.dita': topic('c'),
        'u.dita': topic('u'),
      },
      { reportUnreferencedKeys: true },
    );
    // no topic uses anything yet: everything but "used-x" (used by alias) is unreferenced
    const un = issues.filter((i) => i.category === 'unreferenced-key').map((i) => i.message);
    assert.ok(!un.some((m) => m.includes('"used-x"')));
    assert.ok(un.some((m) => m.includes('"unused"')));
    assert.ok(un.some((m) => m.includes('"alias"')));
  });

  it('unreferenced keys: a keyref in a topic marks the key used', async () => {
    const issues = await check(
      {
        'root.ditamap': '<map><topicref href="a.dita"/><keydef keys="logo" href="l.png" format="png"/></map>',
        'a.dita': topic('a', '<image keyref="logo"/>'),
      },
      { reportUnreferencedKeys: true },
    );
    assert.strictEqual(issues.filter((i) => i.category === 'unreferenced-key').length, 0);
  });
});

describe('completeness: reusable elements', () => {
  it('reports ids in a resource-only topic that no conref uses', async () => {
    const issues = await check(
      {
        'root.ditamap':
          '<map><topicref href="a.dita"/><topicref href="lib.dita" processing-role="resource-only"/></map>',
        'a.dita': topic('a', '<p conref="lib.dita#lib/used"/>'),
        'lib.dita': topic('lib', '<p id="used">u</p><p id="idle">i</p>'),
      },
      { reportUnreferencedReusable: true },
    );
    const r = issues.filter((i) => i.category === 'unreferenced-reusable');
    assert.strictEqual(r.length, 1);
    assert.ok(r[0].message.includes('idle'));
  });

  it('a conkeyref resolved through a key counts as a use', async () => {
    const issues = await check(
      {
        'root.ditamap':
          '<map><topicref href="a.dita"/><keydef keys="lib" href="lib.dita"/></map>',
        'a.dita': topic('a', '<p conkeyref="lib/used"/>'),
        'lib.dita': topic('lib', '<p id="used">u</p>'),
      },
      { reportUnreferencedReusable: true },
    );
    assert.strictEqual(issues.filter((i) => i.category === 'unreferenced-reusable').length, 0);
  });
});

describe('completeness: invalid referenced topic ids', () => {
  it('flags a conref whose file exists but whose topic id does not, and leaves the target unreferenced', async () => {
    // Mirrors the corpus's linker2 -> `ok.dita#used`: the file resolves, but `used`
    // is not a topic id in ok.dita, so the reference is broken (Oxygen's
    // dmv.invalid.ref.topic.id) and the element it aimed at is never pulled in.
    const issues = await check(
      {
        'root.ditamap':
          '<map><topicref href="a.dita"/><topicref href="lib.dita" processing-role="resource-only"/></map>',
        'a.dita': topic('a', '<p><ph conref="lib.dita#nope"/></p>'),
        'lib.dita': topic('lib', '<p id="nope">n</p>'),
      },
      { batchValidate: true, reportUnreferencedReusable: true },
    );
    const bad = issues.filter((i) => i.category === 'invalid-ref-topic-id');
    assert.strictEqual(bad.length, 1);
    assert.ok(bad[0].file.endsWith('a.dita'), bad[0].file);
    assert.ok(bad[0].message.includes('nope'), bad[0].message);
    const re = issues.filter((i) => i.category === 'unreferenced-reusable');
    assert.strictEqual(re.length, 1, re.map((i) => i.message).join('\n'));
    assert.ok(re[0].message.includes('nope'));
  });

  it('accepts a well-formed conref to an existing topic id and counts it as a use', async () => {
    const issues = await check(
      {
        'root.ditamap':
          '<map><topicref href="a.dita"/><topicref href="lib.dita" processing-role="resource-only"/></map>',
        'a.dita': topic('a', '<p><ph conref="lib.dita#lib/used"/></p>'),
        'lib.dita': topic('lib', '<p id="used">u</p>'),
      },
      { batchValidate: true, reportUnreferencedReusable: true },
    );
    assert.strictEqual(issues.filter((i) => i.category === 'invalid-ref-topic-id').length, 0);
    assert.strictEqual(issues.filter((i) => i.category === 'unreferenced-reusable').length, 0);
  });

  it('treats the same-topic forms #. and #./elem as resolved, and counts #./elem as a use', async () => {
    // DITA 1.3 (uri-based-addressing): "." stands for the topic that holds the reference.
    const issues = await check(
      {
        'root.ditamap': '<map><topicref href="a.dita"/></map>',
        'a.dita': topic('a', '<p conref="#./src"/><p conref="#."/><p id="src">s</p>'),
      },
      { batchValidate: true, reportUnreferencedReusable: true },
    );
    assert.deepStrictEqual(issues.filter((i) => i.category === 'invalid-ref-topic-id'), []);
    assert.deepStrictEqual(issues.filter((i) => i.category === 'unreferenced-reusable'), []);
  });
});

describe('completeness: conref class compatibility', () => {
  // A source is allowed to draw in a target when its class is the target's own class or an
  // ancestor of it (Oxygen: "the source ... is not a generalization of the target"). Written
  // class values keep these cases independent of the DTD table.
  const files = (sourceClass: string, targetClass: string, sourceTag = 'li', targetTag = 'li'): Record<string, string> => ({
    'root.ditamap': '<map><topicref href="a.dita"/><topicref href="lib.dita" processing-role="resource-only"/></map>',
    'a.dita': `<topic id="a"><title>A</title><body><ul><${sourceTag} class="${sourceClass}" conref="lib.dita#lib/x"/></ul></body></topic>`,
    'lib.dita': `<topic id="lib"><title>L</title><body><ul><${targetTag} class="${targetClass}" id="x">t</${targetTag}></ul></body></topic>`,
  });
  const conrefClass = (issues: Issue[]) => issues.filter((i) => i.category === 'conref-class');

  it('allows a source that is the general end of the target\'s class chain', async () => {
    const issues = await check(files('- topic/li ', '- topic/li task/step ', 'li', 'step'), { checkNonDita: true });
    assert.deepStrictEqual(conrefClass(issues), []);
  });

  it('allows a source with the same class as the target', async () => {
    const issues = await check(files('- topic/li ', '- topic/li '), { checkNonDita: true });
    assert.deepStrictEqual(conrefClass(issues), []);
  });

  it('reports a source that is more specific than the target (Oxygen reports step drawing in li)', async () => {
    const issues = await check(files('- topic/li task/step ', '- topic/li ', 'step', 'li'), { checkNonDita: true });
    assert.strictEqual(conrefClass(issues).length, 1);
  });

  it('reports two classes where neither is an ancestor of the other', async () => {
    const issues = await check(files('- topic/li task/step ', '- topic/li task/substep ', 'step', 'substep'), { checkNonDita: true });
    assert.strictEqual(conrefClass(issues).length, 1);
  });

  it('allows a phrase drawing in a domain specialization of it, with classes from the DTD table', async () => {
    const doctype = '<?xml version="1.0"?>\n<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA Topic//EN" "topic.dtd">\n';
    const issues = await check(
      {
        'root.ditamap': '<map><topicref href="a.dita"/><topicref href="lib.dita" processing-role="resource-only"/></map>',
        'a.dita': `${doctype}<topic id="a"><title>A</title><body><p><ph conref="lib.dita#lib/x"/></p></body></topic>`,
        'lib.dita': `${doctype}<topic id="lib"><title>L</title><body><p><uicontrol id="x">OK</uicontrol></p></body></topic>`,
      },
      { checkNonDita: true },
    );
    assert.deepStrictEqual(conrefClass(issues), []);
  });
});

describe('completeness: class format and files without a DTD', () => {
  // The map declares the OASIS DOCTYPE, so only the topic under test can be reported.
  const MAP = '<?xml version="1.0"?>\n<!DOCTYPE map PUBLIC "-//OASIS//DTD DITA Map//EN" "map.dtd">\n<map><topicref href="a.dita"/></map>';
  const BODY = '<topic id="a"><title>A</title><body><p>x</p></body></topic>';
  const classFormat = (issues: Issue[]) => issues.filter((i) => i.category === 'class-format');
  const run = async (doc: string) =>
    classFormat(await check({ 'root.ditamap': MAP, 'a.dita': doc }, { batchValidate: true, checkNonDita: true }));

  it('reports every element of a file with no DOCTYPE and no grammar (nothing supplies a class)', async () => {
    assert.strictEqual((await run(`<?xml version="1.0"?>\n${BODY}`)).length, 4);
  });

  it('does not report a file that declares a DOCTYPE of its own (its DTD may supply the class)', async () => {
    const doc = `<?xml version="1.0"?>\n<!DOCTYPE topic PUBLIC "-//ACME//DTD DITA Special Topic//EN" "special.dtd">\n${BODY}`;
    assert.deepStrictEqual(await run(doc), []);
  });

  it('does not report a file that points at a RELAX NG grammar (it supplies the class defaults)', async () => {
    const doc = `<?xml version="1.0"?>\n<?xml-model href="urn:oasis:names:tc:dita:rng:topic.rng" schematypens="http://relaxng.org/ns/structure/1.0"?>\n${BODY}`;
    assert.deepStrictEqual(await run(doc), []);
  });

  it('does not report a file that points at an XML Schema (it supplies the class defaults)', async () => {
    const doc =
      '<?xml version="1.0"?>\n<topic id="a" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
      'xsi:noNamespaceSchemaLocation="urn:oasis:names:tc:dita:xsd:topic.xsd"><title>A</title><body><p>x</p></body></topic>';
    assert.deepStrictEqual(await run(doc), []);
  });

  it('still checks the syntax of a class that is written, whatever declares the grammar', async () => {
    const doc = `<?xml version="1.0"?>\n<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA Topic//EN" "topic.dtd">\n<topic id="a" class="topic/topic"><title>A</title><body/></topic>`;
    assert.strictEqual((await run(doc)).length, 1);
  });
});

describe('completeness: tables', () => {
  const cals = (cols: string, rows: string, colspecs = '') =>
    topic('t', `<table><tgroup cols="${cols}">${colspecs}<tbody>${rows}</tbody></tgroup></table>`);
  const run = (t: string) =>
    check({ 'root.ditamap': '<map><topicref href="t.dita"/></map>', 't.dita': t }, { reportTableProblems: true });

  it('accepts a well-formed CALS table', async () => {
    const issues = await run(cals('2', '<row><entry>a</entry><entry>b</entry></row><row><entry>c</entry><entry>d</entry></row>'));
    assert.strictEqual(issues.filter((i) => i.category === 'table-layout').length, 0);
  });
  it('reports a row with too few cells', async () => {
    const issues = await run(cals('2', '<row><entry>a</entry><entry>b</entry></row><row><entry>c</entry></row>'));
    assert.ok(issues.some((i) => i.category === 'table-layout' && /row 2 has 1 column/.test(i.message)));
  });
  it('reports colspec count differing from @cols', async () => {
    const issues = await run(cals('3', '<row><entry>a</entry><entry>b</entry><entry>c</entry></row>', '<colspec colname="c1"/><colspec colname="c2"/>'));
    assert.ok(issues.some((i) => /2 <colspec> element\(s\) but @cols is 3/.test(i.message)));
  });
  it('reports non-numeric @cols', async () => {
    const issues = await run(cals('x', '<row><entry>a</entry></row>'));
    assert.ok(issues.some((i) => /not a valid column count/.test(i.message)));
  });
  it('reports @namest pointing at an unknown colname', async () => {
    const issues = await run(cals('2', '<row><entry namest="c1" nameend="zz">a</entry></row>', '<colspec colname="c1"/><colspec colname="c2"/>'));
    assert.ok(issues.some((i) => /@nameend "zz" does not match/.test(i.message)));
  });
  it('reports @morerows spanning past the last row', async () => {
    const issues = await run(cals('2', '<row><entry morerows="3">a</entry><entry>b</entry></row><row><entry>c</entry></row>'));
    assert.ok(issues.some((i) => /@morerows="3" spans past/.test(i.message)));
  });
  it('accepts a morerows span that fills the next row', async () => {
    const issues = await run(cals('2', '<row><entry morerows="1">a</entry><entry>b</entry></row><row><entry>c</entry></row>'));
    assert.strictEqual(issues.filter((i) => i.category === 'table-layout').length, 0, JSON.stringify(issues));
  });
  it('reports a simple table row shorter than its header', async () => {
    const issues = await run(topic('t', '<simpletable><sthead><stentry>a</stentry><stentry>b</stentry></sthead><strow><stentry>x</stentry></strow></simpletable>'));
    assert.ok(issues.some((i) => i.category === 'table-layout' && /row 2 has 1 cell/.test(i.message)));
  });
});

describe('completeness: profiling', () => {
  it('flags a child whose @audience shares nothing with its ancestor', async () => {
    const issues = await check(
      {
        'root.ditamap': '<map><topicref href="a.dita"/></map>',
        'a.dita': topic('a', '<section audience="admin"><p audience="user">x</p><p audience="admin user">y</p></section>'),
      },
      { identifyProfilingConflicts: true },
    );
    const c = issues.filter((i) => i.category === 'profiling-conflict');
    assert.strictEqual(c.length, 1);
    assert.ok(c[0].message.includes('"user"'));
  });

  const rooted = (attrs: string, body: string) =>
    `<?xml version="1.0"?><topic id="a"${attrs}><title>T</title><body>${body}</body></topic>`;

  it('flags a topic root whose values conflict with its topicref', async () => {
    const issues = await check(
      {
        'root.ditamap': '<map><topicref href="a.dita" platform="linux"/></map>',
        'a.dita': rooted(' platform="windows"', '<p>x</p>'),
      },
      { identifyProfilingConflicts: true },
    );
    assert.strictEqual(issues.filter((i) => i.category === 'profiling-conflict').length, 1);
  });

  it('does not carry a topicref value down to body elements (Oxygen compares the topic root only)', async () => {
    // Real Oxygen run (profiling.dita, profiling-defined.dita): no ineffective-condition
    // finding for a body element against the map value.
    const issues = await check(
      {
        'root.ditamap': '<map><topicref href="a.dita" platform="linux"/></map>',
        'a.dita': topic('a', '<p platform="windows">x</p>'),
      },
      { identifyProfilingConflicts: true },
    );
    assert.deepStrictEqual(issues.filter((i) => i.category === 'profiling-conflict'), []);
  });

  it('still compares body elements with the topic root\'s own values', async () => {
    const issues = await check(
      {
        'root.ditamap': '<map><topicref href="a.dita"/></map>',
        'a.dita': rooted(' audience="novice"', '<p audience="expert">x</p>'),
      },
      { identifyProfilingConflicts: true },
    );
    assert.strictEqual(issues.filter((i) => i.category === 'profiling-conflict').length, 1);
  });

  it('reports values missing from preferences, unknown attributes, and multi-valued single-value attributes', async () => {
    const host = makeHost({
      'root.ditamap': '<map><topicref href="a.dita"/></map>',
      'a.dita': topic('a', '<p audience="admin ghost" product="x"/><p platform="a b"/>'),
    });
    const crawl = await crawlMaps([P('root.ditamap')], host);
    const issues = await runChecks(crawl, { ...NONE, reportProfilingPreferences: true }, {
      host,
      preferences: { attributes: { audience: ['admin', 'user'], platform: [] }, singleValue: ['platform'] },
    });
    const msgs = issues.filter((i) => i.category === 'profiling-preference').map((i) => i.message);
    assert.ok(msgs.some((m) => m.includes('"ghost"')), msgs.join('\n'));
    assert.ok(msgs.some((m) => m.includes('@product') && m.includes('not defined')), msgs.join('\n'));
    assert.ok(msgs.some((m) => m.includes('single-value')), msgs.join('\n'));
  });

  it('says so when no preferences are configured', async () => {
    const issues = await check({ 'root.ditamap': '<map/>' }, { reportProfilingPreferences: true });
    assert.ok(issues.some((i) => i.category === 'profiling-preference' && i.severity === 'info'));
  });
});

describe('completeness: reference spelling and @format (Oxygen batch 1)', () => {
  it('reports local href spelling, but leaves URLs and encoded/non-ASCII names alone', async () => {
    const issues = await check(
      {
        'root.ditamap': '<map><topicref href="a.dita"/></map>',
        'a.dita': topic(
          'a',
          '<p>' +
            '<xref href="..\\topics\\ok.dita"/>' +
            '<xref href="/probe/x.dita"/>' +
            '<xref href="../topics//ok.dita"/>' +
            '<xref href="../topics/ok.dita/"/>' +
            '<xref href="../topics/ok file.dita"/>' +
            '<xref href="../topics/100%.dita"/>' +
            '<xref href="../topics/ok%20file.dita"/>' +
            '<xref href="../topics/中文.dita"/>' +
            '</p>',
        ),
        'topics/ok.dita': topic('ok'),
      },
      { checkNonDita: true },
    );
    const syntax = issues.filter((i) => i.category === 'reference-syntax');
    assert.deepStrictEqual(
      syntax.map((i) => `${i.severity}:${i.message.split(':')[0]}`),
      [
        'error:Reference uses backslashes instead of forward slashes',
        'warning:Reference is an absolute path; DITA references should be relative to the map',
        'warning:Reference contains a doubled path separator ("//")',
        'warning:Reference ends with a slash',
        'error:Reference contains characters that must be percent-encoded',
        'error:Reference contains characters that must be percent-encoded',
      ],
      JSON.stringify(syntax, null, 2),
    );
    // A committed finding must not quote the machine path the absolute href named.
    assert.ok(!syntax[1].message.includes('/probe'), syntax[1].message);
  });

  it('reports a file name whose capitalization differs from the directory entry', async () => {
    const issues = await check(
      {
        'root.ditamap': '<map><topicref href="topics/OK.dita"/><topicref href="topics/ok.dita"/></map>',
        'topics/ok.dita': topic('ok'),
      },
      { checkNonDita: true },
      'root.ditamap',
      ['topics'],
    );
    const wrong = issues.filter((i) => i.category === 'incorrect-case-reference');
    assert.strictEqual(wrong.length, 1, JSON.stringify(issues, null, 2));
    assert.ok(wrong[0].message.includes('OK.dita') && wrong[0].message.includes('"ok.dita"'), wrong[0].message);
  });

  it('reports a reference that resolves to a folder', async () => {
    const issues = await check(
      { 'root.ditamap': '<map><topicref href="topics"/></map>' },
      { checkNonDita: true },
      'root.ditamap',
      ['topics'],
    );
    const folder = issues.filter((i) => i.category === 'folder-reference');
    assert.strictEqual(folder.length, 1, JSON.stringify(issues, null, 2));
    assert.strictEqual(folder[0].severity, 'error');
  });

  it('reports the reference that closes a map cycle, once', async () => {
    const issues = await check(
      {
        'root.ditamap': '<map><mapref href="a.ditamap" format="ditamap"/></map>',
        'a.ditamap': '<map><mapref href="b.ditamap" format="ditamap"/></map>',
        'b.ditamap': '<map><mapref href="a.ditamap" format="ditamap"/></map>',
      },
      { checkNonDita: true },
    );
    const rec = issues.filter((i) => i.category === 'recursive-reference');
    assert.strictEqual(rec.length, 1, JSON.stringify(issues, null, 2));
    assert.ok(rec[0].file.endsWith('b.ditamap'));
    assert.strictEqual(rec[0].severity, 'error');
  });

  it('reports keyref values that cannot name a key', async () => {
    const issues = await check(
      {
        'root.ditamap':
          '<map><keydef keys="a" href="t.dita"/><topicref keyref="a/b/c"/><topicref keyref="a b"/><topicref keyref="a/b"/></map>',
        't.dita': topic('t'),
      },
      { checkNonDita: true },
    );
    const bad = issues.filter((i) => i.category === 'invalid-key-syntax');
    assert.deepStrictEqual(bad.map((i) => i.message), [
      'Key reference has more than one "/" (expected key/element): a/b/c',
      'Key reference contains whitespace: a b',
    ]);
  });

  it('reports @id values that are not XML NCNames, only under batch validation', async () => {
    const files = {
      'root.ditamap': '<map><topicref href="a.dita"/></map>',
      'a.dita': '<topic id="a"><title>T</title><body><p id="1a"/><p id="a:b"/><p id="ok-id"/></body></topic>',
    };
    const on = await check(files, { batchValidate: true });
    const off = await check(files, { checkNonDita: true });
    assert.deepStrictEqual(on.filter((i) => i.category === 'invalid-id-syntax').map((i) => i.message), [
      'ID "1a" is not a valid DITA ID (XML NCName)',
      'ID "a:b" is not a valid DITA ID (XML NCName)',
    ]);
    assert.strictEqual(off.filter((i) => i.category === 'invalid-id-syntax').length, 0);
  });

  it('reports a missing or contradicting @format against the target kind', async () => {
    const issues = await check(
      {
        'root.ditamap':
          '<map>' +
          '<topicref href="a.dita"/>' +
          '<topicref href="files/x.txt"/>' +
          '<topicref href="sub.ditamap"/>' +
          '<mapref href="sub.ditamap"/>' +
          '<topicref href="t.dita" format="ditamap"/>' +
          '</map>',
        'a.dita': topic(
          'a',
          '<p>' +
            '<xref href="files/y.pdf"/>' +
            '<xref href="files/x.txt" format="dita"/>' +
            '<xref href="files/x.txt" format="ditamap"/>' +
            '</p>',
        ),
        'sub.ditamap': '<map/>',
        't.dita': topic('t'),
      },
      { checkNonDita: true },
    );
    const missing = issues.filter((i) => i.category === 'format-missing').map((i) => i.message);
    const mismatch = issues.filter((i) => i.category === 'format-mismatch').map((i) => i.message);
    assert.deepStrictEqual(missing, ['Reference to a non-DITA resource has no @format: files/y.pdf']);
    assert.deepStrictEqual(mismatch, [
      'Non-DITA resource is referenced as a DITA topic: files/x.txt',
      'Map reference is not declared as format="ditamap": sub.ditamap',
      'Topic is referenced with format="ditamap": t.dita',
      'Non-DITA resource is referenced as a DITA topic: files/x.txt',
      'Non-DITA resource is referenced as a DITA map: files/x.txt',
    ]);
  });

  it('reports a URL without scope="external", in a map or in a topic, and an external reference without @format', async () => {
    const issues = await check(
      {
        'root.ditamap':
          '<map>' +
          '<topicref href="http://example.invalid/a.html"/>' +
          '<topicref href="http://example.invalid/b.html" scope="local"/>' +
          '<topicref href="http://example.invalid/c.html" scope="external" format="html"/>' +
          '<topicref href="http://example.invalid/d.html" scope="external"/>' +
          '<topicref href="t.dita"/>' +
          '</map>',
        't.dita':
          '<topic id="t"><title>T</title><body>' +
          '<p><xref href="http://example.invalid/pm.html"/></p>' +
          '<p><xref href="http://example.invalid/ok.html" scope="external" format="html"/></p>' +
          '</body></topic>',
      },
      { checkNonDita: true },
    );
    const ext = issues.filter((i) => i.category === 'external-reference');
    const missing = issues.filter((i) => i.category === 'format-missing');
    assert.strictEqual(ext.length, 3, JSON.stringify(issues, null, 2));
    assert.ok(ext.every((i) => i.severity === 'warning'));
    assert.ok(
      ext.some((i) => i.file.endsWith('t.dita')),
      'a topic xref is checked as well as a map topicref',
    );
    assert.deepStrictEqual(missing.map((i) => i.message), [
      'External reference has no @format: http://example.invalid/d.html',
    ]);
  });

  it('reports ignored content inside a map reference and missing navigation titles', async () => {
    const issues = await check(
      {
        'root.ditamap':
          '<map>' +
          '<mapref href="sub.ditamap" format="ditamap"><topicref href="t.dita"/></mapref>' +
          '<topichead><topicref href="t.dita"/></topichead>' +
          '<topicref href="http://example.invalid/a.html" scope="external" format="html"/>' +
          '</map>',
        'sub.ditamap': '<map/>',
        't.dita': topic('t'),
      },
      { checkNonDita: true },
    );
    const ignored = issues.filter((i) => i.category === 'ignored-mapref-content');
    const nav = issues.filter((i) => i.category === 'missing-navtitle');
    assert.strictEqual(ignored.length, 1, JSON.stringify(issues, null, 2));
    assert.strictEqual(ignored[0].severity, 'error');
    assert.deepStrictEqual(nav.map((i) => i.message), [
      'Topichead has no navigation title',
      'External reference has no navigation title: http://example.invalid/a.html',
    ]);
  });
});

describe('completeness: conref shape', () => {
  const lib = topic('t', '<p id="p1">1</p><p id="p2">2</p><p id="p3">3</p><section id="s"><p id="p4">4</p></section>');

  it('reports a conref without a fragment and a conrefend without conref', async () => {
    const issues = await check(
      {
        'root.ditamap': '<map><topicref href="a.dita"/><topicref href="b.dita"/></map>',
        'a.dita': topic('a', '<p conref="lib.dita"/>'),
        'b.dita': topic('b', '<p conrefend="lib.dita#t/p2"/>'),
        'lib.dita': lib,
      },
      { checkNonDita: true },
    );
    const msgs = issues.filter((i) => i.category === 'invalid-conref-form').map((i) => i.message);
    assert.ok(msgs.some((m) => m.includes('no "#id" part')), msgs.join('\n'));
    assert.ok(msgs.some((m) => m.includes('conrefend is used without conref')), msgs.join('\n'));
  });

  it('reports a backwards range and a range across parents, not a forward sibling range', async () => {
    const issues = await check(
      {
        'root.ditamap': '<map><topicref href="a.dita"/><topicref href="b.dita"/><topicref href="c.dita"/></map>',
        'a.dita': topic('a', '<p conref="lib.dita#t/p3" conrefend="lib.dita#t/p1"/>'),
        'b.dita': topic('b', '<p conref="lib.dita#t/p1" conrefend="lib.dita#t/p4"/>'),
        'c.dita': topic('c', '<p conref="lib.dita#t/p1" conrefend="lib.dita#t/p2"/>'),
        'lib.dita': lib,
      },
      { checkNonDita: true },
    );
    const asserts = issues.filter((i) => i.category === 'invalid-conref-form' && i.file.endsWith('a.dita'));
    assert.strictEqual(asserts.length, 1, JSON.stringify(issues, null, 2));
    assert.ok(asserts[0].message.includes('must come before'), asserts[0].message);
    const siblings = issues.filter((i) => i.category === 'invalid-conref-form' && i.file.endsWith('b.dita'));
    assert.strictEqual(siblings.length, 1, JSON.stringify(issues, null, 2));
    assert.ok(siblings[0].message.includes('sibling elements'), siblings[0].message);
  });

  it('reports -dita-use-conref-target only on an element that is not a content reference', async () => {
    const issues = await check(
      {
        'root.ditamap': '<map><keydef keys="k" href="lib.dita#t"/><topicref href="a.dita"/><topicref href="b.dita"/><topicref href="ok.dita"/></map>',
        'a.dita': topic('a', '<p><xref href="ok.dita" scope="-dita-use-conref-target">x</xref></p>'),
        'b.dita': topic('b', '<p><xref conref="lib.dita#t/p1" scope="-dita-use-conref-target"/><xref conkeyref="k/p2" scope="-dita-use-conref-target"/></p>'),
        'lib.dita': lib,
        'ok.dita': topic('ok'),
      },
      { checkNonDita: true },
    );
    const found = issues.filter((i) => i.category === 'invalid-conref-form');
    assert.strictEqual(found.length, 1, JSON.stringify(issues, null, 2));
    assert.ok(found[0].file.endsWith('a.dita') && found[0].message.includes('-dita-use-conref-target'));
  });
});

describe('completeness: id references', () => {
  const lib = topic('t', '<p id="p1">1</p><section id="s"><p id="p5">5</p></section>');

  it('reports a missing element id, a deeper id path and a trailing slash, and skips an empty topic id', async () => {
    const issues = await check(
      {
        'root.ditamap':
          '<map><topicref href="a.dita"/><topicref href="b.dita"/><topicref href="c.dita"/><topicref href="d.dita"/><topicref href="e.dita"/></map>',
        'a.dita': topic('a', '<p conref="lib.dita#t/p1"/>'),
        'b.dita': topic('b', '<p conref="lib.dita#t/nope"/>'),
        'c.dita': topic('c', '<p><xref href="lib.dita#t/s/p5">deep</xref></p>'),
        'd.dita': topic('d', '<p conref="lib.dita#t/"/>'),
        'e.dita': topic('e', '<p conref="lib.dita#/p1"/>'),
        'lib.dita': lib,
      },
      { checkNonDita: true },
    );
    const found = issues.filter((i) => i.category === 'invalid-id-reference');
    assert.strictEqual(found.length, 3, JSON.stringify(issues, null, 2));
    assert.ok(found.some((i) => i.message.includes('Referenced ID path "t/nope"')), JSON.stringify(found));
    assert.ok(found.some((i) => i.message.includes('Referenced ID path "t/s/p5"')), JSON.stringify(found));
    assert.ok(found.some((i) => i.message.includes('Bad ID reference')), JSON.stringify(found));
  });

  it('checks the element id a key appends to its key', async () => {
    const issues = await check(
      {
        'root.ditamap': '<map><keydef keys="k" href="lib.dita#t"/><topicref href="a.dita"/></map>',
        'a.dita': topic('a', '<p conkeyref="k/nope"/>'),
        'lib.dita': lib,
      },
      { checkNonDita: true },
    );
    const found = issues.filter((i) => i.category === 'invalid-id-reference');
    assert.strictEqual(found.length, 1, JSON.stringify(issues, null, 2));
    assert.ok(found[0].message.includes('"t/nope"'), found[0].message);
  });

  it('reports a topicref to an element id but not one to a topic id', async () => {
    const issues = await check(
      {
        'root.ditamap': '<map><topicref href="lib.dita#t/p1"/><topicref href="lib2.dita#t2"/></map>',
        'lib.dita': lib,
        'lib2.dita': topic('t2'),
      },
      { checkNonDita: true },
    );
    const found = issues.filter((i) => i.category === 'topicref-to-element');
    assert.strictEqual(found.length, 1, JSON.stringify(issues, null, 2));
    assert.ok(found[0].message.includes('t/p1'), found[0].message);
  });

  it('does not count a topic published only through an element-id topicref as in the map', async () => {
    const issues = await check(
      {
        'root.ditamap': '<map><topicref href="lib.dita#t/p1"/><topicref href="a.dita"/></map>',
        'a.dita': topic('a', '<p><xref href="lib.dita#t/p1">deep</xref></p>'),
        'lib.dita': lib,
      },
      { reportUnreferencedLinks: true },
    );
    const links = issues.filter((i) => i.category === 'unreferenced-link');
    assert.strictEqual(links.length, 1, JSON.stringify(issues, null, 2));
    assert.ok(links[0].file.endsWith('a.dita'));
  });
});

describe('completeness: links', () => {
  it('reports a link through a text-only key and a link with no target', async () => {
    const issues = await check(
      {
        'root.ditamap': '<map><keydef keys="k"/><topicref href="a.dita"/><topicref href="ok.dita"/></map>',
        'a.dita': topic('a', '<p><xref keyref="k">text</xref><xref>none</xref><xref href="ok.dita">ok</xref></p>'),
        'ok.dita': topic('ok'),
      },
      { checkNonDita: true },
    );
    assert.strictEqual(issues.filter((i) => i.category === 'link-key-without-target').length, 1, JSON.stringify(issues, null, 2));
    assert.strictEqual(issues.filter((i) => i.category === 'link-no-target').length, 1, JSON.stringify(issues, null, 2));
  });

  it('reports a cross reference to a resource-only topic, unless a normal reference publishes it too', async () => {
    const issues = await check(
      {
        'root.ditamap':
          '<map><topicref href="lib.dita" processing-role="resource-only"/>' +
          '<topicref href="pub.dita"/><topicref href="shared.dita" processing-role="resource-only" copy-to="shared-copy.dita"/>' +
          '<topicref href="shared.dita"/><topicref href="a.dita"/><topicref href="b.dita"/><topicref href="c.dita"/>' +
          '<keydef keys="kk" href="keyed.dita"/><keydef keys="kn" href="keynormal.dita" processing-role="normal"/>' +
          '<topicref href="d.dita"/><topicref href="e.dita"/></map>',
        'a.dita': topic('a', '<p><xref href="lib.dita">broken</xref></p>'),
        'b.dita': topic('b', '<p><xref href="pub.dita">ok</xref></p>'),
        'c.dita': topic('c', '<related-links><link href="shared.dita"/></related-links>'),
        'd.dita': topic('d', '<p><xref href="keyed.dita">broken</xref></p>'),
        'e.dita': topic('e', '<p><xref href="keynormal.dita">ok</xref></p>'),
        'lib.dita': topic('lib'),
        'pub.dita': topic('pub'),
        'shared.dita': topic('shared'),
        'keyed.dita': topic('keyed'),
        'keynormal.dita': topic('keynormal'),
      },
      { checkNonDita: true },
    );
    // A keydef publishes resource-only by DITA default (corpus 6: Oxygen files the
    // same warning for it), and only an explicit @processing-role="normal" publishes.
    const found = issues.filter((i) => i.category === 'resource-only-target');
    assert.strictEqual(found.length, 2, JSON.stringify(issues, null, 2));
    assert.deepStrictEqual(
      found.map((i) => i.file.replace(/\\/g, '/').split('/').pop()).sort(),
      ['a.dita', 'd.dita'],
      JSON.stringify(found, null, 2),
    );
  });
});

describe('completeness: duplicate element ids', () => {
  it('reports the later duplicate inside one topic, not the same id in a nested topic', async () => {
    const doc =
      '<topic id="a"><title>T</title><body><p id="dup">1</p><p id="dup">2</p></body>' +
      '<topic id="inner"><title>I</title><body><p id="dup">3</p></body></topic></topic>';
    const issues = await check(
      { 'root.ditamap': '<map><topicref href="a.dita"/></map>', 'a.dita': doc },
      { checkDuplicateTopicIds: true },
    );
    const found = issues.filter((i) => i.category === 'duplicate-element-id');
    assert.strictEqual(found.length, 1, JSON.stringify(issues, null, 2));
    assert.strictEqual(found[0].line, 1);
    assert.ok(found[0].related?.length === 1);
  });
});

describe('completeness: validation and DITAVAL', () => {
  it('reports XML errors with the right line, even when the DOCTYPE spans lines', async () => {
    const bad = '<?xml version="1.0"?>\n<!DOCTYPE topic [\n<!ENTITY x "y">\n]>\n<topic id="a">\n<title>T</title>\n<body><p>oops</body>\n</topic>';
    const issues = await check(
      { 'root.ditamap': '<map><topicref href="a.dita"/></map>', 'a.dita': bad },
      { batchValidate: true },
    );
    const v = issues.filter((i) => i.category === 'validation');
    assert.strictEqual(v.length, 1);
    assert.strictEqual(v[0].line, 7, JSON.stringify(v));
  });

  it('reports a topic with no id or title only when batch validation is on', async () => {
    const files = {
      'root.ditamap': '<map><topicref href="a.dita"/></map>',
      'a.dita': '<topic><body/></topic>',
    };
    const on = await check(files, { batchValidate: true });
    const off = await check(files, { batchValidate: false });
    assert.ok(on.some((i) => /no id attribute/.test(i.message)) && on.some((i) => /no <title>/.test(i.message)));
    assert.strictEqual(off.filter((i) => i.category === 'validation').length, 0);
  });

  it('a DITAVAL exclude keeps profiled-out branches from being crawled', async () => {
    const files = {
      'root.ditamap': '<map><topicref href="a.dita"/><topicref href="gone.dita" audience="novice"/></map>',
      'a.dita': topic('a', '<p audience="novice"><image href="missing.png"/></p>'),
    };
    const host = makeHost(files);
    const filter = parseDitaval('<val><prop att="audience" val="novice" action="exclude"/></val>');
    const crawl = await crawlMaps([P('root.ditamap')], host, { filter });
    const issues = await runChecks(crawl, { ...NONE, checkNonDita: true }, { host });
    assert.strictEqual(issues.length, 0, JSON.stringify(issues));
  });
});

describe('ditaval', () => {
  it('excludes only when every value is excluded, honouring the attribute default', () => {
    const f = parseDitaval('<val><prop att="audience" action="exclude"/><prop att="audience" val="admin" action="include"/></val>');
    assert.strictEqual(f.excludes({ audience: 'user' }), true);
    assert.strictEqual(f.excludes({ audience: 'admin' }), false);
    assert.strictEqual(f.excludes({ audience: 'admin user' }), false);
    assert.strictEqual(f.excludes({ platform: 'x' }), false);
  });
  it('reads values from the props generalization syntax', () => {
    const f = parseDitaval('<val><prop att="deliveryTarget" val="pdf" action="exclude"/></val>');
    assert.strictEqual(f.excludes({ props: 'deliveryTarget(pdf)' }), true);
    assert.strictEqual(f.excludes({ props: 'deliveryTarget(html)' }), false);
  });
});

describe('completeness: settings mapping', () => {
  it('the default enabled list reproduces Oxygen defaults', () => {
    const o = optionsFromSettings(undefined, undefined);
    assert.deepStrictEqual(o, DEFAULT_COMPLETENESS_OPTIONS);
    assert.deepStrictEqual(normalizeEnabled(DEFAULT_ENABLED_CHECKS), DEFAULT_ENABLED_CHECKS);
  });
  it('turns listed ids on and everything else off; ignores unknown ids', () => {
    const o = optionsFromSettings(['reportDuplicateKeys', 'nonsense'], []);
    assert.strictEqual(o.reportDuplicateKeys, true);
    assert.strictEqual(o.batchValidate, false);
    assert.strictEqual(o.reportTableProblems, false);
  });
  it('remote checking needs non-DITA checking', () => {
    assert.strictEqual(optionsFromSettings(['includeRemote'], []).includeRemote, false);
    assert.strictEqual(optionsFromSettings(['checkNonDita', 'includeRemote'], []).includeRemote, true);
  });
  it('DITAVAL files count only while useDitaval is enabled', () => {
    assert.deepStrictEqual(optionsFromSettings(['batchValidate'], ['a.ditaval']).ditavalFiles, []);
    assert.deepStrictEqual(optionsFromSettings(['useDitaval'], ['a.ditaval']).ditavalFiles, ['a.ditaval']);
  });
  it('every check id is a real option (or useDitaval)', () => {
    for (const id of CHECK_IDS) assert.ok(id === 'useDitaval' || id in DEFAULT_COMPLETENESS_OPTIONS, id);
  });
  it('normalizeEnabled keeps list order and drops unknown ids', () => {
    assert.deepStrictEqual(normalizeEnabled(['reportTableProblems', 'x', 'batchValidate']), ['batchValidate', 'reportTableProblems']);
  });
  it('stores DITAVAL paths relative to the map folder when inside it', () => {
    assert.strictEqual(toStoredPath(P('docs'), P('docs/filters/a.ditaval')), 'filters/a.ditaval');
    assert.strictEqual(toStoredPath(P('docs'), P('other/a.ditaval')), P('other/a.ditaval'));
    assert.strictEqual(resolveStoredPath(P('docs'), 'filters/a.ditaval'), P('docs/filters/a.ditaval'));
    assert.strictEqual(resolveStoredPath(P('docs'), P('other/a.ditaval')), P('other/a.ditaval'));
  });
});

describe('completeness: batch 3 profiling values, filtered content and filter file', () => {
  // These probes mirror corpus 4, where the committed Oxygen report is the only
  // evidence for the severity and the finding site (see its README).
  const prefs: ProfilingPreferences = {
    attributes: { audience: ['expert', 'novice'], platform: ['linux', 'windows'], props: ['novice'] },
    singleValue: [],
  };

  // i-prof-empty-pos (audience=""), i-prof-empty-edge (whitespace only) and
  // i-prof-single-edge (platform=""): each drew one dmv.prof.attr.empty.value warning.
  it('reports a profiling attribute whose value is empty or whitespace only', async () => {
    const issues = await checkWith(
      {
        'root.ditamap': '<map><topicref href="a.dita"/><topicref href="b.dita" product=""/></map>',
        'a.dita': topic('a', '<p audience="">x</p>'),
        'b.dita': topic('b', '<p platform="   ">x</p>'),
      },
      { identifyProfilingConflicts: true },
    );
    const found = issues.filter((i) => i.category === 'empty-profiling-value');
    assert.strictEqual(found.length, 3, JSON.stringify(issues.map((i) => [i.category, i.file, i.line])));
    assert.ok(found.every((i) => i.severity === 'warning'), found.map((i) => i.severity).join(','));
    assert.ok(found.some((i) => i.message.includes('@audience')), found.map((i) => i.message).join('\n'));
    const inMap = found.filter((i) => i.file === P('root.ditamap'));
    assert.strictEqual(inMap.length, 1, 'a map element with an empty value is reported too');
    assert.ok(inMap[0].message.includes('@product'), inMap[0].message);
  });

  it('says nothing about a profiling attribute that carries values', async () => {
    const issues = await checkWith(
      {
        'root.ditamap': '<map><topicref href="a.dita" product="desktop"/></map>',
        'a.dita': topic('a', '<p audience="novice">x</p>'),
      },
      { identifyProfilingConflicts: true },
    );
    assert.deepStrictEqual(issues.filter((i) => i.category === 'empty-profiling-value'), []);
  });

  // i-prof-empty-edge's second paragraph: dmv.prof.group.val.prefs.undef names the
  // group itself ("audience()"), so the group text has to reach the preference comparison.
  it('compares an empty condition group with the preferences as the group text', async () => {
    const issues = await checkWith(
      {
        'root.ditamap': '<map><topicref href="a.dita"/></map>',
        'a.dita': topic('a', '<p props="audience()">x</p>'),
      },
      { reportProfilingPreferences: true },
      { preferences: prefs },
    );
    const found = issues.filter((i) => i.category === 'profiling-preference');
    assert.strictEqual(found.length, 1, JSON.stringify(issues.map((i) => [i.category, i.message])));
    assert.ok(found[0].message.includes('audience()'), found[0].message);
    assert.deepStrictEqual(issues.filter((i) => i.category === 'empty-profiling-value'), [], 'an empty group is not an empty attribute value');
  });

  // i-prof-group-neg produced nothing (novice is configured), i-prof-group-pos and
  // i-prof-group-edge drew dmv.prof.group.val.prefs.undef for the member value.
  it('compares a group that carries values by those values', async () => {
    const issues = await checkWith(
      {
        'root.ditamap': '<map><topicref href="a.dita"/></map>',
        'a.dita': topic('a', '<p props="audience(novice)">x</p>'),
      },
      { reportProfilingPreferences: true },
      { preferences: prefs },
    );
    assert.deepStrictEqual(issues.filter((i) => i.category === 'profiling-preference'), []);
    const other = await checkWith(
      {
        'root.ditamap': '<map><topicref href="a.dita"/></map>',
        'a.dita': topic('a', '<p props="audience(nobody)">x</p>'),
      },
      { reportProfilingPreferences: true },
      { preferences: prefs },
    );
    const found = other.filter((i) => i.category === 'profiling-preference');
    assert.strictEqual(found.length, 1, JSON.stringify(other.map((i) => [i.category, i.message])));
    assert.ok(found[0].message.includes('nobody'), found[0].message);
  });

  const dropExpert = '<val><prop att="audience" val="expert" action="exclude"/></val>';

  // k-conref-filtered-pos: dmv.ref.filtered (error) on the referencing element, with
  // the path Oxygen names being the topic id and the element id of the dropped target.
  const intoFiltered = {
    'root.ditamap': '<map><topicref href="src.dita"/></map>',
    'src.dita': topic('src', '<p conref="tgt.dita#tgt/gone"/>'),
    'tgt.dita': topic('tgt', '<p id="kept" audience="novice">k</p><p id="gone" audience="expert">g</p>'),
  };

  it('reports a conref whose target element the filter excludes', async () => {
    const issues = await checkWith(intoFiltered, { checkNonDita: true }, { filterXml: dropExpert });
    const found = issues.filter((i) => i.category === 'filtered-reference');
    assert.strictEqual(found.length, 1, JSON.stringify(issues.map((i) => [i.category, i.file, i.line])));
    assert.strictEqual(found[0].severity, 'error');
    assert.strictEqual(found[0].file, P('src.dita'));
    assert.ok(found[0].message.includes('tgt/gone'), found[0].message);
  });

  // k-conref-filtered-edge: the range starts at a kept element and ends at an
  // excluded one; the report carries one finding, naming the excluded end.
  it('reports the excluded end of a conref range', async () => {
    const files = {
      ...intoFiltered,
      'src.dita': topic('src', '<p conref="tgt.dita#tgt/kept" conrefend="tgt.dita#tgt/gone"/>'),
    };
    const issues = await checkWith(files, { checkNonDita: true }, { filterXml: dropExpert });
    const found = issues.filter((i) => i.category === 'filtered-reference');
    assert.strictEqual(found.length, 1, JSON.stringify(issues.map((i) => [i.category, i.message])));
    assert.ok(found[0].message.includes('tgt/gone'), found[0].message);
  });

  it('says nothing when the filter keeps the referenced element', async () => {
    const files = {
      ...intoFiltered,
      'src.dita': topic('src', '<p conref="tgt.dita#tgt/kept"/>'),
    };
    const issues = await checkWith(files, { checkNonDita: true }, { filterXml: dropExpert });
    assert.deepStrictEqual(issues.filter((i) => i.category === 'filtered-reference'), []);
  });

  it('says nothing about filtered content when no filter runs', async () => {
    const issues = await checkWith(intoFiltered, { checkNonDita: true });
    assert.deepStrictEqual(issues.filter((i) => i.category === 'filtered-reference'), []);
  });

  // k-conref-ignored-pos: dmv.ref.filtered.conref (warning) for a link into the own
  // content of an element that carries a conref, which resolution replaces.
  const intoReplaced = (target: string) => ({
    'root.ditamap': '<map><topicref href="host.dita"/><topicref href="source.dita"/></map>',
    'host.dita':
      `<topic id="h"><title>T</title><body>` +
      `<div id="holder" conref="source.dita#s/source"><p id="inside">x</p></div>` +
      `<p><xref href="#h/${target}">l</xref></p></body></topic>`,
    'source.dita': topic('s', '<div id="source"><p>the content that takes its place</p></div>'),
  });

  it('reports a reference into content that a conref replaces', async () => {
    const issues = await checkWith(intoReplaced('inside'), { checkNonDita: true });
    const found = issues.filter((i) => i.category === 'filtered-reference');
    assert.strictEqual(found.length, 1, JSON.stringify(issues.map((i) => [i.category, i.message])));
    assert.strictEqual(found[0].severity, 'warning');
    assert.ok(found[0].message.includes('h/inside'), found[0].message);
  });

  // k-conref-ignored-edge (the conref element itself survives) and
  // k-conref-ignored-neg (no conref at all) both produced nothing.
  it('says nothing when the reference names the element that carries the conref', async () => {
    const issues = await checkWith(intoReplaced('holder'), { checkNonDita: true });
    assert.deepStrictEqual(issues.filter((i) => i.category === 'filtered-reference'), []);
  });

  it('says nothing about content no conref replaces', async () => {
    const files = {
      ...intoReplaced('inside'),
      'host.dita':
        '<topic id="h"><title>T</title><body>' +
        '<div id="holder"><p id="inside">x</p></div>' +
        '<p><xref href="#h/inside">l</xref></p></body></topic>',
    };
    const issues = await checkWith(files, { checkNonDita: true });
    assert.deepStrictEqual(issues.filter((i) => i.category === 'filtered-reference'), []);
  });

  // The filter file of corpus 4 is itself the dmv.dup.cond.filter probe: the same
  // condition twice, and the same condition with two actions. Both are errors the
  // report puts on the filter file, with no problem id.
  const repeatedFilter = [
    '<?xml version="1.0"?>',
    '<val>',
    '  <prop att="audience" val="expert" action="exclude"/>',
    '  <prop att="audience" val="expert" action="exclude"/>',
    '  <prop att="platform" val="solaris" action="exclude"/>',
    '  <prop att="platform" val="solaris" action="include"/>',
    '</val>',
  ].join('\n');

  it('reports a condition the filter file repeats', async () => {
    const issues = await checkWith(
      {
        'root.ditamap': '<map><topicref href="a.dita"/></map>',
        'a.dita': topic('a', '<p>x</p>'),
        'f.ditaval': repeatedFilter,
      },
      { batchValidate: true },
      { filterXml: repeatedFilter, ditavalFiles: ['f.ditaval'] },
    );
    const found = issues.filter((i) => i.category === 'duplicate-filter-condition');
    assert.strictEqual(found.length, 2, JSON.stringify(issues.map((i) => [i.category, i.message])));
    assert.ok(found.every((i) => i.severity === 'error'));
    assert.deepStrictEqual(found.map((i) => i.line), [4, 6]);
    const text = found.map((i) => i.message).join('\n');
    assert.ok(text.includes('audience=expert'), text);
    assert.ok(text.includes('platform=solaris'), text);
  });

  it('says nothing about a filter file that states each condition once', async () => {
    const once = '<val><prop att="audience" val="expert" action="exclude"/></val>';
    const issues = await checkWith(
      {
        'root.ditamap': '<map><topicref href="a.dita"/></map>',
        'a.dita': topic('a', '<p>x</p>'),
        'f.ditaval': once,
      },
      { batchValidate: true },
      { filterXml: once, ditavalFiles: ['f.ditaval'] },
    );
    assert.deepStrictEqual(issues.filter((i) => i.category === 'duplicate-filter-condition'), []);
  });

  it('stays silent about a filter file it cannot read, rather than failing the run', async () => {
    const issues = await checkWith(
      {
        'root.ditamap': '<map><topicref href="a.dita"/></map>',
        'a.dita': topic('a', '<p>x</p>'),
      },
      { batchValidate: true },
      { ditavalFiles: ['gone.ditaval'] },
    );
    assert.deepStrictEqual(issues.filter((i) => i.category === 'duplicate-filter-condition'), []);
  });
});
