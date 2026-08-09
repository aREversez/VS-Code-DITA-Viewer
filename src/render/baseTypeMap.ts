import { DitaNode } from '../parser/domTypes';
import { RenderContext } from './renderer';

// parentBaseType only reflects the immediate ancestor (entry sits under row,
// not thead), so header status is carried by an explicit ctx flag set when
// entering thead/sthead and cleared when entering tbody.
function isInTableHeader(ctx: RenderContext): boolean {
  return ctx.inTableHeader === true;
}

export type Renderer = (
  node: DitaNode,
  context: RenderContext,
  renderChildren: (node: DitaNode, ctx: RenderContext) => string,
) => string;

function getAttr(node: DitaNode, name: string): string | undefined {
  return node.attributes?.[name];
}

// Mirrors DEFAULT_NOTE_LABELS in src/editor/ditaRenderUtils.ts. Duplicated
// rather than imported to keep this module free of editor-layer
// dependencies (it's also used by the HTML export pipeline); update both
// if the label set changes.
const FALLBACK_NOTE_LABELS: Record<string, string> = {
  note: 'Note', notice: 'Notice', warning: 'Warning', danger: 'Danger',
  important: 'Important', tip: 'Tip', restriction: 'Restriction',
  attention: 'Attention', caution: 'Caution', fastpath: 'Fastpath',
  remember: 'Remember', trouble: 'Trouble',
};

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Recursively flattens an element's descendants to plain text, dropping all
// markup. Used for attribute-value contexts (alt/title) where HTML tags
// would just show up as literal escaped text if renderChildren() were used
// instead. Local to this module rather than imported from the editor/map
// layers' own copies of the same idea (extractTextFromNode/plainText) — see
// FALLBACK_NOTE_LABELS above for why src/render/ keeps its own copies.
function extractPlainText(node: DitaNode): string {
  if (node.type === 'text') return node.text || '';
  return (node.children || []).map(extractPlainText).join('');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// topic/foreign covers DITA's generic <foreign> element plus the MathML
// domain's <mathml> (and this project's own 'svg-container' convenience
// mapping) — see standardTagMap.ts. Its content is arbitrary raw markup
// from OUTSIDE the DITA vocabulary, so unlike every other renderer here
// (which maps a *specific known* DITA element to a *specific known* HTML
// shape), this one has to decide what to do with tag names it can't
// otherwise account for. Chromium (what VS Code's webview runs on) has
// supported MathML Core natively since Chrome 109 (Jan 2023), so real
// MathML markup — which is what DITA-OT/Oxygen actually emit here, per
// https://www.oxygenxml.com/dita/1.3/specs/langRef/technicalContent/mathml.html
// — can simply be serialized back out verbatim and left to the browser's
// own MathML renderer, rather than DITA Viewer needing to implement math
// typesetting itself.
//
// "Verbatim" is deliberately bounded, though: this is the one place in the
// renderer that takes a tag name and attribute set straight from the
// source XML and writes it into the HTML output without mapping it to a
// controlled shape first. Restricting to a real MathML tag allowlist, and
// stripping event-handler-shaped/URL-bearing attribute names regardless of
// tag, keeps a malformed or hand-edited <mathml> block from doing anything
// beyond "render as MathML (or not at all)" — it can't smuggle through an
// arbitrary tag the browser would treat as active content.
const MATHML_TAGS = new Set([
  'math', 'mrow', 'mi', 'mn', 'mo', 'mtext', 'mspace', 'ms', 'mglyph',
  'mfrac', 'msqrt', 'mroot', 'mstyle', 'merror', 'mpadded', 'mphantom',
  'mfenced', 'menclose', 'msub', 'msup', 'msubsup', 'munder', 'mover',
  'munderover', 'mmultiscripts', 'mprescripts', 'none', 'mtable', 'mtr',
  'mtd', 'mlabeledtr', 'maligngroup', 'malignmark', 'mstack', 'mlongdiv',
  'msgroup', 'msrow', 'mscarries', 'mscarry', 'msline', 'maction',
  'semantics', 'annotation', 'annotation-xml',
]);

function isUnsafeForeignAttr(name: string): boolean {
  const n = name.toLowerCase();
  return n.startsWith('on') || n === 'href' || n === 'src' || n === 'style' || n === 'xlink:href';
}

// Namespace-prefixed MathML (<mml:math>, <mml:msup>, ...) is extremely
// common in practice -- Oxygen's equation editor and MathType both export
// this shape by default -- but only the *local* part of the name is a real
// MathML tag; "mml:msup" itself will never match MATHML_TAGS. Browsers also
// don't recognize prefixed tags for the HTML math-integration point at
// all, so the prefix has to come off both for the allowlist check and for
// what actually gets written into the output, or the element silently
// falls through to the "unrecognized tag" branch below (dropping structure
// exactly like the un-fixed flatten-to-text bug this renderer exists to
// avoid).
function localName(tag: string): string {
  const i = tag.indexOf(':');
  return i === -1 ? tag : tag.slice(i + 1);
}

function serializeForeignContent(node: DitaNode): string {
  if (node.type === 'text') return escapeHtml(node.text || '');
  const tag = localName((node.tagName || '').toLowerCase());
  if (!MATHML_TAGS.has(tag)) {
    // Not a tag we recognize as real MathML — don't trust it enough to
    // emit as a live element, but keep any visible text rather than
    // silently dropping the whole subtree.
    return (node.children || []).map(serializeForeignContent).join('');
  }
  const attrs = Object.entries(node.attributes || {})
    // xmlns / xmlns:* declarations are what produced the mml: prefix in
    // the first place; now that the prefix is stripped from the tag name
    // itself they're meaningless (and on re-serialized <math> would just
    // be inert clutter), so drop them rather than carrying them through.
    .filter(([name]) => {
      const n = name.toLowerCase();
      return n !== 'xmlns' && !n.startsWith('xmlns:') && !isUnsafeForeignAttr(localName(n));
    })
    .map(([name, value]) => safeAttr(localName(name), value))
    .join('');
  const inner = (node.children || []).map(serializeForeignContent).join('');
  return `<${tag}${attrs}>${inner}</${tag}>`;
}


function safeAttr(name: string, value: string | undefined | null): string {
  if (value == null) return '';
  return ` ${name}="${escapeAttr(value)}"`;
}

export const BASE_TYPE_RENDERERS: Record<string, Renderer> = {
  'topic/foreign': (node) => {
    // No renderChildren() here — that would fall through to the generic
    // "no handler for this baseType" path for every MathML tag underneath
    // (none of them have a DITA baseType of their own), stripping all
    // structure and leaving only flattened text. serializeForeignContent
    // recurses on its own, bypassing the normal per-node baseType dispatch
    // entirely for this subtree.
    const inner = (node.children || []).map(serializeForeignContent).join('');
    return `<span class="foreign-content">${inner}</span>`;
  },

  'topic/topic': (node, ctx, renderChildren) => {
    const id = getAttr(node, 'id');
    return `<article${safeAttr('id', id)} class="topic">${renderChildren(node, ctx)}</article>`;
  },

  'topic/title': (node, ctx, renderChildren) => {
    const level = Math.min(Math.max(ctx.headingLevel, 1), 6);
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
    return `<section${safeAttr('id', id)}>${renderChildren(node, ctx)}</section>`;
  },

  'topic/example': (node, ctx, renderChildren) => {
    const id = getAttr(node, 'id');
    return `<section${safeAttr('id', id)} class="example">${renderChildren(node, ctx)}</section>`;
  },

  'topic/p': (_node, ctx, renderChildren) => {
    return `<p>${renderChildren(_node, ctx)}</p>`;
  },

  'topic/itemgroup': (node, ctx, renderChildren) => {
    return `<div class="itemgroup">${renderChildren(node, ctx)}</div>`;
  },

  'topic/note': (node, ctx, renderChildren) => {
    const type = getAttr(node, 'type') || 'note';
    const spectitle = getAttr(node, 'spectitle');
    const othertype = getAttr(node, 'othertype');
    const labels = ctx.noteLabels || FALLBACK_NOTE_LABELS;
    // spectitle always wins when present (DITA lets any note override its
    // default title); otherwise type="other" falls back to @othertype
    // (its label isn't a fixed string, unlike the other 12 note types);
    // otherwise look up the type in the label map, or fall back to the
    // raw attribute value for anything outside the known enumeration.
    let label: string;
    if (spectitle) {
      label = spectitle;
    } else if (type === 'other' && othertype) {
      label = othertype;
    } else {
      label = labels[type] || type;
    }
    return `<div class="note note--${escapeAttr(type)}"><span class="note__label">${escapeAttr(label)}:</span> ${renderChildren(node, ctx)}</div>`;
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
    return `<table${safeAttr('id', id)} class="cals-table">${renderChildren(node, ctx)}</table>`;
  },

  'topic/tgroup': (node, ctx, renderChildren) => {
    // Build column name → number map from colspec elements
    const colspecs = (node.children || []).filter(
      (c) => c.type === 'element' && c.baseType === 'topic/colspec',
    );
    const colMap = new Map<string, number>();
    colspecs.forEach((cs, i) => {
      const colname = cs.attributes?.colname;
      if (colname) {
        const colnum = cs.attributes?.colnum
          ? parseInt(cs.attributes.colnum, 10)
          : i + 1;
        colMap.set(colname, colnum);
      }
    });

    // Pre-process entries: add colspan/rowspan attributes derived from
    // CALS namest/nameend and morerows so the entry renderer can emit
    // them as standard HTML attributes.
    function addSpans(el: DitaNode): DitaNode {
      if (el.type !== 'element') return el;
      const processedChildren = (el.children || []).map(addSpans);
      if (el.baseType === 'topic/entry') {
        const attrs = { ...el.attributes };
        const { namest, nameend } = attrs;
        if (namest && nameend && !attrs.colspan) {
          const startCol = colMap.get(namest);
          const endCol = colMap.get(nameend);
          if (startCol !== undefined && endCol !== undefined) {
            attrs.colspan = String(endCol - startCol + 1);
          }
        }
        if (attrs.morerows !== undefined && !attrs.rowspan) {
          const mr = parseInt(attrs.morerows, 10);
          if (!isNaN(mr)) attrs.rowspan = String(mr + 1);
        }
        return { ...el, attributes: attrs, children: processedChildren };
      }
      return { ...el, children: processedChildren };
    }

    const processedNode = addSpans(node);

    // Generate <colgroup> with column widths
    // CALS colwidth can be: "5*" or "1.5*" (proportional), "*" (= 1*),
    // "50px", "30%", "2in", or a bare number (treated as pixels).
    let colgroup = '';
    if (colspecs.length > 0) {
      // Calculate total proportional parts for "*" notation
      let totalStars = 0;
      let hasStars = false;
      for (const cs of colspecs) {
        const w = cs.attributes?.colwidth;
        if (w) {
          const m = w.match(/^(\d+(?:\.\d+)?)?\*$/);
          if (m) {
            hasStars = true;
            totalStars += m[1] ? parseFloat(m[1]) : 1;
          }
        }
      }
      const cols = colspecs
        .map((cs) => {
          const w = cs.attributes?.colwidth;
          if (!w) return '<col>';
          // Convert CALS proportional notation (N*) to percentage
          const starMatch = w.match(/^(\d+(?:\.\d+)?)?\*$/);
          if (starMatch && hasStars && totalStars > 0) {
            const parts = starMatch[1] ? parseFloat(starMatch[1]) : 1;
            const pct = (parts / totalStars) * 100;
            return `<col style="width: ${pct.toFixed(2)}%">`;
          }
          // Bare number → treat as pixels
          if (/^\d+(?:\.\d+)?$/.test(w)) {
            return `<col style="width: ${escapeAttr(w)}px">`;
          }
          // Pass through CSS-compatible values (px, %, em, in, cm, etc.)
          return `<col style="width: ${escapeAttr(w)}">`;
        })
        .join('');
      colgroup = `<colgroup>${cols}</colgroup>`;
    }

    // Render non-colspec children (thead, tbody, tfoot)
    const childCtx: RenderContext = { ...ctx, parentBaseType: 'topic/tgroup' };
    const nodeWithoutColspec: DitaNode = {
      ...processedNode,
      children: (processedNode.children || []).filter(
        (c) => !(c.type === 'element' && c.baseType === 'topic/colspec'),
      ),
    };
    return colgroup + renderChildren(nodeWithoutColspec, childCtx);
  },
  'topic/colspec': () => '',

  'topic/thead': (_node, ctx, renderChildren) =>
    `<thead>${renderChildren(_node, { ...ctx, inTableHeader: true })}</thead>`,
  'topic/tbody': (_node, ctx, renderChildren) =>
    `<tbody>${renderChildren(_node, { ...ctx, inTableHeader: false })}</tbody>`,
  'topic/row': (_node, ctx, renderChildren) => `<tr>${renderChildren(_node, ctx)}</tr>`,
  'topic/entry': (node, ctx, renderChildren) => {
    const tag = isInTableHeader(ctx) ? 'th' : 'td';
    const colspan = getAttr(node, 'colspan');
    const rowspan = getAttr(node, 'rowspan');
    const attrs = `${safeAttr('colspan', colspan)}${safeAttr('rowspan', rowspan)}`;
    return `<${tag}${attrs}>${renderChildren(node, ctx)}</${tag}>`;
  },

  'topic/simpletable': (node, ctx, renderChildren) => {
    const id = getAttr(node, 'id');
    return `<table${safeAttr('id', id)} class="simple-table">${renderChildren(node, ctx)}</table>`;
  },

  'topic/sthead': (_node, ctx, renderChildren) =>
    `<thead>${renderChildren(_node, { ...ctx, inTableHeader: true })}</thead>`,
  'topic/strow': (_node, ctx, renderChildren) =>
    `<tr>${renderChildren(_node, { ...ctx, inTableHeader: false })}</tr>`,
  'topic/stentry': (node, ctx, renderChildren) => {
    const tag = isInTableHeader(ctx) ? 'th' : 'td';
    return `<${tag}>${renderChildren(node, ctx)}</${tag}>`;
  },

  'topic/image': (node, ctx) => {
    const href = getAttr(node, 'href') || '';
    const placement = getAttr(node, 'placement') || 'inline';
    const width = getAttr(node, 'width');
    const height = getAttr(node, 'height');
    const scale = getAttr(node, 'scale');
    const scalefit = getAttr(node, 'scalefit');

    // DITA allows alt text as both the @alt attribute and a richer <alt>
    // child element (topic/alt) — the child can carry formatted content
    // (ph, draft-comment, etc.) and takes precedence when present. Neither
    // present -> alt stays undefined so safeAttr omits the attribute
    // entirely, rather than always emitting alt="" regardless of whether
    // the author gave any alt info at all.
    const altChild = (node.children || []).find(
      (c) => c.type === 'element' && c.baseType === 'topic/alt',
    );
    const altFromChild = altChild ? extractPlainText(altChild).trim() : '';
    const alt = altFromChild || getAttr(node, 'alt');

    const extra = `${safeAttr('width', width)}${safeAttr('height', height)}`;
    const imgSrc = href ? ctx.asWebviewUri(href) : '';
    const cls = placement === 'break' ? ' class="image-break"' : '';

    // @scale sizes the image relative to its OWN natural dimensions, not
    // the container — expressed via the CSS custom property --dita-scale,
    // which styles.css combines with the toolbar's preview-only zoom via
    // the CSS 'zoom' property (reflows the box, unlike transform:scale).
    // Explicit width/height are a more specific instruction and win over
    // scale when given. @scalefit="yes" means "prioritize fitting the
    // available width", which this project already does by default for
    // every image (img{max-width:100%}); so scalefit=yes just needs to
    // suppress scale/width/height rather than actively doing anything.
    let scaleStyle: string | undefined;
    if (scalefit !== 'yes' && scale && !width && !height) {
      const pct = parseFloat(scale);
      if (!isNaN(pct) && pct > 0) {
        scaleStyle = `--dita-scale:${pct / 100}`;
      }
    }

    const altAttr = alt !== undefined ? safeAttr('alt', alt) : '';
    const titleAttr = alt ? safeAttr('title', alt) : '';
    const styleAttr = safeAttr('style', scaleStyle);

    return `<img src="${escapeAttr(imgSrc)}"${altAttr}${titleAttr}${extra}${cls}${styleAttr} loading="lazy" data-dita-src="${escapeAttr(href)}">`;
  },

  'topic/fig': (node, ctx, renderChildren) => {
    const id = getAttr(node, 'id');
    const titleNode = (node.children || []).find(
      (c) => c.type === 'element' && c.baseType === 'topic/title',
    );
    const rest = (node.children || []).filter(
      (c) => !(c.type === 'element' && c.baseType === 'topic/title'),
    );
    const figContent = renderChildren({ ...node, children: rest }, ctx);
    const figCaption = titleNode
      ? `<figcaption>${renderChildren(titleNode, { ...ctx, headingLevel: ctx.headingLevel + 1 })}</figcaption>`
      : '';
    return `<figure${safeAttr('id', id)}>${figContent}${figCaption}</figure>`;
  },

  'topic/codeblock': (node, ctx, renderChildren) => {
    const outputClass = getAttr(node, 'outputclass') || '';
    const lang = outputClass.replace(/^language-/, '');
    const langLabel = lang ? `<div class="codeblock-lang">${escapeAttr(lang)}</div>` : '';
    return `<pre class="codeblock ${escapeAttr(outputClass)}"><code>${renderChildren(node, ctx)}</code>${langLabel}</pre>`;
  },

  'topic/pre': (_node, ctx, renderChildren) =>
    `<pre class="preformatted">${renderChildren(_node, ctx)}</pre>`,

  'topic/xref': (node, ctx, renderChildren) => {
    const href = getAttr(node, 'href') || '';
    if (!href) return '';

    let content: string;
    if (node.children.length > 0) {
      content = renderChildren(node, ctx);
    } else if (href.startsWith('#')) {
      const id = href.includes('/') ? href.split('/').pop()! : href.slice(1);
      content = escapeAttr(ctx.resolveTitle?.(id) ?? '') || escapeAttr(href);
    } else {
      // Cross-file reference (with or without fragment):
      // try to resolve the referenced document's title
      content = escapeAttr(ctx.resolveTitle?.(href) ?? '') || escapeAttr(href);
    }

    if (href.startsWith('#')) {
      const anchor = href.includes('/') ? '#' + href.split('/').pop()! : href;
      return `<a href="${escapeAttr(anchor)}" class="xref">${content}</a>`;
    }

    return `<span class="xref-external">→ ${content}</span>`;
  },

  'topic/link': (node, ctx, renderChildren) => {
    const href = getAttr(node, 'href');
    const keyref = getAttr(node, 'keyref');
    const target = href || keyref || '';
    if (!target) return renderChildren(node, ctx);
    return `<a href="${escapeAttr(target)}" class="link">${renderChildren(node, ctx)}</a>`;
  },
  'topic/linktext': (_node, ctx, renderChildren) => renderChildren(_node, ctx),

  'topic/related-links': (_node, ctx, renderChildren) =>
    `<aside class="related-links"><h2>Related links</h2>${renderChildren(_node, ctx)}</aside>`,

  'topic/b': (_node, ctx, renderChildren) => `<strong>${renderChildren(_node, ctx)}</strong>`,
  'topic/i': (_node, ctx, renderChildren) => `<em>${renderChildren(_node, ctx)}</em>`,
  'topic/u': (_node, ctx, renderChildren) => `<u>${renderChildren(_node, ctx)}</u>`,
  'topic/tt': (_node, ctx, renderChildren) => `<code>${renderChildren(_node, ctx)}</code>`,
  'topic/sup': (_node, ctx, renderChildren) => `<sup>${renderChildren(_node, ctx)}</sup>`,
  'topic/sub': (_node, ctx, renderChildren) => `<sub>${renderChildren(_node, ctx)}</sub>`,

  // Highlight domain additions (specialize topic/ph; given element-specific
  // baseTypes + renderers so the visual styling survives even when the class
  // attribute is omitted from the XML — same approach as b/i/u above).
  // line-through maps to the semantic <s> element (zero CSS, like b→<strong>);
  // overline has no semantic HTML element, so it uses a .overline CSS class
  // (defined in styles.css) instead of an inline style so themes can override it.
  'topic/line-through': (_node, ctx, renderChildren) =>
    `<s>${renderChildren(_node, ctx)}</s>`,
  'topic/overline': (_node, ctx, renderChildren) =>
    `<span class="overline">${renderChildren(_node, ctx)}</span>`,

  'topic/q': (_node, ctx, renderChildren) => `<q>${renderChildren(_node, ctx)}</q>`,
  'topic/lq': (_node, ctx, renderChildren) => `<blockquote>${renderChildren(_node, ctx)}</blockquote>`,

  'topic/keyword': (_node, ctx, renderChildren) =>
    `<span class="keyword">${renderChildren(_node, ctx)}</span>`,

  'topic/term': (_node, ctx, renderChildren) =>
    `<span class="term">${renderChildren(_node, ctx)}</span>`,

  'topic/ph': (node, ctx, renderChildren) => {
    const keyref = getAttr(node, 'keyref');
    const hasContent = (node.children || []).some(
      (c) => c.type === 'element' || (c.text || '').trim() !== '',
    );
    // Content wins over keyref (DITA spec). An empty ph with a resolvable
    // keyref is substituted upstream; reaching here empty means unresolved.
    if (keyref && !hasContent && ctx.resolveKey) {
      const resolved = ctx.resolveKey(keyref);
      if (resolved) return `<span class="ph">${escapeAttr(resolved)}</span>`;
      return `<span class="ph unresolved-keyref" title="Unresolved key: ${escapeAttr(keyref)}">[${escapeAttr(keyref)}]</span>`;
    }
    return `<span class="ph">${renderChildren(node, ctx)}</span>`;
  },

  // UI elements
  'topic/uicontrol': (_node, ctx, renderChildren) =>
    `<span class="uicontrol">${renderChildren(_node, ctx)}</span>`,

  'topic/wintitle': (_node, ctx, renderChildren) =>
    `<span class="wintitle">${renderChildren(_node, ctx)}</span>`,

  'topic/menucascade': (_node, ctx, renderChildren) =>
    `<span class="menucascade">${renderChildren(_node, ctx)}</span>`,

  // Computer interaction
  'topic/filepath': (_node, ctx, renderChildren) =>
    `<span class="filepath">${renderChildren(_node, ctx)}</span>`,

  'topic/userinput': (_node, ctx, renderChildren) =>
    `<span class="userinput">${renderChildren(_node, ctx)}</span>`,

  'topic/systemoutput': (_node, ctx, renderChildren) =>
    `<span class="systemoutput">${renderChildren(_node, ctx)}</span>`,

  // API & code references
  'topic/apiname': (_node, ctx, renderChildren) =>
    `<span class="apiname">${renderChildren(_node, ctx)}</span>`,

  'topic/option': (_node, ctx, renderChildren) =>
    `<span class="option">${renderChildren(_node, ctx)}</span>`,

  'topic/parmname': (_node, ctx, renderChildren) =>
    `<span class="parmname">${renderChildren(_node, ctx)}</span>`,

  'topic/cmdname': (_node, ctx, renderChildren) =>
    `<span class="cmdname">${renderChildren(_node, ctx)}</span>`,

  'topic/varname': (_node, ctx, renderChildren) =>
    `<span class="varname">${renderChildren(_node, ctx)}</span>`,

  'topic/msgnum': (_node, ctx, renderChildren) =>
    `<span class="msgnum">${renderChildren(_node, ctx)}</span>`,

  // Programming domain additions
  'topic/codeph': (_node, ctx, renderChildren) =>
    `<code class="codeph">${renderChildren(_node, ctx)}</code>`,
  'topic/coderef': (_node, ctx, renderChildren) =>
    `<span class="coderef">${renderChildren(_node, ctx)}</span>`,
  'topic/synph': (_node, ctx, renderChildren) =>
    `<span class="synph">${renderChildren(_node, ctx)}</span>`,
  'topic/kwd': (_node, ctx, renderChildren) =>
    `<span class="kwd">${renderChildren(_node, ctx)}</span>`,
  'topic/var': (_node, ctx, renderChildren) =>
    `<span class="var">${renderChildren(_node, ctx)}</span>`,
  'topic/oper': (_node, ctx, renderChildren) =>
    `<span class="oper">${renderChildren(_node, ctx)}</span>`,
  'topic/sep': (_node, ctx, renderChildren) =>
    `<span class="sep">${renderChildren(_node, ctx)}</span>`,
  'topic/delim': (_node, ctx, renderChildren) =>
    `<span class="delim">${renderChildren(_node, ctx)}</span>`,
  'topic/fragment': (_node, ctx, renderChildren) =>
    `<span class="fragment">${renderChildren(_node, ctx)}</span>`,
  'topic/fragref': (_node, ctx, renderChildren) =>
    `<span class="fragref">${renderChildren(_node, ctx)}</span>`,
  'topic/synblk': (_node, ctx, renderChildren) =>
    `<pre class="synblk">${renderChildren(_node, ctx)}</pre>`,
  'topic/synnote': (_node, ctx, renderChildren) =>
    `<div class="synnote">${renderChildren(_node, ctx)}</div>`,
  'topic/synnoteref': (_node, ctx, renderChildren) =>
    `<span class="synnoteref">${renderChildren(_node, ctx)}</span>`,
  'topic/syntaxdiagram': (_node, ctx, renderChildren) =>
    `<div class="syntaxdiagram">${renderChildren(_node, ctx)}</div>`,

  // Software domain
  'topic/screen': (_node, ctx, renderChildren) =>
    `<pre class="screen">${renderChildren(_node, ctx)}</pre>`,
  'topic/msgph': (_node, ctx, renderChildren) =>
    `<span class="msgph">${renderChildren(_node, ctx)}</span>`,
  'topic/msgblock': (_node, ctx, renderChildren) =>
    `<pre class="msgblock">${renderChildren(_node, ctx)}</pre>`,

  // Common body elements
  'topic/lines': (_node, ctx, renderChildren) =>
    `<pre class="lines">${renderChildren(_node, ctx)}</pre>`,
  'topic/fn': (node, ctx, renderChildren) => {
    const id = getAttr(node, 'id');
    const cls = id ? ` fn-call-${escapeAttr(id)}` : '';
    return `<sup class="fn${cls}">${renderChildren(node, ctx)}</sup>`;
  },
  'topic/cite': (_node, ctx, renderChildren) =>
    `<cite>${renderChildren(_node, ctx)}</cite>`,
  'topic/boolean': (node, ctx, renderChildren) => {
    const val = getAttr(node, 'value') || '';
    return `<span class="boolean" data-value="${escapeAttr(val)}">${escapeAttr(val) || renderChildren(node, ctx)}</span>`;
  },
  'topic/tm': (_node, ctx, renderChildren) =>
    `<span class="tm">${renderChildren(_node, ctx)}</span>`,
  'topic/indexterm': () => '',
  'topic/indextermref': () => '',
  'topic/index-see': () => '',
  'topic/index-see-also': () => '',
  'topic/index-sort-as': () => '',
  'topic/index-base': () => '',
  'topic/div': (_node, ctx, renderChildren) =>
    `<div class="body-div">${renderChildren(_node, ctx)}</div>`,
  'topic/sectiondiv': (_node, ctx, renderChildren) =>
    `<div class="section-div">${renderChildren(_node, ctx)}</div>`,
  'topic/bodydiv': (_node, ctx, renderChildren) =>
    `<div class="body-div">${renderChildren(_node, ctx)}</div>`,
  // Generic grouping container (image-map <area> group, programming domain
  // groupchoice/groupcomp/groupseq alternatives). Same block treatment as
  // bodydiv/sectiondiv — no distinct visual semantics of its own.
  'topic/figgroup': (_node, ctx, renderChildren) =>
    `<div class="figgroup">${renderChildren(_node, ctx)}</div>`,
  'topic/desc': (_node, ctx, renderChildren) =>
    `<span class="desc">${renderChildren(_node, ctx)}</span>`,
  'topic/alt': (_node, ctx, renderChildren) =>
    `<span class="alt">${renderChildren(_node, ctx)}</span>`,

  // Parameter lists
  'topic/parml': (_node, ctx, renderChildren) =>
    `<dl class="parml">${renderChildren(_node, ctx)}</dl>`,
  'topic/plentry': (_node, ctx, renderChildren) =>
    `<div class="plentry">${renderChildren(_node, ctx)}</div>`,
  'topic/pt': (_node, ctx, renderChildren) =>
    `<dt class="pt">${renderChildren(_node, ctx)}</dt>`,
  'topic/pd': (_node, ctx, renderChildren) =>
    `<dd class="pd">${renderChildren(_node, ctx)}</dd>`,

  // Abbreviation & glossary
  'topic/abbreviated-form': (node, ctx, renderChildren) => {
    const keyref = getAttr(node, 'keyref');
    if (keyref && ctx.resolveKey) return `<abbr class="abbreviated-form" title="${escapeAttr(keyref)}">${escapeAttr(ctx.resolveKey(keyref) || keyref)}</abbr>`;
    return `<abbr class="abbreviated-form">${renderChildren(node, ctx)}</abbr>`;
  },
  'topic/glossterm': (_node, ctx, renderChildren) =>
    `<dfn class="glossterm">${renderChildren(_node, ctx)}</dfn>`,
  'topic/glossdef': (_node, ctx, renderChildren) =>
    `<dd class="glossdef">${renderChildren(_node, ctx)}</dd>`,
  'topic/glossentry': (_node, ctx, renderChildren) =>
    `<dl class="glossentry">${renderChildren(_node, ctx)}</dl>`,
  'topic/glossref': (_node, ctx, renderChildren) =>
    `<span class="glossref">${renderChildren(_node, ctx)}</span>`,
  'topic/glossgroup': (_node, ctx, renderChildren) =>
    `<div class="glossgroup">${renderChildren(_node, ctx)}</div>`,

  // Hazard
  'topic/hazardstatement': (node, ctx, renderChildren) =>
    `<div class="hazardstatement">${renderChildren(node, ctx)}</div>`,
  'topic/typeofhazard': (_node, ctx, renderChildren) =>
    `<span class="typeofhazard">${renderChildren(_node, ctx)}</span>`,
  'topic/hazardsymbol': () => '',
  'topic/howtoavoid': (_node, ctx, renderChildren) =>
    `<p class="howtoavoid">${renderChildren(_node, ctx)}</p>`,
  'topic/consequence': (_node, ctx, renderChildren) =>
    `<p class="consequence">${renderChildren(_node, ctx)}</p>`,

  // Multimedia
  'topic/object': (_node, ctx, renderChildren) =>
    `<object class="dita-object">${renderChildren(_node, ctx)}</object>`,
  'topic/param': () => '',

  // Anchors
  'topic/anchor': (node) => {
    const id = getAttr(node, 'id');
    return id ? `<a${safeAttr('id', id)}></a>` : '';
  },
  'topic/anchorid': (node) => {
    const id = getAttr(node, 'id');
    return id ? `<span${safeAttr('id', id)}></span>` : '';
  },
  'topic/anchorkey': () => '',
  'topic/anchorref': () => '',

  // Prolog — metadata container (author, critdates, permissions, metadata,
  // keywords, etc.). Entirely non-display; swallow the whole subtree so
  // nothing leaks into the body preview. Mirrors the anchorkey/anchorref
  // pattern. Evidence: base/dtd/commonElementMod.ent — class
  // "- topic/prolog " — appears between title and body in topic/concept/
  // task/reference. Without this entry the fallback renderer recurses into
  // children, causing author/keyword content to appear in the body.
  'topic/prolog': () => '',

  // These three (topic/keywords, topic/metadata, topic/publisher) are always
  // nested inside <prolog> in valid DITA — topic/prolog already suppresses
  // the whole subtree above, so these never actually get reached. Mapped
  // explicitly anyway, matching the anchorid/anchorkey/anchorref/prolog
  // precedent of not relying solely on an ancestor's suppression.
  'topic/keywords': () => '',
  'topic/metadata': () => '',
  'topic/publisher': () => '',

};
