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
function renderElement(node, context) {
    if (node.type === 'text') {
        return escapeHtml(node.text || '');
    }
    const baseType = node.baseType;
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
        let html = renderer(node, childCtx, renderChildren);
        if (baseType && !PASS_THROUGH_BASETYPES.has(baseType)) {
            const tagName = node.tagName || baseType.split('/').pop() || baseType;
            html = injectAttributes(html, tagName, node.sourceRange.startLine);
        }
        return html;
    }
    return renderChildren(node, childCtx);
}
function renderChildren(node, context) {
    return (node.children || []).map((child) => renderElement(child, context)).join('');
}
function renderDocument(root, context) {
    return renderElement(root, context);
}
//# sourceMappingURL=renderer.js.map