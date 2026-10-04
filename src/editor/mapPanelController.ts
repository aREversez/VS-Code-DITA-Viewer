import { siteNavigableEntries, DocsiteNavEntry } from './ditaRenderUtils';
import { SITE_HOME_TARGET } from './webview/toolbarScripts';
import { diffBookParts, BookPart } from './bookPatch';
import { foldPendingRender, foldSiteRefresh, escalateAfterFailure, PendingRender, SiteRefresh } from './pendingRender';
import { MapMode, MapViewState, nextMapViewState } from './mapViewState';
import { diffSiteRender, SiteRender } from './siteRender';
import { dependsOn, trackSourceReads } from './sourceText';
import { affectsPanel } from './sourceOverlaySync';
import { MSG_PATCH_CONTENT, MSG_SWITCH_MODE, MSG_UPDATE_CONTENT, MSG_UPDATE_SIDEBAR } from './mapMessages';
import type { GeneratedMapHtml, RenderedMapContent, SiteManifestCache } from './mapRenderTypes';

// The per-panel state of one map preview, and the rules for what a render, an
// edit, a mode switch or a page switch does to it.
//
// This used to be ~15 `let`s and ten closures inside
// MapViewerProvider.resolveCustomTextEditor. One MapViewerProvider instance
// resolves every map panel in the window, so none of it could be a provider
// field (two panels would diff against each other's documents); it is an
// instance of this class per panel instead.
//
// Free of `vscode`: everything that touches the host -- rendering, the webview,
// the stored view -- comes in through MapPanelHost, so the rules are covered by
// unit tests with a fake one rather than only by driving a real window.

export interface MapPanelHost {
  isVisible(): boolean;
  /** Assigns webview.html: a full reload that replaces the document. */
  setHtml(html: string): void;
  /** Posts a message to the webview script (see mapMessages.ts). */
  post(message: { type: string; [key: string]: unknown }): void;
  /** The placeholder shown while book mode renders synchronously. */
  loadingHtml(): string;
  generateHtml(mode: MapMode, sitePage: string | undefined): GeneratedMapHtml;
  renderMapContent(mode: MapMode, sitePage?: string): RenderedMapContent;
  /** Builds the docsite manifest from the map as it stands, or undefined when the map cannot be parsed. */
  loadSiteManifest(): SiteManifestCache | undefined;
  renderSiteHome(manifest: DocsiteNavEntry[]): string;
  /** Renders one topic for site mode. Its source reads are tracked by the controller. */
  renderSiteTopic(
    absPath: string,
    keyMap: Map<string, string>,
    bookMembers: ReadonlySet<string>,
  ): { html: string; error?: undefined } | { html?: undefined; error: string };
  readViewState(): MapViewState | undefined;
  writeViewState(state: MapViewState): void;
  /** What the panel last put on screen, kept for tests and diagnostics. */
  recordRenderedHtml(html: string): void;
  /** Lets the webview process paint a placeholder before a synchronous render. */
  nextTick(): Promise<void>;
}

