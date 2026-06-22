"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BASE_TYPE_RENDERERS = void 0;
function isInThead(ctx) {
    return ctx.parentBaseType === 'topic/thead';
}
function getAttr(node, name) {
    return node.attributes?.[name];
}
exports.BASE_TYPE_RENDERERS = {
    'topic/topic': (node, ctx, renderChildren) => {
        const id = getAttr(node, 'id');
        return `<article${id ? ` id="${id}"` : ''} class="topic">${renderChildren(node, ctx)}</article>`;
    },
    'topic/title': (node, ctx, renderChildren) => {
        const level = Math.min(ctx.headingLevel, 6);
        return `<h${level}>${renderChildren(node, ctx)}</h${level}>`;
    },
    'topic/shortdesc': (node, ctx, renderChildren) => {
        return `<p class="shortdesc">${renderChildren(node, ctx)}</p>`;
    },
    'topic/body': (node, ctx, renderChildren) => {
        return `<main class="body">${renderChildren(node, ctx)}</main>`;
    },
    'topic/section': (node, ctx, renderChildren) => {
        const id = getAttr(node, 'id');
        return `<section${id ? ` id="${id}"` : ''}>${renderChildren(node, ctx)}</section>`;
    },
    'topic/example': (node, ctx, renderChildren) => {
        const id = getAttr(node, 'id');
        return `<section${id ? ` id="${id}"` : ''} class="example">${renderChildren(node, ctx)}</section>`;
    },
    'topic/p': (_node, ctx, renderChildren) => {
        return `<p>${renderChildren(_node, ctx)}</p>`;
    },
    'topic/note': (node, ctx, renderChildren) => {
        const type = getAttr(node, 'type') || 'note';
        return `<div class="note note--${type}"><span class="note__label">${type}:</span> ${renderChildren(node, ctx)}</div>`;
    },
    'topic/ul': (_node, ctx, renderChildren) => `<ul>${renderChildren(_node, ctx)}</ul>`,
    'topic/ol': (_node, ctx, renderChildren) => `<ol>${renderChildren(_node, ctx)}</ol>`,
    'topic/li': (_node, ctx, renderChildren) => `<li>${renderChildren(_node, ctx)}</li>`,
    'topic/sl': (_node, ctx, renderChildren) => `<ul class="simple-list">${renderChildren(_node, ctx)}</ul>`,
    'topic/sli': (_node, ctx, renderChildren) => `<li>${renderChildren(_node, ctx)}</li>`,
    'topic/dl': (_node, ctx, renderChildren) => `<dl>${renderChildren(_node, ctx)}</dl>`,
    'topic/dlentry': (_node, ctx, renderChildren) => `<div class="dlentry">${renderChildren(_node, ctx)}</div>`,
    'topic/dt': (_node, ctx, renderChildren) => `<dt>${renderChildren(_node, ctx)}</dt>`,
    'topic/dd': (_node, ctx, renderChildren) => `<dd>${renderChildren(_node, ctx)}</dd>`,
    'topic/table': (node, ctx, renderChildren) => {
        const id = getAttr(node, 'id');
        return `<table${id ? ` id="${id}"` : ''} class="cals-table">${renderChildren(node, ctx)}</table>`;
    },
    'topic/tgroup': (_node, ctx, renderChildren) => renderChildren(_node, ctx),
    'topic/colspec': () => '',
    'topic/thead': (_node, ctx, renderChildren) => `<thead>${renderChildren(_node, ctx)}</thead>`,
    'topic/tbody': (_node, ctx, renderChildren) => `<tbody>${renderChildren(_node, ctx)}</tbody>`,
    'topic/row': (_node, ctx, renderChildren) => `<tr>${renderChildren(_node, ctx)}</tr>`,
    'topic/entry': (node, ctx, renderChildren) => {
        const tag = isInThead(ctx) ? 'th' : 'td';
        return `<${tag}>${renderChildren(node, ctx)}</${tag}>`;
    },
    'topic/simpletable': (node, ctx, renderChildren) => {
        const id = getAttr(node, 'id');
        return `<table${id ? ` id="${id}"` : ''} class="simple-table">${renderChildren(node, ctx)}</table>`;
    },
    'topic/sthead': (_node, ctx, renderChildren) => `<thead>${renderChildren(_node, ctx)}</thead>`,
    'topic/strow': (_node, ctx, renderChildren) => `<tr>${renderChildren(_node, ctx)}</tr>`,
    'topic/stentry': (node, ctx, renderChildren) => {
        const tag = isInThead(ctx) ? 'th' : 'td';
        return `<${tag}>${renderChildren(node, ctx)}</${tag}>`;
    },
    'topic/image': (node, ctx) => {
        const href = getAttr(node, 'href') || '';
        const alt = getAttr(node, 'alt') || '';
        const placement = getAttr(node, 'placement') || 'inline';
        if (!href)
            return '';
        const imgSrc = ctx.asWebviewUri(href);
        if (!imgSrc)
            return '';
        const width = getAttr(node, 'width');
        const height = getAttr(node, 'height');
        const extra = `${width ? ` width="${width}"` : ''}${height ? ` height="${height}"` : ''}`;
        return `<img src="${imgSrc}" alt="${alt}"${extra}${placement === 'break' ? ' class="image-break"' : ''} loading="lazy">`;
    },
    'topic/fig': (node, ctx, renderChildren) => {
        const id = getAttr(node, 'id');
        const titleNode = (node.children || []).find((c) => c.type === 'element' && c.baseType === 'topic/title');
        const rest = (node.children || []).filter((c) => !(c.type === 'element' && c.baseType === 'topic/title'));
        const figContent = rest.map((c) => renderChildren(c, ctx)).join('');
        const figCaption = titleNode
            ? `<figcaption>${renderChildren(titleNode, { ...ctx, headingLevel: ctx.headingLevel + 1 })}</figcaption>`
            : '';
        return `<figure${id ? ` id="${id}"` : ''}>${figCaption}${figContent}</figure>`;
    },
    'topic/codeblock': (node, ctx, renderChildren) => {
        const outputClass = getAttr(node, 'outputclass') || '';
        const lang = outputClass.replace(/^language-/, '');
        const langLabel = lang ? `<div class="codeblock-lang">${lang}</div>` : '';
        return `<pre class="codeblock ${outputClass}"><code>${renderChildren(node, ctx)}</code>${langLabel}</pre>`;
    },
    'topic/pre': (_node, ctx, renderChildren) => `<pre class="preformatted">${renderChildren(_node, ctx)}</pre>`,
    'topic/xref': (node, ctx, renderChildren) => {
        const href = getAttr(node, 'href') || '';
        if (!href)
            return '';
        const content = node.children.length > 0
            ? renderChildren(node, ctx)
            : href.startsWith('#')
                ? ctx.resolveTitle?.(href.includes('/') ? href.split('/').pop() : href.slice(1)) || href
                : href;
        if (href.startsWith('#')) {
            const anchor = href.includes('/') ? '#' + href.split('/').pop() : href;
            return `<a href="${anchor}" class="xref">${content}</a>`;
        }
        return `<span class="xref-external">→ 引用其他文件，Phase 2 支持</span>`;
    },
    'topic/link': (_node, ctx, renderChildren) => renderChildren(_node, ctx),
    'topic/linktext': (_node, ctx, renderChildren) => renderChildren(_node, ctx),
    'topic/related-links': (_node, ctx, renderChildren) => `<aside class="related-links"><h2>Related links</h2>${renderChildren(_node, ctx)}</aside>`,
    'topic/b': (_node, ctx, renderChildren) => `<strong>${renderChildren(_node, ctx)}</strong>`,
    'topic/i': (_node, ctx, renderChildren) => `<em>${renderChildren(_node, ctx)}</em>`,
    'topic/u': (_node, ctx, renderChildren) => `<u>${renderChildren(_node, ctx)}</u>`,
    'topic/tt': (_node, ctx, renderChildren) => `<code>${renderChildren(_node, ctx)}</code>`,
    'topic/sup': (_node, ctx, renderChildren) => `<sup>${renderChildren(_node, ctx)}</sup>`,
    'topic/sub': (_node, ctx, renderChildren) => `<sub>${renderChildren(_node, ctx)}</sub>`,
    'topic/q': (_node, ctx, renderChildren) => `<q>${renderChildren(_node, ctx)}</q>`,
    'topic/lq': (_node, ctx, renderChildren) => `<blockquote>${renderChildren(_node, ctx)}</blockquote>`,
    'topic/keyword': (_node, ctx, renderChildren) => `<span class="keyword">${renderChildren(_node, ctx)}</span>`,
    'topic/term': (_node, ctx, renderChildren) => `<span class="term">${renderChildren(_node, ctx)}</span>`,
    'topic/ph': (_node, ctx, renderChildren) => `<span class="ph">${renderChildren(_node, ctx)}</span>`,
};
//# sourceMappingURL=baseTypeMap.js.map