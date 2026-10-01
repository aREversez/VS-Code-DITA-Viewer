// Workspace-trust decisions for commands that start external programs.
// Pure module: no vscode import, so the predicate is unit-testable in
// plain mocha (workspaceTrust.test.ts). The vscode glue lives in
// workspaceTrustGate.ts and only forwards workspace.isTrusted here.

/**
 * Command ids that spawn a program the workspace could influence or that
 * otherwise execute outside VS Code's sandbox:
 * - transformWithDitaOt spawns the DITA-OT launcher (and, inside its run,
 *   offers the CJK spacing plugin install, which writes into the DITA-OT
 *   home) -- see extension.ts.
 * - openWithOxygen spawns Oxygen XML Editor -- see extension.ts and
 *   oxygenLauncher.ts. mapExplorer.openWithOxygen delegates to this id,
 *   so gating it gates both entry points.
 * - compareWithGit runs `git` through execFile -- see ditaGitUtils.ts.
 *
 * Export, previews, the Map Navigator and the checks only read files and
 * stay available; cssDirectory / templatesDirectory / customCss point at
 * file reads, not execution, so they are not restricted either.
 */
export const EXECUTION_GATED_COMMANDS: readonly string[] = [
  'ditaViewer.transformWithDitaOt',
  'ditaViewer.openWithOxygen',
  'ditaViewer.compareWithGit',
];

/** Whether `commandId` may run given the workspace's trust state. */
export function isExecutionCommandAllowed(commandId: string, isTrusted: boolean): boolean {
  return isTrusted || !EXECUTION_GATED_COMMANDS.includes(commandId);
}
