import * as assert from 'assert';
import * as path from 'path';
import * as fsp from 'fs/promises';
import * as vscode from 'vscode';

const EXTENSION_ID = 'dita-viewer.dita-viewer';

async function waitFor(check: () => boolean, timeoutMs = 8000, intervalMs = 150): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Timed out waiting for the broken-reference diagnostic.');
}

function missingFileDiagnostics(uri: vscode.Uri): vscode.Diagnostic[] {
  return vscode.languages.getDiagnostics(uri).filter((d) => d.code === 'missing-file');
}

async function codeActionsFor(
  doc: vscode.TextDocument,
  diagnostic: vscode.Diagnostic,
): Promise<vscode.CodeAction[]> {
  const result = await vscode.commands.executeCommand<Array<vscode.CodeAction | vscode.Command>>(
    'vscode.executeCodeActionProvider',
    doc.uri,
    diagnostic.range,
  );
  // kind crosses the RPC boundary as a CodeActionKind, whose toString() is not
  // the kind's value: read .value instead of stringifying it.
  const kindValue = (action: vscode.CodeAction): string =>
    typeof action.kind === 'string' ? action.kind : (action.kind?.value ?? '');
  return (result ?? []).filter(
    (a): a is vscode.CodeAction => 'edit' in a && kindValue(a as vscode.CodeAction).startsWith('quickfix'),
  );
}

/** A closed file's edit lands on disk asynchronously: poll, rather than race it. */
async function textOf(file: string, want: (text: string) => boolean, timeoutMs = 5000): Promise<string> {
  const start = Date.now();
  let text = await fsp.readFile(file, 'utf8');
  while (Date.now() - start < timeoutMs) {
    if (want(text)) return text;
    await new Promise((r) => setTimeout(r, 100));
    text = await fsp.readFile(file, 'utf8');
  }
  return text;
}

/**
 * The Quick Fix (registered in brokenRefCodeAction.ts) and the command's apply
 * step (fixBrokenRefsCommand.ts, driven through its _test seam) against real
 * files: the rewrite itself is computeRefEdits', and the picker's own rules are
 * pinned by the unit tests in src/test/editor/brokenRefs.test.ts. What is
 * pinned here is the wiring -- that the fix is offered only when a file of that
 * name exists, that only a name with exactly one candidate is preferred, and
 * that applying it writes the new path.
 */
