import * as assert from 'assert';
import { blocksFor, readRepo as read, stripComments as strip } from './cssBlocks';

// Smoke-test defect 1: in book mode the breadcrumb, the top menu and the
// sidebar highlight froze while the reader scrolled.
//
// Cause: the scripts that follow the reader's position (the book scroll-sync
// IntersectionObserver, the outline sync, the history's scroll restore, the
// search overlay) all treat #dita-content-root as THE scrolling element. The
// own shell gives it `overflow-y: auto`. The webhelp shell instead made its
// parent #wh_topic_body the scroller, so #dita-content-root grew to the full
// height of the content and never scrolled: with it as the observer's root,
// every anchor is always "inside" and no callback ever fires again.
//
// Neither jsdom nor this sandbox can run a layout, so these tripwires pin the
// invariant in the stylesheets: the content root scrolls, its parent does not,
// and a template cannot flip that back.

describe('webhelp shell: #dita-content-root is the scroller', () => {
  const compat = strip(read('media/webhelp-compat.css'));
  const styles = strip(read('media/styles.css'));

  it('the compat sheet gives #dita-content-root its own vertical scroll and a bounded height', () => {
    const blocks = blocksFor(compat, 'body.wh_topic_page #dita-content-root');
    assert.ok(blocks.some((b) => /overflow-y:\s*auto/.test(b)), blocks.join('|'));
    assert.ok(blocks.some((b) => /height:\s*100%/.test(b)), blocks.join('|'));
  });

  it('the wrappers between the body column and the content root pass a definite height down', () => {
    const wrapper = blocksFor(compat, 'body.wh_topic_page .wh_topic_content');
    assert.ok(wrapper.some((b) => /height:\s*100%/.test(b) && /box-sizing:\s*border-box/.test(b)), wrapper.join('|'));
  });

  it('the compat sheet no longer makes #wh_topic_body scroll', () => {
    for (const b of blocksFor(compat, 'body.wh_topic_page #wh_topic_body')) {
      assert.ok(!/overflow(-y)?:\s*auto|overflow(-y)?:\s*scroll/.test(b), b);
    }
  });

  it('styles.css pins #wh_topic_body as a non-scroller, so no template css can flip it back', () => {
    const blocks = blocksFor(styles, 'body.wh_topic_page #wh_topic_body');
    assert.ok(blocks.some((b) => /overflow:\s*hidden\s*!important/.test(b)), blocks.join('|'));
  });

  it('the manual smoke template does not make #wh_topic_body scroll either', () => {
    const smoke = strip(read('test-dita-file/manual/templates/webhelp-shell/webhelp-shell.css'));
    for (const b of blocksFor(smoke, '#wh_topic_body')) {
      assert.ok(!/overflow(-y)?:\s*auto|overflow(-y)?:\s*scroll/.test(b), b);
    }
  });

  it('the scripts that follow the reader still read #dita-content-root as the scroller', () => {
    // If one of these ever moves to another element, this invariant (and the
    // css above) has to move with it.
    const nav = read('src/editor/webview/siteNavScripts.ts');
    assert.ok(/new IntersectionObserver\(onIntersect, \{ root: contentRoot,/.test(nav));
    assert.ok(/var scroller = document\.getElementById\('dita-content-root'\);\s*return scroller \? scroller\.scrollTop : 0;/.test(nav));
  });
});
