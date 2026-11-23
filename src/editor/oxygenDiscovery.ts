// Finds an Oxygen XML Editor / Author / Developer installation on this
// machine so the user does not have to type dita-viewer.oxygenPath.
//
//  - Windows: the installer registers an Uninstall entry (DisplayName
//    "Oxygen XML Author 28.1 (64-bit)", InstallLocation "C:\Program Files\
//    Oxygen XML Author 28"), read with `reg query`; the Program Files folders
//    are scanned as a fallback.
//  - macOS / Linux: no registry, so the usual install roots are scanned for
//    an "Oxygen*" folder or bundle.
//
// All disk and registry access goes through `OxygenDiscoveryIo`, so this
// module is vscode-free and unit-tested with fixtures. Detection never reads
// anything from the workspace, only fixed system locations.

import {
  compareVersion,
  compareVersionDesc,
  joinForPlatform,
  specForInstallDir,
  type OxygenLaunchSpec,
} from './oxygenLauncher';

export interface OxygenDiscoveryIo {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  homedir: string;
  /** Names in a folder; empty when it does not exist or cannot be read. */
  readDir: (p: string) => string[];
  fileExists: (p: string) => boolean;
  /** `reg query <key> /s /f "Oxygen XML" /d` output; empty on failure or no match. */
  queryRegistry: (key: string) => Promise<string>;
}

const UNINSTALL = 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
export const WIN_UNINSTALL_KEYS = [
  `HKLM\\${UNINSTALL}`,
  `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall`,
  `HKCU\\${UNINSTALL}`,
];

const PRODUCT_NAME_RE = /^Oxygen XML (?:Editor|Author|Developer)\b/i;

export interface OxygenRegistryEntry {
  displayName: string;
  installDir: string;
}

/**
 * Oxygen's entries out of `reg query ... /s` output. A key block is one
 * `HKEY_...` header line followed by indented `Name  REG_SZ  Data` lines.
 * The install folder is InstallLocation, else the folder of UninstallString.
 */
export function parseOxygenUninstallOutput(output: string): OxygenRegistryEntry[] {
  const entries: OxygenRegistryEntry[] = [];
  let values = new Map<string, string>();
  const flush = (): void => {
    const displayName = values.get('displayname') ?? '';
    let installDir = (values.get('installlocation') ?? '').trim();
    if (!installDir) {
      const uninstall = (values.get('uninstallstring') ?? '').trim().replace(/^"([^"]*)".*$/, '$1');
      const cut = Math.max(uninstall.lastIndexOf('\\'), uninstall.lastIndexOf('/'));
      if (cut > 0) installDir = uninstall.slice(0, cut);
    }
    installDir = installDir.replace(/^"|"$/g, '').replace(/[\\/]+$/, '');
    if (installDir && PRODUCT_NAME_RE.test(displayName)) entries.push({ displayName, installDir });
    values = new Map();
  };
  for (const raw of output.split(/\r?\n/)) {
    if (/^HKEY_/i.test(raw)) {
      flush();
      continue;
    }
    const m = /^\s+(\S+)\s+REG_(?:EXPAND_)?SZ\s+(.*)$/.exec(raw);
    if (m) values.set(m[1].toLowerCase(), m[2]);
  }
  flush();
  return entries;
}

function scanRoots(io: OxygenDiscoveryIo): string[] {
  if (io.platform === 'win32') {
    const roots = [
      io.env['ProgramW6432'],
      io.env['ProgramFiles'],
      io.env['ProgramFiles(x86)'],
      io.env['LOCALAPPDATA'] ? joinForPlatform('win32', io.env['LOCALAPPDATA'], 'Programs') : undefined,
    ];
    return roots.filter((r): r is string => !!r);
  }
  if (io.platform === 'darwin') {
    return ['/Applications', joinForPlatform('darwin', io.homedir, 'Applications')];
  }
  return [io.homedir, '/opt', '/usr/local', joinForPlatform('linux', io.homedir, '.local')];
}

/** Install folders (or macOS bundles) named like Oxygen under the usual roots. */
function scanInstallDirs(io: OxygenDiscoveryIo): string[] {
  const nameRe = io.platform === 'win32' ? PRODUCT_NAME_RE : /^Oxygen\b/i;
  const found: string[] = [];
  for (const root of scanRoots(io)) {
    const names = io
      .readDir(root)
      .filter((n) => nameRe.test(n))
      .sort(compareVersionDesc);
    for (const n of names) found.push(joinForPlatform(io.platform, root, n));
  }
  return found;
}

function sameDir(platform: NodeJS.Platform, a: string, b: string): boolean {
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Every Oxygen launcher found on this machine, best first: registry entries
 * and folder-scan hits ranked together by version, one spec per install
 * folder. A folder holding no launcher yields no spec, so one that merely
 * looks like Oxygen cannot outrank a real install.
 */
export async function discoverOxygenLaunchSpecs(io: OxygenDiscoveryIo): Promise<OxygenLaunchSpec[]> {
  // Registry entries go in first: the sort compares versions only and is
  // stable, so an equal version keeps the registered install, whose
  // DisplayName carries the version the installer recorded.
  const candidates: { dir: string; label: string }[] = [];
  if (io.platform === 'win32') {
    const outputs = await Promise.all(WIN_UNINSTALL_KEYS.map((k) => io.queryRegistry(k).catch(() => '')));
    for (const e of outputs.flatMap(parseOxygenUninstallOutput)) {
      candidates.push({ dir: e.installDir, label: e.displayName });
    }
  }
  for (const dir of scanInstallDirs(io)) {
    candidates.push({ dir, label: dir.split(/[\\/]/).pop() ?? dir });
  }
  candidates.sort((a, b) => compareVersion(a.label, b.label));

  const specs: OxygenLaunchSpec[] = [];
  const seen: string[] = [];
  for (const { dir } of candidates) {
    if (!dir || seen.some((s) => sameDir(io.platform, s, dir))) continue;
    seen.push(dir);
    // A macOS bundle found by the scan is itself the launcher.
    const spec = /\.app$/i.test(dir) && io.fileExists(dir)
      ? ({ command: 'open', argsPrefix: ['-a', dir], source: 'detected' } as OxygenLaunchSpec)
      : specForInstallDir(dir, io.platform, io, 'detected');
    if (spec) specs.push(spec);
  }
  return specs;
}
