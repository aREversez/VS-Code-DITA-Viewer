import { DitaNode, SourceRange } from '../parser/domTypes';
import { BASE_TYPE_RENDERERS } from './baseTypeMap';

export interface RenderContext {
  headingLevel: number;
  asWebviewUri: (path: string) => string;
  documentDir: string;
  parentBaseType?: string;
  /** True while rendering descendants of thead/sthead (entry/stentry → th) */
  inTableHeader?: boolean;
  /** Conref targets already resolved on this branch (cycle protection) */
  conrefChain?: ReadonlySet<string>;
  resolveTitle?: (id: string) => string | undefined;
  resolveKey?: (key: string) => string | undefined;
  resolveConref?: (conref: string) => DitaNode | undefined;
  /** conrefend range support — see renderConrefRange below */
  resolveConrefRange?: (conref: string, conrefend: string) => DitaNode[] | undefined;
  noteLabels?: Record<string, string>;
}

const CONTAINER_BASETYPES = new Set([
  'topic/section',
  'topic/example',
  'topic/fig',
  'topic/related-links',
]);

const PASS_THROUGH_BASETYPES = new Set([
  'topic/tgroup',
  'topic/link',
  'topic/linktext',
]);

function isContainerBaseType(baseType: string): boolean {
  return CONTAINER_BASETYPES.has(baseType);
}

// ── Profiling / conditional-processing attribute highlighting ──
// Per the OASIS DITA 1.3 select-atts entity (commonElements.mod): the full
// set of attributes conditional-processing tools (Oxygen's "Conditional
// Text" / DITA-OT's .ditaval) act on is props, platform, product, audience,
// otherprops (the filter-atts subgroup), plus base, importance, rev, and
// status. This only *highlights* profiled content (matches it visually, the
// way Oxygen shows profiling by default) — it does not hide anything; that
// would be a real conditional-processing engine (a .ditaval-driven filter),
// which is a separate, larger feature this doesn't attempt.
const PROFILING_ATTRS = ['props', 'platform', 'product', 'audience', 'otherprops', 'base', 'importance', 'rev', 'status'];

const PROFILING_ATTR_LABELS: Record<string, string> = {
  otherprops: 'Other',
};

function profilingAttrLabel(attr: string): string {
  return PROFILING_ATTR_LABELS[attr] || attr.charAt(0).toUpperCase() + attr.slice(1);
}

// ── Shared with the ditamap renderer (mapTypeMap.ts) ──
// A topicref's profiling attributes cascade to every descendant topicref
// that doesn't set its own value for the same attribute (own value replaces
// the inherited one wholesale, it doesn't merge token-by-token — this
// matches real .ditaval/Oxygen conditional-processing semantics, and is
// also how DITA-OT itself resolves the same attribute set at different
// levels of a map). mapTypeMap.ts calls this while walking the map tree so
// each topicref/topichead/topicgroup gets the correctly cascaded effective
// set, including through map-of-maps (expandDitamapRefs has already
// flattened those into the same tree by the time this runs).
export function mergeProfilingAttrs(
  own: Record<string, string> | undefined,
  inherited: Record<string, string>,
): Record<string, string> {
  const effective: Record<string, string> = { ...inherited };
  const attrs = own || {};
  for (const name of PROFILING_ATTRS) {
    const v = attrs[name];
    if (v && v.trim()) effective[name] = v;
  }
  return effective;
}

/** The data-profile-keys attribute value the webview's filter panel keys off of. */
export function profilingKeysAttr(effective: Record<string, string>): string {
  const chips = getProfilingChipsFromEffective(effective);
  return chips.map((c) => `${encodeURIComponent(c.attr)}:${encodeURIComponent(c.value)}`).join(',');
}

/** Human-readable "Attr [value]" chip spans, for visual display next to a map entry. */
export function profilingChipsHtml(effective: Record<string, string>): string {
  return getProfilingChipsFromEffective(effective)
    .map((c) => `<span class="profiling-chip">${escapeHtml(profilingAttrLabel(c.attr))} <span class="profiling-chip__value">[${escapeHtml(c.value)}]</span></span>`)
    .join('');
}

function getProfilingChipsFromEffective(effective: Record<string, string>): { attr: string; value: string }[] {
  const chips: { attr: string; value: string }[] = [];
  for (const name of PROFILING_ATTRS) {
    const raw = effective[name];
    if (!raw) continue;
    for (const token of raw.trim().split(/\s+/)) {
      if (token) chips.push({ attr: name, value: token });
    }
  }
  return chips;
}

