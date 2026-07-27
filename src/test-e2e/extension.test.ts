import * as assert from 'assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'dita-viewer.dita-viewer';

describe('extension activation', () => {
  it('activates without throwing', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension "${EXTENSION_ID}" was not found by VS Code — check the "publisher"/"name" fields in package.json still match EXTENSION_ID in this test if this fails`);
    await ext!.activate();
    assert.strictEqual(ext!.isActive, true);
  });

  it('registers the DITA Viewer commands', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    await ext?.activate();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('ditaViewer.showRendered'));
    assert.ok(commands.includes('ditaViewer.showSource'));
    assert.ok(commands.includes('ditaViewer.showMapRendered'));
    assert.ok(commands.includes('ditaViewer.showMapSource'));
    assert.ok(commands.includes('ditaViewer.transformWithDitaOt'));
  });
});
