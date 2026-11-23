// Node-backed I/O for oxygenDiscovery.ts: the real registry, file system and
// environment. Kept apart from the pure module so that one stays unit-testable.

import { execFile } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { discoverOxygenLaunchSpecs } from './oxygenDiscovery';
import type { OxygenLaunchSpec } from './oxygenLauncher';

function queryRegistry(key: string): Promise<string> {
  return new Promise((resolve) => {
    // execFile, never a shell: the key is a constant, but nothing here should
    // ever be one string away from command injection.
    execFile(
      'reg',
      ['query', key, '/s', '/f', 'Oxygen XML', '/d'],
      { windowsHide: true, timeout: 5000, encoding: 'utf8' },
      // `reg` exits 1 when nothing matches; that is an empty result, not an error.
      (_err, stdout) => resolve(typeof stdout === 'string' ? stdout : ''),
    );
  });
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
    });
  } catch {
    return [];
  }
}