export interface PanelScheduler {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const defaultScheduler: PanelScheduler = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** How long a burst of edits settles before the preview re-renders. */
const RENDER_DEBOUNCE_MS = 300;

export class MapPanelController {
  private currentMode: MapMode;
  private currentSitePage: string | undefined;
  // A remembered mode has not yet been shown to render this map. Docsite view
  // of a map with no topics renders an error page, and that page has no
  // toolbar to leave it with -- so if the very first render fails,
  // updateWebview gives up on the remembered mode instead of trapping the
  // document in it on every later opening.
  private rememberedModeUnproven: boolean;
  // Set when that fallback happened. The outline tree that replaced the
  // remembered mode is a stopgap, not a choice: it must not overwrite the
  // remembered mode (the failure may be a map that was mid-edit, and the next
  // opening deserves another try). Cleared by the person's own next switch.
  private keepRememberedView = false;
  // The source files the last successful render read: everything (map, key
  // maps, topics, conref targets, sidebar titles) and, in site mode, just what
  // the page on screen read. They decide which unsaved edits elsewhere concern
  // this panel -- see affectsPanel -- and, in site mode, whether one needs only
  // the page refreshed. Kept across a failed render.
  private dependencies: ReadonlySet<string> | undefined;
  private pageDependencies: ReadonlySet<string> | undefined;
  // What a site-mode panel owes since the last time it rendered: see
  // foldSiteRefresh. postContentUpdate consumes it.
  private siteRefresh: SiteRefresh = 'none';
  // Whether the page on screen is the error document a failed render
  // produces -- bare, with no script, so a content message posted to it goes
  // nowhere. See escalateAfterFailure.
  private pageIsError = false;
  // What site mode last put in the webview, for diffing the next in-place
  // refresh against -- see siteRender.ts. undefined outside site mode, on an
  // error page, and before the first render: nothing to diff against, so the
  // next refresh sends both halves.
  private lastSiteRender: SiteRender | undefined;
  // Populated by every site-mode render of the whole map, consumed by
  // postSitePageUpdate so a page-switch click reuses the already-built
  // manifest/keyMap instead of re-parsing the whole map and re-reading every
  // un-navtitled topic's <title> off disk on every click. Self-heals: any
  // source edit re-renders the whole map and so repopulates this; there is no
  // separate invalidation path to keep in sync by hand.
  private siteManifestCache: SiteManifestCache | undefined;
  private disposed = false;
  private renderDebounceTimer: unknown;
  // The render a currently-hidden panel is owed, if any. 'content' is a source
  // edit, satisfied by postContentUpdate; 'full' is a theme switch, manual
  // refresh or tree/book mode toggle, each of which has to reassign
  // webview.html. Escalates only -- a theme switch landing while an edit is
  // already pending must not be downgraded. The fold itself lives in
  // pendingRender.ts, pinned by a unit test.
  private pendingUpdate: PendingRender = 'none';
  // The parts behind whatever this panel's webview is showing in book mode --
  // the baseline the next render gets diffed against (bookPatch.ts).
  // undefined means "no idea what is on screen": before the first render,
  // after any full page render in tree mode, and after a render error -- all
  // of which must fall back to sending the document.
  private lastBookParts: BookPart[] | undefined;
  // Book mode's own sidebar refresh baseline, compared by string equality so
  // an edit that leaves the manifest unchanged sends no MSG_UPDATE_SIDEBAR.
  // Reset by every full render: whatever it just put in the DOM IS the
  // baseline the next edit's comparison must be against.
  private lastBookSidebarTreeHtml: string | undefined;

  constructor(
    private readonly host: MapPanelHost,
    private readonly scheduler: PanelScheduler = defaultScheduler,
  ) {
    // Seeded from what this document was last left in (mapViewState.ts): a
    // person who reads a map in docsite view gets it back in docsite view, on
    // the topic they were on.
    const remembered = host.readViewState();
    this.currentMode = remembered?.mode ?? 'tree';
    this.currentSitePage = remembered?.sitePage;
    this.rememberedModeUnproven = this.currentMode !== 'tree';
  }

  get mode(): MapMode {
    return this.currentMode;
  }

  get sitePage(): string | undefined {
    return this.currentSitePage;
  }

  /** The manifest of the last whole-map site render; only warm in site mode. */
  get siteManifest(): SiteManifestCache | undefined {
    return this.siteManifestCache;
  }

  /** First render of the panel. */
  start(): Promise<void> {
    return this.updateWebview();
  }

  dispose(): void {
    this.disposed = true;
    if (this.renderDebounceTimer !== undefined) this.scheduler.clear(this.renderDebounceTimer);
  }

  // ── events from the host ───────────────────────────────────────────────

  /** The map document itself was edited. */
  onDocumentChanged(): void {
    this.siteRefresh = foldSiteRefresh(this.siteRefresh, 'full');
    this.scheduleContentUpdate();
  }

