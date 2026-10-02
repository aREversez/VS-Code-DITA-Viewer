import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MESSAGE_TEMPLATES, fill, formatMessage, msg } from '../../editor/mapCheckMessages';
import { CHECK_IDS, DEFAULT_ENABLED_CHECKS } from '../../editor/mapChecks';

// The UI modules import `vscode`, so (like mapToolbarOrder.test.ts) the
// wiring is asserted on source/manifest text.
const root = join(__dirname, '..', '..', '..');
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8');
const pkg = JSON.parse(read('package.json'));
const nls = JSON.parse(read('package.nls.json'));

const nlsZh = JSON.parse(read('package.nls.zh-cn.json'));
const cmd = (id: string) => pkg.contributes.commands.find((x: { command: string }) => x.command === id);

describe('Find Unreferenced Resources wiring', () => {
  const ids = ['ditaViewer.findUnreferencedResources', 'ditaViewer.clearMapCheckResults'];
  it('declares its commands with titles present in both package.nls files', () => {
    for (const id of ids) {
      const c = cmd(id);
      assert.ok(c, id);
      const key = c.title.replace(/%/g, '');
      assert.ok(nls[key], `${id} en`);
      assert.ok(nlsZh[key], `${id} zh-cn`);
    }
  });

  it('contributes the filter settings with Oxygen defaults', () => {
    const props = pkg.contributes.configuration.properties;
    assert.strictEqual(props['dita-viewer.unreferencedResources.includeFiles'].default, '*');
    assert.ok(props['dita-viewer.unreferencedResources.excludeFiles'].default.includes('.DS_Store'));
    assert.ok(props['dita-viewer.unreferencedResources.excludeFolders'].default.includes('.git'));
  });

  it('the navigator toolbar entry and the preview menu start the command', () => {
    assert.ok(read('src', 'language', 'ditaMapTreeProvider.ts').includes("'ditaViewer.findUnreferencedResources'"));
    assert.ok(read('src', 'editor', 'MapViewerProvider.ts').includes("'ditaViewer.findUnreferencedResources'"));
  });

  it('is registered on activation with the navigator as the fallback map', () => {
    const ext = read('src', 'extension.ts');
    assert.ok(ext.includes('registerUnreferencedResourcesCommand(context'));
    assert.ok(ext.includes('mapTree.currentMapPath()'));
  });

  it('native UI only: quick picks ask, the Problems panel lists the findings, no extra view or webview', () => {
    const ui = read('src', 'editor', 'unreferencedResourcesUi.ts');
    assert.ok(!ui.includes('createWebviewPanel') && !ui.includes('createTreeView'));
    assert.ok(ui.includes('createDiagnosticCollection'));
    assert.ok(ui.includes('folders to check (1/2)') && ui.includes('file types (2/2)'));
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
  it('declares its commands with titles present in both package.nls files', () => {
    for (const id of ids) {
      const c = cmd(id);
      assert.ok(c, id);
      const key = c.title.replace(/%/g, '');
      assert.ok(nls[key], `${id} en`);
      assert.ok(nlsZh[key], `${id} zh-cn`);
    }
  });

  it('keeps node-only commands out of the Command Palette', () => {
    const hidden = pkg.contributes.menus.commandPalette.filter((m: { when: string }) => m.when === 'false').map((m: { command: string }) => m.command);
    assert.ok(hidden.includes('ditaViewer.mapExplorer.validateCompleteness'));
  });

  it('the picker offers every check id; the enabledChecks setting matches CHECK_IDS and the Oxygen defaults', () => {
    const ui = read('src', 'editor', 'completenessCheckUi.ts');
    const setting = pkg.contributes.configuration.properties['dita-viewer.completenessCheck.enabledChecks'];
    for (const id of setting.items.enum) assert.ok(ui.includes(`'${id}'`), `picker lacks ${id}`);
    assert.deepStrictEqual([...setting.items.enum].sort(), [...CHECK_IDS].sort());
    assert.deepStrictEqual(setting.default, DEFAULT_ENABLED_CHECKS);
    assert.ok(pkg.contributes.configuration.properties['dita-viewer.completenessCheck.ditavalFiles']);
  });

  it('native UI only: a quick pick asks, a notification shows progress, the Problems panel lists the findings', () => {
    const ui = read('src', 'editor', 'completenessCheckUi.ts');
    assert.ok(!ui.includes('createWebviewPanel') && !ui.includes('createTreeView'));
    assert.ok(ui.includes('createQuickPick') && ui.includes('ProgressLocation.Notification') && ui.includes('createDiagnosticCollection'));
    assert.ok(!read('src', 'editor', 'mapCheckShared.ts').includes('LIST_SCRIPT'));
  });

  it('there is no separate Map Checks view: the Explorer keeps only the map navigator', () => {
    const ids = pkg.contributes.views.explorer.map((v: { id: string }) => v.id);
    assert.ok(!ids.includes('ditaViewer.mapChecks'));
    assert.ok(!Object.keys(pkg.contributes.menus).includes('ditaViewer.mapChecks'));
    assert.ok(pkg.contributes.commands.every((c: { command: string }) => !c.command.startsWith('ditaViewer.mapChecks.')));
  });

  it('one command clears the findings of both checks', () => {
    assert.ok(cmd('ditaViewer.clearMapCheckResults'));
    const ui = read('src', 'editor', 'unreferencedResourcesUi.ts');
    assert.ok(ui.includes('clearUnreferencedResults()') && ui.includes('clearCompletenessResults()'));
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

  it('the navigator toolbar entry reaches the command and it is registered on activation', () => {
    assert.ok(read('src', 'language', 'ditaMapTreeProvider.ts').includes("'ditaViewer.validateMapCompleteness'"));
    assert.ok(read('src', 'extension.ts').includes('registerCompletenessCommand(context'));
  });

  it('contributes the profiling-preference settings', () => {
    const props = pkg.contributes.configuration.properties;
    assert.ok(props['dita-viewer.completenessCheck.profilingAttributes']);
    assert.ok(props['dita-viewer.completenessCheck.singleValueProfilingAttributes']);
  });
});
