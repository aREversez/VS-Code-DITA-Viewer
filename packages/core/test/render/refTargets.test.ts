import * as assert from 'assert';
import { URL_SCHEME_RE, isDitaFormat, isNonDitaTarget } from '../../src/render/refTargets';
import { URL_SCHEME_RE as reExported } from '../../src/editor/refResolvers';

/**
 * The one rule the broken-reference hints share (xref, direct conref refs
 * and conkeyref keys): which file parts and formats they may never probe.
 */
describe('refTargets', () => {
  it('flags URLs, absolute paths and web documents; leaves DITA paths alone', () => {
    for (const p of ['https://a.example/x', 'mailto:a@b.c', 'C:\\docs\\a.dita', '/abs/a.dita', '\\\\srv\\a.dita', 'guide.html', 'G.HTM', 'manual.PDF']) {
      assert.ok(isNonDitaTarget(p), p);
    }
    for (const p of ['', 'a.dita', '../t/a.xml', 'maps/m.ditamap', 'notes.htmlx', 'a.pdf.dita']) {
      assert.ok(!isNonDitaTarget(p), p);
    }
  });

  it('treats an absent, dita or ditamap @format as DITA, anything else as not', () => {
    assert.ok(isDitaFormat(undefined) && isDitaFormat('') && isDitaFormat('dita') && isDitaFormat('ditamap'));
    assert.ok(!isDitaFormat('html') && !isDitaFormat('pdf'));
  });

  it('refResolvers still exports the same URL_SCHEME_RE (public API)', () => {
    assert.strictEqual(reExported, URL_SCHEME_RE);
  });
});
