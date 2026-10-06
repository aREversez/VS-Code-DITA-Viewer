import * as vscode from 'vscode';
import { parseDitamap, preprocessEntities } from '../parser/ditaParser';
import { renderMapDocument, collectMapEntries } from '../render/mapTypeMap';
import { openSourceBesidePreview } from './sourceEditorOpener';
import { discoverTemplates, discoverTemplateRoots, templateDisplayName, SiteTemplate, TemplateRoot } from './siteTemplates';
import { buildTemplateStyleText, templateBodyAttrs, templateDataAttr } from './templateStyle';
import { mapTitleFromXml, renderChrome, wrapShell } from './templateChrome';
import { TEMPLATE_SELECTION_KEY, parseTemplateSelection, withTemplate, pickTemplate } from './templateSelection';
import { readFileSync } from 'fs';
import { getMapWebviewScript } from './webview/mapScript';
import { MSG_BOOK_SEARCH, MSG_BOOK_SEARCH_RESULTS, MSG_NAV_CONTEXT, MSG_OPEN_TOPIC_SOURCE, MSG_REQUEST_FULL_RENDER, MSG_SET_FONT_PREFS, MSG_SET_NAV_COLLAPSED, MSG_SET_TAG_TOOLTIPS, MSG_SET_TEMPLATE, MSG_SET_WIDTH_SELECTION, MSG_SWITCH_SITE_PAGE } from './mapMessages';
import { renderBookParts, wrapBookParts, escapeHtml, escapeAttr, expandDitamapRefs, decodeHrefPart, openHrefTarget, buildBookNavManifest, siteNavigableEntries, renderSiteNavTreeHtml, wrapSiteNavTreeHtml, getInitialSidebarBodyClass, renderTopicCached, makeFileTitleResolver, makeFileTopicTypeResolver, DocsiteNavEntry, SITE_HOME_TARGET, buildSiteHomeTiles, renderSiteHomeHtml } from './ditaRenderUtils';
import { getBookSearchIndex, searchBookIndex, buildBookSearchResultsPayload, invalidateBookSearchIndex } from './bookSearchIndex';
import { acquireDitaFileWatcher, ditaWatchBase } from './ditaFileWatcher';
import { BookPart } from './bookPatch';
import { RenderedMapContent, GeneratedMapHtml } from './mapRenderTypes';
import { MapPanelController, MapPanelHost } from './mapPanelController';
import { onKeyContextChanged } from './keyContext';
import { buildKeyMap, FONT_PREFS_KEY, DEFAULT_FONT_PREFS, WIDTH_SELECTION_KEY, TAG_TOOLTIPS_KEY, DEFAULT_TAG_TOOLTIPS, escapeJson } from './DitaViewerProvider';
import { formatLocalizedRole } from '../language/bookRoleL10n';
import { basename, dirname, join, resolve } from 'path';
import { randomBytes } from 'crypto';
import { readForDocument, writeForDocument } from './perDocumentState';
import { trackSourceReads } from './sourceText';
import { MAP_VIEW_STATE_KEY, parseMapViewState } from './mapViewState';

// Test-only hook: see the identical comment in DitaViewerProvider.ts.
const lastRenderedHtmlByUri = new Map<string, string>();

export function getLastRenderedMapHtmlForTesting(uriString: string): string | undefined {
  return lastRenderedHtmlByUri.get(uriString);
}

/**
 * Clears the cached rendered map HTML. Entries are already removed
 * individually as each webview panel disposes; this is a defensive full
 * reset for extension deactivation, not a fix for an actual leak. Called
 * from clearAllCaches() in DitaViewerProvider.ts via extension.ts's
 * deactivate().
 */
export function clearMapCache(): void {
  lastRenderedHtmlByUri.clear();
}

// Only the non-default state is ever stored -- a sidebar row defaults to
// expanded (see renderSiteNavTreeHtml's own comment), so this is the set
// of ids that are collapsed, not a full expanded/collapsed map of every
// row. Local to this file (unlike FONT_PREFS_KEY/WIDTH_SELECTION_KEY,
// which the topic viewer also reads/writes): the sidebar this state
// describes only exists in MapViewerProvider's own book/site modes.
//
// Ids that no longer correspond to anything in the current map (a branch
// that was deleted, or renamed such that its positional grp: id shifted)
// are never actively pruned here -- they simply never match a rendered
// row's own id again (see renderSiteNavTreeHtml's `collapsedIds.has`
// check) and sit inert in storage. A person editing one map rarely
// accumulates enough dead ids for this to matter, and pruning would need
// the full current manifest at write time, which the message handler
// below does not have to hand.
const COLLAPSED_NAV_KEY = 'ditaViewer.collapsedNavNodes';

// Localized topic-type labeler for the docsite sidebar's per-entry chip:
// every known DITA topic root gets a localized short label
// ("Concept"/"概念", "Task"/"任务", ..., and the generic `<topic>` itself,
// "Topic"/"主题"). Passed to makeFileTopicTypeResolver, which calls it with
// the topic file's root tag name (sniffed off the front of the file, not
// fully parsed -- see that function's own comment). Mirrors
// formatLocalizedRole's own contract (see bookRoleL10n.ts): the render
// layer stays pure, VS Code callers inject translated display text.
const TOPIC_TYPE_LABELS: Record<string, () => string> = {
  topic: () => vscode.l10n.t('Topic'),
  concept: () => vscode.l10n.t('Concept'),
  task: () => vscode.l10n.t('Task'),
  reference: () => vscode.l10n.t('Reference'),
  troubleshooting: () => vscode.l10n.t('Troubleshooting'),
  glossentry: () => vscode.l10n.t('Glossary Entry'),
  glossgroup: () => vscode.l10n.t('Glossary Group'),
};
function localizeTopicTypeLabel(tagName: string): string | undefined {
  if (!tagName) return undefined;
  const factory = TOPIC_TYPE_LABELS[tagName];
  if (factory) return factory();
  // Unknown specializations (custom domains, future DITA modules) fall
  // back to a capitalized tag name rather than disappearing entirely --
  // the chip's whole point is to show *something* the reader can scan,
  // and "this is an unfamiliar type" is still more useful than nothing.
  return tagName.charAt(0).toUpperCase() + tagName.slice(1);
}

