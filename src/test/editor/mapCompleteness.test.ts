import * as assert from 'assert';
import { resolve } from 'path';
import { crawlMaps, CrawlHost } from '../../editor/mapCrawl';
import {
  runChecks,
  DEFAULT_COMPLETENESS_OPTIONS,
  DEFAULT_ENABLED_CHECKS,
  CHECK_IDS,
  CompletenessOptions,
  Issue,
  optionsFromSettings,
  normalizeEnabled,
  toStoredPath,
  resolveStoredPath,
} from '../../editor/mapChecks';
import { parseDitaval } from '../../editor/ditaval';

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

async function check(files: Record<string, string>, opts: Partial<CompletenessOptions>, root = 'root.ditamap'): Promise<Issue[]> {
  const host = makeHost(files);
  const crawl = await crawlMaps([P(root)], host);
  return runChecks(crawl, { ...NONE, ...opts }, { host });
}

const topic = (id: string, body = '') =>
  `<?xml version="1.0"?><topic id="${id}"><title>T</title><body>${body}</body></topic>`;

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
});

describe('completeness: ids and keys', () => {
  it('reports duplicate topic ids across files, with the first as related', async () => {
    const issues = await check(
      {
        'root.ditamap': '<map><topicref href="a.dita"/><topicref href="b.dita"/></map>',
        'a.dita': topic('same'),
        'b.dita': topic('same'),
      },
      { checkDuplicateTopicIds: true },
    );
    const dup = issues.filter((i) => i.category === 'duplicate-id');
    assert.strictEqual(dup.length, 1);
    assert.ok(dup[0].file.endsWith('b.dita'));
    assert.ok(dup[0].related![0].file.endsWith('a.dita'));
  });

  it('duplicate keys: reports same-scope duplicates, not the same key in a key scope (Oxygen doc example)', async () => {
    const issues = await check(
      {
        'root.ditamap':
          '<map><topicref href="t2.dita" keys="k2"/><topicgroup keyscope="ks"><topicref href="t2.dita" keys="k2"/></topicgroup><topicref href="t2.dita" keys="dup"/><topicref href="t2.dita" keys="dup"/></map>',
        't2.dita': topic('t2'),
      },
      { reportDuplicateKeys: true },
    );
    const dup = issues.filter((i) => i.category === 'duplicate-key');
    assert.strictEqual(dup.length, 1);
    assert.ok(dup[0].message.includes('"dup"'));
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

  it('flags a topic whose values conflict with its topicref', async () => {
    const issues = await check(
      {
        'root.ditamap': '<map><topicref href="a.dita" platform="linux"/></map>',
        'a.dita': topic('a', '<p platform="windows">x</p>'),
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
