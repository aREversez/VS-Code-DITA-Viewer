import * as assert from 'assert';
import { resolve } from 'path';
import { crawlMaps, scanXml, CrawlHost } from '../../editor/mapCrawl';

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

const topic = (body = '') => `<topic id="t"><title>T</title><body>${body}</body></topic>`;

describe('mapCrawl: references', () => {
  it('follows topicrefs, submaps, and the references inside reached topics', async () => {
    const crawl = await crawlMaps(
      [P('root.ditamap')],
      makeHost({
        'root.ditamap': '<map><topicref href="a.dita"/><mapref href="sub/sub.ditamap"/></map>',
        'a.dita': topic('<image href="img/x.png"/><xref href="b.dita"/>'),
        'b.dita': topic('<p conref="c.dita#c/p1"/>'),
        'c.dita': topic(),
        'sub/sub.ditamap': '<map><topicref href="s.dita"/></map>',
        'sub/s.dita': topic(),
      }),
    );
    const targets = crawl.refs.map((r) => r.target).sort();
    assert.ok(targets.includes(P('img/x.png')));
    assert.strictEqual(crawl.maps.size, 2);
    // Normalize separators before stripping the root: on Windows, resolve()
    // yields H:\proj\a.dita for a "/proj" root, which the POSIX-only pattern
    // used to leave unstripped.
    const rel = (p: string) => p.split('\\').join('/').replace(/.*\/proj\//, '');
    assert.deepStrictEqual([...crawl.topics].map(rel).sort(), ['a.dita', 'b.dita', 'c.dita', 'sub/s.dita']);
  });

  it('records keydef targets, ignores URLs and external scope, and decodes escaped paths', async () => {
    const crawl = await crawlMaps(
      [P('root.ditamap')],
      makeHost({
        'root.ditamap':
          '<map><keydef keys="logo" href="img/logo.png" format="png"/><topicref href="http://example.com/x.dita" scope="external"/><topicref href="my%20topic.dita"/></map>',
        'my topic.dita': topic('<image href="https://example.com/a.png"/>'),
      }),
    );
    assert.strictEqual(crawl.keyDefs[0].target, P('img/logo.png'));
    assert.ok(crawl.refs.filter((r) => r.remote).length >= 2);
    assert.ok(crawl.topics.has(P('my topic.dita')));
  });

  it('survives cycles between maps', async () => {
    const crawl = await crawlMaps(
      [P('a.ditamap')],
      makeHost({
        'a.ditamap': '<map><mapref href="b.ditamap"/></map>',
        'b.ditamap': '<map><mapref href="a.ditamap"/></map>',
      }),
    );
    assert.strictEqual(crawl.maps.size, 2);
  });

  it('a missing topic is a broken reference, not a file problem; an unparsable one is a file problem', async () => {
    const crawl = await crawlMaps(
      [P('root.ditamap')],
      makeHost({
        'root.ditamap': '<map><topicref href="gone.dita"/><topicref href="bad.dita"/></map>',
        'bad.dita': '<topic id="b"><title>x</topic>',
      }),
    );
    assert.strictEqual(crawl.fileIssues.length, 1);
    assert.ok(crawl.fileIssues[0].file.endsWith('bad.dita'));
  });

  it('an unreadable root map is reported', async () => {
    const crawl = await crawlMaps([P('nope.ditamap')], makeHost({}));
    assert.strictEqual(crawl.fileIssues.length, 1);
  });

  it('stops when the host says cancelled', async () => {
    const host = makeHost({ 'root.ditamap': '<map><topicref href="a.dita"/></map>', 'a.dita': topic() });
    let calls = 0;
    host.cancelled = () => ++calls > 1;
    const crawl = await crawlMaps([P('root.ditamap')], host);
    assert.strictEqual(crawl.cancelled, true);
  });
});

describe('mapCrawl: scanXml', () => {
  it('reports the line of an XML error, even when the DOCTYPE spans lines', () => {
    const bad = '<?xml version="1.0"?>\n<!DOCTYPE topic [\n<!ENTITY x "y">\n]>\n<topic id="a">\n<title>T</title>\n<body><p>oops</body>\n</topic>';
    assert.strictEqual(scanXml(bad).error?.line, 7);
  });
});
