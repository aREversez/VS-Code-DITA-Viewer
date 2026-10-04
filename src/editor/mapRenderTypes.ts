import { BookPart } from './bookPatch';
import { DocsiteNavEntry } from './ditaRenderUtils';
import { SiteRender } from './siteRender';

// The shapes a map render hands between the provider's render methods and the
// per-panel state that consumes them. Types only, and free of `vscode`, so the
// panel's state handling can be unit-tested without a host.

/**
 * The parts of a rendered mode that an in-place switch swaps into the live
 * webview, instead of reassigning webview.html -- which is how the toolbar
 * stays on the page across a mode change (toolbar-persistence work). Sent to
 * the webview's applyModeStage (see getMapWebviewScript's MSG_SWITCH_MODE
 * handler) alongside the host's own state commit.
 */
export interface MapRenderStage {
  mode: 'tree' | 'book' | 'site';
  /** Full <body> class list (mode-*, template, shell); no hide-profiling. */
  bodyClass: string;
  /** The template's css text (no <style> wrapper); '' when there is none. */
  templateCss: string;
  /** The body's data-template hook value; '' when there is no template. */
  templateDataAttr: string;
  /** The template dropdown's selected id; '' for the default look. */
  selectedTemplate: string;
  /** The <body> content that follows the persistent #__topbar element. */
  shellHtml: string;
  /** Whether this stage is a docsite/book shell (drives topbar--top). */
  isShell: boolean;
}

/** What renderMapContent produces: the content for a mode, or the error that replaces it. */
export type RenderedMapContent =
  | {
      html: string;
      parts?: BookPart[];
      sidebarHtml?: string;
      sidebarTreeHtml?: string;
      resolvedSitePage?: string;
      siteManifest?: DocsiteNavEntry[];
      siteKeyMap?: Map<string, string>;
      siteBookMembers?: ReadonlySet<string>;
      /** Every source file the render read. */
      files?: ReadonlySet<string>;
      /** Site mode only: the files the topic page alone read. */
      pageFiles?: ReadonlySet<string>;
      error?: undefined;
    }
  | { html?: undefined; error: string };

/** What generateHtml produces: a whole document for a (re)load, plus the state a render implies. */
export type GeneratedMapHtml = { html: string; failed?: true; parts?: BookPart[]; sidebarTreeHtml?: string; resolvedSitePage?: string; siteManifest?: DocsiteNavEntry[]; siteKeyMap?: Map<string, string>; siteBookMembers?: ReadonlySet<string>; files?: ReadonlySet<string>; pageFiles?: ReadonlySet<string>; siteRender?: SiteRender; stage?: MapRenderStage };

/** The manifest and key map of the last whole-map site render, reused by page switches and searches. */
export interface SiteManifestCache {
  manifest: DocsiteNavEntry[];
  keyMap: Map<string, string>;
  bookMembers: ReadonlySet<string>;
}
