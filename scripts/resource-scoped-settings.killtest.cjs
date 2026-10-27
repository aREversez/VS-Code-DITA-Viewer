// Kill test for src/test/editor/resourceScopedSettings.test.ts: breaks the
// folder-scoped read of templatesDirectory / cssDirectory / customCss in the
// ways the fix could silently be undone, and confirms the guard test notices
// each one. Exits non-zero if a mutation escapes or the untouched tree fails.
//
//   node scripts/resource-scoped-settings.killtest.cjs
//
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repo = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');
const write = (rel, text) => fs.writeFileSync(path.join(repo, rel), text, 'utf8');

// A substitute that fails to match would read as "no mutation", so it stops.
function replaceOnce(rel, from, to) {
  const text = read(rel);
  if (!text.includes(from)) throw new Error(`mutation probe did not match ${rel}: ${from.slice(0, 60)}`);
  write(rel, text.replace(from, to));
}

const MVProv = 'src/editor/MapViewerProvider.ts';
const CSSD = 'src/editor/cssDiscovery.ts';
const EXT = 'src/extension.ts';
const SCRATCH = 'src/editor/scratchCssReader.ts';

const mutations = [
  {
    id: 'drop-scope-templateRoots',
    what: 'templateRoots goes back to an unscoped read',
    apply: () => {
      replaceOnce(MVProv, `getConfiguration('dita-viewer', document.uri)`, `getConfiguration('dita-viewer')`);
      return [MVProv];
    },
  },
  {
    id: 'drop-scope-cssDiscovery',
    what: 'cssDiscovery reads both settings through an unscoped config',
    apply: () => {
      const text = read(CSSD);
      if (!/getConfiguration\('dita-viewer', docUri\)/.test(text)) throw new Error(`mutation probe did not match ${CSSD}`);
      write(CSSD, text.replace(/getConfiguration\('dita-viewer', docUri\)/g, `getConfiguration('dita-viewer')`));
      return [CSSD];
    },
  },
  {
    id: 'drop-scope-chained',
    what: 'a read chained onto the call drops its scope argument',
    apply: () => {
      replaceOnce(EXT, `getConfiguration('dita-viewer', mapUri)`, `getConfiguration('dita-viewer')`);
      return [EXT];
    },
  },
  {
    id: 'new-reader-in-new-file',
    what: 'a fourth file reads customCss without a scope',
    apply: () => {
      write(
        SCRATCH,
        [
          "import * as vscode from 'vscode';",
          '',
          '// Probe: a newly added reader of a resource-scoped setting.',
          'export function scratchCustomCss(): string[] {',
          "  const cfg = vscode.workspace.getConfiguration('dita-viewer');",
          "  return cfg.get<string[]>('customCss') ?? [];",
          '}',
          '',
        ].join('\n')
      );
      return []; // untracked file: removed here, not by git
    },
  },
  {
    id: 'read-deleted',
    what: 'the templatesDirectory read disappears (feature dropped, guard going quiet)',
    apply: () => {
      replaceOnce(MVProv, `    const configuredDirs = config.get<string[]>('templatesDirectory') ?? [];`, '    const configuredDirs: string[] = [];');
      return [MVProv];
    },
  },
  {
    id: 'unscoped-var-behind-scoped-call',
    what: 'the read goes through an unscoped variable while a scoped call sits closer to it',
    apply: () => {
      replaceOnce(
        CSSD,
        "    const config = vscode.workspace.getConfiguration('dita-viewer', docUri);\n    const cssDirConfigs: string[] | undefined = config.get('cssDirectory');",
        [
          "    const legacy = vscode.workspace.getConfiguration('dita-viewer');",
          "    const config = vscode.workspace.getConfiguration('dita-viewer', docUri);",
          '    void config;',
          "    const cssDirConfigs: string[] | undefined = legacy.get('cssDirectory');",
        ].join('\n')
      );
      return [CSSD];
    },
  },
  {
    id: 'scope-behind-a-helper',
    what: 'the read moves behind a helper that returns the config (scope untraceable)',
    apply: () => {
      replaceOnce(
        CSSD,
        "    const config = vscode.workspace.getConfiguration('dita-viewer', docUri);\n    const cssDirConfigs",
        ['    const cfgOf = (u: vscode.Uri) => vscode.workspace.getConfiguration(\'dita-viewer\', u);', '    const config = cfgOf(docUri);', '    const cssDirConfigs'].join('\n')
      );
      return [CSSD];
    },
  },
];

const GUARD_TEST = 'dist-test/test/editor/resourceScopedSettings.test.js';

function guardPasses() {
  try {
    execSync(`npx mocha --no-config --timeout 10000 ${GUARD_TEST}`, { cwd: repo, stdio: 'pipe' });
    return true;
  } catch (e) {
    return false;
  }
}

function run() {
  let failures = 0;
  execSync('npx tsc -p tsconfig.test.json', { cwd: repo, stdio: 'pipe' });
  if (!guardPasses()) {
    process.stdout.write('the guard test fails on the untouched tree — nothing below means anything\n');
    process.exitCode = 1;
    return;
  }
  process.stdout.write('baseline   the guard test passes on the untouched tree\n');

  for (const m of mutations) {
    let touched = [];
    let escaped = false;
    try {
      touched = m.apply();
      escaped = guardPasses();
    } finally {
      if (touched.length) execSync(`git checkout -- ${touched.join(' ')}`, { cwd: repo, stdio: 'pipe' });
      if (fs.existsSync(path.join(repo, SCRATCH))) fs.unlinkSync(path.join(repo, SCRATCH));
    }
    if (escaped) {
      failures += 1;
      process.stdout.write(`ESCAPED    ${m.id} — ${m.what}\n`);
    } else {
      process.stdout.write(`caught     ${m.id} — ${m.what}\n`);
    }
  }
  process.stdout.write(`\n${mutations.length - failures}/${mutations.length} mutations caught\n`);
  if (failures) process.exitCode = 1;
}

run();
