import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

// dist-test/test/editor -> repo root is three levels up. Like the map toolbar
// order test, the topic toolbar is assembled inside a template string in
// webview/topicScript.ts (which needs the `vscode` module to import), so the
// order is asserted on the source text -- the order of the appendChild calls
// (and the shared helpers interpolated where they append) IS the behaviour
// under test.
const source = readFileSync(
  join(__dirname, '..', '..', '..', 'src', 'editor', 'webview', 'topicScript.ts'),
  'utf8',
);

describe('topic toolbar button order', () => {
  function at(needle: string): number {
    const i = source.indexOf(needle);
    assert.ok(i >= 0, `expected to find ${needle}`);
    return i;
  }

  it('orders the profiling trio Tags, Flags, Filter -- matching the map toolbar', () => {
    // Flags used to sit before Tags in the topic view, so the Filter button's
    // own comment ("goes immediately next to Flags") was only ever true of the
    // map, and the two previews' toolbars read differently. The trio is now
    // Tags, Flags, Filter in both, so Filter lands directly against Flags and
    // a reader who switches between the views sees the controls in the same
    // order. The Flags toggle and the Filter panel append their buttons from
    // inside their shared helpers, so the position of each interpolation IS the
    // position of the button it adds.
    const order = [
      'toolbar.appendChild(tagTooltipsBtn)',
      '${getProfilingToggleScript(',
      '${getProfilingFilterScript(',
      'toolbar.appendChild(wSel)',
      'toolbar.appendChild(refreshBtn)',
    ].map(at);
    for (let i = 1; i < order.length; i++) {
      assert.ok(order[i - 1] < order[i], `button ${i} must come after button ${i - 1}`);
    }
  });
});
