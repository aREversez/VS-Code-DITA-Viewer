import * as assert from 'assert';
import { parseDita, parseDitamap, preprocessEntities } from '../../parser/ditaParser';
import { renderDocument, RenderContext } from '../../render/renderer';
import { renderMapDocument } from '../../render/mapTypeMap';

const topicCtx: RenderContext = {
  headingLevel: 1,
  asWebviewUri: (p: string) => `vscode-resource:${p}`,
  documentDir: '/test',
};

/** Parse + render a topic fragment, returning (root, html). */
function parseTopic(xml: string): { root: ReturnType<typeof parseDita>['root']; html: string } {
  const doc = parseDita(preprocessEntities(xml));
  return { root: doc.root, html: renderDocument(doc.root, topicCtx) };
}

function parseMap(xml: string): string {
  const doc = parseDitamap(preprocessEntities(xml));
  return renderMapDocument(doc.root, { docDir: '/test' });
}

// ── Helpers to walk the DOM for a named descendant element ──
function findEl(node: ReturnType<typeof parseDita>['root'], tagName: string) {
  const stack = [node];
  while (stack.length) {
    const n = stack.shift()!;
    if (n.type === 'element' && n.tagName === tagName) return n;
    for (const c of n.children || []) if (c.type === 'element') stack.push(c);
  }
  return undefined;
}

