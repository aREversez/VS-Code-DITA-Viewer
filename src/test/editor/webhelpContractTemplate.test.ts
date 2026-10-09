import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { load } from 'cheerio';
import { buildTemplateSnapshotHtml } from '../../editor/templateSnapshot';
import { discoverTemplates, type SiteTemplate } from '../../editor/siteTemplates';
import { renderTopicXml } from '../../editor/ditaRenderUtils';
import { WEBHELP_CSS_VARS, WEBHELP_HOOKS, missingHooks } from '../../editor/webhelpContract';
import { getWebhelpChromeScript } from '../../editor/webview/webhelpChromeScript';
import { readRepo, repoRoot, stripComments } from '../media/cssBlocks';

/**
 * Route B milestone 3 step 11: the acceptance template itself, checked WITHOUT a
 * browser. The screenshot pass (src/test-visual/visual.test.ts) needs a
 * downloaded Chromium, so it is not part of `npm test`; this is the part of that
 * step that runs everywhere, and for the contract it is the stricter half.
 *
 * The claim under test is the one the template's own header makes: every
 * selector in webhelp-contract.css is either a hook webhelpContract.ts lists or a
 * body-content class the renderer actually emits. So each selector is run against
 * the REAL markup -- the same snapshot document the visual check opens, assembled
 * by buildTemplateSnapshotHtml out of the real renderer's sidebar, the real
 * renderer's topic body and the real landing-page tiles. A selector that matches
 * nothing is a name a template author was promised and the renderer does not
 * produce: the silent regression this template exists to catch, in either
 * direction.
 */

const TEMPLATE_DIR = join(repoRoot, 'test-dita-file', 'manual', 'templates');
const CSS_ABS = join(TEMPLATE_DIR, 'webhelp-contract', 'webhelp-contract.css');

/** A topic with one of every element the template's content rules address, run
 *  through the real renderer so the class names checked below are the ones a
 *  reader gets rather than the ones this test would like them to be. */
const TOPIC_XML = `<topic id="t"><title>Getting Started</title><body>
<shortdesc>Fixture shortdesc.</shortdesc>
<p>A fixture paragraph.</p>
<note type="tip">A fixture note.</note>
<section id="s"><title>A section</title><p>x</p></section>
<ul><li>one</li></ul>
<ol><li>one</li></ol>
<fig id="f"><title>Figure</title><image href="a.png"/></fig>
<table><tgroup cols="1"><thead><row><entry>Head</entry></row></thead><tbody><row><entry>Cell</entry></row></tbody></tgroup></table>
<codeblock>fixture code</codeblock>
</body></topic>`;

const renderFixtureTopic = (): string =>
  renderTopicXml({
    xml: TOPIC_XML,
    docDir: process.cwd(),
    keyMap: new Map(),
    asWebviewUri: (p) => p,
    headingLevel: 1,
    uiLanguage: 'en',
  }).html;

/** templateSnapshot's FIXTURE_NAV_MANIFEST as the chrome script sees it (same
 *  rows, same order, same active one): what the top menu and breadcrumb are
 *  derived from. */
const NAV_ROWS = [
  { depth: 0, label: 'Getting Started', linked: true, active: true },
  { depth: 1, label: 'Installation', linked: true, active: false },
  { depth: 1, label: 'Quick Start', linked: true, active: false },
  { depth: 0, label: 'Reference', linked: true, active: false },
  { depth: 1, label: 'API', linked: true, active: false },
];

interface ChromeApi {
  webhelpChromeModel(rows: typeof NAV_ROWS): unknown;
  webhelpChromeHtml(m: unknown): { menuHtml: string; crumbHtml: string };
}

/**
 * The top menu and the breadcrumb are NOT in the shell markup -- the client
 * script writes them (webhelpChromeScript.ts). Running that script's own pure
 * builders and injecting their output the way its update() does is what lets
 * `.wh_top_menu li.active > a` be checked against what a reader sees instead of
 * against an always-empty bar.
 */
function chromeHtml(): { menuHtml: string; crumbHtml: string } {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    'document',
    'MutationObserver',
    `${getWebhelpChromeScript({ crumbLabel: 'Breadcrumb' })}\nreturn { webhelpChromeModel, webhelpChromeHtml };`,
  ) as (d: unknown, m: unknown) => ChromeApi;
  // A body without wh_topic_page keeps the glue inert, so only the pure parts run.
  const api = factory({ body: { classList: { contains: () => false } }, addEventListener: () => {} }, undefined);
  return api.webhelpChromeHtml(api.webhelpChromeModel(NAV_ROWS));
}

const toUri = (p: string): string => `file://${p.replace(/\\/g, '/')}`;
const readText = (p: string): string => readFileSync(p, 'utf-8');

