import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { formatDiffLogEntry } from '../../editor/diffLogFormat';

const provider = readFileSync(join(__dirname, '..', '..', '..', 'src/editor/ditaDiffProvider.ts'), 'utf8');

describe('diff log', () => {
  it('keeps the stack of an Error, which the toast leaves out', () => {
    const e = new Error('boom');
    const line = formatDiffLogEntry('Compare with Git Version failed', e, new Date('2026-01-02T03:04:05Z'));
    assert.ok(line.startsWith('[2026-01-02T03:04:05.000Z] Compare with Git Version failed: boom'));
    assert.ok(line.includes('at '), 'stack present');
  });

  it('copes with a thrown non-Error', () => {
    assert.ok(formatDiffLogEntry('x', 'plain', new Date(0)).endsWith(': plain'));
  });

  it('is where the provider reports failures, instead of console.error', () => {
    // console.error goes to the extension host's console, which a user never sees.
    assert.ok(!/console\.error/.test(provider));
    assert.ok(/logDiffError\(/.test(provider));
  });

  it('records a version that could not be read, with the file and ref', () => {
    assert.ok(/logDiffError\([^)]*could not be read/i.test(provider) || /Could not read version/.test(provider));
  });
});
