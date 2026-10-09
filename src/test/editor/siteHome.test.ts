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

  it('drops the generic Topic chip from a tile but keeps specialization chips', () => {
    const manifest: DocsiteNavEntry[] = [
      { absPath: '/w/a.dita', title: 'Alpha', depth: 0, role: 'Chapter 1', topicType: 'Topic' },
      { absPath: '/w/b.dita', title: 'Beta', depth: 0, role: 'Chapter 2', topicType: 'Task' },
    ];
    const tiles = buildSiteHomeTiles(manifest);
    assert.strictEqual(tiles[0].topicType, undefined, 'a plain <topic> chapter gets no type chip on its tile');
    assert.strictEqual(tiles[0].role, 'Chapter 1', 'the role chip is untouched');
    assert.strictEqual(tiles[1].topicType, 'Task', 'a specialization still gets its chip');
  });

  it('matches the generic label the caller passes, so a localized label is dropped too', () => {
    const manifest: DocsiteNavEntry[] = [
      { absPath: '/w/a.dita', title: 'Alpha', depth: 0, role: 'Chapter 1', topicType: '\u4e3b\u9898' },
      { absPath: '/w/b.dita', title: 'Beta', depth: 0, topicType: 'Topic' },
    ];
    const tiles = buildSiteHomeTiles(manifest, '\u4e3b\u9898');
    assert.strictEqual(tiles[0].topicType, undefined);
    assert.strictEqual(tiles[1].topicType, 'Topic', 'only the label the caller names is treated as generic');
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

  describe('webhelp dom (route B M3-10, purely additive)', () => {
    const tiles: SiteHomeTile[] = [{ title: 'Getting Started', target: '/w/a.dita', topicCount: 3 }];

    it('the grid, the tile, its title and its text carry the contract hook names next to the own ones', () => {
      const html = renderSiteHomeHtml(tiles, { heading: 'Book', topicCountLabel: label, webhelp: true });
      assert.ok(html.includes('class="site-home-grid wh_tiles"'), html);
      assert.ok(html.includes('class="site-home-tile wh_tile"'), html);
      assert.ok(html.includes('class="site-home-tile-title wh_tile_title"'), html);
      assert.ok(html.includes('class="site-home-tile-meta wh_tile_text"'), html);
    });

    it('kill test: without webhelp the html5 tokens are absent (route A DOM unchanged)', () => {
      const html = renderSiteHomeHtml(tiles, { heading: 'Book', topicCountLabel: label });
      assert.ok(!/wh_tile/.test(html), html);
    });

    it('the own classes stay the whole class value when webhelp is off, so dv-base rules and the click delegation are untouched', () => {
      // The tile click delegation queries '.site-home-tile[data-site-target]'
      // (siteNavScripts.ts) and prev/next/history key off the same node; a
      // token that slipped in unconditionally would change what a route A
      // template's own css matches, and a dropped own class would break the
      // delegation.
      const own = renderSiteHomeHtml(tiles, { heading: 'Book', topicCountLabel: label });
      const wh = renderSiteHomeHtml(tiles, { heading: 'Book', topicCountLabel: label, webhelp: true });
      for (const cls of ['site-home', 'site-home-title', 'site-home-tile', 'site-home-tile-title', 'site-home-tile-meta', 'data-site-target="/w/a.dita"']) {
        assert.ok(own.includes(cls) && wh.includes(cls), cls);
      }
    });

    it('the heading-less no-tiles page keeps its own markup even with webhelp on', () => {
      // wh_welcome / wh_main_page_toc are optional contract hooks with nothing
      // to fill them yet (a welcome text no .opt-derived map data supplies; a
      // tree gallery this page deliberately is not). An empty grid is not a
      // reason to emit an empty wh_tiles container.
      const html = renderSiteHomeHtml([], { heading: 'Book', topicCountLabel: label, webhelp: true });
      assert.strictEqual(html, '<div class="site-home"><h1 class="site-home-title">Book</h1></div>');
    });

    it('chips keep the shared site-nav-chip classes with webhelp on', () => {
      const html = renderSiteHomeHtml(
        [{ title: 'A', target: '/w/a.dita', role: 'Chapter 1', topicType: 'Concept', topicCount: 1 }],
        { heading: 'Book', topicCountLabel: label, webhelp: true },
      );
      assert.ok(html.includes('site-nav-chip--role">Chapter 1<'), html);
      assert.ok(html.includes('site-nav-chip--type">Concept<'), html);
    });
  });
});
