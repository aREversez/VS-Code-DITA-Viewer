"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BASE_TYPE_RENDERERS = void 0;
function isInThead(ctx) {
    return ctx.parentBaseType === 'topic/thead';
}
function getAttr(node, name) {
    return node.attributes?.[name];
}
function escapeAttr(s) {
    return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/&/g, '&amp;');
}
const NOTE_LABELS_ZH = {
    note: '注',
    notice: '注意',
    warning: '警告',
    danger: '危险',
    important: '重要',
    tip: '提示',
    restriction: '限制',
};
const NOTE_LABELS_EN = {
    note: 'Note',
    notice: 'Notice',
    warning: 'Warning',
    danger: 'Danger',
    important: 'Important',
    tip: 'Tip',
    restriction: 'Restriction',
};
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
        const labels = ctx.noteLabels || NOTE_LABELS_EN;
        const label = labels[type] || type;
        // Handle conref: note with conref attribute pulls content from another file
        const conref = getAttr(node, 'conref');
        if (conref && ctx.resolveConref) {
            const resolved = ctx.resolveConref(conref);
            if (resolved) {
                return `<div class="note note--${type}"><span class="note__label">${label}:</span> ${resolved}</div>`;
            }
        }
        return `<div class="note note--${type}"><span class="note__label">${label}:</span> ${renderChildren(node, ctx)}</div>`;
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
        const width = getAttr(node, 'width');
        const height = getAttr(node, 'height');
        const extra = `${width ? ` width="${width}"` : ''}${height ? ` height="${height}"` : ''}`;
        const imgSrc = href ? ctx.asWebviewUri(href) : '';
        const cls = placement === 'break' ? ' class="image-break"' : '';
        const errMsg = 'Image fail: ' + escapeAttr(href) + ' srcLen=' + imgSrc.length;
        const errHandler = 'this.alt=\'' + errMsg + '\';this.style.outline=\'3px solid red\';this.style.outlineOffset=\'-1px\'';
        return `<img src="${imgSrc || ''}" alt="${alt}"${extra}${cls} loading="lazy" onerror="${errHandler}" data-src="${escapeAttr(href)}">`;
    },
    'topic/fig': (node, ctx, renderChildren) => {
        const id = getAttr(node, 'id');
        const titleNode = (node.children || []).find((c) => c.type === 'element' && c.baseType === 'topic/title');
        const rest = (node.children || []).filter((c) => !(c.type === 'element' && c.baseType === 'topic/title'));
        const figContent = renderChildren({ ...node, children: rest }, ctx);
        const figCaption = titleNode
            ? `<figcaption>${renderChildren(titleNode, { ...ctx, headingLevel: ctx.headingLevel + 1 })}</figcaption>`
            : '';
        return `<figure${id ? ` id="${id}"` : ''}>${figContent}${figCaption}</figure>`;
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
    'topic/ph': (node, ctx, renderChildren) => {
        const keyref = getAttr(node, 'keyref');
        if (keyref && ctx.resolveKey) {
            const resolved = ctx.resolveKey(keyref);
            if (resolved)
                return `<span class="ph">${escapeAttr(resolved)}</span>`;
            // Show fallback for unresolved keyref (so user can see something is wrong)
            return `<span class="ph unresolved-keyref" title="Unresolved key: ${escapeAttr(keyref)}">[${escapeAttr(keyref)}]</span>`;
        }
        return `<span class="ph">${renderChildren(node, ctx)}</span>`;
    },
    // UI elements
    'topic/uicontrol': (_node, ctx, renderChildren) => `<span class="uicontrol">${renderChildren(_node, ctx)}</span>`,
    'topic/wintitle': (_node, ctx, renderChildren) => `<span class="wintitle">${renderChildren(_node, ctx)}</span>`,
    'topic/menucascade': (_node, ctx, renderChildren) => `<span class="menucascade">${renderChildren(_node, ctx)}</span>`,
    // Computer interaction
    'topic/filepath': (_node, ctx, renderChildren) => `<span class="filepath">${renderChildren(_node, ctx)}</span>`,
    'topic/userinput': (_node, ctx, renderChildren) => `<span class="userinput">${renderChildren(_node, ctx)}</span>`,
    'topic/systemoutput': (_node, ctx, renderChildren) => `<span class="systemoutput">${renderChildren(_node, ctx)}</span>`,
    // API & code references
    'topic/apiname': (_node, ctx, renderChildren) => `<span class="apiname">${renderChildren(_node, ctx)}</span>`,
    'topic/option': (_node, ctx, renderChildren) => `<span class="option">${renderChildren(_node, ctx)}</span>`,
    'topic/parmname': (_node, ctx, renderChildren) => `<span class="parmname">${renderChildren(_node, ctx)}</span>`,
    'topic/cmdname': (_node, ctx, renderChildren) => `<span class="cmdname">${renderChildren(_node, ctx)}</span>`,
    'topic/varname': (_node, ctx, renderChildren) => `<span class="varname">${renderChildren(_node, ctx)}</span>`,
    'topic/msgnum': (_node, ctx, renderChildren) => `<span class="msgnum">${renderChildren(_node, ctx)}</span>`,
    // Programming domain additions
    'topic/codeph': (_node, ctx, renderChildren) => `<code class="codeph">${renderChildren(_node, ctx)}</code>`,
    'topic/coderef': (_node, ctx, renderChildren) => `<span class="coderef">${renderChildren(_node, ctx)}</span>`,
    'topic/synph': (_node, ctx, renderChildren) => `<span class="synph">${renderChildren(_node, ctx)}</span>`,
    'topic/kwd': (_node, ctx, renderChildren) => `<span class="kwd">${renderChildren(_node, ctx)}</span>`,
    'topic/var': (_node, ctx, renderChildren) => `<span class="var">${renderChildren(_node, ctx)}</span>`,
    'topic/oper': (_node, ctx, renderChildren) => `<span class="oper">${renderChildren(_node, ctx)}</span>`,
    'topic/sep': (_node, ctx, renderChildren) => `<span class="sep">${renderChildren(_node, ctx)}</span>`,
    'topic/delim': (_node, ctx, renderChildren) => `<span class="delim">${renderChildren(_node, ctx)}</span>`,
    'topic/fragment': (_node, ctx, renderChildren) => `<span class="fragment">${renderChildren(_node, ctx)}</span>`,
    'topic/fragref': (_node, ctx, renderChildren) => `<span class="fragref">${renderChildren(_node, ctx)}</span>`,
    'topic/synblk': (_node, ctx, renderChildren) => `<pre class="synblk">${renderChildren(_node, ctx)}</pre>`,
    'topic/synnote': (_node, ctx, renderChildren) => `<div class="synnote">${renderChildren(_node, ctx)}</div>`,
    'topic/synnoteref': (_node, ctx, renderChildren) => `<span class="synnoteref">${renderChildren(_node, ctx)}</span>`,
    'topic/syntaxdiagram': (_node, ctx, renderChildren) => `<div class="syntaxdiagram">${renderChildren(_node, ctx)}</div>`,
    // Software domain
    'topic/screen': (_node, ctx, renderChildren) => `<pre class="screen">${renderChildren(_node, ctx)}</pre>`,
    'topic/msgph': (_node, ctx, renderChildren) => `<span class="msgph">${renderChildren(_node, ctx)}</span>`,
    'topic/msgblock': (_node, ctx, renderChildren) => `<pre class="msgblock">${renderChildren(_node, ctx)}</pre>`,
    // Common body elements
    'topic/lines': (_node, ctx, renderChildren) => `<pre class="lines">${renderChildren(_node, ctx)}</pre>`,
    'topic/fn': (node, ctx, renderChildren) => {
        const id = getAttr(node, 'id');
        const callId = id ? ` fn-call-${id}` : '';
        return `<sup class="fn${callId}">${renderChildren(node, ctx)}</sup>`;
    },
    'topic/cite': (_node, ctx, renderChildren) => `<cite>${renderChildren(_node, ctx)}</cite>`,
    'topic/boolean': (node, ctx, renderChildren) => {
        const val = getAttr(node, 'value') || '';
        return `<span class="boolean" data-value="${escapeAttr(val)}">${val || renderChildren(node, ctx)}</span>`;
    },
    'topic/tm': (_node, ctx, renderChildren) => `<span class="tm">${renderChildren(_node, ctx)}</span>`,
    'topic/indexterm': () => '',
    'topic/indextermref': () => '',
    'topic/index-see': () => '',
    'topic/index-see-also': () => '',
    'topic/index-sort-as': () => '',
    'topic/index-base': () => '',
    'topic/div': (_node, ctx, renderChildren) => `<div class="body-div">${renderChildren(_node, ctx)}</div>`,
    'topic/sectiondiv': (_node, ctx, renderChildren) => `<div class="section-div">${renderChildren(_node, ctx)}</div>`,
    'topic/bodydiv': (_node, ctx, renderChildren) => `<div class="body-div">${renderChildren(_node, ctx)}</div>`,
    'topic/desc': (_node, ctx, renderChildren) => `<span class="desc">${renderChildren(_node, ctx)}</span>`,
    'topic/alt': (_node, ctx, renderChildren) => `<span class="alt">${renderChildren(_node, ctx)}</span>`,
    // Parameter lists
    'topic/parml': (_node, ctx, renderChildren) => `<dl class="parml">${renderChildren(_node, ctx)}</dl>`,
    'topic/plentry': (_node, ctx, renderChildren) => `<div class="plentry">${renderChildren(_node, ctx)}</div>`,
    'topic/pt': (_node, ctx, renderChildren) => `<dt class="pt">${renderChildren(_node, ctx)}</dt>`,
    'topic/pd': (_node, ctx, renderChildren) => `<dd class="pd">${renderChildren(_node, ctx)}</dd>`,
    // Abbreviation & glossary
    'topic/abbreviated-form': (node, ctx, renderChildren) => {
        const keyref = getAttr(node, 'keyref');
        if (keyref && ctx.resolveKey)
            return `<abbr class="abbreviated-form" title="${escapeAttr(keyref)}">${escapeAttr(ctx.resolveKey(keyref) || keyref)}</abbr>`;
        return `<abbr class="abbreviated-form">${renderChildren(node, ctx)}</abbr>`;
    },
    'topic/glossterm': (_node, ctx, renderChildren) => `<dfn class="glossterm">${renderChildren(_node, ctx)}</dfn>`,
    'topic/glossdef': (_node, ctx, renderChildren) => `<dd class="glossdef">${renderChildren(_node, ctx)}</dd>`,
    'topic/glossentry': (_node, ctx, renderChildren) => `<dl class="glossentry">${renderChildren(_node, ctx)}</dl>`,
    'topic/glossref': (_node, ctx, renderChildren) => `<span class="glossref">${renderChildren(_node, ctx)}</span>`,
    'topic/glossgroup': (_node, ctx, renderChildren) => `<div class="glossgroup">${renderChildren(_node, ctx)}</div>`,
    // Hazard
    'topic/hazardstatement': (node, ctx, renderChildren) => `<div class="hazardstatement">${renderChildren(node, ctx)}</div>`,
    'topic/typeofhazard': (_node, ctx, renderChildren) => `<span class="typeofhazard">${renderChildren(_node, ctx)}</span>`,
    'topic/hazardsymbol': () => '',
    'topic/howtoavoid': (_node, ctx, renderChildren) => `<p class="howtoavoid">${renderChildren(_node, ctx)}</p>`,
    'topic/consequence': (_node, ctx, renderChildren) => `<p class="consequence">${renderChildren(_node, ctx)}</p>`,
    // Multimedia
    'topic/object': (_node, ctx, renderChildren) => `<object class="dita-object">${renderChildren(_node, ctx)}</object>`,
    'topic/param': () => '',
    // Anchors
    'topic/anchor': (node) => {
        const id = getAttr(node, 'id');
        return id ? `<a id="${id}"></a>` : '';
    },
    'topic/anchorid': (node) => {
        const id = getAttr(node, 'id');
        return id ? `<span id="${id}"></span>` : '';
    },
    'topic/anchorkey': () => '',
    'topic/anchorref': () => '',
};
//# sourceMappingURL=baseTypeMap.js.map