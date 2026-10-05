import * as assert from 'assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { renderTopicXml } from '../../editor/ditaRenderUtils';
import { buildKeySpace } from '../../editor/keySpace';

/**
 * Reference chains (A -> B -> C) resolve transitively: DITA requires it, and
 * the renderer used to stop after one hop. Each hop is resolved relative to the
 * file that *contains* the element carrying the reference, not the file being
 * rendered, so the fixtures keep every hop in a different directory.
 */

const wrap = (body: string, id = 't') => `<?xml version="1.0"?><topic id="${id}"><title>T</title><body>${body}</body></topic>`;

describe('conref / conkeyref chains', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'conref-chain-'));
    for (const d of ['topics', 'lib1', 'lib2', 'maps']) mkdirSync(join(root, d));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const w = (rel: string, content: string) => writeFileSync(join(root, rel), content);
  const render = (xml: string, keyMap: Map<string, string> = new Map()) =>
    renderTopicXml({ xml, docDir: join(root, 'topics'), keyMap, asWebviewUri: (p) => p, headingLevel: 1, uiLanguage: 'en' }).html;

  it('follows A -> B -> C across three files, each hop relative to its own file', () => {
    w('lib1/b.dita', wrap('<p id="pb" conref="../lib2/c.dita#c/pc">B-LITERAL</p>', 'b'));
    w('lib2/c.dita', wrap('<p id="pc">C-FINAL</p>', 'c'));
    const html = render(wrap('<p conref="../lib1/b.dita#b/pb">A-LITERAL</p>'));
    assert.ok(html.includes('C-FINAL'), html);
    assert.ok(!html.includes('B-LITERAL') && !html.includes('A-LITERAL'), html);
  });

  it('resolves a same-file "#id" hop inside the target against the target file, not the rendered one', () => {
    w('lib1/b.dita', wrap('<p id="pb" conref="#b/pc">B-LITERAL</p><p id="pc">B-SIBLING</p>', 'b'));
    const html = render(wrap('<p id="pc">LOCAL-DECOY</p><p conref="../lib1/b.dita#b/pb">A-LITERAL</p>'));
    assert.ok(html.includes('B-SIBLING'), html);
  });

  it('follows a conkeyref hop at the end of a conref chain', () => {
    w('maps/root.ditamap', '<map><keydef keys="shared" href="../lib2/c.dita"/></map>');
    w('lib2/c.dita', wrap('<p id="pc">KEYED-FINAL</p>', 'c'));
    w('lib1/b.dita', wrap('<p id="pb" conkeyref="shared/pc">B-LITERAL</p>', 'b'));
    const space = buildKeySpace(join(root, 'maps', 'root.ditamap'), [], (p, e) => readFileSync(p, e));
    const html = render(wrap('<p conref="../lib1/b.dita#b/pb">A-LITERAL</p>'), space.keys);
    assert.ok(html.includes('KEYED-FINAL'), html);
  });

  it('stops at the last resolvable hop when a later hop is missing', () => {
    w('lib1/b.dita', wrap('<p id="pb" conref="../lib2/gone.dita#g/pg">B-LITERAL</p>', 'b'));
    const html = render(wrap('<p conref="../lib1/b.dita#b/pb">A-LITERAL</p>'));
    assert.ok(html.includes('B-LITERAL'), html);
  });

  it('degrades to the first hop on a cycle instead of looping', () => {
    w('lib1/b.dita', wrap('<p id="pb" conref="../lib2/c.dita#c/pc">B-LITERAL</p>', 'b'));
    w('lib2/c.dita', wrap('<p id="pc" conref="../lib1/b.dita#b/pb">C-LITERAL</p>', 'c'));
    const html = render(wrap('<p conref="../lib1/b.dita#b/pb">A-LITERAL</p>'));
    assert.ok(html.includes('B-LITERAL'), html);
  });

  function chainFile(hops: number): void {
    // p1 -> p2 -> ... -> p{hops}; the referencing element points at p1, so it is `hops` hops deep.
    let body = '';
    for (let i = 1; i < hops; i++) body += `<p id="p${i}" conref="#lib/p${i + 1}">L${i}</p>`;
    body += `<p id="p${hops}">END</p>`;
    w('lib1/lib.dita', wrap(body, 'lib'));
  }

  it('resolves a chain of exactly 10 hops', () => {
    chainFile(10);
    const html = render(wrap('<p conref="../lib1/lib.dita#lib/p1">A-LITERAL</p>'));
    assert.ok(html.includes('END'), html);
  });

  it('degrades to a single hop when the chain is deeper than 10', () => {
    chainFile(11);
    const html = render(wrap('<p conref="../lib1/lib.dita#lib/p1">A-LITERAL</p>'));
    assert.ok(!html.includes('END'), html);
    assert.ok(html.includes('L1'), html);
  });

  it('a plain one-hop conref is unchanged', () => {
    w('lib1/b.dita', wrap('<p id="pb">B-ONLY</p>', 'b'));
    assert.ok(render(wrap('<p conref="../lib1/b.dita#b/pb">A</p>')).includes('B-ONLY'));
  });
});
