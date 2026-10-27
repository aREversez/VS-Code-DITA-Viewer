#!/usr/bin/env node
// Install the freshly packaged .vsix into a local VS Code.
// Run via `npm run vsix:install`, or `npm run package:install` to build +
// package + install in one shot.
//
// Why a script instead of a `code --install-extension ...` one-liner in
// package.json:
//   1. `code` on PATH is not necessarily Microsoft VS Code. On this machine
//      PATH resolves it to another IDE's bundled CLI, which would silently
//      install into the wrong product. Standard VS Code locations are probed
//      first, PATH is only the last resort.
//   2. The vsix filename carries the version, so it has to be discovered
//      rather than spelled out in the script string.
//   3. VS Code offers no CLI to reload its window, so the last step has to be
//      a printed instruction rather than a command.
//
// Env overrides:
//   VSCODE_CLI     absolute path to code.cmd / code (e.g. VS Code Insiders)
//   VSIX_PROFILE   install into a named profile instead of the default one
//
// Flags:
//   --dry-run      print what would be installed and where, change nothing
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outputDir = path.join(root, 'output');
const dryRun = process.argv.includes('--dry-run');
const isWin = process.platform === 'win32';

function quote(arg) {
  return /[\s"]/.test(arg) ? `"${arg}"` : arg;
}

// Run through the shell so that .cmd/.bat shims work on Windows.
function run(command, args, options = {}) {
  const line = [command, ...args].map(quote).join(' ');
  return spawnSync(line, { shell: true, encoding: 'utf8', ...options });
}

function cliCandidates() {
  const found = [];
  if (process.env.VSCODE_CLI) found.push(process.env.VSCODE_CLI);

  if (isWin) {
    const bases = [
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'),
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
    ];
    for (const base of bases) {
      if (base) found.push(path.join(base, 'Microsoft VS Code', 'bin', 'code.cmd'));
    }
  } else if (process.platform === 'darwin') {
    found.push('/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code');
  } else {
    found.push('/usr/share/code/bin/code', '/usr/bin/code', '/snap/bin/code');
  }

  found.push('code');
  return found;
}

function resolveCli() {
  const candidates = cliCandidates();
  for (const candidate of candidates) {
    if (candidate === 'code') return { command: 'code', fromPath: true };
    if (fs.existsSync(candidate)) return { command: candidate, fromPath: false };
  }
  return null;
}

function latestVsix() {
  if (!fs.existsSync(outputDir)) return null;
  const files = fs
    .readdirSync(outputDir)
    .filter((name) => name.toLowerCase().endsWith('.vsix'))
    .map((name) => ({
      name,
      mtime: fs.statSync(path.join(outputDir, name)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  return files.length ? path.join(outputDir, files[0].name) : null;
}

const cli = resolveCli();
if (!cli) {
  console.error(
    'No VS Code CLI found. Set VSCODE_CLI to your code.cmd / code path.',
  );
  process.exit(1);
}

const vsix = latestVsix();
if (!vsix) {
  console.error(`No .vsix in ${outputDir}. Run "npm run package" first.`);
  process.exit(1);
}

const profileArgs = process.env.VSIX_PROFILE
  ? ['--profile', process.env.VSIX_PROFILE]
  : [];

if (cli.fromPath) {
  console.warn(
    'warning: falling back to "code" from PATH; it may belong to another product.',
  );
}
console.log(`VS Code CLI : ${cli.command}`);
console.log(`vsix        : ${vsix}`);
if (process.env.VSIX_PROFILE) console.log(`profile     : ${process.env.VSIX_PROFILE}`);

if (dryRun) {
  console.log('dry run: nothing installed.');
  process.exit(0);
}

const install = run(
  cli.command,
  ['--install-extension', vsix, '--force', ...profileArgs],
  { stdio: 'inherit' },
);
if (install.status !== 0) {
  console.error(
    'Install failed. If the error mentions a locked file, close VS Code and rerun.',
  );
  process.exit(install.status || 1);
}

// Confirm what actually ended up on disk rather than trusting the exit code.
const list = run(
  cli.command,
  ['--list-extensions', '--show-versions', ...profileArgs],
  { stdio: 'pipe' },
);
const installed = (list.stdout || '')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.toLowerCase().startsWith('dita-viewer.dita-viewer@'));

console.log('');
if (installed.length) {
  console.log(`installed   : ${installed.join(', ')}`);
} else {
  console.warn('warning: dita-viewer not found in --list-extensions output.');
}
console.log('Now run "Developer: Reload Window" in VS Code to load the new build.');
