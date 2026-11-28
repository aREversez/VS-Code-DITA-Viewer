import * as assert from 'assert';
import * as nodeFs from 'fs';
import * as path from 'path';
import { analysisHostFromFileSystem } from '../../src/analysis/host';
import { crawlMaps } from '../../src/analysis/mapCrawl';
import { nodePlatform } from '../../src/node/nodePlatform';
import { posixPath } from '../../src/posixPath';
import { loadDirIntoMemory } from '../helpers/loadDirIntoMemory';
import { stable } from '../helpers/stable';

// DESIGN.md 4.8 item 2, for the crawler (step 4): crawling a map through the Node
// disk and through an in-memory copy of the same files finds the same things. The
// crawl is the base of every completeness check, so this is what lets a browser
// host trust the findings. POSIX only, like the render conformance test, and skipped
// on a case-insensitive disk, where the a-case probes resolve on Node and not in memory.
const fixtureRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', 'test-dita-file');
const caseInsensitiveDisk = nodeFs.existsSync(path.join(fixtureRoot, 'completeness-corpus-2', 'topics', 'Ok.dita'));
const describeIfComparable = process.platform === 'win32' || caseInsensitiveDisk ? describe.skip : describe;

describeIfComparable('Node and memory platforms crawl test-dita-file alike', function () {
  this.timeout(180000);
  const { fs, files } = loadDirIntoMemory(fixtureRoot);
  const onNode = analysisHostFromFileSystem(nodePlatform);
  const onMemory = analysisHostFromFileSystem({ fs, path: posixPath });
  const maps = files.filter((f) => /\.ditamap$/i.test(f));

  it('has maps to crawl', () => {
    assert.ok(maps.length >= 20, `found ${maps.length}`);
  });

  it('every map crawls to the same result', async () => {
    let refs = 0;
    for (const map of maps) {
      const a = await crawlMaps([map], onMemory);
      const b = await crawlMaps([map], onNode);
      assert.strictEqual(stable(a), stable(b), map);
      refs += b.refs.length;
    }
    assert.ok(refs > 100, `the comparison should have crawled real references, found ${refs}`);
  });
});
