// Probes behind COVERAGE.md: what the renderer does today with the reference
// forms DESIGN.md 4.5 lists. A passing test pins behaviour that is supported;
// a skipped test states the behaviour DITA 1.3 asks for where core falls short,
// and is switched on by the step that fixes it (DESIGN.md 4.7, step 2).

import * as assert from 'assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildKeySpace } from '../../src/editor/keySpace';
import { expandDitamapRefs } from '../../src/editor/refResolvers';
import { clearTopicRenderCache, renderTopicToHtml } from '../../src/editor/topicRender';
import { parseDitamap, preprocessEntities } from '../../src/parser/ditaParser';
import type { DitaNode } from '../../src/parser/domTypes';

const read = (p: string, enc: 'utf-8') => readFileSync(p, enc);

describe('coverage probes: reference resolution', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'coverage-refs-'));
    clearTopicRenderCache();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const write = (name: string, text: string): string => {
    const p = join(root, name);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, text);
    return p;
  };
  const keywordKey = (keys: string, value: string): string =>
    `<keydef keys="${keys}"><topicmeta><keywords><keyword>${value}</keyword></keywords></topicmeta></keydef>`;

  /** The body of a topic rendered through a map that defines `mapBody`, without the data-* bookkeeping attributes. */
  function body(topicBody: string, mapBody: string, files: Record<string, string> = {}): string {
    for (const [name, text] of Object.entries(files)) write(name, text);
    const topic = write('t.dita', `<?xml version="1.0"?><topic id="t"><title>T</title><body>${topicBody}</body></topic>`);
    const map = write('a.ditamap', `<?xml version="1.0"?><map>${mapBody}<topicref href="t.dita"/></map>`);
    const space = buildKeySpace(map, [], read);
    const r = renderTopicToHtml({
      filePath: topic,
      keyMap: space.keys,
      asWebviewUri: (p) => p,
      headingLevel: 1,
      clickableExternalXrefs: true,
    });
    assert.ok(!r.error, r.error);
    return (r.html.split('class="body">')[1] ?? r.html).replace(/ data-[a-z-]+="[^"]*"/g, '');
  }

  const OTHER = { 'other.dita': '<topic id="o"><title>OTitle</title></topic>' };
  const SRC =
    '<topic id="s"><title>S</title><body><p id="a">AAA</p><p id="b">BBB</p><p id="c">CCC</p><p id="d">DDD</p></body></topic>';

  describe('keyref on xref', () => {
    it('a key that only defines an href makes the xref a real link', () => {
      const html = body('<p><xref keyref="k"/></p>', '<keydef keys="k" href="other.dita"/>', OTHER);
      assert.match(html, /<a href="#" class="xref">/);
    });

    it('takes the link text from the key\'s linktext', () => {
      const html = body(
        '<p><xref keyref="k"/></p>',
        '<keydef keys="k" href="other.dita"><topicmeta><linktext>LT</linktext></topicmeta></keydef>',
        OTHER,
      );
      assert.match(html, /<a [^>]*class="xref">LT<\/a>/);
    });

    it('a key with no href and no linktext leaves a marked, unresolved xref', () => {
      const html = body('<p><xref keyref="k"/></p>', '<keydef keys="k"/>', OTHER);
      assert.match(html, /unresolved-keyref/);
    });

    // DITA 1.3 archSpec, "Processing key references to generate text or link text": a key with no
    // text gives an empty xref no effective content, so its link text comes from the target, as for
    // a direct href, and not from the key's name.
    it('with no content and no key text, the link text is the target topic\'s title, as for a direct href', () => {
      const html = body('<p><xref keyref="k"/></p>', '<keydef keys="k" href="other.dita"/>', OTHER);
      assert.match(html, /<a [^>]*class="xref">OTitle<\/a>/);
    });

    it('with no key text and a target that has no title, the link text is the href, as for a direct href', () => {
      const html = body('<p><xref keyref="k"/></p>', '<keydef keys="k" href="gone.dita"/>');
      assert.match(html, /<a [^>]*class="xref">gone\.dita<\/a>/);
    });

    it('a key whose own text is the key name still shows that text', () => {
      const html = body('<p><xref keyref="k"/></p>', keywordKey('k', 'k').replace('<keydef keys="k">', '<keydef keys="k" href="other.dita">'), OTHER);
      assert.match(html, /<a [^>]*class="xref">k<\/a>/);
    });

    it('a key with no href and no text is still an unresolved reference showing the key name', () => {
      const html = body('<p><xref keyref="k"/></p>', '<keydef keys="k"/>', OTHER);
      assert.match(html, /unresolved-keyref/);
    });
  });

  describe('keyref on image', () => {
    const PIC = { 'images/pic.png': 'not really a png' };

    it('a direct href resolves against the topic folder (the baseline the keyref case is measured against)', () => {
      assert.match(body('<p><image href="images/pic.png"/></p>', '', PIC), /<img src="images\/pic\.png"/);
    });

    // DITA 1.3, keyref on image: the key's href is the image.
    it('a key that only defines an href gives the image its src', () => {
      const html = body('<p><image keyref="k"/></p>', '<keydef keys="k" href="images/pic.png"/>', PIC);
      assert.match(html, /<img src="images\/pic\.png"/);
    });

    it('the key\'s href is relative to the map that defines it, not to the topic', () => {
      const files = { 'shared/maps/m.ditamap': '<map><keydef keys="logo" href="../art/logo.png"/></map>', 'shared/art/logo.png': 'x' };
      const html = body('<p><image keyref="logo"/></p>', '<mapref href="shared/maps/m.ditamap"/>', files);
      assert.match(html, /<img src="shared\/art\/logo\.png"/);
    });

    it('an href written on the image wins over its keyref', () => {
      const html = body('<p><image href="images/own.png" keyref="k"/></p>', '<keydef keys="k" href="images/pic.png"/>', PIC);
      assert.match(html, /<img src="images\/own\.png"/);
    });

    it('an external key href is used as given', () => {
      const html = body('<p><image keyref="k"/></p>', '<keydef keys="k" href="https://example.com/a.png" scope="external" format="png"/>');
      assert.match(html, /<img src="https:\/\/example\.com\/a\.png"/);
    });

    it('a key with no href leaves the image without a src, as before', () => {
      const html = body('<p><image keyref="k"/></p>', '<keydef keys="k"><topicmeta><keywords><keyword>K</keyword></keywords></topicmeta></keydef>', PIC);
      assert.match(html, /<img src=""/);
    });

    // DITA 1.3 §2.3.4.9: an empty <image> (no text, no <alt> child, no @alt)
    // takes the key's effective content as alternate text, equivalent to an
    // <alt> child.
    it('an empty image takes the key\'s text as alt text', () => {
      const html = body(
        '<p><image keyref="k"/></p>',
        '<keydef keys="k" href="images/pic.png"><topicmeta><linktext>LT</linktext></topicmeta></keydef>',
        PIC,
      );
      assert.match(html, /<img [^>]*alt="LT"/);
    });

    const LT = '<keydef keys="k" href="images/pic.png"><topicmeta><linktext>LT</linktext></topicmeta></keydef>';

    it('an alt written on the image wins over the key\'s text', () => {
      assert.match(body('<p><image keyref="k" alt="Own"/></p>', LT, PIC), /alt="Own"/);
    });

    it('an <alt> child wins over the key\'s text', () => {
      const html = body('<p><image keyref="k"><alt>Child</alt></image></p>', LT, PIC);
      assert.match(html, /alt="Child"/);
      assert.ok(!html.includes('alt="LT"'));
    });

    it('a key with an href and no text gives no alt attribute, not the key name', () => {
      const html = body('<p><image keyref="k"/></p>', '<keydef keys="k" href="images/pic.png"/>', PIC);
      assert.ok(!/alt=/.test(html), html);
    });

    it('the key text is escaped in the alt attribute', () => {
      const key = '<keydef keys="k" href="images/pic.png"><topicmeta><linktext>a &quot;b&quot; &lt;c&gt;</linktext></topicmeta></keydef>';
      assert.match(body('<p><image keyref="k"/></p>', key, PIC), /alt="a &quot;b&quot; &lt;c&gt;"/);
    });
  });

  describe('conref and conkeyref', () => {
    it('conref + conrefend pulls the run of siblings from the start through the end, and no further', () => {
      const html = body('<p conref="src.dita#s/a" conrefend="src.dita#s/c"/>', '', { 'src.dita': SRC });
      assert.match(html, /AAA[\s\S]*BBB[\s\S]*CCC/);
      assert.ok(!html.includes('DDD'));
    });

    it('conkeyref resolves the key to a file and takes the element after the slash', () => {
      const html = body('<p conkeyref="k/a"/>', '<keydef keys="k" href="src.dita"/>', { 'src.dita': SRC });
      assert.match(html, /<p class="p">AAA<\/p>/);
    });
  });

  describe('key scopes', () => {
    it('a qualified name reaches into a scope from outside it, a bare name takes the root definition', () => {
      const map = keywordKey('k', 'ROOT') + `<topicgroup keyscope="s1">${keywordKey('k', 'S1')}</topicgroup>`;
      assert.match(body('<p><ph keyref="s1.k"/></p>', map), />S1</);
      assert.match(body('<p><ph keyref="k"/></p>', map), />ROOT</);
    });
  });

  describe('mapref', () => {
    it('expands nested submaps and stops at a cycle instead of looping', () => {
      write('m1.ditamap', '<map><mapref href="m2.ditamap"/></map>');
      write('m2.ditamap', '<map><topicref href="deep.dita" navtitle="Deep"/><mapref href="m1.ditamap"/></map>');
      const doc = parseDitamap(preprocessEntities('<map><mapref href="m1.ditamap"/></map>'));
      assert.ok(doc.root);
      expandDitamapRefs(doc.root, root);
      const hrefs: string[] = [];
      const visit = (n: DitaNode): void => {
        if (n.type !== 'element') return;
        if (n.attributes?.href) hrefs.push(`${n.tagName}:${n.attributes.href}`);
        for (const c of n.children ?? []) visit(c);
      };
      visit(doc.root);
      assert.ok(hrefs.includes('mapref:m1.ditamap'));
      assert.ok(hrefs.includes('mapref:m2.ditamap'));
      assert.ok(hrefs.includes('topicref:deep.dita'));
    });
  });
});
