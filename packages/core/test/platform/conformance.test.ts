import * as assert from 'assert';
import * as nodeFs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createEngine, type Engine } from '../../src/engine';
import { nodePlatform } from '../../src/node/nodePlatform';
import { parseDitaval, type ProfileFilter } from '../../src/profiling';
import { posixPath } from '../../src/posixPath';
import { loadDirIntoMemory } from '../helpers/loadDirIntoMemory';
import { stable } from '../helpers/stable';

// The Node platform and the in-memory platform must produce the same output for
// the same files: this is what lets a browser host trust that it renders what
// the extension renders. It covers every file under test-dita-file/, loaded
// into memory at its own absolute path so rendered paths match byte for byte.
// POSIX only (the memory platform has no drive letters).
const fixtureRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', 'test-dita-file');

const describeIfPosix = process.platform === 'win32' ? describe.skip : describe;

describeIfPosix('Node and memory platforms agree on test-dita-file', function () {
  this.timeout(180000);
  const { fs, files } = loadDirIntoMemory(fixtureRoot);
  const onNode: Engine = createEngine(nodePlatform);
  const onMemory: Engine = createEngine({ fs, path: posixPath });

  // A render that throws must throw the same way on both, so each result is
  // either { value } or { error }.
  const outcome = (run: (e: Engine) => unknown, e: Engine): string => {
    try {
      return stable({ value: run(e) });
    } catch (err) {
      return JSON.stringify({ error: (err as Error).message });
    }
  };
  let compared = 0;
  let threw = 0;
  const same = (what: string, run: (e: Engine) => unknown): void => {
    const a = outcome(run, onMemory);
    const b = outcome(run, onNode);
    assert.strictEqual(a, b, what);
    compared++;
    if (b.startsWith('{"error"')) threw++;
  };
  const read = (f: string): string => fs.readText(f);

  const topics = files.filter((f) => /\.dita$/i.test(f));
  const maps = files.filter((f) => /\.ditamap$/i.test(f));

  // The a-case probes reference 'ok.dita' with the wrong capitalization on
  // purpose, and whether the reference then resolves is the host disk's case
  // sensitivity, not a platform difference: Node's fs finds 'Ok.dita' on the
  // case-insensitive disks of Windows and macOS runners, the memory file
  // system is exact and never does. On such a disk those diagnostics are not
  // part of the comparison (the probes' own comments say the same). Everything
  // else in the corpus matches its target exactly.
  const caseInsensitiveDisk = nodeFs.existsSync(path.join(fixtureRoot, 'completeness-corpus-2', 'topics', 'Ok.dita'));
  const aCaseProbes = /\/topics\/a-case-(edge|pos)\.dita$/;
  const filters = {
    none: undefined,
    hidden: { hidden: new Set(['audience:novice', 'product:b', 'platform:linux', 'otherprops:x']) },
    ditaval: { ditaval: parseDitaval('<val><prop att="audience" val="expert" action="exclude"/><prop att="product" val="a" action="flag"/><prop att="platform" action="exclude"/></val>') },
  };

  it('has a real corpus to compare', () => {
    assert.ok(topics.length >= 100, `topics: ${topics.length}`);
    assert.ok(maps.length >= 20, `maps: ${maps.length}`);
  });

  it('the same files are on disk and in memory', () => {
    for (const f of files) assert.ok(onNode.platform.fs.exists(f) && onMemory.platform.fs.exists(f), f);
  });

  it('renders something real, so agreement is not agreement on nothing', () => {
    const f = topics.find((t) => t.includes('/fixture/')) ?? topics[0];
    const html = onNode.renderTopicXml({ xml: read(f), docDir: path.dirname(f), docFile: f, keyMap: new Map(), asWebviewUri: (p) => p, headingLevel: 1 }).html;
    assert.ok(html.length > 200 && html.includes('<h1'), html.slice(0, 100));
  });

  it('topics: renderTopicXml (plain, and with ref errors and conref marks) and collectDiagnostics', () => {
    for (const f of topics) {
      const base = { xml: read(f), docDir: path.dirname(f), docFile: f, keyMap: new Map<string, string>(), asWebviewUri: (p: string) => `vscode-resource:${p}`, headingLevel: 1 };
      same(`${f} plain`, (e) => e.renderTopicXml(base));
      same(`${f} refErrors`, (e) => e.renderTopicXml({ ...base, refErrors: true, markConrefs: true, clickableExternalXrefs: true }));
      if (caseInsensitiveDisk && aCaseProbes.test(f)) continue;
      same(`${f} diagnostics`, (e) => e.collectDiagnostics({ xml: base.xml, absPath: f }));
    }
  });

  it('topics: the key space a document sees', () => {
    for (const f of topics) {
      const root = path.dirname(path.dirname(f));
      same(`${f} keys`, (e) => e.buildKeyMapForDocument(f, { root }));
      same(`${f} key space`, (e) => {
        const ks = e.buildKeySpaceForDocument(f, { root });
        return { keys: ks.keys, defs: ks.defs, scopes: ks.scopes, files: ks.files };
      });
    }
  });

  it('maps: renderMapXml, and book and site renders with no filter, a hand-hidden filter and a DITAVAL', () => {
    for (const f of maps) {
      const input = { xml: read(f), docDir: path.dirname(f) };
      same(`${f} map`, (e) => e.renderMapXml(input));
      same(`${f} diagnostics`, (e) => e.collectDiagnostics({ xml: input.xml, absPath: f }));
      for (const [name, filter] of Object.entries(filters)) {
        const toResourceUrl = (p: string) => `vscode-resource:${p}`;
        same(`${f} book (${name})`, (e) => e.renderBookXml({ ...input, toResourceUrl, headingLevel: 1, filter }));
        same(`${f} site (${name})`, (e) => e.renderSiteXml({ ...input, toResourceUrl, filter }));
      }
    }
  });

  it('a second pass over the same engines (warm caches, advanced counters) still agrees', () => {
    for (const f of topics.slice(0, 25)) {
      const input = { xml: read(f), docDir: path.dirname(f), docFile: f, keyMap: new Map<string, string>(), asWebviewUri: (p: string) => p, headingLevel: 2 };
      same(`${f} again`, (e) => e.renderTopicXml(input));
    }
  });

  it('compared a lot, and most of it rendered rather than threw', () => {
    assert.ok(compared > 1000, `compared ${compared}`);
    assert.ok(threw < compared / 4, `${threw} of ${compared} threw`);
  });
});

