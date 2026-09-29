import * as assert from 'assert';
import { decideMapFollow } from '../../language/mapTreeFollow';

describe('decideMapFollow', () => {
  const inSame = { inWorkspaceFolder: true, sameFolderAsCurrentMap: true };
  const inOther = { inWorkspaceFolder: true, sameFolderAsCurrentMap: false };
  const outside = { inWorkspaceFolder: false, sameFolderAsCurrentMap: false };

  it('follows a .ditamap even inside the current map\'s own folder', () => {
    assert.strictEqual(decideMapFollow('/w/book/sub.ditamap', inSame), 'map');
  });

  it('follows a .ditamap into a different workspace folder', () => {
    assert.strictEqual(decideMapFollow('/w/other/main.ditamap', inOther), 'map');
  });

  it('matches the extension case-insensitively', () => {
    assert.strictEqual(decideMapFollow('/w/book/Main.DITAMAP', inSame), 'map');
  });

  it('does not switch for a topic inside the current map\'s folder', () => {
    assert.strictEqual(decideMapFollow('/w/book/topics/a.dita', inSame), 'ignore');
  });

  it('looks up an owning map for a topic in a different workspace folder', () => {
    assert.strictEqual(decideMapFollow('/w/other/topics/a.dita', inOther), 'topic-owner');
  });

  it('ignores files outside every workspace folder, maps included', () => {
    assert.strictEqual(decideMapFollow('/x/main.ditamap', outside), 'ignore');
    assert.strictEqual(decideMapFollow('/x/a.dita', outside), 'ignore');
  });

  it('ignores unrelated file types', () => {
    assert.strictEqual(decideMapFollow('/w/book/readme.md', inOther), 'ignore');
    assert.strictEqual(decideMapFollow('/w/book/a.xml', inOther), 'ignore');
  });
});
