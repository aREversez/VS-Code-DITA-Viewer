import { DitaNode, SourceRange } from '../parser/domTypes';
import { BASE_TYPE_RENDERERS } from './baseTypeMap';

export interface RenderContext {
  headingLevel: number;
  asWebviewUri: (path: string) => string;
  documentDir: string;
  parentBaseType?: string;
  resolveTitle?: (id: string) => string | undefined;
  resolveKey?: (key: string) => string | undefined;
  resolveConref?: (conref: string) => DitaNode | undefined;
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function injectAttributes(html: string, tagName: string, range: SourceRange): string {
  return html.replace(
    /^<([a-zA-Z][a-zA-Z0-9]*)/,
    `<$1 title="${tagName}" data-line="${range.startLine}" data-end-line="${range.endLine}" data-start-col="${range.startCol}" data-end-col="${range.endCol}"`,
  );
}

function resolveConrefForNode(node: DitaNode, context: RenderContext): DitaNode {
  const conref = node.attributes?.conref;
  if (!conref || !context.resolveConref) return node;
  const target = context.resolveConref(conref);
  if (!target) return node;

  // Strip conref from the referencing element's attributes
  const restAttrs = Object.fromEntries(
    Object.entries(node.attributes || {}).filter(([k]) => k !== 'conref')
  );

  // When the target element has the same baseType as the referencing
  // element, preserve the referencing element's tag/attributes and only
  // replace its children with the target's children (DITA conref
  // semantics for same-type references).
  if (target.baseType && target.baseType === node.baseType) {
    return { ...node, children: target.children || [], attributes: restAttrs };
  }

  // When the target element has a DIFFERENT type (e.g. <ph conref> that
  // references a <filepath>), replace the entire element with the target
  // so its tag and baseType are preserved. Attributes on the referencing
  // element (except conref) take precedence per the DITA spec.
  const targetAttrs = Object.fromEntries(
    Object.entries(target.attributes || {})
      .filter(([k]) => k !== 'conref' && k !== 'id')
  );
  return { ...target, attributes: { ...targetAttrs, ...restAttrs } };
}

function resolveKeyrefForNode(node: DitaNode, context: RenderContext): DitaNode {
  const keyref = node.attributes?.keyref;
  if (!keyref || !context.resolveKey) return node;
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

function renderElement(node: DitaNode, context: RenderContext): string {
  if (node.type === 'text') {
    return escapeHtml(node.text || '');
  }

  let effectiveNode = resolveConrefForNode(node, context);
  effectiveNode = resolveKeyrefForNode(effectiveNode, context);
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
  };

  if (renderer) {
    let html = renderer(effectiveNode, childCtx, renderChildren);
    if (baseType && !PASS_THROUGH_BASETYPES.has(baseType)) {
      const tagName = effectiveNode.tagName || baseType.split('/').pop() || baseType;
      html = injectAttributes(html, tagName, effectiveNode.sourceRange);
    }
    return html;
  }

  return renderChildren(effectiveNode, childCtx);
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