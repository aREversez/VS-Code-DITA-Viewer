// Site mode's home page: the tiles for the top-level chapters.
// Split out of ditaRenderUtils.ts, which re-exports every name here.

import { escapeAttr, escapeHtml } from './htmlEscape';
import { DocsiteNavEntry, siteNavigableEntries } from './siteNavManifest';
import { defaultTopicTypeLabel } from './topicTypeResolver';

/** One home-page tile: a top-level manifest entry (or, for a childless-href
 *  group like a `<topichead>`, its first navigable descendant) plus enough
 *  to label the tile and say how much is behind it. */
export interface SiteHomeTile {
  title: string;
  /** Where clicking the tile navigates -- always a real topic path, never
   *  SITE_HOME_TARGET and never a group's own absPath (groups don't have one). */
  target: string;
  role?: string;
  topicType?: string;
  /** Count of navigable topics in this entry's own subtree (itself, if it has
   *  a topic of its own, plus every descendant) -- always at least 1, since a
   *  branch with none is dropped rather than given an unclickable tile. */
  topicCount: number;
}

/**
 * The home page's tiles, one per top-level manifest entry that leads
 * somewhere -- Oxygen-WebHelp-style entry points into the book, rather than
 * always dropping the reader on the first topic in reading order (see
 * renderSiteHomeHtml and the SITE_HOME_TARGET resolution in
 * MapViewerProvider.ts's renderMapContentUntracked/postSitePageUpdate).
 *
 * A leaf top-level entry (a real topic) is its own tile, targeting itself. A
 * group top-level entry (isGroup -- a `<topichead>` or an href-less
 * topicref, see DocsiteNavEntry's own comment) has no topic file to open, so
 * its tile targets the first navigable entry in its own subtree instead --
 * the same topic clicking into it in the sidebar and taking the first child
 * would land on. A top-level branch with no navigable entry anywhere under
 * it (every descendant is itself a childless group) gets no tile at all:
 * there is nowhere for it to lead.
 *
 * depth-based subtree slicing relies on the same "flat, already-in-reading-
 * order list keyed only by depth" manifest shape siteAdjacentLinks and
 * buildSiteNavTree already rely on (DocsiteNavEntry's own comment) -- an
 * entry's subtree is every following entry up to (not including) the next
 * one at its own depth or shallower.
 */
export function buildSiteHomeTiles(
  manifest: DocsiteNavEntry[],
  genericTopicLabel: string | undefined = defaultTopicTypeLabel('topic'),
): SiteHomeTile[] {
  const tiles: SiteHomeTile[] = [];
  for (let i = 0; i < manifest.length; i++) {
    const entry = manifest[i];
    if (entry.depth !== 0) continue;
    let end = i + 1;
    while (end < manifest.length && manifest[end].depth > 0) end++;
    const subtreeNavigable = siteNavigableEntries(manifest.slice(i, end));
    if (subtreeNavigable.length === 0) continue;
    const target = !entry.isGroup && entry.absPath !== undefined ? entry.absPath : subtreeNavigable[0].absPath;
    tiles.push({
      title: entry.title,
      target,
      role: entry.role,
      // The generic <topic> chip stays off a tile: the sidebar shows it so a
      // plain topic isn't the odd row out among specializations, but on a
      // home tile a chapter whose file happens to be a plain <topic> (the
      // normal bookmap case) would read "CHAPTER 1 | TOPIC" on every card,
      // and only the map's own <topichead> chapters (no file, so no chip)
      // would look different. Specializations (Task, Concept, ...) still show.
      topicType: entry.isGroup || entry.topicType === genericTopicLabel ? undefined : entry.topicType,
      topicCount: subtreeNavigable.length,
    });
  }
  return tiles;
}

/** Generic document glyph shown on every home tile -- deliberately one icon
 *  for every tile rather than one per topicType: buildSiteHomeTiles' tiles
 *  are frequently group entries (chapters) with no topicType of their own,
 *  so a per-type icon would be present on some tiles and silently missing on
 *  others. currentColor, same convention as the other inline icon constants
 *  in this file. */
