import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { sameVersion, secondPickChoices, shouldReportFailure, VersionOutcome } from '../../editor/diffVersionPick';

const provider = readFileSync(join(__dirname, '..', '..', '..', 'src/editor/ditaDiffProvider.ts'), 'utf8');

type C = { id: string; picker?: boolean };
const working: C = { id: 'working' };
const last: C = { id: 'last' };
const specific: C = { id: 'specific', picker: true };
const all = [working, last, specific];
const opens = (c: C) => c.picker === true;

describe('second version pick', () => {
  it('drops the first pick', () => {
    assert.deepStrictEqual(secondPickChoices(all, working, opens), [last, specific]);
  });

  it('keeps "Pick a specific commit" even when it was the first pick', () => {
    // Otherwise any-history vs any-history cannot be reached from the UI.
    assert.deepStrictEqual(secondPickChoices(all, specific, opens), all);
  });
});

describe('version outcome reporting', () => {
  it('stays silent when the user backs out of a picker', () => {
    const o: VersionOutcome<number> = { kind: 'cancelled' };
    assert.strictEqual(shouldReportFailure(o), false);
  });

  it('reports a version that could not be read', () => {
    assert.strictEqual(shouldReportFailure({ kind: 'failed' }), true);
  });

  it('is what the command acts on: no unconditional error after a resolve', () => {
    // The old code showed "Could not read the selected version." for any
    // falsy resolve, including a cancelled commit picker.
    assert.ok(!/if \(!(left|right)Result\) \{\s*vscode\.window\.showErrorMessage/.test(provider));
  });
});

describe('the same version on both sides', () => {
  it('is detected by commit hash', () => {
    assert.strictEqual(sameVersion('abc', 'abc'), true);
    assert.strictEqual(sameVersion('abc', 'def'), false);
  });

  it('never matches the working copy, which has no hash', () => {
    assert.strictEqual(sameVersion(undefined, undefined), false);
    assert.strictEqual(sameVersion('abc', undefined), false);
  });

  it('is checked before a panel is opened', () => {
    assert.ok(/sameVersion\(leftResult\.hash, rightResult\.hash\)/.test(provider));
  });
});
