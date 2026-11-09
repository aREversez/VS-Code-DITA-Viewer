import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

const css = readFileSync(join(__dirname, '..', '..', '..', 'media/diff-styles.css'), 'utf8');

describe('diff view with word-level changes switched off (Aa)', () => {
  it('still tints a block counted as modified, on both sides', () => {
    // With Aa off the word marks go transparent, which left a modified block
    // with only a 3px edge bar while the toolbar badge still said ~N. The tint
    // is what makes the badge and the view agree.
    const rule = css.match(/body:not\(\.show-inline\)\s+\.dv-block--modified\s*\{([^}]*)\}/);
    assert.ok(rule, 'a body:not(.show-inline) .dv-block--modified rule exists');
    assert.ok(/background(-color)?\s*:/.test(rule[1]), 'it sets a background');
  });

  it('defines the tint for both themes', () => {
    assert.ok(/:root\s*\{[^}]*--diff-mod-bg\s*:/.test(css), 'light value');
    assert.ok(/\.vscode-dark\s*\{[^}]*--diff-mod-bg\s*:/.test(css), 'dark value');
  });
});
