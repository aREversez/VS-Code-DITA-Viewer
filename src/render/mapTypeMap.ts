import { DitaNode } from '../parser/domTypes';

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

const defaultRoleFormat: RoleLabelFormatter = ({ role, ordinal }) =>
  ordinal ? `${role} ${ordinal}` : role;

/**
 * Returns a stateful labeler that numbers book divisions in document order:
 * chapters "Chapter 1, 2, …", parts "Part I, II, …", appendixes
 * "Appendix A, B, …"; other bookmap roles keep their plain names.
 * Pass a formatter to control the display text (e.g. localized "第 1 章").
 */
export function createBookRoleLabeler(
  format: RoleLabelFormatter = defaultRoleFormat,
): (tagName: string | undefined) => string | undefined {
  let chapters = 0;
  let parts = 0;
  let appendixes = 0;
  return (tagName) => {
    if (!tagName) return undefined;
    const base = BOOKMAP_REF_ROLES[tagName];
    if (!base) return undefined;
    if (tagName === 'chapter') return format({ tagName, role: base, ordinal: String(++chapters) });
    if (tagName === 'part') return format({ tagName, role: base, ordinal: toRoman(++parts) });
    if (tagName === 'appendix') {
      appendixes++;
      // A, B, … Z, AA, AB, …
      let n = appendixes;
      let letters = '';
      while (n > 0) {
        n--;
        letters = String.fromCharCode(65 + (n % 26)) + letters;
        n = Math.floor(n / 26);
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
  const role = ctx.roleLabel
    ? ctx.roleLabel(node.tagName)
    : node.tagName
      ? BOOKMAP_REF_ROLES[node.tagName]
      : undefined;
  const childrenHtml = renderChildrenForNode(node, ctx, renderChildren);
  const badge = role ? `<span class="map-tree-badge">${escapeAttr(role)}</span>` : '';

  const icon = nav
    ? '<span class="map-tree-icon map-tree-icon--file">\u{1F4C4}</span>'
    : '<span class="map-tree-icon map-tree-icon--key">\u{1F511}</span>';

  const nameAttr = escapeAttr(displayName);
  const keyAttr = safeAttr('data-keys', keys);
  const hrefAttr = href ? safeAttr('data-href', href) : '';

  if (nav) {
    return `<li class="map-tree-item map-tree-item--nav"${keyAttr}${hrefAttr}>
      <a href="#" class="map-tree-link" data-href="${escapeAttr(href)}">${icon}${badge}<span class="map-tree-label">${nameAttr}</span></a>
      ${childrenHtml ? `<ul class="map-tree">${childrenHtml}</ul>` : ''}
    </li>`;
  }

  return `<li class="map-tree-item map-tree-item--keydef"${keyAttr}${hrefAttr}>
    ${icon}${badge}<span class="map-tree-label map-tree-label--keydef">${nameAttr}</span>
    ${childrenHtml ? `<ul class="map-tree">${childrenHtml}</ul>` : ''}
  </li>`;
}

export interface MapRenderContext {
  /** Base directory for resolving relative paths */
  docDir: string;
  /** Resolves a key name to its keydef value (for <ph keyref="..."/> etc.) */
  resolveKey?: ResolveKey;
  /** Callback to open a DITA file */
  onNavigate?: (href: string) => void;
  /** Stateful book-division labeler (numbered roles in document order) */
  roleLabel?: (tagName: string | undefined) => string | undefined;
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
    const bodyHtml = bodyChildren
      .filter((c) => c.type === 'element')
      .map((c) => renderChildren(c, ctx))
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
    const childrenHtml = renderChildrenForNode(node, ctx, renderChildren);
    return `<li class="map-tree-item map-tree-item--head">
      <span class="map-tree-label map-tree-label--head">${escapeAttr(displayName)}</span>
      ${childrenHtml ? `<ul class="map-tree">${childrenHtml}</ul>` : ''}
    </li>`;
  },
  'map/topicgroup': (node, ctx, renderChildren) => {
    const childrenHtml = renderChildrenForNode(node, ctx, renderChildren);
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
    const childrenHtml = renderChildrenForNode(node, ctx, renderChildren);
    return `<li class="map-tree-item map-tree-item--structural">
      <span class="map-tree-label map-tree-label--structural">${escapeAttr(displayName)}</span>
      ${childrenHtml ? `<ul class="map-tree">${childrenHtml}</ul>` : ''}
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
  'map/relheader': (node, ctx, renderChildren) => {
    const cells = node.children
      .filter((c) => c.type === 'element' && c.baseType === 'map/relcell')
      .map((c) => renderChildren(c, ctx));
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
}

function collectEntriesRecursive(
  node: DitaNode,
  depth: number,
  result: MapEntry[],
  resolveKey: ResolveKey | undefined,
  roleLabel: (tagName: string | undefined) => string | undefined,
): void {
  if (node.type !== 'element') return;
  const baseType = node.baseType;

  // Skip reltable and its children
  if (baseType === 'map/reltable') return;

  if (baseType === 'map/topicref' || baseType === 'map/keydef' || baseType === 'map/mapref' || baseType === 'map/topichead') {
    const href = getAttr(node, 'href');
    const keys = getAttr(node, 'keys');
    result.push({
      href,
      displayName: getDisplayName(node, resolveKey),
      depth,
      keys,
      role: roleLabel(node.tagName),
    });
    // Recurse children at depth+1
    for (const child of node.children || []) {
      collectEntriesRecursive(child, depth + 1, result, resolveKey, roleLabel);
    }
  } else if (baseType === 'map/topicgroup' || baseType === 'map/bookmap-structural') {
    // topicgroup / bookmap-structural: no entry itself, but recurse at same depth
    for (const child of node.children || []) {
      collectEntriesRecursive(child, depth, result, resolveKey, roleLabel);
    }
  } else {
    for (const child of node.children || []) {
      collectEntriesRecursive(child, depth, result, resolveKey, roleLabel);
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
  // Start from map's children at depth 0
  for (const child of root.children || []) {
    collectEntriesRecursive(child, 0, result, resolveKey, roleLabel);
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
  };

  return renderElement(root, ctx);
}
