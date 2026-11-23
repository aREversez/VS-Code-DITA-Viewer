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

  it('accepts a UNC root', () => {
    assert.strictEqual(windowsSystemExe('reg.exe', { SystemRoot: '\\\\host\\share\\Windows' }), '\\\\host\\share\\Windows\\System32\\reg.exe');
  });

  it('keeps the bare name for a missing, empty or cwd-relative root, never joining one', () => {
    for (const env of [undefined, {}, { SystemRoot: '' }, { SystemRoot: '.' }, { SystemRoot: 'Windows' }, { SystemRoot: '..\\Windows' }, { SystemRoot: 'C:Windows' }, { SystemRoot: '\\Windows' }]) {
      assert.strictEqual(windowsSystemExe('reg.exe', env), 'reg.exe', JSON.stringify(env));
    }
  });
});
