import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'dita-viewer.dita-viewer';

// dist/test/completion.test.js -> repo root is two levels up.
const repoRoot = path.resolve(__dirname, '..', '..');
const fixturesDir = path.join(repoRoot, 'test-dita-file');

/**
 * Completion, driven through VS Code against the real fixture set.
 *
 * The walk's rules (depth limit, pruned folder names, extension matching, the
 * soft result cap) are unit-tested in src/test/language/referenceableFiles.test.ts
 * against a synthetic tree, because they cannot be observed from here -- the
 * fixture has no folder four levels deep and its `out/` is a gitignored build
 * artifact holding no .dita at all, so on CI it does not even exist.
 *
 * What is pinned here is the part the unit tests cannot reach: the adapter.
 * That provideCompletionItems really returns a promise VS Code awaits, that
 * workspace.fs.readDirectory supplies the entry types the walk asks for, and
 * that the walk is rooted at the *document's* folder rather than the workspace
 * root -- a search-API-based implementation would get that last one wrong and
 * still look like it worked.
 */
describe('DITA completion', () => {
  before(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    await ext?.activate();
  });

  const labelOf = (item: vscode.CompletionItem): string =>
    typeof item.label === 'string' ? item.label : item.label.label;

  /**
   * Requests completion and normalises the answer to a plain item array.
   *
   * vscode.executeCompletionItemProvider has returned both CompletionItem[] and
   * a CompletionList across VS Code versions, and this suite runs against
   * whatever build @vscode/test-electron downloaded -- .vscode-test here holds
   * three. Assuming one shape made every test in this file fail with
   * "items.filter is not a function" on the version that returns the other.
   */
  async function requestCompletion(
    uri: vscode.Uri,
    position: vscode.Position,
    triggerCharacter: string,
  ): Promise<vscode.CompletionItem[]> {
    const raw = await vscode.commands.executeCommand<
      vscode.CompletionItem[] | vscode.CompletionList | undefined
    >('vscode.executeCompletionItemProvider', uri, position, triggerCharacter);
    if (!raw) return [];
    return Array.isArray(raw) ? raw : raw.items ?? [];
  }

  /**
   * Opens a fixture as a text document and requests completion at the offset
   * immediately after `marker`. The document is shown in an editor because
   * completion is only offered for documents VS Code considers open, and
   * showTextDocument (rather than openWith) keeps it in the text editor instead
   * of the preview these fixtures are otherwise associated with.
   */
  async function completeAfter(
    relFixturePath: string,
    marker: string,
    triggerCharacter: string,
  ): Promise<vscode.CompletionItem[]> {
    const uri = vscode.Uri.file(path.join(fixturesDir, relFixturePath));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);

    const text = doc.getText();
    const idx = text.indexOf(marker);
    assert.ok(
      idx >= 0,
      `fixture ${relFixturePath} no longer contains "${marker}" -- this test pins a completion ` +
        'position, so the marker has to keep pointing at a real attribute value',
    );
    return requestCompletion(uri, doc.positionAt(idx + marker.length), triggerCharacter);
  }

  const labelsOfKind = (items: vscode.CompletionItem[], kind: vscode.CompletionItemKind): string[] =>
    items.filter((i) => i.kind === kind).map(labelOf);

  it('offers the referenceable files for an href value, relative to the map folder', async () => {
    const items = await completeAfter('test.ditamap', 'href="', '"');
    const labels = labelsOfKind(items, vscode.CompletionItemKind.File);

    // The fixture root also holds six .css files and images/db_topology.png, so
    // this exact match is what proves the extension filter is applied rather
    // than "everything the walk found". It also proves the paths are relative
    // and forward-slashed: on Windows a leaked separator would read
    // 'topics\db_overview.dita' and fail here.
    const expected = [
      'common/keys.ditamap',
      'relative_test/relative_path_test-book.ditamap',
      'relative_test/relative_path_test.ditamap',
      'reuse/reuse.dita',
      'test.ditamap',
      'topics/db_config.dita',
      'topics/db_overview.dita',
      'topics/db_ui_test.dita',
      'topics/instrument.dita',
      'topics/mathml_mfenced_test.dita',
      'topics/mathml_prefixed_test.dita',
      'topics/mathml_test.dita',
      'topics/profiling_test.dita',
    ];

    // out/ is filtered out of the comparison, not out of the assertion's scope:
    // it is DITA-OT output, gitignored, and absent on a clean CI checkout, so
    // its contents vary by machine. The walk prunes it by name -- pinned by the
    // unit test, which can put a .dita inside it.
    const actual = labels.filter((l) => !l.startsWith('out/')).sort();
    assert.deepStrictEqual(actual, expected);
  });

  it('roots the walk at the document folder, so a topic never offers a path out of it', async () => {
    const items = await completeAfter(path.join('topics', 'db_overview.dita'), 'href="', '"');
    const labels = labelsOfKind(items, vscode.CompletionItemKind.File);

    // Same eight files as the case above, but bare: from inside topics/ they sit
    // at depth 0. Nothing may be prefixed with '..' or name test.ditamap --
    // both would mean the walk escaped the document's folder, which would make
    // the inserted href resolve against the wrong directory.
    const actual = labels.sort();
    assert.deepStrictEqual(actual, [
      'db_config.dita',
      'db_overview.dita',
      'db_ui_test.dita',
      'instrument.dita',
      'mathml_mfenced_test.dita',
      'mathml_prefixed_test.dita',
      'mathml_test.dita',
      'profiling_test.dita',
    ]);
    assert.ok(
      !actual.some((l) => l.startsWith('..') || l.includes('\\')),
      `completion offered a path escaping the document folder: ${actual.join(', ')}`,
    );
  });

  it('still offers element ids after "#", the branch that reads one file instead of walking', async () => {
    // db_ui_test.dita has <note conref="db_overview.dita#db_overview/shared_note">,
    // and db_overview.dita really declares those ids. This branch is untouched
    // by the async walk, but provideCompletionItems becoming async applies to
    // all of it -- an un-awaited return would surface as an empty list here.
    const items = await completeAfter(
      path.join('topics', 'db_ui_test.dita'),
      'conref="db_overview.dita#',
      '#',
    );
    const labels = labelsOfKind(items, vscode.CompletionItemKind.Reference);

    assert.ok(labels.includes('shared_note'), `expected the conref'd element id, got: ${labels.join(', ')}`);
    assert.ok(labels.includes('db_overview'), `expected the target topic id, got: ${labels.join(', ')}`);
  });

  it('still offers tag names, the branch that reads no files at all', async () => {
    // Cheapest guard on the async conversion: this branch builds its list from
    // a static tag map, so it proves the method still resolves for the paths
    // that never touch the file system.
    //
    // An untitled in-memory document rather than a fixture edit on purpose --
    // the file-list assertions above match test-dita-file's contents exactly,
    // so a test that wrote to a tracked fixture and failed halfway would leave
    // the tree dirty and break them on the next run.
    const doc = await vscode.workspace.openTextDocument({ language: 'ditamap', content: '<map>\n  <' });
    await vscode.window.showTextDocument(doc);
    const position = doc.positionAt(doc.getText().length);

    const items = await requestCompletion(doc.uri, position, '<');
    const labels = labelsOfKind(items, vscode.CompletionItemKind.Class);

    assert.ok(labels.includes('topicref'), `expected map tag names, got: ${labels.join(', ')}`);

    // Revert, not close: closing a dirty untitled document prompts to save, and
    // a modal dialog nobody answers would hang the run until the suite timeout.
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  });
});
