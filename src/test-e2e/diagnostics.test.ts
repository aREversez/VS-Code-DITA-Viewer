import * as assert from 'assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'dita-viewer.dita-viewer';

async function waitFor(check: () => boolean, timeoutMs = 8000, intervalMs = 150): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Timed out waiting for diagnostics to be published.');
}

/**
 * validateDocument() in ditaLanguageFeatures.ts. Unlike the webview-facing
 * tests in preview.test.ts, this needs no _test export hook: diagnostics are
 * a first-class public API (vscode.languages.getDiagnostics), so the same
 * collection the extension actually publishes to is directly observable
 * from here.
 *
 * The classification rule itself (which elements count as unknown, and why
 * <mathml>'s own content does not) is unit-tested against collectUnknownElements()
 * in src/test/language/ditaLanguageUtils.test.ts, against a synthetic parsed
 * tree, because it needs no VS Code API at all. What is pinned here is the
 * part those tests cannot reach: that validateDocument() actually calls it
 * and turns the result into a real published Diagnostic with the expected
 * code, rather than the wiring silently doing nothing.
 */
describe('Unknown-element diagnostic', () => {
  before(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    await ext?.activate();
  });

  it('publishes a warning for an element with no known DITA base type', async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: 'dita',
      content: '<topic id="t1"><title>T</title><body><mistyped-tag>x</mistyped-tag></body></topic>',
    });
    await vscode.window.showTextDocument(doc);

    await waitFor(() =>
      vscode.languages.getDiagnostics(doc.uri).some((d) => d.code === 'unknown-element'),
    );

    const diagnostics = vscode.languages.getDiagnostics(doc.uri).filter((d) => d.code === 'unknown-element');
    assert.strictEqual(diagnostics.length, 1, 'expected exactly one unknown-element diagnostic for the one typo');
    assert.strictEqual(diagnostics[0].severity, vscode.DiagnosticSeverity.Warning);
    assert.ok(
      diagnostics[0].message.includes('mistyped-tag'),
      `expected the diagnostic to name the offending tag, got: ${diagnostics[0].message}`,
    );

    // Revert, not close: closing a dirty untitled document prompts to save,
    // and a modal dialog nobody answers would hang the run until the suite
    // timeout (see the same note in completion.test.ts).
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  });

  it('does not warn about standard elements or content inside <mathml>', async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: 'dita',
      content:
        '<concept id="c1"><title>T</title><conbody>' +
        '<p><mathml><mrow><mi>x</mi><mo>+</mo><mi>y</mi></mrow></mathml></p>' +
        '<note type="warning">careful</note>' +
        '</conbody></concept>',
    });
    await vscode.window.showTextDocument(doc);

    // There is nothing to wait for here becoming true -- only something NOT
    // becoming true -- so this waits out one full debounce-and-then-some
    // instead of polling a condition, then asserts the collection is still
    // clean of this diagnostic code.
    await new Promise((r) => setTimeout(r, 1200));

    const diagnostics = vscode.languages.getDiagnostics(doc.uri).filter((d) => d.code === 'unknown-element');
    assert.deepStrictEqual(
      diagnostics.map((d) => d.message),
      [],
      'expected no unknown-element diagnostics for standard elements or MathML content',
    );

    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  });
});
