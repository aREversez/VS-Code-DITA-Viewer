import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

// Same contrast-checking approach as builtinTemplates.test.ts / siteChrome.test.ts.
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
const darkCss = () => readFileSync(join(assetsDir, 'dark-mode.css'), 'utf-8');

describe('dark-mode.css chrome tokens', () => {
  it('overrides the full --dv- token set under html.dark rather than re-styling each component with its own literal dark colour', () => {
    const css = darkCss();
    const tokens = declarations(css, 'html.dark {');
    for (const name of ['--dv-bg', '--dv-fg', '--dv-muted', '--dv-border', '--dv-accent', '--dv-accent-fg', '--dv-accent-soft', '--dv-active-bg', '--dv-active-fg']) {
      assert.ok(tokens[name], `expected token ${name} overridden under html.dark`);
    }
  });

  it('the dark --dv- palette differs from the light one and stays readable (WCAG AA, 4.5:1)', () => {
    const light = declarations(chromeCss(), ':root {');
    const dark = declarations(darkCss(), 'html.dark {');
    assert.notStrictEqual(light['--dv-bg'], dark['--dv-bg']);
    const pairs: Array<[string, string]> = [
      ['--dv-fg', '--dv-bg'],
      ['--dv-muted', '--dv-bg'],
      ['--dv-accent', '--dv-bg'],
      ['--dv-accent-fg', '--dv-accent'],
      ['--dv-active-fg', '--dv-active-bg'],
    ];
    for (const [a, b] of pairs) {
      assert.ok(dark[a] && dark[b], `${a}/${b} declared`);
      assert.ok(contrast(dark[a], dark[b]) >= 4.5, `${a} on ${b} is ${contrast(dark[a], dark[b]).toFixed(2)}:1`);
    }
  });

  it('preserves the content-level dark overrides for DITA-OT\'s own output (headings, links, notes, tables, code) alongside the dv- chrome tokens', () => {
    const css = darkCss();
    for (const sel of ['html.dark body', 'html.dark a', 'html.dark .note', 'html.dark table', 'html.dark pre.codeblock']) {
      assert.ok(css.includes(sel), `expected content-level rule for ${sel}`);
    }
  });

  it('overrides every note-severity token (including note_caution, aliased to note_warning) with WCAG AA contrast (4.5:1)', () => {
    const dark = declarations(darkCss(), 'html.dark {');
    for (const sev of ['tip', 'important', 'warning', 'danger']) {
      const bg = dark[`--dv-note-${sev}-bg`];
      assert.ok(bg, `--dv-note-${sev}-bg overridden under html.dark`);
      assert.ok(contrast(dark['--dv-fg'], bg) >= 4.5, `text on --dv-note-${sev}-bg is ${contrast(dark['--dv-fg'], bg).toFixed(2)}:1`);
    }
    // note_caution has no override of its own -- it must share note_warning's
    // tokens (real sample output uses both note_warning and note_caution).
    assert.ok(chromeCss().includes('.note_warning, .note_caution'), 'note_caution should be aliased to note_warning\'s tokens in site-chrome.css');
  });
});
