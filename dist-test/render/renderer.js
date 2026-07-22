"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderDocument = renderDocument;
const baseTypeMap_1 = require("./baseTypeMap");
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
function isContainerBaseType(baseType) {
    return CONTAINER_BASETYPES.has(baseType);
}
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function injectAttributes(html, tagName, line) {
    return html.replace(/^<([a-zA-Z][a-zA-Z0-9]*)/, `<$1 title="${tagName}" data-line="${line}"`);
}
function makeTextNode(text, sourceRange) {
    return { type: 'text', text, children: [], sourceRange };
}
function resolveConrefForNode(node, context) {
    const conref = node.attributes?.conref;
    if (!conref || !context.resolveConref)
        return node;
    const resolved = context.resolveConref(conref);
    if (!resolved)
        return node;
    // Strip conref after resolving, replace children with resolved text
    const { conref: _unused, ...restAttrs } = node.attributes || {};
    return { ...node, children: [makeTextNode(resolved, node.sourceRange)], attributes: restAttrs };
}
function renderElement(node, context) {
    if (node.type === 'text') {
        return escapeHtml(node.text || '');
    }
    const effectiveNode = resolveConrefForNode(node, context);
    const baseType = effectiveNode.baseType;
    const renderer = baseType ? baseTypeMap_1.BASE_TYPE_RENDERERS[baseType] : undefined;
    const isContainer = baseType ? isContainerBaseType(baseType) : false;
    const nextHeadingLevel = isContainer
        ? context.headingLevel + 1
        : context.headingLevel;
    const childCtx = {
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
function renderChildren(node, context) {
    return (node.children || []).map((child) => renderElement(child, context)).join('');
}
function renderDocument(root, context) {
    return renderElement(root, context);
}
//# sourceMappingURL=renderer.js.map