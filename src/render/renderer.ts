import { DitaNode } from '../parser/domTypes';
import { BASE_TYPE_RENDERERS } from './baseTypeMap';

export interface RenderContext {
  headingLevel: number;
  asWebviewUri: (path: string) => string;
  documentDir: string;
  parentBaseType?: string;
  resolveTitle?: (id: string) => string | undefined;
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

function renderElement(node: DitaNode, context: RenderContext): string {
  if (node.type === 'text') {
    return escapeHtml(node.text || '');
  }

  const baseType = node.baseType;
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
    let html = renderer(node, childCtx, renderChildren);
    if (baseType && !PASS_THROUGH_BASETYPES.has(baseType)) {
      const tagName = node.tagName || baseType.split('/').pop() || baseType;
      html = injectAttributes(html, tagName, node.sourceRange.startLine);
    }
    return html;
  }

  return renderChildren(node, childCtx);
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
