import * as assert from 'assert';
import { load } from 'cheerio';
import { WEBHELP_CSS_VARS, WEBHELP_HOOKS, missingHooks, requiredHooks } from '../../editor/webhelpContract';

// The contract is a list of class / id names a template's css can rely on,
// written by hand from the public interface names. The fixture below is a
// hand-written minimal page that carries each required hook once; it is not
// markup taken from any third-party output.
const CONFORMING = `<body class="wh_topic_page">
<header class="wh_header"><div class="wh_header_flex_container"><span class="wh_publication_title">T</span><ul class="wh_top_menu"></ul></div></header>
<div id="wh_topic_container">
  <nav class="wh_tools"><div class="wh_breadcrumb"></div><div class="wh_right_tools"><span class="wh_navigation_links"></span></div></nav>
  <div class="wh_content_area">
    <nav id="wh_publication_toc"><div id="wh_publication_toc_content"><ul><li class="topicref"></li></ul></div></nav>
    <div id="wh_topic_body"><div class="wh_topic_content body"></div></div>
    <nav id="wh_topic_toc"><div id="wh_topic_toc_content"></div></nav>
  </div>
</div>
<footer class="wh_footer"></footer>
</body>`;

const hasIn = (html: string) => {
  const $ = load(html);
  return (selector: string) => $(selector).length > 0;
};

describe('webhelp contract', () => {
  it('an empty page is missing every required hook (and names them)', () => {
    const missing = missingHooks(hasIn('<body></body>'));
    assert.deepStrictEqual(missing, requiredHooks().map((h) => h.selector));
    assert.ok(missing.length >= 15, `only ${missing.length} required hooks?`);
  });

  it('a page carrying every required hook is complete', () => {
    assert.deepStrictEqual(missingHooks(hasIn(CONFORMING)), []);
  });

  it('removing one hook reports exactly that hook', () => {
    const without = CONFORMING.replace('<div class="wh_breadcrumb"></div>', '');
    assert.deepStrictEqual(missingHooks(hasIn(without)), ['.wh_breadcrumb']);
  });

  it('a class on the wrong tag does not satisfy a tag-qualified hook', () => {
    const wrongTag = CONFORMING.replace('<footer class="wh_footer"></footer>', '<div class="wh_footer"></div>');
    assert.deepStrictEqual(missingHooks(hasIn(wrongTag)), ['footer.wh_footer']);
  });

  it('"all" also reports the optional hooks the page does not carry', () => {
    const all = missingHooks(hasIn(CONFORMING), 'all');
    assert.ok(all.includes('.wh_tiles'), all.join(' '));
    assert.ok(!all.includes('.wh_breadcrumb'));
  });

  it('every selector is unique and valid CSS', () => {
    const sels = WEBHELP_HOOKS.map((h) => h.selector);
    assert.strictEqual(new Set(sels).size, sels.length);
    const $ = load('<div></div>');
    for (const s of sels) assert.doesNotThrow(() => $(s), s);
  });

  it('every hook is a plain wh_ name or a topic-tree class: nothing vendor-specific beyond the interface', () => {
    for (const h of WEBHELP_HOOKS) {
      assert.ok(/^[a-z]*[.#][\w.#-]+$|^[a-z]+\.[\w.-]+$/.test(h.selector), h.selector);
      assert.ok(!/whc|oxy/i.test(h.selector), h.selector);
    }
  });

  it('every region of a topic page has at least one required hook', () => {
    const regions = new Set(requiredHooks().map((h) => h.region));
    for (const r of ['page', 'header', 'tools', 'toc', 'topic', 'outline', 'footer']) assert.ok(regions.has(r as never), r);
  });

  it('the theming variables are unique custom-property names', () => {
    assert.strictEqual(new Set(WEBHELP_CSS_VARS).size, WEBHELP_CSS_VARS.length);
    assert.strictEqual(WEBHELP_CSS_VARS.length, 28);
    for (const v of WEBHELP_CSS_VARS) assert.ok(/^--[a-z]+(-[a-z]+)*$/.test(v), v);
  });
});
