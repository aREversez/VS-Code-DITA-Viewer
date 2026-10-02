import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

// dist-test/test/editor -> repo root is three levels up. The toolbar is
// assembled inside a template string in MapViewerProvider.ts, which needs the
// `vscode` module to import, so the order is asserted on the source text --
// the order of the appendChild calls IS the behaviour under test.
const source = readFileSync(join(__dirname, '..', '..', '..', 'src', 'editor', 'MapViewerProvider.ts'), 'utf8');

describe('map toolbar button order', () => {
  function at(needle: string): number {
    const i = source.indexOf(needle);
    assert.ok(i >= 0, `expected to find ${needle}`);
    return i;
  }

  it('ends with: template, mode, Tags, Flags, Filter, refresh', () => {
    // The bar is right-aligned, so what stays put on screen is the distance
    // from the right edge. The template picker exists only in site/book: with
    // it to the LEFT of the mode button, the mode button (and everything
    // right of it) stays where it was when switching modes; with it to the
    // right, switching to or from outline moved the mode button under the cursor.
    const order = [
      'toolbar.appendChild(templateSel)',
      'toolbar.appendChild(modeBtn)',
      'toolbar.appendChild(tagTooltipsBtn)',
      'toolbar.appendChild(profilingBtn)',
      '${getProfilingFilterScript(',
      'toolbar.appendChild(refreshBtn)',
    ].map(at);
    for (let i = 1; i < order.length; i++) {
      assert.ok(order[i - 1] < order[i], `button ${i} must come after button ${i - 1}`);
    }
  });
});
