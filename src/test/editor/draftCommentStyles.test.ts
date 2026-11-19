import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = join(__dirname, '..', '..', '..');

// --color-link (#2b6cb0) on the light review box (#90ee90) is 3.8:1, under the
// 4.5:1 WCAG AA threshold for body text. A link inside a draft comment takes
// the box's own text colour (8.7:1) and keeps an underline so it still reads
// as a link. Both stylesheets carry the rule: media/styles.css for the
// extension, packages/core/styles/dita-content.css for core's consumers.
describe('draft-comment link legibility', () => {
  for (const rel of ['media/styles.css', 'packages/core/styles/dita-content.css']) {
    it(`${rel}: links inside a draft comment inherit its text colour and stay underlined`, () => {
      const css = readFileSync(join(repoRoot, rel), 'utf8');
      const m = /\.draft-comment a,\s*\.draft-comment \.xref,\s*\.draft-comment \.link\s*\{([^}]*)\}/.exec(css);
      assert.ok(m, 'rule present');
      assert.ok(/color:\s*inherit/.test(m[1]), m[1]);
      assert.ok(/text-decoration:\s*underline/.test(m[1]), m[1]);
    });
  }
});
