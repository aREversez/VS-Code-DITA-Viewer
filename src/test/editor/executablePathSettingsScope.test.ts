import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * `ditaOtPath` and `oxygenPath` name programs the extension spawns. A setting
 * with no `scope` can be set from a workspace's .vscode/settings.json, so a
 * cloned repository could point it at its own binary and have it run when the
 * user clicks Transform or Open in Oxygen. `machine` scope makes VS Code read
 * it from user/remote settings only.
 */

const repoRoot = join(__dirname, '..', '..', '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const props = pkg.contributes.configuration.properties as Record<string, { scope?: string }>;

describe('settings that name an executable', () => {
  for (const key of ['dita-viewer.ditaOtPath', 'dita-viewer.oxygenPath']) {
    it(`${key} is machine-scoped so a workspace cannot set it`, () => {
      assert.ok(props[key], `${key} must be contributed`);
      assert.strictEqual(props[key].scope, 'machine');
    });
  }
});