interface Doc {
  /** 'topic/light', 'landing/dark', ... -- what the selector pools are keyed on. */
  name: string;
  $: ReturnType<typeof load>;
}

function snapshotDoc(template: SiteTemplate, over: { landing: boolean; dark: boolean; contentHtml: string }): Doc {
  const html = buildTemplateSnapshotHtml({
    baseCss: readRepo('media/styles.css'),
    compatCss: readRepo('media/webhelp-compat.css'),
    template,
    readFile: readText,
    toUri,
    mode: 'site',
    dark: over.dark,
    landingPage: over.landing,
    contentHtml: over.contentHtml,
  });
  const $ = load(html);
  const chrome = chromeHtml();
  $('.wh_top_menu').html(chrome.menuHtml);
  $('.wh_breadcrumb').html(chrome.crumbHtml);
  return { name: `${over.landing ? 'landing' : 'topic'}/${over.dark ? 'dark' : 'light'}`, $ };
}

/** `html.vscode-dark ...` names the document, not a node; split it off so the
 *  rest can be matched and the dark variant can be looked for in a dark page. */
function splitDarkPrefix(sel: string): { dark: boolean; base: string } {
  const m = /^html\.vscode-dark\s+([\s\S]+)$/.exec(sel);
  return m ? { dark: true, base: m[1] } : { dark: false, base: sel };
}

/** A pseudo-element has no node to match and `:hover` needs an interaction, so
 *  the check runs on the element part -- which still has to be a real node. */
function stripPseudo(sel: string): string {
  return sel.replace(/::?[a-z-]+(\([^)]*\))?/gi, '');
}

/** The home region only exists on the landing page, so those selectors may only
 *  match there; everything else may match on either page of the right palette. */
function docPool(sel: string, docs: Doc[]): Doc[] {
  const { dark, base } = splitDarkPrefix(sel);
  const home = /\bwh_main_page\b|\bwh_tile/.test(base);
  return docs.filter((d) => (!dark || d.name.endsWith('/dark')) && (!home || d.name.startsWith('landing/')));
}

/** Every selector of every rule of a flat sheet (the sheet's own flatness is a
 *  separate assertion, so `[^{}]+` here is enough). Comments go first: they sit
 *  in the prelude position and would otherwise become part of the selector. */
function ruleSelectors(css: string): string[] {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  const flat = stripComments(css);
  for (let m = re.exec(flat); m; m = re.exec(flat)) {
    const prelude = m[1].trim();
    if (prelude.startsWith('@')) continue;
    for (const sel of prelude.split(',')) {
      const s = sel.replace(/\s+/g, ' ').trim();
      if (s) out.push(s);
    }
  }
  return out;
}

/** The selectors none of `docs` can match, each in the pool it was allowed to. */
function unmatched(selectors: string[], docs: Doc[]): string[] {
  const bad: string[] = [];
  for (const sel of selectors) {
    const testable = stripPseudo(splitDarkPrefix(sel).base).trim();
    const pool = docPool(sel, docs);
    if (!testable || pool.length === 0) {
      bad.push(sel);
      continue;
    }
    let hit = false;
    for (const d of pool) {
      try {
        if (d.$(testable).length > 0) {
          hit = true;
          break;
        }
      } catch {
        // Unparseable to the browser engine here: a miss, which is the honest
        // answer -- and the harness test below keeps a bogus name from passing.
      }
    }
    if (!hit) bad.push(sel);
  }
  return bad;
}

function isReadableFile(abs: string): boolean {
  try {
    readFileSync(abs);
    return true;
  } catch {
    return false;
  }
}

