import * as assert from 'assert';
import { buildContextPickItems, contextStatusText } from '../../editor/keyContextPicker';

const rel = (p: string) => p.replace('/ws/', '');

describe('buildContextPickItems', () => {
  it('puts the "no context" entry first, then the maps sorted by file name, then by path', () => {
    const items = buildContextPickItems(['/ws/z/brandB.ditamap', '/ws/a/brandB.ditamap', '/ws/all.ditamap'], undefined, 'None', rel);
    assert.deepStrictEqual(
      items.map((i) => i.path),
      [undefined, '/ws/all.ditamap', '/ws/a/brandB.ditamap', '/ws/z/brandB.ditamap'],
    );
    assert.strictEqual(items[0].label.endsWith('None'), true);
  });

  it('shows the workspace-relative path so two maps with one file name can be told apart', () => {
    const items = buildContextPickItems(['/ws/a/brand.ditamap', '/ws/b/brand.ditamap'], undefined, 'None', rel);
    assert.deepStrictEqual(items.slice(1).map((i) => i.description), ['a/brand.ditamap', 'b/brand.ditamap']);
  });

  it('marks the current context, and the "no context" entry when none is set', () => {
    const withCtx = buildContextPickItems(['/ws/a.ditamap', '/ws/b.ditamap'], '/ws/b.ditamap', 'None', rel);
    assert.deepStrictEqual(withCtx.map((i) => i.label.startsWith('$(check)')), [false, false, true]);
    const without = buildContextPickItems(['/ws/a.ditamap'], undefined, 'None', rel);
    assert.deepStrictEqual(without.map((i) => i.label.startsWith('$(check)')), [true, false]);
  });

  it('still lists a current context that is not among the found maps', () => {
    const items = buildContextPickItems(['/ws/a.ditamap'], '/elsewhere/ctx.ditamap', 'None', rel);
    assert.ok(items.some((i) => i.path === '/elsewhere/ctx.ditamap' && i.label.startsWith('$(check)')));
  });

  it('lists a map once even when it is found and current', () => {
    const items = buildContextPickItems(['/ws/a.ditamap', '/ws/a.ditamap'], '/ws/a.ditamap', 'None', rel);
    assert.strictEqual(items.filter((i) => i.path === '/ws/a.ditamap').length, 1);
  });
});

describe('contextStatusText', () => {
  it('shows the context map file name', () => {
    assert.strictEqual(contextStatusText('/ws/a/brandB.ditamap', 'auto'), '$(key) brandB.ditamap');
  });

  it('shows the auto label when no context is set', () => {
    assert.strictEqual(contextStatusText(undefined, 'Keys: auto'), '$(key) Keys: auto');
  });
});
