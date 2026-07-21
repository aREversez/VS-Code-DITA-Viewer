import * as assert from 'assert';
import { join } from 'path';
import {
  resolveDitaOtExecutable,
  buildDitaOtArgs,
  buildNavManifest,
  classifyLogLine,
  createLineBuffer,
} from '../../editor/ditaOtUtils';

describe('resolveDitaOtExecutable', () => {
  // ── Priority 1: configured path ──

  it('should find from configured directory (POSIX)', () => {
    const r = resolveDitaOtExecutable({
      configuredPath: '/opt/dita-ot',
      platform: 'linux',
      fileExists: (p) => p === '/opt/dita-ot/bin/dita',
    });
    assert.ok(r.found);
    if (r.found) {
      assert.strictEqual(r.location.executablePath, '/opt/dita-ot/bin/dita');
      assert.strictEqual(r.location.source, 'setting');
    }
  });

  it('should find from configured directory (Windows)', () => {
    const r = resolveDitaOtExecutable({
      configuredPath: 'C:\\dita-ot',
      platform: 'win32',
      fileExists: (p) => p === 'C:\\dita-ot\\bin\\dita.bat',
    });
    assert.ok(r.found);
    if (r.found) {
      assert.strictEqual(r.location.executablePath, 'C:\\dita-ot\\bin\\dita.bat');
      assert.strictEqual(r.location.source, 'setting');
    }
  });

  it('should return setting-invalid when configured path does not exist', () => {
    const r = resolveDitaOtExecutable({
      configuredPath: '/opt/dita-ot',
      platform: 'linux',
      fileExists: () => false,
    });
    assert.strictEqual(r.found, false);
    if (!r.found) {
      assert.strictEqual(r.reason, 'setting-invalid');
    }
  });

  it('should return setting-invalid when configured path is a direct file path that does not exist', () => {
    const r = resolveDitaOtExecutable({
      configuredPath: '/opt/dita-ot/bin/dita',
      platform: 'linux',
      fileExists: () => false,
    });
    assert.strictEqual(r.found, false);
    if (!r.found) {
      assert.strictEqual(r.reason, 'setting-invalid');
    }
  });

  // ── Priority 2: DITA_HOME ──

  it('should find from DITA_HOME env (POSIX)', () => {
    const r = resolveDitaOtExecutable({
      configuredPath: undefined,
      ditaHomeEnv: '/usr/local/dita-ot',
      platform: 'darwin',
      fileExists: (p) => p === '/usr/local/dita-ot/bin/dita',
    });
    assert.ok(r.found);
    if (r.found) {
      assert.strictEqual(r.location.executablePath, '/usr/local/dita-ot/bin/dita');
      assert.strictEqual(r.location.source, 'env');
    }
  });

  it('should find from DITA_HOME env (Windows)', () => {
    const r = resolveDitaOtExecutable({
      configuredPath: undefined,
      ditaHomeEnv: 'D:\\dita-ot',
      platform: 'win32',
      fileExists: (p) => p === 'D:\\dita-ot\\bin\\dita.bat',
    });
    assert.ok(r.found);
    if (r.found) {
      assert.strictEqual(r.location.executablePath, 'D:\\dita-ot\\bin\\dita.bat');
      assert.strictEqual(r.location.source, 'env');
    }
  });

  it('should skip DITA_HOME when bin/dita does not exist', () => {
    const r = resolveDitaOtExecutable({
      configuredPath: undefined,
      ditaHomeEnv: '/usr/local/dita-ot',
      platform: 'linux',
      fileExists: () => false,
    });
    assert.strictEqual(r.found, false);
    if (!r.found) {
      assert.strictEqual(r.reason, 'not-found');
    }
  });

  // ── Priority 3: PATH ──

  it('should find from PATH (POSIX)', () => {
    const r = resolveDitaOtExecutable({
      configuredPath: undefined,
      ditaHomeEnv: undefined,
      pathEnv: '/usr/bin:/opt/dita-ot/bin:/usr/local/bin',
      platform: 'linux',
      fileExists: (p) => p === '/opt/dita-ot/bin/dita',
    });
    assert.ok(r.found);
    if (r.found) {
      assert.strictEqual(r.location.executablePath, '/opt/dita-ot/bin/dita');
      assert.strictEqual(r.location.source, 'path');
    }
  });

  it('should find from PATH (Windows)', () => {
    const r = resolveDitaOtExecutable({
      configuredPath: undefined,
      ditaHomeEnv: undefined,
      pathEnv: 'C:\\Windows;D:\\tools\\dita-ot\\bin',
      platform: 'win32',
      fileExists: (p) => p === 'D:/tools/dita-ot/bin/dita.bat',
    });
    assert.ok(r.found);
    if (r.found) {
      assert.strictEqual(r.location.executablePath, 'D:/tools/dita-ot/bin/dita.bat');
      assert.strictEqual(r.location.source, 'path');
    }
  });

  it('should respect priority: setting > env > path', () => {
    // Setting wins even if env and path also have valid candidates
    const r = resolveDitaOtExecutable({
      configuredPath: '/setting/dita-ot',
      ditaHomeEnv: '/env/dita-ot',
      pathEnv: '/usr/bin:/path/dita-ot/bin',
      platform: 'linux',
      fileExists: (p) => p === '/setting/dita-ot/bin/dita',
    });
    assert.ok(r.found);
    if (r.found) {
      assert.strictEqual(r.location.source, 'setting');
      assert.strictEqual(r.location.executablePath, '/setting/dita-ot/bin/dita');
    }
  });

  it('should return not-found when nothing is available', () => {
    const r = resolveDitaOtExecutable({
      configuredPath: undefined,
      ditaHomeEnv: undefined,
      pathEnv: undefined,
      platform: 'linux',
      fileExists: () => false,
    });
    assert.strictEqual(r.found, false);
    if (!r.found) {
      assert.strictEqual(r.reason, 'not-found');
    }
  });
});

