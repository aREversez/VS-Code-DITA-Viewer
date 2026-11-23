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
  /** `reg query <key> /s /f "Oxygen" /d` output; empty on failure or no match. */
  queryRegistry: (key: string) => Promise<string>;
  /**
   * `reg query <key>`: every value of one key. The filtered query above only
   * prints the values whose data matched, so an install folder whose path does
   * not contain "Oxygen" has to be read this way. Empty on failure.
   */
  queryRegistryKey?: (key: string) => Promise<string>;
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
  /** Empty when the filtered output held no folder for this entry. */
  installDir: string;
  /** The `HKEY_...` key the values came from, for a full re-read. */
  key: string;
}

/**
 * Oxygen's entries out of `reg query ... /s` output. A key block is one
 * `HKEY_...` header line followed by indented `Name  REG_SZ  Data` lines.
 * The install folder is InstallLocation, else the folder of UninstallString.
 * `env` expands the %VAR% of a REG_EXPAND_SZ value, which reg prints unexpanded.
 */
export function parseOxygenUninstallOutput(
  output: string,
  env: Record<string, string | undefined> = {},
): OxygenRegistryEntry[] {
  // Windows environment names are case-insensitive.
  const vars = new Map<string, string>();
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) vars.set(name.toLowerCase(), value);
  }
  const expand = (text: string): string =>
    text.replace(/%([^%]+)%/g, (whole, name: string) => vars.get(name.toLowerCase()) ?? whole);
  const entries: OxygenRegistryEntry[] = [];
  let values = new Map<string, string>();
  let key = '';
  const flush = (): void => {
    const displayName = values.get('displayname') ?? '';
    let installDir = (values.get('installlocation') ?? '').trim();
    if (!installDir) {
      const uninstall = (values.get('uninstallstring') ?? '').trim().replace(/^"([^"]*)".*$/, '$1');
      const cut = Math.max(uninstall.lastIndexOf('\\'), uninstall.lastIndexOf('/'));
      if (cut > 0) installDir = uninstall.slice(0, cut);
    }
    installDir = installDir.replace(/^"|"$/g, '').replace(/[\\/]+$/, '');
    // Kept even without a folder: the caller can re-read the key for it.
    if (PRODUCT_NAME_RE.test(displayName)) entries.push({ displayName, installDir, key });
    values = new Map();
  };
  for (const raw of output.split(/\r?\n/)) {
    if (/^HKEY_/i.test(raw)) {
      flush();
      key = raw.trim();
      continue;
    }
    const m = /^\s+(\S+)\s+REG_(EXPAND_)?SZ\s+(.*)$/.exec(raw);
    if (m) values.set(m[1].toLowerCase(), m[2] ? expand(m[3]) : m[3]);
  }
  flush();
  return entries;
}

/**
 * Legacy code pages reg.exe may have written, tried only when the bytes are
 * not UTF-8. A decoding is accepted only when the Oxygen folder it names is
 * really there, so a wrong guess cannot invent an installation.
 */
const LEGACY_CODEPAGES = ['gbk', 'big5', 'shift_jis', 'euc-kr', 'windows-1252', 'windows-1251'];

/**
 * reg.exe writes the console code page, not UTF-8, when its output is a pipe,
 * so a non-ASCII install folder arrives as bytes UTF-8 cannot decode. Those
 * are decoded by the legacy code page that yields a folder which exists; with
 * none accepted the lossy UTF-8 text is kept, as before, and the folder scan
 * still runs. ASCII output, the common case, is returned untouched. The OEM
 * code pages of English and Western European Windows (437, 850) have no
 * decoder label in Node, so a non-ASCII folder written in one of those is
 * still left to the folder scan.
 */
export function decodeRegistryOutput(bytes: Uint8Array, folderExists: (p: string) => boolean): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Some byte is not UTF-8, so the text is in a legacy code page.
  }
  for (const label of LEGACY_CODEPAGES) {
    let text: string;
    try {
      text = new TextDecoder(label).decode(bytes);
    } catch {
      continue; // this runtime has no decoder for that label
    }
    if (parseOxygenUninstallOutput(text).some((e) => e.installDir && folderExists(e.installDir))) return text;
  }
  return new TextDecoder('utf-8').decode(bytes);
}

// The per-user roots (LOCALAPPDATA\Programs, the home directory) are writable
// by the user, which is the same trust the PATH probe in resolveOxygenLaunch
// already relies on: this command spawns a launcher the user asked to open.
// Nothing here reads the workspace, and workspace trust gates the command
// itself (workspaceTrust.ts).
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
    for (const e of outputs.flatMap((o) => parseOxygenUninstallOutput(o, io.env))) {
      let dir = e.installDir;
      // The filter matched DisplayName but printed no folder: read the whole
      // key, which carries InstallLocation whatever its path looks like.
      if (!dir && e.key && io.queryRegistryKey) {
        const full = await io.queryRegistryKey(e.key).catch(() => '');
        dir = parseOxygenUninstallOutput(full, io.env)[0]?.installDir ?? '';
      }
      candidates.push({ dir, label: e.displayName });
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
