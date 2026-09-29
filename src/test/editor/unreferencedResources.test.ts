import * as assert from 'assert';
import { resolve, join, basename } from 'path';
import {
  globToRegExp,
  splitPatterns,
  listFilteredFiles,
  findUnreferencedResources,
  DEFAULT_UNREFERENCED_FILTERS,
  ListHost,
} from '../../editor/unreferencedResources';
import { CrawlHost } from '../../editor/mapCrawl';

const R = (p: string) => resolve('/proj', p);

function fakeFs(files: Record<string, string>): { host: CrawlHost; list: ListHost } {
  const abs = new Map(Object.entries(files).map(([k, v]) => [R(k), v]));
  const host: CrawlHost = {
    platform: 'linux',
    readFile: async (p) => {
      const v = abs.get(p);
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    exists: async (p) => abs.has(p),
  };
  const list: ListHost = {
    readdir: async (dir) => {
      const seen = new Map<string, boolean>();
      const prefix = dir.replace(/\\/g, '/').replace(/\/$/, '') + '/';
      for (const p of abs.keys()) {
        const n = p.replace(/\\/g, '/');
        if (!n.startsWith(prefix)) continue;
        const rest = n.slice(prefix.length);
        const slash = rest.indexOf('/');
        if (slash < 0) seen.set(rest, false);
        else seen.set(rest.slice(0, slash), true);
      }
      return [...seen].map(([name, isDir]) => ({ name, isDir }));
    },
  };
  return { host, list };
}

describe('unreferenced: patterns', () => {
  it('splits on commas, semicolons and newlines', () => {
    assert.deepStrictEqual(splitPatterns(' a, b;c\n d '), ['a', 'b', 'c', 'd']);
  });
  it('matches * and ? wildcards case-insensitively, whole name only', () => {
    assert.ok(globToRegExp('*.png').test('Logo.PNG'));
    assert.ok(!globToRegExp('*.png').test('logo.png.bak'));
    assert.ok(globToRegExp('img?.gif').test('img1.gif'));
    assert.ok(!globToRegExp('a.b').test('axb'));
  });
});

describe('unreferenced: listing', () => {
  const files = {
    'img/a.png': '', 'img/b.png': '', 'img/notes.txt': '', 'temp/x.png': '', '.git/HEAD': '', '.DS_Store': '',
    'deep/sub/c.png': '', 'root.ditamap': '<map/>', 'f.ditaval': '<val/>',
  };
  it('applies the default filters: skips excluded folders and files', async () => {
    const { list } = fakeFs(files);
    const got = (await listFilteredFiles(R('.'), list, DEFAULT_UNREFERENCED_FILTERS)).map((p) => basename(p)).sort();
    assert.deepStrictEqual(got, ['a.png', 'b.png', 'c.png', 'notes.txt', 'root.ditamap']);
  });
  it('honours an include pattern', async () => {
    const { list } = fakeFs(files);
    const got = await listFilteredFiles(R('.'), list, { ...DEFAULT_UNREFERENCED_FILTERS, includeFiles: '*.png,*.gif' });
    assert.deepStrictEqual(got.map((p) => basename(p)).sort(), ['a.png', 'b.png', 'c.png']);
  });
  it('a folder pattern with a slash matches the relative path', async () => {
    const { list } = fakeFs(files);
    const got = await listFilteredFiles(R('.'), list, { ...DEFAULT_UNREFERENCED_FILTERS, excludeFolders: 'deep/sub' });
    assert.ok(!got.some((p) => p.endsWith('c.png')));
    assert.ok(got.some((p) => p.endsWith('a.png')));
  });
});

describe('unreferenced: finding', () => {
  const topic = (body = '') => `<topic id="t"><title>T</title><body>${body}</body></topic>`;
  const files = {
    'root.ditamap': '<map><topicref href="a.dita"/><keydef keys="logo" href="img/logo.png" format="png"/></map>',
    'a.dita': topic('<image href="img/used.png"/><xref href="b.dita"/>'),
    'b.dita': topic('<image href="img/from-linked-topic.png"/>'),
    'orphan.dita': topic('<image href="img/only-orphan.png"/>'),
    'img/used.png': '', 'img/logo.png': '', 'img/unused.png': '', 'img/from-linked-topic.png': '', 'img/only-orphan.png': '',
  };
  it('reports files no map-reachable reference points at', async () => {
    const { host, list } = fakeFs(files);
    const res = await findUnreferencedResources(
      { maps: [R('root.ditamap')], folders: [R('.')], filters: DEFAULT_UNREFERENCED_FILTERS },
      host,
      list,
    );
    const names = res.unreferenced.map((p) => p.replace(/\\/g, '/').replace(/.*\/proj\//, ''));
    assert.deepStrictEqual(names, ['img/only-orphan.png', 'img/unused.png', 'orphan.dita']);
  });
  it('an image referenced only via a keydef href counts as referenced', async () => {
    const { host, list } = fakeFs(files);
    const res = await findUnreferencedResources(
      { maps: [R('root.ditamap')], folders: [R('img')], filters: DEFAULT_UNREFERENCED_FILTERS },
      host,
      list,
    );
    assert.ok(!res.unreferenced.some((p) => p.endsWith('logo.png')));
  });
  it('overlapping folders do not double-report', async () => {
    const { host, list } = fakeFs(files);
    const res = await findUnreferencedResources(
      { maps: [R('root.ditamap')], folders: [R('.'), R('img')], filters: DEFAULT_UNREFERENCED_FILTERS },
      host,
      list,
    );
    assert.strictEqual(res.unreferenced.filter((p) => p.endsWith('unused.png')).length, 1);
  });
  it('several maps: a file referenced from any of them is referenced', async () => {
    const { host, list } = fakeFs({ ...files, 'second.ditamap': '<map><topicref href="orphan.dita"/></map>' });
    const res = await findUnreferencedResources(
      { maps: [R('root.ditamap'), R('second.ditamap')], folders: [R('.')], filters: DEFAULT_UNREFERENCED_FILTERS },
      host,
      list,
    );
    const names = res.unreferenced.map((p) => join(p).replace(/\\/g, '/').replace(/.*\/proj\//, ''));
    assert.deepStrictEqual(names, ['img/unused.png']);
  });
});
