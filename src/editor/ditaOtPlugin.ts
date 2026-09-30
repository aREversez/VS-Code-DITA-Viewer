import { cpSync, existsSync, readFileSync, realpathSync, rmSync } from 'fs';
import { dirname, join } from 'path';

/** Id of the bundled DITA-OT plugin that spaces CJK/Latin text around keys. */
export const CJK_SPACING_PLUGIN_ID = 'com.dita-viewer.cjk-spacing';

export type PluginStatus = 'installed' | 'missing' | 'outdated';

/** Reads `<plugin ... version="x">` out of a plugin.xml text. */
export function readPluginVersion(pluginXml: string): string | undefined {
  const tag = /<plugin\b[^>]*>/.exec(pluginXml);
  const m = tag ? /\bversion\s*=\s*"([^"]*)"/.exec(tag[0]) : null;
  return m ? m[1] : undefined;
}

/** DITA-OT home from the `bin/dita` executable (resolving symlinks from PATH). */
export function ditaOtHomeFromExecutable(executablePath: string): string {
  let exe = executablePath;
  try {
    exe = realpathSync(executablePath);
  } catch {
    /* keep the given path */
  }
  return dirname(dirname(exe));
}

export function getPluginStatus(otHome: string, bundledDir: string): PluginStatus {
  const installedXml = join(otHome, 'plugins', CJK_SPACING_PLUGIN_ID, 'plugin.xml');
  if (!existsSync(installedXml)) return 'missing';
  const have = readPluginVersion(readFileSync(installedXml, 'utf-8'));
  const want = readPluginVersion(readFileSync(join(bundledDir, 'plugin.xml'), 'utf-8'));
  return have && want && have === want ? 'installed' : 'outdated';
}

/**
 * Copies the bundled plugin into `<otHome>/plugins` and asks DITA-OT to
 * integrate it. `runIntegrate` runs `dita install` (no arguments, which
 * re-integrates the plugins folder); it is injected so the caller owns
 * process spawning. Throws with the underlying message on failure (a
 * permission error is the usual cause for a system-wide install).
 */
export async function installPlugin(
  otHome: string,
  bundledDir: string,
  runIntegrate: () => Promise<void>,
): Promise<void> {
  const target = join(otHome, 'plugins', CJK_SPACING_PLUGIN_ID);
  rmSync(target, { recursive: true, force: true });
  cpSync(bundledDir, target, { recursive: true });
  await runIntegrate();
}
