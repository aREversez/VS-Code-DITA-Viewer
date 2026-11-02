// Renders the Site / Book sidebar tree (nested, collapsible) from the nav manifest.
// Split out of ditaRenderUtils.ts, which re-exports every name here.

import { escapeAttr, escapeHtml } from './htmlEscape';
import { DocsiteNavEntry } from './siteNavManifest';

/** One manifest entry plus the direct children nested under it, built by
 *  buildSiteNavTree below. The manifest itself never carries parent/child
 *  links (see DocsiteNavEntry's own comment -- it's a flat, already-in-
 *  reading-order list keyed only by depth), so this is the one place that
 *  shape gets turned into an actual tree, purely for renderSiteNavHtml's
 *  own nested-<ul> output. */
interface SiteNavTreeNode {
  entry: DocsiteNavEntry;
  children: SiteNavTreeNode[];
}

/**
 * Groups a flat, depth-annotated manifest into a tree via a simple
 * ancestor stack: each entry becomes a child of the most recent
 * still-open entry with a strictly shallower depth (popping anything at
 * the same depth or deeper off the stack first, since those branches are
 * now closed). Works for irregular depth jumps the same way a strictly-
 * incrementing manifest would -- it only ever compares each entry's depth
 * to the stack, never assumes a fixed step of 1.
 */
