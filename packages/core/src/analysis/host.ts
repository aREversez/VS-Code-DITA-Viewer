// How the project analysis reaches files and paths. It is async because a host that
// has unsaved editor text, wants to yield to a UI or wants to cancel a long crawl
// needs to be; the ambient runtime of runtime.ts does not survive an await, so the
// path operations travel in the host too instead of being looked up.

import type { PathOps, Platform } from '../platform';
import type { WarningSink } from '../warnings';

export interface AnalysisHost {
  /** Path operations for the file names this host uses (and whether they compare case-sensitively). */
  readonly path: PathOps;
  /** Text of a file (unsaved editor text if the host has any). Rejects when unreadable. */
  readFile(absPath: string): Promise<string>;
  exists(absPath: string): Promise<boolean>;
  /** Whether an existing path is a folder (folder-reference check). */
  isDirectory?(absPath: string): Promise<boolean>;
  /** Entry names of a folder, or undefined when it cannot be listed (capitalization check). */
  readDir?(absPath: string): Promise<string[] | undefined>;
  /** Polled between files; returning true stops the work early. */
  cancelled?(): boolean;
  /** Told about non-fatal problems (src/warnings.ts); without it they are dropped. */
  onWarning?: WarningSink;
}

/**
 * An AnalysisHost over a synchronous Platform: the Node disk or an in-memory file
 * system. A browser host that preloads its files into createMemoryFileSystem gets
 * the whole analysis through this. `readFile` rejects, as the interface says, when
 * the file cannot be read.
 */
export function analysisHostFromFileSystem(
  platform: Platform,
  options: { cancelled?: () => boolean; onWarning?: WarningSink } = {},
): AnalysisHost {
  const { fs, path } = platform;
  return {
    path,
    readFile: async (p) => fs.readText(p),
    exists: async (p) => fs.exists(p),
    isDirectory: async (p) => {
      try {
        fs.readDir(p);
        return true;
      } catch {
        return false;
      }
    },
    readDir: async (p) => {
      try {
        return fs.readDir(p).map((e) => e.name);
      } catch {
        return undefined;
      }
    },
    cancelled: options.cancelled,
    onWarning: options.onWarning,
  };
}
