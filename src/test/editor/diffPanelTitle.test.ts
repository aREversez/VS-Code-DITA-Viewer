import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { diffPanelTitle } from '../../editor/diffVersionPick';

const repoRoot = join(__dirname, '..', '..', '..');
const provider = readFileSync(join(repoRoot, 'src/editor/ditaDiffProvider.ts'), 'utf8');

describe('diff panel title', () => {
  it('names the file and both versions, left to right', () => {
    assert.strictEqual(diffPanelTitle('a.dita', 'abc123 old', 'Working copy'), 'a.dita — abc123 old ↔ Working copy');
  });

  it('never carries a codicon token: a webview panel title does not resolve them', () => {
    assert.ok(!diffPanelTitle('a.dita', 'x', 'y').includes('$('));
  });

  it('is re-applied on every render, so a re-compare and a swap both retitle the tab', () => {
    // renderDiffPanel is the one place both paths go through. Setting the title
    // only when the panel is created left a re-compared or swapped panel
    // reading as the previous comparison.
    const body = provider.slice(provider.indexOf('function renderDiffPanel('));
    const fn = body.slice(0, body.indexOf('\n}\n'));
    assert.ok(/panel\.title\s*=\s*diffPanelTitle\(/.test(fn), 'renderDiffPanel must assign panel.title');
  });

  it('does not build the title with a codicon prefix any more', () => {
    assert.ok(!provider.includes('`$(diff) ${fileName}'));
  });
});
