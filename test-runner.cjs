const path = require('path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname);
    const extensionTestsPath = path.resolve(__dirname, 'dist/test');
    const testWorkspace = path.resolve(__dirname, 'test-dita-file');

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      // Trust is off by default for a fresh profile; commands that shell out
      // (Compare with Git) stop at the trust gate, which would fail a suite
      // that has nothing to do with trust.
      launchArgs: [testWorkspace, '--disable-extensions', '--disable-workspace-trust'],
    });
  } catch (err) {
    console.error('Test run failed:', err);
    process.exit(1);
  }
}

main();
