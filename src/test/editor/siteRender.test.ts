import * as assert from 'assert';
import { diffSiteRender, SiteRender } from '../../editor/siteRender';
import { renderSiteNavHtml, renderSiteNavTreeHtml, wrapSiteNavTreeHtml, DocsiteNavEntry } from '../../editor/ditaRenderUtils';

describe('diffSiteRender', () => {
  const prev = { sidebarTreeHtml: '<ul>tree</ul>', pageHtml: '<p>page</p>' };

  it('sends both halves when nothing is known about what the webview shows', () => {
    assert.deepStrictEqual(diffSiteRender(undefined, prev), { sidebar: '<ul>tree</ul>', page: '<p>page</p>' });
  });

  it('sends nothing when neither half changed -- the common case of an edit that touches neither', () => {
    assert.deepStrictEqual(diffSiteRender(prev, { ...prev }), {});
  });

  it('sends only the page when only the page changed', () => {
    assert.deepStrictEqual(diffSiteRender(prev, { ...prev, pageHtml: '<p>edited</p>' }), { page: '<p>edited</p>' });
  });

  it('sends only the sidebar when only the sidebar changed (a renamed navtitle, a reordered entry)', () => {
    assert.deepStrictEqual(diffSiteRender(prev, { ...prev, sidebarTreeHtml: '<ul>other</ul>' }), { sidebar: '<ul>other</ul>' });
  });

  it('sends both when both changed', () => {
    assert.deepStrictEqual(
      diffSiteRender(prev, { sidebarTreeHtml: '<ul>other</ul>', pageHtml: '<p>edited</p>' }),
      { sidebar: '<ul>other</ul>', page: '<p>edited</p>' },
    );
  });

  it('always resends the sidebar when its baseline is unknown, as after a page switch (the webview flipped the active row itself)', () => {
    const afterSwitch: SiteRender = { sidebarTreeHtml: undefined, pageHtml: '<p>page</p>' };
    assert.deepStrictEqual(diffSiteRender(afterSwitch, prev), { sidebar: '<ul>tree</ul>' });
  });

  it('treats an empty page or sidebar as a real value, not as "no change"', () => {
    assert.deepStrictEqual(diffSiteRender(prev, { sidebarTreeHtml: '', pageHtml: '' }), { sidebar: '', page: '' });
  });
});

describe('wrapSiteNavTreeHtml', () => {
  const manifest: DocsiteNavEntry[] = [
    { title: 'A', depth: 0, absPath: '/w/a.dita', id: '/w/a.dita' },
  ] as DocsiteNavEntry[];

  it('is exactly the nav renderSiteNavHtml builds around the tree', () => {
    const tree = renderSiteNavTreeHtml(manifest, '/w/a.dita');
    assert.strictEqual(wrapSiteNavTreeHtml(tree, 'Topics'), renderSiteNavHtml(manifest, '/w/a.dita', 'Topics'));
  });

  it('escapes the label', () => {
    assert.ok(wrapSiteNavTreeHtml('<ul/>', 'a"b').includes('aria-label="a&quot;b"'));
  });
});