// Elements commonly authored inline, within a sentence — highlighting these
// as a full-width block would break the surrounding text flow, so they get
// an inline-flavored wrapper instead. Not an exhaustive classification (the
// renderer has no general block/inline taxonomy to draw on); anything not
// listed here defaults to the block treatment, which matches the more
// common case of profiling applied at paragraph/step/section granularity
// (as in the reported example) rather than to individual inline phrases.
const INLINE_PROFILING_BASETYPES = new Set([
  'topic/ph', 'topic/b', 'topic/i', 'topic/u', 'topic/sup', 'topic/sub',
  'topic/term', 'topic/keyword', 'topic/tm', 'topic/xref', 'topic/cite',
  'topic/q', 'topic/filepath', 'topic/userinput', 'topic/systemoutput',
  'topic/varname', 'topic/cmdname', 'topic/wintitle', 'topic/uicontrol',
  'topic/menucascade', 'topic/shortcut',
]);

function getProfilingChips(node: DitaNode): { attr: string; value: string }[] {
  return getProfilingChipsFromEffective(node.attributes || {});
}

function wrapProfilingHighlight(html: string, node: DitaNode): string {
  const chips = getProfilingChips(node);
  if (chips.length === 0) return html;
  const inline = node.baseType ? INLINE_PROFILING_BASETYPES.has(node.baseType) : false;
  const labelHtml = chips
    .map((c) => `<span class="profiling-chip">${escapeHtml(profilingAttrLabel(c.attr))} <span class="profiling-chip__value">[${escapeHtml(c.value)}]</span></span>`)
    .join('');
  const cls = inline ? 'profiled profiled--inline' : 'profiled';
  // Machine-readable twin of the human-readable chips above, for the
  // toolbar's filter panel (webview-side) to key visibility off of without
  // re-parsing chip text. encodeURIComponent on each part keeps the ':'/','
  // delimiters unambiguous regardless of what characters appear in a real
  // attribute value (DITA doesn't restrict these to a safe token charset).
  const keysAttr = chips
    .map((c) => `${encodeURIComponent(c.attr)}:${encodeURIComponent(c.value)}`)
    .join(',');
  return `<span class="${cls}" data-profile-keys="${escapeHtml(keysAttr)}">${html}<span class="profiling-label">${labelHtml}</span></span>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function injectAttributes(html: string, tagName: string, range: SourceRange): string {
  // A renderer's own `title=` (checked only within its opening tag, not
  // inside any nested children's markup) wins over the generic
  // tag-name-as-tooltip fallback — otherwise the generic one lands first
  // in the tag and, per HTML5's first-duplicate-wins parsing rule, silently
  // shadows whatever the renderer intended (e.g. topic/image using the
  // resolved alt text as its tooltip instead of the literal word "image").
  const openTagEnd = html.indexOf('>');
  const openTag = openTagEnd >= 0 ? html.slice(0, openTagEnd) : html;
  const hasOwnTitle = / title="/.test(openTag);
  const titlePart = hasOwnTitle ? '' : ` title="${tagName}"`;
  return html.replace(
    /^<([a-zA-Z][a-zA-Z0-9]*)/,
    `<$1${titlePart} data-line="${range.startLine}" data-end-line="${range.endLine}" data-start-col="${range.startCol}" data-end-col="${range.endCol}"`,
  );
}

// Shared by both a normal single-target conref and the first member of a
// conrefend range: the referencing element's own attributes (minus
// conref/conrefend) take precedence, and its tag/baseType is kept when the
// target is the same baseType (DITA's "same-type" conref semantics) —
// otherwise the target's tag/baseType wins instead, since a same-shaped
// substitution isn't possible.
function mergeConrefTarget(node: DitaNode, target: DitaNode): DitaNode {
  const restAttrs = Object.fromEntries(
    Object.entries(node.attributes || {}).filter(([k]) => k !== 'conref' && k !== 'conrefend')
  );
  if (target.baseType && target.baseType === node.baseType) {
    return { ...node, children: target.children || [], attributes: restAttrs };
  }
  const targetAttrs = Object.fromEntries(
    Object.entries(target.attributes || {})
      .filter(([k]) => k !== 'conref' && k !== 'conrefend' && k !== 'id')
  );
  return { ...target, attributes: { ...targetAttrs, ...restAttrs } };
}

function resolveConrefForNode(node: DitaNode, context: RenderContext): DitaNode {
  const conref = node.attributes?.conref;
  if (!conref || !context.resolveConref) return node;
  // A conref already resolved on this branch points back here — stop the
  // cycle and render the element's literal content instead of recursing.
  if (context.conrefChain?.has(conref)) return node;
  const target = context.resolveConref(conref);
  if (!target) return node;
  return mergeConrefTarget(node, target);
}

function resolveKeyrefForNode(node: DitaNode, context: RenderContext): DitaNode {
  const keyref = node.attributes?.keyref;
  if (!keyref || !context.resolveKey) return node;
  // Per the DITA spec, existing element content wins over the key-resolved
  // text — only substitute when the element is effectively empty.
  const hasLocalContent = (node.children || []).some(
    (c) => c.type === 'element' || (c.text || '').trim() !== '',
  );
  if (hasLocalContent) return node;
  const resolved = context.resolveKey(keyref);
  if (!resolved) return node;
  // Strip keyref after resolving, replace children with resolved text
  const restAttrs = Object.fromEntries(
    Object.entries(node.attributes || {}).filter(([k]) => k !== 'keyref')
  );
  return {
    ...node,
    children: [{ type: 'text', text: resolved, children: [], sourceRange: node.sourceRange }],
    attributes: restAttrs,
  };
}

// The "given a fully-resolved node, actually render it" half of
// renderElement — factored out so the conrefend range path below can reuse
// it for the merged first range member without re-running conref/keyref
// resolution on something that's already resolved.
function renderEffectiveNode(effectiveNode: DitaNode, context: RenderContext, resolvedConref: string | undefined): string {
  const baseType = effectiveNode.baseType;
  const renderer = baseType ? BASE_TYPE_RENDERERS[baseType] : undefined;

  const isContainer = baseType ? isContainerBaseType(baseType) : false;
  const nextHeadingLevel = isContainer
    ? context.headingLevel + 1
    : context.headingLevel;

  const childCtx: RenderContext = {
    ...context,
    headingLevel: nextHeadingLevel,
    parentBaseType: baseType,
    conrefChain: resolvedConref
      ? new Set([...(context.conrefChain || []), resolvedConref])
      : context.conrefChain,
  };

  if (renderer) {
    let html = renderer(effectiveNode, childCtx, renderChildren);
    if (baseType && !PASS_THROUGH_BASETYPES.has(baseType)) {
      const tagName = effectiveNode.tagName || baseType.split('/').pop() || baseType;
      html = injectAttributes(html, tagName, effectiveNode.sourceRange);
      html = wrapProfilingHighlight(html, effectiveNode);
    }
    return html;
  }

  return wrapProfilingHighlight(renderChildren(effectiveNode, childCtx), effectiveNode);
}

// conrefend replaces a *single* referencing element with a *run* of
// elements pulled from the target document (the conref target through the
// conrefend target, inclusive) — a fundamentally different shape from
// normal conref's one-for-one substitution, so it's handled as its own
// path rather than folded into resolveConrefForNode. Only the first
// element in the range takes on the referencing element's own
// tag/attributes (mergeConrefTarget, same rule as normal conref) — the
// rest render as themselves, straight from the target document, since
// there's no second referencing element for them to inherit from.
//
// Known limitation: range members after the first carry the target
// document's own sourceRange (line numbers in *that* file), not the
// referencing document's — so data-line-based scroll-sync/highlighting
// for those elements will point at the wrong file. Flagging rather than
// working around, since a real fix (rewriting sourceRange to something
// meaningful in a file those lines don't belong to) would be inventing
// numbers, not fixing a bug.
function renderConrefRange(node: DitaNode, range: DitaNode[], context: RenderContext, conref: string): string {
  return range
    .map((rangeNode, i) => {
      if (i === 0) {
        const merged = mergeConrefTarget(node, rangeNode);
        return renderEffectiveNode(merged, context, conref);
      }
      return renderElement(rangeNode, context);
    })
    .join('');
}

function renderElement(node: DitaNode, context: RenderContext): string {
  if (node.type === 'text') {
    return escapeHtml(node.text || '');
  }

  const conref = node.attributes?.conref;
  const conrefend = node.attributes?.conrefend;
  if (conref && conrefend && context.resolveConrefRange && !context.conrefChain?.has(conref)) {
    const range = context.resolveConrefRange(conref, conrefend);
    // A range that fails to resolve (e.g. the two ids aren't siblings, or
    // one doesn't exist) falls through to normal single-target conref
    // handling below instead — showing the conref target alone is a more
    // useful degradation than showing nothing.
    if (range && range.length > 0) {
      return renderConrefRange(node, range, context, conref);
    }
  }

  let effectiveNode = resolveConrefForNode(node, context);
  const resolvedConref =
    effectiveNode !== node ? node.attributes?.conref : undefined;
  effectiveNode = resolveKeyrefForNode(effectiveNode, context);
  return renderEffectiveNode(effectiveNode, context, resolvedConref);
}

function renderChildren(node: DitaNode, context: RenderContext): string {
  return (node.children || []).map((child) => renderElement(child, context)).join('');
}

export function renderDocument(
  root: DitaNode,
  context: RenderContext,
): string {
  return renderElement(root, context);
}