import * as assert from 'assert';
import { resolve, join, basename } from 'path';
import {
  globToRegExp,
  splitPatterns,
  listFilteredFiles,
  normalizeFilters,
  extensionOf,
  summarizeExtensions,
  defaultCheckedExtensions,
  rememberExtensions,
  referencedResourceFolders,
  mergeRoots,
  filesUnder,
  folderStats,
  suggestFolders,
  findUnreferencedResources,
  DEFAULT_UNREFERENCED_FILTERS,
  ListHost,
} from '../../editor/unreferencedResources';
import { CrawlHost, crawlMaps } from '../../editor/mapCrawl';

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

describe('unreferenced: filter settings', () => {
  it('fills missing values with the defaults and treats a blank include as everything', () => {
    assert.deepStrictEqual(normalizeFilters(undefined), DEFAULT_UNREFERENCED_FILTERS);
    assert.strictEqual(normalizeFilters({ includeFiles: '  ' }).includeFiles, '*');
  });
  it('keeps an exclusion list the user emptied out', () => {
    const f = normalizeFilters({ excludeFiles: '', excludeFolders: '' });
    assert.strictEqual(f.excludeFiles, '');
    assert.strictEqual(f.excludeFolders, '');
  });
  it('keeps custom values', () => {
    assert.strictEqual(normalizeFilters({ includeFiles: '*.png' }).includeFiles, '*.png');
  });
});

describe('unreferenced: choosing where to look', () => {
  const rel = (p: string) => p.replace(/\\/g, '/').replace(/.*\/proj\//, '');

  it('extensionOf: lower-case, no dot, dotfiles have none', () => {
    assert.strictEqual(extensionOf('/a/B.PNG'), 'png');
    assert.strictEqual(extensionOf('/a/archive.tar.gz'), 'gz');
    assert.strictEqual(extensionOf('/a/.gitignore'), '');
    assert.strictEqual(extensionOf('/a/README'), '');
  });

  it('summarizeExtensions sorts by count, then name', () => {
    assert.deepStrictEqual(summarizeExtensions(['/a.png', '/b.png', '/c.py', '/d.css', '/e']), [
      { ext: 'png', count: 2 },
      { ext: '', count: 1 },
      { ext: 'css', count: 1 },
      { ext: 'py', count: 1 },
    ]);
  });

  it('defaults to resource-like extensions; remembered choices win either way', () => {
    const exts = ['png', 'py', 'css', 'dita'];
    assert.deepStrictEqual([...defaultCheckedExtensions(exts)].sort(), ['dita', 'png']);
    const remembered = { checked: ['py'], unchecked: ['dita'] };
    assert.deepStrictEqual([...defaultCheckedExtensions(exts, remembered)].sort(), ['png', 'py']);
  });

  it('rememberExtensions keeps what it was told about extensions not shown this time', () => {
    const r = rememberExtensions({ checked: ['png'], unchecked: ['py'] }, ['css', 'png'], ['css']);
    assert.deepStrictEqual([...r.checked].sort(), ['css']);
    assert.deepStrictEqual([...r.unchecked].sort(), ['png', 'py']);
  });

  it('referencedResourceFolders: folders of images/media the maps use, not DITA files or URLs', async () => {
    const crawl = await crawlMaps(
      [R('root.ditamap')],
      fakeFs({
        'root.ditamap': '<map><topicref href="a.dita"/><keydef keys="k" href="art/logo.svg" format="svg"/></map>',
        'a.dita': '<topic id="a"><title>A</title><body><image href="img/x.png"/><image href="https://e.com/y.png"/><xref href="b.dita"/></body></topic>',
        'b.dita': '<topic id="b"><title>B</title><body/></topic>',
      }).host,
    );
    assert.deepStrictEqual(referencedResourceFolders(crawl).map(rel), ['art', 'img']);
  });

  it('mergeRoots drops folders nested in another and duplicates', () => {
    assert.deepStrictEqual(mergeRoots([R('a/b'), R('a'), R('a'), R('c')]).map(rel), ['a', 'c']);
  });

  it('filesUnder keeps files inside any of the folders, recursively', () => {
    const files = [R('img/a.png'), R('img/sub/b.png'), R('css/x.css'), R('imgx/y.png')];
    assert.deepStrictEqual(filesUnder(files, [R('img')]).map(rel), ['img/a.png', 'img/sub/b.png']);
  });

  it('folderStats counts recursively per folder down to the depth limit', () => {
    const all = [R('img/a.png'), R('img/sub/b.png'), R('img/sub/deep/c.png'), R('css/x.css'), R('top.dita')];
    const unref = [R('img/a.png'), R('img/sub/deep/c.png'), R('css/x.css')];
    const stats = folderStats(all, unref, [R('.')], 2);
    const by = Object.fromEntries(stats.map((s) => [rel(s.dir) || '.', [s.total, s.unreferenced]]));
    assert.deepStrictEqual(by[rel(R('.'))], [5, 3]);
    assert.deepStrictEqual(by['img'], [3, 2]);
    assert.deepStrictEqual(by['img/sub'], [2, 1]);
    assert.strictEqual(by['img/sub/deep'], undefined); // depth 3 > limit 2
    assert.deepStrictEqual(by['css'], [1, 1]);
  });

  it('suggestFolders: resource folders when there are any (nearest listed ancestor if deeper), else the map folders', () => {
    const stats = [
      { dir: R('.'), total: 9, unreferenced: 4 },
      { dir: R('img'), total: 5, unreferenced: 2 },
      { dir: R('css'), total: 2, unreferenced: 2 },
    ];
    assert.deepStrictEqual(suggestFolders(stats, [R('img'), R('img/icons/deep')], [R('.')]).map(rel), ['img']);
    assert.deepStrictEqual(suggestFolders(stats, [], [R('.')]).map(rel), [rel(R('.'))]);
  });
});
