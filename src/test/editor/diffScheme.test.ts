import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { docUriStringFromDiffUri, isDiffVirtualScheme } from '../../editor/diffScheme';

const root = join(__dirname, '..', '..', '..');
const lang = readFileSync(join(root, 'src/language/ditaLanguageFeatures.ts'), 'utf8');
const provider = readFileSync(join(root, 'src/editor/ditaDiffProvider.ts'), 'utf8');

describe('dita-diff virtual documents', () => {
  it('recognises only its own scheme', () => {
    assert.strictEqual(isDiffVirtualScheme('dita-diff'), true);
    assert.strictEqual(isDiffVirtualScheme('file'), false);
  });

  it('recovers the compared document from the doc= query', () => {
    const doc = 'file:///w/topics/a%20b.dita';
    const q = `doc=${encodeURIComponent(doc)}`;
    assert.strictEqual(docUriStringFromDiffUri({ scheme: 'dita-diff', query: q }), doc);
  });

  it('gives nothing for a URI that is not a diff document, or has no doc=', () => {
    assert.strictEqual(docUriStringFromDiffUri({ scheme: 'file', query: 'doc=x' }), undefined);
    assert.strictEqual(docUriStringFromDiffUri({ scheme: 'dita-diff', query: '' }), undefined);
  });
});

describe('diagnostics and the diff source view', () => {
  it('never lint a dita-diff document: it sits at the root, so every relative reference "fails"', () => {
    // One gate, used by both the immediate and the debounced path.
    assert.ok(/function isLintTarget\(/.test(lang));
    assert.ok(/isDiffVirtualScheme\(document\.uri\.scheme\)/.test(lang));
    const validate = lang.slice(lang.indexOf('function validateDocument('), lang.indexOf('function validateDocument(') + 300);
    assert.ok(validate.includes('isLintTarget(document)'), 'validateDocument uses the gate');
    const sched = lang.slice(lang.indexOf('const scheduleValidation'), lang.indexOf('const scheduleValidation') + 200);
    assert.ok(sched.includes('isLintTarget(document)'), 'scheduleValidation uses the gate');
  });

  it('compare started from the native diff targets the real file, not the virtual one', () => {
    assert.ok(/function compareTargetUri\(/.test(provider));
    assert.ok(/const uri = compareTargetUri\(\)/.test(provider));
  });
});
