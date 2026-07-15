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

function extractText(node: DitaNode): string {
  if (node.type === 'text') return node.text || '';
  return (node.children || []).map(extractText).join('');
}

function getNodeText(node: DitaNode, childBaseTypes: string[]): string | undefined {
  for (const bt of childBaseTypes) {
    const child = (node.children || []).find(
      (c) => c.type === 'element' && c.baseType === bt,
    );
    if (child) {
      const text = extractText(child).trim();
      if (text) return text;
    }
  }
  return undefined;
}

function getDisplayName(node: DitaNode): string {
  const keys = getAttr(node, 'keys');
  const href = getAttr(node, 'href');

  // Priority 1: topicmeta > navtitle
  // Priority 2: topicmeta > linktext
  const topicmeta = (node.children || []).find(
    (c) => c.type === 'element' && (c.baseType === 'map/topicmeta'),
  );
  if (topicmeta) {
    const metaText = getNodeText(topicmeta, ['map/navtitle', 'map/linktext', 'map/shortdesc']);
    if (metaText) return metaText;
    // keyword within topicmeta > keywords > keyword
    const keywords = topicmeta.children.find(
      (c) => c.type === 'element' && c.baseType === 'map/keywords',
    );
    if (keywords) {
      const kwText = getNodeText(keywords, ['map/keyword']);
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
  const displayName = getDisplayName(node);
  const nav = isNavigable(node);
  const childrenHtml = renderChildrenForNode(node, ctx, renderChildren);

  const icon = nav
    ? '<span class="map-tree-icon map-tree-icon--file">\u{1F4C4}</span>'
    : '<span class="map-tree-icon map-tree-icon--key">\u{1F511}</span>';

  const nameAttr = escapeAttr(displayName);
  const keyAttr = safeAttr('data-keys', keys);
  const hrefAttr = href ? safeAttr('data-href', href) : '';

  if (nav) {
    return `<li class="map-tree-item map-tree-item--nav"${keyAttr}${hrefAttr}>
      <a href="#" class="map-tree-link" data-href="${escapeAttr(href)}">${icon}<span class="map-tree-label">${nameAttr}</span></a>
      ${childrenHtml ? `<ul class="map-tree">${childrenHtml}</ul>` : ''}
    </li>`;
  }

  return `<li class="map-tree-item map-tree-item--keydef"${keyAttr}${hrefAttr}>
    ${icon}<span class="map-tree-label map-tree-label--keydef">${nameAttr}</span>
    ${childrenHtml ? `<ul class="map-tree">${childrenHtml}</ul>` : ''}
  </li>`;
}

export interface MapRenderContext {
  /** Base directory for resolving relative paths */
  docDir: string;
  /** Callback to open a DITA file */
  onNavigate?: (href: string) => void;
}

const MAP_BASE_TYPE_RENDERERS: Record<string, Renderer> = {
  'map/map': (node, ctx, renderChildren) => {
    const titleEl = node.children.find(
      (c) => c.type === 'element' && c.baseType === 'map/map-title',
    );
    const titleHtml = titleEl
      ? `<h1 class="map-title">${extractText(titleEl)}</h1>`
      : '';
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

  'map/map-title': (node, _ctx, _renderChildren) =>
    `<h1 class="map-title">${escapeAttr(extractText(node))}</h1>`,

  'map/topicref': renderRef,
  'map/topichead': (node, ctx, renderChildren) => {
    const displayName = getDisplayName(node);
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
  'map/mapref': () => '',
};

export function renderMapDocument(root: DitaNode, options: { docDir: string }): string {
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
  };

  return renderElement(root, ctx);
}
