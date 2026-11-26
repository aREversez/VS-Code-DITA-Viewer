import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  createSourcePreviewSyncGate,
  PREVIEW_SCROLL_ECHO_MS,
  SELECTION_REVEAL_ECHO_MS,
} from '../../editor/sourcePreviewSyncGate';

describe('source -> preview sync gate', () => {
  let t: number;
  const gate = () => createSourcePreviewSyncGate(() => t);
  beforeEach(() => {
    t = 1000;
  });

  it('accepts the first selection change and a lone visible-range change', () => {
    assert.strictEqual(gate().acceptSelection(), true);
    assert.strictEqual(gate().acceptVisibleRange(), true);
  });

  it('does not follow the editor\'s own auto-reveal right after a selection change', () => {
    const g = gate();
    g.acceptSelection();
    t += 10;
    assert.strictEqual(g.acceptVisibleRange(), false);
    t += SELECTION_REVEAL_ECHO_MS;
    assert.strictEqual(g.acceptVisibleRange(), true);
  });

  it('still honours a second selection change inside the first one\'s window (click, then go-to-definition jump)', () => {
    const g = gate();
    assert.strictEqual(g.acceptSelection(), true); // the click on the link
    t += 60;
    assert.strictEqual(g.acceptSelection(), true); // the jump to the target section
  });

  it('keeps the visible-range echo suppressed after the second selection change too', () => {
    const g = gate();
    g.acceptSelection();
    t += 300;
    assert.strictEqual(g.acceptSelection(), true);
    t += 300; // 600ms after the first, 300ms after the second
    assert.strictEqual(g.acceptVisibleRange(), false);
  });

  it('drops a selection change that is the echo of the preview\'s own scroll', () => {
    const g = gate();
    g.notePreviewScroll();
    t += 10;
    assert.strictEqual(g.acceptSelection(), false);
    assert.strictEqual(g.acceptVisibleRange(), false);
    t += PREVIEW_SCROLL_ECHO_MS;
    assert.strictEqual(g.acceptSelection(), true);
  });

  it('a dropped echo does not open a selection window of its own', () => {
    const g = gate();
    g.notePreviewScroll();
    g.acceptSelection(); // dropped
    t += PREVIEW_SCROLL_ECHO_MS;
    assert.strictEqual(g.acceptVisibleRange(), true);
  });
});

describe('DitaViewerProvider uses the sync gate', () => {
  // The provider imports vscode and cannot be required here, so check by
  // source text that it is the gate -- not a private copy of the timing
  // variable -- that decides what the editor handlers post.
  const src = readFileSync(join(__dirname, '..', '..', '..', 'src/editor/DitaViewerProvider.ts'), 'utf8');
  it('has no private skipVisibleUntil left', () => {
    assert.ok(!src.includes('skipVisibleUntil'));
  });
  it('routes the three events through the gate', () => {
    assert.ok(src.includes('createSourcePreviewSyncGate()'));
    assert.ok(src.includes('syncGate.notePreviewScroll()'));
    assert.ok(src.includes('syncGate.acceptSelection()'));
    assert.ok(src.includes('syncGate.acceptVisibleRange()'));
  });
});
