import * as assert from 'assert';
import * as path from 'path';
import * as fsp from 'fs/promises';
import * as vscode from 'vscode';

const EXTENSION_ID = 'dita-viewer.dita-viewer';

// dist/test/rename.test.js -> repo root is two levels up.
const repoRoot = path.resolve(__dirname, '..', '..');
// Lives inside the workspace folder (test-dita-file) so the participant's real
// `vscode.workspace.findFiles` sees it, exactly as it does at runtime.
const e2eDir = path.join(repoRoot, 'test-dita-file', '__rename-e2e');

type RenameResult = { sourcePath: string; path: string; newText: string };

function computeRenameEdits(
  renames: Array<{ oldPath: string; newPath: string }>,
): Promise<RenameResult[]> {
  const api = vscode.extensions.getExtension(EXTENSION_ID)!.exports as {
    _test: { computeRenameEdits: (r: Array<{ oldPath: string; newPath: string }>) => Promise<RenameResult[]> };
  };
  return api._test.computeRenameEdits(renames);
}

const abs = (...rel: string[]) => path.join(e2eDir, ...rel);

/** Result whose (pre-rename) source path is `rel`, relative to the scratch dir. */
function bySource(results: RenameResult[], rel: string): RenameResult | undefined {
  const want = abs(rel);
  return results.find((r) => path.normalize(r.sourcePath) === path.normalize(want));
}
/** Results whose source path sits at or under `rel`. */
function anyUnder(results: RenameResult[], rel: string): RenameResult[] {
  const want = path.normalize(abs(rel));
  return results.filter((r) => {
    const p = path.normalize(r.sourcePath);
    return p === want || p.startsWith(want + path.sep);
  });
}

async function write(rel: string, content: string): Promise<void> {
  const full = abs(rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, content);
}

/**
 * Rename reference updates, driven through the participant's real code path.
 *
 * What can and cannot be exercised headlessly here (established empirically
 * against VS Code 1.140):
 *   - `workspace.fs.rename` does NOT fire `onWillRenameFiles` at all (it routes
 *     through the file service, not the working-copy service).
 *   - `workspace.applyEdit` with a `renameFile` DOES fire the event, but VS Code
 *     discards the participant's returned edits -- they are only honoured for a
 *     user-initiated Explorer rename.
 * So "VS Code applies the edit and then moves the file, grouped in one undo
 * step" cannot be automated from the extension API and is left to manual Dev
 * Host testing. What this suite *does* cover is every decision the participant
 * makes -- candidate gathering over the real `findFiles` (incl. the nested
 * node_modules exclusion and BOM-stripped disk reads), `mayReferenceRenamed`,
 * and `computeRefEdits` -- by returning each affected file's post-edit content.
 */
