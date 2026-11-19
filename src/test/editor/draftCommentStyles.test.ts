import * as assert from 'assert';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { blocksFor, readRepo, stripComments } from '../media/cssBlocks';

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

// The inherit rule above sits in @layer dv-base, and every template's css is
// unlayered: its `body[data-template="..."] #dita-content-root a { color:
// var(--color-link) }` beats a layered normal declaration at any specificity,
// which would put the low-contrast link colour back inside the box on Book and
// Docsite pages. styles.css therefore repeats the rule unlayered, one class
// stronger than the template's selector. These tripwires keep that repeat
// outside the layer, and keep every template's content-link colour rule at the
// weaker selector shape the repeat was checked against.
describe('draft-comment link legibility vs template css', () => {
  const css = stripComments(readRepo('media/styles.css'));

  /** Preludes of the blocks enclosing `needle`'s first occurrence, outermost first. */
  function enclosing(needle: string): string[] {
    const at = css.indexOf(needle);
    assert.ok(at !== -1, `expected ${needle} in styles.css`);
    const stack: string[] = [];
    let start = 0;
    for (let i = 0; i < at; i++) {
      if (css[i] === '{') {
        stack.push(css.slice(start, i).replace(/\s+/g, ' ').trim());
        start = i + 1;
      } else if (css[i] === '}') {
        stack.pop();
        start = i + 1;
      } else if (css[i] === ';' && stack.length === 0) {
        start = i + 1;
      }
    }
    return stack;
  }

  it('styles.css repeats the inherit rule unlayered, scoped to template pages', () => {
    for (const tail of ['a', '.xref', '.link']) {
      const selector = `body[data-template] #dita-content-root .draft-comment ${tail}`;
      const blocks = blocksFor(css, selector);
      assert.strictEqual(blocks.length, 1, `${selector}: exactly one rule`);
      assert.ok(/color:\s*inherit/.test(blocks[0]), blocks[0]);
      assert.ok(/text-decoration:\s*underline/.test(blocks[0]), blocks[0]);
      assert.deepStrictEqual(enclosing(selector).filter((p) => p.startsWith('@layer')), [], `${selector} must stay outside every @layer`);
    }
  });

  it('every template content-link colour rule stays at the weaker selector the repeat outranks', () => {
    const names = readdirSync(join(repoRoot, 'media/templates'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    assert.ok(names.length >= 7, 'template folders found');
    for (const name of names) {
      const tpl = stripComments(readRepo(`media/templates/${name}/${name}.css`));
      const re = /([^{}]+)\{([^{}]*)\}/g;
      let m: RegExpExecArray | null;
      let seen = 0;
      while ((m = re.exec(tpl))) {
        if (!/color\s*:/.test(m[2])) continue;
        for (const raw of m[1].split(',')) {
          const sel = raw.replace(/\s+/g, ' ').trim();
          if (!/#dita-content-root (a|\.xref|\.link)(?![\w-])/.test(sel)) continue;
          seen++;
          assert.strictEqual(sel, `body[data-template="${name}"] #dita-content-root a`,
            `${name}: content-link colour rule changed shape; re-check the unlayered draft-comment repeat in media/styles.css`);
        }
      }
      assert.ok(seen > 0, `${name}: expected a content-link colour rule`);
    }
  });
});