const SITE_HOME_TILE_ICON_SVG =
  '<svg width="20" height="20" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path d="M4 1.5h5.5L12.5 4.5V14.5H4V1.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' +
  '<path d="M9.5 1.5V4.5H12.5" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' +
  '<path d="M5.75 8H10.75M5.75 10.25H10.75M5.75 12.5H9" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>';

/**
 * The docsite home page: a heading (the book's own title) and a tile grid,
 * one tile per buildSiteHomeTiles entry -- Oxygen WebHelp's own tile/tree
 * gallery home page (ug-editor/topics/whr-pt-feature-gallery.html) is the
 * model, not a `<topic>` file, so it does not go through renderTopicCached
 * at all.
 *
 * A tile is a plain `<a data-site-target>`, NOT `.site-nav-link` -- reusing
 * that class would pull every tile into siteAdjacentLinks' prev/next
 * computation (it queries every `.site-nav-link` in the whole document) and
 * into siteHistoryExists' existence check, corrupting both. Its click is
 * handled by a small dedicated delegation in getSiteNavClickHandlerScript
 * that looks up the matching sidebar link and drives the ordinary
 * switchToSitePage/history machinery through that -- the tile itself is
 * just a labeled pointer at a target.
 *
 * No tiles (every top-level entry is a childless group, so
 * buildSiteHomeTiles returned nothing) still renders the heading alone
 * rather than an empty grid -- shouldn't happen in practice (a map with no
 * navigable entries anywhere never reaches site mode at all, see
 * renderMapContentUntracked's own empty-manifest check), but an empty grid
 * with no tiles and no explanation would look broken rather than empty.
 */
export function renderSiteHomeHtml(
  tiles: SiteHomeTile[],
  opts: { heading: string; topicCountLabel: (count: number) => string; webhelp?: boolean },
): string {
  // Route B M3-10, §2.2: a webhelp-DOM page puts the same nodes under the
  // wh_* landing-page names of the contract (webhelpContract.ts, the 'home'
  // region) -- tile container/tile/title/text get a second class token, the
  // site-home-* classes every dv-base rule and the tile click delegation key
  // on stay exactly as they are. Purely additive, like the body-class and
  // sidebar-tree alignments before it. wh_welcome (a template's welcome text,
  // which no .opt-derived map data supplies yet) and wh_tile_shortdesc (needs
  // each topic file read for its shortdesc -- deferred with its own note
  // below) are optional contract hooks and simply not emitted until there is
  // something to put in them.
  const wh = (own: string, webhelpName: string): string =>
    opts.webhelp ? `${own} ${webhelpName}` : own;
  const heading = `<h1 class="site-home-title">${escapeHtml(opts.heading)}</h1>`;
  if (tiles.length === 0) return `<div class="site-home">${heading}</div>`;
  const cards = tiles
    .map((tile) => {
      const roleChip = tile.role ? `<span class="site-nav-chip site-nav-chip--role">${escapeHtml(tile.role)}</span>` : '';
      const typeChip = tile.topicType ? `<span class="site-nav-chip site-nav-chip--type">${escapeHtml(tile.topicType)}</span>` : '';
      return (
        `<a href="#" class="${wh('site-home-tile', 'wh_tile')}" data-site-target="${escapeAttr(tile.target)}" title="${escapeAttr(tile.title)}">` +
        `<span class="site-home-tile-icon">${SITE_HOME_TILE_ICON_SVG}</span>` +
        `<span class="site-home-tile-body">` +
        `<span class="site-home-tile-chips">${roleChip}${typeChip}</span>` +
        `<span class="${wh('site-home-tile-title', 'wh_tile_title')}">${escapeHtml(tile.title)}</span>` +
        `<span class="${wh('site-home-tile-meta', 'wh_tile_text')}">${escapeHtml(opts.topicCountLabel(tile.topicCount))}</span>` +
        `</span></a>`
      );
    })
    .join('');
  return `<div class="site-home">${heading}<div class="${wh('site-home-grid', 'wh_tiles')}" role="list">${cards}</div></div>`;
}
