import * as assert from 'assert';
import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import {
  getBookNavClickHandlerScript,
  getBookScrollSyncScript,
  getInitialSidebarBodyClass,
  getOutlineSyncScript,
  getSidebarUpdateScript,
  getSiteHistoryModelScript,
  getSiteNavClickHandlerScript,
  getSiteNavCollapseStateHelperScript,
  getSiteNavExpandCollapseAllButtonsScript,
  getSiteNavKeyboardScript,
  getSiteNavToggleScript,
} from '../../editor/webview/siteNavScripts';

// The sidebar's webview scripts are template strings: tsc, eslint and the unit tests
// never see inside them, so a helper that stays behind when a function moves compiles
// and then throws in the page. They are also just strings, which makes the strongest
// check cheap: record the exact output of every factory, and compare byte for byte.
//
// This pins the text, not its correctness. Regenerate only for a reviewed change:
//   UPDATE_GOLDEN=1 npx mocha --config .mocharc.json -g "siteNavScripts golden"
const GOLDEN = resolve(__dirname, '..', '..', '..', 'src', 'test', 'editor', 'golden', 'siteNavScripts.golden.json');

const CASES: Record<string, () => string> = {
  getSiteNavKeyboardScript: () => getSiteNavKeyboardScript(),
  'getSidebarUpdateScript site': () => getSidebarUpdateScript({ site: true }),
  'getSidebarUpdateScript book': () => getSidebarUpdateScript({ site: false }),
  getSiteHistoryModelScript: () => getSiteHistoryModelScript(),
  'getSiteNavClickHandlerScript': () => getSiteNavClickHandlerScript({ switchSitePageMsgType: 'switchSitePage' }),
  'getSiteNavClickHandlerScript other type': () => getSiteNavClickHandlerScript({ switchSitePageMsgType: 'x-y_Z' }),
  getBookNavClickHandlerScript: () => getBookNavClickHandlerScript(),
  getBookScrollSyncScript: () => getBookScrollSyncScript(),
  getOutlineSyncScript: () => getOutlineSyncScript(),
  'getInitialSidebarBodyClass tree': () => getInitialSidebarBodyClass('tree'),
  'getInitialSidebarBodyClass book': () => getInitialSidebarBodyClass('book'),
  'getInitialSidebarBodyClass site': () => getInitialSidebarBodyClass('site'),
  'getSiteNavCollapseStateHelperScript': () => getSiteNavCollapseStateHelperScript(),
  'getSiteNavCollapseStateHelperScript reporting': () => getSiteNavCollapseStateHelperScript({ reportCollapseMsgType: 'reportCollapse' }),
  getSiteNavExpandCollapseAllButtonsScript: () =>
    getSiteNavExpandCollapseAllButtonsScript({ expandAllTitle: 'Expand all', collapseAllTitle: 'Collapse all' }),
  'getSiteNavExpandCollapseAllButtonsScript quoting': () =>
    getSiteNavExpandCollapseAllButtonsScript({ expandAllTitle: `It's "all" <open>`, collapseAllTitle: '全部折叠' }),
  getSiteNavToggleScript: () => getSiteNavToggleScript(),
};

function snapshot(): Record<string, { length: number; sha256: string }> {
  const out: Record<string, { length: number; sha256: string }> = {};
  for (const [name, make] of Object.entries(CASES)) {
    const text = make();
    out[name] = { length: text.length, sha256: createHash('sha256').update(text).digest('hex') };
  }
  return out;
}

describe('siteNavScripts golden (characterization)', () => {
  it('every factory returns exactly the recorded text', () => {
    const actual = snapshot();
    if (process.env.UPDATE_GOLDEN === '1' || !existsSync(GOLDEN)) {
      writeFileSync(GOLDEN, '{\n' + Object.keys(actual).map((k) => `${JSON.stringify(k)}: ${JSON.stringify(actual[k])}`).join(',\n') + '\n}\n');
      if (process.env.UPDATE_GOLDEN !== '1') assert.fail('golden file did not exist; it was written, rerun to compare');
      return;
    }
    const expected = JSON.parse(readFileSync(GOLDEN, 'utf8')) as typeof actual;
    assert.deepStrictEqual(Object.keys(actual), Object.keys(expected), 'the set of cases changed');
    for (const key of Object.keys(expected)) {
      assert.deepStrictEqual(actual[key], expected[key], `script text changed: ${key}`);
    }
  });

  it('is deterministic, and the arguments change the output where they should', () => {
    assert.deepStrictEqual(snapshot(), snapshot());
    const s = snapshot();
    assert.notStrictEqual(s['getSidebarUpdateScript site'].sha256, s['getSidebarUpdateScript book'].sha256);
    assert.notStrictEqual(s['getSiteNavClickHandlerScript'].sha256, s['getSiteNavClickHandlerScript other type'].sha256);
    assert.notStrictEqual(s['getSiteNavCollapseStateHelperScript'].sha256, s['getSiteNavCollapseStateHelperScript reporting'].sha256);
    assert.notStrictEqual(s['getSiteNavExpandCollapseAllButtonsScript'].sha256, s['getSiteNavExpandCollapseAllButtonsScript quoting'].sha256);
  });

  it('records real output, not empty strings', () => {
    for (const [name, v] of Object.entries(snapshot())) {
      assert.ok(v.length > 0, name);
    }
  });
});
