import * as assert from 'assert';
import { readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { findingSignature, diffKeys } from './completenessHarness';
import {
  OxygenIncident,
  categoryForProblemId,
  corpusRootFromReport,
  normalizeOxygenFindings,
  oxygenPathToLocal,
  parseOxygenReport,
  parseOxygenReportAuto,
  unmappedProblemIds,
} from './oxygenReport';

const repoRoot = join(__dirname, '..', '..', '..');
const samplePath = join(
  repoRoot,
  'test-dita-file',
  'completeness-corpus',
  'oxygen-report.sample.xml',
);

function incident(over: Partial<OxygenIncident>): OxygenIncident {
  return {
    filePath: '',
    line: 0,
    severity: 'error',
    problemID: '',
    engine: 'DITA Validation',
    description: '',
    fields: {},
    ...over,
  };
}

describe('Oxygen completeness report adapter', () => {
  it('parses the documented report shape into flat incidents', () => {
    const incidents = parseOxygenReport(readFileSync(samplePath, 'utf8'));
    assert.strictEqual(incidents.length, 4);

    const first = incidents[0];
    assert.strictEqual(first.filePath, 'D:\\corpus\\corpus.ditamap');
    assert.strictEqual(first.problemID, 'dmv.file.not.found');
    assert.strictEqual(first.severity, 'error');
    assert.strictEqual(first.engine, 'oXygen');
    assert.strictEqual(first.line, 12, 'location/start/line -> 12');
    assert.match(first.description, /missing\.dita/);

    // every incident is attributed to its enclosing <file>
    assert.strictEqual(
      incidents[3].filePath,
      'D:\\corpus\\topics\\profiling.dita',
    );
    assert.strictEqual(incidents[3].severity, 'warning');
  });

  it('maps confirmed problem IDs and flags the rest', () => {
    assert.strictEqual(
      categoryForProblemId('dmv.file.not.found'),
      'missing-reference',
    );
    assert.strictEqual(categoryForProblemId('dmv.undef.key'), 'undefined-key');
    assert.strictEqual(categoryForProblemId('dmv.key.undef'), 'undefined-key');
    assert.strictEqual(categoryForProblemId('dmv.dup.topic'), 'multiple-reference');
    assert.strictEqual(
      categoryForProblemId('duplicate.key.definition'),
      'duplicate-key',
    );
    assert.strictEqual(
      categoryForProblemId('dtd.element.not.allowed'),
      'oxygen:dtd.element.not.allowed',
    );
    assert.strictEqual(categoryForProblemId(''), 'oxygen:unknown');

    const ids = unmappedProblemIds(
      parseOxygenReport(readFileSync(samplePath, 'utf8')),
    );
    assert.deepStrictEqual(ids, [
      'dmv.profiling.conflict',
      'dtd.attribute.not.allowed',
      'dtd.element.not.allowed',
    ]);
  });

  const inc = (filePath: string, line = 1): OxygenIncident => ({
    engine: 'oXygen', severity: 'error', problemID: 'dmv.file.not.found', description: 'd', filePath, line, fields: {},
  });

  it('relativizes Windows report paths against a Windows corpus root on any host', () => {
    const out = normalizeOxygenFindings('H:\\w\\corpus', [
      inc('H:\\w\\corpus\\topics\\a.dita', 3),
      inc('H:\\w\\corpus\\corpus.ditamap'),
      inc('H:\\w\\outside\\o.dita'),
    ]);
    assert.deepStrictEqual(out.map((f) => f.file).sort(), ['../outside/o.dita', 'corpus.ditamap', 'topics/a.dita']);
  });

  it('finds the corpus root a report was produced from', () => {
    assert.strictEqual(
      corpusRootFromReport([inc('H:\\w\\corpus\\topics\\a.dita'), inc('H:\\w\\corpus\\corpus.ditamap')]),
      'H:\\w\\corpus',
    );
    assert.strictEqual(corpusRootFromReport([inc('/tmp/c/corpus.ditamap')]), '/tmp/c');
    assert.strictEqual(corpusRootFromReport([inc('/tmp/c/a.dita')]), undefined);
  });

  it('keeps the root slash of a POSIX file: URL and drops it before a drive letter', () => {
    assert.strictEqual(oxygenPathToLocal('file:///tmp/ccorpus/a.ditamap'), '/tmp/ccorpus/a.ditamap');
    assert.strictEqual(oxygenPathToLocal('file:/tmp/a%20b/x.dita'), '/tmp/a b/x.dita');
    assert.strictEqual(oxygenPathToLocal('file:///C:/my%20dir/x.dita'), 'C:/my dir/x.dita');
  });

  it('normalizes file: URLs and local paths relative to the corpus', () => {
    const corpus = join(tmpdir(), 'ccorpus');
    const fromUrl = pathToFileURL(join(corpus, 'corpus.ditamap')).href;
    const out = normalizeOxygenFindings(corpus, [
      incident({ filePath: fromUrl, line: 3, problemID: 'dmv.file.not.found' }),
      incident({
        filePath: join(corpus, 'topics', 'invalid.dita'),
        line: 6,
        problemID: 'dtd.x',
      }),
    ]);
    const byFile = new Map(out.map((f) => [f.file, f]));
    assert.ok(
      byFile.has('corpus.ditamap'),
      `expected corpus.ditamap in ${[...byFile.keys()]}`,
    );
    assert.strictEqual(
      byFile.get('corpus.ditamap')?.category,
      'missing-reference',
    );
    assert.strictEqual(
      byFile.get('topics/invalid.dita')?.category,
      'oxygen:dtd.x',
    );
  });

  it('strips file: schemes and URI escapes', () => {
    assert.strictEqual(
      oxygenPathToLocal('file:///D:/a%20b/c.ditamap'),
      'D:/a b/c.ditamap',
    );
    assert.strictEqual(
      oxygenPathToLocal('file:/home/me/x.dita'),
      '/home/me/x.dita',
    );
    assert.strictEqual(
      oxygenPathToLocal('C:\\plain\\x.dita'),
      'C:\\plain\\x.dita',
    );
  });

  it('diffs extension vs Oxygen by (file, category) signature', () => {
    const extSig = findingSignature({
      category: 'missing-reference',
      severity: 'error',
      file: 'corpus.ditamap',
      line: 12,
      message: 'Referenced topic not found: topics/missing.dita',
    });
    const oxSig = findingSignature({
      category: 'oxygen:dtd.element.not.allowed',
      severity: 'error',
      file: 'topics/invalid.dita',
      line: 6,
      message: 'Element "notanelement" is not allowed at this location.',
    });
    const diff = diffKeys([extSig], [extSig, oxSig]);
    assert.deepStrictEqual(diff.onlyInA, []);
    assert.deepStrictEqual(diff.onlyInB, [oxSig]);
  });

  it('parses the JSON report variant and auto-detects it', () => {
    const json = JSON.stringify({
      report: {
        summary: { totalNumberOfFilesVerified: 1 },
        filesWithValidationProblems: [
          {
            filePath: 'file:///D:/corpus/corpus.ditamap',
            numberOfProblems: 1,
            incidents: [
              {
                engine: 'DITA Validation',
                severity: 'error',
                problemID: 'dmv.file.not.found',
                description: 'nope',
                startLocation: '12:24',
              },
            ],
          },
        ],
      },
    });
    const incidents = parseOxygenReportAuto(json);
    assert.strictEqual(incidents.length, 1);
    assert.strictEqual(incidents[0].problemID, 'dmv.file.not.found');
    assert.strictEqual(incidents[0].line, 12);
    assert.strictEqual(
      incidents[0].filePath,
      'file:///D:/corpus/corpus.ditamap',
    );
  });
});
