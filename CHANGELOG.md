# Changelog

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

- **Numbered role badges** — chapters, parts, and appendixes are numbered in document order (Chapter 1/2/3 continuing across parts, Part I/II in roman numerals, Appendix A…Z/AA) in the map preview, sidebar tree, outline, and HTML export
- **Localized badges** — role labels follow the VS Code display language (zh-CN: 第 1 章 / 第 I 部分 / 附录 A, plus 前言、声明、献词、后记、摘要、修订记录、术语表)
- **Book title page** — `<booktitle>` renders `mainbooktitle` as an elevated headline with `booktitlealt`/`subtitle` as subtitle lines instead of concatenating them into one string; the HTML export title prefers `mainbooktitle`
- **Structural rendering** — bookmap structural containers (`frontmatter`, `backmatter`, `booklists`, `toc`, …) render as labeled groups in tree view and pass through in book view

### Map Preview

- **In-preview search** — search overlay in topic and map reading views with match navigation, case-sensitivity, and regex toggles
- **Cross-file xref titles** — improved title resolution for cross-file `xref` targets

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
