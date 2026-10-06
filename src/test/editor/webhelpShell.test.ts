import * as assert from 'assert';
import { load } from 'cheerio';
import { wrapShell } from '../../editor/templateChrome';
import { buildWebhelpShell } from '../../editor/webhelpShell';
import { WEBHELP_HOOKS, missingHooks } from '../../editor/webhelpContract';

/**
 * The webhelp shell is the second consumer of the hand-written hook contract
 * (webhelpContract.ts): step 2's test proved an empty page is missing every
 * required hook, this one proves the real shell drops in all of them. The
 * sidebar stub below carries `li.topicref` because that hook is the tree's
 * (milestone 1 step 4 adds the class to the real rows); everything else the
 * required hooks name is the shell's own skeleton. The markup is written by
 * hand for these tests -- none of it is taken from any third-party output.
 */

// A sidebar with one topic row: the shell wraps this verbatim, so the
// `li.topicref` required hook comes from here, not from the shell.
const SIDEBAR = '<nav class="site-nav"><ul class="site-nav-tree"><li class="topicref">A topic</li></ul></nav>';
const RESIZER = '<div id="__site-nav-resizer" class="site-nav-resizer"></div>';
const CONTENT = '<div id="dita-content-root" class="site-main"><h1>Body</h1></div>';

/** A "does the assembled page match this selector" predicate, body class included. */
function hasIn(r: { bodyClass: string; html: string }) {
  const $ = load(`<body class="${r.bodyClass.trim()}">${r.html}</body>`);
  return (selector: string) => $(selector).length > 0;
}

describe('buildWebhelpShell', () => {
  const shell = () => buildWebhelpShell({ sidebarHtml: SIDEBAR, resizerHtml: RESIZER, contentRootHtml: CONTENT, publicationTitle: 'The Book' });

  it('the shell carries every required contract hook (step 2\'s "empty page misses all" reversed)', () => {
    assert.deepStrictEqual(missingHooks(hasIn(shell())), []);
  });

  it('no required hook is one the shell forgot to even mention as optional', () => {
    // Sanity: the list the shell is checked against is the full required set.
    const required = WEBHELP_HOOKS.filter((h) => h.required).map((h) => h.selector);
    assert.ok(required.includes('nav#wh_publication_toc') && required.includes('footer.wh_footer'));
  });

  it('#dita-content-root stays the single content node, wrapped by .wh_topic_content', () => {
    const $ = load(`<body>${shell().html}</body>`);
    assert.strictEqual($('#dita-content-root').length, 1);
    assert.strictEqual($('.wh_topic_content #dita-content-root').length, 1);
  });

  it('three columns, in order, inside .wh_content_area: publication toc, topic body, topic toc', () => {
    const $ = load(`<body>${shell().html}</body>`);
    const area = $('.wh_content_area');
    assert.strictEqual(area.length, 1);
    const html = area.html() || '';
    const at = (s: string) => html.indexOf(s);
    assert.ok(at('id="wh_publication_toc"') >= 0 && at('id="wh_publication_toc"') < at('id="wh_topic_body"'));
    assert.ok(at('id="wh_topic_body"') < at('id="wh_topic_toc"'));
  });

  it('page order: header, tools bar, content area, footer', () => {
    const html = shell().html;
    const at = (s: string) => html.indexOf(s);
    assert.ok(at('<header class="wh_header"') < at('<nav class="wh_tools"'));
    assert.ok(at('<nav class="wh_tools"') < at('<div class="wh_content_area"'));
    assert.ok(at('<div class="wh_content_area"') < at('<footer class="wh_footer"'));
  });

  it('the sidebar tree drops inside #wh_publication_toc_content and the outline inside #wh_topic_toc_content', () => {
    const withOutline = buildWebhelpShell({
      sidebarHtml: SIDEBAR,
      resizerHtml: RESIZER,
      contentRootHtml: CONTENT,
      outlineHtml: '<aside id="__site-outline"></aside>',
      publicationTitle: 'T',
    });
    const $ = load(`<body>${withOutline.html}</body>`);
    assert.strictEqual($('#wh_publication_toc_content .site-nav').length, 1);
    assert.strictEqual($('#wh_topic_toc_content #__site-outline').length, 1);
  });

  it('the outline column always has its wrapper, even with no outline content (required hook)', () => {
    const $ = load(`<body>${shell().html}</body>`);
    assert.strictEqual($('#wh_topic_toc_content').length, 1);
    assert.strictEqual($('#wh_topic_toc_content').children().length, 0);
  });

  it('the logo hook is opt-in: present only when a logo uri is given, and its url is attribute-escaped', () => {
    assert.ok(!hasIn(shell())('.wh_logo'));
    const withLogo = buildWebhelpShell({
      sidebarHtml: SIDEBAR,
      resizerHtml: RESIZER,
      contentRootHtml: CONTENT,
      logoUri: '/t/a"b.svg',
    });
    assert.ok(hasIn(withLogo)('.wh_logo'));
    const $ = load(`<body>${withLogo.html}</body>`);
    assert.strictEqual($('.wh_logo img').attr('src'), '/t/a"b.svg');
  });

  it('the publication title is text-escaped, so it cannot inject markup', () => {
    const r = buildWebhelpShell({ sidebarHtml: SIDEBAR, resizerHtml: RESIZER, contentRootHtml: CONTENT, publicationTitle: '<script>alert(1)</script>' });
    assert.ok(!/<script[\s>]/i.test(r.html));
    const $ = load(`<body>${r.html}</body>`);
    assert.strictEqual($('.wh_publication_title').text(), '<script>alert(1)</script>');
  });

  it('the shell never emits a <script> tag', () => {
    assert.ok(!/<script[\s>]/i.test(shell().html));
  });

  it('the body class marks a webhelp topic page', () => {
    assert.strictEqual(shell().bodyClass, ' wh_topic_page');
  });
});

describe('wrapShell dom branch', () => {
  const parts = { sidebarHtml: SIDEBAR, resizerHtml: RESIZER, contentRootHtml: CONTENT };

  it('dom "webhelp" builds the webhelp skeleton and drops the own-mode site-frame', () => {
    const r = wrapShell({ ...parts, dom: 'webhelp', publicationTitle: 'T' });
    assert.strictEqual(r.bodyClass, ' wh_topic_page');
    assert.ok(r.html.includes('wh_topic_container') && !r.html.includes('site-frame'));
    assert.deepStrictEqual(missingHooks(hasIn(r)), []);
  });

  it('dom "own" (and no dom at all) keeps the route A shell untouched', () => {
    const explicit = wrapShell({ ...parts, dom: 'own', headerHtml: '<header/>', footerHtml: '<footer/>' });
    const implicit = wrapShell({ ...parts, headerHtml: '<header/>', footerHtml: '<footer/>' });
    assert.strictEqual(explicit.bodyClass, ' site-shell');
    assert.deepStrictEqual(explicit, implicit);
    assert.ok(explicit.html.includes('site-frame') && !explicit.html.includes('wh_topic_container'));
  });

  it('webhelp mode ignores the own-mode header/footer chrome', () => {
    const r = wrapShell({ ...parts, dom: 'webhelp', headerHtml: '<header class="tpl-header"/>', footerHtml: '<footer class="tpl-footer"/>' });
    assert.ok(!r.html.includes('tpl-header') && !r.html.includes('tpl-footer'));
    assert.ok(r.html.includes('header class="wh_header"'));
  });
});
