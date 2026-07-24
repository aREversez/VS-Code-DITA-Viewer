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
});
