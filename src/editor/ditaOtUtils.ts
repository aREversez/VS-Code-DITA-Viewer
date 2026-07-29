import { readFileSync } from 'fs';
import { basename, extname } from 'path';
import { parseDitamap, preprocessEntities } from '../parser/ditaParser';
import { collectMapEntries } from '../render/mapTypeMap';

export interface NavManifestEntry {
  file: string;
  title: string;
}

export interface SiteChromeFeatures {
  navToolbar: boolean;
  sidebar: boolean;
  onPageToc: boolean;
  copyCode: boolean;
  backToTop: boolean;
  darkMode: boolean;
}

export function buildNavManifest(mapPath: string): NavManifestEntry[] {
  const raw = readFileSync(mapPath, 'utf-8');
  const doc = parseDitamap(preprocessEntities(raw));
  const entries = collectMapEntries(doc.root);
  return entries
    .filter((e) => e.href && e.href.toLowerCase().endsWith('.dita'))
    .map((e) => ({
      file: basename(e.href!, extname(e.href!)) + '.html',
      title: e.displayName,
    }));
}

export interface DitaOtLocation {
  executablePath: string;
  source: 'setting' | 'env' | 'path';
}

export type DetectionResult =
  | { found: true; location: DitaOtLocation }
  | { found: false; reason: 'not-configured' | 'setting-invalid' | 'not-found' }; // setting-invalid = configuredPath provided but file doesn't exist

export function resolveDitaOtExecutable(input: {
  configuredPath?: string;
  ditaHomeEnv?: string;
  pathEnv?: string;
  platform: NodeJS.Platform;
  fileExists: (p: string) => boolean;
}): DetectionResult {
  // Priority 1: configured path
  if (input.configuredPath) {
    const trimmed = input.configuredPath.trim();
    // If the configured path itself looks like a file that exists, use it directly
    if (input.fileExists(trimmed)) {
      return { found: true, location: { executablePath: trimmed, source: 'setting' } };
    }
    // Otherwise assume it's an installation directory: append bin/{dita|dita.bat}
    const exe = input.platform === 'win32'
      ? `${trimmed}\\bin\\dita.bat`
      : `${trimmed}/bin/dita`;
    if (input.fileExists(exe)) {
      return { found: true, location: { executablePath: exe, source: 'setting' } };
    }
    return { found: false, reason: 'setting-invalid' };
  }

  // Priority 2: DITA_HOME env
  if (input.ditaHomeEnv) {
    const exe = input.platform === 'win32'
      ? `${input.ditaHomeEnv}\\bin\\dita.bat`
      : `${input.ditaHomeEnv}/bin/dita`;
    if (input.fileExists(exe)) {
      return { found: true, location: { executablePath: exe, source: 'env' } };
    }
  }

  // Priority 3: PATH env
  if (input.pathEnv) {
    const sep = input.platform === 'win32' ? ';' : ':';
    const dirs = input.pathEnv.split(sep);
    const exeName = input.platform === 'win32' ? 'dita.bat' : 'dita';
    for (const dir of dirs) {
      if (!dir) continue;
      const candidate = `${dir}/${exeName}`.replace(/\\/g, '/');
      if (input.fileExists(candidate)) {
        return { found: true, location: { executablePath: candidate, source: 'path' } };
      }
    }
  }

  return { found: false, reason: 'not-found' };
}

export interface CssArg {
  filename: string;
  root: string;
}

export function buildDitaOtArgs(input: {
  mapPath: string;
  transtype: string;
  outputDir: string;
  cssArg?: CssArg;
  ditavalFile?: string;
}): string[] {
  const args = ['-i', input.mapPath, '-f', input.transtype, '-o', input.outputDir, '--nav-toc=full'];
  if (input.cssArg) {
    args.push('--args.css', input.cssArg.filename);
    args.push('--args.cssroot', input.cssArg.root);
    args.push('--args.copycss', 'yes');
    args.push('--args.csspath', 'css');
  }
  if (input.ditavalFile) {
    args.push('--filter', input.ditavalFile);
  }
  return args;
}

export interface SpawnSpec {
  command: string;
  args: string[];
  /** Pass through to child_process.spawn (Windows cmd.exe invocation only) */
  windowsVerbatimArguments?: boolean;
}

/**
 * Builds a safe spawn invocation for the DITA-OT executable. On Windows,
 * dita.bat must run through cmd.exe, but `shell: true` concatenates all
 * arguments unquoted — breaking paths with spaces and allowing cmd
 * metacharacters (&, ^, |) in user-controlled paths to inject commands.
 * Instead every argument is explicitly double-quoted (with "" escaping)
 * and passed verbatim to `cmd.exe /d /s /c`.
 */
export function buildDitaOtSpawnSpec(
  executablePath: string,
  args: string[],
  platform: NodeJS.Platform,
): SpawnSpec {
  if (platform !== 'win32') {
    return { command: executablePath, args };
  }
  const quote = (a: string) => `"${a.replace(/"/g, '""')}"`;
  const commandLine = [quote(executablePath), ...args.map(quote)].join(' ');
  return {
    command: 'cmd.exe',
    // /s makes cmd strip only the outer quotes of the wrapped command line
    args: ['/d', '/s', '/c', `"${commandLine}"`],
    windowsVerbatimArguments: true,
  };
}

export type LogLevel = 'error' | 'warn' | 'info';

const ERROR_RE = /^.*?\[ERROR\]/i;
const WARN_RE = /^.*?\[WARN\]/i;

export function classifyLogLine(line: string): LogLevel {
  if (ERROR_RE.test(line)) return 'error';
  if (WARN_RE.test(line)) return 'warn';
  return 'info';
}

// ── Line buffer for streamed chunk processing ──

export interface LineBuffer {
  processChunk(chunk: string): string[];
  flush(): string[];
}

export function createLineBuffer(): LineBuffer {
  let buffer = '';
  return {
    processChunk(chunk: string): string[] {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      return lines;
    },
    flush(): string[] {
      const remaining = buffer;
      buffer = '';
      return remaining ? [remaining] : [];
    },
  };
}
