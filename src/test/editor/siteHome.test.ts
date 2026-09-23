import * as assert from 'assert';
import { buildSiteHomeTiles, renderSiteHomeHtml, DocsiteNavEntry, SiteHomeTile } from '../../editor/ditaRenderUtils';

/**
 * The docsite home page (renderMapContentUntracked's/postSitePageUpdate's
 * SITE_HOME_TARGET branch in MapViewerProvider.ts): buildSiteHomeTiles turns
 * the top-level manifest entries into tiles, renderSiteHomeHtml turns tiles
 * into markup. Both are pure and vscode-free, so unlike the provider glue
 * that calls them, they're covered here directly.
 */

describe('buildSiteHomeTiles', () => {
  it('makes one tile per top-level leaf entry, targeting itself', () => {
    const manifest: DocsiteNavEntry[] = [
      { absPath: '/w/a.dita', title: 'Alpha', depth: 0, role: 'Chapter 1', topicType: 'Concept' },
      { absPath: '/w/b.dita', title: 'Beta', depth: 0 },
    ];
    const tiles = buildSiteHomeTiles(manifest);
    assert.strictEqual(tiles.length, 2);
    assert.deepStrictEqual(tiles[0], { title: 'Alpha', target: '/w/a.dita', role: 'Chapter 1', topicType: 'Concept', topicCount: 1 });
    assert.deepStrictEqual(tiles[1], { title: 'Beta', target: '/w/b.dita', role: undefined, topicType: undefined, topicCount: 1 });
  });

  it('targets a group entry (topichead/href-less topicref) at its first navigable descendant, not itself', () => {
    const manifest: DocsiteNavEntry[] = [
      { title: 'Part One', depth: 0, isGroup: true, role: 'Part I' },
      { absPath: '/w/a.dita', title: 'Alpha', depth: 1, topicType: 'Task' },
      { absPath: '/w/b.dita', title: 'Beta', depth: 1 },
    ];
    const tiles = buildSiteHomeTiles(manifest);
    assert.strictEqual(tiles.length, 1);
    assert.strictEqual(tiles[0].target, '/w/a.dita');
    assert.strictEqual(tiles[0].title, 'Part One', "the tile's own label is the group's title, not the descendant's");
    assert.strictEqual(tiles[0].topicType, undefined, "a group tile carries no topicType of its own -- it isn't a topic");
    assert.strictEqual(tiles[0].topicCount, 2, 'counts every navigable entry in the subtree, not just the one it targets');
  });

  it('counts a whole nested subtree, not just direct children', () => {
    const manifest: DocsiteNavEntry[] = [
      { title: 'Part One', depth: 0, isGroup: true },
      { title: 'Nested Group', depth: 1, isGroup: true },
      { absPath: '/w/a.dita', title: 'Alpha', depth: 2 },
      { absPath: '/w/b.dita', title: 'Beta', depth: 1 },
      { absPath: '/w/c.dita', title: 'Gamma', depth: 0 },
    ];
    const tiles = buildSiteHomeTiles(manifest);
    assert.strictEqual(tiles.length, 2);
    assert.strictEqual(tiles[0].target, '/w/a.dita');
    assert.strictEqual(tiles[0].topicCount, 2, 'Alpha + Beta, both under Part One');
    assert.strictEqual(tiles[1].target, '/w/c.dita');
  });

  it('drops a top-level branch with nothing navigable anywhere under it', () => {
    const manifest: DocsiteNavEntry[] = [
      { title: 'Empty Part', depth: 0, isGroup: true },
      { title: 'Also Empty', depth: 1, isGroup: true },
      { absPath: '/w/a.dita', title: 'Alpha', depth: 0 },
    ];
    const tiles = buildSiteHomeTiles(manifest);
    assert.strictEqual(tiles.length, 1);
    assert.strictEqual(tiles[0].target, '/w/a.dita');
  });

  it('returns nothing for an empty manifest', () => {
    assert.deepStrictEqual(buildSiteHomeTiles([]), []);
  });

  it('ignores non-top-level entries even if malformed input hands them in first', () => {
    // depth:1 with nothing at depth:0 before it -- buildSiteHomeTiles only
    // ever starts a tile at depth 0, so this contributes no tile of its own.
    const manifest: DocsiteNavEntry[] = [{ absPath: '/w/a.dita', title: 'Alpha', depth: 1 }];
    assert.deepStrictEqual(buildSiteHomeTiles(manifest), []);
  });
});

describe('renderSiteHomeHtml', () => {
  const label = (n: number): string => (n === 1 ? '1 topic' : `${n} topics`);

  it('renders the heading even with no tiles', () => {
    const html = renderSiteHomeHtml([], { heading: 'My Book', topicCountLabel: label });
    assert.match(html, /class="site-home"/);
    assert.match(html, /class="site-home-title"[^>]*>My Book</);
    assert.doesNotMatch(html, /site-home-grid/);
  });

  it('renders one tile per entry with its target, title, and topic count', () => {
    const tiles: SiteHomeTile[] = [{ title: 'Getting Started', target: '/w/a.dita', topicCount: 3 }];
    const html = renderSiteHomeHtml(tiles, { heading: 'Book', topicCountLabel: label });
    assert.match(html, /class="site-home-tile" data-site-target="\/w\/a\.dita"/);
    assert.match(html, /class="site-home-tile-title">Getting Started</);
    assert.match(html, /class="site-home-tile-meta">3 topics</);
  });

  it('renders the singular topic count label for a one-topic tile', () => {
    const tiles: SiteHomeTile[] = [{ title: 'Getting Started', target: '/w/a.dita', topicCount: 1 }];
    const html = renderSiteHomeHtml(tiles, { heading: 'Book', topicCountLabel: label });
    assert.match(html, /class="site-home-tile-meta">1 topic</);
  });

  it('renders role and type chips only when the tile has them', () => {
    const withBoth = renderSiteHomeHtml(
      [{ title: 'A', target: '/w/a.dita', role: 'Chapter 1', topicType: 'Concept', topicCount: 1 }],
      { heading: 'Book', topicCountLabel: label },
    );
    assert.match(withBoth, /site-nav-chip--role">Chapter 1</);
    assert.match(withBoth, /site-nav-chip--type">Concept</);

    const withNeither = renderSiteHomeHtml([{ title: 'A', target: '/w/a.dita', topicCount: 1 }], { heading: 'Book', topicCountLabel: label });
    assert.doesNotMatch(withNeither, /site-nav-chip/);
  });

  it('escapes tile title and target', () => {
    const html = renderSiteHomeHtml(
      [{ title: '<script>alert(1)</script>', target: '/w/"quote".dita', topicCount: 1 }],
      { heading: 'Book', topicCountLabel: label },
    );
    assert.doesNotMatch(html, /<script>alert/);
    assert.doesNotMatch(html, /target="\/w\/"quote"\.dita"/, 'an unescaped quote would break out of the attribute');
  });
});
