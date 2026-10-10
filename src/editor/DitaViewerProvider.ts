import * as vscode from 'vscode';
import { parseDita, preprocessEntities } from '../parser/ditaParser';
import { renderDocument } from '../render/renderer';
import { dirname, join, resolve } from 'path';
import { randomBytes } from 'crypto';
import { getWebviewScript } from './webview/topicScript';
import { MSG_OPEN_CONREF_TARGET, parseConrefJumpMessage } from './conrefJump';
import { openConrefTarget } from './conrefJumpCommand';
import { buildTitleMap, decodeHrefPart, openHrefTarget, clearImageDimensionsCache, clearTopicRenderCache, clearBookMembersCache } from './ditaRenderUtils';
import { buildRenderContext } from './renderContext';
import { clearBookSearchIndexCache } from './bookSearchIndex';
import { acquireDitaFileWatcher, ditaWatchBase } from './ditaFileWatcher';
import { foldPendingRender, escalateAfterFailure, PendingRender } from './pendingRender';
import { discoverCssFiles } from './cssDiscovery';
import { findDitamapFiles, buildKeyMap, getKeySourceMaps, clearKeyMapCache } from './keyMap';
import { onKeyContextChanged } from './keyContext';
import { readForDocument, writeForDocument } from './perDocumentState';
import { trackSourceReads } from './sourceText';
import { affectsPanel } from './sourceOverlaySync';

// Test-only hook: @vscode/test-electron integration tests can't read a
// webview's rendered HTML directly (VS Code doesn't expose the WebviewPanel
// created for a custom editor back to the caller of `vscode.openWith`), so
// each render stores its output here, keyed by document URI, for the test
// suite to read via the extension's exports. Negligible memory/perf cost;
// has no effect on normal usage.
const lastRenderedHtmlByUri = new Map<string, string>();

export function getLastRenderedHtmlForTesting(uriString: string): string | undefined {
  return lastRenderedHtmlByUri.get(uriString);
}

/**
 * Clears every in-memory cache the extension keeps (the test-only render
 * cache above, the keymap cache below, and the image-dimensions and
 * book-mode topic-render caches in ditaRenderUtils.ts). lastRenderedHtmlByUri
 * entries are already removed individually as each webview panel disposes
 * (see onDidDispose in resolveCustomTextEditor), and the rest are already
 * bounded by their own caps -- this is a defensive full reset for extension
 * deactivation, not a fix for an actual leak in any of them.
 * Wired into extension.ts's deactivate().
 */
export function clearAllCaches(): void {
  lastRenderedHtmlByUri.clear();
  clearKeyMapCache();
  clearImageDimensionsCache();
  clearTopicRenderCache();
  clearBookMembersCache();
  clearBookSearchIndexCache();
}

// Font preferences (size % + serif toggle) are global rather than per-document:
// they describe how the user likes to read, not something tied to one file --
// and not to which kind of preview is showing it either, which is why
// MapViewerProvider.ts imports these two rather than declaring its own copy.
// A person who has already picked a size and a typeface for reading DITA
// content does not have a second, unrelated preference for reading it
// assembled into a book; there is one reading experience, in two providers.
export const FONT_PREFS_KEY = 'ditaViewer.fontPrefs';
export const DEFAULT_FONT_PREFS = { size: 100, serif: false };

// Same reasoning as font prefs: whether the reader wants every element's
// tag name as a hover tooltip is a reading preference, not something tied
// to one file or to which provider is showing it, so both providers share
// this key rather than each keeping their own copy of the default.
// Defaults off -- injectAttributes() in renderer.ts still injects the tag
// name into every element as data-dita-tagname regardless, so turning
// this on needs no re-render, only a DOM walk promoting that data
// attribute to a real title= (see applyTagTooltips() in both providers'
// webview scripts).
export const TAG_TOOLTIPS_KEY = 'ditaViewer.tagTooltips';
export const DEFAULT_TAG_TOOLTIPS = false;

