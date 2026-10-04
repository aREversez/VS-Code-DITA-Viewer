import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * A release is one section. CHANGELOG once carried two `## 1.0.9` sections (an
 * older set of notes written as if shipped, plus the real cut) because 1.0.9 was
 * never released in between; readers cannot tell which one is the release.
 */

const repoRoot = join(__dirname, '..', '..', '..');
const lines = readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8').split('\n');
const headings = lines.filter((l) => l.startsWith('## ')).map((l) => l.slice(3).trim());

describe('CHANGELOG.md release headings', () => {
  it('has at most one section per version', () => {
    const versions = headings.map((h) => h.replace(/\s*\(.*\)\s*$/, ''));
    const dupes = versions.filter((v, i) => versions.indexOf(v) !== i);
    assert.deepStrictEqual(dupes, [], `duplicate sections: ${dupes.join(', ')}`);
  });

  it('keeps "Unreleased", when present, as the first section', () => {
    const idx = headings.indexOf('Unreleased');
    assert.ok(idx === -1 || idx === 0, `Unreleased is at position ${idx}`);
  });
});