// The corpus test above compares what each platform does under three filters, but
// nothing there shows that a filter removes anything from those maps, so two
// platforms that both ignored it would agree. Build a map whose topicrefs carry
// profiling attributes, on disk and in memory, and require that each filter prunes
// exactly the topic it names, and that both platforms agree on every result.
describeIfPosix('Node and memory platforms agree when a filter prunes the map', function () {
  this.timeout(60000);
  const dir = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'core-conformance-'));
  const topic = (id: string, title: string): string => `<topic id="${id}"><title>${title}</title><body><p>${title} text</p></body></topic>`;
  const map = '<map><title>Filtered</title><topicref href="a.dita"/><topicref href="b.dita" audience="expert"/><topicref href="c.dita" product="pro"/></map>';
  const mapFile = path.join(dir, 'm.ditamap');

  before(() => {
    nodeFs.writeFileSync(path.join(dir, 'a.dita'), topic('a', 'Alpha'));
    nodeFs.writeFileSync(path.join(dir, 'b.dita'), topic('b', 'Bravo'));
    nodeFs.writeFileSync(path.join(dir, 'c.dita'), topic('c', 'Charlie'));
    nodeFs.writeFileSync(mapFile, map);
  });
  after(() => nodeFs.rmSync(dir, { recursive: true, force: true }));

  const filters: Record<string, ProfileFilter | undefined> = {
    none: undefined,
    hidden: { hidden: new Set(['audience:expert']) },
    ditaval: { ditaval: parseDitaval('<val><prop att="product" val="pro" action="exclude"/></val>') },
  };

  it('book and site renders are the same on both platforms, and the filters really prune', () => {
    const { fs: memoryFs } = loadDirIntoMemory(dir);
    const onNode = createEngine(nodePlatform);
    const onMemory = createEngine({ fs: memoryFs, path: posixPath });
    const norm = stable;
    const toResourceUrl = (p: string): string => `vscode-resource:${p}`;
    const html: Record<string, string> = {};
    for (const [name, filter] of Object.entries(filters)) {
      const input = { xml: map, docDir: dir, toResourceUrl, filter };
      const book = onNode.renderBookXml({ ...input, headingLevel: 1 });
      assert.strictEqual(norm(onMemory.renderBookXml({ ...input, headingLevel: 1 })), norm(book), `${name} book`);
      assert.strictEqual(norm(onMemory.renderSiteXml(input)), norm(onNode.renderSiteXml(input)), `${name} site`);
      html[name] = book.html;
    }
    assert.ok(html.none.includes('Bravo text') && html.none.includes('Charlie text'), 'unfiltered shows every topic');
    assert.ok(!html.hidden.includes('Bravo text') && html.hidden.includes('Charlie text'), 'hand-hidden audience:expert prunes only the expert topic');
    assert.ok(!html.ditaval.includes('Charlie text') && html.ditaval.includes('Bravo text'), 'a DITAVAL excluding product=pro prunes only that topic');
  });
});
