import * as assert from 'assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { collectDitamapFilesUpward } from '../../editor/ditaRenderUtils';

// collectDitamapFilesUpward is the vscode-free core of findDitamapFiles
// (src/editor/keyMap.ts) -- the ancestor-directory walk buildKeyMap uses to
// find the ditamap(s) that define a topic's keys. Regression target: a
// maps/ folder kept as a sibling of topics/ (see test-dita-file/manual, and
// the "Key ... is not defined" false positive it triggered for a keydef
// that really was in scope) used to be invisible to this scan.
describe('collectDitamapFilesUpward', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'keymap-test-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('finds a .ditamap sitting directly in an ancestor directory (pre-existing behavior)', () => {
    writeFileSync(join(root, 'main.ditamap'), '<map/>');
    const topics = join(root, 'topics');
    mkdirSync(topics);

    const found = collectDitamapFilesUpward(topics, root, false);

    assert.deepStrictEqual(found, [join(root, 'main.ditamap')]);
  });

  it('finds a .ditamap kept in a maps/ folder that is a *sibling* of topics/, not an ancestor', () => {
    // The shape this discovery has to handle: a manual/{maps/main.ditamap,
    // topics/about_manual.dita} layout — starting the walk from topics/,
    // main.ditamap is one directory *below* the ancestor level (manual/) being
    // scanned, not inside it directly.
    const maps = join(root, 'manual', 'maps');
    const topics = join(root, 'manual', 'topics');
    mkdirSync(maps, { recursive: true });
    mkdirSync(topics, { recursive: true });
    writeFileSync(join(maps, 'main.ditamap'), '<map/>');

    const found = collectDitamapFilesUpward(topics, root, false);

    assert.deepStrictEqual(
      found,
      [join(maps, 'main.ditamap')],
      'a direct-children-only scan at each ancestor level misses maps/ entirely, ' +
        'which is exactly the bug that made a real, in-scope keydef read as undefined',
    );
  });

  it('does not let an unrelated .ditamap several levels up mask a sibling maps/ folder closer to the topic', () => {
    // Mirrors the actual false-positive: an unrelated ditamap directly in a
    // further-up ancestor used to be the only thing found, silently hiding
    // the real, closer map instead of raising "map not found" loudly.
    writeFileSync(join(root, 'unrelated.ditamap'), '<map/>');
    const maps = join(root, 'manual', 'maps');
    const topics = join(root, 'manual', 'topics');
    mkdirSync(maps, { recursive: true });
    mkdirSync(topics, { recursive: true });
    writeFileSync(join(maps, 'main.ditamap'), '<map/>');

    const found = collectDitamapFilesUpward(topics, root, false);

    assert.ok(
      found.includes(join(maps, 'main.ditamap')),
      `expected the closer manual/maps/main.ditamap among: ${found.join(', ')}`,
    );
  });

  it('stopAtFirstMatch still stops at the first ancestor level with any match, subtree-included', () => {
    const maps = join(root, 'manual', 'maps');
    const topics = join(root, 'manual', 'topics');
    mkdirSync(maps, { recursive: true });
    mkdirSync(topics, { recursive: true });
    writeFileSync(join(maps, 'main.ditamap'), '<map/>');
    // Would also match if the walk kept going past manual/ -- shouldn't be reached.
    writeFileSync(join(root, 'other.ditamap'), '<map/>');

    const found = collectDitamapFilesUpward(topics, root, true);

    assert.deepStrictEqual(found, [join(maps, 'main.ditamap')]);
  });

  it('does not report the same .ditamap twice when a further-up ancestor level\'s subtree scan re-covers a directory a closer level already scanned', () => {
    const maps = join(root, 'a', 'b', 'maps');
    const topics = join(root, 'a', 'b', 'topics');
    mkdirSync(maps, { recursive: true });
    mkdirSync(topics, { recursive: true });
    writeFileSync(join(maps, 'main.ditamap'), '<map/>');

    // stopAtFirstMatch=false forces the walk past 'a/b' (where main.ditamap
    // is found) up through 'a' and root -- both of whose subtree scans
    // would re-descend into 'a/b/maps' unless already-scanned directories
    // are tracked.
    const found = collectDitamapFilesUpward(topics, root, false);

    assert.deepStrictEqual(found, [join(maps, 'main.ditamap')]);
  });

  it('returns an empty array when nothing is found up to root', () => {
    const topics = join(root, 'manual', 'topics');
    mkdirSync(topics, { recursive: true });

    assert.deepStrictEqual(collectDitamapFilesUpward(topics, root, false), []);
  });
});
