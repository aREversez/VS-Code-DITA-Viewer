import type { AnalysisWarning } from '@dita-viewer/core';

/**
 * The warning sink the extension gives core: core no longer writes to the
 * console itself, so the lines it used to print ("Failed to read directory
 * ...") keep appearing in the extension host log because it asks for them here.
 */
export function warnToConsole(warning: AnalysisWarning): void {
  console.warn(warning.message);
}
