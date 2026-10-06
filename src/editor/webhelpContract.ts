/**
 * The WebHelp-style DOM contract (route B, see webhelp-compat-plan.md): the
 * class and id names a template's css can rely on when its descriptor says
 * `dom: "webhelp"`. No vscode types, so the shell builder and its tests share
 * one list.
 *
 * This file is a list of interface NAMES, written by hand. It carries no
 * third-party markup, css, script or image; what each name looks like is
 * decided by webhelp-compat.css and the template's own css, not here.
 */

/** Where on the page a hook lives. */
export type WebhelpRegion = 'page' | 'header' | 'tools' | 'toc' | 'topic' | 'outline' | 'footer' | 'home';

export interface WebhelpHook {
  /** A CSS selector the emitted page must match; tag-qualified where the tag matters to templates. */
  selector: string;
  region: WebhelpRegion;
  /**
   * true: every site page with a sidebar carries it, whatever the map holds.
   * false: emitted only when there is something to show (a logo, related
   * links, a landing-page tile ...).
   */
  required: boolean;
}

const req = (selector: string, region: WebhelpRegion): WebhelpHook => ({ selector, region, required: true });
const opt = (selector: string, region: WebhelpRegion): WebhelpHook => ({ selector, region, required: false });

export const WEBHELP_HOOKS: readonly WebhelpHook[] = [
  // page frame
  req('body.wh_topic_page', 'page'),
  req('#wh_topic_container', 'page'),
  req('.wh_content_area', 'page'),
  opt('#go2top', 'page'),

  // top bar
  req('header.wh_header', 'header'),
  req('.wh_header_flex_container', 'header'),
  req('.wh_publication_title', 'header'),
  req('.wh_top_menu', 'header'),
  opt('.wh_logo', 'header'),

  // tool bar
  req('nav.wh_tools', 'tools'),
  req('.wh_breadcrumb', 'tools'),
  req('.wh_right_tools', 'tools'),
  req('.wh_navigation_links', 'tools'),
  opt('.wh_print_link', 'tools'),
  opt('#wh_toc_button', 'tools'),

  // publication table of contents (the sidebar)
  req('nav#wh_publication_toc', 'toc'),
  req('#wh_publication_toc_content', 'toc'),
  req('li.topicref', 'toc'),
  opt('li.topicref.has-children', 'toc'),
  opt('li.topicref.active', 'toc'),
  opt('li.topicref.expanded', 'toc'),

  // topic body
  req('#wh_topic_body', 'topic'),
  req('.wh_topic_content', 'topic'),
  opt('.wh_child_links', 'topic'),
  opt('.wh_related_links', 'topic'),

  // on-this-page outline
  req('nav#wh_topic_toc', 'outline'),
  req('#wh_topic_toc_content', 'outline'),

  // page footer
  req('footer.wh_footer', 'footer'),

  // landing page (site mode, milestone 3)
  opt('body.wh_main_page', 'home'),
  opt('.wh_welcome', 'home'),
  opt('.wh_tiles', 'home'),
  opt('.wh_tile', 'home'),
  opt('.wh_tile_title', 'home'),
  opt('.wh_tile_shortdesc', 'home'),
  opt('.wh_tile_text', 'home'),
  opt('.wh_main_page_toc', 'home'),
];

export function requiredHooks(): WebhelpHook[] {
  return WEBHELP_HOOKS.filter((h) => h.required);
}

/**
 * The selectors of `which` hooks that the page does not match. `has` answers
 * "does the page match this selector", so the caller brings its own DOM
 * (cheerio in tests, a live document in the browser).
 */
export function missingHooks(has: (selector: string) => boolean, which: 'required' | 'all' = 'required'): string[] {
  const hooks = which === 'all' ? WEBHELP_HOOKS : requiredHooks();
  return hooks.filter((h) => !has(h.selector)).map((h) => h.selector);
}

/**
 * The CSS custom properties a template can set to theme the page. The base
 * stylesheet gives each a default; a template overrides the ones it wants.
 */
export const WEBHELP_CSS_VARS: readonly string[] = [
  '--primary-color',
  '--primary-light-color',
  '--text-color',
  '--border-color',
  '--body-bg-color',
  '--content-bg-color',
  '--link-color',
  '--button-color',
  '--button-bg-color',
  '--button-active-bg-color',
  '--button-disabled-color',
  '--button-disabled-bg-color',
  '--tile-bg-color',
  '--tile-color',
  '--header-color',
  '--header-bg-color',
  '--menu-bg-color',
  '--menu-active-bg-color',
  '--search-color',
  '--search-bg-color',
  '--footer-bg-color',
  '--footer-color',
  '--tools-color',
  '--tools-bg-color',
  '--toc-color',
  '--toc-bg-color',
  '--tooltip-bg-color',
  '--elevation-shadow',
];
