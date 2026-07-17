# Changelog

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

### Bug Fixes

- `buildKeyMap` import restored after refactoring
- `ditaViewer.showMapRendered` command registered in extension entry point
- `parseDita` import restored in DitaViewerProvider
- CI branch filter corrected for pull_request events