  /**
   * A file other than the map itself changed or appeared. Which of them
   * concern this panel is decided here, from what the last render read.
   */
  onReferencedFileEvent(event: { kind: 'create' | 'change' | 'delete'; fromEditor?: boolean }, fsPath: string): void {
    if (this.disposed) return;
    if (!affectsPanel(event, fsPath, this.dependencies)) return;
    if (event.fromEditor && this.currentMode === 'site') {
      // Text typed into another document but not saved. The page on screen
      // shows it if it read that file; the sidebar (titles, structure) is left
      // as it is until the save, so this never reloads the webview.
      if (!this.pageDependencies || !dependsOn(this.pageDependencies, fsPath)) return;
      this.siteRefresh = foldSiteRefresh(this.siteRefresh, 'page');
    } else {
      this.siteRefresh = foldSiteRefresh(this.siteRefresh, 'full');
    }
    this.scheduleContentUpdate();
  }

  /**
   * Choosing another key context map changes what keyrefs resolve to (topic
   * titles, the sidebar, every inlined topic) though no file this map reads
   * changed, so nothing else hears of it. Treated as a map edit: the site
   * sidebar is rebuilt too, not just the page.
   */
  onKeyContextChanged(): void {
    this.siteRefresh = foldSiteRefresh(this.siteRefresh, 'full');
    this.requestUpdate('content');
  }

  /** The panel's visibility changed; settles whatever a hidden panel was owed. */
  onVisibilityChanged(): void {
    if (!this.host.isVisible() || this.pendingUpdate === 'none') return;
    // Clear before rendering: postContentUpdate falls back to updateWebview
    // when rendering fails, and re-entering with a stale pendingUpdate would
    // render twice.
    const owed = this.pendingUpdate;
    this.pendingUpdate = 'none';
    if (owed === 'full') void this.updateWebview();
    else this.postContentUpdate();
  }

  // ── commands from the webview ──────────────────────────────────────────

  /** The person asked for a full re-render (refresh button, theme switch, template choice). */
  requestFullRender(): Promise<void> {
    return this.updateWebview();
  }

  /**
   * Render the target mode and apply it IN PLACE: the webview keeps its
   * document (so the toolbar never leaves the page) and swaps the stage
   * payload into it. Only fall back to a full reload when there is no stage to
   * apply -- a render that failed (its error page has no toolbar to switch
   * back with) or a page that is already that error page (no script to
   * receive the message).
   */
  switchMode(newMode: MapMode): void {
    this.keepRememberedView = false;
    const rendered = this.host.generateHtml(newMode, this.currentSitePage);
    if (rendered.failed || !rendered.stage || this.pageIsError) {
      this.currentMode = newMode;
      this.requestUpdate('full');
      return;
    }
    this.currentMode = newMode;
    this.rememberedModeUnproven = false;
    this.commitRenderedState(rendered);
    this.host.post({ type: MSG_SWITCH_MODE, stage: rendered.stage });
  }

  switchSitePage(target: string): void {
    if (!target || target === this.currentSitePage) return;
    this.currentSitePage = target;
    this.postSitePageUpdate();
  }

  // ── rendering ──────────────────────────────────────────────────────────

  /**
   * A hidden panel (tabbed behind another editor, or sitting in a collapsed
   * group) still has a live webview under retainContextWhenHidden, so without
   * this every edit anywhere in the watched set pays for a full re-render
   * nobody is looking at. That is expensive here in a way it isn't for a
   * single topic: book mode re-renders every referenced topic from scratch,
   * and the extension host is single-threaded, so the cost lands on every
   * other extension's completions and hovers too. Record the debt instead and
   * settle it once, when the panel comes back.
   */
  requestUpdate(kind: 'content' | 'full'): void {
    if (this.disposed) return;
    if (!this.host.isVisible()) {
      this.pendingUpdate = foldPendingRender(this.pendingUpdate, kind);
      return;
    }
    if (kind === 'full') void this.updateWebview();
    else this.postContentUpdate();
  }

  private scheduleContentUpdate(): void {
    if (this.renderDebounceTimer !== undefined) this.scheduler.clear(this.renderDebounceTimer);
    this.renderDebounceTimer = this.scheduler.set(() => this.requestUpdate('content'), RENDER_DEBOUNCE_MS);
  }

