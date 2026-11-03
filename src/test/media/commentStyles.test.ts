import * as assert from 'assert';
import { blocksFor, readRepo, stripComments } from './cssBlocks';

/**
 * The preview's XML-comment look lives in two stylesheets: the VS Code one
 * (media/styles.css) and the core package's (packages/core/styles/
 * dita-content.css), which other hosts load for the same rendered HTML. The
 * renderer emits the same .dv-comment markup for both, so a rule or colour
 * token added to only one leaves the other host showing bare text.
 */
describe('comment styles are carried by both stylesheets', () => {
  const vscodeCss = stripComments(readRepo('media/styles.css'));
  const coreCss = stripComments(readRepo('packages/core/styles/dita-content.css'));

  for (const selector of ['.dv-comment', '.dv-comment--block']) {
    it(`${selector} has the same declarations in both`, () => {
      const a = blocksFor(vscodeCss, selector);
      const b = blocksFor(coreCss, selector);
      assert.strictEqual(a.length, 1, `media/styles.css must have exactly one ${selector} rule`);
      assert.deepStrictEqual(b, a);
    });
  }

  it('defines each comment colour token for light and dark in both', () => {
    for (const token of ['--color-comment-bg', '--color-comment-border', '--color-comment-text']) {
      const count = (css: string): number => css.split(`${token}:`).length - 1;
      assert.strictEqual(count(vscodeCss), 2, `${token} in media/styles.css`);
      assert.strictEqual(count(coreCss), 2, `${token} in dita-content.css`);
    }
  });
});