// CSS theme and page-width choices, unlike font prefs, ARE tied to one
// document -- discoverCssFiles() scans relative to each document's own
// directory, so a different file may not even have the same set of custom
// CSS files available. Persisted per-uri rather than globally so opening
// a different project doesn't inherit a selection that might not apply
// (or might silently mean something else) there. Without this, both
// dropdowns silently reset on every re-render: webview.html is reassigned
// wholesale on every edit, which reruns generateHtml() from scratch, and
// discoverCssFiles()'s own always-recomputed default was the only thing
// ever fed back in -- whatever the person had picked at runtime lived
// only in the old page's now-discarded JS state.
//
// WIDTH_SELECTION_KEY is exported for the same reason FONT_PREFS_KEY is: a
// ditamap has its own uri, distinct from any topic's, so the two providers
// sharing this map's key space costs nothing and avoids a second constant
// that could name a different globalState key by a future typo.
// CSS_SELECTION_KEY stays private -- discoverCssFiles() and the dropdown it
// feeds are specific to a single topic's own directory and have no map-mode
// counterpart to share it with.
const CSS_SELECTION_KEY = 'ditaViewer.cssSelectionByUri';
export const WIDTH_SELECTION_KEY = 'ditaViewer.widthSelectionByUri';

export class DitaViewerProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const documentRoot = vscode.Uri.file(dirname(document.uri.fsPath));

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(this.context.extensionPath),
        documentRoot,
        ...(vscode.workspace.workspaceFolders || []).map((f) => f.uri),
      ],
    };

    const findSourceEditor = () =>
      vscode.window.visibleTextEditors.find(
        (e) => e.document.uri.toString() === document.uri.toString(),
      );

    // The toggle command (and "Reopen Editor With") can dispose this panel
    // while sync timers are still pending — guard every deferred webview
    // access so nothing posts to a disposed webview.
    let disposed = false;

    const postRevealLine = (line: number) => {
      if (disposed) return;
      webviewPanel.webview.postMessage({ type: 'revealLine', line });
    };

    let skipVisibleUntil = 0;

    webviewPanel.webview.onDidReceiveMessage((message) => {
      if (message.type === 'refresh') {
        requestUpdate('full');
      } else if (message.type === 'scrollSync') {
        // Reveal the matching source line as the user scrolls the preview,
        // but deliberately do NOT move editor.selection here — unlike
        // navigateToLine (an explicit double-click, i.e. real navigation
        // intent), continuous scroll-follow shouldn't relocate the actual
        // typing cursor. Besides being surprising on its own, it's also
        // what made the webview-echo race above so damaging: it wasn't
        // just the preview flickering, it was the *editor selection*
        // jumping mid-keystroke.
        const editor = findSourceEditor();
        if (editor) {
          const currentTopLine = editor.visibleRanges[0]?.start.line;
          if (currentTopLine !== undefined) {
            const diff = Math.abs(message.line - currentTopLine);
            if (diff >= 2) {
              skipVisibleUntil = Date.now() + 250;
              const line = Math.max(0, Math.min(message.line, document.lineCount - 1));
              editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.AtTop);
            }
          }
        }
      } else if (message.type === 'navigateToLine') {
        // Preview double-click → highlight in source, only scroll if not visible
        const editor = findSourceEditor();
        if (editor) {
          const line = Math.max(0, Math.min(message.line, document.lineCount - 1));
          const inView = editor.visibleRanges.some(r => line >= r.start.line && line <= r.end.line);
          if (!inView) {
            editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.AtTop);
          }
          // Column matters here, not just the line: an inline element (e.g.
          // <uicontrol>) sharing its source line with its containing block
          // (e.g. <p>) is only distinguished by column range, and the
          // selection change below is what triggers the highlightLine echo
          // back to the webview (see onDidChangeTextEditorSelection) that
          // re-picks the element to highlight. Always landing on column 0
          // meant that echo re-picked the containing <p> instead of
          // whichever inline element was actually double-clicked.
          const col = Math.max(0, typeof message.col === 'number' ? message.col : 0);
          const lineLength = document.lineAt(line).text.length;
          const character = Math.min(col, lineLength);
          editor.selection = new vscode.Selection(new vscode.Position(line, character), new vscode.Position(line, character));
        }
      } else if (message.type === MSG_OPEN_CONREF_TARGET) {
        // Jump button on conref'd content (conrefJumpScript.ts): open the
        // referenced element's source beside this preview.
        const target = parseConrefJumpMessage(message);
        if (target) void openConrefTarget(target, webviewPanel.viewColumn);
      } else if (message.type === 'openImagemapLink') {
        // Image-map hotspot click (getImageMapSupportScript): the webview
        // guard preventDefaults the navigation and hands over the raw
        // href; resolve it against THIS topic's folder and open it in the
        // right place (preview editor for DITA sources, system handler
        // for html/pdf/external URLs).
        const href = typeof message.href === 'string' ? message.href : '';
        if (href) openHrefTarget(vscode, href, dirname(document.uri.fsPath));
      } else if (message.type === 'setFontPrefs') {
        // Persist across webview reopens/reloads — same size/family applies
        // to every DITA file the user previews, not per-document.
        const size = typeof message.size === 'number' ? message.size : DEFAULT_FONT_PREFS.size;
        const serif = message.serif === true;
        this.context.globalState.update(FONT_PREFS_KEY, { size, serif });
      } else if (message.type === 'setTagTooltips') {
        this.context.globalState.update(TAG_TOOLTIPS_KEY, message.value === true);
      } else if (message.type === 'setCssSelection') {
        // Persisted per-document (see CSS_SELECTION_KEY above) so the next
        // re-render (every edit reassigns webview.html wholesale, which
        // otherwise silently reset this back to discoverCssFiles()'s own
        // always-recomputed default) picks the same file back up.
        if (typeof message.value === 'string') {
          writeForDocument(this.context.globalState, CSS_SELECTION_KEY, document.uri, message.value);
        }
      } else if (message.type === 'setWidthSelection') {
        if (typeof message.value === 'string') {
          writeForDocument(this.context.globalState, WIDTH_SELECTION_KEY, document.uri, message.value);
        }
      }
    });

    // Source click → preview: highlight + scroll if not visible
    const selectionSub = vscode.window.onDidChangeTextEditorSelection((e) => {
      if (e.textEditor.document.uri.toString() !== document.uri.toString()) return;
      if (Date.now() < skipVisibleUntil) return;
      const sel = e.selections[0];
      if (!sel || sel.start.line !== sel.end.line) return;
      // Moving the cursor somewhere not currently on screen (e.g. clicking
      // near the end of a long file while the editor happens to be
      // scrolled elsewhere) very often also moves the editor's own visible
      // range as a side effect -- VS Code reveals the cursor into view on
      // its own. That would otherwise fire editorSub below shortly after
      // this, telling the preview to align a *different* line (the
      // editor's new visible-range top, from simple continuous scroll-
      // follow) at the *top* of its viewport, fighting the highlightLine
      // this posts, which centers the exact cursor line instead -- visibly
      // the preview correctly centering the edit position, then abruptly
      // sliding to a completely different alignment for what was actually
      // the same underlying cursor move, before a later correction snaps
      // it back. Suppressing editorSub for a beat after a selection change
      // lets highlightLine's centering stand uncontested for what's almost
      // always the same event; a genuine independent source scroll (mouse
      // wheel, no cursor movement) never touches this path at all, since
      // it never fires onDidChangeTextEditorSelection to begin with.
      skipVisibleUntil = Date.now() + 400;
      webviewPanel.webview.postMessage({ type: 'highlightLine', line: sel.start.line, col: sel.start.character });
    });

    let visibleRangeTimer: ReturnType<typeof setTimeout> | undefined;
    const editorSub = vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (e.textEditor.document.uri.toString() !== document.uri.toString()) return;
      if (Date.now() < skipVisibleUntil) return;
      if (visibleRangeTimer) clearTimeout(visibleRangeTimer);
      visibleRangeTimer = setTimeout(() => {
        if (Date.now() < skipVisibleUntil) return;
        const topLine = e.textEditor.visibleRanges[0]?.start.line;
        if (topLine !== undefined) postRevealLine(topLine);
      }, 120);
    });

    let renderDebounceTimer: ReturnType<typeof setTimeout> | undefined;
    // The render a currently-hidden panel is owed, if any. 'content' is a
    // source edit, satisfied by postContentUpdate; 'full' is a theme switch
    // or manual refresh, which has to reassign webview.html because the
    // light/dark class lives on <html>, outside the content div a
    // content-only update touches. Escalates only -- a theme switch landing
    // while an edit is already pending must not be downgraded, or the class
    // stays stale until some later unrelated re-render. The fold itself
    // lives in pendingRender.ts -- see foldPendingRender -- so the rule is
    // pinned by a unit test rather than only by this comment.
    let pendingUpdate: PendingRender = 'none';
    // The source files the last successful render read (its own, conref
    // targets, key maps, ...). Decides which unsaved edits elsewhere are worth
    // a refresh -- see affectsPanel. Kept across a failed render (malformed
    // XML mid-edit reads less than a working one would).
    let dependencies: ReadonlySet<string> | undefined;
    const rememberDependencies = (files: ReadonlySet<string>) => { dependencies = files; };
    // Whether the page on screen is the error document a failed render
    // produces. It has no script, so a content message posted to it goes
    // nowhere: recovery has to replace the document (escalateAfterFailure).
    let pageIsError = false;
    const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
      renderDebounceTimer = setTimeout(() => {
        requestUpdate('content');
      }, 300);
    });

    // Refresh on changes to files this topic may reference (conref/keyref
    // targets, other .dita/.ditamap files, images, custom CSS) that live
    // outside this document and therefore never fire onDidChangeTextDocument
    // above -- previously the only way to pick these up was the manual
    // reload button. This intentionally watches the whole containing
    // workspace folder rather than precisely tracking this document's own
    // resolved dependency set. That set IS knowable now -- buildKeyMap below
    // already records every map it read so it can fingerprint them, and
    // renderTopicCached takes a collectDependencies sink for the render's own
    // reads -- but a per-document watcher built from either would have to be
    // torn down and rebuilt after every render, because editing a topic changes
    // what it references, and getting that wrong means silently missing the
    // cross-folder conref this exists to catch. Sharing one folder-wide watcher
    // is the cheaper half of that win: every panel used to create its own, so a
    // map open next to three topic previews meant four watchers each matching
    // every file event in the folder. See ditaFileWatcher.ts.
    //
    // The tradeoff is unchanged: a refresh check fires for edits unrelated to
    // this document. That's a cheap no-op for a single topic, and for a large
    // open book-mode map it re-runs the assembly pass, which is now mostly
    // cache hits (see scripts/bench-book-render.js).
    const referencedFilesWatcher = acquireDitaFileWatcher(ditaWatchBase(document.uri), (event) => {
      if (disposed) return;
      if (event.uri.toString() === document.uri.toString()) return; // already handled above
      if (!affectsPanel(event, event.uri.fsPath, dependencies)) return;
      if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
      renderDebounceTimer = setTimeout(() => {
        requestUpdate('content');
      }, 300);
    });

    // Re-render on theme switch so the manually-computed light/dark class
    // (used for DITA-specific colors that have no direct VS Code theme
    // equivalent, e.g. note backgrounds) never goes stale relative to the
    // actual active theme. A genuine full reload, unlike postContentUpdate
    // below -- the CSS class lives on <html>, outside the content div a
    // content-only update touches.
    const themeSubscription = vscode.window.onDidChangeActiveColorTheme(() => {
      requestUpdate('full');
    });

    const updateWebview = () => {
      if (disposed) return;
      // Every re-render replaces webview.html wholesale (a full page
      // reload), which resets scroll to 0 -- baking in the source editor's
      // current top line lets the fresh page jump there instantly on load
      // instead of the extension separately posting a scroll correction
      // afterward (which visibly showed as "reset to top, then animate
      // back down" on every re-render while typing). Reserved now for the
      // genuinely-rare cases that need a real reload (initial open, theme
      // switch, manual refresh) -- see postContentUpdate for the common
      // case of a regular source edit, which no longer reloads at all.
      const editor = findSourceEditor();
      const initialScrollLine = editor?.visibleRanges[0]?.start.line;
      const { html, failed } = this.generateHtml(document, webviewPanel.webview, initialScrollLine, rememberDependencies);
      pageIsError = failed;
      webviewPanel.webview.html = html;
      lastRenderedHtmlByUri.set(document.uri.toString(), html);
    };

    // The common case: a regular source edit. Sends just the freshly
    // rendered DITA content as a message instead of reassigning
    // webview.html -- the page itself is never destroyed and recreated,
    // so there's no reload to visibly flash/reset, no scroll position to
    // restore (the browser preserves it automatically, the same way it
    // would for any other in-place DOM update), and no window for a
    // scroll-correction message from an unrelated cause (a source click,
    // the editor's own visible-range-follow, ...) to race an in-flight
    // page reload and land on the wrong content -- the exact failure mode
    // reported ("jumps to the right spot, then immediately somewhere
    // else"), since there is no longer a reload for anything to race
    // against. Falls back to a full reload only if rendering itself
    // failed (malformed XML mid-edit, etc.), to show the error page --
    // an error has no "content" to patch in -- or if the page on screen
    // already is that error page, which has no script to receive a patch
    // (escalateAfterFailure).
    const postContentUpdate = () => {
      if (disposed) return;
      if (escalateAfterFailure(pageIsError, 'content') === 'full') {
        updateWebview();
        return;
      }
      const result = this.renderTopicContent(document, webviewPanel.webview, rememberDependencies);
      if (result.error !== undefined) {
        updateWebview();
        return;
      }
      webviewPanel.webview.postMessage({ type: 'updateContent', html: result.html });
    };

    // A hidden panel (tabbed behind another editor, or sitting in a
    // collapsed group) still has a live webview under
    // retainContextWhenHidden, so without this every edit anywhere in the
    // watched set pays for a full re-render nobody is looking at -- and the
    // extension host is single-threaded, so that cost lands on every other
    // extension's completions and hovers too. Record the debt instead and
    // settle it once, when the panel comes back.
    const requestUpdate = (kind: 'content' | 'full') => {
      if (disposed) return;
      if (!webviewPanel.visible) {
        pendingUpdate = foldPendingRender(pendingUpdate, kind);
        return;
      }
      if (kind === 'full') updateWebview();
      else postContentUpdate();
    };

    // Only renders are deferred. The scroll-sync traffic above (editorSub
    // -> postRevealLine) is a bare postMessage rather than a render, and
    // suppressing it while hidden would leave the preview scrolled to
    // wherever it sat when the panel was hidden -- pendingUpdate is 'none'
    // in that case, so nothing would flush on reveal to correct it.
    const viewStateSubscription = webviewPanel.onDidChangeViewState((e) => {
      if (!e.webviewPanel.visible || pendingUpdate === 'none') return;
      // Clear before rendering: postContentUpdate falls back to
      // updateWebview when rendering fails, and re-entering with a stale
      // pendingUpdate would render twice.
      const owed = pendingUpdate;
      pendingUpdate = 'none';
      if (owed === 'full') updateWebview();
      else postContentUpdate();
    });

    // Choosing another key context map changes what every keyref in this
    // topic resolves to, though no file it reads changed, so the file watcher
    // above never hears of it.
    const keyContextSubscription = onKeyContextChanged(() => requestUpdate('content'));

    updateWebview();

    webviewPanel.onDidDispose(() => {
      disposed = true;
      if (visibleRangeTimer) clearTimeout(visibleRangeTimer);
      if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
      changeSubscription.dispose();
      referencedFilesWatcher.dispose();
      editorSub.dispose();
      selectionSub.dispose();
      themeSubscription.dispose();
      viewStateSubscription.dispose();
      keyContextSubscription.dispose();
      lastRenderedHtmlByUri.delete(document.uri.toString());
    });
  }

  /**
   * Renders just the DITA content (not the surrounding page chrome) --
   * shared by generateHtml (full page, used for initial load/theme switch/
   * refresh) and the incremental content-only update path used for every
   * regular source edit. Pulled out specifically so a content edit no
   * longer needs webview.html reassigned wholesale (a full page reload)
   * just to get fresh content onto the page -- see postContentUpdate.
   */
  /**
   * Renders the topic's content div, reporting (on success) which source
   * files the render read -- see the `dependencies` note in
   * resolveCustomTextEditor.
   */
  private renderTopicContent(
    document: vscode.TextDocument,
    webview: vscode.Webview,
    onDependencies?: (files: ReadonlySet<string>) => void,
  ): { html: string; error?: undefined } | { html?: undefined; error: string } {
    const { result, files } = trackSourceReads(() => this.renderTopicContentUntracked(document, webview));
    if (result.error === undefined) onDependencies?.(files);
    return result;
  }

  private renderTopicContentUntracked(
    document: vscode.TextDocument,
    webview: vscode.Webview,
  ): { html: string; error?: undefined } | { html?: undefined; error: string } {
    const docRootDir = dirname(document.uri.fsPath);
    const asWebviewUri = (relPath: string): string => {
      try {
        const resolvedPath = resolve(docRootDir, decodeHrefPart(relPath));
        return webview.asWebviewUri(vscode.Uri.file(resolvedPath)).toString();
      } catch (e) {
        // The empty src still surfaces as a visibly broken image (the
        // webview script's document-level error listener marks it); log
        // the cause so path-resolution failures are debuggable.
        console.warn(`Failed to resolve webview URI for ${relPath}:`, e instanceof Error ? e.message : e);
        return '';
      }
    };

    try {
      const rawXml = document.getText();
      const preprocessedXml = preprocessEntities(rawXml);
      const ditaDoc = parseDita(preprocessedXml);
      const titleMap = buildTitleMap(ditaDoc.root);

      // Build key map from DITAMAP
      const keyMap = buildKeyMap(document.uri);

      // Note/index labels, conref/title resolvers and image dimensions all
      // come from the shared buildRenderContext factory (renderContext.ts) --
      // the same wiring the book/site path and the diff panel use, so a
      // resolver change lands once. uiLanguage keeps the previous fallback:
      // the topic's own xml:lang wins, else the editor display language.
      const { ctx } = buildRenderContext({
        docDir: docRootDir,
        ownRoot: ditaDoc.root,
        titleMap,
        keyMap,
        asWebviewUri,
        headingLevel: 1,
        uiLanguage: vscode.env.language,
        includeIndexLabel: true,
        docFile: document.uri.fsPath,
        markConrefs: true,
      });

      const content = renderDocument(ditaDoc.root, ctx);

      return { html: content };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: message };
    }
  }

  private generateHtml(
    document: vscode.TextDocument,
    webview: vscode.Webview,
    initialScrollLine?: number,
    onDependencies?: (files: ReadonlySet<string>) => void,
  ): { html: string; failed: boolean } {
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.file(join(this.context.extensionPath, 'media', 'styles.css')),
    );

    const result = this.renderTopicContent(document, webview, onDependencies);
    if (result.error !== undefined) {
      const message = result.error;
      return { failed: true, html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Error</title></head>
<body>
<div style="padding:2rem;color:#c0392b;">
<h2>Render Error</h2>
<pre>${escapeHtml(message)}</pre>
</div>
</body>
</html>` };
    }
    const content = result.html;

    try {
      const { files, defaultName: discoveredDefaultName } = discoverCssFiles(document.uri);
      // A previously-selected CSS file (persisted per-document, see
      // CSS_SELECTION_KEY above) takes priority over discoverCssFiles()'s
      // own always-recomputed default, but only if that file still exists
      // in this document's discovered set -- it may not (e.g. the file
      // was deleted, or this is actually a different document that
      // happens to reuse a stale uri-keyed entry).
      const persistedCssSelection = readForDocument<string>(this.context.globalState, CSS_SELECTION_KEY, document.uri);
      const defaultName = persistedCssSelection && files[persistedCssSelection] ? persistedCssSelection : discoveredDefaultName;
      const defaultContent = files[defaultName] || '';
      const widthSelection = readForDocument<string>(this.context.globalState, WIDTH_SELECTION_KEY, document.uri) || '';

      const theme = vscode.window.activeColorTheme;
      const isDark = theme.kind === vscode.ColorThemeKind.Dark || theme.kind === vscode.ColorThemeKind.HighContrast;

      const script = getWebviewScript();
      const cssFilesJson = escapeJson(JSON.stringify(files));
      const defaultNameJson = escapeJson(JSON.stringify(defaultName));
      const widthSelectionJson = escapeJson(JSON.stringify(widthSelection));
      const fontPrefs = this.context.globalState.get(FONT_PREFS_KEY, DEFAULT_FONT_PREFS);
      const fontPrefsJson = escapeJson(JSON.stringify(fontPrefs));
      const tagTooltips = this.context.globalState.get(TAG_TOOLTIPS_KEY, DEFAULT_TAG_TOOLTIPS);
      const tagTooltipsJson = escapeJson(JSON.stringify(tagTooltips));
      const initialScrollLineJs = typeof initialScrollLine === 'number' && Number.isFinite(initialScrollLine)
        ? String(Math.max(0, Math.floor(initialScrollLine)))
        : 'null';

      // CSP nonce for defense-in-depth against XSS
      const nonce = randomBytes(16).toString('base64');

      return { failed: false, html: `<!DOCTYPE html>
<html lang="en"${isDark ? ' class="vscode-dark"' : ''}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${webview.cspSource} data:; base-uri 'none';">
<link rel="stylesheet" href="${stylesUri}">
${defaultContent ? `<style>\n${defaultContent}\n</style>` : ''}
<title>${escapeHtml(document.fileName)}</title>
<script nonce="${nonce}">window.__cssFiles=${cssFilesJson};window.__defaultCss=${defaultNameJson};window.__widthSelection=${widthSelectionJson};window.__fontPrefs=${fontPrefsJson};window.__tagTooltips=${tagTooltipsJson};window.__initialScrollLine=${initialScrollLineJs};</script>
</head>
<body>
<div id="dita-content-root">${content}</div>
<script nonce="${nonce}">${script}</script>
</body>
</html>` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { failed: true, html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Error</title></head>
<body>
<div style="padding:2rem;color:#c0392b;">
<h2>Render Error</h2>
<pre>${escapeHtml(message)}</pre>
</div>
</body>
</html>` };
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Exported so MapViewerProvider.ts's own <script> bootstrap (font prefs and
// width selection, the two pieces of state it shares with this provider --
// see FONT_PREFS_KEY and WIDTH_SELECTION_KEY above) escapes the same way
// rather than carrying a second copy of a one-line regex to drift from.
export function escapeJson(text: string): string {
  return text.replace(/<\/script>/gi, '<\\/script>');
}

// ── Keyref: parse DITAMAP for key→value mappings ──

// findDitamapFiles/buildKeyMap and discoverCssFiles now live in
// ./keyMap and ./cssDiscovery respectively -- extracted verbatim, see those
// files for the byte-for-byte-unchanged implementations. Re-exported here
// so MapViewerProvider.ts, ditaDiffProvider.ts, exportHtml.ts,
// extension.ts, ditaLanguageFeatures.ts and ditaMapTreeProvider.ts don't
// need their import paths touched.
export { findDitamapFiles, buildKeyMap, getKeySourceMaps };