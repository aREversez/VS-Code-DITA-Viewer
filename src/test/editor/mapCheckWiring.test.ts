import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

// The UI modules import `vscode`, so (like mapToolbarOrder.test.ts) the
// wiring is asserted on source/manifest text.
const root = join(__dirname, '..', '..', '..');
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8');
const pkg = JSON.parse(read('package.json'));
const nls = JSON.parse(read('package.nls.json'));

describe('Find Unreferenced Resources wiring', () => {
  it('declares the command with a title that exists in package.nls.json', () => {
    const c = pkg.contributes.commands.find((x: { command: string }) => x.command === 'ditaViewer.findUnreferencedResources');
    assert.ok(c);
    assert.ok(nls[c.title.replace(/%/g, '')]);
  });
  it('the navigator toolbar entry and the preview menu reach the dialog', () => {
    assert.ok(read('src', 'language', 'ditaMapTreeProvider.ts').includes("'ditaViewer.findUnreferencedResources'"));
    assert.ok(read('src', 'editor', 'MapViewerProvider.ts').includes("'ditaViewer.findUnreferencedResources'"));
  });
  it('is registered on activation with the navigator as the fallback map', () => {
    const ext = read('src', 'extension.ts');
    assert.ok(ext.includes('registerUnreferencedResourcesCommand(context'));
    assert.ok(ext.includes('mapTree.currentMapPath()'));
  });
});
