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
  foreignKeySources,
  sanitizeOxygenReport,
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

  it('makes a Windows report relative to the corpus, including the folder above it', () => {
    const raw = [
      '<systemID>H:\\w\\corpus\\topics\\a.dita</systemID>',
      '<systemID>H:\\w\\corpus\\corpus.ditamap</systemID>',
      '<systemID>H:\\w\\outside\\o.dita</systemID>',
      '<description>File not found: &quot;H:\\w\\corpus\\topics\\x.dita&quot;.</description>',
    ].join('\n');
    const res = sanitizeOxygenReport(raw, 'H:\\w\\corpus');
    assert.deepStrictEqual(res.leftovers, []);
    assert.ok(res.xml.includes('<systemID>topics/a.dita</systemID>'), res.xml);
    assert.ok(res.xml.includes('<systemID>corpus.ditamap</systemID>'), res.xml);
    assert.ok(res.xml.includes('<systemID>../outside/o.dita</systemID>'), res.xml);
    assert.ok(res.xml.includes('&quot;topics/x.dita&quot;'), res.xml);
  });

  it('sanitizes file: URLs with escapes and POSIX roots', () => {
    const raw = '<systemID>file:///home/me/my%20work/corpus/topics/a.dita</systemID>';
    const res = sanitizeOxygenReport(raw, '/home/me/my work/corpus');
    assert.deepStrictEqual(res.leftovers, []);
    assert.ok(res.xml.includes('<systemID>topics/a.dita</systemID>'), res.xml);
  });

  it('lists the machine paths it cannot make relative instead of hiding them', () => {
    const raw = [
      '<systemID>H:\\w\\corpus\\corpus.ditamap</systemID>',
      '<description>Loaded from G:\\Program Files\\Oxygen\\lib.</description>',
      '<description>Also /Users/someone/x.</description>',
    ].join('\n');
    const res = sanitizeOxygenReport(raw, 'H:\\w\\corpus');
    assert.strictEqual(res.leftovers.length, 2, res.leftovers.join('|'));
    assert.ok(res.leftovers.some((l) => l.startsWith('G:')));
    assert.ok(res.leftovers.some((l) => l.includes('/Users/someone')));
  });

  it('strips Oxygen install paths inside <schema> down to the basename', () => {
    const raw = [
      '<systemID>H:\\w\\corpus\\topics\\invalid.dita</systemID>',
      '<operationDescription>',
      '<schemas>',
      '<schema>C:\\Program Files\\Oxygen XML Author 28\\frameworks\\dita\\topic.dtd</schema>',
      '<schema>/Applications/Oxygen XML Editor 27/frameworks/dita/map.dtd</schema>',
      '</schemas>',
      '</operationDescription>',
    ].join('\n');
    const res = sanitizeOxygenReport(raw, 'H:\\w\\corpus');
    assert.deepStrictEqual(res.leftovers, []);
    assert.ok(res.xml.includes('<schema>topic.dtd</schema>'), res.xml);
    assert.ok(res.xml.includes('<schema>map.dtd</schema>'), res.xml);
  });

  it('refuses a report whose keys were gathered from a map other than the corpus', () => {
    const raw = [
      '<systemID>H:\\w\\corpus\\corpus.ditamap</systemID>',
      '<description>Cannot find definition for key &quot;k&quot;. Keys are gathered from: other_product.ditamap.</description>',
    ].join('\n');
    const res = sanitizeOxygenReport(raw, 'H:\\w\\corpus');
    assert.deepStrictEqual(res.leftovers, ['keys gathered from other_product.ditamap, not corpus.ditamap']);
  });

  it('accepts keys gathered from the corpus map only', () => {
    const xml = '<description>Cannot find definition for key &quot;k&quot;. Keys are gathered from: corpus.ditamap.</description>';
    assert.deepStrictEqual(foreignKeySources(xml), []);
    assert.deepStrictEqual(foreignKeySources('<description>Keys are gathered from: corpus.ditamap, a/b.ditamap.</description>'), [
      'keys gathered from b.ditamap, not corpus.ditamap',
    ]);
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