function buildSiteNavTree(manifest: readonly DocsiteNavEntry[]): SiteNavTreeNode[] {
  const roots: SiteNavTreeNode[] = [];
  const stack: SiteNavTreeNode[] = [];
  for (const entry of manifest) {
    const node: SiteNavTreeNode = { entry, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].entry.depth >= entry.depth) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

/** Width, in px, reserved in front of every entry's title for the
 *  expand/collapse toggle -- reserved at every depth (not just where a
 *  toggle actually renders) so a leaf's title still lines up under its
 *  parent's title rather than jumping left by one toggle's width. */
const SITE_NAV_TOGGLE_SLOT = 16;

/**
 * Docsite mode's sidebar -- one link per topic, nested and indented by
 * depth to match the map's own structure, the current page marked active.
 * Parent entries (anything with at least one entry nested under it) get an
 * expand/collapse toggle to their left, Oxygen-style; leaves don't, but
 * still reserve that same width (SITE_NAV_TOGGLE_SLOT) so titles at a
 * given depth line up whether or not that particular row has a toggle.
 * Collapsing/expanding is pure client-side state (getSiteNavToggleScript)
 * -- which topics exist and how they nest never changes just because a
 * branch is tucked away, so this function never needs to know about
 * collapsed state at all, and this HTML is still rendered exactly once and
 * left alone afterward: switching pages toggles the `active` class
 * client-side (see the webview script's .site-nav-link click handler)
 * rather than re-rendering this nav on every page change.
 *
 * currentAbsPath must be one of manifest's own absPath values (generateHtml
 * resolves an unknown/stale one back to the first entry before calling
 * this) -- if it somehow isn't, nothing throws, the sidebar just renders
 * with no active entry.
 *
 * Each entry can carry up to two chips in front of its title: a role chip
 * for the bookmap's structural role ("Chapter 1", "Appendix A", ...) and a
 * type chip for the topic's own root element type ("Concept", "Task", ...).
 * Both are optional per entry; missing chips simply don't render, which
 * keeps a plain map full of generic `<topic>` files from getting a row of
 * identical "Topic" labels with no information value (see
 * makeFileTopicTypeResolver's default labeler for that filter). The title
 * text is wrapped in its own span so the link's flex layout can ellipsis
 * the title without ever clipping the chips -- the chips are short fixed
 * labels and the title is the part that overflows on narrow sidebars.
 *
 * toggleLabels is optional (defaults to English) rather than required so
 * every existing caller/test that only cares about the link markup itself
 * doesn't have to thread localized strings through just to satisfy the
 * type checker.
 */
/**
 * Just the `<ul class="site-nav-tree">` of sidebar rows -- renderSiteNavHtml
 * below wraps this in `<nav class="site-nav">`. Split out so a content-only
 * refresh (book mode's own incremental sidebar update,
 * nested-fold-and-highlight-plan.md item 1 -- see MSG_UPDATE_SIDEBAR in
 * MapViewerProvider.ts) can replace just this element's innerHTML client-
 * side, leaving the outer `<nav class="site-nav">` DOM node itself
 * untouched. That matters because getSiteSidebarResizerScript captures
 * that exact node once, at script-init time (`document.querySelector(
 * '.site-nav')`), and never re-queries it afterward -- replacing the whole
 * `<nav>` via outerHTML on every content edit would leave the resizer
 * silently holding a reference to a now-detached element, and dragging it
 * would do nothing. Site mode never needs this: its own page-switch
 * content-only update intentionally leaves the sidebar alone entirely (see
 * postSitePageUpdate's own comment) rather than refreshing it, so
 * renderSiteNavHtml stays the only entry point there.
 *
 * `collapsedIds` (nested-fold-and-highlight-plan.md item 3, persisted
 * collapse state) renders the matching rows already collapsed on arrival,
 * rather than rendering everything expanded and having a script collapse
 * them afterward -- that would flash open before snapping shut on every
 * load, exactly the "render collapsed initial state directly" requirement
 * the plan itself calls out. Membership is checked against
 * DocsiteNavEntry.id (buildBookNavManifest's stable id -- see its own
 * comment), which is also what gets stamped onto the row as
 * data-nav-id so the client can report it back after a toggle
 * (getSiteNavCollapseStateHelperScript's reportSiteNavCollapseState). A
 * hand-built manifest in a test that never sets `id` simply never
 * matches and never gets the attribute -- both are optional, not a
 * fallback onto title or position, for the exact reason buildBookNavManifest's
 * own id computation avoids title-keying: it would silently merge two
 * same-named branches' collapse state.
 */
export function renderSiteNavTreeHtml(
  manifest: DocsiteNavEntry[],
  currentAbsPath: string,
  toggleLabels: { expand: string; collapse: string } = { expand: 'Expand', collapse: 'Collapse' },
  collapsedIds: ReadonlySet<string> = new Set(),
  revealActive = false,
  webhelp = false,
): string {
  const expandLabel = escapeAttr(toggleLabels.expand);
  const collapseLabel = escapeAttr(toggleLabels.collapse);

  const tree = buildSiteNavTree(manifest);

  // With revealActive (site mode), every ancestor of the active page is
  // rendered expanded whatever collapsedIds says. Site mode re-renders the
  // whole page, sidebar included, on every open and every edit; honouring a
  // persisted collapse on the branch that holds the page being read would
  // hide the one row that says where the reader is, with nothing to explain
  // why. Book mode leaves this off: its `currentAbsPath` is only the
  // initial highlight (the first topic) and book mode's own scroll-sync
  // decides what to reveal as the reader actually scrolls.
  const ancestorsOfActive = new Set<SiteNavTreeNode>();
  if (revealActive) {
    const mark = (nodes: SiteNavTreeNode[]): boolean => {
      let found = false;
      for (const n of nodes) {
        const inChildren = mark(n.children);
        if (inChildren) ancestorsOfActive.add(n);
        if (inChildren || (!n.entry.isGroup && n.entry.absPath !== undefined && n.entry.absPath === currentAbsPath)) found = true;
      }
      return found;
    };
    mark(tree);
  }

  // Roving tabindex (the ARIA tree pattern): the whole tree is ONE Tab stop,
  // and arrow keys move within it (getSiteNavKeyboardScript). Without it every
  // topic link and every fold toggle is its own stop, and a large map takes
  // hundreds of Tab presses to get past the sidebar. The stop starts on the
  // active page -- where the reader is -- or the first row when there is none
  // (book mode's initial highlight, a page the map no longer has). The client
  // script moves it as focus moves.
  const findActive = (nodes: SiteNavTreeNode[]): SiteNavTreeNode | undefined => {
    for (const n of nodes) {
      if (!n.entry.isGroup && n.entry.absPath !== undefined && n.entry.absPath === currentAbsPath) return n;
      const inChildren = findActive(n.children);
      if (inChildren) return inChildren;
    }
    return undefined;
  };
  const rovingNode = findActive(tree) ?? tree[0];

  const renderNode = (node: SiteNavTreeNode): string => {
    const entry = node.entry;
    const hasChildren = node.children.length > 0;
    const rowTabindex = node === rovingNode ? '0' : '-1';
    // The link's own padding-left carries the full indent, toggle slot
    // included, exactly as before this feature -- the toggle itself is a
    // sibling, absolutely positioned into that reserved slot (see
    // .site-nav-toggle/.site-nav-item in media/styles.css) rather than an
    // inline child of the link, so a click on it can be told apart from a
    // click on the link (the .site-nav-link click delegation only ever
    // matches inside the <a> itself).
    const indent = 8 + SITE_NAV_TOGGLE_SLOT + entry.depth * 16;
    const toggleLeft = 8 + entry.depth * 16;
    // Role chip first (the rarer, more specific signal), then the type
    // chip (the topic's information type), then the title. Both chips
    // are escaped the same way the title is -- they're already display
    // strings produced by labelers, but a labeler fed a malicious tag
    // name (from a parsed topic a user controls) shouldn't be able to
    // inject markup into the sidebar.
    const roleChip = entry.role
      ? `<span class="site-nav-chip site-nav-chip--role">${escapeHtml(entry.role)}</span>`
      : '';
    const typeChip = entry.topicType
      ? `<span class="site-nav-chip site-nav-chip--type">${escapeHtml(entry.topicType)}</span>`
      : '';
    const navIdAttr = entry.id ? ` data-nav-id="${escapeAttr(entry.id)}"` : '';
    // Collapsed on arrival when this row's own id is in the persisted set
    // -- everything else defaults to expanded, matching the "only the
    // non-default state is ever stored" design (see MapViewerProvider.ts's
    // COLLAPSED_NAV_KEY comment). A row with no id (only possible from a
    // hand-built test manifest -- buildBookNavManifest always sets one)
    // can never match and is always rendered expanded, same as before
    // this feature existed.
    const isCollapsed = hasChildren && entry.id !== undefined && collapsedIds.has(entry.id) && !ancestorsOfActive.has(node);
    const toggleHtml = hasChildren
      ? `<button type="button" class="site-nav-toggle" style="left:${toggleLeft}px" aria-expanded="${isCollapsed ? 'false' : 'true'}" aria-label="${isCollapsed ? expandLabel : collapseLabel}" tabindex="-1" data-expand-label="${expandLabel}" data-collapse-label="${collapseLabel}"></button>`
      : '';
    const childrenHtml = hasChildren
      ? `<ul class="site-nav-children" role="group">${node.children.map(renderNode).join('')}</ul>`
      : '';
    const itemClass = hasChildren ? (isCollapsed ? ' has-children collapsed' : ' has-children') : '';
    // Webhelp mode (route B, step 4) doubles the tree classes onto the same
    // node: the WebHelp names a template's css reads (topicref / expanded /
    // active) sit alongside our own site-nav-* classes, which our behaviour JS
    // keeps driving. has-children is already ours; expanded is added only for
    // an open parent, active only for the row that is the current page. In own
    // mode this is the empty string, so the markup is byte-for-byte unchanged.
    const whClass = webhelp ? ` topicref${hasChildren && !isCollapsed ? ' expanded' : ''}` : '';
    const itemAriaExpanded = hasChildren ? ` aria-expanded="${isCollapsed ? 'false' : 'true'}"` : '';
    // A group entry (DocsiteNavEntry.isGroup -- a <topichead> or a bare
    // key-only topicref, see that field's own comment) has no topic file
    // to navigate to, so it renders as a plain non-clickable label -- no
    // <a>, no data-site-target, no href -- instead of renderSiteNavHtml's
    // usual link markup. Its own expand/collapse toggle (if it has
    // children) still works exactly like any other parent's; only the
    // click-to-navigate behavior is missing, matching how tree mode
    // already renders a topichead as a non-clickable heading
    // (map/topichead in mapTypeMap.ts) and book mode renders one as a
    // plain section heading (renderBookParts's own `struct:` branch).
    if (entry.isGroup) {
      const label = `<span class="site-nav-group-label" tabindex="${rowTabindex}" style="padding-left:${indent}px" title="${escapeAttr(entry.title)}">${roleChip}<span class="site-nav-link-text">${escapeHtml(entry.title)}</span></span>`;
      return `<li class="site-nav-item site-nav-item--group${itemClass}${whClass}" role="treeitem"${itemAriaExpanded}${navIdAttr}>${toggleHtml}${label}${childrenHtml}</li>`;
    }
    const activeClass = entry.absPath === currentAbsPath ? ' active' : '';
    const currentAttr = activeClass ? ' aria-current="page"' : '';
    const link = `<a href="#" class="site-nav-link${activeClass}"${currentAttr} tabindex="${rowTabindex}" data-site-target="${escapeAttr(entry.absPath as string)}" style="padding-left:${indent}px" title="${escapeAttr(entry.title)}">${roleChip}${typeChip}<span class="site-nav-link-text">${escapeHtml(entry.title)}</span></a>`;
    return `<li class="site-nav-item${itemClass}${whClass}${webhelp && activeClass ? ' active' : ''}" role="treeitem"${itemAriaExpanded}${navIdAttr}>${toggleHtml}${link}${childrenHtml}</li>`;
  };

  const items = tree.map(renderNode).join('');
  return `<ul class="site-nav-tree" role="tree">${items}</ul>`;
}

export function renderSiteNavHtml(
  manifest: DocsiteNavEntry[],
  currentAbsPath: string,
  navLabel: string,
  toggleLabels: { expand: string; collapse: string } = { expand: 'Expand', collapse: 'Collapse' },
  collapsedIds: ReadonlySet<string> = new Set(),
  revealActive = false,
  webhelp = false,
): string {
  return wrapSiteNavTreeHtml(renderSiteNavTreeHtml(manifest, currentAbsPath, toggleLabels, collapsedIds, revealActive, webhelp), navLabel);
}

/**
 * The <nav> a rendered sidebar tree goes in. Split out of renderSiteNavHtml
 * so a caller that also needs the bare tree (MSG_UPDATE_SIDEBAR sends the
 * tree alone) can render it once and wrap it, instead of rendering it twice.
 */
export function wrapSiteNavTreeHtml(treeHtml: string, navLabel: string): string {
  return `<nav class="site-nav" aria-label="${escapeAttr(navLabel)}">${treeHtml}</nav>`;
}
