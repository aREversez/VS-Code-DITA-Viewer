import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { EXECUTION_GATED_COMMANDS, isExecutionCommandAllowed } from '../../editor/workspaceTrust';

/**
 * The predicate that decides whether a command may run outside a trusted
 * workspace. The vscode-dependent glue (message + "Manage Workspace
 * Trust" button) just forwards `workspace.isTrusted` here, so the whole
 * security decision is this pure function -- and this file is the whole
 * proof it makes the right one.
 */

const repoRoot = join(__dirname, '..', '..', '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

describe('workspace trust command gate', () => {
  it('blocks the transform command in an untrusted workspace (spawns DITA-OT)', () => {
    assert.strictEqual(isExecutionCommandAllowed('ditaViewer.transformWithDitaOt', false), false);
  });

  it('blocks Open in Oxygen in an untrusted workspace (spawns Oxygen)', () => {
    assert.strictEqual(isExecutionCommandAllowed('ditaViewer.openWithOxygen', false), false);
  });

  it('blocks Compare with Git Version in an untrusted workspace (runs git)', () => {
    assert.strictEqual(isExecutionCommandAllowed('ditaViewer.compareWithGit', false), false);
  });

  it('leaves every other command alone in an untrusted workspace (views, export, checks)', () => {
    for (const id of [
      'ditaViewer.showRendered',
      'ditaViewer.showMapRendered',
      'ditaViewer.exportHtml',
      'ditaViewer.mapExplorer.exportHtml',
      'ditaViewer.validateMapCompleteness',
      'ditaViewer.findUnreferencedResources',
      'ditaViewer.mapExplorer.openWithOxygen', // delegates to the gated command, which re-checks
    ]) {
      assert.strictEqual(isExecutionCommandAllowed(id, false), true, id);
    }
  });

  it('allows everything in a trusted workspace -- behaviour there is unchanged', () => {
    for (const id of [...EXECUTION_GATED_COMMANDS, 'ditaViewer.showRendered']) {
      assert.strictEqual(isExecutionCommandAllowed(id, true), true, id);
    }
  });

  it('gates command ids that package.json actually contributes', () => {
    // A typo in a gated id would disable the gate silently; a gated id
    // missing from contributes.commands would gate something that does
    // not exist. Both are this assertion's failure.
    const contributed = new Set<string>(
      (pkg.contributes.commands as { command: string }[]).map((c) => c.command),
    );
    assert.ok(EXECUTION_GATED_COMMANDS.length > 0);
    for (const id of EXECUTION_GATED_COMMANDS) {
      assert.ok(contributed.has(id), `${id} is gated but not contributed`);
    }
  });
});
