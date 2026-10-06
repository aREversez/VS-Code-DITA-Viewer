import * as assert from 'assert';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { WEBHELP_CSS_VARS } from '../../editor/webhelpContract';

// Route B milestone 1 step 5 (webhelp-compat-plan.md §2.3): the base
// stylesheet that gives the WebHelp-style hooks a usable default layout and
// theme surface, so a template's own css only has to override what it cares
// about. It is a static asset -- nothing compiles it -- so these are the
// automated tripwires that stand in for the browser, alongside the Playwright
// check in src/test-visual.
//
// The whole point of the @layer split is the cascade rule in §2.3: template css
// is emitted UNLAYERED, so it beats both this sheet (@layer wh-compat) and
// styles.css (@layer dv-base) without a single !important. These tests pin the
// two halves of that promise: (1) everything here really is layered and scoped
// to a webhelp page, and (2) no shipped template css is layered, so it really
// does win.
const compatCss = readFileSync(
  join(__dirname, '..', '..', '..', 'media', 'webhelp-compat.css'),
  'utf8',
);

/** The css with block comments stripped, so a brace scan is not thrown off by
 * comment text. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('webhelp-compat.css layering and scope', () => {
  const css = stripComments(compatCss).trim();

  it('wraps its entire body in @layer wh-compat (so unlayered template css wins)', () => {
    assert.ok(
      css.startsWith('@layer wh-compat'),
      `expected the sheet to open with "@layer wh-compat {", got: ${css.slice(0, 40)}`,
    );
    // One top-level block: the closing brace of the layer is the last char, and
    // there is no rule text outside it.
    assert.ok(css.endsWith('}'), 'the @layer block must be closed at end of file');
    assert.ok(
      !/[^{}]([.#\w-]+\s*\{)/.test(css.slice(0, css.indexOf('{'))),
      'no selector may sit before the @layer opening brace (that rule would be unlayered)',
    );
  });

  it('contains no !important -- the layer order, not specificity force, is what makes template css win', () => {
    assert.ok(!/!important/.test(css), 'compat must not need !important; template css already outranks the layer');
  });

  it('carries no <script> (structure and behaviour live in TS, this is styling only)', () => {
    assert.ok(!/<script/i.test(compatCss), 'a stylesheet must not embed script');
  });

  it('scopes every rule to a webhelp page, so own-mode pages are immune to it being always loaded', () => {
    // Walk every "selector { ... }" pair (the selector text may carry an
    // @media prelude, which is fine -- the point is each rule reaches only
    // elements under body.wh_topic_page).
    const rules = [...css.matchAll(/([^{}]*)\{/g)];
    assert.ok(rules.length > 0, 'expected at least one rule');
    for (const [, rawSelector] of rules) {
      const selector = rawSelector.replace(/\s+/g, ' ').trim();
      if (!selector) continue; // the @layer wh-compat { opener itself
      // An at-rule prelude (@media, @supports) selects no element; the rules it
      // wraps are checked on their own pass and must still carry the scope.
      if (selector.startsWith('@')) continue;
      assert.ok(
        selector.includes('wh_topic_page'),
        `rule not scoped under body.wh_topic_page would leak onto own-mode pages: "${selector}"`,
      );
    }
  });

  it('defines a default for every themed CSS custom property in the contract', () => {
    for (const name of WEBHELP_CSS_VARS) {
      assert.ok(
        css.includes(`${name}:`),
        `contract var ${name} has no default in webhelp-compat.css (a template that does not set it would get an empty value)`,
      );
    }
  });

  it('ships the Bootstrap subset the DOM contract leans on, without pulling in Bootstrap', () => {
    // Only the utilities §2.3 lists as actually referenced by the contract's
    // hooks; a real Bootstrap import would be a licensing and size problem.
    for (const cls of ['container-fluid', 'row', 'col-', 'd-none', 'd-md-block', 'navbar', 'collapse', 'sr-only']) {
      assert.ok(css.includes(cls), `expected the Bootstrap-subset class ".${cls}" to be handled`);
    }
    assert.ok(!/@import/.test(css), 'must not @import Bootstrap or any third-party sheet');
  });

  it('lays out the six shell regions the contract requires', () => {
    for (const hook of [
      'wh_header', 'wh_tools', 'wh_content_area', 'wh_publication_toc',
      'wh_topic_body', 'wh_topic_content', 'wh_topic_toc', 'wh_footer',
    ]) {
      assert.ok(css.includes(hook), `expected a base rule for the shell region .${hook}`);
    }
  });
});

describe('shipped template css stays unlayered (so it outranks webhelp-compat.css)', () => {
  // The built-in templates live in media/templates; each ships css that a
  // reader sees win over both base layers. If one of them ever got wrapped in
  // @layer it would drop below webhelp-compat.css and the shell would fight it.
  const templatesDir = join(__dirname, '..', '..', '..', 'media', 'templates');

  it('no built-in template stylesheet opens with an @layer block', () => {
    const dirs = readdirSync(templatesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    let checked = 0;
    for (const dir of dirs) {
      let files: string[];
      try {
        files = readdirSync(join(templatesDir, dir)).filter((f) => f.endsWith('.css'));
      } catch {
        continue;
      }
      for (const f of files) {
        const text = stripComments(readFileSync(join(templatesDir, dir, f), 'utf8')).trim();
        assert.ok(
          !text.startsWith('@layer'),
          `${dir}/${f} must not be @layer-wrapped; template css wins by being unlayered`,
        );
        checked++;
      }
    }
    assert.ok(checked > 0, 'expected to find at least one built-in template css to check');
  });
});
