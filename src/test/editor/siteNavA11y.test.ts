import * as assert from 'assert';
import { renderSiteNavTreeHtml, DocsiteNavEntry } from '../../editor/ditaRenderUtils';

/**
 * The sidebar as a keyboard-navigable ARIA tree: one Tab stop for the whole
 * tree (roving tabindex), every other focusable row reachable by arrow keys
 * instead, and the current page marked for screen readers.
 */
const manifest: DocsiteNavEntry[] = [
  { id: 'grp:0', title: 'Part', depth: 0, isGroup: true },
  { id: '/w/a.dita', absPath: '/w/a.dita', title: 'Alpha', depth: 1 },
  { id: '/w/b.dita', absPath: '/w/b.dita', title: 'Beta', depth: 1 },
  { id: '/w/c.dita', absPath: '/w/c.dita', title: 'Gamma', depth: 0 },
] as DocsiteNavEntry[];

const count = (html: string, re: RegExp): number => (html.match(re) ?? []).length;
/** The opening tag of the link to a page, whatever order its attributes are in. */
const linkTag = (html: string, target: string): string =>
  (html.match(new RegExp(`<a\\s[^>]*data-site-target="${target.replace(/[./]/g, '\\$&')}"[^>]*>`)) ?? [''])[0];

describe('sidebar tree markup for keyboard navigation', () => {
  it('has exactly one Tab stop in the whole tree, on the active page', () => {
    const html = renderSiteNavTreeHtml(manifest, '/w/b.dita');
    assert.strictEqual(count(html, /tabindex="0"/g), 1);
    assert.match(linkTag(html, '/w/b.dita'), /tabindex="0"/);
  });

  it('puts every other focusable row, and every fold toggle, out of the Tab order', () => {
    const html = renderSiteNavTreeHtml(manifest, '/w/b.dita');
    // 3 links + 1 group label + 1 toggle, minus the one Tab stop.
    assert.strictEqual(count(html, /tabindex="-1"/g), 4);
    assert.match(html, /<button [^>]*class="site-nav-toggle"[^>]*tabindex="-1"/);
    assert.match(html, /<span class="site-nav-group-label"[^>]*tabindex="-1"/);
    assert.match(linkTag(html, '/w/a.dita'), /tabindex="-1"/);
  });

  it('falls back to the first row when no page is active (book mode start, or a page the map no longer has)', () => {
    const html = renderSiteNavTreeHtml(manifest, '/w/gone.dita');
    assert.strictEqual(count(html, /tabindex="0"/g), 1);
    assert.match(html, /<span class="site-nav-group-label"[^>]*tabindex="0"/, 'the first row of this manifest is a group label');
  });

  it('marks the current page, and only it, for screen readers', () => {
    const html = renderSiteNavTreeHtml(manifest, '/w/c.dita');
    assert.strictEqual(count(html, /aria-current="page"/g), 1);
    assert.match(linkTag(html, '/w/c.dita'), /aria-current="page"/);
    assert.strictEqual(count(renderSiteNavTreeHtml(manifest, '/w/gone.dita'), /aria-current/g), 0);
  });

  it('renders an empty manifest without a Tab stop', () => {
    assert.strictEqual(count(renderSiteNavTreeHtml([], '/w/a.dita'), /tabindex/g), 0);
  });
});
