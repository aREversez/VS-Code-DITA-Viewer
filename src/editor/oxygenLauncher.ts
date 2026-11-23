// "Open with Oxygen" — hands a .dita/.ditamap file off to Oxygen XML Editor,
// for the authoring/validation/refactoring features this extension doesn't
// (and isn't trying to) reimplement. Detection mirrors resolveDitaOtExecutable
// in ditaOtUtils.ts: a configured path wins outright, then a per-platform
// default; anything else prompts the user to set dita-viewer.oxygenPath.
//
// Unlike the DITA-OT executable, Oxygen has no "run it and read stdout"
// use — it's launched detached, the same way double-clicking its icon
// would, and this extension has nothing further to do with the process
// once it starts.
//
// Finding an installation on disk (Windows registry, install-folder scans) is
// oxygenDiscovery.ts; its result is passed in as `detected`.
//
// Pure and vscode-free by design (same reasoning as ditaOtUtils.ts):
// resolveOxygenLaunch/buildOxygenSpawnArgs are unit-tested directly, and
// the vscode-dependent command that calls them is registered in
// extension.ts, alongside spawn's error handling.

/**
 * How to invoke Oxygen once found. Most platforms spawn the Oxygen
 * executable directly with the target file as its one argument; a macOS
 * ".app" bundle instead goes through `open -a <bundle> <file>`, since the
 * bundle itself isn't a spawnable executable.
 */
import { windowsSystemExe } from './windowsExe';

export interface OxygenLaunchSpec {
  command: string;
  /** Arguments before the target file path (macOS `open -a`, Linux `sh <script>`). */
  argsPrefix: string[];
  /**
   * 'detected' = found by scanning the machine (registry / install folders),
   * 'default' = the macOS well-known path or PATH, 'setting' = configured.
   */
  source: 'setting' | 'default' | 'detected';
  /**
   * `command` is a Windows batch script (oxygen.bat). Node cannot spawn those
   * directly, so buildOxygenSpawnArgs routes the call through cmd.exe.
   */
  viaCmd?: boolean;
}

export type OxygenDetectionResult =
  | { found: true; spec: OxygenLaunchSpec }
  | { found: false; reason: 'not-configured' | 'setting-invalid' };

function isAppBundle(path: string): boolean {
  return /\.app\/?$/i.test(path);
}

function appBundleSpec(
  path: string,
  source: OxygenLaunchSpec['source'],
): OxygenLaunchSpec {
  return { command: 'open', argsPrefix: ['-a', path], source };
}

function directExeSpec(
  path: string,
  source: OxygenLaunchSpec['source'],
): OxygenLaunchSpec {
  return { command: path, argsPrefix: [], source };
}

/**
 * The spec for one concrete file, by what it is: a macOS bundle goes through
 * `open -a`, a Windows batch script through cmd.exe, a shell script through
 * `sh` (so it does not need the executable bit), anything else is spawned
 * directly.
 */
function specForFile(
  path: string,
  source: OxygenLaunchSpec['source'],
): OxygenLaunchSpec {
  if (isAppBundle(path)) return appBundleSpec(path, source);
  if (/\.(bat|cmd)$/i.test(path)) {
    return { command: path, argsPrefix: [], source, viaCmd: true };
  }
  if (/\.sh$/i.test(path)) return { command: 'sh', argsPrefix: [path], source };
  return directExeSpec(path, source);
}

/** Numeric parts of the first dotted number in `text` ("... 28.1 (64-bit)" -> [28, 1]). */
function versionKey(text: string): number[] {
  const m = /\d+(?:\.\d+)*/.exec(text);
  return m ? m[0].split('.').map(Number) : [];
}

/**
 * Descending version order, 0 when the versions are equal (names without a
 * version count as the lowest). Callers that rank a mixed list keep their own
 * order on a tie, which a stable sort preserves.
 */
