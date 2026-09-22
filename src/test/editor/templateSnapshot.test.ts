import * as assert from 'assert';
import { buildTemplateSnapshotHtml } from '../../editor/templateSnapshot';
import type { SiteTemplate } from '../../editor/siteTemplates';

const toUri = (p: string) => `file://${p}`;
const readFile = (p: string) => `/* css:${p} */ body[data-template="x"] { background: red; }`;

function makeTemplate(overrides: Partial<SiteTemplate> = {}): SiteTemplate {
  return {
    id: 'sample',
    names: { '': 'Sample' },
    defaultDark: false,
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
