import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

const css = readFileSync(join(__dirname, '..', '..', '..', 'media/diff-styles.css'), 'utf8');
const rule = (re: RegExp): string | undefined => css.match(re)?.[1];

describe('a block that exists on one side only', () => {
  it('is tinted, not just edged: a p replaced by a note must read as a change', () => {
    const del = rule(/\.diff-col--left\s+\.dv-block--removed\s*\{([^}]*)\}/);
    const add = rule(/\.diff-col--right\s+\.dv-block--added\s*\{([^}]*)\}/);
    assert.ok(del && /background\s*:\s*var\(--diff-del-bg\)/.test(del), 'removed block tint');
    assert.ok(add && /background\s*:\s*var\(--diff-add-bg\)/.test(add), 'added block tint');
  });

  it('has a tint for both themes, and follows the version after Swap', () => {
    assert.ok(/:root\s*\{[^}]*--diff-add-bg\s*:[^}]*--diff-del-bg\s*:/.test(css) || /:root\s*\{[^}]*--diff-del-bg\s*:[^}]*--diff-add-bg\s*:/.test(css));
    assert.ok(/\.vscode-dark\s*\{[^}]*--diff-add-bg\s*:/.test(css));
    const swapped = rule(/body\.roles-swapped\s*\{([^}]*)\}/);
    assert.ok(swapped && /--diff-add-bg\s*:\s*var\(--diff-red-bg\)/.test(swapped));
    assert.ok(swapped && /--diff-del-bg\s*:\s*var\(--diff-green-bg\)/.test(swapped));
  });
});