  /** Stores the mode and site page this panel is showing, once a render of them succeeded -- never a mode that only produced an error page. */
  private rememberView(): void {
    if (this.keepRememberedView) return;
    const next = nextMapViewState(this.host.readViewState(), this.currentMode, this.currentSitePage);
    if (next) this.host.writeViewState(next);
  }

  private async updateWebview(): Promise<void> {
    if (this.disposed) return;
    if (this.currentMode === 'book') {
      // collectBookParts/wrapBookParts assembles every referenced topic into
      // one document synchronously on the extension host -- see
      // scripts/bench-book-render.js for how long that can take on a large
      // book. Without a placeholder the panel just sits however it last looked
      // (or blank, on first switch into book mode) for the whole stretch,
      // which reads as the extension having hung rather than as work in
      // progress.
      this.host.setHtml(this.host.loadingHtml());
      // Yield one tick so the webview process actually receives and paints the
      // placeholder before the synchronous render below monopolizes the
      // extension host's single JS thread.
      await this.host.nextTick();
      if (this.disposed) return;
    }
    const rendered = this.host.generateHtml(this.currentMode, this.currentSitePage);
    if (rendered.failed && this.rememberedModeUnproven) {
      this.rememberedModeUnproven = false;
      this.keepRememberedView = true;
      this.currentMode = 'tree';
      return this.updateWebview();
    }
    this.rememberedModeUnproven = false;
    this.host.setHtml(rendered.html);
    this.commitRenderedState(rendered);
  }

  /**
   * Records everything a completed render (full-reload OR in-place switch)
   * implies for the panel's diffing/dependency state, so the next source edit
   * refreshes the right thing against the right baseline. Shared because both
   * put the SAME rendered document in front of the reader -- an in-place switch
   * leaves the toolbar up but the content/baselines it commits are identical to
   * what a reload of that mode would have.
   */
  private commitRenderedState(rendered: GeneratedMapHtml): void {
    this.pageIsError = rendered.failed === true;
    this.lastSiteRender = rendered.siteRender;
    // A full render answers everything owed, and replaces what was read.
    this.siteRefresh = 'none';
    if (!rendered.failed) {
      this.dependencies = rendered.files;
      this.pageDependencies = rendered.pageFiles;
    }
    this.host.recordRenderedHtml(rendered.html);
    // Reassigning webview.html replaces the DOM outright, so the baseline
    // becomes whatever this render produced -- including nothing at all in tree
    // mode and on the error page, where there are no parts to diff.
    this.lastBookParts = rendered.parts;
    // Same baseline-reset reasoning as lastBookParts just above: whatever this
    // full render just embedded in the DOM (or undefined, in tree/site mode or
    // on the error page, where there is no book sidebar at all) is what the
    // next postContentUpdate must diff against.
    this.lastBookSidebarTreeHtml = rendered.sidebarTreeHtml;
    // Site mode may have fallen back to the manifest's first entry (no hint
    // yet, or the hint no longer names a topic this map has) -- adopt whatever
    // it actually rendered, so the next page-switch click and the next full
    // re-render agree on what is currently on screen.
    if (rendered.resolvedSitePage !== undefined) this.currentSitePage = rendered.resolvedSitePage;
    this.siteManifestCache = rendered.siteManifest
      ? { manifest: rendered.siteManifest, keyMap: rendered.siteKeyMap!, bookMembers: rendered.siteBookMembers! }
      : undefined;
    if (!rendered.failed) this.rememberView();
  }

