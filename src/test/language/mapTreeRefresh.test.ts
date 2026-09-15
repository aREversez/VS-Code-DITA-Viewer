import * as assert from 'assert';
import { join } from 'path';
import { shouldRefreshMapTree } from '../../language/mapTreeRefresh';
import type { DitaFileEventKind } from '../../editor/ditaFileWatcher';

/**
 * The reload policy for the Explorer's DITA map tree.
 *
 * Worth pinning down because both of its failure modes are invisible in a
 * single manual run: reloading too often looks like a working sidebar that
 * quietly drops the user's expansion state every time they save a topic, and
 * reloading too rarely looks like a working sidebar right up until a git
 * checkout rewrites the map on disk and the tree keeps showing the previous
 * branch's structure. Neither shows up in a screenshot.
 *
 * mapTreeRefresh.ts deliberately imports DitaFileEventKind as a type only, so
 * this file loads the policy without the vscode API present -- which plain
 * mocha does not have.
 */
describe('shouldRefreshMapTree', () => {
  const kinds: DitaFileEventKind[] = ['change', 'create', 'delete'];

  it('reloads for any event on a .ditamap, which is the tree\'s entire input', () => {
    for (const kind of kinds) {
      assert.strictEqual(
        shouldRefreshMapTree('/proj/test.ditamap', kind),
        true,
        `a map's structure, labels, keys and inlined sub-maps all come from this file, so ${kind} matters`,
      );
    }
  });

  it('reloads for a .ditamap anywhere under the watched folder, not just the map being shown', () => {
    // A keydef map in a sibling folder is reachable through the keys the shown
    // map resolves, so its rewrite can change labels too.
    assert.strictEqual(shouldRefreshMapTree('/proj/common/keys.ditamap', 'change'), true);
    assert.strictEqual(shouldRefreshMapTree('/proj/relative_test/book.ditamap', 'delete'), true);
  });

  it('reloads when a .dita appears or disappears, because that is what makes an entry clickable', () => {
    // getTreeItem only sets item.command when existsSync() resolves the href,
    // and that check runs during the reload.
    assert.strictEqual(shouldRefreshMapTree('/proj/topics/new.dita', 'create'), true);
    assert.strictEqual(shouldRefreshMapTree('/proj/topics/gone.dita', 'delete'), true);
  });

  it('does NOT reload when a .dita\'s contents change, since no label is read out of the topic', () => {
    // getDisplayName reads topicmeta/navtitle, linktext, shortdesc, a keyword,
    // then falls back to the href's filename and the keys attribute -- it never
    // opens the referenced topic. Reloading for an edit here would rebuild the
    // whole tree and collapse the user's expansion state for no visible gain.
    assert.strictEqual(shouldRefreshMapTree('/proj/topics/db_config.dita', 'change'), false);
  });

  it('ignores the rest of the watched glob, which only affects a rendered preview', () => {
    const unrelated = [
      '/proj/custom.css',
      '/proj/images/db_topology.png',
      '/proj/images/icon.svg',
      '/proj/images/photo.JPG',
      '/proj/media/clip.webp',
    ];
    for (const path of unrelated) {
      for (const kind of kinds) {
        assert.strictEqual(shouldRefreshMapTree(path, kind), false, `${path} (${kind})`);
      }
    }
  });

  it('matches the extension case-insensitively, as Windows and macOS filenames are', () => {
    assert.strictEqual(shouldRefreshMapTree('/proj/TEST.DITAMAP', 'change'), true);
    assert.strictEqual(shouldRefreshMapTree('/proj/Topics/New.Dita', 'create'), true);
    assert.strictEqual(shouldRefreshMapTree('/proj/Topics/Edited.DITA', 'change'), false);
  });

  it('matches on the file name only, so a directory named like a map does not turn its contents into map events', () => {
    // endsWith on the whole path is what makes this work. A check for the
    // substring '.ditamap' instead would reload for every css edit and every
    // topic save under such a directory -- the exact over-reloading this policy
    // exists to prevent.
    assert.strictEqual(shouldRefreshMapTree('/proj/backup.ditamap/site.css', 'change'), false);
    assert.strictEqual(shouldRefreshMapTree('/proj/backup.ditamap/topic.dita', 'change'), false);
    // ...while still treating that topic's creation as a topic creation.
    assert.strictEqual(shouldRefreshMapTree('/proj/backup.ditamap/topic.dita', 'create'), true);
  });

  it('handles native separators, since the watcher reports fsPath', () => {
    const abs = join('n:', 'AI', 'proj', 'topics', 'db_overview.dita');
    assert.strictEqual(shouldRefreshMapTree(abs, 'change'), false);
    assert.strictEqual(shouldRefreshMapTree(join('n:', 'AI', 'proj', 'test.ditamap'), 'change'), true);
  });
});
