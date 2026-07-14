"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const renderer_1 = require("../../render/renderer");
function makeText(text) {
    return {
        type: 'text',
        text,
        children: [],
        sourceRange: { startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
    };
}
function makeEl(baseType, children, attrs, tagName) {
    return {
        type: 'element',
        tagName: tagName || baseType.replace('topic/', ''),
        baseType,
        attributes: attrs,
        children,
        sourceRange: { startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
    };
}
const defaultCtx = {
    headingLevel: 1,
    asWebviewUri: (p) => `vscode-resource:${p}`,
    documentDir: '/test',
};
describe('renderer', () => {
    it('should render a topic with title as h1', () => {
        const doc = makeEl('topic/topic', [
            makeEl('topic/title', [makeText('My Title')]),
        ]);
        const html = (0, renderer_1.renderDocument)(doc, defaultCtx);
        assert.ok(html.includes('title="title"'));
        assert.ok(html.includes('My Title'));
        assert.ok(html.includes('</h1>'));
    });
    it('should render shortdesc with class', () => {
        const doc = makeEl('topic/topic', [
            makeEl('topic/shortdesc', [makeText('A short desc')]),
        ]);
        const html = (0, renderer_1.renderDocument)(doc, defaultCtx);
        assert.ok(html.includes('class="shortdesc"'));
    });
    it('should render paragraphs', () => {
        const doc = makeEl('topic/topic', [
            makeEl('topic/body', [
                makeEl('topic/p', [makeText('Hello world')]),
            ]),
        ]);
        const html = (0, renderer_1.renderDocument)(doc, defaultCtx);
        assert.ok(html.includes('title="p"'));
        assert.ok(html.includes('Hello world'));
    });
    it('should render note with type-specific class', () => {
        const doc = makeEl('topic/topic', [
            makeEl('topic/note', [makeText('Watch out!')], { type: 'warning' }),
        ]);
        const html = (0, renderer_1.renderDocument)(doc, defaultCtx);
        assert.ok(html.includes('class="note note--warning"'));
        assert.ok(html.includes('Warning:'));
    });
    it('should render ordered and unordered lists', () => {
        const doc = makeEl('topic/topic', [
            makeEl('topic/body', [
                makeEl('topic/ul', [
                    makeEl('topic/li', [makeText('A')]),
                    makeEl('topic/li', [makeText('B')]),
                ]),
                makeEl('topic/ol', [
                    makeEl('topic/li', [makeText('1')]),
                ]),
            ]),
        ]);
        const html = (0, renderer_1.renderDocument)(doc, defaultCtx);
        assert.ok(html.includes('title="ul"'));
        assert.ok(html.includes('title="ol"'));
        assert.ok(html.includes('title="li"'));
        assert.ok(html.includes('>A<'));
        assert.ok(html.includes('>1<'));
    });
    it('should render definition list', () => {
        const doc = makeEl('topic/topic', [
            makeEl('topic/dl', [
                makeEl('topic/dlentry', [
                    makeEl('topic/dt', [makeText('term')]),
                    makeEl('topic/dd', [makeText('definition')]),
                ]),
            ]),
        ]);
        const html = (0, renderer_1.renderDocument)(doc, defaultCtx);
        assert.ok(html.includes('title="dl"'));
        assert.ok(html.includes('title="dt"'));
        assert.ok(html.includes('title="dd"'));
        assert.ok(html.includes('>term<'));
        assert.ok(html.includes('>definition<'));
    });
    it('should render CALS table', () => {
        const doc = makeEl('topic/topic', [
            makeEl('topic/table', [
                makeEl('topic/tgroup', [
                    makeEl('topic/colspec', [], { colname: 'c1' }),
                    makeEl('topic/thead', [
                        makeEl('topic/row', [
                            makeEl('topic/entry', [makeText('Header')]),
                        ]),
                    ]),
                    makeEl('topic/tbody', [
                        makeEl('topic/row', [
                            makeEl('topic/entry', [makeText('Data')]),
                        ]),
                    ]),
                ]),
            ]),
        ]);
        const html = (0, renderer_1.renderDocument)(doc, defaultCtx);
        assert.ok(html.includes('class="cals-table"'));
        assert.ok(html.includes('<th'));
        assert.ok(html.includes('<td'));
    });
    it('should render simple table', () => {
        const doc = makeEl('topic/topic', [
            makeEl('topic/simpletable', [
                makeEl('topic/sthead', [
                    makeEl('topic/stentry', [makeText('OS')]),
                ]),
                makeEl('topic/strow', [
                    makeEl('topic/stentry', [makeText('Linux')]),
                ]),
            ]),
        ]);
        const html = (0, renderer_1.renderDocument)(doc, defaultCtx);
        assert.ok(html.includes('class="simple-table"'));
        assert.ok(html.includes('title="stentry"'));
        assert.ok(html.includes('>OS<'));
        assert.ok(html.includes('>Linux<'));
    });
    it('should render image with asWebviewUri', () => {
        const doc = makeEl('topic/topic', [
            makeEl('topic/image', [], { href: 'images/pic.png', alt: 'A picture' }),
        ]);
        const html = (0, renderer_1.renderDocument)(doc, defaultCtx);
        assert.ok(html.includes('src="vscode-resource:images/pic.png"'));
        assert.ok(html.includes('alt="A picture"'));
    });
    it('should render fig with figcaption', () => {
        const doc = makeEl('topic/topic', [
            makeEl('topic/fig', [
                makeEl('topic/title', [makeText('Figure 1')]),
                makeEl('topic/image', [], { href: 'img.png' }),
            ]),
        ]);
        const html = (0, renderer_1.renderDocument)(doc, defaultCtx);
        assert.ok(html.includes('<figure'));
        assert.ok(html.includes('<figcaption>Figure 1</figcaption>'));
    });
    it('should render local xref as clickable anchor', () => {
        const doc = makeEl('topic/topic', [
            makeEl('topic/xref', [makeText('see section')], { href: '#section1' }),
        ]);
        const html = (0, renderer_1.renderDocument)(doc, defaultCtx);
        assert.ok(html.includes('title="xref"'));
        assert.ok(html.includes('href="#section1"'));
        assert.ok(html.includes('see section'));
    });
    it('should render external xref showing the href', () => {
        const doc = makeEl('topic/topic', [
            makeEl('topic/xref', [], { href: 'other.dita#topic1' }),
        ]);
        const html = (0, renderer_1.renderDocument)(doc, defaultCtx);
        assert.ok(html.includes('other.dita#topic1'));
    });
    it('should render inline formatting', () => {
        const doc = makeEl('topic/topic', [
            makeEl('topic/b', [makeText('bold')]),
            makeEl('topic/i', [makeText('italic')]),
            makeEl('topic/u', [makeText('underline')]),
            makeEl('topic/tt', [makeText('mono')]),
            makeEl('topic/sup', [makeText('sup')]),
            makeEl('topic/sub', [makeText('sub')]),
        ]);
        const html = (0, renderer_1.renderDocument)(doc, defaultCtx);
        assert.ok(html.includes('title="b"'));
        assert.ok(html.includes('title="i"'));
        assert.ok(html.includes('title="u"'));
        assert.ok(html.includes('title="tt"'));
        assert.ok(html.includes('title="sup"'));
        assert.ok(html.includes('title="sub"'));
        assert.ok(html.includes('>bold<'));
        assert.ok(html.includes('>italic<'));
        assert.ok(html.includes('>underline<'));
        assert.ok(html.includes('>mono<'));
        assert.ok(html.includes('>sup<'));
        assert.ok(html.includes('>sub<'));
    });
    it('should render quotes and blockquotes', () => {
        const doc = makeEl('topic/topic', [
            makeEl('topic/q', [makeText('inline quote')]),
            makeEl('topic/lq', [makeText('block quote')]),
        ]);
        const html = (0, renderer_1.renderDocument)(doc, defaultCtx);
        assert.ok(html.includes('title="q"'));
        assert.ok(html.includes('title="lq"'));
        assert.ok(html.includes('>inline quote<'));
        assert.ok(html.includes('>block quote<'));
    });
    it('should render keyword and term with spans', () => {
        const doc = makeEl('topic/topic', [
            makeEl('topic/keyword', [makeText('kw')]),
            makeEl('topic/term', [makeText('term')]),
        ]);
        const html = (0, renderer_1.renderDocument)(doc, defaultCtx);
        assert.ok(html.includes('title="keyword"'));
        assert.ok(html.includes('title="term"'));
        assert.ok(html.includes('class="keyword"'));
        assert.ok(html.includes('class="term"'));
        assert.ok(html.includes('>kw<'));
        assert.ok(html.includes('>term<'));
    });
    it('should escape HTML in text nodes', () => {
        const doc = makeEl('topic/topic', [
            makeEl('topic/p', [makeText('<hello & world>')]),
        ]);
        const html = (0, renderer_1.renderDocument)(doc, defaultCtx);
        assert.ok(html.includes('&lt;hello &amp; world&gt;'));
    });
    it('should not crash on unknown baseType', () => {
        const doc = makeEl('topic/topic', [
            makeEl('unknown/type', [makeText('content')]),
        ]);
        const html = (0, renderer_1.renderDocument)(doc, defaultCtx);
        assert.ok(html.includes('content'));
    });
    it('should resolve xref title from resolveTitle function', () => {
        const ctx = {
            ...defaultCtx,
            resolveTitle: (id) => (id === 'sec1' ? '目标章节标题' : undefined),
        };
        const doc = makeEl('topic/topic', [
            makeEl('topic/xref', [], { href: '#topic/sec1' }),
        ]);
        const html = (0, renderer_1.renderDocument)(doc, ctx);
        assert.ok(html.includes('目标章节标题'));
        assert.ok(html.includes('href="#sec1"'));
    });
    it('should escape resolveTitle content to prevent HTML injection', () => {
        const ctx = {
            ...defaultCtx,
            resolveTitle: () => 'A <img src=x onerror="alert(1)"> title',
        };
        const doc = makeEl('topic/topic', [
            makeEl('topic/xref', [], { href: '#topic/sec1' }),
        ]);
        const html = (0, renderer_1.renderDocument)(doc, ctx);
        assert.ok(html.includes('A &lt;img src=x onerror=&quot;alert(1)&quot;&gt; title'));
        assert.ok(!html.includes('<img'));
    });
    it('should add language label to codeblock with outputclass', () => {
        const doc = makeEl('topic/topic', [
            makeEl('topic/codeblock', [makeText('code')], { outputclass: 'language-cpp' }),
        ]);
        const html = (0, renderer_1.renderDocument)(doc, defaultCtx);
        assert.ok(html.includes('class="codeblock-lang"'));
        assert.ok(html.includes('cpp'));
        assert.ok(html.includes('class="codeblock language-cpp"'));
    });
    it('should escape id attribute to prevent XSS', () => {
        const doc = makeEl('topic/topic', [
            makeEl('topic/section', [makeText('ok')], { id: 'x"><img src=x onerror="alert(1)">' }),
        ]);
        const html = (0, renderer_1.renderDocument)(doc, defaultCtx);
        assert.ok(!html.includes('<img '), 'should not contain raw img tag');
        assert.ok(html.includes('&gt;&lt;img'), 'should have escaped angle brackets');
        assert.ok(html.includes('&quot;'), 'should have escaped quotes');
    });
    it('should escape note type attribute to prevent XSS', () => {
        const doc = makeEl('topic/topic', [
            makeEl('topic/note', [makeText('ok')], { type: 'x"><img src=x onerror="alert(1)">' }),
        ]);
        const html = (0, renderer_1.renderDocument)(doc, defaultCtx);
        assert.ok(!html.includes('<img '));
        assert.ok(html.includes('note--x'));
        assert.ok(html.includes('&gt;&lt;img'));
        assert.ok(html.includes('&quot;'));
    });
    it('should escape xref href and prevent tag injection in fallback content', () => {
        const doc = makeEl('topic/topic', [
            makeEl('topic/xref', [], { href: '#x"><img src=x onerror="alert(1)">' }),
        ]);
        const html = (0, renderer_1.renderDocument)(doc, defaultCtx);
        assert.ok(!html.includes('<img '), 'should not contain raw img tag');
        assert.ok(html.includes('&gt;&lt;img'), 'angle brackets in fallback content should be escaped');
        assert.ok(html.includes('&quot;'), 'quotes should be escaped');
    });
    it('should escape image alt attribute to prevent XSS', () => {
        const doc = makeEl('topic/topic', [
            makeEl('topic/image', [], { href: 'test.png', alt: 'x"><img src=x onerror="alert(1)">' }),
        ]);
        const html = (0, renderer_1.renderDocument)(doc, defaultCtx);
        // The page's own <img> tag is fine; check the injected payload doesn't create a SECOND img
        const firstImg = html.indexOf('<img');
        const secondImg = html.indexOf('<img', firstImg + 1);
        assert.ok(secondImg === -1, 'should not contain a second raw img tag from injection');
        assert.ok(html.includes('&gt;&lt;img'), 'angle brackets should be escaped');
        assert.ok(html.includes('&quot;'), 'quotes should be escaped');
    });
    it('should not double-escape ampersand in attributes', () => {
        const doc = makeEl('topic/topic', [
            makeEl('topic/section', [makeText('ok')], { id: 'A&B "test"' }),
        ]);
        const html = (0, renderer_1.renderDocument)(doc, defaultCtx);
        assert.ok(html.includes('A&amp;B &quot;test&quot;'), 'should escape once');
        assert.ok(!html.includes('&amp;amp;'), 'should not double-escape');
    });
    it('should increase heading level inside sections', () => {
        const doc = makeEl('topic/topic', [
            makeEl('topic/title', [makeText('Main')]),
            makeEl('topic/body', [
                makeEl('topic/section', [
                    makeEl('topic/title', [makeText('Section')]),
                ]),
            ]),
        ]);
        const html = (0, renderer_1.renderDocument)(doc, defaultCtx);
        assert.ok(html.includes('title="title"'));
        assert.ok(html.includes('>Main<'));
        assert.ok(/<h1[\s>]/.test(html));
        assert.ok(/<h2[\s>]/.test(html));
        assert.ok(html.includes('>Section<'));
    });
});
//# sourceMappingURL=renderer.test.js.map