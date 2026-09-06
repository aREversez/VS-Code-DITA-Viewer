import * as assert from 'assert';
import { foldPendingRender, PendingRender } from '../../editor/pendingRender';

/**
 * The escalate-only rule behind a hidden preview panel's deferred render
 * (DitaViewerProvider.ts and MapViewerProvider.ts's requestUpdate /
 * onDidChangeViewState). Worth pinning down on its own: the failure mode --
 * a theme switch silently downgraded back to a content-only patch because a
 * source edit was already pending -- looks identical to a working panel
 * right up until the user un-hides it and the light/dark class is wrong,
 * which is not the kind of thing a manual click-through catches.
 */
describe('foldPendingRender', () => {
  it('takes the request outright when nothing was pending, for either kind', () => {
    assert.strictEqual(foldPendingRender('none', 'content'), 'content');
    assert.strictEqual(foldPendingRender('none', 'full'), 'full');
  });

  it('leaves a pending content request alone when another content request arrives', () => {
    assert.strictEqual(foldPendingRender('content', 'content'), 'content');
  });

  it('escalates a pending content request to full', () => {
    // The case the rule exists for: a theme switch (full) landing on top of
    // an already-pending source edit (content) must not be dropped or
    // merged away -- the light/dark class lives outside the content div a
    // content-only patch touches, so only a full reload can fix it.
    assert.strictEqual(foldPendingRender('content', 'full'), 'full');
  });

  it('never downgrades a pending full request back to content', () => {
    // The one direction this rule must never go. A source edit arriving
    // after a theme switch was already recorded must not erase the debt of
    // a full reload -- that would leave the stale light/dark class waiting
    // on some later, unrelated re-render to happen to fix it.
    assert.strictEqual(foldPendingRender('full', 'content'), 'full');
  });

  it('leaves a pending full request alone when another full request arrives', () => {
    assert.strictEqual(foldPendingRender('full', 'full'), 'full');
  });

  it('is idempotent under repeated content requests, matching several debounced edits landing while hidden', () => {
    let state: PendingRender = 'none';
    state = foldPendingRender(state, 'content');
    state = foldPendingRender(state, 'content');
    state = foldPendingRender(state, 'content');
    assert.strictEqual(state, 'content');
  });

  it('stays at full once escalated, whatever arrives afterwards', () => {
    let state: PendingRender = 'none';
    state = foldPendingRender(state, 'content'); // edit while hidden
    state = foldPendingRender(state, 'full'); // theme switch while still hidden
    state = foldPendingRender(state, 'content'); // another edit before it's shown again
    assert.strictEqual(state, 'full', 'the theme switch must still be honoured on reveal');
  });
});