describe('buildDitaOtArgs', () => {
  it('should return args array in correct order', () => {
    const args = buildDitaOtArgs({
      mapPath: '/project/maps/my.ditamap',
      transtype: 'html5',
      outputDir: '/project/out/html5',
    });
    assert.deepStrictEqual(args, [
      '-i',
      '/project/maps/my.ditamap',
      '-f',
      'html5',
      '-o',
      '/project/out/html5',
    ]);
  });

  it('should not add extra escaping for paths with spaces', () => {
    const args = buildDitaOtArgs({
      mapPath: '/my project/my map.ditamap',
      transtype: 'pdf',
      outputDir: '/my project/out/pdf',
    });
    assert.deepStrictEqual(args, [
      '-i',
      '/my project/my map.ditamap',
      '-f',
      'pdf',
      '-o',
      '/my project/out/pdf',
    ]);
  });

  it('should work with Windows-style paths', () => {
    const args = buildDitaOtArgs({
      mapPath: 'C:\\project\\maps\\my.ditamap',
      transtype: 'xhtml',
      outputDir: 'C:\\project\\out\\xhtml',
    });
    assert.deepStrictEqual(args, [
      '-i',
      'C:\\project\\maps\\my.ditamap',
      '-f',
      'xhtml',
      '-o',
      'C:\\project\\out\\xhtml',
    ]);
  });

  it('should include CSS args when cssArg is provided', () => {
    const args = buildDitaOtArgs({
      mapPath: '/map.ditamap',
      transtype: 'html5',
      outputDir: '/out',
      cssArg: { filename: 'my-theme.css', root: '/project/css' },
    });
    assert.deepStrictEqual(args, [
      '-i', '/map.ditamap',
      '-f', 'html5',
      '-o', '/out',
      '--args.css', 'my-theme.css',
      '--args.cssroot', '/project/css',
      '--args.copycss', 'yes',
      '--args.csspath', 'css',
    ]);
  });

  it('should include filter arg when ditavalFile is provided', () => {
    const args = buildDitaOtArgs({
      mapPath: '/map.ditamap',
      transtype: 'pdf',
      outputDir: '/out',
      ditavalFile: '/filters/profiling.ditaval',
    });
    assert.deepStrictEqual(args, [
      '-i', '/map.ditamap',
      '-f', 'pdf',
      '-o', '/out',
      '--filter', '/filters/profiling.ditaval',
    ]);
  });

  it('should include both CSS and filter args when both provided', () => {
    const args = buildDitaOtArgs({
      mapPath: '/map.ditamap',
      transtype: 'xhtml',
      outputDir: '/out',
      cssArg: { filename: 'custom.css', root: '/root' },
      ditavalFile: '/filter.ditaval',
    });
    assert.deepStrictEqual(args, [
      '-i', '/map.ditamap',
      '-f', 'xhtml',
      '-o', '/out',
      '--args.css', 'custom.css',
      '--args.cssroot', '/root',
      '--args.copycss', 'yes',
      '--args.csspath', 'css',
      '--filter', '/filter.ditaval',
    ]);
  });
});