  /**
   * Docsite mode's page-switch path: unlike postContentUpdate (a source edit,
   * which can land in any mode), this only ever fires from the site-mode
   * sidebar's own click handler, so there is no tree/book case to fall through
   * to -- just render the newly-selected topic and send it as a content-only
   * update. The sidebar itself is untouched: its own click handler already
   * flipped the active class client-side before the message was even sent.
   *
   * Reuses siteManifestCache rather than re-parsing the map and rebuilding the
   * manifest -- which, for any topic the map itself never gave a navtitle,
   * means re-reading that topic's <title> off disk -- on every single click.
   * loadSiteManifest is still here as a defensive fallback for the case this
   * fires with no prior full render (shouldn't happen: entering site mode
   * always goes through updateWebview first), not the normal path.
   */
  private postSitePageUpdate(): void {
    if (this.disposed) return;
    const site = this.siteManifestCache ?? this.host.loadSiteManifest();
    if (!site || site.manifest.length === 0) {
      void this.updateWebview(); // show whatever error/empty state a full render produces
      return;
    }
    const navigable = siteNavigableEntries(site.manifest);
    if (navigable.length === 0) {
      void this.updateWebview(); // every entry is a group header / resource-only -- nothing to actually show
      return;
    }
    // currentSitePage === SITE_HOME_TARGET (the home toolbar button was
    // clicked) resolves straight to home -- it deliberately does NOT go through
    // the navigable.some check below, which would never match the sentinel and
    // would silently fall back to the first topic instead of actually going
    // home.
    const resolvedSitePage = this.currentSitePage === SITE_HOME_TARGET
      ? SITE_HOME_TARGET
      : this.currentSitePage && navigable.some((m) => m.absPath === this.currentSitePage)
        ? this.currentSitePage
        : navigable[0].absPath;
    this.currentSitePage = resolvedSitePage;
    if (resolvedSitePage === SITE_HOME_TARGET) {
      const homeHtml = this.host.renderSiteHome(site.manifest);
      this.host.post({ type: MSG_UPDATE_CONTENT, html: homeHtml });
      this.lastSiteRender = { sidebarTreeHtml: undefined, pageHtml: homeHtml };
      // No topic file was read for the home page itself.
      this.pageDependencies = new Set();
      this.rememberView();
      return;
    }
    const tracked = trackSourceReads(() => this.host.renderSiteTopic(resolvedSitePage, site.keyMap, site.bookMembers));
    const topic = tracked.result;
    if (topic.error !== undefined) {
      void this.updateWebview();
      return;
    }
    this.host.post({ type: MSG_UPDATE_CONTENT, html: topic.html });
    // The webview flipped the active sidebar row on its own for a page switch,
    // so the last sidebar the host rendered no longer describes its DOM:
    // unknown, and resent by the next in-place refresh.
    this.lastSiteRender = { sidebarTreeHtml: undefined, pageHtml: topic.html };
    // The page now on screen is what pageDependencies describes; the whole-panel
    // set only grows, so a page visited earlier stays in it until the next full
    // render (an extra refresh, never a missed one).
    this.pageDependencies = tracked.files;
    this.dependencies = new Set([...(this.dependencies ?? []), ...tracked.files]);
    this.rememberView();
  }

  /**
   * Site mode's answer to a source edit that may touch the sidebar: render the
   * map again, as a full reload would, but send the webview only the halves
   * that came out different (diffSiteRender) instead of replacing the document.
   * The page keeps its scroll position, the search box its query and results,
   * the sidebar its scroll -- everything a reload threw away. A render that
   * fails (or leaves nothing to show) still goes through updateWebview, which
   * produces the error page.
   */
  private refreshSiteInPlace(): void {
    if (this.disposed) return;
    const rendered = this.host.renderMapContent('site', this.currentSitePage);
    if (
      rendered.error !== undefined ||
      rendered.sidebarTreeHtml === undefined ||
      rendered.resolvedSitePage === undefined ||
      rendered.siteManifest === undefined ||
      rendered.siteKeyMap === undefined ||
      rendered.siteBookMembers === undefined
    ) {
      void this.updateWebview();
      return;
    }
    this.currentSitePage = rendered.resolvedSitePage;
    this.siteManifestCache = { manifest: rendered.siteManifest, keyMap: rendered.siteKeyMap, bookMembers: rendered.siteBookMembers };
    this.dependencies = rendered.files;
    this.pageDependencies = rendered.pageFiles;
    const next = { sidebarTreeHtml: rendered.sidebarTreeHtml, pageHtml: rendered.html };
    const changes = diffSiteRender(this.lastSiteRender, next);
    this.lastSiteRender = next;
    // Sidebar first: the content message's follow-up work (the page-search
    // refresh, a pending anchor) may look at sidebar rows.
    if (changes.sidebar !== undefined) this.host.post({ type: MSG_UPDATE_SIDEBAR, html: changes.sidebar });
    if (changes.page !== undefined) this.host.post({ type: MSG_UPDATE_CONTENT, html: changes.page });
    this.rememberView();
  }

