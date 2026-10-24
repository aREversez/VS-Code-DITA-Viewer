import * as assert from 'assert';
import { readRepo, stripComments } from './cssBlocks';

/**
 * The topic-content and outline-tree rules of styles.css read host-neutral
 * --dita-* tokens, and one block at the top answers them from VS Code's theme.
 * That is what lets the same rules be shared with another host (the Obsidian
 * plugin, through @dita-viewer/core) without either side editing the other's
 * colours. Nothing compiles or exercises this, and a stray --vscode-* in the
 * shared part is invisible in VS Code (it looks right) while quietly making the
 * shared rules VS Code-only, so these are tripwires on the three ways it drifts.
 */
describe('styles.css host tokens', () => {
  const css = stripComments(readRepo('media/styles.css'));

  // Rules from here on are VS Code chrome (book/site shell, toolbar) and keep
  // --vscode-* variables; everything before it is the shared part.
  const marker = css.indexOf('.ditamap-book {');
  assert.ok(marker > 0, 'expected the book view rules, where the VS Code chrome begins');
  const shared = css.slice(0, marker);

  const adapter = /:root\s*\{([^{}]*--dita-fg:[^{}]*)\}/.exec(shared);
  assert.ok(adapter, 'expected a :root block that defines the --dita-* host tokens');
  const defined = new Map<string, string>();
  for (const m of adapter[1].matchAll(/(--dita-[\w-]+):\s*var\((--vscode-[\w-]+)\)\s*;/g)) defined.set(m[1], m[2]);
  const sharedRules = shared.replace(adapter[0], '');

  it('answers every token from exactly one VS Code variable, with no value of its own', () => {
    assert.deepStrictEqual([...defined.keys()].sort(), [
      '--dita-bg',
      '--dita-border',
      '--dita-code-bg',
      '--dita-code-inline-bg',
      '--dita-focus',
      '--dita-fg',
      '--dita-fg-muted',
      '--dita-font',
      '--dita-hover-bg',
      '--dita-link',
      '--dita-selected-fg',
    ].sort());
    // A literal here would make the token ignore the theme.
    const declarations = adapter[1].split(';').map((d) => d.trim()).filter(Boolean);
    assert.strictEqual(declarations.length, defined.size, 'every declaration in the block is a plain --vscode-* mapping');
  });

  it('reads only tokens the block defines (and the unrelated image scale)', () => {
    const used = new Set([...sharedRules.matchAll(/var\((--dita-[\w-]+)/g)].map((m) => m[1]));
    used.delete('--dita-scale');
    for (const token of used) assert.ok(defined.has(token), `${token} is read but the adapter does not define it`);
  });

  it('keeps --vscode-* out of the shared rules, except the colours the core cannot express', () => {
    // dropdown-*, menu-* and notifications-* are three different VS Code
    // colours that the core folds into one token; mapping them would change
    // what VS Code shows. They stay as they are until that is decided.
    const allowed = /^--vscode-(dropdown|menu|notifications)-/;
    const stray = new Set<string>();
    for (const m of sharedRules.matchAll(/--vscode-[\w-]+/g)) {
      // widget-border and editor-background also appear as the inner fallback
      // of the allowed ones; those sit on the same declaration, not a free-standing use.
      if (allowed.test(m[0])) continue;
      const line = sharedRules.slice(sharedRules.lastIndexOf(';', m.index) + 1, sharedRules.indexOf(';', m.index) + 1);
      if (!/--vscode-(dropdown|menu|notifications)-/.test(line)) stray.add(m[0]);
    }
    assert.deepStrictEqual([...stray], [], 'use the --dita-* token for these in the shared rules');
  });
});
