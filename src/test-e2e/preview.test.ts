import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'dita-viewer.dita-viewer';

// dist/test/preview.test.js -> repo root is two levels up.
const repoRoot = path.resolve(__dirname, '..', '..');
const fixturesDir = path.join(repoRoot, 'test-dita-file');

async function waitFor(check: () => boolean, timeoutMs = 8000, intervalMs = 150): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Timed out waiting for the preview to render.');
}

describe('DITA/DITAMAP preview rendering', () => {
  before(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    await ext?.activate();
  });

  it('renders a .dita topic and includes its title text', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID)!;
    const uri = vscode.Uri.file(path.join(fixturesDir, 'topics', 'db_overview.dita'));

    await vscode.commands.executeCommand('vscode.openWith', uri, 'ditaViewer.preview');

    const getHtml = () => ext.exports._test.getLastRenderedHtml(uri.toString());
    await waitFor(() => !!getHtml());

    const html = getHtml();
    assert.ok(html, 'expected rendered HTML to be captured for the opened .dita file');
    assert.ok(
      html.includes('数据库架构概述'),
      'expected rendered HTML to include the topic title text',
    );

    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  it('renders a .ditamap outline and includes a referenced topic label', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID)!;
    const uri = vscode.Uri.file(path.join(fixturesDir, 'test.ditamap'));

    await vscode.commands.executeCommand('vscode.openWith', uri, 'ditaViewer.mapPreview');

    const getHtml = () => ext.exports._test.getLastRenderedMapHtml(uri.toString());
    await waitFor(() => !!getHtml());

    const html = getHtml();
    assert.ok(html, 'expected rendered HTML to be captured for the opened .ditamap file');
    // test.ditamap has a plain `<topicref href="topics/db_overview.dita"/>`
    // with no <topicmeta>, so the tree view should fall back to the
    // href's filename (without extension) as the displayed label.
    assert.ok(
      html.includes('db_overview'),
      'expected rendered outline HTML to include a label derived from the referenced topic file',
    );

    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  it('toggles back to the source editor when the command runs in the reading view', async () => {
    const uri = vscode.Uri.file(path.join(fixturesDir, 'topics', 'db_overview.dita'));

    // Open the reading view directly (no source text tab open)
    await vscode.commands.executeCommand('vscode.openWith', uri, 'ditaViewer.preview');
    await waitFor(() => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      return tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === 'ditaViewer.preview';
    });

    // Running the command again from the reading view must switch to source
    await vscode.commands.executeCommand('ditaViewer.showRendered');
    await waitFor(() => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      return tab?.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString();
    });

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  it('toggles the map reading view back to source and focuses an existing text tab', async () => {
    const uri = vscode.Uri.file(path.join(fixturesDir, 'test.ditamap'));

    // Open source first, then the reading view beside it (the toolbar flow)
    await vscode.window.showTextDocument(uri);
    await vscode.commands.executeCommand('ditaViewer.showMapRendered');
    await waitFor(() => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      return tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === 'ditaViewer.mapPreview';
    });

    // Toggling from the reading view closes it and focuses the source tab
    await vscode.commands.executeCommand('ditaViewer.showMapRendered');
    await waitFor(() => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      return tab?.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString();
    });
    const previewStillOpen = vscode.window.tabGroups.all.some((g) =>
      g.tabs.some((t) => t.input instanceof vscode.TabInputCustom && t.input.viewType === 'ditaViewer.mapPreview'),
    );
    assert.strictEqual(previewStillOpen, false, 'expected the map reading view tab to be closed');

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  describe('Find All References', () => {
    it('finds keyref/conkeyref usages of a key from its keydef', async () => {
      const mapUri = vscode.Uri.file(path.join(fixturesDir, 'common', 'keys.ditamap'));
      const doc = await vscode.workspace.openTextDocument(mapUri);
      const text = doc.getText();
      const keyOffset = text.indexOf('product_name') + 2; // inside the token
      const position = doc.positionAt(keyOffset);

      const locations = (await vscode.commands.executeCommand(
        'vscode.executeReferenceProvider',
        mapUri,
        position,
      )) as vscode.Location[];

      const paths = locations.map((l) => path.basename(l.uri.fsPath));
      // Known usages of the product_name key in the fixture set (see
      // test-dita-file/topics/db_ui_test.dita and both relative_test maps).
      assert.ok(paths.includes('db_ui_test.dita'), `expected db_ui_test.dita among: ${paths.join(', ')}`);
      assert.ok(
        paths.includes('relative_path_test.ditamap'),
        `expected relative_path_test.ditamap among: ${paths.join(', ')}`,
      );
      assert.ok(
        paths.includes('relative_path_test-book.ditamap'),
        `expected relative_path_test-book.ditamap among: ${paths.join(', ')}`,
      );
    });

    it('finds conref usages of an id from its declaration', async () => {
      const topicUri = vscode.Uri.file(path.join(fixturesDir, 'topics', 'db_overview.dita'));
      const doc = await vscode.workspace.openTextDocument(topicUri);
      const text = doc.getText();
      const idOffset = text.indexOf('shared_note') + 2;
      const position = doc.positionAt(idOffset);

      const locations = (await vscode.commands.executeCommand(
        'vscode.executeReferenceProvider',
        topicUri,
        position,
      )) as vscode.Location[];

      // db_ui_test.dita has: conref="db_overview.dita#db_overview/shared_note"
      const paths = locations.map((l) => path.basename(l.uri.fsPath));
      assert.ok(paths.includes('db_ui_test.dita'), `expected db_ui_test.dita among: ${paths.join(', ')}`);
    });

    it('finds conref usages of an id from the conref reference site itself', async () => {
      // Cursor ON the conref value rather than on the id="..." declaration --
      // the other entry into the kind:'id' path. The fragment has to resolve
      // to the addressed element (shared_note), not to its topic scope
      // (db_overview), or this path agrees with neither the declaration site
      // above nor where Go to Definition actually lands.
      const uiUri = vscode.Uri.file(path.join(fixturesDir, 'topics', 'db_ui_test.dita'));
      const doc = await vscode.workspace.openTextDocument(uiUri);
      const text = doc.getText();
      const conrefOffset = text.indexOf('db_overview/shared_note') + 2;
      const position = doc.positionAt(conrefOffset);

      const locations = (await vscode.commands.executeCommand(
        'vscode.executeReferenceProvider',
        uiUri,
        position,
      )) as vscode.Location[];

      const paths = locations.map((l) => path.basename(l.uri.fsPath));
      assert.ok(paths.includes('db_ui_test.dita'), `expected db_ui_test.dita among: ${paths.join(', ')}`);
    });

    it('resolves references from a reference site (not just a declaration site)', async () => {
      // Put the cursor ON the keyref usage itself, not on the keydef --
      // should resolve to the same key and find the OTHER usages.
      const uiUri = vscode.Uri.file(path.join(fixturesDir, 'topics', 'db_ui_test.dita'));
      const doc = await vscode.workspace.openTextDocument(uiUri);
      const text = doc.getText();
      const keyrefOffset = text.indexOf('keyref="product_name"') + 10;
      const position = doc.positionAt(keyrefOffset);

      const locations = (await vscode.commands.executeCommand(
        'vscode.executeReferenceProvider',
        uiUri,
        position,
      )) as vscode.Location[];

      const paths = locations.map((l) => path.basename(l.uri.fsPath));
      assert.ok(
        paths.includes('relative_path_test.ditamap'),
        `expected to find sibling usages, got: ${paths.join(', ')}`,
      );
    });

    it('finds keyref usages when the cursor is on the keydef\'s <keyword> display text, not the keys attribute itself', async () => {
      // Regression/UX fix: clicking the human-readable label inside a
      // keydef (rather than the keys="..." attribute value itself) used to
      // silently fall through to "who references this ditamap file" --
      // technically valid results, but not an answer to what someone
      // clicking the visible product name text was actually asking.
      const mapUri = vscode.Uri.file(path.join(fixturesDir, 'common', 'keys.ditamap'));
      const doc = await vscode.workspace.openTextDocument(mapUri);
      const text = doc.getText();
      const keywordTextOffset = text.indexOf('DatabaseX Pro v3.0') + 2;
      const position = doc.positionAt(keywordTextOffset);

      const locations = (await vscode.commands.executeCommand(
        'vscode.executeReferenceProvider',
        mapUri,
        position,
      )) as vscode.Location[];

      const paths = locations.map((l) => path.basename(l.uri.fsPath));
      assert.ok(paths.includes('db_ui_test.dita'), `expected keyref usages, got: ${paths.join(', ')}`);
    });
  });

  describe('Shared file watcher', () => {
    const counts = (): Map<string, number> =>
      new Map(vscode.extensions.getExtension(EXTENSION_ID)!.exports._test.ditaFileWatcherCounts());
    const totalRefs = (m: Map<string, number>): number => [...m.values()].reduce((a, b) => a + b, 0);
    const snapshot = (): string => JSON.stringify([...counts()].sort());

    /**
     * Waits until the consumer counts stop moving. Opening a panel also changes
     * the active editor, which the Explorer's map tree reacts to by taking its
     * own share of the same folder's watcher; measuring before that lands would
     * make the "closing handed both shares back" assertion below depend on
     * event ordering rather than on the code.
     */
    async function settle(timeoutMs = 6000): Promise<void> {
      const start = Date.now();
      let last = snapshot();
      while (Date.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, 250));
        const now = snapshot();
        if (now === last) return;
        last = now;
      }
      throw new Error(`Timed out waiting for watcher consumers to settle: ${snapshot()}`);
    }

    it('serves a topic panel and a map panel from one folder watcher, and releases both on close', async () => {
      const ext = vscode.extensions.getExtension(EXTENSION_ID)!;
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await settle();
      const baseline = totalRefs(counts());

      const topic = vscode.Uri.file(path.join(fixturesDir, 'topics', 'db_overview.dita'));
      const map = vscode.Uri.file(path.join(fixturesDir, 'test.ditamap'));

      await vscode.commands.executeCommand('vscode.openWith', topic, 'ditaViewer.preview');
      await waitFor(() => !!ext.exports._test.getLastRenderedHtml(topic.toString()));
      await vscode.commands.executeCommand('vscode.openWith', map, 'ditaViewer.mapPreview');
      await waitFor(() => !!ext.exports._test.getLastRenderedMapHtml(map.toString()));
      await settle();

      const withBoth = counts();
      // test-runner.cjs opens test-dita-file as the single workspace folder, so
      // both documents resolve to the same watch base. Each panel used to build
      // its own createFileSystemWatcher over that base and the same glob.
      assert.strictEqual(
        withBoth.size,
        1,
        `expected one watched folder for two panels, got: ${[...withBoth.keys()].join(', ')}`,
      );
      assert.ok(
        totalRefs(withBoth) >= baseline + 2,
        `expected both panels to hold a share (baseline ${baseline}), got ${totalRefs(withBoth)}`,
      );

      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await settle();
      const afterClose = totalRefs(counts());
      // Not necessarily zero: the sidebar tree keeps its own share for the map
      // it is showing, which is what lets it notice a git checkout rewriting the
      // map on disk. What must be gone is the two panels' shares.
      assert.ok(
        afterClose <= totalRefs(withBoth) - 2,
        `expected both panels to release their shares: ${totalRefs(withBoth)} -> ${afterClose}`,
      );
    });
  });
});
