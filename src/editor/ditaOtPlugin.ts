import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'fs';
import { dirname, join } from 'path';

/** Id of the bundled DITA-OT plugin that spaces CJK/Latin text around keys. */
export const CJK_SPACING_PLUGIN_ID = 'com.dita-viewer.cjk-spacing';

/** Folder under the DITA-OT home that holds one timestamped backup per install. */
export const BACKUP_DIR_NAME = 'dita-viewer-backup';

/**
 * Files `dita install` (the integrator) rewrites, relative to the DITA-OT
 * home, found by diffing an installation before and after integrating a
 * plugin (DITA-OT 4.3.3). Missing entries are skipped, so other versions that
 * lack one of them still back up cleanly.
 */
export const INTEGRATOR_REWRITTEN_FILES = [
  'plugins/org.dita.base/build.xml',
  'plugins/org.dita.base/build_preprocess.xml',
  'plugins/org.dita.base/build_preprocess2.xml',
  'plugins/org.dita.base/catalog-dita.xml',
  'config/plugins.xml',
  'config/messages_en_US.properties',
  'config/org.dita.dost.platform/plugin.properties',
  'lib/dost-configuration.jar',
];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function backupStamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * Copies every file the integrator will rewrite, plus a previously installed
 * copy of this plugin, into `<otHome>/dita-viewer-backup/<yyyyMMdd-HHmmss>/`
 * with their relative paths kept, so restoring is copying the folder's
 * contents back over the DITA-OT home. Earlier backups are never overwritten
 * or removed. Throws if any copy fails, so the caller can stop before
 * touching the installation.
 */
export function backupIntegratorFiles(otHome: string, now: Date = new Date()): string {
  const root = join(otHome, BACKUP_DIR_NAME);
  const stamp = backupStamp(now);
  let dir = join(root, stamp);
  for (let i = 2; existsSync(dir); i++) dir = join(root, `${stamp}-${i}`);
  mkdirSync(dir, { recursive: true });
  const rels = [...INTEGRATOR_REWRITTEN_FILES, `plugins/${CJK_SPACING_PLUGIN_ID}`];
  for (const rel of rels) {
    const src = join(otHome, rel);
    if (!existsSync(src)) continue;
    const dest = join(dir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true });
  }
  return dir;
}

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
 * Backs up what the integrator will rewrite, then copies the bundled plugin
 * into `<otHome>/plugins` and asks DITA-OT to integrate it. Returns the backup
 * folder. If the backup fails nothing is modified. `runIntegrate` runs `dita install` (no arguments, which
 * re-integrates the plugins folder); it is injected so the caller owns
 * process spawning. Throws with the underlying message on failure (a
 * permission error is the usual cause for a system-wide install).
 */
export async function installPlugin(
  otHome: string,
  bundledDir: string,
  runIntegrate: () => Promise<void>,
): Promise<string> {
  const backupDir = backupIntegratorFiles(otHome);
  const target = join(otHome, 'plugins', CJK_SPACING_PLUGIN_ID);
  rmSync(target, { recursive: true, force: true });
  cpSync(bundledDir, target, { recursive: true });
  await runIntegrate();
  return backupDir;
}
