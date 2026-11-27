// Non-fatal problems core runs into while it works, reported to the host
// instead of the console. A host that wants them passes `onWarning`; without
// one core stays silent (DESIGN.md 4.6). `code` is stable and meant for
// branching, `message` is English for a log, `path` is the file or folder.

export interface AnalysisWarning {
  readonly code: 'directory-unreadable';
  readonly message: string;
  readonly path?: string;
}

export type WarningSink = (warning: AnalysisWarning) => void;

export function directoryUnreadable(dir: string, error: unknown): AnalysisWarning {
  const reason = error instanceof Error ? error.message : String(error);
  return { code: 'directory-unreadable', message: `Failed to read directory ${dir}: ${reason}`, path: dir };
}
