import * as assert from 'assert';
import { buildTemplateSnapshotHtml } from '../../editor/templateSnapshot';
import type { SiteTemplate } from '../../editor/siteTemplates';

const toUri = (p: string) => `file://${p}`;
const readFile = (p: string) => `/* css:${p} */ body[data-template="x"] { background: red; }`;

function makeTemplate(overrides: Partial<SiteTemplate> = {}): SiteTemplate {
  return {
    id: 'sample',
    names: { '': 'Sample' },
    dom: 'own',
    defaultDark: false,
    outline: false,
    css: ['/t/sample.css'],
    dir: '/t',
    builtin: true,
    ...overrides,
  };
}

describe('buildTemplateSnapshotHtml', () => {
  it('embeds the template css text and the data-template hook', () => {
    const html = buildTemplateSnapshotHtml({
      baseCss: '/* base */',
      template: makeTemplate(),
      readFile,
      toUri,
      mode: 'site',
      dark: false,
    });
    assert.ok(html.includes('data-template="sample"'));
    assert.ok(html.includes('css:/t/sample.css'));
    assert.ok(html.includes('/* base */'), 'base stylesheet text must be present so shared shell rules apply');
  });

  it('renders a header/footer only when the template has one, never bare markup', () => {
    const withChrome = buildTemplateSnapshotHtml({
      baseCss: '',
      template: makeTemplate({ header: { title: '{title}', links: [] }, footer: { text: '© {year}', links: [] } }),
      readFile,
      toUri,
      mode: 'site',
      dark: false,
    });
    assert.ok(withChrome.includes('tpl-header'));
    assert.ok(withChrome.includes('tpl-footer'));
    assert.ok(withChrome.includes('site-shell'), 'the site-shell body class only applies once a header/footer wraps the frame');

    const withoutChrome = buildTemplateSnapshotHtml({
      baseCss: '',
      template: makeTemplate(),
      readFile,
      toUri,
      mode: 'site',
      dark: false,
    });
    assert.ok(!withoutChrome.includes('tpl-header'));
    assert.ok(!withoutChrome.includes('site-shell'));
  });

  it('always includes the fixture book-entry the content-visibility check reads back', () => {
    const html = buildTemplateSnapshotHtml({
      baseCss: '',
      template: makeTemplate(),
      readFile,
      toUri,
      mode: 'book',
      dark: false,
    });
    assert.ok(html.includes('id="fixture-book-entry"'));
    assert.ok(html.includes('mode-book'));
  });

  it('marks the document and body dark only when asked', () => {
    const dark = buildTemplateSnapshotHtml({ baseCss: '', template: makeTemplate(), readFile, toUri, mode: 'site', dark: true });
    assert.ok(dark.includes('vscode-dark'));
    assert.ok(dark.includes('template-dark'));

    const light = buildTemplateSnapshotHtml({ baseCss: '', template: makeTemplate(), readFile, toUri, mode: 'site', dark: false });
    assert.ok(!light.includes('vscode-dark'));
    assert.ok(!light.includes('template-dark'));
  });

  it('a template id with characters unsafe in an attribute is sanitised the same way templateDataAttr does', () => {
    const html = buildTemplateSnapshotHtml({
      baseCss: '',
      template: makeTemplate({ id: 'a b/c"d' }),
      readFile,
      toUri,
      mode: 'site',
      dark: false,
    });
    assert.ok(html.includes('data-template="a_b_c_d"'));
  });
});

describe('buildTemplateSnapshotHtml with a webhelp-DOM template (M3-11)', () => {
  // The visual check is the only place a webhelp template's css can be seen
  // laid out, and until now the snapshot builder hand-wove the route A shell
  // for every template, so a dom:"webhelp" template got an own-DOM page and the
  // check proved nothing about the contract. These pin the second branch.
  const build = (over: { landingPage?: boolean; compatCss?: string } = {}) =>
    buildTemplateSnapshotHtml({
      baseCss: '',
      compatCss: over.compatCss,
      template: makeTemplate({ dom: 'webhelp' }),
      readFile,
      toUri,
      mode: 'site',
      dark: false,
      landingPage: over.landingPage,
    });

  it('goes through the same wrapShell as the live preview, so the hooks cannot drift', () => {
    const html = build();
    assert.ok(html.includes('class="wh_topic_page"') || /<body class="[^"]*\bwh_topic_page\b/.test(html), html.slice(0, 400));
    for (const hook of ['wh_header', 'wh_tools', 'wh_content_area', 'wh_publication_toc', 'wh_topic_body', 'wh_topic_toc', 'wh_footer']) {
      assert.ok(html.includes(hook), `missing .${hook} in the snapshot`);
    }
    assert.ok(!html.includes('site-frame'), 'the route A frame must not appear on a webhelp page');
  });

  it('the topic-page snapshot does NOT carry wh_main_page', () => {
    assert.ok(!/\bwh_main_page\b/.test(build()), 'a topic snapshot must not look like a landing page');
  });

  it('a landing-page snapshot adds the body token and the tile hook names', () => {
    const html = build({ landingPage: true });
    assert.ok(/<body class="[^"]*\bwh_main_page\b/.test(html), html.slice(0, 300));
    assert.ok(html.includes('class="site-home-grid wh_tiles"'), html);
    assert.ok(html.includes('class="site-home-tile wh_tile"'), html);
    assert.ok(html.includes('class="site-home-tile-title wh_tile_title"'), html);
  });

  it('kill test: a route A landing-page snapshot gets neither token nor hook names', () => {
    // The same landingPage flag against an own-DOM template must produce the
    // route A markup exactly: no contract class may leak onto a template that
    // was promised route A's DOM unchanged.
    const html = buildTemplateSnapshotHtml({
      baseCss: '',
      template: makeTemplate({ dom: 'own' }),
      readFile,
      toUri,
      mode: 'site',
      dark: false,
      landingPage: true,
    });
    assert.ok(!/wh_main_page|wh_tile/.test(html), html.slice(0, 400));
    assert.ok(html.includes('site-home-tile-title') && html.includes('site-home-grid'), html);
  });

  it('the compat sheet is emitted between base and template css, matching the real <head> order', () => {
    const html = build({ compatCss: '/*compat*/' });
    const at = (s: string) => html.indexOf(s);
    assert.ok(at('dita-base-style') < at('dita-compat-style'), 'compat must come after styles.css (its @layer is what makes order irrelevant, but the preview loads it here)');
    assert.ok(at('dita-compat-style') < at('dita-template-style'), 'template css last, unlayered, so it wins');
    assert.ok(html.includes('/*compat*/'));
  });

  it('with no compatCss given, no compat <style> is emitted at all (route A snapshots unchanged)', () => {
    assert.ok(!build().includes('dita-compat-style'));
  });

  it('the landing page still keeps #dita-content-root as the single swapped node', () => {
    const html = build({ landingPage: true });
    assert.strictEqual((html.match(/id="dita-content-root"/g) ?? []).length, 1);
  });
});
