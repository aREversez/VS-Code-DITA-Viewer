import * as assert from 'assert';
import * as path from 'path';
import { createEngine, type Engine } from '../../src/engine';
import { nodePlatform } from '../../src/node/nodePlatform';
import { posixPath } from '../../src/posixPath';
import { loadDirIntoMemory } from '../helpers/loadDirIntoMemory';

// The Node platform and the in-memory platform must produce the same output for
// the same files: this is what lets a browser host trust that it renders what
// the extension renders. POSIX only (the memory platform has no drive letters).
const fixtureDir = path.resolve(__dirname, '..', '..', '..', '..', '..', 'test-dita-file', 'fixture');

const describeIfPosix = process.platform === 'win32' ? describe.skip : describe;

describeIfPosix('Node and memory platforms agree on test-dita-file/fixture', function () {
  this.timeout(60000);
  const { fs, files } = loadDirIntoMemory(fixtureDir);
  const onNode: Engine = createEngine(nodePlatform);
  const onMemory: Engine = createEngine({ fs, path: posixPath });
  const norm = (v: unknown): string => JSON.stringify(v, (_k, x) => (x instanceof Set ? [...x].sort() : x instanceof Map ? [...x.entries()] : x));
  const same = (what: string, run: (e: Engine) => unknown): void => assert.strictEqual(norm(run(onMemory)), norm(run(onNode)), what);
  const read = (f: string): string => fs.readText(f);

  const topics = files.filter((f) => /\.dita$/i.test(f));
  const maps = files.filter((f) => /\.ditamap$/i.test(f));

  it('finds fixtures to compare', () => {
    assert.ok(topics.length >= 5, `topics: ${topics.length}`);
    assert.ok(maps.length >= 2, `maps: ${maps.length}`);
  });

  it('renders something real, so agreement is not agreement on nothing', () => {
    const f = topics[0];
    const html = onNode.renderTopicXml({ xml: read(f), docDir: path.dirname(f), docFile: f, keyMap: new Map(), asWebviewUri: (p) => p, headingLevel: 1 }).html;
    assert.ok(html.length > 200 && html.includes('<h1'), html.slice(0, 100));
  });

  it('the same files are on disk and in memory', () => {
    for (const f of files) assert.ok(onNode.platform.fs.exists(f) && onMemory.platform.fs.exists(f), f);
  });

  it('topics: renderTopicXml (plain, with ref errors and conref marks) and collectDiagnostics', () => {
    for (const f of topics) {
      const base = { xml: read(f), docDir: path.dirname(f), docFile: f, keyMap: new Map<string, string>(), asWebviewUri: (p: string) => `vscode-resource:${p}`, headingLevel: 1 };
      same(`${f} plain`, (e) => e.renderTopicXml(base));
      same(`${f} refErrors`, (e) => e.renderTopicXml({ ...base, refErrors: true, markConrefs: true, clickableExternalXrefs: true }));
      same(`${f} diagnostics`, (e) => e.collectDiagnostics({ xml: base.xml, absPath: f }));
    }
  });

  it('topics: the key map a document sees is the same', () => {
    for (const f of topics) same(`${f} keys`, (e) => e.buildKeyMapForDocument(f, { root: fixtureDir }));
  });

  it('maps: renderMapXml, book and site renders', () => {
    for (const f of maps) {
      const input = { xml: read(f), docDir: path.dirname(f) };
      same(`${f} map`, (e) => e.renderMapXml(input));
      same(`${f} book`, (e) => e.renderBookXml({ ...input, toResourceUrl: (p) => `vscode-resource:${p}`, headingLevel: 1 }));
      same(`${f} site`, (e) => e.renderSiteXml({ ...input, toResourceUrl: (p) => `vscode-resource:${p}` }));
    }
  });

  it('a second pass over the same engines (warm caches, advanced counters) still agrees', () => {
    for (const f of topics.slice(0, 5)) {
      const input = { xml: read(f), docDir: path.dirname(f), docFile: f, keyMap: new Map<string, string>(), asWebviewUri: (p: string) => p, headingLevel: 2 };
      same(`${f} again`, (e) => e.renderTopicXml(input));
    }
  });
});
