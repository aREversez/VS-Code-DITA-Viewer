// Node-backed I/O for oxygenDiscovery.ts: the real registry, file system and
// environment. Kept apart from the pure module so that one stays unit-testable.

import { execFile } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { discoverOxygenLaunchSpecs, decodeRegistryOutput } from './oxygenDiscovery';
import type { OxygenLaunchSpec } from './oxygenLauncher';
import { windowsSystemExe } from './windowsExe';

function runReg(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    // execFile, never a shell: the keys are constants or come from reg itself,
    // but nothing here should ever be one string away from command injection.
    execFile(
      // The system copy by full path: a bare name is searched for in the
      // current directory first.
      windowsSystemExe('reg.exe', process.env),
      args,
      {
        windowsHide: true,
        timeout: 5000,
        // Bytes, not text: reg writes the console code page, which is not
        // UTF-8 once a folder name holds a non-ASCII character.
        encoding: 'buffer',
        // /s walks the whole Uninstall tree; the 1 MB default is not worth
        // risking on a machine with hundreds of installed programs.
        maxBuffer: 8 * 1024 * 1024,
      },
      // `reg` exits 1 when nothing matches; that is an empty result, not an error.
      (_err, stdout) =>
        resolve(
          decodeRegistryOutput(Buffer.isBuffer(stdout) ? stdout : Buffer.alloc(0), existsSync, process.env),
        ),
    );
  });
}

/** Uninstall entries whose data mentions Oxygen, in one of the three views. */
function queryRegistry(key: string): Promise<string> {
  return runReg(['query', key, '/s', '/f', 'Oxygen', '/d']);
}

/** Every value of one matched key, including a folder the filter did not print. */
function queryRegistryKey(key: string): Promise<string> {
  return runReg(['query', key]);
}

function readDir(p: string): string[] {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}

/** Oxygen installations on this machine, best first; never throws. */
export async function discoverOxygenOnThisMachine(): Promise<OxygenLaunchSpec[]> {
  try {
    return await discoverOxygenLaunchSpecs({
      platform: process.platform,
      env: process.env,
      homedir: homedir(),
      readDir,
      fileExists: (p) => existsSync(p),
      queryRegistry,
      queryRegistryKey,
    });
  } catch {
    return [];
  }
}