describe('webhelp-contract acceptance template', () => {
  const { templates, diagnostics } = discoverTemplates([{ dir: TEMPLATE_DIR, builtin: false }]);
  const template = templates.find((t) => t.id === 'webhelp-contract');
  const css = readText(CSS_ABS);

  it('is discovered as a webhelp-DOM template that carries a logo', () => {
    assert.deepStrictEqual(diagnostics, [], 'the manual template root must load without descriptor complaints');
    assert.ok(template, 'webhelp-contract must be discoverable');
    assert.strictEqual(template!.dom, 'webhelp', 'the .opt descriptor picks the webhelp DOM by rule');
    // An .opt's <logo> is the only descriptor shape that names a brand logo, and
    // MapViewerProvider passes template.logo to the shell as logoUri -- which is
    // what makes the contract's optional .wh_logo hook exist at all.
    assert.ok(template!.logo && isReadableFile(template!.logo), 'the template must supply a logo for the .wh_logo hook');
    assert.strictEqual(template!.outline, false, 'an .opt never sets outline; the webhelp DOM gets the column by rule');
  });

  it('the sheet stays flat and unlayered -- §2.3 cascade, from the template side', () => {
    // Checked on the comment-stripped text: the sheet's own header comment
    // quotes @layer and !important while explaining why it uses neither.
    const rules = stripComments(css);
    assert.ok(!/@layer/.test(rules), 'template css must not nest itself in a layer, or it loses to nothing');
    assert.ok(!/@media/.test(rules), 'this sheet is a contract check, not a responsive design');
    assert.ok(!/!important/.test(rules), 'an unlayered template sheet never needs !important to beat dv-base or wh-compat');
  });

  it('only sets custom properties the contract names', () => {
    const set = new Set<string>();
    for (const m of stripComments(css).matchAll(/(--[a-z0-9-]+)\s*:/gi)) set.add(m[1]);
    for (const v of set) assert.ok(WEBHELP_CSS_VARS.includes(v), `${v} is not one of the contract's ${WEBHELP_CSS_VARS.length} properties`);
    assert.ok(set.size >= 6, `only ${set.size} properties set -- the point is to drive the theme surface`);
  });

  if (!template) {
    // Discovery above is the real test; every case below needs the descriptor.
    it('skipped the markup checks: the template was not discovered', () => assert.fail('webhelp-contract not discovered'));
  } else {
    const contentHtml = renderFixtureTopic();
    const docs = [
      snapshotDoc(template, { landing: false, dark: false, contentHtml }),
      snapshotDoc(template, { landing: false, dark: true, contentHtml }),
      snapshotDoc(template, { landing: true, dark: false, contentHtml }),
      snapshotDoc(template, { landing: true, dark: true, contentHtml }),
    ];
    const selectors = ruleSelectors(css);

    it('the harness sees the whole sheet, and a made-up hook does not pass it', () => {
      assert.ok(selectors.length >= 30, `only ${selectors.length} selectors parsed -- the sheet grew past the parser?`);
      // Kill test for this test, so the green list below cannot be green because
      // the check quietly matched nothing at all.
      const bogus = 'body.wh_topic_page .wh_no_such_hook';
      assert.deepStrictEqual(unmatched([bogus], docs), [bogus]);
      // ...and the inverse: a real name from the same sheet must match, or the
      // pool is wrong rather than the selector.
      assert.deepStrictEqual(unmatched(['body.wh_topic_page header.wh_header'], docs), []);
    });

    it('every selector resolves against markup the real renderer produced', () => {
      const bad = unmatched(selectors, docs);
      assert.deepStrictEqual(bad, [], `selectors that match nothing emitted:\n${bad.join('\n')}`);
    });

    it('a topic page satisfies every required hook of the contract', () => {
      const topic = docs.find((d) => d.name === 'topic/light')!;
      assert.deepStrictEqual(missingHooks((sel) => topic.$(sel).length > 0), []);
    });

    it('the landing page carries the home hooks the renderer emits today', () => {
      const landing = docs.find((d) => d.name === 'landing/light')!;
      const has = (sel: string) => landing.$(sel).length > 0;
      for (const sel of ['body.wh_main_page', '.wh_tiles', '.wh_tile', '.wh_tile_title', '.wh_tile_text'])
        assert.ok(has(sel), `${sel} should be on the landing page`);
      // The three home hooks with no node behind them yet are pinned ABSENT, so
      // whoever supplies one (a welcome text, a per-tile shortdesc, a main-page
      // toc) has to cross this line on purpose -- see renderSiteHomeHtml's own
      // comment.
      for (const sel of ['.wh_welcome', '.wh_tile_shortdesc', '.wh_main_page_toc'])
        assert.ok(!has(sel), `${sel} is deliberately not emitted yet`);
      assert.deepStrictEqual(missingHooks(has), [], 'a landing page is still a topic page: the required hooks stay required');
    });

    it('every wh_ name the sheet styles is in webhelpContract.ts', () => {
      const known = new Set<string>();
      for (const h of WEBHELP_HOOKS) for (const m of h.selector.matchAll(/[.#](\w[\w-]*)/g)) known.add(m[1]);
      // site-home-title is the heading's own class (the contract names no wh_
      // title for it); the rest are the double-classed nodes of §2.2.
      const ownMode = new Set(['site-home-title', 'site-nav-link']);
      const used = new Set<string>();
      for (const m of stripComments(css).matchAll(/\.(wh_[a-z0-9_]+)/g)) used.add(m[1]);
      assert.ok(used.size >= 15, `only ${used.size} wh_ names used -- the sheet should be covering the regions`);
      for (const name of used) assert.ok(known.has(name) || ownMode.has(name), `${name} is styled but is not a contract hook`);
    });
  }
});
