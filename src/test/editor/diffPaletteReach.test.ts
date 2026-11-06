import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  contributes: { menus: { commandPalette: { command: string; when?: string }[] } };
};
const provider = readFileSync(join(root, 'src/editor/ditaDiffProvider.ts'), 'utf8');

describe('Compare with Git Version from the diff panel', () => {
  it('stays in the Command Palette while the diff webview is the active panel', () => {
    // `resourceExtname == .dita` is false for a webview panel, so the command
    // vanished exactly when the user wanted to pick another pair of versions.
    const entry = pkg.contributes.menus.commandPalette.find((e) => e.command === 'ditaViewer.compareWithGit');
    assert.ok(entry && entry.when, 'compareWithGit has a palette condition');
    assert.ok(entry.when.includes('activeWebviewPanelId == ditaViewer.diff'), entry.when);
  });

  it('targets the compared document when invoked from the diff panel', () => {
    // Without this the command would pass the palette and then stop at
    // "Please open a .dita file first.", since no editor or custom tab is active.
    assert.ok(/function activeDiffDocUri\(/.test(provider));
    assert.ok(/getActiveDitaUri\(\)\s*\?\?\s*activeDiffDocUri\(\)/.test(provider));
  });
});
