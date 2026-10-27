import * as assert from 'assert';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { discoverTemplateRoots } from '../../editor/siteTemplates';

// Smoke-test defect 3: a templatesDirectory entry that does not resolve to a
// folder was dropped without a word, so "the setting is ignored" and "the
// path is wrong" looked identical. The caller can now be told which entries
// were dropped and where they were looked for.

describe('discoverTemplateRoots: entries that resolve to nothing', () => {
  let base: string;
  beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'tplroots-')); });
  afterEach(() => { rmSync(base, { recursive: true, force: true }); });

  const common = () => ({ extensionPath: join(base, 'ext'), refDir: join(base, 'docs'), workspaceRoots: [join(base, 'ws1'), join(base, 'ws2')] });

  it('reports a relative entry with every place it was tried, document folder first', () => {
    const missing: Array<[string, string[]]> = [];
    const roots = discoverTemplateRoots({ ...common(), configuredDirs: ['t/x'], onMissing: (d, tried) => missing.push([d, tried]) });
    assert.strictEqual(roots.length, 1, 'only the built-in root');
    assert.deepStrictEqual(missing, [['t/x', [join(base, 'docs', 't', 'x'), join(base, 'ws1', 't', 'x'), join(base, 'ws2', 't', 'x')]]]);
  });

  it('reports an absolute entry with just that path', () => {
    const abs = join(base, 'nowhere');
    const missing: string[][] = [];
    discoverTemplateRoots({ ...common(), configuredDirs: [abs], onMissing: (_d, tried) => missing.push(tried) });
    assert.deepStrictEqual(missing, [[abs]]);
  });

  it('stays quiet for an entry that resolves, in any of the places', () => {
    mkdirSync(join(base, 'ws2', 't'), { recursive: true });
    const missing: string[] = [];
    const roots = discoverTemplateRoots({ ...common(), configuredDirs: ['t'], onMissing: (d) => missing.push(d) });
    assert.deepStrictEqual(missing, []);
    assert.strictEqual(roots[1].dir, join(base, 'ws2', 't'));
  });

  it('reports each missing entry and still returns the ones that exist', () => {
    mkdirSync(join(base, 'docs', 'ok'), { recursive: true });
    const missing: string[] = [];
    const roots = discoverTemplateRoots({ ...common(), configuredDirs: ['gone', 'ok', 'also-gone'], onMissing: (d) => missing.push(d) });
    assert.deepStrictEqual(missing, ['gone', 'also-gone']);
    assert.deepStrictEqual(roots.map((r) => r.builtin), [true, false]);
  });

  it('works without a callback, as before', () => {
    assert.doesNotThrow(() => discoverTemplateRoots({ ...common(), configuredDirs: ['t/x'] }));
  });
});
