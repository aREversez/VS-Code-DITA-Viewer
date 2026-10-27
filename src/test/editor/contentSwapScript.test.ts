import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getContentSwapRefreshScript } from '../../editor/webview/contentSwapScript';

// dist-test/test/editor -> repo root is three levels up.
const repoRoot = join(__dirname, '..', '..', '..');
const read = (rel: string): string => readFileSync(join(repoRoot, rel), 'utf8');

/**
 * What both previews redo after their content root's HTML is replaced: the
 * profiling filter, its open panel, the page search and the tag tooltips all
 * hold state about the DOM that was just thrown away. It was written out once
 * in the topic preview's updateContent handler and again in the map preview's
 * afterContentSwap, in a different order -- the sort of pair where a fix lands
 * in one and the other keeps the bug. Now one script.
 */

interface Panel { removed: boolean; remove(): void }

function harness(opts: { panelOpen?: boolean; tooltipsOn?: boolean; omit?: string[] } = {}): {
  calls: string[];
  refresh: () => void;
  panel: () => Panel | null;
  appended: Panel[];
} {
  const calls: string[] = [];
  const appended: Panel[] = [];
  const mk = (): Panel => { const p: Panel = { removed: false, remove() { p.removed = true; calls.push('panel.remove'); } }; return p; };
  const first = opts.panelOpen ? mk() : null;
  const omit = new Set(opts.omit ?? []);
  const defs: Record<string, unknown> = {
    pfApplyFilter: () => calls.push('pfApplyFilter'),
    pfBuildPanel: () => { calls.push('pfBuildPanel'); return mk(); },
    refreshSearchAfterDomChange: () => calls.push('refreshSearch'),
    applyTagTooltips: () => calls.push('applyTagTooltips'),
  };
  for (const k of omit) delete defs[k];
  const doc = { body: { appendChild: (p: Panel): void => { appended.push(p); calls.push('append'); } } };
  const body =
    `var pfPanel = __first; var tagTooltipsOn = __on;
     ${Object.keys(defs).map((k) => `var ${k} = __defs.${k};`).join('\n')}
     ${getContentSwapRefreshScript()}
     return { refresh: refreshAfterContentSwap, panel: function() { return pfPanel; } };`;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const out = new Function('document', '__first', '__on', '__defs', body)(doc, first, !!opts.tooltipsOn, defs) as {
    refresh: () => void; panel: () => Panel | null;
  };
  return { calls, refresh: out.refresh, panel: out.panel, appended };
}

describe('getContentSwapRefreshScript', () => {
  it('re-applies the profiling filter and refreshes the page search, in that order', () => {
    const h = harness();
    h.refresh();
    assert.deepStrictEqual(h.calls, ['pfApplyFilter', 'refreshSearch']);
  });

  it('rebuilds the filter panel against the new content when it was open', () => {
    const h = harness({ panelOpen: true });
    const before = h.panel();
    h.refresh();
    assert.deepStrictEqual(h.calls, ['pfApplyFilter', 'panel.remove', 'pfBuildPanel', 'append', 'refreshSearch']);
    assert.ok(before!.removed);
    assert.notStrictEqual(h.panel(), before);
    assert.deepStrictEqual(h.appended, [h.panel()]);
  });

  it('leaves a closed filter panel closed', () => {
    const h = harness({ panelOpen: false });
    h.refresh();
    assert.ok(!h.calls.includes('pfBuildPanel'));
    assert.strictEqual(h.panel(), null);
  });

  it('promotes data-dita-tagname to title only while tag tooltips are on', () => {
    const on = harness({ tooltipsOn: true });
    on.refresh();
    assert.strictEqual(on.calls[on.calls.length - 1], 'applyTagTooltips');
    const off = harness({ tooltipsOn: false });
    off.refresh();
    assert.ok(!off.calls.includes('applyTagTooltips'));
  });

  it('survives a preview that lacks a piece (each is injected independently)', () => {
    const h = harness({ omit: ['pfApplyFilter', 'refreshSearchAfterDomChange'] });
    assert.doesNotThrow(() => h.refresh());
    assert.deepStrictEqual(h.calls, []);
  });
});

describe('the post-swap refresh is shared, not copied', () => {
  for (const file of ['src/editor/webview/topicScript.ts', 'src/editor/webview/mapScript.ts']) {
    it(`${file} calls refreshAfterContentSwap and carries no inline copy`, () => {
      const source = read(file);
      assert.ok(source.includes('${getContentSwapRefreshScript()}'), 'expected the shared script to be interpolated');
      assert.ok(source.includes('refreshAfterContentSwap()'), 'expected a call after the swap');
      assert.ok(!source.includes('pfPanel.remove()'), 'inline filter-panel rebuild must be gone');
      assert.ok(!source.includes('pfApplyFilter()'), 'inline filter re-apply must be gone');
    });
  }
});
