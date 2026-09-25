import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The Explorer map tree's title-bar buttons and context menu, asserted on
 * package.json (the toolbar IS the data) and on the provider's source text
 * (ditaMapTreeProvider.ts imports the vscode module, which plain mocha
 * does not have -- same approach as mapToolbarOrder.test.ts).
 *
 * Worth pinning down because both failure modes are silent: Expand All and
 * Collapse All living in different ends of the bar (the native
 * collapse-all button renders in a fixed slot after every custom action)
 * reads as one missing button, not as two separated ones; and a
 * collapse-all that acts on the whole tree instead of the selection looks
 * correct right up until a large map is expanded by it.
 */

interface MenuEntry {
  command: string;
  group: string;
}

const repoRoot = join(__dirname, '..', '..', '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const providerSource = readFileSync(
  join(repoRoot, 'src', 'language', 'ditaMapTreeProvider.ts'),
  'utf8',
);

function viewTitleEntries(): MenuEntry[] {
  return pkg.contributes.menus['view/title']
    .filter((e: { group?: string }) => (e.group || '').startsWith('navigation'))
    .map((e: { command: string; group: string }) => ({ command: e.command, group: e.group }));
}

describe('map explorer toolbar', () => {
  it('keeps Expand All and Collapse All adjacent, right after Select Map', () => {
    const order = viewTitleEntries().map((e) => e.command);
    const expandIdx = order.indexOf('ditaViewer.mapExplorer.expandAll');
    const collapseIdx = order.indexOf('ditaViewer.mapExplorer.collapseAll');
    assert.ok(expandIdx >= 0, 'expandAll is on the title bar');
    assert.ok(collapseIdx >= 0, 'collapseAll is on the title bar');
    assert.strictEqual(collapseIdx, expandIdx + 1, 'the two buttons sit together');
    assert.strictEqual(order.indexOf('ditaViewer.mapExplorer.selectMap'), expandIdx - 1);
    // Nothing else is squeezed between Select Map and the expand/collapse pair
    assert.deepStrictEqual(order.slice(0, 3), [
      'ditaViewer.mapExplorer.selectMap',
      'ditaViewer.mapExplorer.expandAll',
      'ditaViewer.mapExplorer.collapseAll',
    ]);
  });

  it('registers both commands with their codicons', () => {
    const byCommand = new Map<string, { command: string; icon?: string }>(
      pkg.contributes.commands.map((c: { command: string; icon?: string }) => [c.command, c]),
    );
    assert.strictEqual(byCommand.get('ditaViewer.mapExplorer.expandAll')?.icon, '$(expand-all)');
    assert.strictEqual(byCommand.get('ditaViewer.mapExplorer.collapseAll')?.icon, '$(collapse-all)');
  });

  it('offers both on every row\'s context menu, expand before collapse', () => {
    const entries = pkg.contributes.menus['view/item/context'].filter(
      (e: { command: string }) =>
        e.command === 'ditaViewer.mapExplorer.expandAll' || e.command === 'ditaViewer.mapExplorer.collapseAll',
    );
    assert.deepStrictEqual(entries.map((e: { command: string }) => e.command), [
      'ditaViewer.mapExplorer.expandAll',
      'ditaViewer.mapExplorer.collapseAll',
    ]);
  });

  it('hides both from the command palette, like the tree\'s other commands', () => {
    const palette = pkg.contributes.menus.commandPalette;
    for (const command of ['ditaViewer.mapExplorer.expandAll', 'ditaViewer.mapExplorer.collapseAll']) {
      const entry = palette.find((e: { command: string }) => e.command === command);
      assert.ok(entry, `${command} has a commandPalette rule`);
      assert.strictEqual(entry.when, 'false');
    }
  });

  it('drops the native collapse-all button, which cannot sit with Expand All nor act on the selection', () => {
    // showCollapseAll defaults to false, so the tree must be created
    // without it -- the createTreeView call must not mention it at all.
    const createViewIdx = providerSource.indexOf("createTreeView('ditaViewer.mapExplorer'");
    assert.ok(createViewIdx >= 0, 'the tree view is created');
    const callEnd = providerSource.indexOf('});', createViewIdx);
    const callBody = providerSource.slice(createViewIdx, callEnd);
    assert.ok(!/showCollapseAll/.test(callBody), 'createTreeView is called without showCollapseAll');
  });

  it('registers both commands so a row passed from the context menu reaches the provider', () => {
    for (const command of ['expandAll', 'collapseAll']) {
      const pattern = new RegExp(
        `registerCommand\\('ditaViewer\\.mapExplorer\\.${command}',\\s*\\(node\\?`,
      );
      assert.ok(
        pattern.test(providerSource),
        `${command} is registered with the tree node as its argument`,
      );
    }
  });

  it('folds the invoked row through collapseAllIds, not just the branches below it', () => {
    // The dead-command bug lived in this wiring as much as in the decision:
    // collapseAll marked the collected descendant branches directly, and a
    // chapter topichead over leaf topicrefs collects none of those -- so on
    // exactly that shape the command marked nothing and the row on screen
    // never changed. What has to hold is that the marking loop runs over
    // collapseAllIds' result (the branches plus the invoked row) rather than
    // over the raw collectBranchIds output.
    const start = providerSource.indexOf('async collapseAll(');
    assert.ok(start >= 0, 'collapseAll is there to test');
    const end = providerSource.indexOf('/** Re-anchor the view', start);
    const body = providerSource.slice(start, end);
    assert.ok(body.includes('markCollapsed'), 'and it is the folding command');
    assert.ok(body.includes('collapseAllIds('), 'collapseAll folds via collapseAllIds');
    assert.ok(
      !/for \(const id of this\.collectBranchIds\([\s\S]*?\)\)\s*markCollapsed/.test(body),
      'the collected branch ids are not marked on their own, target row missing',
    );
  });

  it('records chevron toggles so expansion survives reloads', () => {
    assert.ok(
      providerSource.includes('treeView.onDidExpandElement((e) => provider.noteExpanded(e.element))'),
      'expansions are recorded',
    );
    assert.ok(
      providerSource.includes('treeView.onDidCollapseElement((e) => provider.noteCollapsed(e.element))'),
      'collapses are recorded',
    );
  });
});
