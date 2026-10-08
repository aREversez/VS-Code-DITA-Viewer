import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { templateWantsOutline } from '../../editor/siteTemplates';

// Route B step 7: the WebHelp-style page has an on-this-page column
// (#wh_topic_toc) that is part of its contract, but a webhelp template cannot
// say `"outline": true` -- an .opt descriptor has no such field, so it was
// always false. A webhelp template gets the outline in site mode regardless;
// book mode never has one, for any template (an earlier decision).

describe('templateWantsOutline', () => {
  it('site mode: a template that opts in, or one built for the webhelp DOM', () => {
    assert.strictEqual(templateWantsOutline('site', { outline: true, dom: 'own' }), true);
    assert.strictEqual(templateWantsOutline('site', { outline: false, dom: 'webhelp' }), true);
    assert.strictEqual(templateWantsOutline('site', { outline: true, dom: 'webhelp' }), true);
  });

  it('site mode: an own-DOM template that did not opt in has none', () => {
    assert.strictEqual(templateWantsOutline('site', { outline: false, dom: 'own' }), false);
  });

  it('book and tree mode never have one, whatever the template says', () => {
    for (const mode of ['book', 'tree'] as const) {
      assert.strictEqual(templateWantsOutline(mode, { outline: true, dom: 'webhelp' }), false, mode);
    }
  });

  it('no template, no outline', () => {
    assert.strictEqual(templateWantsOutline('site', undefined), false);
  });

  it('the map provider decides through it (wiring; the provider imports vscode)', () => {
    const src = readFileSync(join(__dirname, '..', '..', '..', 'src', 'editor', 'MapViewerProvider.ts'), 'utf8');
    assert.ok(src.includes('templateWantsOutline(mode, template)'));
    assert.ok(!/mode === 'site' && template\?\.outline/.test(src), 'the old inline condition is gone');
  });
});
