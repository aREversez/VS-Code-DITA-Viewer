import * as assert from 'assert';
import { renderSiteNavHtml, renderSiteNavTreeHtml, wrapSiteNavTreeHtml, DocsiteNavEntry } from '../../editor/ditaRenderUtils';
import { getSiteNavClickHandlerScript, getSiteNavCollapseStateHelperScript, getBookScrollSyncScript } from '../../editor/webview/siteNavScripts';

/**
 * Milestone 1 step 4 (webhelp-compat-plan.md §2.2): in webhelp mode the sidebar
 * rows carry the WebHelp tree classes ON TOP OF our own -- one node, two class
 * sets, our behaviour JS still on the site-nav classes and data-*, the
 * template css on the wh_ / topicref classes. Outside webhelp mode the tree must be byte-for-byte what it
 * always was (the kill test: every existing siteNav assertion still holds).
 */
const manifest = [
  { id: 'grp:0', title: 'Part', depth: 0, isGroup: true },
  { id: '/w/a.dita', absPath: '/w/a.dita', title: 'Alpha', depth: 1 },
  { id: '/w/b.dita', absPath: '/w/b.dita', title: 'Beta', depth: 1 },
  { id: '/w/c.dita', absPath: '/w/c.dita', title: 'Gamma', depth: 0 },
] as DocsiteNavEntry[];

const liClass = (html: string, needle: string): boolean => html.includes(`class="${needle}`);

describe('sidebar tree, webhelp double classes', () => {
  it('every row gains topicref on top of its own class', () => {
    const html = renderSiteNavTreeHtml(manifest, '/w/b.dita', undefined, undefined, false, true);
    assert.strictEqual((html.match(/class="site-nav-item[^"]*\btopicref\b/g) ?? []).length, 4);
  });

  it('a parent row is topicref + has-children + expanded; the active leaf is topicref + active', () => {
    const html = renderSiteNavTreeHtml(manifest, '/w/b.dita', undefined, undefined, false, true);
    assert.ok(liClass(html, 'site-nav-item site-nav-item--group has-children topicref expanded'), 'expanded parent');
    assert.ok(liClass(html, 'site-nav-item topicref active'), 'active leaf row');
    assert.ok(html.includes('class="site-nav-item topicref" role="treeitem"'), 'a plain leaf is topicref only');
  });

  it('a collapsed parent loses expanded but keeps collapsed (state, not decoration)', () => {
    const html = renderSiteNavTreeHtml(manifest, '/w/b.dita', undefined, new Set(['grp:0']), false, true);
    assert.ok(liClass(html, 'site-nav-item site-nav-item--group has-children collapsed topicref'), 'collapsed parent keeps has-children + topicref');
    assert.ok(!html.includes('has-children topicref expanded'), 'collapsed parent must not read expanded');
  });

  it('the active class also lands on the <li>, not only the link (template css keys li.active)', () => {
    const html = renderSiteNavTreeHtml(manifest, '/w/b.dita', undefined, undefined, false, true);
    assert.ok(/<li class="site-nav-item topicref active"[^>]*>[\s\S]*?<a href="#" class="site-nav-link active"/.test(html), 'li.active and its link.active agree');
  });

  it('renderSiteNavHtml / the wrapped nav thread the flag through', () => {
    const wrapped = renderSiteNavHtml(manifest, '/w/b.dita', 'Topics', undefined, undefined, false, true);
    assert.ok(wrapped.includes('topicref expanded'));
    assert.strictEqual(wrapSiteNavTreeHtml(renderSiteNavTreeHtml(manifest, '/w/b.dita', undefined, undefined, false, true), 'Topics'), wrapped);
  });
});

describe('sidebar tree stays exactly itself outside webhelp mode (kill)', () => {
  it('own mode emits no topicref / no li.expanded / no li.active', () => {
    for (const html of [
      renderSiteNavTreeHtml(manifest, '/w/b.dita'),
      renderSiteNavTreeHtml(manifest, '/w/b.dita', undefined, new Set(['grp:0'])),
      renderSiteNavTreeHtml(manifest, '/w/b.dita', undefined, undefined, true),
    ]) {
      assert.ok(!html.includes('topicref'), 'no topicref');
      assert.ok(!/<li class="[^"]*\bexpanded\b/.test(html), 'no expanded class (aria-expanded is not a class)');
      assert.ok(!/class="site-nav-item[^"]*\bactive\b/.test(html), 'active never on the <li>');
    }
  });

  it('the collapsed parent is byte-identical to before this step', () => {
    const before = renderSiteNavTreeHtml(manifest, '/w/b.dita', undefined, new Set(['grp:0']));
    assert.ok(liClass(before, 'site-nav-item site-nav-item--group has-children collapsed"'));
  });
});

describe('webhelp nav JS mirrors state onto the tree classes, gated on topicref', () => {
  const collapse = getSiteNavCollapseStateHelperScript({ reportCollapseMsgType: 'setNavCollapsed' });
  const siteClick = getSiteNavClickHandlerScript({ switchSitePageMsgType: 'switchSitePage' });
  const bookScroll = getBookScrollSyncScript();

  it('collapsing a row mirrors collapsed -> the topicref row\'s expanded class', () => {
    assert.ok(collapse.includes("classList.contains('topicref')"), 'the fold mirror is webhelp-gated');
    assert.ok(/classList\.add\('expanded'\)/.test(collapse) && /classList\.remove\('expanded'\)/.test(collapse), 'expanded added/removed');
  });

  it('a site page switch mirrors active onto the <li>, only for a topicref row', () => {
    assert.ok(siteClick.includes("classList.contains('topicref')"));
    assert.ok(siteClick.includes("closest('.site-nav-item')"));
  });

  it('book scroll sync mirrors active onto the <li> the same way', () => {
    assert.ok(bookScroll.includes("classList.contains('topicref')"));
    assert.ok(bookScroll.includes("closest('.site-nav-item')"));
  });
});
