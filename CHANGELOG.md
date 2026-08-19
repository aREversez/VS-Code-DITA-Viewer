# Changelog

## Unreleased

## 1.0.8 (2026-08-19)

### Bug Fixes

- **Ported the incremental content-update architecture to Outline/Book (map) view.** `MapViewerProvider.ts` never received the reload-vs-incremental-update fix described below for the topic preview — every edit to a `.ditamap` (toggling a topicref's profiling attributes, reordering entries, adding a new topicref, …) still reassigned `webview.html` wholesale, with no scroll-restore attempt at all, so editing a map while Outline/Book view was open meant every image in the composited content re-requesting and re-decoding (Book mode especially, which can be a very long page) and scroll position simply resetting to the top on every edit. Map rendering now goes into the same dedicated `#dita-content-root` div the topic viewer uses, and an edit posts just the freshly-rendered HTML instead of reloading the page; Filter panel re-application/rebuild and an active search re-run the same way the topic viewer's do. Genuine full reloads remain for opening the file, a theme switch, the manual refresh button, and switching between Outline/Book mode itself (a fundamentally different content structure each time, not an incremental edit).

- **Fixed the per-image zoom controls shrinking images instead of enlarging them, and the shrink button doing nothing at the default zoom level.** Two related issues in the per-image −/+/maximize toolbar added for image zoom:
  - The zoom steps started at 100% with nothing below it, so clicking "−" at the default level was a no-op.
  - Clicking "+" (or "−") before a lazily-loaded image had actually finished loading could permanently cache a bogus baseline width (0, or a 300px fallback) for that image — DITA `<image>` renders `loading="lazy"` with no `@width`/`@height` reserved in the common case, so there's a real window where the image hasn't decoded yet. Once cached, every later zoom step for that image computed from the wrong baseline, so "+" would shrink the image to a fraction of its already-displayed size instead of enlarging it, and the image never recovered until the preview was reopened.
  - Added shrink steps (50%/75%) below 100%, only cache the measured baseline once the image has actually finished loading (`img.complete && naturalWidth > 0`), and added a `load` listener that re-applies the current zoom level once a still-loading image finishes, so a click that lands mid-load self-corrects instead of sticking.

- **Fixed the preview reloading the whole page on every source edit, and the several distinct ways that caused the preview to visibly flicker, jump, or land on content that didn't match what was just typed.** These compound (each was a real, separate bug, but they mostly only became visible together): every content edit reassigned `webview.html` wholesale, which is a full page navigation — the entire DOM gets torn down and rebuilt, every image re-requests and re-decodes, and any scroll-correction message in flight (this edit's own initial-scroll-line restore, the source editor's live visible-range follow, a source click's highlight-and-reveal) had a window to land on a page that wasn't fully loaded yet or had already been replaced by the *next* reload, racing onto stale content.
  - A regular source edit no longer reassigns `webview.html` at all — the rendered content now lives in a dedicated `<div id="dita-content-root">`, and an edit posts just the freshly-rendered HTML as a message, swapping only that div's contents. Genuine full reloads are now reserved for opening the file, a theme switch, and the manual refresh button. Per-image zoom toolbars, the Filter panel's checkbox list, and an active search all correctly re-apply themselves against the new content after a swap instead of only working once at initial load.
  - Clicking a source position far from wherever the preview happened to be scrolled could still leave an in-flight centering animation orphaned by the very next content swap, abandoning it mid-flight rather than continuing toward the (now different) DOM node it was interpolating toward — re-applied against the fresh DOM whenever a highlight/scroll was still unsettled when a swap landed.
  - Moving the cursor to a position that isn't currently on screen very often also moves the editor's *own* visible range as a side effect (VS Code reveals the cursor into view on its own) — that side effect fired a second, independent scroll-sync path using a different alignment (top-of-viewport rather than centering the cursor line), overriding the correct centering moments after it happened. The cursor-driven centering now gets a brief priority window over the visible-range-follow path.
  - Chromium's default CSS Scroll Anchoring — which tries to auto-compensate scroll position when content changes near the viewport — doesn't have a reliable reference point to work from when virtually an entire subtree is replaced in one swap, and could shift scroll position in ways that didn't correspond to anything real; turned off for the content div specifically.
  - Clicking to a position further down in the source could also snap the *editor's own* viewport upward: the preview's suppression of its own programmatic scrolls (so they don't echo back and move the editor cursor) used a fixed ~700ms timing guess, which a long enough scroll animation could outlast, letting an intermediate, not-yet-final scroll position leak out and get treated as a real one. Replaced with the browser's own `scrollend` event, which fires exactly when a scroll (including any animation) has actually finished, so there's no duration to guess at all.

- **Fixed `<img loading="lazy">` reserving no space until the browser actually decodes the file, causing content below an image to jump once it finally loads** — most noticeable scrolling through Book mode, which composites many topics' worth of images into one long page, so continuously scrolling means repeatedly landing on a fresh batch of not-yet-loaded images. Each image's real width/height is now read directly from the file header (PNG/GIF/BMP/JPEG/SVG; not a full decode) and set as `width`/`height` attributes when the DITA source itself has neither — combined with this project's existing `img { height: auto }`, modern browsers treat that as an aspect ratio to reserve immediately rather than a fixed pixel size, so responsive scaling is unaffected. An explicit `@width`/`@height` on the DITA `<image>` element always wins over this.

- **Fixed note-type labels (Warning/Attention/...) staying in English regardless of the topic's language, and several types (`attention`, `caution`, `fastpath`, `remember`, `trouble`) not having any label at all.** The topic preview carried its own separate, hand-written label map that only covered 7 of the 13 DITA note/@type values, instead of the complete implementation already used elsewhere. Language detection also only ever looked at the topic's own `xml:lang` — commonly set once at the map/bookmap level and left implicit on individual topics — so most real topics never had it to find; now falls back to the editor's own display language when the topic has none of its own.

- **Fixed the selected custom CSS theme and page-width dropdown silently reverting to the default on every edit.** Both dropdowns only ever held their selection in the webview's own in-memory state, never reported back to the extension — so every content re-render (a full reload, until the fix above) regenerated the page from scratch using the always-recomputed default, with no memory of what had been picked. Persisted per-document via the same mechanism font-size preferences already used.

- **Fixed ditamap-level profiling display and Book mode scope.** Oxygen draws one box around a topicref that declares a profiling attribute, enclosing its whole subtree, with the label shown once at the bottom — the initial implementation instead showed a separate, repeated chip on every single descendant that merely inherited the attribute, unreadable clutter on any map with real depth. Now only the topicref that actually declares an attribute gets a box/label, still enclosing its whole subtree; children that only inherited it stay unmarked (but remain correctly filterable). Separately, Book mode no longer shows topicref-level (ditamap-source) profiling/filtering at all — it composites topic content for reading, the same as opening each topic directly, and now behaves that way; that scope stays exclusive to Outline mode's tree.

- **Fixed the green profiling highlight box overlapping list bullets/numbers, misaligning nested-list indentation, and reserving a disproportionately tall empty gap below short content.** Three related issues, all from the same underlying box design:
  - The highlight was a `<span>` wrapping the *entire* profiled element (e.g. an `<li>`), inserting an extra element between it and its real parent (`<ul>`/`<ol>`) — the browser positioned that `<li>`'s marker relative to the wrapper's own padding/border instead of the actual list, both visually overlapping the marker and leaving a profiled item's indent not matching its plain siblings. The highlight class/attributes now go directly on the element's own tag instead of a wrapper, with the label inserted as its last child.
  - Making that direct-application change work also required switching from `border` to `box-shadow` for the highlight (a border takes box-model space that shifts content and covers markers; `box-shadow` paints outward without affecting layout) and correcting a follow-up regression where a profiled `<ul>`/`<ol>` lost the left padding its own children's markers need entirely, making a profiled nested list stop looking nested.
  - The label ("Attr [value]") no longer reserves a fixed block of space below the content regardless of how little the content actually needs — it now floats to the right, sitting on the same line as short content for free, and only drops to its own (still right-aligned) line when the content above it is itself block-level and doesn't leave room on the same line.

- **Fixed a source ↔ preview scroll-sync feedback loop that could hijack the editor cursor while typing** — editing the source could sometimes make the preview jump, immediately followed by the source cursor itself jumping to an unrelated line, making it impossible to keep typing normally. Root cause: the preview's own scroll listener didn't distinguish "the user manually scrolled the preview" from "the extension just told the preview to scroll itself" (e.g. right after a source edit re-renders the preview and syncs it back to the source's current view). The latter was being echoed straight back out as if it were a real scroll, which could then move the *editor's* cursor. The preview now suppresses its own scroll-sync signal for the duration of any scroll it triggered itself, and scroll-following no longer moves the editor selection at all (only double-clicking an element in the preview does that, since that's an explicit navigation action, unlike continuous scroll-follow).

### Performance

- **Image dimension reads are now cached by file path + modification time.** Every source edit re-renders the whole topic, which calls the image-header-reading logic behind the aspect-ratio-reservation fix below again for every image in it — most of which have nothing to do with what was just typed. For a topic with a lot of images, that was a full header read (open + read + close, up to 64KB) per image on every single edit-triggered update. A cheap `stat()` now checks the file's mtime first; if it matches what's cached, the previously-read dimensions are returned without touching the file's content at all, so only a genuinely new or changed image pays for the full read. Unreadable/unrecognized files are cached too, so a broken image reference isn't re-parsed on every render either.

### Preview UX

- **Font size and family now persist** — previously the preview always reopened with the default sans-serif font at 100%, discarding any size/serif choice made in an earlier session; both are now remembered (stored globally, applying to every DITA file you preview) and a new reset button restores the default in one click
- **`note/@type` label coverage completed** — 5 of the 13 DITA 1.3 note types (`attention`, `caution`, `fastpath`, `remember`, `trouble`) previously fell through to displaying the raw, untranslated attribute value (visually capitalized by CSS, which is why e.g. `type="attention"` showed as "Attention" in English regardless of document language); all 13 types now have proper English/Chinese labels, matching DITA-OT's own strings bundles. Also added support for `@spectitle` (overrides the label for any note type) and `@othertype` (supplies the label when `type="other"`), neither of which were read before.
- **Image rendering: alt text, `@scale`/`@scalefit`, `placement="inline"` layout, and a new zoom/lightbox toolbar**
  - Alt text is now read from the `<alt>` child element (preferred, since it can hold formatted content) or the `@alt` attribute (fallback), and surfaced as both `alt` and a hover `title` — previously the `<alt>` child was silently dropped and only the (largely unused) `@alt` attribute path worked.
  - `@scale` (image size relative to its own natural dimensions) is now honored via CSS `zoom`, so the preview matches what actually gets published; explicit `width`/`height` still take precedence, and `@scalefit="yes"` suppresses scale/width/height in favor of the existing responsive default.
  - Fixed `placement="inline"` images inflating the line height they sit in — the vertical `margin` that belongs on block (`placement="break"`) images was being applied to inline ones too.
  - New toolbar zoom control (30–150%, session-only, preview-only — doesn't touch source or HTML export) for temporarily shrinking distracting screenshots while reading.
  - Click any image for a fullscreen lightbox (Esc or click-outside to close).
  - Fixed the broken-image error handler clobbering a real alt with the failure message; it now only falls back to that when no alt was ever provided, and always surfaces the failure via the hover title.
  - Along the way, fixed a latent bug in the shared `injectAttributes` helper: it unconditionally stamped every element with `title="<tagName>"`, which would have silently shadowed the new alt-derived `title` on `<img>` (HTML5 keeps the first of two duplicate attributes) — it now defers to a renderer-supplied `title` when present.
- **Image zoom control redesigned** — the toolbar's image-size control (added above) behaved unevenly: driving both `@scale` and the toolbar zoom through the same `zoom` CSS property meant `max-width:100%` was still the binding constraint across most of the range for any image wider than the preview pane, so most zoom steps visibly did nothing until the image's zoomed size finally dropped below the pane width, at which point it would suddenly shrink all at once. The toolbar control now drives `max-width` (a percentage of the pane) directly instead, independent of `@scale` (which keeps using `zoom`, appropriate since it's relative to the image's own natural size, not the pane) — each step now changes the rendered size by a consistent, predictable amount. Also replaced the camera-emoji icon with a clearer text label, and capped the range at 100% (pure shrink) since going above it would just overflow the pane — the lightbox is the tool for seeing an image bigger.
- **`<mathml>` formulas now render** — previously fell through to a generic fallback that stripped every MathML tag (`<mfrac>`, `<msqrt>`, `<msup>`, etc.), leaving only the flattened, unstructured text of the formula. `<mathml>`/`<foreign>` content is now serialized back out as real markup and left to the webview's own native MathML Core rendering (supported by Chromium since version 109, which any reasonably current VS Code bundles) instead of DITA Viewer trying to typeset math itself. Scoped to a real MathML tag allowlist and strips event-handler/URL-bearing attributes regardless of tag, so malformed or hand-edited content can't smuggle through markup the browser would treat as active rather than as math. A `test-dita-file/topics/mathml_test.dita` fixture was added for visually confirming this renders correctly.
  - **Fixed brackets and absolute-value bars silently vanishing from real formulas** (e.g. summation terms missing their parentheses, `|angle|` missing its `|` bars) — `<mfenced>` is real MathML 3, and it's how Oxygen's equation editor exports every parenthesized group and every `|...|` construct by default, but MathML Core (what Chromium's native renderer actually implements) dropped `<mfenced>` from the spec entirely. It wasn't rendering as the wrong bracket — the whole element and its fences were silently dropped. `<mfenced>` is now expanded at render time into an `<mrow>` with explicit `<mo>` fence/separator characters (honoring `open`/`close`/`separators`, including the "no fence on this side" empty-string case and the spec's repeat-the-last-separator rule for extra gaps), the same compatibility approach MathJax and other engines use for the same Core gap. `mmultiscripts`/`mprescripts` and the elementary-math element family (`mstack`, `mlongdiv`, …) have the same Core gap and aren't covered yet — no reported case to fix against so far. Added `test-dita-file/topics/mathml_mfenced_test.dita`, reproducing the two real reported formulas byte-for-byte.
- **`conref` + `conrefend` range references are now supported** — previously a `conref`/`conrefend` pair (Oxygen's "reference to range end") only pulled in the single element at `conref`, silently ignoring everything through `conrefend`. The full run of sibling elements from the `conref` target through the `conrefend` target, inclusive, is now resolved and rendered, matching Oxygen's behavior. Only the first element in the range takes on the referencing element's own attributes (normal conref semantics); the rest render as themselves from the target document. Known limitation: scroll-sync/highlighting for range members after the first will point at line numbers in the *target* file rather than the current one, since that's genuinely where their content lives — flagged rather than worked around.
- **Profiling/conditional-processing attributes are now highlighted, and can now actually be filtered** — content carrying `props`, `platform`, `product`, `audience`, `otherprops`, `base`, `importance`, `rev`, or `status` (the full DITA 1.3 `select-atts` group) now renders inside a highlight box with a small label naming the attribute and value that matched (e.g. `Audience [expert]`), matching Oxygen's default "show profiling" style, plus a new toolbar toggle ("Flags", on by default) that hides just the highlighting without a re-render.
  - A second toolbar button ("Filter") opens a panel listing every profiling attribute/value combination found in the document as checkboxes, grouped by attribute — unchecking a value actually hides content carrying it (not just the highlight), for previewing what a given build/audience would actually see. Deliberately a separate control from the highlight toggle, since "show me what's flagged" and "show me what this looks like built for X" are different questions.
  - `test-dita-file/topics/profiling_test.dita` (mirroring the reported example, plus inline and nested-profiling cases) was added for visually confirming both.
  - **Highlight box switched from a tinted fill to an outline-only border** — matches Oxygen's own default display (a stroked box around the matched content) rather than tinting the underlying text's background.
  - **Filter button now gives visible feedback** — previously toggling it gave no indication either way, leaving no way to tell whether a filter was actually in effect; it now lights up (same treatment as Flags) whenever an exclusion is actually hiding something, stays lit after the panel is closed if the filter is still active, sits directly next to Flags in the toolbar instead of being separated by the width/refresh controls, and its panel now opens anchored under the toolbar's own position instead of a fixed top-left offset.
  - **Ditamap/book view now supports its own profiling and filtering, cascading from parent topicref to child topicrefs** — previously profiling only applied within topic content; a topicref's own profiling attributes set directly in the ditamap source had no effect on the map or book preview at all. A topicref's profiling attributes now cascade to every descendant topicref that doesn't set its own value for the same attribute (own value replaces, not merges with, an inherited one — matching real `.ditaval`/Oxygen conditional-processing semantics), and the same Flags/Filter toolbar controls from the topic preview are now available in map/book view too, both reusing the exact same attribute list and `data-profile-keys` encoding so one Filter panel governs topic-internal and map-level profiling together without the two scopes drifting apart. This is deliberately a separate scope from in-topic profiling, though: opening a single `.dita` file directly still only reads that file's own inline markup, unaffected by whatever ditamap(s) happen to reference it. Nested ditamaps (an "all-in-one" map that only references other maps) cascade correctly with no special-casing needed, since a referenced submap's topicrefs are already spliced into the same tree (by the existing map-merging logic) before the cascade runs.

- **Images default to left-aligned instead of centered** — a standalone `<fig>`'s image now aligns flush with the surrounding body text's left edge, and an image inside a list item aligns with the item's own text rather than centering across the whole preview width, matching how figures read in Oxygen. No layout-detection logic needed: removing the forced centering lets each image fall back to the natural left edge of whatever block already contains it.

### Localization

- **Full English/Simplified Chinese localization of every user-facing string, with automatic language detection** — the extension follows the VS Code display language (itself system-language by default) with no language setting to configure; any other display language falls back to English. Built on the standard VS Code l10n mechanism across three layers, each extensible by adding a catalog file with no code change:
  - Manifest strings (command titles, the map-explorer view name, configuration descriptions) via `package.nls.json` / `package.nls.zh-cn.json`.
  - Extension-host strings (notifications, QuickPick labels/placeholders, DITA-OT progress and output-log lines, diagnostics) via `vscode.l10n.t()` with `l10n/bundle.l10n.*.json` catalogs — 99 strings, English source text as key, `{0}`-style placeholders.
  - Webview strings (toolbar tooltips, search box, profiling Flags/Filter panel, font/width controls) — the webview can't call `vscode.l10n` itself, so the extension host translates every label up front and injects them as a JSON object the inline script reads; nothing user-visible is hardcoded in the webview.
  - Bookmap role badges (第 1 章 / 附录 A / 前言 / …) translate through the same mechanism at render time; the render layer stays pure of VS Code imports by receiving already-translated labels.
  - One deliberate exception: note-type labels (Warning/警告, Danger/危险, …) follow the *document's* `xml:lang`, falling back to the display language when the document declares none — matching how DITA-OT itself picks strings at publish time (labels mirror DITA-OT's own `strings-en-us.xml` / `strings-zh-cn.xml`).
- **`npm run check:l10n`** — consistency guard (`scripts/check-l10n.cjs`) cross-checking every `vscode.l10n.t()` string in the source against both catalogs (missing keys, untranslated keys, stale keys, en/zh drift) and every `package.json` `%key%` against both `package.nls` files, with an allowlist for the book-role labels resolved by runtime key.

## 1.0.7 (2026-08-01)

### Rendering Completeness (new)

- **DTD-driven tag mapping audit** — every element's `@class` default value in the DITA-OT 1.3 DTDs (base, technicalContent, bookmap) was extracted and diffed against the extension's hand-maintained tag map, closing every gap found: task/concept/reference topic types, the troubleshooting module, glossary entry substructure (`glossBody`, `glossAlt`, synonyms/acronyms/…), the taskreq domain, image-map and programming-domain grouping elements (`figgroup`), MathML/SVG foreign-content wrappers, and the remaining release-management and bookmap metadata fields — now render correctly even when the source XML omits explicit `@class` attributes (a reusable extraction script, `scripts/extract-dita-class.cjs`, is checked in for re-running against future DITA-OT upgrades)
- **`<prolog>` no longer leaks into the preview** — topic metadata (`author`, `keywords`, revision history, etc.) previously rendered as unstyled text at the top of the body when the source lacked an explicit `@class="- topic/prolog "` attribute; it's now correctly suppressed
- **Highlight domain: `line-through`/`overline`** — render as a semantic `<s>` element and a themeable `.overline` CSS class respectively, matching the existing `b`/`i`/`u`/`tt`/`sup`/`sub` convention

## 1.0.6 (2026-07-28)

### Language Features (new)

- **Go to Definition** — Ctrl+Click on `keyref`/`conkeyref` jumps to the key definition in the owning map; `conref`/`href` jumps to the referenced file and the exact target element id
- **IntelliSense completion** — context-aware completion for DITA tags, attribute names, and attribute values: defined keys for `keyref`, workspace `.dita`/`.ditamap` files for `href`, target ids for `conref` fragments; typing `</` offers the matching closing tag
- **Auto-closing tags** — typing `>` after an opening tag inserts the matching `</tag>` with the cursor kept inside (mirrors VS Code's built-in HTML behavior); handles comments, CDATA, self-closing tags, and `>` inside attribute values correctly
- **Reference diagnostics** — broken references surface in the Problems panel as you type (debounced): undefined keys, missing referenced files, and missing target ids
- **Document outline** — Outline view and breadcrumbs for topics (title/section hierarchy, including `concept`/`task`/`reference` roots) and maps (topicref tree with keydefs and structural containers)
- **DITA snippets** — ready-made snippets for common structures (topic/concept/task/reference skeletons, sections, tables, figures, notes, xref/keyref, …)

### DITA Map Explorer (new)

- **Sidebar tree view** — the map associated with the active editor stays visible in the Explorer while editing any `.dita` file; click any entry to open the referenced topic; refresh button and automatic reload on map save

### Export as HTML (new)

- **`DITA: Export as HTML…`** — renders the active topic or full map to a single self-contained `.html` file (styles inlined, images embedded as data URIs) using the extension's own pipeline — no DITA-OT required

### BookMap Semantics

- **Numbered role badges** — chapters, parts, and appendixes are numbered per nesting depth (top-level Chapter 1/2/3, nested chapters restart at 1 under each parent; Part I/II in roman numerals, Appendix A…Z/AA) in the map preview, sidebar tree, outline, and HTML export
- **Localized badges** — role labels follow the VS Code display language (zh-CN: 第 1 章 / 第 I 部分 / 附录 A, plus 前言、声明、献词、后记、摘要、修订记录、术语表)
- **Book title page** — `<booktitle>` renders `mainbooktitle` as an elevated headline with `booktitlealt`/`subtitle` as subtitle lines instead of concatenating them into one string; the HTML export title prefers `mainbooktitle`
- **Structural rendering** — bookmap structural containers (`frontmatter`, `backmatter`, `booklists`, `toc`, …) render as labeled groups in tree view and pass through in book view

### Map Preview

- **In-preview search** — search overlay in topic and map reading views with match navigation, case-sensitivity, and regex toggles
- **Cross-file xref titles** — improved title resolution for cross-file `xref` targets

### Fixes

- **Percent-encoded hrefs** — hrefs containing `%20` and other URL escapes (the default encoding DITA tools apply to spaces and non-ASCII file names) now resolve to the actual file on disk everywhere: image loading in previews and HTML export, topic/sub-map resolution, sidebar clicks, Go to Definition, and reference diagnostics
- **HTML export badge escaping** — role badge text is HTML-escaped in exported files
- **Diagnostics cleanup** — pending diagnostic timers are cleared when a document closes

## 1.0.5 (2026-07-27)

### Key Resolution & Map References

- **Cross-folder keydef maps** — `keyref` values now resolve correctly when the keydef map lives in a different folder than the root map (parent folder, sub-folder, or anywhere reachable through map references); resolution follows the source map's references instead of assuming a same-level `keys.ditamap`
- **Href rebasing** — when a referenced map is inlined, all local hrefs inside it are rebased from the referenced map's folder onto the root map's folder, so topics, images, and nested maps resolve from any directory depth
- **`<mapref>` support** — `mapref` elements are now expanded and rendered like `topicref`/`keydef` map references (previously rendered as empty)
- **All-in-one maps** — a map that references only other maps (e.g. sub-maps in nested sub-folders) now renders the full merged tree, including recursively nested map references
- **Key precedence** — key map discovery scans all ancestor directories (nearest first) with first-definition-wins semantics, matching the DITA key precedence rule
- **`keyref` in map titles and navtitles** — `<ph keyref="..."/>` (and any empty element carrying a `keyref`) inside the map `<title>`, `navtitle`, `linktext`, or `keyword` now renders the resolved key value in the map preview (e.g. `<title><ph keyref="product_name"/> User Guide</title>`)

### Map Preview UX

- **Refresh button** — map preview toolbar now includes a reload button
- **Mode toggle fix** — switching to Book mode no longer gets stuck: the toggle now correctly returns to Tree mode on the next click
- **Book mode map entries** — referenced `.ditamap` entries render as section placeholders instead of failing to load as topics

### Reading View ⇄ Source Toggle

- **Two-way toggle** — running *Open DITA Reading View* / *Open DITA Map Reading View* (button, keybinding, or command palette) while the reading view is active now switches back to the source editor: focuses an already-open source tab and closes the preview, or reopens the tab with the text editor in place
- **Context-aware toolbar button** — while a reading view is active, the editor title button changes to **Back to DITA Source** / **Back to DITA Map Source** (`$(go-to-file)` icon), so the tooltip no longer misleadingly says "Open … Reading View"; new companion commands `ditaViewer.showSource` / `ditaViewer.showMapSource`

### Bug Fixes

- **Disposed webview guard** — pending sync timers in the topic preview no longer post to a disposed webview when the panel is closed or replaced quickly (fixes an uncaught "Webview is disposed" error)

## 1.0.4 (2026-07-21)

### Site-Chrome Enhancements (HTML5/XHTML Output)

- **Navigation toolbar** — fixed right-side toolbar with section collapse/expand, back-to-home button, and prev/next page navigation (auto-resolved from the DITA map)
- **Sidebar TOC** — fixed left sidebar with full topic tree; current page highlighted with scroll-into-view; collapses to static on mobile
- **On-page heading navigation** — floating right-side TOC listing `h2`/`h3` headings within the current page; smooth-scroll on click
- **Code language labels** — language extracted from `outputclass` (e.g. `language-cpp`) and displayed at top-right; clicking the label copies the entire code block content (clipboard API with execCommand fallback)
- **Back-to-top button** — floating circular button at bottom-right, appears after scrolling past 400px
- **Dark mode toggle** — floating toggle at bottom-right, switches between light/dark themes; respects `prefers-color-scheme` on first visit; preference persisted in `localStorage`
- **Dark mode CSS** — comprehensive `dark-mode.css` covering all UI elements (sidebar, toolbar, code blocks, tables, notes, blockquotes, links, inline code/kbd/filepath, related-links)
- **Index page** — homepage detected automatically; sidebar removed; navigation list displayed as centered card-style directory; no toolbar collapse/sidebar/on-page-TOC injected
- All features opt-out via QuickPick during transform flow; injected as `dita-viewer-chrome.js` + `dita-viewer-chrome.css` (+ `dita-viewer-dark.css`) into the DITA-OT output

### DITA-OT Transform Workflow

- **CSS file selection** — QuickPick scans map directory and workspace root for `.css` files; selected file passed to DITA-OT via `args.css` / `args.cssroot` / `args.copycss` / `args.csspath`
- **DITAVAL filter support** — optional `.ditaval` file selection passed via `--filter` for conditional content profiling
- **Command rename** — "DITA-OT: Transform Map to HTML5" renamed to "DITA-OT: Transform Map…" to reflect multi-transtype support
- **Transform icon** — toolbar button for the DITA-OT transform command added to the editor title bar
- **`--nav-toc=full`** — DITA-OT generates full TOC `<nav>` in every page, enabling the sidebar on topic pages

### Bug Fixes

- **Drive letter case** — Windows drive letters in output paths now consistently normalized to uppercase (prevents "path not found" mismatches)
- **Dark mode initial palette** — background `#1a1a1a`→`#1e1e1e` for better readability; added missing inline-code, keyboard, filepath, table-alternate-row, and related-links styles
- **Home button path** — now derives correct root-relative path from the injected CSS `<link>` href, fixing broken navigation from subdirectory topic pages
- **Sidebar selectors** — changed from `.dv-sidebar ul.map` / `.dv-sidebar .topicref` to generic `.dv-sidebar ul` / `.dv-sidebar li` to correctly match DITA-OT's `<nav class="toc">` output structure

### Infrastructure

- `esbuild.config.js` — production build with minification; development build `--dev` preserves source maps
- `ditaOtUtils.ts` — `buildDitaOtArgs()` extended with CSS/DITAVAL parameters; `SiteChromeFeatures` interface for feature flag typing
- `extension.ts` — full QuickPick-driven transform flow documented with step-by-step progress notification

## 1.0.3 (2026-07-17)

### DITA Map Preview

- Add `.ditamap` custom editor (`ditaViewer.mapPreview`) with structured preview
- **Tree mode** — hierarchical view of map entries (topicref, keydef, topicgroup, etc.) with display name resolution (navtitle → linktext → keyword → href filename → keys)
- **Book mode** — renders all referenced topics as a continuous reading flow; per-topic `asWebviewUri` for correct image/cross-reference resolution; duplicate-file detection with skip messages
- **Mode toggle button** — switch between Tree and Book modes from the toolbar
- **Reltable and topicgroup support** — reltables are excluded from the tree; topicgroups contribute children without adding their own entry

### Shared Rendering Pipeline

- Extract `renderTopicToHtml()`, `buildTitleMap()`, `makeConrefResolver()`, `makeFileTitleResolver()`, `detectNoteLabels()`, `collectText()`, `escapeHtml()`, `escapeAttr()` into `src/editor/ditaRenderUtils.ts` — pure utilities with no `vscode` dependency, shared between `.dita` and `.ditamap` editors
- Add `renderBookPlaceholder()`, `renderBookError()`, `renderBookSkipMessage()` for book-mode output

### Parser Refactoring

- `parseXml(xml, tagMap)` factory — shared base for both topic and map parsing
- `parseDita(xml)` — topic parsing (uses `STANDARD_TAG_TO_BASETYPE`)
- `parseDitamap(xml)` — map parsing (uses `MAP_STANDARD_TAG_TO_BASETYPE`)
- `preprocessEntities()` moved to `ditaParser.ts`
- `src/parser/mapTagMap.ts` — 20 DITAMAP tags mapped to `map/xxx` baseTypes

### Map Renderer

- `src/render/mapTypeMap.ts` — `renderMapDocument()`, `collectMapEntries()`, `MapEntry` interface, `MAP_BASE_TYPE_RENDERERS`
- Display name priority: `navtitle` > `linktext` > `keyword` > href filename stripped of extension > `keys` > `"(unnamed)"`
- All output (titles, hrefs, keys, display names) properly escaped

### Keybindings & Commands

- New command `ditaViewer.showMapRendered` with keybinding `Ctrl+Shift+Alt+M`
- New `ditamap` language registration with `onLanguage:ditamap` activation event
- Editor title button and context menu entries for `.ditamap` files

### Security Hardening

- `resolveTitle` return value now wrapped in `escapeAttr()` (prevent XSS in cross-reference titles)
- Map title text escaped via `escapeAttr()` in map renderer
- XSS regression tests for all rendered output: href, keys, title, resolveTitle, placeholder headings, error messages, skip messages
- Content Security Policy: `script-src 'nonce-${nonce}'` with no `unsafe-inline`; toolbar click handlers use `addEventListener`

### Rendering Enhancements

- CSS **theme switcher** dropdown in preview toolbar
- Language label on `<codeblock>` elements with `outputclass`
- `id` attribute escaping in rendered HTML
- Note type attribute escaping
- Image `alt` attribute escaping
- Ampersand double-escaping prevention in attributes
- Heading level incrementation inside nested `<section>` elements
- `<fn>` (footnote) and `<pre>` element support
- Improved note rendering with type-specific CSS classes

### DITA-OT Transform Integration

- New command `ditaViewer.transformWithDitaOt` — run DITA-OT publishing transforms from VS Code
- **DITA-OT detection** — automatic discovery via setting (`dita-viewer.ditaOtPath`), `DITA_HOME` environment variable, or `PATH`, with clear error messages and guided setup
- **Transtype selection** — QuickPick with `html5` (default), `pdf`, `xhtml`, `markdown`
- **Real-time output logging** — dedicated `DITA-OT Transform` output channel with live streaming of stdout/stderr
- **Cancellable** — progress notification with cancellation support that properly terminates the child process
- **Smart output directory** — defaults to `<map-dir>/out/<transtype>/` with overwrite confirmation when directory is non-empty
- **Completion actions** — `html5` outputs open directly in browser; other formats open in file manager
- **Error log classification** — `[ERROR]` lines detected and reported in completion notification
- **Map file resolution** — from `.dita` files, auto-discovers `.ditamap` in ancestor directories (with QuickPick for multiple candidates)
- Pure-function testable utilities in `src/editor/ditaOtUtils.ts`: `resolveDitaOtExecutable()`, `buildDitaOtArgs()`, `classifyLogLine()`

### Bug Fixes

- `buildKeyMap` import restored after refactoring
- `ditaViewer.showMapRendered` command registered in extension entry point
- `parseDita` import restored in DitaViewerProvider
- CI branch filter corrected for pull_request events
