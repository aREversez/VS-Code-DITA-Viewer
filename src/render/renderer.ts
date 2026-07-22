import { DitaNode, SourceRange } from '../parser/domTypes';
import { BASE_TYPE_RENDERERS } from './baseTypeMap';

export interface RenderContext {
  headingLevel: number;
  asWebviewUri: (path: string) => string;
  documentDir: string;
  parentBaseType?: string;
  resolveTitle?: (id: string) => string | undefined;
  resolveKey?: (key: string) => string | undefined;
  resolveConref?: (conref: string) => string | undefined;
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

function injectAttributes(html: string, tagName: string, line: number): string {
  return html.replace(/^<([a-zA-Z][a-zA-Z0-9]*)/, `<$1 title="${tagName}" data-line="${line}"`);
}

function makeTextNode(text: string, sourceRange: SourceRange): DitaNode {
  return { type: 'text', text, children: [], sourceRange };
}

function resolveConrefForNode(node: DitaNode, context: RenderContext): DitaNode {
  const conref = node.attributes?.conref;
  if (!conref || !context.resolveConref) return node;
  const resolved = context.resolveConref(conref);
  if (!resolved) return node;
  // Strip conref after resolving, replace children with resolved text
  const restAttrs = Object.fromEntries(
    Object.entries(node.attributes || {}).filter(([k]) => k !== 'conref')
  );
  return { ...node, children: [makeTextNode(resolved, node.sourceRange)], attributes: restAttrs };
}

function renderElement(node: DitaNode, context: RenderContext): string {
  if (node.type === 'text') {
    return escapeHtml(node.text || '');
  }

  const effectiveNode = resolveConrefForNode(node, context);
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
      html = injectAttributes(html, tagName, effectiveNode.sourceRange.startLine);
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
