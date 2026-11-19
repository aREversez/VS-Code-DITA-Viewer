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
// outside the layer, and keep every template's content-link colour rule
// strictly below the repeat's specificity (a tie wins by source order, since
// template css is injected after styles.css) and free of !important (an
// unlayered !important beats the repeat's normal declaration at any
// specificity). Every file in template.json's css list is scanned, so a
// split or renamed stylesheet cannot slip past the guard.
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

  it('every template content-link colour rule stays below the repeat it must lose to', () => {
    // Specificity (ids, classes/attrs/pseudo-classes, types/pseudo-elements),
    // computed conservatively: functional pseudo-classes are counted with
    // their arguments summed, which can only overestimate (:is/:not take the
    // max of their arguments, :where counts zero). An overestimate fails the
    // cap and sends a human to re-check -- never the reverse.
    function specificity(sel: string): [number, number, number] {
      const ids = (sel.match(/#[\w-]+/g) || []).length;
      const mid = (sel.match(/\.[\w-]+/g) || []).length
        + (sel.match(/\[[^\]]*\]/g) || []).length
        + (sel.match(/(?<!:):[\w-]+/g) || []).length;
      let types = (sel.match(/::[\w-]+/g) || []).length;
      for (const compound of sel.split(/[\s>+~]+/).filter(Boolean)) {
        if (/^[a-zA-Z][\w-]*/.test(compound)) types++;
      }
      return [ids, mid, types];
    }
    /** Strictly below: a tie loses too -- template css is injected after styles.css, so equal specificity wins by source order. */
    function below(a: [number, number, number], b: [number, number, number]): boolean {
      for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) return a[i] < b[i];
      }
      return false;
    }
    // The caps come from the repeat rules themselves (asserted present and
    // unlayered by the case above), not from a copy that could drift.
    const capA = specificity('body[data-template] #dita-content-root .draft-comment a');
    const capClass = specificity('body[data-template] #dita-content-root .draft-comment .xref');

    const names = readdirSync(join(repoRoot, 'media/templates'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    assert.ok(names.length >= 7, 'template folders found');
    for (const name of names) {
      // Scan exactly the files the preview concatenates: template.json's css
      // list, in order -- not a guessed `${name}/${name}.css`.
      const manifest = JSON.parse(readRepo(`media/templates/${name}/template.json`)) as { css: string[] };
      assert.ok(Array.isArray(manifest.css) && manifest.css.length > 0, `${name}: template.json has a css list`);
      let seen = 0;
      for (const cssFile of manifest.css) {
        const tpl = stripComments(readRepo(`media/templates/${name}/${cssFile}`));
        const re = /([^{}]+)\{([^{}]*)\}/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(tpl))) {
          if (!/color\s*:/.test(m[2])) continue;
          for (const raw of m[1].split(',')) {
            const sel = raw.replace(/\s+/g, ' ').trim();
            if (!/#dita-content-root(?![\w-])/.test(sel)) continue;
            // Any selector that can paint a link inside the content root:
            // its LAST compound is the element being coloured, and a class
            // between the root and that compound must not slip past the scan.
            const compounds = sel.split(/[\s>+~]+/).filter(Boolean);
            const last = compounds[compounds.length - 1] || '';
            const lastClasses: string[] = last.match(/\.[\w-]+/g) || [];
            const lastType = (/^[a-zA-Z][\w-]*/.exec(last) || [''])[0];
            const hitsXrefOrLink = lastClasses.includes('.xref') || lastClasses.includes('.link');
            if (!hitsXrefOrLink && lastType !== 'a' && lastType !== '*') continue;
            seen++;
            const where = `${name}/${cssFile}: ${sel}`;
            // An unlayered !important beats the repeat's unlayered normal
            // declaration at any specificity (the book-entry rules use
            // !important for exactly this reason), so the cap cannot save it.
            assert.ok(!/!\s*important/i.test(m[2]),
              `${where}: content-link colour rule uses !important; it would beat the unlayered draft-comment repeat in media/styles.css regardless of specificity`);
            // A selector ending in .xref/.link only matches elements the
            // stronger class repeat covers; anything else (a, *, a.foo) can
            // match a plain link, where only the `a` repeat applies.
            const cap = hitsXrefOrLink ? capClass : capA;
            const spec = specificity(sel);
            assert.ok(below(spec, cap),
              `${where}: specificity (${spec.join(',')}) must stay below (${cap.join(',')}); re-check the unlayered draft-comment repeat in media/styles.css`);
          }
        }
      }
      assert.ok(seen > 0, `${name}: expected a content-link colour rule`);
    }
  });
});
