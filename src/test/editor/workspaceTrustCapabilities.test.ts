import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The extension spawns DITA-OT and Oxygen, and runs `git` through
 * execFile (extension.ts, ditaGitUtils.ts). Until it declares
 * `capabilities.untrustedWorkspaces`, VS Code treats every workspace —
 * including a freshly cloned repository — as fully trusted and none of
 * that is restricted. These assertions pin the declaration itself (the
 * declaration IS the data; plain mocha has no vscode).
 *
 * `restrictedConfigurations` is deliberately empty: `ditaOtPath` and
 * `oxygenPath` are machine-scoped already (executablePathSettingsScope
 * .test.ts), and `cssDirectory` / `templatesDirectory` / `customCss`
 * only feed file reads — no execution — so restricting them would hide
 * working features for no security gain. The execution entry points
 * themselves are gated on `workspace.isTrusted` instead
 * (workspaceTrust.ts).
 */

const repoRoot = join(__dirname, '..', '..', '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const nlsEn = JSON.parse(readFileSync(join(repoRoot, 'package.nls.json'), 'utf8'));
const nlsZh = JSON.parse(readFileSync(join(repoRoot, 'package.nls.zh-cn.json'), 'utf8'));

const capabilities = pkg.capabilities as
  | {
      untrustedWorkspaces?: {
        supported?: string | boolean;
        description?: string;
        restrictedConfigurations?: string[];
      };
      virtualWorkspaces?: { supported?: string | boolean; description?: string };
    }
  | undefined;

describe('workspace trust capabilities', () => {
  it('declares untrustedWorkspaces as limited (the extension still works, minus execution)', () => {
    assert.ok(capabilities?.untrustedWorkspaces, 'capabilities.untrustedWorkspaces must be declared');
    assert.strictEqual(capabilities.untrustedWorkspaces.supported, 'limited');
  });

  it('ships the untrustedWorkspaces description as an nls key in en and zh-cn', () => {
    const key = String(capabilities?.untrustedWorkspaces?.description).replace(/^%|%$/g, '');
    assert.ok(key && key !== 'undefined', 'description must reference an nls key');
    assert.ok(nlsEn[key], `package.nls.json is missing ${key}`);
    assert.ok(nlsZh[key], `package.nls.zh-cn.json is missing ${key}`);
  });

  it('restricts no configurations — path settings read files, executables are machine-scoped', () => {
    assert.deepStrictEqual(capabilities?.untrustedWorkspaces?.restrictedConfigurations ?? [], []);
  });

  it('declares virtualWorkspaces as unsupported — the renderer reads through node fs', () => {
    assert.ok(capabilities?.virtualWorkspaces, 'capabilities.virtualWorkspaces must be declared');
    assert.strictEqual(capabilities.virtualWorkspaces.supported, false);
  });

  it('ships the virtualWorkspaces description as an nls key in en and zh-cn', () => {
    const key = String(capabilities?.virtualWorkspaces?.description).replace(/^%|%$/g, '');
    assert.ok(key && key !== 'undefined', 'description must reference an nls key');
    assert.ok(nlsEn[key], `package.nls.json is missing ${key}`);
    assert.ok(nlsZh[key], `package.nls.zh-cn.json is missing ${key}`);
  });
});
