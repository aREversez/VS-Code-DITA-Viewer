import * as assert from 'assert';
import { blocksFor, readRepo, stripComments } from './cssBlocks';

// "Figure 1." / "Table 1." are generated, not authored: a counter bumped by
// each titled <figcaption> / <caption.tabletitle> and printed by ::before, so
// the markup (and the diff panel, which shares these two elements) needs no
// extra spans. Numbering restarts per top-level topic, the way DITA-OT numbers
// per output file, so a Book page of many topics does not run on from one
// topic's last figure into the next topic's first.
for (const rel of ['media/styles.css', 'packages/core/styles/dita-content.css']) {
  describe(`caption numbering and spacing: ${rel}`, () => {
    const css = stripComments(readRepo(rel));

    it('resets both counters on a top-level topic only', () => {
      const hit = blocksFor(css, 'article.topic:not(.topic .topic)');
      assert.ok(hit.some((b) => /counter-reset:\s*dita-fig\s+dita-tbl/.test(b)), JSON.stringify(hit));
    });

    it('numbers a figure caption', () => {
      assert.ok(blocksFor(css, 'figcaption').some((b) => /counter-increment:\s*dita-fig/.test(b)));
      const before = blocksFor(css, 'figcaption::before').join('\n');
      assert.ok(/counter\(dita-fig\)/.test(before), before);
    });

    it('numbers a table caption', () => {
      assert.ok(blocksFor(css, 'caption.tabletitle').some((b) => /counter-increment:\s*dita-tbl/.test(b)));
      const before = blocksFor(css, 'caption.tabletitle::before').join('\n');
      assert.ok(/counter\(dita-tbl\)/.test(before), before);
    });

    it('labels default to English and are overridable per language', () => {
      assert.ok(/--fig-label:\s*"Figure "/.test(css));
      assert.ok(/--tbl-label:\s*"Table "/.test(css));
      assert.ok(/:lang\(zh\)[^{]*\{[^}]*--fig-label:\s*"图 "/.test(css));
      assert.ok(/:lang\(zh\)[^{]*\{[^}]*--tbl-label:\s*"表 "/.test(css));
    });

    it('the table caption sits against its table (no heading margin, small bottom padding)', () => {
      const b = blocksFor(css, 'caption.tabletitle').join('\n');
      assert.ok(/caption-side:\s*top/.test(b), b);
      assert.ok(/padding:\s*0 0 0\.4rem/.test(b), b);
    });

    it('a figure image is a block with no margin of its own, so the caption sits right under it', () => {
      const b = blocksFor(css, 'figure.fig > img.image').join('\n');
      assert.ok(/display:\s*block/.test(b), b);
      assert.ok(/margin:\s*0/.test(b), b);
    });
  });
}
