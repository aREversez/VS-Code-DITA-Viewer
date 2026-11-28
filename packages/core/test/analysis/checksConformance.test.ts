import * as assert from 'assert';
import * as nodeFs from 'fs';
import * as path from 'path';
import { analysisHostFromFileSystem } from '../../src/analysis/host';
import { crawlMaps } from '../../src/analysis/mapCrawl';
import { runChecks } from '../../src/analysis/checks/mapChecks';
import { DEFAULT_COMPLETENESS_OPTIONS } from '../../src/analysis/checks/checkTypes';
import type { Issue } from '../../src/analysis/checks/checkTypes';
import { issueToDiagnostic } from '../../src/analysis/checks/issueToDiagnostic';
import { nodePlatform } from '../../src/node/nodePlatform';
import { posixPath } from '../../src/posixPath';
import { loadDirIntoMemory } from '../helpers/loadDirIntoMemory';
import { stable } from '../helpers/stable';

// DESIGN.md 4.8 item 2, for the checks (step 5): checking a crawl of every map under
// test-dita-file/ through the Node disk and through an in-memory copy of the same files
// reports the same findings, so a browser host over a memory file system can trust them.
// POSIX only, like the crawl conformance test, and skipped on a case-insensitive disk,
// where the a-case probes resolve on Node and not in memory.
const fixtureRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', 'test-dita-file');
const caseInsensitiveDisk = nodeFs.existsSync(path.join(fixtureRoot, 'completeness-corpus-2', 'topics', 'Ok.dita'));
const describeIfComparable = process.platform === 'win32' || caseInsensitiveDisk ? describe.skip : describe;

describeIfComparable('Node and memory platforms check test-dita-file alike', function () {
  this.timeout(180000);
  const { fs, files } = loadDirIntoMemory(fixtureRoot);
  const onNode = analysisHostFromFileSystem(nodePlatform);
  const onMemory = analysisHostFromFileSystem({ fs, path: posixPath });
  const maps = files.filter((f) => /\.ditamap$/i.test(f));

  it('has maps to check', () => {
    assert.ok(maps.length >= 20, `found ${maps.length}`);
  });

  it('every map checks to the same findings', async () => {
    let found = 0;
    for (const map of maps) {
      const crawlA = await crawlMaps([map], onMemory);
      const crawlB = await crawlMaps([map], onNode);
      const a = await runChecks(crawlA, DEFAULT_COMPLETENESS_OPTIONS, { host: onMemory });
      const b = await runChecks(crawlB, DEFAULT_COMPLETENESS_OPTIONS, { host: onNode });
      assert.strictEqual(stable(a), stable(b), map);
      found += b.length;
    }
    assert.ok(found > 100, `the comparison should have produced real findings, found ${found}`);
  });
});

describe('issueToDiagnostic', () => {
  const issue = (severity: Issue['severity']): Issue => ({
    category: 'missing-reference',
    severity,
    file: '/p/root.ditamap',
    line: 3,
    msg: { code: 'ref.missingTopic', args: ['gone.dita'] },
    message: 'Referenced topic not found: gone.dita',
  });

  it('converts the 1-based line to a whole-line 0-based range and keeps the English message', () => {
    assert.deepStrictEqual(issueToDiagnostic(issue('error')), {
      severity: 'error',
      message: 'Referenced topic not found: gone.dita',
      startLine: 2,
      startCol: 0,
      endLine: 3,
      endCol: 0,
    });
  });

  it('maps info to warning: DitaDiagnostic has no info severity', () => {
    assert.strictEqual(issueToDiagnostic(issue('info')).severity, 'warning');
    assert.strictEqual(issueToDiagnostic(issue('warning')).severity, 'warning');
  });

  it('never returns a negative line for a host that reports line 0', () => {
    const d = issueToDiagnostic({ ...issue('error'), line: 0 });
    assert.strictEqual(d.startLine, 0);
  });
});
