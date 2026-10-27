import * as path from 'path';
import * as fs from 'fs';
import Mocha from 'mocha';

// Recursively finds compiled *.test.js files under `dir`. Deliberately not
// using the `glob` package (not already a dependency of this project) since
// the number of integration test files is small; a plain directory walk is
// enough and keeps this test-only entry point dependency-free.
function findCompiledTestFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findCompiledTestFiles(full));
    } else if (entry.name.endsWith('.test.js')) {
      results.push(full);
    }
  }
  return results;
}

// This is the entry point @vscode/test-electron's `runTests()` requires
// (via `extensionTestsPath`) and calls once a real VS Code instance with
// this extension loaded has finished starting up.
export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'bdd',
    color: true,
    // 90s, not the mocha default and not the old 20s: the preview tests poll
    // for a value a real render writes (waitFor's own 20s budget), and the
    // heaviest one runs two render legs plus two closePreview dispose waits in a
    // single test. The dispose-before-reopen race is closed by closePreview, so
    // a value is guaranteed to arrive once its render lands -- the only reason a
    // poll can still fail is a genuinely slow render on a loaded runner, which
    // needs a larger budget than a stuck test would ever satisfy. Keep this
    // above the worst-case sum of one test's polls so the failure that reports
    // is waitFor's named message, not a bare mocha timeout.
    timeout: 90000,
  });

  const testsRoot = __dirname;

  return new Promise((resolvePromise, rejectPromise) => {
    try {
      // Files are added by path and required lazily inside mocha.run() —
      // this matters because mocha's `describe`/`it` globals are only wired
      // up correctly once `run()` starts processing files. Statically
      // `import`-ing test files at the top of this module instead would
      // execute their `describe(...)` calls before those globals exist.
      for (const file of findCompiledTestFiles(testsRoot)) {
        mocha.addFile(file);
      }

      mocha.run((failures) => {
        if (failures > 0) {
          rejectPromise(new Error(`${failures} integration test(s) failed.`));
        } else {
          resolvePromise();
        }
      });
    } catch (err) {
      rejectPromise(err);
    }
  });
}
