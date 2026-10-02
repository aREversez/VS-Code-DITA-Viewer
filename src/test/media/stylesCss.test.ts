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

/**
 * Docsite mode's sidebar (.site-nav) used to give itself top padding and
 * rely on the always-on search box (getBookSearchScript, bookSearchIndex.ts)
 * canceling it with a negative top margin on its own position:sticky box.
 * Confirmed empirically (real Chromium, not just this project's own
 * DOM-shape tests): Chromium does not honor a negative top margin on a
 * sticky box the way it does on a static/relative one, so that margin was
 * silently clamped away and the search box sat exactly one padding's worth
 * below the sidebar's actual top -- a permanent gap no amount of scrolling
 * ever closed. The fix moved that top inset off of .site-nav entirely
 * (the sticky search box supplies its own top padding instead), so this is
 * a tripwire on `.site-nav` growing top padding again -- source-only, since
 * this repo does not run a real layout engine, but real-Chromium
 * measurement (before/after, see PR) confirmed a non-zero top padding here
 * reproduces the reader-visible gap 1:1.
 */
describe('styles.css .site-nav has no top padding (sticky search box gap regression)', () => {
  const css = stylesCss.replace(/\/\*[\s\S]*?\*\//g, '');

  function bodyForSelector(selector: string): string {
    // Word-boundary-ish guard so `.site-nav` doesn't also match
    // `.site-nav-link`, `.site-nav-resizer`, etc.
    const escaped = selector.replace(/[.]/g, '\\.');
    const re = new RegExp(escaped + '(?![-\\w])\\s*\\{');
    const m = re.exec(css);
    assert.ok(m, `expected a \`${selector} { ... }\` rule in styles.css`);
    const open = css.indexOf('{', m!.index);
    const close = css.indexOf('}', open);
    return css.slice(open + 1, close);
  }

  it('gives .site-nav zero top padding', () => {
    const body = bodyForSelector('.site-nav');
    const m = /padding\s*:\s*([^;]+);/.exec(body);
    assert.ok(m, '.site-nav should declare a padding shorthand');
    const parts = m![1].trim().split(/\s+/);
    // 1-value: all sides: parts[0] is top. 2/3/4-value shorthand: parts[0]
    // is always top. Either way, top is parts[0].
    assert.strictEqual(
      parts[0],
      '0',
      'top padding must stay 0 -- the sticky search box (bookSearchIndex.ts) no longer ' +
        'cancels it with a negative margin (Chromium does not honor that for position:sticky), ' +
        'so any non-zero top padding here reintroduces a permanent gap above the search box',
    );
  });
});

describe('styles.css site-mode toolbar buttons', () => {
  const css = stylesCss.replace(/\/\*[\s\S]*?\*\//g, '');

  it('gives previous/next-topic no width of their own: the shared inline width must apply to all four nav buttons', () => {
    // SITE_NAV_BTN_STYLE (ditaRenderUtils.ts) sets width:20px inline on back,
    // forward, previous and next alike. A stylesheet min-width on the last two
    // wins over that width and made them visibly wider than the first two.
    const rules = [...css.matchAll(/([^{}]*#__site-(?:prev|next)-btn[^{}]*)\{([^}]*)\}/g)];
    assert.ok(rules.length > 0, 'expected the prev/next disabled-state rule to still exist');
    for (const [, selector, body] of rules) {
      assert.ok(!/(^|[^-])(min-|max-)?width\s*:/.test(body), `${selector.trim()} must not set a width: ${body}`);
    }
  });
});

/**
 * The map webview is a superset script (getMapWebviewScript): every mode's
 * toolbar buttons are always built and appended, and an in-place mode switch
 * (applyModeStage) only flips the body's mode-* class -- it never rebuilds the
 * bar. So the buttons a mode has no use for must be hidden here, keyed on that
 * class. These are tripwires on that visibility contract: if a rule is dropped
 * or a button id drifts, the toolbar grows stray controls after a switch (or
 * loses ones it should keep), and the reader sees the right-hand cluster -- and
 * the mode button -- jump, which is exactly what the work set out to prevent.
 */
describe('styles.css mode-based toolbar button visibility', () => {
  const css = stylesCss.replace(/\/\*[\s\S]*?\*\//g, '');

  /** True when `body.mode-<mode> #<id>` appears in the selector list of some
   * rule whose body sets display:none. */
  function hiddenUnderMode(mode: 'tree' | 'book' | 'site', id: string): boolean {
    const target = `body.mode-${mode} #${id}`;
    for (const [, selector, body] of css.matchAll(/([^{}]*)\{([^}]*)\}/g)) {
      if (!/display:\s*none/.test(body)) continue;
      const parts = selector.split(',').map((s) => s.replace(/\s+/g, ' ').trim());
      if (parts.includes(target)) return true;
    }
    return false;
  }

  const pageNavButtons = ['__site-back-btn', '__site-forward-btn', '__site-prev-btn', '__site-next-btn', '__site-open-source-btn'];
  const sidebarTemplateButtons = ['__site-sidebar-toggle-btn', '__site-expand-all-btn', '__site-collapse-all-btn', '__template-select'];

  it('outline (tree) mode hides every sidebar, template and page-nav control', () => {
    for (const id of [...sidebarTemplateButtons, ...pageNavButtons]) {
      assert.ok(hiddenUnderMode('tree', id), `body.mode-tree should hide #${id}`);
    }
  });

  it('book mode hides the docsite page-nav controls but keeps the sidebar and template', () => {
    for (const id of pageNavButtons) {
      assert.ok(hiddenUnderMode('book', id), `body.mode-book should hide #${id}`);
    }
    for (const id of sidebarTemplateButtons) {
      assert.ok(!hiddenUnderMode('book', id), `body.mode-book should keep #${id} visible`);
    }
  });

  it('docsite (site) mode hides none of them (it shows the full set)', () => {
    for (const id of [...sidebarTemplateButtons, ...pageNavButtons]) {
      assert.ok(!hiddenUnderMode('site', id), `body.mode-site should not hide #${id}`);
    }
  });
});
