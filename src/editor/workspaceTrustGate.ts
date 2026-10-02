// The vscode side of the workspace-trust gate: read the trust state,
// forward the decision to the pure predicate (workspaceTrust.ts), and on
// refusal tell the user why with a route to fix it -- never fail silent.
import * as vscode from 'vscode';
import { isExecutionCommandAllowed } from './workspaceTrust';

/**
 * Returns true when `commandId` may proceed. In an untrusted workspace a
 * gated command gets a warning with a Manage Workspace Trust button
 * instead of spawning anything.
 */
export async function ensureCommandAllowed(commandId: string): Promise<boolean> {
  if (isExecutionCommandAllowed(commandId, vscode.workspace.isTrusted)) return true;
  const manageTrustLabel = vscode.l10n.t('Manage Workspace Trust');
  const choice = await vscode.window.showWarningMessage(
    vscode.l10n.t('This command starts an external program and is disabled in untrusted workspaces. Trust this workspace to enable it.'),
    manageTrustLabel,
  );
  if (choice === manageTrustLabel) {
    await vscode.commands.executeCommand('workbench.trust.manage');
  }
  return false;
}