export function compareVersion(a: string, b: string): number {
  const ka = versionKey(a);
  const kb = versionKey(b);
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const d = (kb[i] ?? -1) - (ka[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
}

/** Descending version order; names without a version sort last, ties by name. */
export function compareVersionDesc(a: string, b: string): number {
  return compareVersion(a, b) || a.localeCompare(b);
}

export function joinForPlatform(platform: NodeJS.Platform, dir: string, name: string): string {
  const sep = platform === 'win32' ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${sep}${name}`;
}

// The launchers Oxygen ships (per the product docs): a version-suffixed exe
// (oxygen28.1.exe) or oxygen.bat on Windows, oxygen.sh on macOS/Linux; the
// Author and Developer products use oxygenAuthor.* / oxygenDeveloper.*.
const WIN_EXE_RE = /^oxygen(?:Author|Developer)?(?:\d+(?:\.\d+)*)?\.exe$/i;
const WIN_BAT_RE = /^oxygen(?:Author|Developer)?\.bat$/i;
const SH_RE = /^oxygen(?:Author|Developer)?\.sh$/i;
const MAC_APP_RE = /^Oxygen XML .*\.app$/i;

/** Last-resort fixed names, probed with fileExists when the folder cannot be listed. */
const FIXED_CANDIDATES: Record<'win32' | 'darwin' | 'other', string[]> = {
  win32: ['oxygen.exe', 'oxygen.bat'],
  darwin: ['Oxygen XML Editor.app'],
  other: ['oxygen', 'oxygen.sh'],
};

/**
 * The launch spec for an Oxygen installation directory, or undefined when no
 * launcher is in it. A folder listing (when `readDir` can give one) decides
 * first, so version-suffixed names like oxygen28.1.exe are found; the highest
 * version wins if several are present. Fixed names are the fallback.
 */
export function specForInstallDir(
  dir: string,
  platform: NodeJS.Platform,
  io: { readDir?: (p: string) => string[]; fileExists: (p: string) => boolean },
  source: OxygenLaunchSpec['source'],
): OxygenLaunchSpec | undefined {
  const names = io.readDir ? io.readDir(dir) : [];
  const pick = (re: RegExp): string | undefined =>
    names.filter((n) => re.test(n)).sort(compareVersionDesc)[0];
  const found =
    platform === 'win32'
      ? (pick(WIN_EXE_RE) ?? pick(WIN_BAT_RE))
      : platform === 'darwin'
        ? (pick(MAC_APP_RE) ?? pick(SH_RE))
        : pick(SH_RE);
  if (found) return specForFile(joinForPlatform(platform, dir, found), source);
  const fixed = FIXED_CANDIDATES[platform === 'win32' || platform === 'darwin' ? platform : 'other'];
  for (const name of fixed) {
    const candidate = joinForPlatform(platform, dir, name);
    if (io.fileExists(candidate)) return specForFile(candidate, source);
  }
  return undefined;
}

/**
 * The one fixed install location worth probing directly (macOS GUI apps live
 * at a well-known path). Windows and Linux installs vary, so those are found
 * by oxygenDiscovery.ts (registry / folder scan) and then PATH.
 */
const MAC_DEFAULT_APP = '/Applications/Oxygen XML Editor.app';

export function resolveOxygenLaunch(input: {
  configuredPath?: string;
  platform: NodeJS.Platform;
  pathEnv?: string;
  fileExists: (p: string) => boolean;
  /**
   * True when the path is a folder. fileExists (fs.existsSync) is true for a
   * folder too, so without this a configured install folder would be spawned
   * as if it were the launcher.
   */
  isDirectory?: (p: string) => boolean;
  /** Folder listing; empty on error. Lets version-suffixed launchers be found. */
  readDir?: (p: string) => string[];
  /** Installations found by scanning the machine (see oxygenDiscovery.ts), best first. */
  detected?: OxygenLaunchSpec[];
}): OxygenDetectionResult {
  // Priority 1: configured path
  if (input.configuredPath) {
    const trimmed = input.configuredPath.trim();
    if (isAppBundle(trimmed)) {
      return input.fileExists(trimmed)
        ? { found: true, spec: appBundleSpec(trimmed, 'setting') }
        : { found: false, reason: 'setting-invalid' };
    }
    // An installation folder: find the launcher inside it. This is settled
    // before fileExists, which reports a folder as existing as well.
    if (input.isDirectory?.(trimmed)) {
      const inDir = specForInstallDir(trimmed, input.platform, input, 'setting');
      return inDir ? { found: true, spec: inDir } : { found: false, reason: 'setting-invalid' };
    }
    // A direct path to the launcher itself.
    if (input.fileExists(trimmed)) {
      return { found: true, spec: specForFile(trimmed, 'setting') };
    }
    // Otherwise assume it names an installation directory and look for the
    // launcher (or, on macOS, the bundle) inside it.
    const inDir = specForInstallDir(trimmed, input.platform, input, 'setting');
    return inDir ? { found: true, spec: inDir } : { found: false, reason: 'setting-invalid' };
  }

  // Priority 2: well-known default (macOS only -- see MAC_DEFAULT_APP)
  if (input.platform === 'darwin' && input.fileExists(MAC_DEFAULT_APP)) {
    return { found: true, spec: appBundleSpec(MAC_DEFAULT_APP, 'default') };
  }

  // Priority 3: an installation found by scanning the machine
  if (input.detected && input.detected.length > 0) {
    return { found: true, spec: input.detected[0] };
  }

  // Priority 4: PATH env
  if (input.pathEnv) {
    const sep = input.platform === 'win32' ? ';' : ':';
    const exeNames = input.platform === 'win32' ? ['oxygen.exe', 'oxygen.bat'] : ['oxygen', 'oxygen.sh'];
    for (const dir of input.pathEnv.split(sep)) {
      if (!dir) continue;
      for (const exeName of exeNames) {
        const candidate = `${dir.replace(/\\/g, '/')}/${exeName}`;
        if (input.fileExists(candidate)) {
          return { found: true, spec: specForFile(candidate, 'default') };
        }
      }
    }
  }

  return { found: false, reason: 'not-configured' };
}

/**
 * Characters cmd.exe would still act on inside a quoted argument. A file path
 * holding one is refused for a batch launcher rather than escaped.
 */
const CMD_UNSAFE = /[%"^&|<>!\r\n]/;

/**
 * A path a batch launcher cannot be handed safely. `path` is the offending
 * one, the target file or the launcher itself. The module stays vscode-free,
 * so the caller turns this into a localized message (extension.ts).
 */
export class OxygenUnsafeBatchPathError extends Error {
  constructor(readonly path: string) {
    super(`Unsafe path for a batch launcher: ${path}`);
    this.name = 'OxygenUnsafeBatchPathError';
  }
}

export interface OxygenSpawnArgs {
  command: string;
  args: string[];
  /** Set for the cmd.exe route, whose command line is built by hand. */
  windowsVerbatimArguments?: boolean;
}

/**
 * The full spawn invocation for opening one file with a resolved spec.
 * `env` (process.env) locates cmd.exe by full path for a batch launcher; see
 * windowsExe.ts.
 */
export function buildOxygenSpawnArgs(
  spec: OxygenLaunchSpec,
  filePath: string,
  env?: Record<string, string | undefined>,
): OxygenSpawnArgs {
  if (spec.viaCmd) {
    const unsafe = CMD_UNSAFE.test(filePath)
      ? filePath
      : CMD_UNSAFE.test(spec.command)
        ? spec.command
        : undefined;
    if (unsafe !== undefined) throw new OxygenUnsafeBatchPathError(unsafe);
    // `cmd /s /c ""script" "file""`: /s strips exactly the outer pair of quotes.
    return {
      command: windowsSystemExe('cmd.exe', env),
      args: ['/d', '/s', '/c', `""${spec.command}" "${filePath}""`],
      windowsVerbatimArguments: true,
    };
  }
  return { command: spec.command, args: [...spec.argsPrefix, filePath] };
}
