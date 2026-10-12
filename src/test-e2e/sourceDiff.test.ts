import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'dita-viewer.dita-viewer';

// dist/e2e/sourceDiff.test.js -> repo root is two levels up.
const repoRoot = path.resolve(__dirname, '..', '..');
const fixturesDir = path.join(repoRoot, 'test-dita-file');

async function findDiffTab(): Promise<vscode.TabInputTextDiff | undefined> {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputTextDiff) return tab.input;
    }
  }
  return undefined;
}

async function findCustomPreviewTab(): Promise<vscode.TabInputCustom | undefined> {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'ditaViewer.preview') {
        return tab.input;
      }
    }
  }
  return undefined;
}

describe('Source diff opens in the native editor, not the reading-view custom editor', () => {
  before(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    await ext?.activate();
  });

  afterEach(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  // The risk this guards: the extension registers a `ditaViewer.preview`
  // custom editor over `*.dita` (priority: option). The "Open source diff"
  // button feeds VS Code's native `vscode.diff` two in-memory `dita-diff`
  // scheme URIs whose paths end in `.dita`. If VS Code consulted the custom
  // editor for those, the reviewer would land in the rendered reading view
  // instead of a text diff. `vscode.diff` should bypass custom editors and open
  // the built-in diff editor -- this asserts exactly that, end to end, through
  // the real openSourceDiff code path.
  it('opens a native TabInputTextDiff over the two virtual .dita documents', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID)!;
    const docUri = vscode.Uri.file(path.join(fixturesDir, 'fixture', 'topics', 'db_overview.dita'));

    await ext.exports._test.openSourceDiffForTesting({
      leftXml: '<topic id="t"><title>T</title><body><p>old left content</p></body></topic>',
      rightXml: '<topic id="t"><title>T</title><body><p>new right content</p></body></topic>',
      leftLabel: 'Left',
      rightLabel: 'Right',
      docUri,
    });

    const diffTab = await findDiffTab();
    assert.ok(diffTab, 'expected the native diff editor (TabInputTextDiff) to open');
    assert.strictEqual(diffTab!.original.scheme, 'dita-diff', 'left side should be a dita-diff virtual URI');
    assert.strictEqual(diffTab!.modified.scheme, 'dita-diff', 'right side should be a dita-diff virtual URI');
    assert.ok(diffTab!.original.path.endsWith('.dita'), 'the virtual URI keeps the .dita extension for syntax highlighting');
  });

  it('does not let the ditaViewer.preview custom editor take over the diff', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID)!;
    const docUri = vscode.Uri.file(path.join(fixturesDir, 'fixture', 'topics', 'db_overview.dita'));

    await ext.exports._test.openSourceDiffForTesting({
      leftXml: '<topic id="t"><title>T</title><body><p>aaa</p></body></topic>',
      rightXml: '<topic id="t"><title>T</title><body><p>bbb</p></body></topic>',
      leftLabel: 'Left',
      rightLabel: 'Right',
      docUri,
    });

    const hijack = await findCustomPreviewTab();
    assert.strictEqual(hijack, undefined, 'the reading-view custom editor must not open for the source diff');
  });

  it('serves the virtual document content through the text model', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID)!;
    const docUri = vscode.Uri.file(path.join(fixturesDir, 'fixture', 'topics', 'db_overview.dita'));

    await ext.exports._test.openSourceDiffForTesting({
      leftXml: '<topic id="t"><title>T</title><body><p>SENTINEL-LEFT-MARKER</p></body></topic>',
      rightXml: '<topic id="t"><title>T</title><body><p>SENTINEL-RIGHT-MARKER</p></body></topic>',
      leftLabel: 'Left',
      rightLabel: 'Right',
      docUri,
    });

    const diffTab = await findDiffTab();
    assert.ok(diffTab, 'expected a diff tab to be open');

    const leftDoc = await vscode.workspace.openTextDocument(diffTab!.original);
    const rightDoc = await vscode.workspace.openTextDocument(diffTab!.modified);
    assert.ok(leftDoc.getText().includes('SENTINEL-LEFT-MARKER'), 'left virtual document should expose its XML to the text model');
    assert.ok(rightDoc.getText().includes('SENTINEL-RIGHT-MARKER'), 'right virtual document should expose its XML to the text model');
  });

  // The filename rides into the virtual URI's PATH. `Uri.from` treats `path` as
  // an already-decoded path, so a name that was percent-encoded first is stored
  // literally and then encoded a SECOND time by toString() -- the tab then reads
  // "%25E6%25B3%25B5…" instead of "泵坏了.dita". Encoding the basename here is
  // exactly what produced that double encoding.
  it('names the virtual documents with the real (non double-encoded) filename for a CJK topic', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID)!;
    const docUri = vscode.Uri.file(path.join(fixturesDir, 'manual', '泵坏了-adapter.dita'));

    await ext.exports._test.openSourceDiffForTesting({
      leftXml: '<topic id="t"><body><p>old</p></body></topic>',
      rightXml: '<topic id="t"><body><p>new</p></body></topic>',
      leftLabel: 'Left',
      rightLabel: 'Right',
      docUri,
    });

    const diffTab = await findDiffTab();
    assert.ok(diffTab, 'expected a diff tab to be open');
    // `path` is the DECODED path, so it is what the tab label is built from and
    // what a pre-encoded name would still show as literal %XX escapes. Checked
    // on the path rather than the whole URI string: the `doc=` query legitimately
    // contains %25, because it is an encoded form of an already-encoded URI.
    const uriPath = diffTab!.original.path;
    assert.ok(!uriPath.includes('%'), `the virtual path must not carry percent-escapes, got: ${uriPath}`);
    assert.ok(uriPath.includes('泵坏了-adapter'), `the CJK filename should read as itself, got: ${uriPath}`);
    assert.ok(uriPath.endsWith('.left.dita'), 'the side suffix and extension are preserved');
    // Content still resolves through the provider, i.e. the doc= query round-trips.
    const doc = await vscode.workspace.openTextDocument(diffTab!.original);
    assert.ok(doc.getText().includes('old'), 'the virtual document must still resolve for a non-ASCII filename');
  });
});
