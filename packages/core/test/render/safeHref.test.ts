import * as assert from 'assert';
import { parseDita, preprocessEntities } from '../../src/parser/ditaParser';
import { renderDocument, RenderContext } from '../../src/render/renderer';
import { isSafeHref } from '../../src/render/safeHref';

const ctx: RenderContext = { headingLevel: 1, asWebviewUri: (p: string) => p, documentDir: '/test' };
const render = (body: string): string =>
  renderDocument(parseDita(preprocessEntities(`<topic id="t"><title>T</title><body>${body}</body></topic>`)).root, ctx);

describe('isSafeHref', () => {
  it('allows anchors, http(s), mailto and relative paths', () => {
    for (const h of ['#a', '#t/s', 'http://x.y/z', 'HTTPS://x.y', 'mailto:a@b.c', 'a.html', '../a/b.dita#x', 'dir/file.pdf']) {
      assert.ok(isSafeHref(h), h);
    }
  });
  it('refuses script-capable and other schemes, however they are spelled', () => {
    for (const h of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:x', 'data:text/html,<b>', 'vbscript:x', 'file:///etc/passwd', 'C:\\x.exe', '']) {
      assert.ok(!isSafeHref(h), JSON.stringify(h));
    }
  });
});

describe('rendered links never carry a script-capable href', () => {
  it('<link href="javascript:..."> is a span, not an anchor', () => {
    const html = render('<related-links><link href="javascript:alert(1)"><linktext>go</linktext></link></related-links>');
    assert.ok(!/href="javascript/i.test(html), html);
    assert.ok(/<span class="link"[^>]*>/.test(html), html);
  });
  it('a normal <link> is still an anchor', () => {
    const html = render('<related-links><link href="a.dita"><linktext>go</linktext></link></related-links>');
    assert.ok(/<a href="a\.dita" class="link">/.test(html), html);
  });
  it('an imagemap area with a data: href has no href', () => {
    const html = render(
      '<imagemap><image href="a.png"/><area><shape>rect</shape><coords>0,0,5,5</coords><xref href="data:text/html,x" scope="external" format="html"/></area></imagemap>',
    );
    assert.ok(!/href="data:/i.test(html), html);
  });
});
