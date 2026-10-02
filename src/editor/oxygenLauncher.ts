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
export interface OxygenLaunchSpec {
  command: string;
  /** Arguments before the target file path -- empty except on macOS. */
  argsPrefix: string[];
  source: 'setting' | 'default';
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
 * Default install location Oxygen never asks the user to type in on macOS
 * (the platform whose GUI apps live at a fixed, well-known path); Windows
 * and Linux installs are too variable to guess, so on those platforms a
 * user with no dita-viewer.oxygenPath set falls through to PATH before
 * giving up.
 */
const MAC_DEFAULT_APP = '/Applications/Oxygen XML Editor.app';

export function resolveOxygenLaunch(input: {
  configuredPath?: string;
  platform: NodeJS.Platform;
  pathEnv?: string;
  fileExists: (p: string) => boolean;
}): OxygenDetectionResult {
  // Priority 1: configured path
  if (input.configuredPath) {
    const trimmed = input.configuredPath.trim();
    if (isAppBundle(trimmed)) {
      return input.fileExists(trimmed)
        ? { found: true, spec: appBundleSpec(trimmed, 'setting') }
        : { found: false, reason: 'setting-invalid' };
    }
    // A direct path to the executable itself.
    if (input.fileExists(trimmed)) {
      return { found: true, spec: directExeSpec(trimmed, 'setting') };
    }
    // Otherwise assume it names an installation directory and look for the
    // executable (or, on macOS, the bundle) inside it.
    const candidates =
      input.platform === 'win32'
        ? [`${trimmed}\\oxygen.exe`]
        : input.platform === 'darwin'
          ? [`${trimmed}/Oxygen XML Editor.app`]
          : [`${trimmed}/oxygen`];
    for (const candidate of candidates) {
      if (input.fileExists(candidate)) {
        return {
          found: true,
          spec: isAppBundle(candidate)
            ? appBundleSpec(candidate, 'setting')
            : directExeSpec(candidate, 'setting'),
        };
      }
    }
    return { found: false, reason: 'setting-invalid' };
  }

  // Priority 2: well-known default (macOS only -- see MAC_DEFAULT_APP)
  if (input.platform === 'darwin' && input.fileExists(MAC_DEFAULT_APP)) {
    return { found: true, spec: appBundleSpec(MAC_DEFAULT_APP, 'default') };
  }

  // Priority 3: PATH env
  if (input.pathEnv) {
    const sep = input.platform === 'win32' ? ';' : ':';
    const exeName = input.platform === 'win32' ? 'oxygen.exe' : 'oxygen';
    for (const dir of input.pathEnv.split(sep)) {
      if (!dir) continue;
      const candidate = `${dir.replace(/\\/g, '/')}/${exeName}`;
      if (input.fileExists(candidate)) {
        return { found: true, spec: directExeSpec(candidate, 'default') };
      }
    }
  }

  return { found: false, reason: 'not-configured' };
}

/** The full spawn invocation for opening one file with a resolved spec. */
export function buildOxygenSpawnArgs(
  spec: OxygenLaunchSpec,
  filePath: string,
): { command: string; args: string[] } {
  return { command: spec.command, args: [...spec.argsPrefix, filePath] };
}