export class MapViewerProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const documentRoot = vscode.Uri.file(dirname(document.uri.fsPath));
    const webview = webviewPanel.webview;
    // One MapViewerProvider instance resolves every map panel in the window, so
    // the per-panel state (mode, what the last render read, what a hidden panel
    // is owed, what to diff against) lives in a controller made per panel, not
    // in fields here -- two panels would diff against each other's documents.
    const panel = new MapPanelController(this.panelHost(document, webviewPanel));

    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(this.context.extensionPath),
        documentRoot,
        ...(vscode.workspace.workspaceFolders || []).map((f) => f.uri),
        // User template folders (dita-viewer.templatesDirectory), so a
        // template's fonts and images can load. Fixed for the panel's
        // lifetime, like the rest of these roots.
        ...this.templateRoots(document).filter((r) => !r.builtin).map((r) => vscode.Uri.file(r.dir)),
      ],
    };

    webview.onDidReceiveMessage((message) => this.handleWebviewMessage(message, document, webviewPanel, panel));

    const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      panel.onDocumentChanged();
    });

    // Same rationale as DitaViewerProvider's referencedFilesWatcher: a
    // ditamap's topicrefs/keydefs/maprefs and each inlined topic's own
    // conref/image references routinely point outside this document, so
    // only watching this document itself (above) misses edits to the very
    // files book/outline mode is built from. Watches the containing
    // workspace folder broadly rather than the resolved reference set for
    // the same reason given there, and shares that folder's watcher with
    // every other panel and with the map tree -- a map open beside three
    // topic previews is one watcher serving four consumers, not four
    // watchers. See ditaFileWatcher.ts.
    const referencedFilesWatcher = acquireDitaFileWatcher(ditaWatchBase(document.uri), (event) => {
      if (event.uri.toString() === document.uri.toString()) return; // already handled above
      panel.onReferencedFileEvent(event, event.uri.fsPath);
    });

    // Re-render on theme switch so the manually-computed light/dark class
    // never goes stale relative to the actual active theme. A genuine full
    // reload, unlike a content update -- the class lives on <html>, outside
    // the content div a content-only update touches.
    const themeSubscription = vscode.window.onDidChangeActiveColorTheme(() => {
      panel.requestUpdate('full');
    });

    const viewStateSubscription = webviewPanel.onDidChangeViewState(() => panel.onVisibilityChanged());

    const keyContextSubscription = onKeyContextChanged(() => panel.onKeyContextChanged());

    void panel.start();

    webviewPanel.onDidDispose(() => {
      panel.dispose();
      changeSubscription.dispose();
      referencedFilesWatcher.dispose();
      themeSubscription.dispose();
      viewStateSubscription.dispose();
      keyContextSubscription.dispose();
      lastRenderedHtmlByUri.delete(document.uri.toString());
    });
  }

  /** What a panel's controller needs from the editor: rendering, the webview and the stored view. */
  private panelHost(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel): MapPanelHost {
    const webview = webviewPanel.webview;
    return {
      isVisible: () => webviewPanel.visible,
      setHtml: (html) => {
        webview.html = html;
      },
      post: (message) => {
        void webview.postMessage(message);
      },
      loadingHtml: () => this.generateLoadingHtml(webview),
      generateHtml: (mode, sitePage) => this.generateHtml(document, webview, mode, sitePage),
      renderMapContent: (mode, sitePage) => this.renderMapContent(document, webview, mode, sitePage),
      loadSiteManifest: () => {
        const built = this.buildSiteManifest(document);
        return built.error !== undefined ? undefined : { manifest: built.manifest, keyMap: built.keyMap, bookMembers: built.bookMembers };
      },
      renderSiteHome: (manifest) => this.renderSiteHomeContent(document, manifest),
      renderSiteTopic: (absPath, keyMap, bookMembers) => this.renderSiteTopicContent(absPath, webview, keyMap, bookMembers),
      readViewState: () => parseMapViewState(readForDocument(this.context.globalState, MAP_VIEW_STATE_KEY, document.uri)),
      writeViewState: (state) => writeForDocument(this.context.globalState, MAP_VIEW_STATE_KEY, document.uri, state),
      recordRenderedHtml: (html) => {
        lastRenderedHtmlByUri.set(document.uri.toString(), html);
      },
      nextTick: () => new Promise<void>((resolve) => setImmediate(resolve)),
    };
  }

  /** Routes what the webview script posts. Anything that touches panel state goes through the controller. */
  private handleWebviewMessage(
    message: { type?: string; [key: string]: unknown },
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    panel: MapPanelController,
  ): void {
    switch (message.type) {
      case 'refresh':
        panel.requestUpdate('full');
        return;
      case 'openTopic':
        this.handleOpenTopic(message, document);
        return;
      case 'openImagemapLink':
        this.handleOpenImagemapLink(message, document);
        return;
      case 'switchMode': {
        const newMode = message.mode as 'tree' | 'book' | 'site';
        if (newMode !== 'tree' && newMode !== 'book' && newMode !== 'site') return;
        panel.switchMode(newMode);
        return;
      }
      case MSG_SET_TEMPLATE:
        this.handleSetTemplate(message, document, panel);
        return;
      case MSG_OPEN_TOPIC_SOURCE:
        this.handleOpenTopicSource(message, webviewPanel, panel);
        return;
      case MSG_NAV_CONTEXT:
        this.handleNavContext(message, document, webviewPanel);
        return;
      case MSG_SWITCH_SITE_PAGE:
        panel.switchSitePage(message.target as string);
        return;
      case MSG_BOOK_SEARCH:
        this.handleBookSearch(message, document, webviewPanel, panel);
        return;
      case MSG_REQUEST_FULL_RENDER:
        // The webview declined a patch: its DOM does not match the baseline
        // the indices were computed against. Straight to a full render rather
        // than requestUpdate('full') -- the panel is visible by definition, a
        // hidden webview is not running the script that sent this -- and a
        // full render also resets the book baseline to the document just sent,
        // which is what makes the next patch trustworthy again.
        void panel.requestFullRender();
        return;
      default:
        this.handlePreferenceMessage(message, document);
    }
  }

  private handleOpenTopic(message: { [key: string]: unknown }, document: vscode.TextDocument): void {
    const href = message.href as string;
    if (!href) return;
    const mapDir = dirname(document.uri.fsPath);
    const filePart = decodeHrefPart(href.split('#')[0]);
    const targetPath = resolve(mapDir, filePart);
    const targetUri = vscode.Uri.file(targetPath);
    // Decide the viewer by the file part only — "sub.ditamap#id" must
    // still open in the map preview.
    const viewType = filePart.toLowerCase().endsWith('.ditamap') ? 'ditaViewer.mapPreview' : 'ditaViewer.preview';
    vscode.commands.executeCommand('vscode.openWith', targetUri, viewType);
  }

  private handleOpenImagemapLink(message: { [key: string]: unknown }, document: vscode.TextDocument): void {
    // Image-map hotspot click (getImageMapSupportScript): resolve the
    // raw href against the map's folder -- the same base openTopic
    // above uses -- and open it in the right place. Book-internal
    // targets never arrive here (the webview guard leaves those to
    // the site/book click handlers).
    const href = typeof message.href === 'string' ? message.href : '';
    if (href) openHrefTarget(vscode, href, dirname(document.uri.fsPath));
  }

  private handleSetTemplate(message: { [key: string]: unknown }, document: vscode.TextDocument, panel: MapPanelController): void {
    // Only 'site'/'book' views have a template, and only a template that
    // exists (or '' for none) can be chosen -- the id is untrusted input.
    const id = typeof message.id === 'string' ? message.id : '';
    const view = panel.mode === 'book' ? 'book' : panel.mode === 'site' ? 'site' : undefined;
    if (!view) return;
    if (id !== '' && !this.loadTemplates(document).some((t) => t.id === id)) return;
    const prev = parseTemplateSelection(readForDocument(this.context.globalState, TEMPLATE_SELECTION_KEY, document.uri));
    writeForDocument(this.context.globalState, TEMPLATE_SELECTION_KEY, document.uri, withTemplate(prev, view, id));
    panel.requestUpdate('full');
  }

  private handleOpenTopicSource(message: { [key: string]: unknown }, webviewPanel: vscode.WebviewPanel, panel: MapPanelController): void {
    // Only a topic of this map's own manifest may be opened -- the
    // webview is untrusted input for a path.
    const target = message.target;
    if (typeof target !== 'string' || !panel.siteManifest) return;
    if (!siteNavigableEntries(panel.siteManifest.manifest).some((entry) => entry.absPath === target)) return;
    void openSourceBesidePreview(vscode.Uri.file(target), webviewPanel.viewColumn);
  }

  private handleNavContext(message: { [key: string]: unknown }, document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel): void {
    // The sidebar row context menu. Map-level actions carry no target;
    // row-scoped ones resolve the untrusted `target` against this map's
    // manifest, rebuilt on demand here rather than read from
    // siteManifestCache -- that cache is only warm in site mode, while
    // the menu exists in book mode too, and a right-click is a one-off
    // action where the re-parse is cheaper than threading a manifest
    // through book mode's render.
    const action = typeof message.action === 'string' ? message.action : '';
    const target = typeof message.target === 'string' ? message.target : '';
    if (action === 'openMapSource') {
      void openSourceBesidePreview(document.uri, webviewPanel.viewColumn);
      return;
    }
    if (action === 'findUnreferenced') {
      void this.findUnreferencedInPreviewMap(document);
      return;
    }
    if (!target) return;
    const built = this.buildSiteManifest(document);
    if (built.error !== undefined) return;
    const entry = siteNavigableEntries(built.manifest).find((e) => e.absPath === target);
    if (!entry) return;
    const uri = vscode.Uri.file(entry.absPath);
    switch (action) {
      case 'openSource':
        void openSourceBesidePreview(uri, webviewPanel.viewColumn);
        break;
      case 'openWithOxygen':
        void vscode.commands.executeCommand('ditaViewer.openWithOxygen', uri);
        break;
      case 'revealInExplorer':
        void vscode.commands.executeCommand('revealFileInOS', uri);
        break;
      case 'exportHtml':
        void vscode.commands.executeCommand('ditaViewer.exportHtml', uri);
        break;
      case 'copyTitle':
        void vscode.env.clipboard.writeText(entry.title);
        break;
      case 'copyHref':
        if (entry.href) void vscode.env.clipboard.writeText(entry.href);
        else void vscode.window.showInformationMessage(vscode.l10n.t('This entry has no href to copy.'));
        break;
    }
  }

  private handleBookSearch(
    message: { [key: string]: unknown },
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    panel: MapPanelController,
  ): void {
    // Reuses the controller's cached manifest when it is already warm (the common
    // case: the person opened site mode, which is the only mode this
    // search box exists in, before ever touching it) rather than
    // re-parsing the map -- same rationale as postSitePageUpdate's own
    // reuse of it. getBookSearchIndex is its own separate lazy cache on
    // top of that (docsite design doc, 3.1): the manifest gives it
    // which topics to index, but the actual per-topic text extraction
    // only happens once per book per edit, not once per keystroke.
    const query = typeof message.query === 'string' ? message.query : '';
    const searchOptions = {
      caseSensitive: message.caseSensitive === true,
      useRegex: message.useRegex === true,
    };
    let site = panel.siteManifest;
    if (!site) {
      const built = this.buildSiteManifest(document);
      site = built.error !== undefined ? undefined : { manifest: built.manifest, keyMap: built.keyMap, bookMembers: built.bookMembers };
    }
    if (!site) {
      webviewPanel.webview.postMessage({ type: MSG_BOOK_SEARCH_RESULTS, results: [] });
      return;
    }
    const searchDocDir = dirname(document.uri.fsPath);
    // The manual refresh button (getBookSearchScript's bsRefreshBtn):
    // getBookSearchIndex's own stamp-based staleness check (sourceStamp:
    // mtime and size on disk, the unsaved text for an open dirty
    // document) already catches an edited topic on its own, so this only
    // matters for
    // the reassurance case of forcing a rebuild anyway.
    if (message.refresh === true) invalidateBookSearchIndex(searchDocDir);
    const searchIndex = getBookSearchIndex(searchDocDir, site.manifest);
    const navigable = siteNavigableEntries(site.manifest);
    const outcome = searchBookIndex(searchIndex, query, navigable.map((m) => m.absPath), searchOptions);
    if (outcome.error) {
      webviewPanel.webview.postMessage({ type: MSG_BOOK_SEARCH_RESULTS, results: [], error: outcome.error });
      return;
    }
    const titleByPath = new Map(navigable.map((m) => [m.absPath, m.title] as const));
    // Capped rather than sent in full (see MAX_BOOK_SEARCH_RESULTS): a
    // broad query against a very large book could otherwise match most
    // of it, and the panel has no pagination. The pre-cap total goes
    // along so the panel can say the list was cut.
    const payload = buildBookSearchResultsPayload(outcome.hits, titleByPath);
    webviewPanel.webview.postMessage({ type: MSG_BOOK_SEARCH_RESULTS, ...payload });
  }

  /** Font, width, tag-tooltip and sidebar-fold preferences: stored per person or per document, never touching panel state. */
  private handlePreferenceMessage(message: { [key: string]: unknown }, document: vscode.TextDocument): void {
    if (message.type === MSG_SET_FONT_PREFS) {
      // Same key the topic viewer writes (FONT_PREFS_KEY, imported from
      // DitaViewerProvider.ts) -- font size and typeface describe how the
      // person likes to read, not which provider is showing them the
      // document, so one preference for both rather than a second copy
      // that could silently disagree with it.
      const size = typeof message.size === 'number' ? message.size : DEFAULT_FONT_PREFS.size;
      const serif = message.serif === true;
      this.context.globalState.update(FONT_PREFS_KEY, { size, serif });
    } else if (message.type === MSG_SET_WIDTH_SELECTION) {
      // Same map the topic viewer keeps (WIDTH_SELECTION_KEY), keyed by
      // this document's own uri -- a ditamap's uri cannot collide with a
      // topic's, so the two providers sharing the map costs nothing.
      if (typeof message.value === 'string') {
        writeForDocument(this.context.globalState, WIDTH_SELECTION_KEY, document.uri, message.value);
      }
    } else if (message.type === MSG_SET_TAG_TOOLTIPS) {
      this.context.globalState.update(TAG_TOOLTIPS_KEY, message.value === true);
    } else if (message.type === MSG_SET_NAV_COLLAPSED) {
      // Full-set replace, matching what reportSiteNavCollapseState always
      // sends (see its own comment) -- never a merge with the previous
      // value, so a row expanded client-side is reliably absent from the
      // next render even though this handler never sees which id changed.
      if (Array.isArray(message.ids)) {
        const ids = message.ids.filter((id: unknown): id is string => typeof id === 'string');
        writeForDocument(this.context.globalState, COLLAPSED_NAV_KEY, document.uri, ids);
      }
    }
  }

  private buildSiteManifestFromParsedMap(
    mapRoot: import('../parser/domTypes').DitaNode,
    document: vscode.TextDocument,
    docDir: string,
  ): { keyMap: Map<string, string>; manifest: DocsiteNavEntry[]; bookMembers: ReadonlySet<string> } {
    const keyMap = buildKeyMap(document.uri);
    const entries = collectMapEntries(mapRoot, (k) => keyMap.get(k));
    // makeFileTitleResolver reads a topic file's own <title> off disk --
    // only actually invoked for entries the map itself never named
    // (buildBookNavManifest's own resolveTopicTitle contract), so a
    // well-authored map with real navtitles everywhere pays nothing extra
    // here beyond the resolver's own construction.
    //
    // makeFileTopicTypeResolver, unlike the title resolver, is called for
    // every entry with an href regardless of whether the map named it --
    // a topic's type isn't something the map ever states on its own. It
    // stays cheap despite being unconditional because it only sniffs the
    // root tag (a bounded read, not a full parse) rather than sharing the
    // title resolver's DOM-based file cache; see that function's own
    // comment for why a full parse here would reintroduce exactly the
    // O(topics-in-book) cost docsite mode exists to avoid.
    const manifest = buildBookNavManifest(
      entries,
      docDir,
      makeFileTitleResolver(docDir),
      makeFileTopicTypeResolver(docDir, localizeTopicTypeLabel),
    );
    // Book-internal cross-topic xref (docsite design doc, 3.2/4.5): built
    // once here, alongside the manifest it's derived from, and handed as
    // the SAME instance to every renderSiteTopicContent call made against
    // this manifest (both the initial page render below and every later
    // page-switch in postSitePageUpdate) -- renderTopicCached's own cache
    // keys bookMembers by identity, so reusing this instance rather than
    // building a fresh Set per page switch is what keeps switching pages
    // back and forth cheap instead of silently re-rendering every time.
    const bookMembers = new Set(siteNavigableEntries(manifest).map((entry) => entry.absPath));
    return { keyMap, manifest, bookMembers };
  }

  private buildSiteManifest(
    document: vscode.TextDocument,
  ):
    | { docDir: string; keyMap: Map<string, string>; manifest: DocsiteNavEntry[]; bookMembers: ReadonlySet<string>; error?: undefined }
    | { error: string } {
    const docDir = dirname(document.uri.fsPath);
    try {
      const rawXml = document.getText();
      const preprocessedXml = preprocessEntities(rawXml);
      const mapDoc = parseDitamap(preprocessedXml);
      expandDitamapRefs(mapDoc.root, docDir);
      const { keyMap, manifest, bookMembers } = this.buildSiteManifestFromParsedMap(mapDoc.root, document, docDir);
      return { docDir, keyMap, manifest, bookMembers };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: message };
    }
  }

  /**
   * "Find Unreferenced Resources" for this preview's own map: opens the
   * dialog (unreferencedResourcesUi.ts) on the document this panel is showing
   * rather than whichever map the tree happens to have active -- the two
   * views can legitimately be on different maps.
   */
  private async findUnreferencedInPreviewMap(document: vscode.TextDocument): Promise<void> {
    await vscode.commands.executeCommand('ditaViewer.findUnreferencedResources', document.uri);
  }

  /**
   * Renders exactly one topic's content for docsite mode -- the sidebar
   * (built separately, see buildBookNavManifest/renderSiteNavHtml) never
   * needs to re-render alongside it, which is the entire point of docsite
   * mode over Book mode: switching pages costs one renderTopicCached call,
   * not every topic in the map.
   *
   * headingLevel: 1 and a topic-relative asWebviewUri, matching
   * DitaViewerProvider's own single-topic render -- a docsite page is
   * meant to read exactly like opening that topic directly, same
   * philosophy Book mode's own per-entry render already follows (see
   * renderBookParts' own comment).
   */
  private renderSiteTopicContent(
    absPath: string,
    webview: vscode.Webview,
    keyMap: Map<string, string>,
    bookMembers: ReadonlySet<string>,
  ): { html: string; error?: undefined } | { html?: undefined; error: string } {
    const topicDir = dirname(absPath);
    const asWebviewUri = (relPath: string): string => {
      try {
        return webview.asWebviewUri(vscode.Uri.file(resolve(topicDir, decodeHrefPart(relPath)))).toString();
      } catch (e) {
        console.warn(`Failed to resolve webview URI for ${relPath}:`, e instanceof Error ? e.message : e);
        return '';
      }
    };
    const result = renderTopicCached({
      filePath: absPath,
      keyMap,
      asWebviewUri,
      headingLevel: 1,
      uiLanguage: vscode.env.language,
      bookMembers,
    });
    if (result.error) return { error: result.error };
    return { html: result.html };
  }

  /**
   * Docsite mode's home page (renderMapContentUntracked's and
   * postSitePageUpdate's shared SITE_HOME_TARGET branch): the map/book's own
   * title (mapTitleFromXml -- the same source generateHtml's `<h1>`-less
   * chrome header uses) plus one tile per buildSiteHomeTiles entry. Reads no
   * topic file itself (unlike renderSiteTopicContent above), so it needs no
   * trackSourceReads wrapping of its own -- callers hand it pageFiles: new
   * Set() rather than a tracked result.
   */
  private renderSiteHomeContent(document: vscode.TextDocument, manifest: DocsiteNavEntry[]): string {
    const titleKeys = buildKeyMap(document.uri);
    const mapTitle = mapTitleFromXml(document.getText(), basename(document.fileName), (k) => titleKeys.get(k));
    const topicCountLabel = (count: number): string =>
      count === 1 ? vscode.l10n.t('1 topic') : vscode.l10n.t('{0} topics', count);
    return renderSiteHomeHtml(buildSiteHomeTiles(manifest, localizeTopicTypeLabel('topic')), { heading: mapTitle, topicCountLabel });
  }

  /**
   * Renders the map in a mode, reporting on success which source files the
   * render read (`files`) and, in site mode, which of those belong to the
   * topic page alone (`pageFiles`) -- see `dependencies` in
   * resolveCustomTextEditor.
   */
  private renderMapContent(
    document: vscode.TextDocument,
    webview: vscode.Webview,
    mode: 'tree' | 'book' | 'site',
    sitePageHint?: string,
  ): RenderedMapContent {
    const { result, files } = trackSourceReads(() => this.renderMapContentUntracked(document, webview, mode, sitePageHint));
    return result.error === undefined ? { ...result, files } : result;
  }

  private renderMapContentUntracked(
    document: vscode.TextDocument,
    webview: vscode.Webview,
    mode: 'tree' | 'book' | 'site',
    sitePageHint?: string,
  ): RenderedMapContent {
    const docDir = dirname(document.uri.fsPath);
    try {
      const rawXml = document.getText();
      const preprocessedXml = preprocessEntities(rawXml);
      const mapDoc = parseDitamap(preprocessedXml);

      // Expand topicrefs/keydefs that reference external .ditamap files
      // so their key-value pairs are visible inline in both tree and book mode
      expandDitamapRefs(mapDoc.root, docDir);

      if (mode === 'site') {
        // mapDoc.root is already parsed and expandDitamapRefs'd above --
        // reuse it rather than going through buildSiteManifest (which
        // re-parses from document.getText() for postSitePageUpdate's
        // benefit, where there is no already-parsed mapDoc to hand it).
        const { keyMap, manifest, bookMembers } = this.buildSiteManifestFromParsedMap(mapDoc.root, document, docDir);
        const navigable = siteNavigableEntries(manifest);
        if (navigable.length === 0) {
          return { error: vscode.l10n.t('This map has no topics to show in site view.') };
        }
        // sitePageHint is whatever the caller last knew as "current". Never
        // set (first render of this document in site mode -- mapViewState.ts
        // has no remembered sitePage yet) or explicitly SITE_HOME_TARGET
        // (the reader's last stop was the home page, or they just clicked the
        // home toolbar button) both resolve to the home page. Anything else
        // that no longer names a topic (the map was edited and that entry is
        // gone) falls back to the first entry, same as opening a book always
        // starts at its first topic -- home is only ever the *first* stop,
        // never a fallback for a since-vanished one.
        const resolvedSitePage =
          sitePageHint === undefined || sitePageHint === SITE_HOME_TARGET
            ? SITE_HOME_TARGET
            : navigable.some((m) => m.absPath === sitePageHint)
              ? sitePageHint
              : navigable[0].absPath;
        // The bare tree is returned as well as the wrapped nav: it is what an
        // in-place refresh sends as MSG_UPDATE_SIDEBAR (see refreshSiteInPlace).
        // resolvedSitePage never equals a real entry's absPath while it is
        // SITE_HOME_TARGET, so the home page renders with no sidebar row
        // marked active -- correct, the home page is not one of them.
        const sidebarTreeHtml = renderSiteNavTreeHtml(manifest, resolvedSitePage, {
          expand: vscode.l10n.t('Expand'),
          collapse: vscode.l10n.t('Collapse'),
        }, this.getCollapsedNavIds(document), true);
        const sidebarHtml = wrapSiteNavTreeHtml(sidebarTreeHtml, vscode.l10n.t('Topics'));
        if (resolvedSitePage === SITE_HOME_TARGET) {
          const homeHtml = this.renderSiteHomeContent(document, manifest);
          // manifest/keyMap/bookMembers go back to the caller too (see the
          // non-home return below for why); pageFiles is empty rather than
          // tracked -- the home page reads no topic file of its own.
          return { html: homeHtml, sidebarHtml, sidebarTreeHtml, resolvedSitePage, siteManifest: manifest, siteKeyMap: keyMap, siteBookMembers: bookMembers, pageFiles: new Set() };
        }
        const pageTracked = trackSourceReads(() => this.renderSiteTopicContent(resolvedSitePage, webview, keyMap, bookMembers));
        const topic = pageTracked.result;
        if (topic.error !== undefined) return { error: topic.error };
        // manifest/keyMap/bookMembers go back to the caller too
        // (updateWebview) so a page switch (postSitePageUpdate) can reuse
        // them instead of re-parsing the map, re-reading every
        // un-navtitled topic's <title> off disk, and rebuilding the book
        // membership set on every single click -- see that function's own
        // comment.
        return { html: topic.html, sidebarHtml, sidebarTreeHtml, resolvedSitePage, siteManifest: manifest, siteKeyMap: keyMap, siteBookMembers: bookMembers, pageFiles: pageTracked.files };
      }

      let content: string;
      // Parts are produced in book mode only. That is the one content worth
      // patching entry by entry: it is assembled from pieces that each carry a
      // stable identity, and it is the one that grows to megabytes. Outline
      // mode's tree is small and still goes out whole.
      let parts: BookPart[] | undefined;
      let sidebarHtml: string | undefined;
      let sidebarTreeHtml: string | undefined;
      if (mode === 'book') {
        const book = this.collectBookParts(mapDoc.root, document, webview, docDir);
        parts = book.parts;
        sidebarHtml = book.sidebarHtml;
        sidebarTreeHtml = book.sidebarTreeHtml;
        content = wrapBookParts(parts);
      } else {
        // Resolve <ph keyref="..."/> etc. in the map title and navtitles
        const keyMap = buildKeyMap(document.uri);
        content = renderMapDocument(mapDoc.root, {
          docDir,
          resolveKey: (k) => keyMap.get(k),
          roleFormat: formatLocalizedRole,
          treeLabel: vscode.l10n.t('Document outline'),
        });
      }
      return { html: content, parts, sidebarHtml, sidebarTreeHtml };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: message };
    }
  }

  private generateLoadingHtml(webview: vscode.Webview): string {
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.file(join(this.context.extensionPath, 'media', 'styles.css')),
    );
    const theme = vscode.window.activeColorTheme;
    const isDark = theme.kind === vscode.ColorThemeKind.Dark || theme.kind === vscode.ColorThemeKind.HighContrast;
    const label = vscode.l10n.t('Rendering book…');
    return `<!DOCTYPE html>
<html lang="en"${isDark ? ' class="vscode-dark"' : ''}>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; base-uri 'none';">
<link rel="stylesheet" href="${stylesUri}">
<title>DITA</title>
</head>
<body class="dita-loading">
<div class="dita-loading-spinner" role="status" aria-label="${escapeAttr(label)}"></div>
<div>${escapeHtml(label)}</div>
</body>
</html>`;
  }

  private generateHtml(
    document: vscode.TextDocument,
    webview: vscode.Webview,
    mode: 'tree' | 'book' | 'site',
    sitePageHint?: string,
  ): GeneratedMapHtml {
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.file(join(this.context.extensionPath, 'media', 'styles.css')),
    );

    const result = this.renderMapContent(document, webview, mode, sitePageHint);
    if (result.error !== undefined) {
      const message = result.error;
      // No parts on the error page: it is not a book, so there is nothing a
      // later incremental update could diff against, and the caller's
      // baseline has to drop back to "unknown".
      return {
        failed: true,
        html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Error</title></head>
<body>
<div style="padding:2rem;color:#c0392b;">
<h2>Map Render Error</h2>
<pre>${escapeHtml(message)}</pre>
</div>
</body>
</html>`,
      };
    }

    const templates = this.loadTemplates(document);
    const template = pickTemplate(
      parseTemplateSelection(readForDocument(this.context.globalState, TEMPLATE_SELECTION_KEY, document.uri)),
      mode,
      templates,
    );
    const script = getMapWebviewScript(
      templates.map((t) => ({ value: t.id, label: templateDisplayName(t, vscode.env.language) })),
      template?.id ?? '',
    );
    // The template's raw css (no <style> wrapper) is computed here so an
    // in-place mode switch can drop it into the persistent head element (the
    // stage's templateCss field). The head always carries a
    // `<style id="dita-template-style">`, empty when there is no template, so
    // that swap has a stable target across every mode/template combination.
    const templateCss = template
      ? buildTemplateStyleText(template, (p) => readFileSync(p, 'utf-8'), (p) => webview.asWebviewUri(vscode.Uri.file(p)).toString())
      : '';
    const templateStyle = `<style id="dita-template-style">\n${templateCss}\n</style>`;
    const templateBody = templateBodyAttrs(template);
    const titleKeys = buildKeyMap(document.uri);
    const mapTitle = mapTitleFromXml(document.getText(), basename(document.fileName), (k) => titleKeys.get(k));
    const mapTitleJson = escapeJson(JSON.stringify(mapTitle));
    const chrome = renderChrome(
      template,
      { title: mapTitle, year: new Date().getFullYear() },
      (p) => webview.asWebviewUri(vscode.Uri.file(p)).toString(),
    );
    const shell = wrapShell({
      sidebarHtml: result.sidebarHtml ?? '',
      resizerHtml: result.sidebarHtml ? '<div id="__site-nav-resizer" class="site-nav-resizer" role="separator" aria-orientation="vertical" tabindex="0"></div>' : '',
      contentRootHtml: `<div id="dita-content-root"${result.sidebarHtml ? ' class="site-main"' : ''}>${result.html}</div>`,
      // On-this-page outline column (site-book-templates-plan.md item 4):
      // site mode only, and only for a template that opted in via
      // template.json's "outline" field -- book mode never gets one,
      // regardless of the template, matching Adeline's call. The markup
      // itself is just the empty shell; getOutlineSyncScript builds and
      // maintains its content entirely client-side (see that function's
      // own doc comment for why).
      outlineHtml: mode === 'site' && template?.outline
        ? '<aside id="__site-outline" class="tpl-outline"><div class="tpl-outline-inner"></div></aside>'
        : undefined,
      headerHtml: chrome.headerHtml,
      footerHtml: chrome.footerHtml,
      // Route B: a template whose descriptor says dom "webhelp" gets the
      // WebHelp-style hook skeleton instead of the own shell (webhelpShell.ts).
      // Built-in templates stay "own", so this is a no-op for them. Header
      // content (top menu, breadcrumb) and the logo image land in later steps.
      dom: template?.dom,
      publicationTitle: mapTitle,
      logoUri: template?.logo ? webview.asWebviewUri(vscode.Uri.file(template.logo)).toString() : undefined,
    });
    const nonce = randomBytes(16).toString('base64');
    const theme = vscode.window.activeColorTheme;
    const isDark = theme.kind === vscode.ColorThemeKind.Dark || theme.kind === vscode.ColorThemeKind.HighContrast;

    // Font size/typeface (global, shared with the topic viewer -- see
    // FONT_PREFS_KEY above) and page width (per-document, keyed by this
    // map's own uri) read back the same way the topic viewer's generateHtml
    // reads them, so a preference set in either preview survives closing
    // and reopening this one.
    const fontPrefs = this.context.globalState.get(FONT_PREFS_KEY, DEFAULT_FONT_PREFS);
    const fontPrefsJson = escapeJson(JSON.stringify(fontPrefs));
    const widthSelection = readForDocument<string>(this.context.globalState, WIDTH_SELECTION_KEY, document.uri) || '';
    const widthSelectionJson = escapeJson(JSON.stringify(widthSelection));
    const tagTooltips = this.context.globalState.get(TAG_TOOLTIPS_KEY, DEFAULT_TAG_TOOLTIPS);
    const tagTooltipsJson = escapeJson(JSON.stringify(tagTooltips));

    // The sidebar shell below (nav + resizer + the content pane's own
    // .site-main class) is keyed on whether a sidebar was actually
    // produced, not on mode. Site mode always has one (renderMapContent
    // errors out earlier if the map has no navigable entries at all), but
    // book mode renders a map with no navigable entries -- every entry
    // resource-only, or a map of nothing but childless keydefs -- as a
    // book with an empty sidebar string. Keying the resizer and
    // .site-main on mode === 'book' instead would leave that book with a
    // drag handle attached to no sidebar, and a content pane flexed as if
    // one were there. media/styles.css's own flex shell rule is scoped the
    // matching way (body.mode-book:has(.site-nav)).

    // The full <body> class list this render produces (mode-*, template dark
    // marker, shell). hide-profiling is deliberately NOT part of it -- it is a
    // client-side toggle the webview owns and preserves across an in-place
    // switch, so it never appears in a host-computed body class.
    const bodyClass = `${getInitialSidebarBodyClass(mode)}${templateBody.className}${shell.bodyClass}`;

    return {
      html: `<!DOCTYPE html>
<html lang="en"${isDark ? ' class="vscode-dark"' : ''}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none';">
<link rel="stylesheet" href="${stylesUri}">
${templateStyle}
<title>${escapeHtml(document.fileName)}</title>
</head>
<body class="${bodyClass}"${templateBody.attrs}>
${shell.html}
<script nonce="${nonce}">window.__fontPrefs=${fontPrefsJson};window.__widthSelection=${widthSelectionJson};window.__tagTooltips=${tagTooltipsJson};window.__mapTitle=${mapTitleJson};</script>
<script nonce="${nonce}">${script}</script>
</body>
</html>`,
      parts: result.parts,
      sidebarTreeHtml: result.sidebarTreeHtml,
      resolvedSitePage: result.resolvedSitePage,
      siteManifest: result.siteManifest,
      siteKeyMap: result.siteKeyMap,
      siteBookMembers: result.siteBookMembers,
      files: result.files,
      pageFiles: result.pageFiles,
      // What site mode now has in the webview, the baseline the next
      // in-place refresh is diffed against (siteRender.ts).
      siteRender: mode === 'site' && result.sidebarTreeHtml !== undefined
        ? { sidebarTreeHtml: result.sidebarTreeHtml, pageHtml: result.html }
        : undefined,
      // Everything a switch INTO this mode needs to apply in place, without
      // reassigning webview.html (so the toolbar stays on the page). Absent on
      // the error page (there is no stage to apply); the switchMode handler
      // falls back to a full reload for a failed render.
      stage: {
        mode,
        bodyClass,
        templateCss,
        templateDataAttr: template ? templateDataAttr(template.id) : '',
        selectedTemplate: template?.id ?? '',
        shellHtml: shell.html,
        isShell: shell.bodyClass.includes('site-shell') || shell.bodyClass.includes('wh_topic_page'),
      },
    };
  }

  // Where templates live: the built-in ones shipped in media/templates, then
  // the folders of dita-viewer.templatesDirectory (later roots override
  // earlier ones with the same id, so a user template can replace a built-in).
  // The lookup itself is shared with the DITA-OT transform's picker
  // (discoverTemplateRoots in siteTemplates.ts).
  private templateRoots(document: vscode.TextDocument): TemplateRoot[] {
    return discoverTemplateRoots({
      extensionPath: this.context.extensionPath,
      configuredDirs: vscode.workspace.getConfiguration('dita-viewer').get<string[]>('templatesDirectory') ?? [],
      refDir: dirname(document.uri.fsPath),
      workspaceRoots: (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath),
    });
  }

  private loadTemplates(document: vscode.TextDocument): SiteTemplate[] {
    const { templates, diagnostics } = discoverTemplates(this.templateRoots(document));
    for (const d of diagnostics) console.warn(`[DITA Viewer] template ${d.dir}: ${d.message}`);
    return templates;
  }

  // nested-fold-and-highlight-plan.md item 3: persisted sidebar collapse
  // state, keyed per document the same way WIDTH_SELECTION_KEY is. Read
  // fresh on every call rather than cached on the class instance -- this
  // provider instance is long-lived across the panel's whole session, and
  // globalState.get is an in-memory lookup already (VS Code owns the
  // actual persistence), so there is no cost caching would save, only a
  // staleness risk if some other code path ever updates the same key.
  private getCollapsedNavIds(document: vscode.TextDocument): ReadonlySet<string> {
    return new Set(readForDocument<string[]>(this.context.globalState, COLLAPSED_NAV_KEY, document.uri) ?? []);
  }

  private collectBookParts(
    mapRoot: import('../parser/domTypes').DitaNode,
    document: vscode.TextDocument,
    webview: vscode.Webview,
    docDir: string,
  ): { parts: BookPart[]; sidebarHtml: string; sidebarTreeHtml: string } {
    // Build key map once for all entries. renderTopicCached compares it by
    // identity, so one instance for the whole pass is what makes reuse work.
    const keyMap = buildKeyMap(document.uri);
    const resolveKey = (k: string) => keyMap.get(k);
    const entries = collectMapEntries(mapRoot, resolveKey);

    // The assembly loop lives in ditaRenderUtils.renderBookParts so it can be
    // unit-tested -- and benchmarked against the same code that ships --
    // without a VS Code instance. This method contributes the two things that
    // genuinely need one: the map's key definitions and the webview's
    // resource-URI conversion.
    const parts = renderBookParts({
      entries,
      docDir,
      keyMap,
      fileToWebviewUri: (absPath) => webview.asWebviewUri(vscode.Uri.file(absPath)).toString(),
      uiLanguage: vscode.env.language,
    });

    // Book mode's own sidebar (nested-fold-and-highlight-plan.md item 1) --
    // built from the exact same entries/docDir renderBookParts itself just
    // consumed, so the ids buildBookNavManifest hands the sidebar links
    // (data-site-target) can never disagree with the ids renderBookParts
    // already stamped onto the matching part's own root element
    // (data-book-anchor) -- both trace back to the one shared
    // computeManifestEntryPositions helper (ditaRenderUtils.ts). currentAbsPath
    // (renderSiteNavHtml/renderSiteNavTreeHtml's "which link is active"
    // argument) has no real meaning for a single-page book the way it does
    // for site mode's one-topic-at-a-time pages; the first navigable entry
    // is passed purely so the sidebar starts with its top row visually
    // marked, matching where the book itself opens -- the book-mode click
    // handler (getBookNavClickHandlerScript) moves that mark as the reader
    // clicks, same as site mode's does.
    //
    // sidebarTreeHtml (just the <ul>, no <nav> wrapper) is what
    // postContentUpdate's book branch sends as MSG_UPDATE_SIDEBAR on every
    // source edit, alongside -- not instead of -- the existing incremental
    // content patch: see that call site's own comment for why the sidebar
    // needs its own refresh path rather than riding along with
    // diffBookParts.
    const manifest = buildBookNavManifest(
      entries,
      docDir,
      makeFileTitleResolver(docDir),
      makeFileTopicTypeResolver(docDir, localizeTopicTypeLabel),
    );
    const navigable = siteNavigableEntries(manifest);
    const toggleLabels = { expand: vscode.l10n.t('Expand'), collapse: vscode.l10n.t('Collapse') };
    // Read fresh on every call (including the incremental refresh path,
    // postContentUpdate -> collectBookParts -> MSG_UPDATE_SIDEBAR) rather
    // than threaded in from a caller -- an edit that only touches a
    // topic's body, with no collapse-state message in between, must still
    // re-render the sidebar with whatever was collapsed before that edit,
    // or the "keep the incremental content patch, side-band-refresh the
    // sidebar" design (nested-fold-and-highlight-plan.md item 1, option C)
    // would quietly blow away item 3's persisted state on every keystroke.
    const collapsedIds = this.getCollapsedNavIds(document);
    const sidebarTreeHtml = navigable.length > 0 ? renderSiteNavTreeHtml(manifest, navigable[0].absPath, toggleLabels, collapsedIds) : '';
    const sidebarHtml = navigable.length > 0 ? wrapSiteNavTreeHtml(sidebarTreeHtml, vscode.l10n.t('Topics')) : '';

    return { parts, sidebarHtml, sidebarTreeHtml };
  }
}


