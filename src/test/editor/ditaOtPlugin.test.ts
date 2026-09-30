import * as assert from 'assert';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
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
});
