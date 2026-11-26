import * as assert from 'assert';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { clearTopicRenderCache, renderTopicCached } from '../../src/editor/topicRender';

// The preview and "Export as HTML" render the same file; only the export sets
// suppressDraftComment. The render cache must therefore treat the flag as part
// of its key -- otherwise whichever ran first decides what the other one shows
// (an export that ships a review note, or a preview that hides it).
describe('draft comments through the topic render cache', () => {
  let root: string;
  let file: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'draft-comment-render-'));
    file = join(root, 't.dita');
    writeFileSync(
      file,
      '<?xml version="1.0"?><topic id="t"><title>T</title><body><p>a <draft-comment author="EBP">SECRETNOTE</draft-comment> b</p></body></topic>',
    );
    clearTopicRenderCache();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // One map instance for every call: the cache compares keyMap by identity, so
  // a fresh Map per call would miss every time and this test could not fail.
  const keyMap = new Map<string, string>();
  const render = (suppressDraftComment?: boolean): string =>
    renderTopicCached({ filePath: file, keyMap, asWebviewUri: (p) => p, headingLevel: 1, suppressDraftComment }).html;

  it('never serves the preview a stripped copy, or the export a copy that still has the note', () => {
    assert.ok(render().includes('SECRETNOTE'), 'preview shows it');
    assert.ok(!render(true).includes('SECRETNOTE'), 'export strips it even though the preview render is cached');
    assert.ok(render().includes('SECRETNOTE'), 'and the preview still shows it afterwards');
    assert.ok(!render(true).includes('SECRETNOTE'), 'export repeat served from its own entry');
  });
});