describe('tag completion (DTD-derived baseType mappings)', () => {
  // ── Highlight domain: element-specific baseType + distinct renderer ──
  it('line-through resolves to topic/line-through and renders a semantic <s>', () => {
    const xml = `<topic id="t"><body><p><line-through>struck</line-through></p></body></topic>`;
    const { root, html } = parseTopic(xml);
    const lt = findEl(root, 'line-through');
    assert.ok(lt, 'line-through element should be parsed');
    assert.strictEqual(lt!.baseType, 'topic/line-through');
    // Semantic <s> tag (zero CSS), matching b→<strong>/i→<em> convention;
    // renderer injects title/data-* attrs after the tag name.
    assert.ok(/<s\b[^>]*>struck<\/s>/.test(html), `expected <s>struck</s>, got: ${html}`);
    assert.ok(!html.includes('text-decoration'), 'no inline style for line-through');
  });

  it('overline resolves to topic/overline and renders a class-only span', () => {
    const xml = `<topic id="t"><body><p><overline>over</overline></p></body></topic>`;
    const { root, html } = parseTopic(xml);
    const ov = findEl(root, 'overline');
    assert.strictEqual(ov!.baseType, 'topic/overline');
    // Class-only span (no inline style) so themes can override the decoration
    // via the .overline rule in styles.css.
    assert.ok(/<span\b[^>]*class="overline"[^>]*>over<\/span>/.test(html), `got: ${html}`);
    assert.ok(!html.includes('text-decoration'), 'overline must not use an inline style');
  });

  // ── Equation domain: first-pair baseType (existing renderers) ──
  it('equation-block resolves to topic/div and equation-figure to topic/fig', () => {
    const xml = `<topic id="t"><body>
      <equation-block><p>e=mc^2</p></equation-block>
      <equation-figure><title>Fig</title><image href="x.png"/></equation-figure>
    </body></topic>`;
    const { root, html } = parseTopic(xml);
    assert.strictEqual(findEl(root, 'equation-block')!.baseType, 'topic/div');
    assert.strictEqual(findEl(root, 'equation-figure')!.baseType, 'topic/fig');
    assert.ok(html.includes('class="body-div"'), 'equation-block should render via topic/div');
    assert.ok(html.includes('<figure'), 'equation-figure should render via topic/fig');
  });

  // ── Troubleshooting module ──
  it('troubleshooting structure resolves to topic ancestors (topic/body/section)', () => {
    const xml = `<troubleshooting id="ts">
      <title>Problem</title>
      <troublebody>
        <condition><p>Symptom</p></condition>
        <cause><p>Root cause</p></cause>
        <remedy><p>Fix it</p></remedy>
      </troublebody>
    </troubleshooting>`;
    const { root, html } = parseTopic(xml);
    assert.strictEqual(root.baseType, 'topic/topic');
    assert.strictEqual(findEl(root, 'troublebody')!.baseType, 'topic/body');
    assert.strictEqual(findEl(root, 'condition')!.baseType, 'topic/section');
    assert.strictEqual(findEl(root, 'cause')!.baseType, 'topic/section');
    assert.strictEqual(findEl(root, 'remedy')!.baseType, 'topic/section');
    assert.ok(/<main\b[^>]*class="body"/.test(html), 'troublebody should render as body');
    assert.ok(html.includes('Root cause'));
  });

  // ── Glossentry module ──
  it('glossentry sub-elements resolve to topic ancestors (body/title/note)', () => {
    const xml = `<glossentry id="g">
      <glossterm>API</glossterm>
      <glossBody>
        <glossPartOfSpeech>noun</glossPartOfSpeech>
        <glossAlt>
          <glossAbbreviation>API</glossAbbreviation>
          <glossScopeNote>See also SDK</glossScopeNote>
        </glossAlt>
      </glossBody>
    </glossentry>`;
    const { root, html } = parseTopic(xml);
    assert.strictEqual(findEl(root, 'glossBody')!.baseType, 'topic/body');
    assert.strictEqual(findEl(root, 'glossAbbreviation')!.baseType, 'topic/title');
    assert.strictEqual(findEl(root, 'glossAlt')!.baseType, 'topic/section');
    assert.strictEqual(findEl(root, 'glossScopeNote')!.baseType, 'topic/note');
    assert.ok(/<main\b[^>]*class="body"/.test(html), 'glossBody should render as body');
    assert.ok(html.includes('class="note'), 'glossScopeNote should render as a note');
  });

  it('glossentry cross-type elements (glossAlternateFor, glossSymbol) resolve to xref/image', () => {
    const xml = `<glossentry id="g2">
      <glossterm>Term</glossterm>
      <glossBody>
        <glossAlt>
          <glossAlternateFor href="other.dita">alt</glossAlternateFor>
          <glossSymbol href="sym.png">symbol</glossSymbol>
        </glossAlt>
      </glossBody>
    </glossentry>`;
    const { root } = parseTopic(xml);
    assert.strictEqual(findEl(root, 'glossAlternateFor')!.baseType, 'topic/xref');
    assert.strictEqual(findEl(root, 'glossSymbol')!.baseType, 'topic/image');
  });

  // ── Task requirements domain (taskreq-d) ──
  it('taskreq domain elements resolve to their topic list/section ancestors', () => {
    const xml = `<task id="tk">
      <title>T</title>
      <taskbody>
        <prelreqs><p>Before</p></prelreqs>
        <closereqs><p>After</p></closereqs>
        <reqconds>
          <reqcond><p>Cond A</p></reqcond>
          <noconds><p>None</p></noconds>
        </reqconds>
        <safety>
          <safecond><p>Wear gloves</p></safecond>
        </safety>
      </taskbody>
    </task>`;
    const { root, html } = parseTopic(xml);
    assert.strictEqual(findEl(root, 'prelreqs')!.baseType, 'topic/section');
    assert.strictEqual(findEl(root, 'closereqs')!.baseType, 'topic/section');
    assert.strictEqual(findEl(root, 'reqconds')!.baseType, 'topic/ul');
    assert.strictEqual(findEl(root, 'reqcond')!.baseType, 'topic/li');
    assert.strictEqual(findEl(root, 'noconds')!.baseType, 'topic/li');
    assert.strictEqual(findEl(root, 'safety')!.baseType, 'topic/ol');
    assert.strictEqual(findEl(root, 'safecond')!.baseType, 'topic/li');
    // safety (ol) > safecond (li); renderer injects title/data-* attrs into tags
    assert.ok(/<ol\b[^>]*>[\s\S]*?<li\b[^>]*>[\s\S]*?Wear gloves/.test(html), `got: ${html}`);
  });

  // ── Map-side: ditavalref / mapGroup / glossref / bookmap wrappers ──
  it('ditavalref and topicset resolve to map/topicref and render as nav items', () => {
    const xml = `<map>
      <ditavalref href="filter.ditaval"/>
      <topicset href="topics/set.dita"/>
      <topicsetref href="topics/setref.dita"/>
    </map>`;
    const html = parseMap(xml);
    assert.ok(html.includes('data-href="filter.ditaval"'), 'ditavalref should be a nav item');
    assert.ok(html.includes('data-href="topics/set.dita"'), 'topicset should be a nav item');
    assert.ok(html.includes('data-href="topics/setref.dita"'), 'topicsetref should be a nav item');
    assert.ok(
      (html.match(/map-tree-item--nav/g) || []).length >= 3,
      'all three should render as navigable map-tree items',
    );
  });

  it('glossref resolves to map/topicref', () => {
    const xml = `<map><glossref href="glossary.dita"/></map>`;
    const doc = parseDitamap(preprocessEntities(xml));
    const gr = doc.root.children.find((c) => c.type === 'element' && c.tagName === 'glossref')!;
    assert.strictEqual(gr.baseType, 'map/topicref');
    const html = renderMapDocument(doc.root, { docDir: '/test' });
    assert.ok(html.includes('data-href="glossary.dita"'));
  });

  it('bookmap appendices and booklist resolve to map/topicref', () => {
    const xml = `<bookmap>
      <appendices href="app.dita"/>
      <booklist href="figlist.dita"/>
    </bookmap>`;
    const doc = parseDitamap(preprocessEntities(xml));
    const ap = doc.root.children.find((c) => c.type === 'element' && c.tagName === 'appendices')!;
    const bl = doc.root.children.find((c) => c.type === 'element' && c.tagName === 'booklist')!;
    assert.strictEqual(ap.baseType, 'map/topicref');
    assert.strictEqual(bl.baseType, 'map/topicref');
    const html = renderMapDocument(doc.root, { docDir: '/test' });
    assert.ok(html.includes('data-href="app.dita"'));
    assert.ok(html.includes('data-href="figlist.dita"'));
  });
});
