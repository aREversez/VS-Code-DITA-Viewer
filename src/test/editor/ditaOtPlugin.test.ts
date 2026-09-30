import * as assert from 'assert';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  BACKUP_DIR_NAME,
  backupIntegratorFiles,
  CJK_SPACING_PLUGIN_ID,
  getPluginStatus,
  installPlugin,
  readPluginVersion,
} from '../../editor/ditaOtPlugin';

const xml = (v: string) => `<?xml version="1.0"?><plugin id="${CJK_SPACING_PLUGIN_ID}" version="${v}"><require plugin="x" version="9"/></plugin>`;

describe('ditaOtPlugin', () => {
  let root: string;
  let bundled: string;
  let ot: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dv-plugin-'));
    bundled = join(root, 'bundled');
    ot = join(root, 'ot');
    mkdirSync(bundled, { recursive: true });
    mkdirSync(join(ot, 'plugins'), { recursive: true });
    writeFileSync(join(bundled, 'plugin.xml'), xml('1.0.0'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('reads the version from the plugin element, not nested elements', () => {
    assert.strictEqual(readPluginVersion(xml('2.3.4')), '2.3.4');
    assert.strictEqual(readPluginVersion('<plugin id="a"/>'), undefined);
  });

  it('reports missing, outdated and installed', async () => {
    assert.strictEqual(getPluginStatus(ot, bundled), 'missing');
    const dir = join(ot, 'plugins', CJK_SPACING_PLUGIN_ID);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'plugin.xml'), xml('0.9.0'));
    assert.strictEqual(getPluginStatus(ot, bundled), 'outdated');
    writeFileSync(join(dir, 'plugin.xml'), xml('1.0.0'));
    assert.strictEqual(getPluginStatus(ot, bundled), 'installed');
  });

  it('copies the bundle, replacing a stale copy, then integrates', async () => {
    const dir = join(ot, 'plugins', CJK_SPACING_PLUGIN_ID);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'stale.txt'), 'x');
    let integrated = false;
    await installPlugin(ot, bundled, async () => {
      integrated = existsSync(join(dir, 'plugin.xml'));
    });
    assert.ok(integrated, 'integration runs after the copy');
    assert.ok(!existsSync(join(dir, 'stale.txt')));
    assert.strictEqual(getPluginStatus(ot, bundled), 'installed');
  });

  it('backs up the integrator-rewritten files before touching anything', async () => {
    const base = join(ot, 'plugins', 'org.dita.base');
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'build.xml'), 'ORIGINAL');
    let seenAtIntegrate = '';
    const backup = await installPlugin(ot, bundled, async () => {
      // simulate the integrator rewriting the file
      writeFileSync(join(base, 'build.xml'), 'REWRITTEN');
      seenAtIntegrate = 'ran';
    });
    assert.strictEqual(seenAtIntegrate, 'ran');
    assert.strictEqual(readFileSync(join(backup, 'plugins/org.dita.base/build.xml'), 'utf-8'), 'ORIGINAL');
    assert.ok(backup.includes(BACKUP_DIR_NAME));
  });

  it('skips files that do not exist and keeps every earlier backup', () => {
    const first = backupIntegratorFiles(ot, new Date(2026, 8, 30, 8, 0, 0));
    const second = backupIntegratorFiles(ot, new Date(2026, 8, 30, 8, 0, 0));
    assert.notStrictEqual(first, second, 'same-second backups do not collide');
    assert.ok(existsSync(first) && existsSync(second));
    assert.ok(first.endsWith('20260930-080000'));
  });

  it('does not modify the installation when the backup fails', async () => {
    // A file where the backup folder must go makes the backup throw.
    writeFileSync(join(ot, BACKUP_DIR_NAME), 'blocker');
    let integrated = false;
    await assert.rejects(installPlugin(ot, bundled, async () => { integrated = true; }));
    assert.ok(!integrated);
    assert.ok(!existsSync(join(ot, 'plugins', CJK_SPACING_PLUGIN_ID)));
  });
});
