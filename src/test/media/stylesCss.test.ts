import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

// dist-test/test/media/stylesCss.test.js -> repo root is three levels up.
const stylesCss = readFileSync(
  join(__dirname, '..', '..', '..', 'media', 'styles.css'),
  'utf8',
);

/**
 * The stylesheet is a static asset: nothing compiles it, nothing exercises it,
 * and every way it can be wrong is silent and visual rather than loud. These
 * cases are tripwires on the four ways the book-mode render-skipping rule can
 * stop doing what it was written to do -- each one a hazard that was reasoned
 * about when the rule was added and would otherwise only be found by a reader
 * noticing blank space, a jumping scrollbar, or a printout missing topics.
 *
 * They match on the rule's text, so a legitimate rewording of the selector
 * will fail them and require the change to be made here too. That is the
 * point: the selector's shape is the mitigation, not an implementation detail.
 */
describe('styles.css book-entry render skipping', () => {
  // Comments stripped first, so locating a rule by scanning for braces cannot
  // be thrown off by braces or braces-like text inside a comment.
  const css = stylesCss.replace(/\/\*[\s\S]*?\*\//g, '');

  /**
   * The selector of the rule whose body contains `needle`, whitespace
   * normalised. For a rule nested in an @media block the returned string keeps
   * the block's prelude, which is what makes "this reset is scoped to print"
   * assertable without a CSS parser.
   */
  function selectorFor(needle: string): string | undefined {
    const at = css.indexOf(needle);
    if (at === -1) return undefined;
    const open = css.lastIndexOf('{', at);
    const close = css.lastIndexOf('}', open);
    return css.slice(close + 1, open).replace(/\s+/g, ' ').trim();
  }

  function bodyFor(needle: string): string | undefined {
    const at = css.indexOf(needle);
    if (at === -1) return undefined;
    const open = css.lastIndexOf('{', at);
    const close = css.indexOf('}', at);
    return css.slice(open + 1, close);
  }

  const skipped = selectorFor('content-visibility: auto');
  assert.ok(skipped !== undefined, 'expected a rule that skips rendering off-screen book entries');

  it('skips rendering for book entries and nothing else in the document', () => {
    assert.strictEqual(
      css.split('content-visibility: auto').length - 1,
      1,
      'one such rule: a second, broader one would apply the skip where its side effects were not weighed',
    );
    assert.ok(
      skipped.startsWith('.ditamap-book > .book-entry'),
      `scoped to entries of a book, got: ${skipped}`,
    );
  });

  it('excludes the placeholder and error entries, which are two or three lines tall and would turn into blank blocks', () => {
    // The intrinsic-size estimate below is in the hundreds of pixels. Applied
    // to a topichead's label or a failed-reference note, it puts a large empty
    // gap where a short line of text belongs -- visible damage, and no saving
    // worth having, since there is nothing in those entries to skip.
    assert.ok(skipped.includes(':not(.book-entry--placeholder)'), `got: ${skipped}`);
    assert.ok(skipped.includes(':not(.book-entry--error)'), `got: ${skipped}`);
  });

  it('reserves height for the entries it skips, with the remembered-size form written after the plain fallback', () => {
    const body = bodyFor('content-visibility: auto');
    assert.ok(body !== undefined, 'expected the skipping rule to have a body');

    // A skipped entry contributes nothing to its own height, so without an
    // estimate the scrollbar would collapse to almost nothing and jump as
    // entries came into view.
    const declarations = body.split('contain-intrinsic-size').length - 1;
    assert.strictEqual(
      declarations,
      2,
      'two declarations: the plain estimate as fallback, then the auto form to override it',
    );
    const [fallback, remembered] = body
      .split('contain-intrinsic-size')
      .slice(1)
      .map((part) => part.slice(0, part.indexOf(';')).trim());
    assert.ok(
      !fallback.startsWith(': auto'),
      `the first must be the plain form, since a browser without the auto keyword discards the whole declaration: ${fallback}`,
    );
    assert.ok(
      remembered.startsWith(': auto'),
      `the second must be the auto form, which is what remembers each entry's real height: ${remembered}`,
    );
  });

  it('renders every entry again when printing, or an exported book silently loses the topics nobody scrolled to', () => {
    const printed = selectorFor('content-visibility: visible');
    assert.ok(printed !== undefined, 'expected a rule that undoes the skip');
    assert.ok(
      printed.startsWith('@media print'),
      `the reset has to be scoped to print, got: ${printed}`,
    );

    // Each :not() argument counts towards specificity, so a shorter selector
    // here would sit at two classes against the skipping rule's four and lose
    // to it no matter that it is inside a media block. Identical selectors
    // leave source order as the decider, which the next case pins.
    const inner = printed.slice(printed.indexOf('{') + 1).trim();
    assert.strictEqual(
      inner,
      skipped,
      'the print reset must have the same specificity as the rule it undoes',
    );
    assert.ok(
      css.indexOf('content-visibility: visible') > css.indexOf('content-visibility: auto'),
      'and must come after it, so equal specificity resolves in the reset\'s favour',
    );
  });
});
