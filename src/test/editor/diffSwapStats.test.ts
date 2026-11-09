import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { diffTopics, swapDiffResult, DiffTopicsInput } from '../../editor/ditaDiffEngine';
import { renderStats } from '../../editor/diffStatsHtml';

const provider = readFileSync(join(__dirname, '..', '..', '..', 'src/editor/ditaDiffProvider.ts'), 'utf8');

// Mirrors ditaDiffEngine.test.ts: a stub block renderer, since this is about
// counting, not about markup.
const factory: DiffTopicsInput['renderBlockFactory'] = () => () => '<p>x</p>';

const OLD = '<topic id="t"><title>T</title><body><p>one</p><p>two</p><p>three</p></body></topic>';
const NEW = '<topic id="t"><title>T</title><body><p>one</p><p>two</p><p>three</p><p>four</p><p>five</p></body></topic>';

function run(l: string, r: string) {
  return diffTopics({ leftXml: l, rightXml: r, leftDocDir: '/l', rightDocDir: '/r', renderBlockFactory: factory });
}

describe('diff chip after Swap sides', () => {
  it('shows the swapped numbers: an addition-only diff turns into a removal-only one', () => {
    const before = run(OLD, NEW).stats;
    assert.ok(before.added > 0 && before.removed === 0, `fixture is addition-only, got ${JSON.stringify(before)}`);
    const after = swapDiffResult(run(OLD, NEW)).stats;
    assert.strictEqual(after.added, before.removed);
    assert.strictEqual(after.removed, before.added);
    assert.strictEqual(after.modified, before.modified);
    // The rendered chip, which is what the reader sees.
    assert.ok(renderStats(after).includes(`−${before.added}`), renderStats(after));
    assert.ok(!renderStats(after).includes('+'), renderStats(after));
  });

  it('is flipped once: the renderer must not flip the recounted numbers a second time', () => {
    // The swap handler recounts from the swapped rows, which already flips
    // added and removed. A second flip at render time cancelled it, so the
    // chip kept its old numbers and only the colours changed.
    assert.ok(!/roleStats/.test(provider));
    assert.ok(/renderStats\(result\.stats\)/.test(provider));
  });
});
