import * as assert from 'assert';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  renderTopicToHtml,
  renderTopicCached,
  clearTopicRenderCache,
  expandDitamapRefs,
  makeFileTitleResolver,
} from '../../editor/ditaRenderUtils';
import {
  getBookSearchIndex,
  clearBookSearchIndexCache,
  extractBookSearchEntry,
} from '../../editor/bookSearchIndex';
import { setSourceOverlay, clearSourceOverlay, clearAllSourceOverlays, trackSourceReads, dependsOn } from '../../editor/sourceText';
import { parseDitamap } from '../../parser/ditaParser';

/**
 * A topic that is open and modified in an editor but not saved. Everything
 * the previews derive from OTHER files -- conref targets, mapref'd maps,
 * titles, the book-search index -- used to come from the disk copy, so the
 * preview showed text the author had already changed. The overlay makes the
 * unsaved text the source, and the stamps make every cache notice it.
 */
describe('unsaved documents in previews', () => {
  let dir: string;
  const keyMap = new Map<string, string>();
  const asWebviewUri = (relPath: string) => `https://vscode-resource/${relPath}`;
  const pinned = new Date('2024-01-01T00:00:00.000Z');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dita-dirty-'));
    clearAllSourceOverlays();
    clearTopicRenderCache();
    clearBookSearchIndexCache();
  });
  afterEach(() => {
    clearAllSourceOverlays();
    clearTopicRenderCache();
    clearBookSearchIndexCache();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Writes a one-paragraph topic and pins its mtime, so only the overlay can explain a change. */
  function writeTopic(name: string, body: string): string {
    const p = join(dir, name);
    const id = name.replace(/\.dita$/, '');
    writeFileSync(p, `<?xml version="1.0" encoding="UTF-8"?>\n<topic id="${id}"><title>${id}</title><body>${body}</body></topic>`);
    utimesSync(p, pinned, pinned);
    return p;
  }
  function topicText(name: string, body: string): string {
    const id = name.replace(/\.dita$/, '');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<topic id="${id}"><title>${id}</title><body>${body}</body></topic>`;
  }

  it('renders a topic from its unsaved text', () => {
    const a = writeTopic('a.dita', '<p>saved</p>');
    setSourceOverlay(a, topicText('a.dita', '<p>typed</p>'));
    const html = renderTopicToHtml({ filePath: a, keyMap, asWebviewUri, headingLevel: 1 }).html;
    assert.ok(html.includes('typed') && !html.includes('saved'));
  });

  it('pulls a conref target in from its unsaved text', () => {
    const shared = writeTopic('shared.dita', '<p id="sn">SAVED</p>');
    const host = writeTopic('host.dita', '<p conref="shared.dita#shared/sn">fallback</p>');
    setSourceOverlay(shared, topicText('shared.dita', '<p id="sn">TYPED</p>'));
    const html = renderTopicToHtml({ filePath: host, keyMap, asWebviewUri, headingLevel: 1 }).html;
    assert.ok(html.includes('TYPED') && !html.includes('SAVED'));
  });

  it('resolves an xref title from the unsaved title', () => {
    const t = writeTopic('t.dita', '<p>x</p>');
    setSourceOverlay(t, `<topic id="t"><title>Typed Title</title><body/></topic>`);
    assert.strictEqual(makeFileTitleResolver(dir)('t.dita'), 'Typed Title');
  });

  it('inlines a mapref\'d map from its unsaved text', () => {
    const sub = join(dir, 'sub.ditamap');
    writeFileSync(sub, '<map><topicref href="saved.dita"/></map>');
    setSourceOverlay(sub, '<map><topicref href="typed.dita"/></map>');
    const doc = parseDitamap('<map><mapref href="sub.ditamap"/></map>');
    expandDitamapRefs(doc.root, dir);
    const hrefs = JSON.stringify(doc.root);
    assert.ok(hrefs.includes('typed.dita') && !hrefs.includes('saved.dita'));
  });

  describe('renderTopicCached follows the overlay', () => {
    const render = (filePath: string) => renderTopicCached({ filePath, keyMap, asWebviewUri, headingLevel: 1 });

    it('re-renders when the unsaved text of the topic itself changes, and again when the overlay is dropped', () => {
      const a = writeTopic('a.dita', '<p>disk1</p>');
      assert.ok(render(a).html.includes('disk1'));

      setSourceOverlay(a, topicText('a.dita', '<p>edit1</p>'));
      assert.ok(render(a).html.includes('edit1'));
      setSourceOverlay(a, topicText('a.dita', '<p>edit2</p>'));
      assert.ok(render(a).html.includes('edit2'));

      // Discarded: the disk copy is the truth again, and the cache must not
      // keep answering with the unsaved render.
      clearSourceOverlay(a);
      assert.ok(render(a).html.includes('disk1'));
    });

    it('re-renders a host when only its unsaved conref target changed', () => {
      const shared = writeTopic('shared.dita', '<p id="sn">ORIGINAL</p>');
      const host = writeTopic('host.dita', '<p conref="shared.dita#shared/sn">fallback</p>');
      assert.ok(render(host).html.includes('ORIGINAL'));
      setSourceOverlay(shared, topicText('shared.dita', '<p id="sn">UNSAVED</p>'));
      assert.ok(render(host).html.includes('UNSAVED'));
    });

    it('reports the same dependencies for a render it answered from the cache as for the one that built it', () => {
      // A panel decides which edits concern it from the files its last render
      // touched. A cache hit reads nothing, so without this the second pass
      // over a book would tell the panel it depends on nothing.
      const shared = writeTopic('shared.dita', '<p id="sn">ORIGINAL</p>');
      const host = writeTopic('host.dita', '<p conref="shared.dita#shared/sn">fallback</p>');
      const built = trackSourceReads(() => render(host));
      const hit = trackSourceReads(() => render(host));
      for (const { files } of [built, hit]) {
        assert.ok(dependsOn(files, host), 'the topic itself');
        assert.ok(dependsOn(files, shared), 'the conref target it pulled in');
      }
    });

    it('keeps answering from the cache while the overlay is unchanged', () => {
      const a = writeTopic('a.dita', '<p>disk</p>');
      setSourceOverlay(a, topicText('a.dita', '<p>first</p>'));
      assert.ok(render(a).html.includes('first'));
      // Same overlay text again (an editor event that changed nothing): no
      // new stamp, so the entry stays valid.
      setSourceOverlay(a, topicText('a.dita', '<p>first</p>'));
      assert.ok(render(a).html.includes('first'));
    });
  });

  describe('the book search index', () => {
    it('indexes unsaved text', () => {
      const a = writeTopic('a.dita', '<p>saved words</p>');
      setSourceOverlay(a, topicText('a.dita', '<p>typed words</p>'));
      assert.ok(extractBookSearchEntry(a)!.bodyText.includes('typed words'));
    });

    it('is rebuilt when an unsaved topic changes, and when the overlay goes away', () => {
      const a = writeTopic('a.dita', '<p>disk text</p>');
      const manifest = [{ absPath: a, title: 'A', depth: 0 }];
      assert.ok(getBookSearchIndex(dir, manifest).get(a)!.bodyText.includes('disk text'));

      setSourceOverlay(a, topicText('a.dita', '<p>edited text</p>'));
      assert.ok(getBookSearchIndex(dir, manifest).get(a)!.bodyText.includes('edited text'));

      clearSourceOverlay(a);
      assert.ok(getBookSearchIndex(dir, manifest).get(a)!.bodyText.includes('disk text'));
    });
  });
});
