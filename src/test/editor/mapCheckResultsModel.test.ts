import * as assert from 'assert';
import { resolve } from 'path';
import { groupByFolder } from '../../editor/mapCheckResultsModel';

const P = (p: string) => resolve('/proj', p);

describe('groupByFolder', () => {
  it('groups by folder, labelled relative to the searched folder, sorted by name', () => {
    const groups = groupByFolder([P('img/b.png'), P('img/a.png'), P('img/sub/c.png'), P('root.txt')], [P('.')]);
    assert.deepStrictEqual(
      groups.map((g) => [g.label, g.files.map((f) => f.replace(/.*\/proj\//, ''))]),
      [
        ['img', ['img/a.png', 'img/b.png']],
        ['img/sub', ['img/sub/c.png']],
        ['proj', ['root.txt']],
      ],
    );
  });

  it('labels against the deepest searched folder when searches overlap', () => {
    const groups = groupByFolder([P('img/sub/c.png')], [P('.'), P('img')]);
    assert.strictEqual(groups[0].label, 'sub');
  });

  it('no files, no groups', () => {
    assert.deepStrictEqual(groupByFolder([], [P('.')]), []);
  });
});
