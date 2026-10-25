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
  // One VS Code variable, or one and the variable it falls back to (the menu's hover text colour).
  for (const m of adapter[1].matchAll(/(--dita-[\w-]+):\s*var\((--vscode-[\w-]+)(?:,\s*var\(--vscode-[\w-]+\))?\)\s*;/g)) defined.set(m[1], m[2]);
  const sharedRules = shared.replace(adapter[0], '');

  it('answers every token from exactly one VS Code variable, with no value of its own', () => {
    assert.deepStrictEqual([...defined.keys()].sort(), [
      '--dita-bg',
      '--dita-border',
      '--dita-btn-border',
      '--dita-btn-fg',
      '--dita-code-bg',
      '--dita-code-inline-bg',
      '--dita-focus',
      '--dita-fg',
      '--dita-fg-muted',
      '--dita-font',
      '--dita-hover-bg',
      '--dita-link',
      '--dita-menu-bg',
      '--dita-menu-border',
      '--dita-menu-fg',
      '--dita-menu-hover-bg',
      '--dita-menu-hover-fg',
      '--dita-menu-sep',
      '--dita-selected-fg',
      '--dita-toast-bg',
      '--dita-toast-border',
      '--dita-toast-fg',
    ].sort());
    // A literal here would make the token ignore the theme.
    const declarations = adapter[1].split(';').map((d) => d.trim()).filter(Boolean);
    assert.strictEqual(declarations.length, defined.size, 'every declaration in the block is a plain --vscode-* mapping');
  });

  it('reads only tokens the block defines (and the image scale and the elevated background)', () => {
    const used = new Set([...sharedRules.matchAll(/var\((--dita-[\w-]+)/g)].map((m) => m[1]));
    used.delete('--dita-scale');
    // Floating chrome falls back through it to --dita-bg: VS Code has no such colour, so it stays undefined.
    used.delete('--dita-bg-elevated');
    for (const token of used) assert.ok(defined.has(token), `${token} is read but the adapter does not define it`);
  });

  it('keeps --vscode-* out of the shared rules', () => {
    const stray = new Set(sharedRules.match(/--vscode-[\w-]+/g));
    assert.deepStrictEqual([...stray], [], 'use the --dita-* token for these in the shared rules');
  });

  // The adapter is the only thing that differs between this sheet and the one
  // in the core, so the tokens the two read must not drift apart: a token only
  // one of them reads is either dead here or silently ignored there.
  it('reads the same host tokens as the core stylesheet', () => {
    const coreCss = stripComments(readRepo('packages/core/styles/dita-content.css'));
    const reads = (css: string): string[] =>
      [...new Set([...css.matchAll(/var\((--dita-[\w-]+)/g)].map((m) => m[1]))].filter((t) => t !== '--dita-scale').sort();
    assert.deepStrictEqual(reads(sharedRules), reads(coreCss));
  });

  it('documents every token in TOKENS.md', () => {
    const doc = readRepo('packages/core/styles/TOKENS.md');
    // --dita-bg-elevated is read by both sheets but VS Code has no such colour, so the adapter leaves it undefined.
    for (const token of [...defined.keys(), '--dita-bg-elevated']) assert.ok(doc.includes('`' + token + '`'), `${token} is missing from TOKENS.md`);
  });
});
