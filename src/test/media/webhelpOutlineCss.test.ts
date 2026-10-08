import * as assert from 'assert';
import { blocksFor, readRepo, stripComments } from './cssBlocks';

// Route B step 7: the outline list (built client-side by getOutlineSyncScript
// into #__site-outline) now sits inside the webhelp shell's own column. The
// column has to scroll once, hide when there is no list, and the list takes
// its colours from the same theming variables as the rest of the page.

const compat = stripComments(readRepo('media/webhelp-compat.css'));

describe('webhelp compat css: the on-this-page column', () => {
  it('styles.css hides the column unless a visible outline is inside it, beyond a template\'s reach', () => {
    const styles = stripComments(readRepo('media/styles.css'));
    const hide = blocksFor(styles, 'body.wh_topic_page nav#wh_topic_toc:not(:has(#__site-outline:not(.tpl-outline--empty)))');
    assert.ok(hide.some((b) => /display:\s*none\s*!important/.test(b)), hide.join('|'));
  });

  it('the outline box inside the column does not scroll, size or pad on its own', () => {
    const box = blocksFor(compat, 'body.wh_topic_page #wh_topic_toc_content .tpl-outline');
    assert.ok(box.some((b) => /overflow:\s*visible/.test(b) && /padding:\s*0/.test(b) && /flex:\s*none/.test(b)), box.join('|'));
  });

  it('the links take their colours from the theming variables, the active one from the primary colour', () => {
    const link = blocksFor(compat, 'body.wh_topic_page #wh_topic_toc_content .tpl-outline-link');
    assert.ok(link.some((b) => /color:\s*var\(--toc-color\)/.test(b)), link.join('|'));
    const active = blocksFor(compat, 'body.wh_topic_page #wh_topic_toc_content .tpl-outline-link.active');
    assert.ok(active.some((b) => /var\(--primary-color\)/.test(b)), active.join('|'));
  });
});
