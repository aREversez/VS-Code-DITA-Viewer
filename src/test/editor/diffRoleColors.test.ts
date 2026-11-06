import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { roleStats } from '../../editor/diffVersionPick';

const root = join(__dirname, '..', '..', '..');
const css = readFileSync(join(root, 'media/diff-styles.css'), 'utf8');
const provider = readFileSync(join(root, 'src/editor/ditaDiffProvider.ts'), 'utf8');

describe('diff colours follow the version, not the column', () => {
  it('counts the chip by role once the sides are swapped', () => {
    // After Swap the right-only rows hold the OLD content: they are removals
    // by role, so a green + would sit over a red block.
    assert.deepStrictEqual(roleStats({ added: 1, removed: 2, modified: 3 }, true), { added: 2, removed: 1, modified: 3 });
    assert.deepStrictEqual(roleStats({ added: 1, removed: 2, modified: 3 }, false), { added: 1, removed: 2, modified: 3 });
  });

  it('exchanges the add/del colours under body.roles-swapped', () => {
    const rule = css.match(/body\.roles-swapped\s*\{([^}]*)\}/);
    assert.ok(rule, 'body.roles-swapped sets the two border colours');
    assert.ok(/--diff-add-border\s*:\s*var\(--diff-red\)/.test(rule[1]));
    assert.ok(/--diff-del-border\s*:\s*var\(--diff-green\)/.test(rule[1]));
  });

  it('exchanges the word marks too, strike-through included', () => {
    const del = css.match(/body\.roles-swapped\s+\.diff-inline-del\s*\{([^}]*)\}/);
    const add = css.match(/body\.roles-swapped\s+\.diff-inline-add\s*\{([^}]*)\}/);
    assert.ok(del && /text-decoration\s*:\s*none/.test(del[1]));
    assert.ok(add && /text-decoration\s*:\s*line-through/.test(add[1]));
  });

  it('keeps the error banner red whatever the direction', () => {
    const rule = css.match(/\.diff-error\s*\{([^}]*)\}/);
    assert.ok(rule && /var\(--diff-red\)/.test(rule[1]));
  });

  it('is switched on from the panel state, and a re-compare starts unswapped', () => {
    assert.ok(/roles-swapped/.test(provider), 'the body class is emitted');
    assert.ok(/swapped:\s*!state\.swapped/.test(provider), 'swap toggles it');
    assert.ok(/swapped:\s*false/.test(provider), 'a fresh comparison is not swapped');
  });
});
