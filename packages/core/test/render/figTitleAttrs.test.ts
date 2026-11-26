import * as assert from 'assert';
import { parseDita, preprocessEntities } from '../../src/parser/ditaParser';
import { renderElement } from '../../src/render/renderer';
import type { DitaNode } from '../../src/parser/domTypes';

// renderElement stamps a node's source-mapping attributes (data-dita-tagname,
// data-line, ...) onto the FIRST tag of whatever its renderer returns. A fig
// title renders as bare inline content inside <figcaption>, so when the title
// began with an inline element (<ph>, <b>, ...) the title's attributes landed
// on that child: a duplicate data-dita-tagname="title" ahead of its own
// data-dita-tagname="ph", which the browser resolves by keeping the first -- the
// <ph> reported itself as the title. The title now owns an element of its own.

function render(figXml: string, baseType: 'topic/fig' | 'topic/imagemap'): string {
  const doc = parseDita(preprocessEntities(`<topic id="t"><title>T</title><body>${figXml}</body></topic>`));
  const find = (n: DitaNode): DitaNode | undefined => {
    if (n.baseType === baseType) return n;
    for (const c of n.children || []) {
      const hit = find(c);
      if (hit) return hit;
    }
    return undefined;
  };
  return renderElement(find(doc.root)!, {
    headingLevel: 1,
    asWebviewUri: (p: string) => p,
    documentDir: '/t',
    parentBaseType: 'topic/body',
  });
}

/** Every opening tag whose attribute list names the same attribute twice. */
function duplicateAttributes(html: string): string[] {
  const bad: string[] = [];
  for (const m of html.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const names = [...m[0].matchAll(/\s([a-zA-Z][\w:-]*)=/g)].map((a) => a[1]);
    const dup = names.find((n, i) => names.indexOf(n) !== i);
    if (dup) bad.push(`${dup} in ${m[0]}`);
  }
  return bad;
}

const TITLES = ['Plain text', '<ph>Alpha</ph> beta', '<b>Bold</b> start', 'Text <ph>mid</ph>'];
const FIGS: [string, (t: string) => string, 'topic/fig' | 'topic/imagemap'][] = [
  ['fig', (t) => `<fig><title>${t}</title><image href="a.png"/></fig>`, 'topic/fig'],
  [
    'imagemap',
    (t) => `<imagemap><title>${t}</title><image href="a.png"/><area><shape>rect</shape><coords>0,0,5,5</coords><xref href="b.dita"/></area></imagemap>`,
    'topic/imagemap',
  ],
];

for (const [name, mk, baseType] of FIGS) {
  describe(`${name} title: source attributes stay on the right element`, () => {
    for (const title of TITLES) {
      it(`no duplicate attributes for "${title}"`, () => {
        const html = render(mk(title), baseType);
        assert.deepStrictEqual(duplicateAttributes(html), [], html);
      });
    }

    it('the title owns an element of its own, and an inline child keeps its own tag name', () => {
      const html = render(mk('<ph>Alpha</ph> beta'), baseType);
      const cap = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/.exec(html)![1];
      assert.ok(/^<span\b[^>]*class="figtitle"[^>]*data-dita-tagname="title"|^<span\b[^>]*data-dita-tagname="title"[^>]*class="figtitle"/.test(cap), cap);
      assert.ok(/<span\b[^>]*data-dita-tagname="ph"/.test(cap), cap);
      assert.strictEqual((cap.match(/data-dita-tagname="ph"/g) || []).length, 1, cap);
    });
  });
}
