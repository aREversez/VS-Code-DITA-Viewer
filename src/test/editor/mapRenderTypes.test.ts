import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GeneratedMapHtml, RenderedMapContent, SiteManifestCache } from '../../editor/mapRenderTypes';

// dist-test/test/editor -> repo root is three levels up.
const repoRoot = join(__dirname, '..', '..', '..');
const read = (rel: string): string => readFileSync(join(repoRoot, rel), 'utf8');

/**
 * The shapes a map render hands to the panel's state handling live in a module
 * that does not import `vscode`, so that state handling can be unit-tested
 * without a host. Importing them here at all is the first half of that claim
 * (this build excludes every module that imports vscode); the second half is
 * that the provider no longer declares them itself.
 */
describe('mapRenderTypes', () => {
  it('RenderedMapContent is either content or an error, never both', () => {
    const ok: RenderedMapContent = { html: '<p>x</p>', files: new Set(['/a.dita']) };
    const bad: RenderedMapContent = { error: 'boom' };
    for (const r of [ok, bad]) {
      if (r.error === undefined) assert.strictEqual(r.html, '<p>x</p>');
      else assert.strictEqual(r.error, 'boom');
    }
  });

  it('GeneratedMapHtml carries what a render implies for the panel state', () => {
    const failed: GeneratedMapHtml = { html: '<body>err</body>', failed: true };
    const site: GeneratedMapHtml = {
      html: '<body/>',
      resolvedSitePage: '/m/a.dita',
      siteManifest: [],
      siteKeyMap: new Map(),
      siteBookMembers: new Set(),
      siteRender: { sidebarTreeHtml: '<ul/>', pageHtml: '<p/>' },
    };
    assert.strictEqual(failed.failed, true);
    assert.strictEqual(site.failed, undefined);
    const cache: SiteManifestCache = { manifest: site.siteManifest!, keyMap: site.siteKeyMap!, bookMembers: site.siteBookMembers! };
    assert.deepStrictEqual(cache.manifest, []);
  });

  it('MapViewerProvider imports the shapes instead of declaring them', () => {
    const source = read('src/editor/MapViewerProvider.ts');
    assert.ok(source.includes("from './mapRenderTypes'"), 'expected an import from mapRenderTypes');
    assert.ok(!/^interface MapRenderStage\b/m.test(source), 'MapRenderStage must not be declared in the provider');
    assert.ok(!/^type RenderedMapContent\b/m.test(source), 'RenderedMapContent must not be declared in the provider');
  });
});
