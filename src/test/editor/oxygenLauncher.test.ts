import * as assert from 'assert';
import { resolveOxygenLaunch, buildOxygenSpawnArgs } from '../../editor/oxygenLauncher';

describe('resolveOxygenLaunch', () => {
  // ── Priority 1: configured path ──

  it('uses a configured path directly when it points at the executable itself', () => {
    const r = resolveOxygenLaunch({
      configuredPath: '/opt/oxygen/oxygen',
      platform: 'linux',
      fileExists: (p) => p === '/opt/oxygen/oxygen',
    });
    assert.ok(r.found);
    if (r.found) {
      assert.strictEqual(r.spec.command, '/opt/oxygen/oxygen');
      assert.deepStrictEqual(r.spec.argsPrefix, []);
      assert.strictEqual(r.spec.source, 'setting');
    }
  });

  it('treats a configured .app path as a bundle, launched via "open -a"', () => {
    const r = resolveOxygenLaunch({
      configuredPath: '/Applications/Oxygen XML Editor 27.app',
      platform: 'darwin',
      fileExists: (p) => p === '/Applications/Oxygen XML Editor 27.app',
    });
    assert.ok(r.found);
    if (r.found) {
      assert.strictEqual(r.spec.command, 'open');
      assert.deepStrictEqual(r.spec.argsPrefix, ['-a', '/Applications/Oxygen XML Editor 27.app']);
      assert.strictEqual(r.spec.source, 'setting');
    }
  });

  it('falls back to a candidate exe inside a configured install directory (Windows)', () => {
    const r = resolveOxygenLaunch({
      configuredPath: 'C:\\Program Files\\Oxygen XML Editor',
      platform: 'win32',
      fileExists: (p) => p === 'C:\\Program Files\\Oxygen XML Editor\\oxygen.exe',
    });
    assert.ok(r.found);
    if (r.found) {
      assert.strictEqual(r.spec.command, 'C:\\Program Files\\Oxygen XML Editor\\oxygen.exe');
      assert.strictEqual(r.spec.source, 'setting');
    }
  });

  it('falls back to a candidate bundle inside a configured install directory (macOS)', () => {
    const r = resolveOxygenLaunch({
      configuredPath: '/Applications',
      platform: 'darwin',
      fileExists: (p) => p === '/Applications/Oxygen XML Editor.app',
    });
    assert.ok(r.found);
    if (r.found) {
      assert.strictEqual(r.spec.command, 'open');
      assert.deepStrictEqual(r.spec.argsPrefix, ['-a', '/Applications/Oxygen XML Editor.app']);
    }
  });

  it('falls back to a candidate exe inside a configured install directory (Linux)', () => {
    const r = resolveOxygenLaunch({
      configuredPath: '/opt/oxygen',
      platform: 'linux',
      fileExists: (p) => p === '/opt/oxygen/oxygen',
    });
    assert.ok(r.found);
    if (r.found) assert.strictEqual(r.spec.command, '/opt/oxygen/oxygen');
  });

  it('returns setting-invalid when the configured path resolves to nothing', () => {
    const r = resolveOxygenLaunch({
      configuredPath: '/opt/oxygen',
      platform: 'linux',
      fileExists: () => false,
    });
    assert.ok(!r.found);
    if (!r.found) assert.strictEqual(r.reason, 'setting-invalid');
  });

  // ── Priority 2: macOS default install location ──

  it('finds the default macOS install location when nothing is configured', () => {
    const r = resolveOxygenLaunch({
      platform: 'darwin',
      fileExists: (p) => p === '/Applications/Oxygen XML Editor.app',
    });
    assert.ok(r.found);
    if (r.found) {
      assert.strictEqual(r.spec.command, 'open');
      assert.strictEqual(r.spec.source, 'default');
    }
  });

  it('does not try the macOS default on other platforms', () => {
    const r = resolveOxygenLaunch({
      platform: 'win32',
      fileExists: (p) => p === '/Applications/Oxygen XML Editor.app',
    });
    assert.ok(!r.found);
  });

  // ── Priority 3: PATH ──

  it('finds an executable on PATH (POSIX)', () => {
    const r = resolveOxygenLaunch({
      platform: 'linux',
      pathEnv: '/usr/bin:/usr/local/bin',
      fileExists: (p) => p === '/usr/local/bin/oxygen',
    });
    assert.ok(r.found);
    if (r.found) {
      assert.strictEqual(r.spec.command, '/usr/local/bin/oxygen');
      assert.strictEqual(r.spec.source, 'default');
    }
  });

  it('finds oxygen.exe on PATH (Windows)', () => {
    const r = resolveOxygenLaunch({
      platform: 'win32',
      pathEnv: 'C:\\tools;C:\\oxygen',
      fileExists: (p) => p === 'C:/oxygen/oxygen.exe',
    });
    assert.ok(r.found);
    if (r.found) assert.strictEqual(r.spec.command, 'C:/oxygen/oxygen.exe');
  });

  it('reports not-configured when nothing is set and nothing is found', () => {
    const r = resolveOxygenLaunch({
      platform: 'linux',
      pathEnv: '/usr/bin',
      fileExists: () => false,
    });
    assert.ok(!r.found);
    if (!r.found) assert.strictEqual(r.reason, 'not-configured');
  });
});

describe('buildOxygenSpawnArgs', () => {
  it('appends the target file after any fixed prefix args', () => {
    const args = buildOxygenSpawnArgs(
      { command: 'open', argsPrefix: ['-a', '/Applications/Oxygen XML Editor.app'], source: 'default' },
      '/repo/topics/intro.dita',
    );
    assert.strictEqual(args.command, 'open');
    assert.deepStrictEqual(args.args, ['-a', '/Applications/Oxygen XML Editor.app', '/repo/topics/intro.dita']);
  });

  it('has no prefix for a direct executable', () => {
    const args = buildOxygenSpawnArgs({ command: '/opt/oxygen/oxygen', argsPrefix: [], source: 'setting' }, '/a.dita');
    assert.deepStrictEqual(args.args, ['/a.dita']);
  });
});
