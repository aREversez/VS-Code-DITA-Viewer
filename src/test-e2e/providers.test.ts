import * as assert from 'assert';
import * as path from 'path';
import * as fsp from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';

const EXTENSION_ID = 'dita-viewer.dita-viewer';
const run = promisify(execFile);

// dist/test/providers.test.js -> repo root is two levels up. The scratch folder
// lives inside the workspace folder (test-dita-file) like rename.test.ts's, so
// the extension sees it exactly as it would a user's files.
const repoRoot = path.resolve(__dirname, '..', '..');
const scratch = path.join(repoRoot, 'test-dita-file', '__providers-e2e');

type TestApi = {
  getLastRenderedHtml: (uri: string) => string | undefined;
  getLastRenderedMapHtml: (uri: string) => string | undefined;
  getLastDiffHtml: (uri: string) => string | undefined;
};
const api = (): TestApi => (vscode.extensions.getExtension(EXTENSION_ID)!.exports as { _test: TestApi })._test;

async function waitFor(check: () => boolean, timeoutMs = 10000, intervalMs = 150): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Timed out waiting for the render.');
}

const topic = (id: string, body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<topic id="${id}"><title>${id} title</title><body>${body}</body></topic>\n`;

describe('providers end to end (topic preview, map preview, diff)', () => {
  before(async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
    await fsp.rm(scratch, { recursive: true, force: true });
    for (const d of ['topics', 'lib1', 'lib2', 'diff']) await fsp.mkdir(path.join(scratch, d), { recursive: true });
  });

  after(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await fsp.rm(scratch, { recursive: true, force: true });
  });

  it('topic preview follows a conref chain across three files', async () => {
    await fsp.writeFile(path.join(scratch, 'lib1', 'b.dita'), topic('b', '<p id="pb" conref="../lib2/c.dita#c/pc">B-LITERAL</p>'));
    await fsp.writeFile(path.join(scratch, 'lib2', 'c.dita'), topic('c', '<p id="pc">C-FINAL-TEXT</p>'));
    const file = path.join(scratch, 'topics', 'a.dita');
    await fsp.writeFile(file, topic('a', '<p conref="../lib1/b.dita#b/pb">A-LITERAL</p>'));
    const uri = vscode.Uri.file(file);

    await vscode.commands.executeCommand('vscode.openWith', uri, 'ditaViewer.preview');
    await waitFor(() => !!api().getLastRenderedHtml(uri.toString()));
    const html = api().getLastRenderedHtml(uri.toString())!;
    assert.ok(html.includes('C-FINAL-TEXT'), 'the chain should resolve to the last target');
    assert.ok(!html.includes('B-LITERAL') && !html.includes('A-LITERAL'), 'intermediate and own literal text are replaced');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  it('topic preview renders a @class-only specialization like its standard ancestor', async () => {
    const file = path.join(scratch, 'topics', 'special.dita');
    await fsp.writeFile(
      file,
      topic('s', '<p><mybold class="- topic/ph hi-d/b my-d/mybold ">SPECIAL-BOLD</mybold></p>'),
    );
    const uri = vscode.Uri.file(file);

    await vscode.commands.executeCommand('vscode.openWith', uri, 'ditaViewer.preview');
    await waitFor(() => !!api().getLastRenderedHtml(uri.toString()));
    const html = api().getLastRenderedHtml(uri.toString())!;
    assert.ok(/<strong[^>]*>SPECIAL-BOLD<\/strong>/.test(html), 'hi-d/b specialization should render as <strong>');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  it('map preview lists a topic referenced from a key scope with several names', async () => {
    await fsp.writeFile(path.join(scratch, 'topics', 'k.dita'), topic('k', '<p>K</p>'));
    const mapFile = path.join(scratch, 'scoped.ditamap');
    await fsp.writeFile(
      mapFile,
      '<?xml version="1.0"?>\n<map><title>Scoped</title><topicgroup keyscope="a b"><topicref href="topics/k.dita" keys="k"/></topicgroup></map>\n',
    );
    const uri = vscode.Uri.file(mapFile);

    await vscode.commands.executeCommand('vscode.openWith', uri, 'ditaViewer.mapPreview');
    await waitFor(() => !!api().getLastRenderedMapHtml(uri.toString()));
    const html = api().getLastRenderedMapHtml(uri.toString())!;
    assert.ok(html.includes('k'), 'the scoped topicref should still appear in the outline');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  it('compare with Git version renders both sides of an edit', async function () {
    this.timeout(30000);
    const dir = path.join(scratch, 'diff');
    const git = (...args: string[]) =>
      run('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args], { cwd: dir });
    try {
      await git('init', '-q');
    } catch {
      this.skip(); // no git on PATH: the diff command cannot run at all
    }
    const file = path.join(dir, 'doc.dita');
    await fsp.writeFile(file, topic('d', '<p>OLD-SENTENCE</p>'));
    await git('add', 'doc.dita');
    await git('commit', '-q', '-m', 'first');
    await fsp.writeFile(file, topic('d', '<p>NEW-SENTENCE</p>'));

    const uri = vscode.Uri.file(file);
    await vscode.window.showTextDocument(uri);

    // The command asks twice which versions to compare. Drive the two quick
    // picks directly: base = "last commit" (index 1), then compare against the
    // working copy (index 0 of what is left). Restored in finally.
    const win = vscode.window as unknown as { showQuickPick: (items: unknown[]) => Promise<unknown> };
    const original = win.showQuickPick;
    let call = 0;
    win.showQuickPick = async (items: unknown[]) => (call++ === 0 ? items[1] : items[0]);
    try {
      await vscode.commands.executeCommand('ditaViewer.compareWithGit');
      await waitFor(() => !!api().getLastDiffHtml(uri.toString()), 15000);
    } finally {
      win.showQuickPick = original;
    }
    const html = api().getLastDiffHtml(uri.toString())!;
    assert.ok(html.includes('OLD-SENTENCE'), 'the committed text appears on the base side');
    assert.ok(html.includes('NEW-SENTENCE'), 'the working-copy text appears on the other side');
  });
});
