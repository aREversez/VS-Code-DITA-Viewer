# Changelog

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