describe('rename reference updates', () => {
  before(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    await ext?.activate();

    // Retries ride out a lock a previous run's host may still hold on this folder.
    await fsp.rm(e2eDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    await write('map.ditamap', '<map>\n  <topicref href="a/t1.dita"/>\n  <topicref href="b/t2.dita"/>\n  <topicref href="b/new%20x.dita"/>\n</map>\n');
    await write(path.join('a', 't1.dita'), '<topic id="t1"><title>t1</title><body><p><xref href="../b/t2.dita"/> <xref href="../outside.dita"/></p></body></topic>\n');
    await write(path.join('b', 't2.dita'), '<topic id="t2"><title>t2</title></topic>\n');
    await write(path.join('b', 'new x.dita'), '<topic id="x"><title>x</title></topic>\n');
    await write('outside.dita', '<topic id="o"><title>o</title></topic>\n');
    await write(path.join('node_modules', 'pkg', 'm.ditamap'), '<map><topicref href="../../b/t2.dita"/></map>\n');
    // Leading UTF-8 BOM before a first-line reference (case 8).
    await write('bom.ditamap', '\uFEFF<map><topicref href="b/t2.dita"/></map>\n');
    // findFiles is backed by the search service, which indexes the workspace
    // asynchronously; freshly written files are not always visible on the very
    // first query. Poll until every scratch file the suite depends on shows up
    // so no test races the indexer (otherwise, e.g., the percent-encoding test
    // intermittently sees no reference to rewrite).
    const expected = 6; // map, a/t1, b/t2, b/new x, outside, bom (node_modules excluded)
    const deadline = Date.now() + 15000;
    for (;;) {
      const found = await vscode.workspace.findFiles('**/*.{dita,ditamap}', '**/{node_modules,.git}/**');
      const ours = found.filter((u) => path.normalize(u.fsPath).startsWith(path.normalize(e2eDir)));
      if (ours.length >= expected || Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  });

  after(async () => {
    await fsp.rm(e2eDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it('updates referencing files and skips nested node_modules on a file rename (cases 1/7)', async () => {
    const results = await computeRenameEdits([{ oldPath: abs('b', 't2.dita'), newPath: abs('b', 't2x.dita') }]);

    const map = bySource(results, 'map.ditamap');
    assert.ok(map, 'expected map.ditamap to be updated');
    assert.match(map!.newText, /href="b\/t2x\.dita"/);
    assert.match(map!.newText, /href="b\/new%20x\.dita"/, 'unrelated reference must stay untouched');
    assert.match(map!.newText, /href="a\/t1\.dita"/, 'unrelated reference must stay untouched');

    const t1 = bySource(results, path.join('a', 't1.dita'));
    assert.ok(t1, 'expected a/t1.dita outbound reference to be updated');
    assert.match(t1!.newText, /href="..\/b\/t2x\.dita"/);
    assert.match(t1!.newText, /href="..\/outside\.dita"/, 'reference to a file that did not move stays');

    assert.equal(anyUnder(results, path.join('node_modules')).length, 0, 'nested node_modules must be excluded');
  });

  it('strips the BOM so a first-line reference is replaced without offset drift (case 8)', async () => {
    // Guard that the fixture really carries a BOM, so this exercises stripping
    // rather than passing vacuously on plain text.
    const raw = await fsp.readFile(abs('bom.ditamap'), 'utf8');
    assert.strictEqual(raw.charCodeAt(0), 0xfeff, 'fixture must start with a BOM for this test to be meaningful');

    const results = await computeRenameEdits([{ oldPath: abs('b', 't2.dita'), newPath: abs('b', 't2x.dita') }]);

    const bom = bySource(results, 'bom.ditamap');
    assert.ok(bom, 'expected bom.ditamap to be updated');
    assert.strictEqual(bom!.newText.charCodeAt(0), '<'.charCodeAt(0), 'BOM must be stripped so offsets align');
    assert.match(bom!.newText, /^<map><topicref href="b\/t2x\.dita"\/><\/map>/);
  });

  it('rewrites a moved file\'s own outbound references against its old path (case 3)', async () => {
    const results = await computeRenameEdits([{ oldPath: abs('a', 't1.dita'), newPath: abs('t1.dita') }]);

    const t1 = bySource(results, path.join('a', 't1.dita'));
    assert.ok(t1, 'expected the moved file to be its own edit target (sourcePath = pre-move location)');
    assert.strictEqual(path.normalize(t1!.path), path.normalize(abs('t1.dita')), 'reported location is the destination');
    assert.match(t1!.newText, /href="b\/t2\.dita"/, '../b/t2.dita rebases to b/t2.dita from the root');
    assert.match(t1!.newText, /href="outside\.dita"/, '../outside.dita rebases to outside.dita from the root');

    const map = bySource(results, 'map.ditamap');
    assert.ok(map, 'expected map.ditamap to point at the new location');
    assert.match(map!.newText, /href="t1\.dita"/);
  });

  it('renames a folder via prefix match, leaving a moved file\'s unchanged relative refs alone (case 4a)', async () => {
    const results = await computeRenameEdits([{ oldPath: abs('a'), newPath: abs('a2') }]);

    const map = bySource(results, 'map.ditamap');
    assert.ok(map, 'expected map.ditamap to reflect the folder rename');
    assert.match(map!.newText, /href="a2\/t1\.dita"/);

    // a/t1.dita moved with the folder but its ../ refs still resolve identically
    // from a2/, so it must not be reported as changed.
    assert.equal(anyUnder(results, path.join('a')).length, 0, 'folder rename that keeps relative depth must not edit the contained topic');
  });

  it('rebases a folder\'s contents when it is moved into a sibling (case 4b)', async () => {
    const results = await computeRenameEdits([{ oldPath: abs('a'), newPath: abs('b', 'a') }]);

    const t1 = bySource(results, path.join('a', 't1.dita'));
    assert.ok(t1, 'expected the moved folder\'s topic to have its outbound refs rebased');
    assert.strictEqual(path.normalize(t1!.path), path.normalize(abs('b', 'a', 't1.dita')));
    assert.match(t1!.newText, /href="..\/t2\.dita"/, '../b/t2.dita -> ../t2.dita from b/a');
    assert.match(t1!.newText, /href="..\/..\/outside\.dita"/, '../outside.dita -> ../../outside.dita from b/a');

    const map = bySource(results, 'map.ditamap');
    assert.ok(map, 'expected map.ditamap to point into the moved folder');
    assert.match(map!.newText, /href="b\/a\/t1\.dita"/);
  });

  it('percent-encodes a renamed file name as UTF-8, not UTF-16 units (case 6)', async () => {
    const results = await computeRenameEdits([{ oldPath: abs('b', 'new x.dita'), newPath: abs('b', '新 x.dita') }]);

    const map = bySource(results, 'map.ditamap');
    assert.ok(map, 'expected map.ditamap to update the percent-encoded reference');
    assert.match(map!.newText, /href="b\/%E6%96%B0%20x\.dita"/, '新 must be UTF-8 %E6%96%B0 and the space stays %20');
    assert.doesNotMatch(map!.newText, /%65B0|%4E2D/, 'must not emit per-UTF-16-unit hex');
  });
});
