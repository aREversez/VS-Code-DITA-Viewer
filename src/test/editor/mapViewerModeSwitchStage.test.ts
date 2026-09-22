import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * applyModeStage (MapViewerProvider.ts) is the in-place mode-switch work's
 * webview-side handler -- it lives inline inside a large template-literal
 * script, not as its own exported/importable function, so unlike
 * getModeToggleScript (ditaRenderUtils.test.ts) it cannot be pulled out and
 * run in isolation without reconstructing the whole webview harness. These
 * are source-level tripwires, the same convention stylesCss.test.ts already
 * uses for CSS: they assert the specific lines a regression here would drop,
 * on the actual shipped source, rather than re-deriving behaviour from a
 * mocked-up DOM.
 *
 * What they guard against, concretely: the search overlay's Ranges keep
 * pointing at the pre-switch content after applyModeStage discards it, and
 * afterContentSwap()'s refreshSearchAfterDomChange (unconditional, same call
 * a live-edit refresh uses) silently re-runs performSearch against the FRESH
 * content if the search bar was left "open" -- so a term highlighted before
 * a mode switch reappears highlighted on the page the reader switched to,
 * with no visible search box left to dismiss it (search-bar-survives-switch
 * bug). Two independent things fix that, and both must stay: applyModeStage
 * must close the search bar before it drops the old content (so
 * refreshSearchAfterDomChange finds it already closed), and the removal loop
 * must stop treating #__search_bar as mode content to be destroyed (it is
 * shell chrome like #__topbar, reused across switches, not rebuilt by it).
 */
describe('MapViewerProvider applyModeStage (in-place mode-switch source tripwires)', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'editor', 'MapViewerProvider.ts'), 'utf8');

  function applyModeStageBody(): string {
    const start = source.indexOf('function applyModeStage(stage)');
    assert.ok(start >= 0, 'applyModeStage not found in MapViewerProvider.ts');
    // afterContentSwap() is the last statement in applyModeStage before the
    // ditamap:stage dispatch that ends it; slicing up to its call is enough
    // to cover the whole function body for these checks without needing a
    // real brace-matcher.
    const end = source.indexOf('afterContentSwap();', start);
    assert.ok(end >= 0, 'applyModeStage body end marker not found');
    return source.slice(start, end);
  }

  it('closes the search bar before touching the DOM it is about to discard', () => {
    const body = applyModeStageBody();
    const closeIdx = body.indexOf('closeSearchBar()');
    const removalLoopIdx = body.indexOf("bar.nextSibling");
    assert.ok(closeIdx >= 0, 'applyModeStage should call closeSearchBar()');
    assert.ok(removalLoopIdx >= 0, 'applyModeStage should still have its content-removal loop');
    assert.ok(closeIdx < removalLoopIdx, 'closeSearchBar() must run BEFORE the old content is removed, or afterContentSwap()\'s refreshSearchAfterDomChange can still fire against an already-open search bar');
  });

  it('excludes #__search_bar from the nodes an in-place switch removes, same as it excludes <script>', () => {
    const body = applyModeStageBody();
    const match = /while\s*\(n\)\s*\{[\s\S]*?\n\s*\}/.exec(body);
    assert.ok(match, 'removal loop (while (n) { ... }) not found in applyModeStage');
    const loop = match![0];
    assert.ok(loop.includes("n.tagName === 'SCRIPT'"), 'removal loop should still spare <script> tags');
    assert.ok(loop.includes("n.id === '__search_bar'"), 'removal loop should also spare #__search_bar -- it is shell chrome reused across switches, not mode content');
  });

  it('re-enables the mode button once the new stage has landed', () => {
    const body = applyModeStageBody();
    assert.ok(/modeBtn\.disabled\s*=\s*false/.test(body), 'applyModeStage should clear modeBtn.disabled once its stage is applied -- otherwise the button getModeToggleScript disables on click stays disabled forever on a successful switch');
  });
});
