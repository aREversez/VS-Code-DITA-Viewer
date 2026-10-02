import * as assert from 'assert';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { syncDocumentToOverlay, isOverlayCandidate, isPathUnder, affectsPanel, SyncableDocument } from '../../editor/sourceOverlaySync';
import { readSourceText, clearAllSourceOverlays, sourceOverlaySize } from '../../editor/sourceText';

describe('syncDocumentToOverlay', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dita-sync-'));
    file = join(dir, 'a.dita');
    writeFileSync(file, 'on disk');
    clearAllSourceOverlays();
  });
  afterEach(() => {
    clearAllSourceOverlays();
    rmSync(dir, { recursive: true, force: true });
  });

  function doc(over: Partial<SyncableDocument> & { text?: string } = {}): SyncableDocument {
    return {
      fsPath: file,
      scheme: 'file',
      isDirty: true,
      isClosed: false,
      getText: () => over.text ?? 'in the editor',
      ...over,
    };
  }

  it('overlays a dirty document and reports that the source changed', () => {
    assert.strictEqual(syncDocumentToOverlay(doc()), true);
    assert.strictEqual(readSourceText(file), 'in the editor');
  });

  it('reports no change when the same text is synced again', () => {
    syncDocumentToOverlay(doc());
    assert.strictEqual(syncDocumentToOverlay(doc()), false);
  });

  it('drops the overlay when the document is saved or reverted (no longer dirty) and reports the change', () => {
    syncDocumentToOverlay(doc());
    assert.strictEqual(syncDocumentToOverlay(doc({ isDirty: false })), true);
    assert.strictEqual(readSourceText(file), 'on disk');
  });

  it('drops the overlay when a dirty document is closed (changes discarded)', () => {
    syncDocumentToOverlay(doc());
    assert.strictEqual(syncDocumentToOverlay(doc({ isClosed: true })), true);
    assert.strictEqual(readSourceText(file), 'on disk');
  });

  it('never overlays a clean document: the disk is the truth for it', () => {
    assert.strictEqual(syncDocumentToOverlay(doc({ isDirty: false })), false);
    assert.strictEqual(sourceOverlaySize(), 0);
  });

  it('ignores documents that are not DITA files on disk', () => {
    for (const d of [doc({ scheme: 'untitled' }), doc({ scheme: 'git' }), doc({ fsPath: join(dir, 'a.md') })]) {
      assert.strictEqual(syncDocumentToOverlay(d), false);
    }
    assert.strictEqual(sourceOverlaySize(), 0);
  });

  it('does not even read the text of a document it is going to ignore or drop', () => {
    let reads = 0;
    const counting = (o: Partial<SyncableDocument>) => doc({ getText: () => { reads++; return 'x'; }, ...o });
    syncDocumentToOverlay(counting({ isDirty: false }));
    syncDocumentToOverlay(counting({ scheme: 'git' }));
    syncDocumentToOverlay(counting({ isClosed: true }));
    assert.strictEqual(reads, 0);
  });
});

describe('isOverlayCandidate', () => {
  it('takes .dita, .ditamap and .xml files on disk, in any case', () => {
    for (const p of ['/w/a.dita', '/w/A.DITA', '/w/m.ditamap', '/w/x.xml']) {
      assert.strictEqual(isOverlayCandidate('file', p), true, p);
    }
    for (const p of ['/w/a.md', '/w/a.dita.bak', '/w/dita']) {
      assert.strictEqual(isOverlayCandidate('file', p), false, p);
    }
    assert.strictEqual(isOverlayCandidate('untitled', '/w/a.dita'), false);
  });
});

describe('isPathUnder', () => {
  it('is true for files inside the folder, at any depth, and for the folder itself', () => {
    assert.strictEqual(isPathUnder('/w', '/w/a.dita'), true);
    assert.strictEqual(isPathUnder('/w', '/w/sub/deep/a.dita'), true);
    assert.strictEqual(isPathUnder('/w', '/w'), true);
    assert.strictEqual(isPathUnder('/w/', '/w/a.dita'), true);
  });
  it('is false for a sibling whose name merely starts the same way', () => {
    assert.strictEqual(isPathUnder('/w', '/wx/a.dita'), false);
    assert.strictEqual(isPathUnder('/w/docs', '/w/docs2/a.dita'), false);
    assert.strictEqual(isPathUnder('/w/docs', '/w/a.dita'), false);
  });
});

describe('affectsPanel', () => {
  const deps: ReadonlySet<string> = new Set(['/w/topics/a.dita']);
  const disk = (kind: 'create' | 'change' | 'delete') => ({ kind });
  const editor = { kind: 'change' as const, fromEditor: true };

  it('lets every create and delete through: a new file may be what a dangling reference was waiting for', () => {
    for (const kind of ['create', 'delete'] as const) {
      assert.strictEqual(affectsPanel(disk(kind), '/w/other.dita', deps), true);
      assert.strictEqual(affectsPanel(disk(kind), '/w/pic.png', deps), true);
    }
  });

  it('lets a disk change to a source file through only if the last render read that file', () => {
    assert.strictEqual(affectsPanel(disk('change'), '/w/topics/a.dita', deps), true);
    assert.strictEqual(affectsPanel(disk('change'), '/w/topics/../topics/a.dita', deps), true);
    // Another map's topic in the same workspace, saved: nothing this panel showed changed.
    assert.strictEqual(affectsPanel(disk('change'), '/w/other/unrelated.dita', deps), false);
    assert.strictEqual(affectsPanel(disk('change'), '/w/m.ditamap', deps), false);
    assert.strictEqual(affectsPanel(disk('change'), '/w/x.XML', deps), false);
  });

  it('lets a disk change to anything that is not a source file through: images and stylesheets are not tracked', () => {
    for (const p of ['/w/pic.png', '/w/style.css', '/w/logo.svg', '/w/notes.txt']) {
      assert.strictEqual(affectsPanel(disk('change'), p, deps), true, p);
    }
  });

  it('lets an unsaved-edit event through only for a file the last render read', () => {
    assert.strictEqual(affectsPanel(editor, '/w/topics/a.dita', deps), true);
    assert.strictEqual(affectsPanel(editor, '/w/topics/../topics/a.dita', deps), true);
    assert.strictEqual(affectsPanel(editor, '/w/topics/unrelated.dita', deps), false);
  });

  it('cannot rule anything out before the first render', () => {
    assert.strictEqual(affectsPanel(editor, '/w/topics/unrelated.dita', undefined), true);
    assert.strictEqual(affectsPanel(disk('change'), '/w/topics/unrelated.dita', undefined), true);
  });
});