  /**
   * The common case: a regular source edit (topicref profiling, adding/
   * reordering entries, ...). Sends just the freshly rendered content as a
   * message instead of reassigning webview.html -- no full page reload means no
   * images re-requesting/re-decoding, no scroll position lost, and nothing for
   * an in-flight scroll correction to race against. Falls back to a full reload
   * only if rendering itself failed (to show the error page), or if the page on
   * screen already IS the error page (escalateAfterFailure): it has no script
   * to receive the message. Site mode does its own thing for a source edit, see
   * refreshSiteInPlace.
   */
  private postContentUpdate(): void {
    if (this.disposed) return;
    if (escalateAfterFailure(this.pageIsError, 'content') === 'full') {
      void this.updateWebview();
      return;
    }
    const pageOnly = this.siteRefresh === 'page';
    this.siteRefresh = 'none';
    if (this.currentMode === 'site') {
      // Only unsaved text in a file the page reads changed (see
      // onReferencedFileEvent): refresh the page the way a page switch does,
      // without touching the sidebar or reloading the webview.
      if (pageOnly) {
        this.postSitePageUpdate();
        return;
      }
      // A source edit can rename a topicref's navtitle, add/remove/reorder
      // entries, or change which topic a keyref-driven title resolves to --
      // sidebar changes as well as content ones, and the sidebar lives outside
      // #dita-content-root, which is all a content message touches. So both are
      // re-rendered and the ones that differ are sent, without replacing the
      // document.
      this.refreshSiteInPlace();
      return;
    }
    const result = this.host.renderMapContent(this.currentMode);
    if (result.error !== undefined) {
      void this.updateWebview();
      return;
    }
    this.dependencies = result.files;
    const parts = result.parts;
    // Tree mode produces no parts and keeps sending its whole (small) content
    // div, exactly as before.
    if (!parts) {
      this.host.post({ type: MSG_UPDATE_CONTENT, html: result.html });
      return;
    }
    const patch = diffBookParts(this.lastBookParts, parts);
    // Recorded before sending: the baseline describes what the webview will be
    // showing once this message lands, whichever branch it takes.
    this.lastBookParts = parts;
    // Book mode's sidebar refresh, sent alongside the content patch rather than
    // replacing it: the incremental content patch below (bookPatch.ts,
    // load-bearing for large-map edit latency) is preserved, and only the cheap
    // sidebar markup is re-sent in full.
    //
    // Deliberately ABOVE the `patch.kind === 'none'` early return: the sidebar
    // and the content can change independently. A <topichead> renamed, or a
    // topicref reordered among its siblings, moves the sidebar without
    // necessarily producing any different rendered HTML for any part --
    // returning early on 'none' before this point would leave exactly that
    // edit's sidebar stale. The string comparison here is what keeps the common
    // case (a body edit, sidebar unchanged) from sending anything at all.
    if (result.sidebarTreeHtml !== undefined && result.sidebarTreeHtml !== this.lastBookSidebarTreeHtml) {
      this.lastBookSidebarTreeHtml = result.sidebarTreeHtml;
      this.host.post({ type: MSG_UPDATE_SIDEBAR, html: result.sidebarTreeHtml });
    }
    if (patch.kind === 'none') return;
    if (patch.kind === 'patch') {
      // count rides along so the webview can decline to patch a document it
      // knows is not the one these indices were computed against, and ask for a
      // full render instead.
      this.host.post({ type: MSG_PATCH_CONTENT, count: parts.length, updates: patch.updates });
      return;
    }
    this.host.post({ type: MSG_UPDATE_CONTENT, html: result.html });
  }
}
