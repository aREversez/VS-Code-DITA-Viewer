import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

// Mirrors the light/dark contrast-checking approach in builtinTemplates.test.ts:
// checked on the palette the css itself declares, so a token edit that makes
// text hard to read fails here rather than in review.
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function declarations(css: string, selectorStart: string): Record<string, string> {
  const start = css.indexOf(selectorStart);
  assert.ok(start >= 0, `block ${selectorStart} not found`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]] = m[2].trim();
  return out;
}

const assetsDir = join(process.cwd(), 'media', 'transform-assets');
const chromeCss = () => readFileSync(join(assetsDir, 'site-chrome.css'), 'utf-8');

describe('site-chrome.css design tokens', () => {
  it('declares a shared --dv- token set on :root instead of each dv- component hardcoding its own colours', () => {
    const css = chromeCss();
    const tokens = declarations(css, ':root {');
    for (const name of ['--dv-bg', '--dv-fg', '--dv-muted', '--dv-border', '--dv-accent', '--dv-accent-fg', '--dv-accent-soft', '--dv-active-bg', '--dv-active-fg', '--dv-radius', '--dv-shadow']) {
      assert.ok(tokens[name], `expected token ${name} declared on :root`);
    }
  });

  it('every dv- component references the shared tokens rather than a literal hex/rgba colour', () => {
    const css = chromeCss();
    // Strip the :root token-declaration block itself, then look at everything
    // else for a literal colour value outside of a var(...) call.
    const rootStart = css.indexOf(':root {');
    const rootEnd = css.indexOf('}', rootStart);
    const rest = css.slice(0, rootStart) + css.slice(rootEnd + 1);
    const literalColor = /(?<!var\([^)]{0,80})(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/;
    const m = rest.match(literalColor);
    assert.strictEqual(m, null, `found a literal colour outside :root: ${m && m[0]}`);
  });

  it('the floating panels (toolbar, back-to-top, dark toggle, on-page toc) use the shared radius/shadow tokens', () => {
    const css = chromeCss();
    for (const sel of ['.dv-toolbar', '.dv-back-to-top', '.dv-dark-toggle', '.dv-page-toc']) {
      // Selectors may share a block (e.g. ".dv-back-to-top,\n.dv-dark-toggle {"),
      // so match up to the next "{" rather than requiring one immediately after.
      const re = new RegExp(sel.replace(/[.]/g, '\\.') + '[^{]*\\{');
      const m = css.match(re);
      assert.ok(m, `${sel} block not found`);
      const start = m!.index!;
      const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', css.indexOf('{', start)));
      assert.ok(/box-shadow:\s*var\(--dv-shadow\)/.test(body), `${sel} should use var(--dv-shadow)`);
    }
  });

  it('the sidebar active row is marked with an inset accent bar, matching the built-in templates\u2019 active-row treatment', () => {
    const css = chromeCss();
    assert.ok(/\.dv-sidebar a\.active\s*\{[^}]*box-shadow:\s*inset[^;]*var\(--dv-accent\)/.test(css));
  });

  it('the toolbar and back-to-top/dark-toggle buttons float off the viewport edge rather than sitting flush against it', () => {
    const css = chromeCss();
    const toolbarStart = css.indexOf('.dv-toolbar {');
    const toolbarBody = css.slice(css.indexOf('{', toolbarStart) + 1, css.indexOf('}', toolbarStart));
    assert.ok(!/right:\s*0[^.]/.test(toolbarBody), 'toolbar should not be flush to the right edge (right: 0)');
  });

  it('keeps the light palette readable (WCAG AA, 4.5:1) for every dv- text-on-background pair', () => {
    const tokens = declarations(chromeCss(), ':root {');
    const pairs: Array<[string, string]> = [
      ['--dv-fg', '--dv-bg'],
      ['--dv-muted', '--dv-bg'],
      ['--dv-accent', '--dv-bg'],
      ['--dv-accent-fg', '--dv-accent'],
      ['--dv-active-fg', '--dv-active-bg'],
      ['--dv-fg', '--dv-bg-soft'],
      ['--dv-muted', '--dv-bg-soft'],
    ];
    for (const [a, b] of pairs) {
      assert.ok(tokens[a] && tokens[b], `${a}/${b} declared`);
      assert.ok(contrast(tokens[a], tokens[b]) >= 4.5, `${a} on ${b} is ${contrast(tokens[a], tokens[b]).toFixed(2)}:1`);
    }
  });
});
