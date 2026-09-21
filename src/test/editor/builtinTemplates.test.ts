import * as assert from 'assert';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { discoverTemplates } from '../../editor/siteTemplates';

// Contrast is checked on the palettes the built-in css itself declares, so a
// palette edit that makes text hard to read fails here rather than in review.
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

describe('built-in templates', () => {
  const root = join(process.cwd(), 'media', 'templates');
  const { templates, diagnostics } = discoverTemplates([{ dir: root, builtin: true }]);

  it('ships three templates that load cleanly, each with a header, a footer and a logo that exists', () => {
    assert.deepStrictEqual(diagnostics, []);
    assert.deepStrictEqual(templates.map((t) => t.id).sort(), ['aurora', 'classic-docs', 'reader']);
    for (const t of templates) {
      assert.ok(t.header, `${t.id} header`);
      assert.ok(t.footer, `${t.id} footer`);
      assert.ok(t.header?.logo && existsSync(t.header.logo), `${t.id} logo`);
      assert.ok(t.names['en'] && t.names['zh-cn'], `${t.id} names`);
    }
    assert.ok(existsSync(templates.find((t) => t.id === 'aurora')!.header!.banner!));
  });

  for (const id of ['classic-docs', 'aurora', 'reader']) {
    describe(id, () => {
      const css = readFileSync(join(root, id, `${id}.css`), 'utf-8');
      const light = declarations(css, `body[data-template="${id}"] {`);
      const dark = declarations(css, `html.vscode-dark body[data-template="${id}"]`);

      it('has both a light and a dark palette, and they differ', () => {
        assert.ok(light['--tpl-bg'] && dark['--tpl-bg']);
        assert.notStrictEqual(light['--tpl-bg'], dark['--tpl-bg']);
        assert.ok(css.includes(`body[data-template="${id}"].template-dark`));
      });

      it('keeps text readable (WCAG AA, 4.5:1) in both palettes', () => {
        const pairs: Array<[string, string]> = [
          ['--tpl-fg', '--tpl-bg'], ['--tpl-muted', '--tpl-bg'], ['--color-link', '--tpl-bg'],
          ['--tpl-accent-fg', '--tpl-accent'], ['--tpl-header-fg', '--tpl-header-bg'], ['--tpl-footer-fg', '--tpl-footer-bg'],
          ['--tpl-fg', '--tpl-nav-bg'], ['--tpl-muted', '--tpl-nav-bg'], ['--tpl-accent', '--tpl-soft'], ['--tpl-fg', '--tpl-code-bg'],
          ['--tpl-fg', '--color-note-bg'], ['--tpl-fg', '--color-warning-bg'], ['--tpl-fg', '--color-danger-bg'],
          ['--tpl-fg', '--color-important-bg'], ['--tpl-fg', '--color-tip-bg'],
        ];
        for (const [mode, vars] of [['light', light], ['dark', dark]] as const) {
          for (const [a, b] of pairs) {
            assert.ok(vars[a] && vars[b], `${id} ${mode}: ${a}/${b} declared`);
            assert.ok(contrast(vars[a], vars[b]) >= 4.5, `${id} ${mode}: ${a} on ${b} is ${contrast(vars[a], vars[b]).toFixed(2)}:1`);
          }
        }
      });
    });
  }
});
