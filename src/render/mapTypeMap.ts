import { DitaNode } from '../parser/domTypes';
import { mergeProfilingAttrs, profilingKeysAttr, profilingChipsHtml } from './renderer';

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeAttr(name: string, value: string | undefined | null): string {
  if (value == null) return '';
  return ` ${name}="${escapeAttr(value)}"`;
}

type Renderer = (
  node: DitaNode,
  context: MapRenderContext,
  renderChildren: (node: DitaNode, ctx: MapRenderContext) => string,
) => string;

function getAttr(node: DitaNode, name: string): string | undefined {
  return node.attributes?.[name];
}

type ResolveKey = (key: string) => string | undefined;

// BookMap topicref specializations carry structural semantics beyond a plain
// reference — surface them as role badges in tree view / sidebar / entries
export const BOOKMAP_REF_ROLES: Record<string, string> = {
  chapter: 'Chapter',
  part: 'Part',
  appendix: 'Appendix',
  preface: 'Preface',
  notices: 'Notices',
  draftintro: 'Draft Intro',
  dedication: 'Dedication',
  colophon: 'Colophon',
  bookabstract: 'Abstract',
  amendments: 'Amendments',
  glossaryref: 'Glossary',
};

const ROMAN_NUMERALS: [number, string][] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
  [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
  [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

function toRoman(n: number): string {
  let out = '';
  for (const [value, sym] of ROMAN_NUMERALS) {
    while (n >= value) {
      out += sym;
      n -= value;
    }
  }
  return out;
}

/** Structured role info handed to a label formatter. */
export interface RoleLabelInfo {
  /** BookMap tag name ('chapter', 'part', 'appendix', 'preface', …) */
  tagName: string;
  /** Plain English role name from BOOKMAP_REF_ROLES */
  role: string;
  /** Document-order ordinal ("1", "II", "A") — only for numbered divisions */
  ordinal?: string;
}

/** Formats a role label for display; injectable so VS Code callers can localize. */
export type RoleLabelFormatter = (info: RoleLabelInfo) => string;

/** Stateful book-division labeler that numbers divisions per nesting depth. */
export type RoleLabeler = (tagName: string | undefined, depth: number) => string | undefined;

const defaultRoleFormat: RoleLabelFormatter = ({ role, ordinal }) =>
  ordinal ? `${role} ${ordinal}` : role;

/**
 * Returns a stateful labeler that numbers book divisions per nesting depth:
 * chapters "Chapter 1, 2, …", parts "Part I, II, …", appendixes
 * "Appendix A, B, …". When a division is encountered at depth D, all
 * counters at depths > D are reset, so nested chapters under a new
 * sibling restart from 1:
 *
 *   Chapter 1
 *       Chapter 1
 *       Chapter 2
 *   Chapter 2
 *       Chapter 1
 *
 * Other bookmap roles keep their plain names (Preface, Notices, …).
 * Pass a formatter to control the display text (e.g. localized "第 1 章").
 */
export function createBookRoleLabeler(
  format: RoleLabelFormatter = defaultRoleFormat,
): RoleLabeler {
  let chapterCounters: number[] = [];
  let partCounters: number[] = [];
  let appendixCounters: number[] = [];

  /** Increments the counter at `depth`, truncating deeper entries. */
  const bump = (counters: number[], depth: number): number => {
    while (counters.length <= depth) counters.push(0);
    counters[depth]++;
    counters.length = depth + 1; // reset deeper counters for this type
    return counters[depth];
  };

  /** Resets all counter types at depths > `depth` (new sibling = fresh children). */
  const resetDeeperThan = (depth: number): void => {
    chapterCounters.length = Math.min(chapterCounters.length, depth + 1);
    partCounters.length = Math.min(partCounters.length, depth + 1);
    appendixCounters.length = Math.min(appendixCounters.length, depth + 1);
  };

  return (tagName, depth) => {
    if (!tagName) return undefined;
    const base = BOOKMAP_REF_ROLES[tagName];
    if (!base) return undefined;

    // Any recognized division resets deeper counters so nested divisions
    // under a new sibling restart from 1
    resetDeeperThan(depth);

    if (tagName === 'chapter')
      return format({ tagName, role: base, ordinal: String(bump(chapterCounters, depth)) });
    if (tagName === 'part')
      return format({ tagName, role: base, ordinal: toRoman(bump(partCounters, depth)) });
    if (tagName === 'appendix') {
      const n = bump(appendixCounters, depth);
      let letters = '';
      let m = n;
      while (m > 0) {
        m--;
        letters = String.fromCharCode(65 + (m % 26)) + letters;
        m = Math.floor(m / 26);
      }
      return format({ tagName, role: base, ordinal: letters });
    }
    return format({ tagName, role: base });
  };
}

/**
 * Plain-text map title. For bookmaps, <booktitle> groups <mainbooktitle>
 * with optional <booktitlealt>/<subtitle> — prefer the main title instead
 * of concatenating all inner text.
 */
export function getMapTitleText(root: DitaNode, resolveKey?: ResolveKey): string | undefined {
  const titleEl = (root.children || []).find(
    (c) => c.type === 'element' && c.baseType === 'map/map-title',
  );
  if (!titleEl) return undefined;
  const inner = (titleEl.children || []).filter(
    (c) => c.type === 'element' && c.baseType === 'map/map-title',
  );
  const source = inner.find((c) => c.tagName === 'mainbooktitle') || inner[0] || titleEl;
  const text = extractText(source, resolveKey).trim();
  return text || undefined;
}

function extractText(node: DitaNode, resolveKey?: ResolveKey): string {
  if (node.type === 'text') return node.text || '';
  const own = (node.children || []).map((c) => extractText(c, resolveKey)).join('');
  // Empty element carrying a keyref (e.g. <ph keyref="product"/>): substitute
  // the key value; element content wins over the keyref when both exist
  if (!own.trim() && resolveKey) {
    const keyref = node.attributes?.keyref;
    if (keyref) {
      const resolved = resolveKey(keyref);
      if (resolved) return resolved;
    }
  }
  return own;
}

function getNodeText(node: DitaNode, childBaseTypes: string[], resolveKey?: ResolveKey): string | undefined {
  for (const bt of childBaseTypes) {
    const child = (node.children || []).find(
      (c) => c.type === 'element' && c.baseType === bt,
    );
    if (child) {
      const text = extractText(child, resolveKey).trim();
      if (text) return text;
    }
  }
  return undefined;
}

export function getDisplayName(node: DitaNode, resolveKey?: ResolveKey): string {
  const keys = getAttr(node, 'keys');
  const href = getAttr(node, 'href');

  // Priority 1: topicmeta > navtitle
  // Priority 2: topicmeta > linktext
  const topicmeta = (node.children || []).find(
    (c) => c.type === 'element' && (c.baseType === 'map/topicmeta'),
  );
  if (topicmeta) {
    const metaText = getNodeText(topicmeta, ['map/navtitle', 'map/linktext', 'map/shortdesc'], resolveKey);
    if (metaText) return metaText;
    // keyword within topicmeta > keywords > keyword
    const keywords = topicmeta.children.find(
      (c) => c.type === 'element' && c.baseType === 'map/keywords',
    );
    if (keywords) {
      const kwText = getNodeText(keywords, ['map/keyword'], resolveKey);
      if (kwText) return kwText;
    }
  }

  // Priority 3: href filename without extension
  if (href) {
    const parts = href.replace(/\\/g, '/').split('/');
    const file = parts[parts.length - 1] || '';
    const dotIdx = file.lastIndexOf('.');
    if (dotIdx > 0) return file.substring(0, dotIdx);
    return file;
  }

  // Priority 4: keys attribute
  if (keys) return keys;

  // Fallback
  return '(unnamed)';
}

function isNavigable(node: DitaNode): boolean {
  const href = getAttr(node, 'href');
  return !!href;
}

/**
 * Own-attribute-only box+label for a map tree row, matching Oxygen: a box
 * is only drawn (once) around a topicref that itself declares a profiling
 * attribute, enclosing that topicref's whole subtree (nested <ul> included,
 * since .profiled wraps the whole <li>), with the label appearing once at
 * the bottom of that box -- not repeated on every descendant that merely
 * inherited the same attribute. data-profile-keys still needs the full
 * cascaded set for the Filter panel to hide inherited-only rows too; only
 * the visible chrome is scoped to what a node declares for itself.
 */
function ownProfilingMarkup(node: DitaNode): { boxClass: string; label: string } {
  const own = mergeProfilingAttrs(node.attributes, {});
  const ownKeys = profilingKeysAttr(own);
  return {
    boxClass: ownKeys ? ' profiled' : '',
    label: ownKeys ? `<span class="profiling-label">${profilingChipsHtml(own)}</span>` : '',
  };
}

function renderChildrenForNode(
  node: DitaNode,
  ctx: MapRenderContext,
  rendererFn: (node: DitaNode, ctx: MapRenderContext) => string,
): string {
  return (node.children || [])
    .filter((c) => c.type === 'element')
    .map((c) => rendererFn(c, ctx))
    .join('');
}

function renderRef(node: DitaNode, ctx: MapRenderContext, renderChildren: (node: DitaNode, ctx: MapRenderContext) => string): string {
  const href = getAttr(node, 'href') || '';
  const keys = getAttr(node, 'keys') || '';
  const displayName = getDisplayName(node, ctx.resolveKey);
  const nav = isNavigable(node);
  const depth = ctx.depth ?? 0;
  const role = ctx.roleLabel
    ? ctx.roleLabel(node.tagName, depth)
    : node.tagName
      ? BOOKMAP_REF_ROLES[node.tagName]
      : undefined;
  // This topicref's own profiling attributes, merged on top of whatever
  // cascaded down from its ancestors -- own values win over inherited ones
  // for the same attribute name. Children inherit this merged result, not
  // just this node's own attributes, so a.dita's rule reaches grandchildren
  // through b.dita even if b.dita sets nothing of its own.
  const effectiveProfiling = mergeProfilingAttrs(node.attributes, ctx.inheritedProfiling || {});
  // Children of a topicref are one level deeper
  const childCtx: MapRenderContext = { ...ctx, depth: depth + 1, inheritedProfiling: effectiveProfiling };
  const childrenHtml = renderChildrenForNode(node, childCtx, renderChildren);
  const badge = role ? `<span class="map-tree-badge">${escapeAttr(role)}</span>` : '';
  // data-profile-keys (for the Filter panel to actually hide this row) uses
  // the full cascaded set, same as always -- excluding an inherited
  // attribute's value still has to hide this row even if the row itself
  // never declared it. The visible box+label is scoped to what this node
  // declares for itself (see ownProfilingMarkup): Oxygen draws one box
  // around a topicref's own attribute, enclosing its whole subtree with
  // the label appearing once at the bottom, rather than re-labeling every
  // descendant with the same inherited chip.
  const profileKeys = profilingKeysAttr(effectiveProfiling);
  const profileAttr = profileKeys ? safeAttr('data-profile-keys', profileKeys) : '';
  const { boxClass, label: profileLabel } = ownProfilingMarkup(node);

  const icon = nav
    ? '<span class="map-tree-icon map-tree-icon--file">\u{1F4C4}</span>'
    : '<span class="map-tree-icon map-tree-icon--key">\u{1F511}</span>';

  const nameAttr = escapeAttr(displayName);
  const keyAttr = safeAttr('data-keys', keys);
  const hrefAttr = href ? safeAttr('data-href', href) : '';

  if (nav) {
    return `<li class="map-tree-item map-tree-item--nav${boxClass}"${keyAttr}${hrefAttr}${profileAttr}>
      <a href="#" class="map-tree-link" data-href="${escapeAttr(href)}">${icon}${badge}<span class="map-tree-label">${nameAttr}</span></a>
      ${childrenHtml ? `<ul class="map-tree">${childrenHtml}</ul>` : ''}
      ${profileLabel}
    </li>`;
  }

  return `<li class="map-tree-item map-tree-item--keydef${boxClass}"${keyAttr}${hrefAttr}${profileAttr}>
    ${icon}${badge}<span class="map-tree-label map-tree-label--keydef">${nameAttr}</span>
    ${childrenHtml ? `<ul class="map-tree">${childrenHtml}</ul>` : ''}
    ${profileLabel}
  </li>`;
}

export interface MapRenderContext {
  /** Base directory for resolving relative paths */
  docDir: string;
  /** Resolves a key name to its keydef value (for <ph keyref="..."/> etc.) */
  resolveKey?: ResolveKey;
  /** Callback to open a DITA file */
  onNavigate?: (href: string) => void;
  /** Stateful book-division labeler (numbered roles per nesting depth) */
  roleLabel?: RoleLabeler;
  /** Current nesting depth (for depth-aware role numbering) */
  depth?: number;
  /**
   * The effective (already-cascaded) profiling/conditional-processing
   * attributes inherited from this node's ancestor topicrefs in the map --
   * NOT anything from the referenced topic's own DITA source, which is a
   * separate, unrelated scope (see mergeProfilingAttrs in renderer.ts).
   * Each renderer merges its own node's attributes on top of this before
   * passing it down to its children.
   */
  inheritedProfiling?: Record<string, string>;
}

/**
 * Renders the map title block. A bookmap <booktitle> wraps <mainbooktitle>
 * plus optional <booktitlealt>/<subtitle>: elevate the main title to the
 * headline and show alternates as subtitle lines instead of concatenating
 * everything into a single string.
 */
function renderMapTitle(titleEl: DitaNode, ctx: MapRenderContext): string {
  const inner = (titleEl.children || []).filter(
    (c) => c.type === 'element' && c.baseType === 'map/map-title',
  );
  if (inner.length === 0) {
    return `<h1 class="map-title">${escapeAttr(extractText(titleEl, ctx.resolveKey).trim())}</h1>`;
  }
  const main = inner.find((c) => c.tagName === 'mainbooktitle') || inner[0];
  const subtitles = inner
    .filter((c) => c !== main)
    .map((c) => extractText(c, ctx.resolveKey).trim())
    .filter((t) => t)
    .map((t) => `<p class="book-subtitle">${escapeAttr(t)}</p>`)
    .join('');
  return `<div class="book-titlepage"><h1 class="map-title">${escapeAttr(extractText(main, ctx.resolveKey).trim())}</h1>${subtitles}</div>`;
}

const MAP_BASE_TYPE_RENDERERS: Record<string, Renderer> = {
  'map/map': (node, ctx, renderChildren) => {
    const titleEl = node.children.find(
      (c) => c.type === 'element' && c.baseType === 'map/map-title',
    );
    const titleHtml = titleEl ? renderMapTitle(titleEl, ctx) : '';
    const bodyChildren = node.children.filter(
      (c) => c.type !== 'element' || c.baseType !== 'map/map-title',
    );
    // A select-att set directly on <map> (rare, but valid DITA) applies as
    // the baseline every top-level topicref inherits from.
    const effectiveProfiling = mergeProfilingAttrs(node.attributes, ctx.inheritedProfiling || {});
    const bodyCtx: MapRenderContext = { ...ctx, inheritedProfiling: effectiveProfiling };
    const bodyHtml = bodyChildren
      .filter((c) => c.type === 'element')
      .map((c) => renderChildren(c, bodyCtx))
      .join('');
    return `<div class="ditamap-container">
      ${titleHtml}
      <ul class="map-tree">${bodyHtml}</ul>
    </div>`;
  },

  'map/map-title': (node, ctx, _renderChildren) =>
    `<h1 class="map-title">${escapeAttr(extractText(node, ctx.resolveKey))}</h1>`,

  'map/topicref': renderRef,
  'map/topichead': (node, ctx, renderChildren) => {
    const displayName = getDisplayName(node, ctx.resolveKey);
    const effectiveProfiling = mergeProfilingAttrs(node.attributes, ctx.inheritedProfiling || {});
    const childCtx: MapRenderContext = { ...ctx, depth: (ctx.depth ?? 0) + 1, inheritedProfiling: effectiveProfiling };
    const childrenHtml = renderChildrenForNode(node, childCtx, renderChildren);
    const profileKeys = profilingKeysAttr(effectiveProfiling);
    const profileAttr = profileKeys ? safeAttr('data-profile-keys', profileKeys) : '';
    const { boxClass, label: profileLabel } = ownProfilingMarkup(node);
    return `<li class="map-tree-item map-tree-item--head${boxClass}"${profileAttr}>
      <span class="map-tree-label map-tree-label--head">${escapeAttr(displayName)}</span>
      ${childrenHtml ? `<ul class="map-tree">${childrenHtml}</ul>` : ''}
      ${profileLabel}
    </li>`;
  },
  'map/topicgroup': (node, ctx, renderChildren) => {
    // topicgroup has no navtitle/entry of its own, but it can still carry
    // select-atts that its topicref children should inherit.
    const effectiveProfiling = mergeProfilingAttrs(node.attributes, ctx.inheritedProfiling || {});
    const childCtx: MapRenderContext = { ...ctx, inheritedProfiling: effectiveProfiling };
    const childrenHtml = renderChildrenForNode(node, childCtx, renderChildren);
    return `<li class="map-tree-item map-tree-item--group">
      <ul class="map-tree">${childrenHtml}</ul>
    </li>`;
  },
  'map/bookmap-structural': (node, ctx, renderChildren) => {
    // BookMap structural containers (frontmatter, booklists, toc, etc.)
    // render as visible non-navigable labels with nested children
    const displayName = node.tagName
      ? node.tagName.charAt(0).toUpperCase() + node.tagName.slice(1)
      : '(unnamed)';
    const effectiveProfiling = mergeProfilingAttrs(node.attributes, ctx.inheritedProfiling || {});
    const childCtx: MapRenderContext = { ...ctx, inheritedProfiling: effectiveProfiling };
    const childrenHtml = renderChildrenForNode(node, childCtx, renderChildren);
    const profileKeys = profilingKeysAttr(effectiveProfiling);
    const profileAttr = profileKeys ? safeAttr('data-profile-keys', profileKeys) : '';
    const { boxClass, label: profileLabel } = ownProfilingMarkup(node);
    return `<li class="map-tree-item map-tree-item--structural${boxClass}"${profileAttr}>
      <span class="map-tree-label map-tree-label--structural">${escapeAttr(displayName)}</span>
      ${childrenHtml ? `<ul class="map-tree">${childrenHtml}</ul>` : ''}
      ${profileLabel}
    </li>`;
  },
  'map/keydef': renderRef,

  'map/reltable': (node, ctx, renderChildren) => {
    const relbody = node.children.filter(
      (c) => c.type === 'element' && (c.baseType === 'map/relheader' || c.baseType === 'map/relrow'),
    );
    const bodyHtml = relbody.map((c) => renderChildren(c, ctx)).join('');
    return `<div class="map-reltable"><h2 class="map-reltable-title">Related Information</h2>
      <table class="map-reltable-table"><tbody>${bodyHtml}</tbody></table>
    </div>`;
  },
  'map/relheader': (node, ctx) => {
    // Per the DITA spec relheader contains relcolspec (not relcell); show
    // each column's title text as the header cell.
    const cells = node.children
      .filter((c) => c.type === 'element' && c.baseType === 'map/relcolspec')
      .map((c) => {
        const text = getAttr(c, 'navtitle') || extractText(c, ctx.resolveKey).trim();
        return escapeAttr(text);
      });
    return `<tr class="relheader">${cells.map((c) => `<th>${c}</th>`).join('')}</tr>`;
  },
  'map/relrow': (node, ctx, renderChildren) => {
    const cells = node.children
      .filter((c) => c.type === 'element' && c.baseType === 'map/relcell')
      .map((c) => renderChildren(c, ctx));
    return `<tr class="relrow">${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  },
  'map/relcell': (node, ctx, renderChildren) => {
    // relcell contains topicrefs, render them as an inline subtree
    const childrenHtml = renderChildrenForNode(node, ctx, renderChildren);
    return `<span class="relcell-content"><ul class="map-tree map-tree--inline">${childrenHtml}</ul></span>`;
  },
  'map/relcolspec': () => '',

  'map/topicmeta': () => '',
  'map/linktext': () => '',
  'map/navtitle': () => '',
  'map/shortdesc': () => '',
  'map/keywords': () => '',
  'map/keyword': () => '',
  'map/anchor': () => '',
  'map/navref': () => '',
  'map/mapref': renderRef,
};

export interface MapEntry {
  href?: string;
  displayName: string;
  depth: number;
  keys?: string;
  /** BookMap structural role, numbered in document order ("Chapter 1", "Appendix A", …) */
  role?: string;
  /**
   * data-profile-keys value for this topicref's own profiling attributes,
   * cascaded from ancestor topicrefs in the map (own value wins over an
   * inherited one for the same attribute name). This is map-level
   * profiling only, not anything from the referenced topic's own DITA
   * source -- book mode composites both into the same page, but they are
   * two independent scopes that just happen to share one filter panel.
   */
  profileKeys?: string;
  /** Pre-rendered "Attr [value]" chip HTML matching profileKeys, for display. */
  profileChipsHtml?: string;
}

function collectEntriesRecursive(
  node: DitaNode,
  depth: number,
  result: MapEntry[],
  resolveKey: ResolveKey | undefined,
  roleLabel: RoleLabeler,
  inheritedProfiling: Record<string, string>,
): void {
  if (node.type !== 'element') return;
  const baseType = node.baseType;

  // Skip reltable and its children
  if (baseType === 'map/reltable') return;

  if (baseType === 'map/topicref' || baseType === 'map/keydef' || baseType === 'map/mapref' || baseType === 'map/topichead') {
    const href = getAttr(node, 'href');
    const keys = getAttr(node, 'keys');
    const effectiveProfiling = mergeProfilingAttrs(node.attributes, inheritedProfiling);
    // profileKeys (drives whether the Filter panel hides this entry) uses
    // the full cascaded set -- an inherited-only entry still has to hide
    // when that value is excluded. profileChipsHtml, the *visible* chip,
    // only reflects this node's own declared attributes: showing the full
    // cascaded set here repeated the same ancestor chip on every single
    // descendant entry (see the matching fix in renderRef for tree mode,
    // which additionally wraps the whole subtree in one shared box --
    // book mode's entries are a flat list rather than a nested tree, so
    // that part isn't replicated here yet).
    const ownProfiling = mergeProfilingAttrs(node.attributes, {});
    result.push({
      href,
      displayName: getDisplayName(node, resolveKey),
      depth,
      keys,
      role: roleLabel(node.tagName, depth),
      profileKeys: profilingKeysAttr(effectiveProfiling) || undefined,
      profileChipsHtml: profilingChipsHtml(ownProfiling) || undefined,
    });
    // Recurse children at depth+1
    for (const child of node.children || []) {
      collectEntriesRecursive(child, depth + 1, result, resolveKey, roleLabel, effectiveProfiling);
    }
  } else if (baseType === 'map/topicgroup' || baseType === 'map/bookmap-structural') {
    // topicgroup / bookmap-structural: no entry itself, but they can still
    // carry select-atts that their descendants should inherit.
    const effectiveProfiling = mergeProfilingAttrs(node.attributes, inheritedProfiling);
    for (const child of node.children || []) {
      collectEntriesRecursive(child, depth, result, resolveKey, roleLabel, effectiveProfiling);
    }
  } else {
    for (const child of node.children || []) {
      collectEntriesRecursive(child, depth, result, resolveKey, roleLabel, inheritedProfiling);
    }
  }
}

export function collectMapEntries(
  root: DitaNode,
  resolveKey?: ResolveKey,
  roleFormat?: RoleLabelFormatter,
): MapEntry[] {
  const result: MapEntry[] = [];
  const roleLabel = createBookRoleLabeler(roleFormat);
  // A select-att set directly on <map> (rare, but valid DITA) applies as
  // the baseline every top-level topicref inherits from.
  const rootProfiling = mergeProfilingAttrs(root.attributes, {});
  // Start from map's children at depth 0
  for (const child of root.children || []) {
    collectEntriesRecursive(child, 0, result, resolveKey, roleLabel, rootProfiling);
  }
  return result;
}

export function renderMapDocument(
  root: DitaNode,
  options: { docDir: string; resolveKey?: ResolveKey; roleFormat?: RoleLabelFormatter },
): string {
  function renderElement(node: DitaNode, ctx: MapRenderContext): string {
    if (node.type === 'text') return '';
    const baseType = node.baseType;
    const renderer = baseType ? MAP_BASE_TYPE_RENDERERS[baseType] : undefined;
    if (renderer) {
      return renderer(node, ctx, renderElement);
    }
    return renderChildrenForNode(node, ctx, renderElement);
  }

  const ctx: MapRenderContext = {
    docDir: options.docDir,
    resolveKey: options.resolveKey,
    roleLabel: createBookRoleLabeler(options.roleFormat),
    depth: 0,
  };

  return renderElement(root, ctx);
}
