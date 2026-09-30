import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MESSAGE_TEMPLATES, fill, formatMessage, msg } from '../../editor/mapCheckMessages';

// The UI modules import `vscode`, so (like mapToolbarOrder.test.ts) the
// wiring is asserted on source/manifest text.
const root = join(__dirname, '..', '..', '..');
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8');
const pkg = JSON.parse(read('package.json'));
const nls = JSON.parse(read('package.nls.json'));

const nlsZh = JSON.parse(read('package.nls.zh-cn.json'));
const cmd = (id: string) => pkg.contributes.commands.find((x: { command: string }) => x.command === id);

describe('Find Unreferenced Resources wiring', () => {
  const ids = [
    'ditaViewer.findUnreferencedResources',
    'ditaViewer.mapChecks.clear',
    'ditaViewer.mapChecks.rerunUnreferenced',
    'ditaViewer.mapChecks.changeUnreferenced',
    'ditaViewer.mapChecks.reveal',
    'ditaViewer.mapChecks.copyPath',
  ];
  it('declares its commands with titles present in both package.nls files', () => {
    for (const id of ids) {
      const c = cmd(id);
      assert.ok(c, id);
      const key = c.title.replace(/%/g, '');
      assert.ok(nls[key], `${id} en`);
      assert.ok(nlsZh[key], `${id} zh-cn`);
    }
  });

  it('adds a Map Checks view to the Explorer with a welcome panel that runs the command', () => {
    const view = pkg.contributes.views.explorer.find((v: { id: string }) => v.id === 'ditaViewer.mapChecks');
    assert.ok(view);
    const welcome = pkg.contributes.viewsWelcome.find((w: { view: string }) => w.view === 'ditaViewer.mapChecks');
    assert.ok(nls[welcome.contents.replace(/%/g, '')].includes('command:ditaViewer.findUnreferencedResources'));
  });

  it('keeps node-only commands out of the Command Palette', () => {
    const hidden = pkg.contributes.menus.commandPalette
      .filter((m: { when: string }) => m.when === 'false')
      .map((m: { command: string }) => m.command);
    for (const id of ids.filter((i) => i !== 'ditaViewer.findUnreferencedResources')) assert.ok(hidden.includes(id), id);
  });

  it('contributes the filter settings with Oxygen defaults', () => {
    const props = pkg.contributes.configuration.properties;
    assert.strictEqual(props['dita-viewer.unreferencedResources.includeFiles'].default, '*');
    assert.ok(props['dita-viewer.unreferencedResources.excludeFiles'].default.includes('.DS_Store'));
    assert.ok(props['dita-viewer.unreferencedResources.excludeFolders'].default.includes('.git'));
  });

  it('the navigator toolbar entry and the preview menu pass the map straight to the command', () => {
    assert.ok(read('src', 'language', 'ditaMapTreeProvider.ts').includes("'ditaViewer.findUnreferencedResources'"));
    assert.ok(read('src', 'editor', 'MapViewerProvider.ts').includes("'ditaViewer.findUnreferencedResources'"));
  });

  it('is registered on activation with the navigator as the fallback map', () => {
    const ext = read('src', 'extension.ts');
    assert.ok(ext.includes('registerUnreferencedResourcesCommand(context'));
    assert.ok(ext.includes('mapTree.currentMapPath()'));
  });

  it('no webview forms: results are a native tree view', () => {
    assert.ok(!read('src', 'editor', 'unreferencedResourcesUi.ts').includes('createWebviewPanel'));
    assert.ok(read('src', 'editor', 'mapCheckResultsView.ts').includes('createTreeView'));
  });
});

describe('completeness check message templates', () => {
  it('every template has a literal vscode.l10n.t call in completenessCheckUi.ts', () => {
    const ui = read('src', 'editor', 'completenessCheckUi.ts');
    for (const [code, template] of Object.entries(MESSAGE_TEMPLATES)) {
      const line = ui.split('\n').find((l) => l.includes(`case '${code}':`));
      assert.ok(line, `no case for ${code}`);
      assert.ok(line.includes(`vscode.l10n.t('${template.replace(/'/g, "\\'")}'`), `${code}: template text differs from its l10n call:\n${line}`);
    }
  });

  it('fill substitutes positional arguments, in any order', () => {
    assert.strictEqual(fill('a {1} b {0}', ['x', 2]), 'a 2 b x');
    assert.strictEqual(formatMessage(msg('ref.multiple', 't.dita', 3)), 'Topic referenced more than once (3 times): t.dita');
  });
});

describe('Validate and Check for Completeness wiring', () => {
  const ids = ['ditaViewer.validateMapCompleteness', 'ditaViewer.mapExplorer.validateCompleteness'];
  it('declares both commands with titles that exist in package.nls.json', () => {
    for (const id of ids) {
      const c = pkg.contributes.commands.find((x: { command: string }) => x.command === id);
      assert.ok(c, id);
      assert.ok(nls[c.title.replace(/%/g, '')], `${id} title`);
    }
  });

  it('map navigator toolbar: Find, Validate, then Pin/Unpin (one slot, exclusive), then Refresh', () => {
    const slot = (command: string): string[] =>
      pkg.contributes.menus['view/title'].filter((m: { command: string }) => m.command === command).map((m: { group: string }) => m.group);
    assert.deepStrictEqual(slot('ditaViewer.mapExplorer.findUnreferenced'), ['navigation@5']);
    assert.deepStrictEqual(slot('ditaViewer.mapExplorer.validateCompleteness'), ['navigation@6']);
    assert.deepStrictEqual(slot('ditaViewer.mapExplorer.pin'), ['navigation@7']);
    assert.deepStrictEqual(slot('ditaViewer.mapExplorer.unpin'), ['navigation@7']);
    assert.deepStrictEqual(slot('ditaViewer.mapExplorer.refresh'), ['navigation@8']);
  });

  it('the navigator toolbar entry reaches the dialog and it is registered on activation', () => {
    assert.ok(read('src', 'language', 'ditaMapTreeProvider.ts').includes("'ditaViewer.validateMapCompleteness'"));
    assert.ok(read('src', 'extension.ts').includes('registerCompletenessCommand(context'));
  });

  it('contributes the profiling-preference settings', () => {
    const props = pkg.contributes.configuration.properties;
    assert.ok(props['dita-viewer.completenessCheck.profilingAttributes']);
    assert.ok(props['dita-viewer.completenessCheck.singleValueProfilingAttributes']);
  });
});