describe('Fix Broken References — Quick Fix and command', () => {
  // Every name in this suite carries the extension host's pid. This build
  // sometimes opens a second window whose host runs the same suite at the same
  // time (both windows inherit --extensionTestsPath), and a shared folder would
  // let one run's before() hook delete the other's fixtures mid-test -- while a
  // shared file name would make the workspace-wide lookup behind the fix find
  // two files and legitimately answer "several candidates".
  const tag = `${process.pid}`;
  const name = (base: string, ext: string): string => `${base}-${tag}.${ext}`;
  const dir = path.resolve(__dirname, '..', '..', 'test-dita-file', `__fix-broken-refs-e2e-${tag}`);
  const abs = (...rel: string[]) => path.join(dir, ...rel);
  const write = async (rel: string, text: string): Promise<void> => {
    const file = abs(rel);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, text);
  };

  before(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    await ext?.activate();
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    await fsp.mkdir(dir, { recursive: true });
  });

  after(async () => {
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it('offers the one file of that name as the preferred fix, and applying it rewrites the reference', async () => {
    const only = name('only', 'dita');
    await write(
      'unique/topics/a.dita',
      `<topic id="a"><title>A</title><body>\n  <p><xref href="old/${only}"/></p>\n  <p><xref href="old/${only}#t/x"/></p>\n</body></topic>\n`,
    );
    await write(`unique/moved/${only}`, '<topic id="o"><title>O</title></topic>\n');

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(abs('unique/topics/a.dita')));
    await vscode.window.showTextDocument(doc);
    await waitFor(() => missingFileDiagnostics(doc.uri).length > 0);

    // The fix looks the name up with findFiles, so the workspace search has to
    // see the fixture. A folder written from outside VS Code reaches the search
    // index a moment later, so poll instead of racing it.
    let seen: vscode.Uri[] = [];
    for (let i = 0; i < 40 && seen.length === 0; i++) {
      seen = await vscode.workspace.findFiles(`**/${only}`, '**/{node_modules,.git}/**');
      if (seen.length === 0) await new Promise((r) => setTimeout(r, 200));
    }
    assert.strictEqual(seen.length, 1, `findFiles saw: ${seen.map((u) => u.fsPath).join(', ') || 'nothing'}`);
    const diagnostics = missingFileDiagnostics(doc.uri);
    assert.strictEqual(diagnostics.length, 2, 'one per reference: the fix groups them, the diagnostic does not');

    const actions = await codeActionsFor(doc, diagnostics[0]);
    assert.strictEqual(actions.length, 1, actions.map((a) => a.title).join(', '));
    const [fix] = actions;
    assert.ok(fix.title.includes(only), `expected the fix to name the file, got: ${fix.title}`);
    assert.strictEqual(fix.isPreferred, true, 'exactly one file of that name is the answer, so Enter picks it');
    assert.ok(fix.edit, 'the fix must carry its edit');

    assert.strictEqual(await vscode.workspace.applyEdit(fix.edit as vscode.WorkspaceEdit), true);
    const rewritten = doc.getText();
    assert.ok(rewritten.includes(`href="../moved/${only}"`), rewritten);
    assert.ok(rewritten.includes(`href="../moved/${only}#t/x"`), 'the fragment is kept');

    // Leave the editor clean before the next case reads its own file.
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  });

  it('offers every file of that name when there are several, and preselects none of them', async () => {
    const twin = name('twin', 'dita');
    await write(
      'twin/topics/b.dita',
      `<topic id="b"><title>B</title><body>\n  <p><xref href="gone/${twin}"/></p>\n</body></topic>\n`,
    );
    await write(`twin/one/${twin}`, '<topic id="t1"><title>1</title></topic>\n');
    await write(`twin/two/${twin}`, '<topic id="t2"><title>2</title></topic>\n');

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(abs('twin/topics/b.dita')));
    await vscode.window.showTextDocument(doc);
    await waitFor(() => missingFileDiagnostics(doc.uri).length > 0);

    const actions = await codeActionsFor(doc, missingFileDiagnostics(doc.uri)[0]);
    assert.strictEqual(actions.length, 2, actions.map((a) => a.title).join(', '));
    assert.deepStrictEqual(
      actions.filter((a) => a.isPreferred).length,
      0,
      'two files of that name is a question, not a default',
    );

    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  });

  it('repairs a folder that moved, in one edit, across the files that reference it', async () => {
    const one = name('one', 'dita');
    const two = name('two', 'dita');
    const topic = name('topic', 'dita');
    const map = name('map', 'ditamap');
    await write(
      `moved-folder/${map}`,
      `<map>\n  <topicref href="old/${one}"/>\n  <topicref href="old/${two}"/>\n</map>\n`,
    );
    await write(
      `moved-folder/${topic}`,
      `<topic id="t"><title>T</title><body>\n  <p><xref href="old/${one}#t/x"/></p>\n</body></topic>\n`,
    );
    await write(`moved-folder/new/${one}`, '<topic id="one"><title>One</title></topic>\n');
    await write(`moved-folder/new/${two}`, '<topic id="two"><title>Two</title></topic>\n');

    const api = vscode.extensions.getExtension(EXTENSION_ID)?.exports as {
      _test: { fixBrokenRefs: (opts: { scope: string }) => Promise<{ updated: number; files: number }> };
    };
    const result = await api._test.fixBrokenRefs({ scope: abs('moved-folder') });

    // One missing-file diagnostic per reference, two targets: the batch is one
    // edit over the two files that hold the three references.
    assert.strictEqual(result.updated, 3);
    assert.strictEqual(result.files, 2);
    const mapText = await textOf(abs(`moved-folder/${map}`), (text) => text.includes(`new/${two}`));
    assert.ok(mapText.includes(`href="new/${one}"`), mapText);
    assert.ok(mapText.includes(`href="new/${two}"`), mapText);
    const topicText = await textOf(abs(`moved-folder/${topic}`), (text) => text.includes(`new/${one}`));
    assert.ok(topicText.includes(`href="new/${one}#t/x"`), topicText);
  });
});
