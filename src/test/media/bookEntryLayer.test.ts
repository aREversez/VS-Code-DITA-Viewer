import * as assert from 'assert';
import { readRepo, stripComments } from './cssBlocks';

/**
 * styles.css is wrapped in `@layer dv-base` so a template's unlayered css
 * outranks it. That is exactly wrong for the book-mode render-skipping rule:
 * an unlayered template rule beats a layered NORMAL declaration whatever its
 * specificity, so `.book-entry { content-visibility: visible }` in a template
 * would silently disable the optimisation on a large map
 * (site-book-templates-plan.md §4: these declarations stay `!important`).
 * Layered `!important` beats unlayered `!important`, and an unlayered one is
 * decided by specificity -- so the rules must be important AND outside the layer.
 */
describe('styles.css book-entry render skipping vs template css', () => {
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

  it('the screen rule is !important and sits outside every @layer', () => {
    assert.ok(/content-visibility:\s*auto\s*!important/.test(css), 'content-visibility: auto must be !important');
    assert.deepStrictEqual(enclosing('content-visibility: auto').filter((p) => p.startsWith('@layer')), []);
  });

  it('the print override is !important too (it must still beat the screen rule) and outside every @layer', () => {
    assert.ok(/content-visibility:\s*visible\s*!important/.test(css), 'print reset must be !important');
    const chain = enclosing('content-visibility: visible');
    assert.deepStrictEqual(chain.filter((p) => p.startsWith('@layer')), []);
    assert.ok(chain.some((p) => p.startsWith('@media print')), 'print reset stays scoped to print');
  });
});
