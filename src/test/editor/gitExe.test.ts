import * as assert from 'assert';
import { resolveGitExe } from '../../editor/gitExe';

describe('resolveGitExe', () => {
  it('keeps the bare name off Windows', () => {
    assert.strictEqual(resolveGitExe('linux', { PATH: '/usr/bin' }, () => false), 'git');
    assert.strictEqual(resolveGitExe('darwin', {}, () => false), 'git');
  });

  it('finds git.exe in an absolute PATH entry, in PATH order', () => {
    const present = new Set(['C:\\tools\\git.exe', 'D:\\git\\cmd\\git.exe']);
    const got = resolveGitExe('win32', { Path: 'C:\\tools;D:\\git\\cmd' }, (p) => present.has(p));
    assert.strictEqual(got, 'C:\\tools\\git.exe');
  });

  // The hazard: "." / "" / a relative entry resolve against the working
  // directory, which here is the repository being compared.
  it('never returns a relative candidate, even when one "exists"', () => {
    const seen: string[] = [];
    const got = resolveGitExe('win32', { Path: '.;;tools;C:Windows;\\x' }, (p) => {
      seen.push(p);
      return true;
    });
    assert.strictEqual(got, undefined);
    assert.deepStrictEqual(seen, []);
  });

  it('falls back to the stock install folders', () => {
    const want = 'C:\\Program Files\\Git\\cmd\\git.exe';
    const got = resolveGitExe('win32', { ProgramFiles: 'C:\\Program Files' }, (p) => p === want);
    assert.strictEqual(got, want);
  });

  it('strips quotes around a PATH entry', () => {
    const got = resolveGitExe('win32', { PATH: '"C:\\Program Files\\Git\\cmd"' }, (p) => p === 'C:\\Program Files\\Git\\cmd\\git.exe');
    assert.strictEqual(got, 'C:\\Program Files\\Git\\cmd\\git.exe');
  });

  it('is undefined when nothing is found', () => {
    assert.strictEqual(resolveGitExe('win32', { Path: 'C:\\a' }, () => false), undefined);
  });
});
