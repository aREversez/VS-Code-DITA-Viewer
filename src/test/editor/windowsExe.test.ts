import * as assert from 'assert';
import { windowsSystemExe } from '../../editor/windowsExe';

describe('windowsSystemExe', () => {
  const full = 'C:\\Windows\\System32\\cmd.exe';

  it('joins System32 whether or not the root ends in a separator', () => {
    assert.strictEqual(windowsSystemExe('cmd.exe', { SystemRoot: 'C:\\Windows' }), full);
    assert.strictEqual(windowsSystemExe('cmd.exe', { SystemRoot: 'C:\\Windows\\' }), full);
  });

  it('normalizes a forward-slash root to backslashes', () => {
    assert.strictEqual(windowsSystemExe('cmd.exe', { SystemRoot: 'C:/Windows' }), full);
  });

  it('falls back to windir when SystemRoot is absent or empty', () => {
    assert.strictEqual(windowsSystemExe('cmd.exe', { windir: 'C:\\Windows' }), full);
    assert.strictEqual(windowsSystemExe('cmd.exe', { SystemRoot: '', windir: 'C:\\Windows' }), full);
  });

  it('falls back to an absolute windir when SystemRoot is present but not absolute', () => {
    assert.strictEqual(windowsSystemExe('cmd.exe', { SystemRoot: 'Windows', windir: 'C:\\Windows' }), full);
    assert.strictEqual(windowsSystemExe('cmd.exe', { SystemRoot: '.', windir: 'C:\\Windows' }), full);
  });

  it('defaults to the real environment, so an omitted env cannot opt out', () => {
    // Comparing with process.env proves nothing off Windows (both sides are the
    // bare name), so give process.env a SystemRoot of its own. windir names a
    // different root rather than going away, which also pins the precedence:
    // SystemRoot first, windir only when SystemRoot is not usable.
    const saved = { SystemRoot: process.env.SystemRoot, windir: process.env.windir };
    try {
      process.env.SystemRoot = 'D:\\Win';
      process.env.windir = 'E:\\Other';
      assert.strictEqual(windowsSystemExe('cmd.exe'), 'D:\\Win\\System32\\cmd.exe');
      assert.strictEqual(windowsSystemExe('cmd.exe', undefined), 'D:\\Win\\System32\\cmd.exe');
      delete process.env.SystemRoot;
      assert.strictEqual(windowsSystemExe('cmd.exe'), 'E:\\Other\\System32\\cmd.exe');
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it('accepts a UNC root', () => {
    assert.strictEqual(windowsSystemExe('reg.exe', { SystemRoot: '\\\\host\\share\\Windows' }), '\\\\host\\share\\Windows\\System32\\reg.exe');
  });

  it('keeps the bare name for an empty or cwd-relative root, never joining one', () => {
    for (const env of [{}, { SystemRoot: '' }, { SystemRoot: '.' }, { SystemRoot: 'Windows' }, { SystemRoot: '..\\Windows' }, { SystemRoot: 'C:Windows' }, { SystemRoot: 'C:' }, { SystemRoot: '\\Windows' }]) {
      assert.strictEqual(windowsSystemExe('reg.exe', env), 'reg.exe', JSON.stringify(env));
    }
  });
});