describe('buildNavManifest', () => {
  it('should build manifest from test ditamap', () => {
    const manifest = buildNavManifest(join(__dirname, '..', '..', '..', 'test-dita-file', 'test.ditamap'));
    assert.ok(Array.isArray(manifest));
    assert.ok(manifest.length > 0);
    // All entries should have .html extension
    for (const entry of manifest) {
      assert.ok(entry.file.endsWith('.html'), entry.file + ' should end with .html');
      assert.ok(typeof entry.title === 'string');
    }
    // Should include the three topic pages
    const files = manifest.map(e => e.file);
    assert.ok(files.includes('db_overview.html'));
    assert.ok(files.includes('db_config.html'));
    assert.ok(files.includes('db_ui_test.html'));
  });

  it('should skip ditamap references', () => {
    const manifest = buildNavManifest(join(__dirname, '..', '..', '..', 'test-dita-file', 'test.ditamap'));
    // keys.ditamap is referenced with format="ditamap", should not appear
    for (const entry of manifest) {
      assert.ok(!entry.file.endsWith('.ditamap'), 'should not contain ditamap entries');
      assert.ok(!entry.file.includes('keys.ditamap'));
    }
  });
});

describe('classifyLogLine', () => {
  it('should classify [ERROR] lines as error', () => {
    assert.strictEqual(classifyLogLine('[ERROR] Something failed'), 'error');
  });

  it('should classify [WARN] lines as warn', () => {
    assert.strictEqual(classifyLogLine(' [WARN]  Some warning'), 'warn');
  });

  it('should classify lines with [INFO] as info', () => {
    assert.strictEqual(classifyLogLine('[INFO] Processing file...'), 'info');
  });

  it('should classify plain lines as info', () => {
    assert.strictEqual(classifyLogLine('  Build ended at 12:00'), 'info');
  });

  it('should classify empty string as info', () => {
    assert.strictEqual(classifyLogLine(''), 'info');
  });

  it('should classify [error] (lowercase) as error', () => {
    assert.strictEqual(classifyLogLine('[error] time limit exceeded'), 'error');
  });

  it('should classify lines with leading text before [ERROR]', () => {
    assert.strictEqual(classifyLogLine('   [ERROR]  fatal'), 'error');
  });
});

describe('createLineBuffer', () => {
  it('should return complete lines from a single chunk', () => {
    const buf = createLineBuffer();
    const lines = buf.processChunk('line1\nline2\nline3\n');
    assert.deepStrictEqual(lines, ['line1', 'line2', 'line3']);
    assert.deepStrictEqual(buf.flush(), []);
  });

  it('should buffer partial line across chunks', () => {
    const buf = createLineBuffer();
    // First chunk: partial line (no trailing newline)
    const chunk1 = buf.processChunk('Some normal log output...\n[ERR');
    assert.deepStrictEqual(chunk1, ['Some normal log output...']);

    // Second chunk: completes the line + more
    const chunk2 = buf.processChunk('OR] Something failed badly\nmore output\n');
    assert.deepStrictEqual(chunk2, ['[ERROR] Something failed badly', 'more output']);

    // No remaining buffer
    assert.deepStrictEqual(buf.flush(), []);
  });

  it('should detect [ERROR] across chunk boundary', () => {
    const buf = createLineBuffer();
    buf.processChunk('[ERR'); // partial - no lines yielded
    const lines = buf.processChunk('OR] fail\n');
    // Now we have a complete line
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(classifyLogLine(lines[0]), 'error');
  });

  it('should return empty array for empty chunk', () => {
    const buf = createLineBuffer();
    assert.deepStrictEqual(buf.processChunk(''), []);
  });

  it('should handle chunk ending with newline', () => {
    const buf = createLineBuffer();
    const lines = buf.processChunk('a\nb\n');
    assert.deepStrictEqual(lines, ['a', 'b']);
    assert.deepStrictEqual(buf.flush(), []);
  });

  it('should flush remaining partial line', () => {
    const buf = createLineBuffer();
    buf.processChunk('partial line without newline');
    assert.deepStrictEqual(buf.flush(), ['partial line without newline']);
    // Second flush should be empty
    assert.deepStrictEqual(buf.flush(), []);
  });

  it('should accumulate multiple partial chunks before newline', () => {
    const buf = createLineBuffer();
    buf.processChunk('hel');
    buf.processChunk('lo ');
    buf.processChunk('wor');
    const lines = buf.processChunk('ld\n');
    assert.deepStrictEqual(lines, ['hello world']);
    assert.deepStrictEqual(buf.flush(), []);
  });
});
