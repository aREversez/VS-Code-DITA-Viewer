// Naming the git executable by full path on Windows.
//
// execFile('git') on Windows searches the child's working directory before
// PATH, and the working directory here is the repository being compared -- so
// a repository that ships its own git.exe at its root gets it run when the diff
// view asks for `git rev-parse`. This finds git.exe in an ABSOLUTE PATH entry
// (or the stock install folders) and returns that path; a relative PATH entry
// ("." or "") is exactly the hazard and is skipped. Elsewhere execFile does not
// search the working directory, so the bare name stays.

import { win32 } from 'path';
import { ABSOLUTE_ROOT } from './windowsExe';

type Env = Record<string, string | undefined>;

/** The command to give execFile, or undefined when git cannot be found (Windows only). */
export function resolveGitExe(
  platform: NodeJS.Platform,
  env: Env,
  exists: (p: string) => boolean,
): string | undefined {
  if (platform !== 'win32') return 'git';
  const pathVar = env.Path ?? env.PATH ?? '';
  const dirs = pathVar
    .split(';')
    .map((d) => d.trim().replace(/^"(.*)"$/, '$1'))
    .filter((d) => ABSOLUTE_ROOT.test(d));
  const stock = [env.ProgramW6432, env.ProgramFiles, env['ProgramFiles(x86)']]
    .filter((d): d is string => typeof d === 'string' && ABSOLUTE_ROOT.test(d))
    .map((d) => win32.join(d, 'Git', 'cmd'));
  if (typeof env.LOCALAPPDATA === 'string' && ABSOLUTE_ROOT.test(env.LOCALAPPDATA)) {
    stock.push(win32.join(env.LOCALAPPDATA, 'Programs', 'Git', 'cmd'));
  }
  for (const dir of [...dirs, ...stock]) {
    const candidate = win32.join(dir, 'git.exe');
    if (exists(candidate)) return candidate;
  }
  return undefined;
}
