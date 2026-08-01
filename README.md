# DITA Viewer

A VS Code extension that renders **`.dita`** and **`.ditamap`** files as a formatted, read-only preview — similar to a WYSIWYG reading view. Built with [sax](https://github.com/isaacs/sax-js) XML parsing and a custom DITA-to-HTML rendering engine.

> GitHub: [aREversez/VS-Code-DITA-Viewer](https://github.com/aREversez/VS-Code-DITA-Viewer) · [Changelog](CHANGELOG.md) · [Issues](https://github.com/aREversez/VS-Code-DITA-Viewer/issues)

## Features

- **DITA topic preview** (`.dita`) — rendered view with bidirectional scroll sync
- **DITA Map preview** (`.ditamap`) — two modes:
  - **Outline (tree) view** — structured hierarchy of map entries with display names and navigation
  - **Book mode** — renders all referenced topics in sequence as a single reading flow
- **Two-way preview toggle** — the same button/shortcut that opens a reading view switches back to the source editor when pressed inside the preview (the toolbar button becomes **Back to DITA Source**)
- **Key and map-reference resolution** — `keyref` values resolve across folders by following the map's own references (`topicref`/`keydef`/`mapref` to other `.ditamap` files); nested and "all-in-one" maps are merged recursively with hrefs rebased onto the root map
- **BookMap semantics** — chapter/part/appendix entries carry numbered role badges in document order (Chapter 1, Part I, Appendix A …, localized in zh-CN as 第 1 章 / 第 I 部分 / 附录 A); `<booktitle>` renders as a title page with the main title elevated and alternate titles as subtitles
- **Writing assistance** — Go to Definition for `keyref`/`conref`/`href` (Ctrl+Click), context-aware IntelliSense (tags, attributes, defined keys, workspace files, target ids), HTML-style auto-closing tags, broken-reference diagnostics in the Problems panel, document outline/breadcrumbs, and ready-made DITA snippets
- **DITA Map Explorer** — persistent sidebar tree of the map associated with the active editor, with click-to-open navigation and numbered book divisions
- **Export as HTML** — render any topic or full map to a single self-contained `.html` file (styles inlined, images embedded) without DITA-OT
- **Full DITA element coverage** — topic, sections, notes (all types), lists, tables, figures, code blocks with language labels, images, cross-references (with title resolution), quotes, related links, inline formatting, keydef/keyword display; specialization modules (task/concept/reference, troubleshooting, glossary, taskreq, highlight/programming/software/UI domains) are audited against the DITA-OT 1.3 DTDs and render correctly even without explicit `@class` attributes in the source
- **Reltable and topicgroup support** — reltables are skipped from the tree; topicgroups render children without adding their own entry
- **Theme-aware** — automatically adapts background and border colors to the current VS Code theme
- **Custom CSS support** — override or extend the default styling with an in-preview theme switcher
- **DITA-OT Transform** — run formal publishing transforms (`html5`, `pdf`, `xhtml`, `markdown`) using a local DITA-OT installation with live log output, cancellable progress, CSS/DITAVAL support, and automatic injection of site-chrome enhancements (sidebar TOC, on-page navigation, code language labels, back-to-top, dark mode)

## Usage

### Open a DITA Topic Preview

**Method 1 — Button:** Open a `.dita` file, then click the **preview icon** (book) in the editor title bar.

**Method 2 — Right-click:** Right-click a `.dita` file in the editor and select **Open DITA Reading View**.

**Method 3 — Command Palette:** With a `.dita` file open, press `Ctrl+Shift+P` and run **Open DITA Reading View**.

**Method 4 — Shortcut:** With a `.dita` file focused, press `Ctrl+Shift+Alt+D`.

The preview opens in a new column beside your source editor.

> **Back to source:** while the reading view is focused, the editor title button changes to **Back to DITA Source** — click it (or press the same shortcut / run the same command) to return to the source editor. If the source file is already open in another tab, it is focused and the preview is closed; otherwise the preview tab is reopened in place as a text editor.

### Open a DITA Map Preview

**Method 1 — Button:** Open a `.ditamap` file, then click the **preview icon** (book) in the editor title bar.

**Method 2 — Right-click:** Right-click a `.ditamap` file and select **Open DITA Map Reading View**.

**Method 3 — Command Palette:** With a `.ditamap` file open, run **Open DITA Map Reading View**.

**Method 4 — Shortcut:** With a `.ditamap` file focused, press `Ctrl+Shift+Alt+M`.

> The same two-way toggle applies: inside the map reading view, the title button becomes **Back to DITA Map Source**.

#### Outline Mode vs Book Mode

The map preview opens in **Outline (tree) mode** by default, showing the map's hierarchical structure. Use the **Outline / Book** toggle in the toolbar to render all referenced topics inline as a continuous document, and click it again to return to the outline. A **reload button** (↻) in the toolbar re-renders the preview from the files on disk.

Duplicate topics (same file referenced multiple times) are shown with a skip message rather than being re-rendered.

#### Keys and map references

- `keyref` elements display the value from the matching `keydef`. The keydef map does **not** need to sit next to the root map or be named `keys.ditamap` — any local `.ditamap` referenced via `topicref`, `keydef`, or `mapref` (or found in an ancestor directory) is scanned, and the nearest definition wins.
- Maps that reference other maps (including “all-in-one” maps whose children live in nested sub-folders) are merged recursively; relative hrefs inside referenced maps are rebased automatically so topics and images resolve correctly.

## Custom CSS

You can customize the preview appearance with your own stylesheets. CSS files are loaded into the preview's **Theme dropdown** in the top-right toolbar, letting you switch between themes instantly without re-opening the preview.

### Quick start

1. Create a `custom.css` file next to your DITA files
2. Open/reload any `.dita` or `.ditamap` preview
3. The file appears in the **Theme dropdown** and is applied automatically

> The default theme is always `custom.css` if one exists. If you name it something else (e.g. `my-theme.css`), it still appears in the dropdown — you just need to select it manually the first time.

### How CSS files are discovered

The extension finds CSS files in this priority order:

1. **Auto-discovery (walk-up)** — Starting from your DITA file's directory, the extension walks up toward the workspace root looking for any directory that contains a `custom.css` file. The **closest** such directory and the **workspace root** are both scanned for all `.css` files.

   ```
   my-project/                  ← workspace root (also scanned)
   ├── custom.css               ← found by walk-up at root
   ├── docs/
   │   ├── custom.css           ← closest ancestor wins here (walk-up stops)
   │   ├── themes/
   │   │   ├── rose-pine.css    ← also loaded (same directory as custom.css)
   │   │   └── dawn.css
   │   └── topics/
   │       └── overview.dita    ← your DITA file
   └── maps/
       └── project.ditamap
   ```

2. **Configured directories** — `dita-viewer.cssDirectory` lists additional directories to scan for `.css` files.

3. **Explicit file paths** — `dita-viewer.customCss` lists specific `.css` files (workspace-relative, document-relative, or absolute).

All discovered files appear in the toolbar's **Theme dropdown**. Select any entry to apply it immediately.

### Configuration methods

#### VS Code Settings UI

Press `Ctrl+Shift+P` → search **"DITA Viewer"** to find all settings including `dita-viewer.cssDirectory` and `dita-viewer.customCss`.

#### `settings.json`

```jsonc
{
  // Directories to scan for .css files (auto-discovery runs first)
  "dita-viewer.cssDirectory": [
    "docs/styles",
    "../team-shared/themes"
  ],

  // Explicit file paths (highest priority)
  "dita-viewer.customCss": [
    "my-theme.css",                // workspace-relative
    "docs/styles/published.css",   // workspace-relative
    "../shared/global.css",        // document-relative (relative to the DITA file)
    "C:/team-styles/common.css"    // absolute path
  ]
}
```

### What you can override

Custom CSS is injected **after** the default `media/styles.css` and can override any rule. The default stylesheet defines these CSS variables for easy theming:

```css
:root {
  --color-bg: transparent;           /* page background */
  --color-text: inherit;             /* body text color */
  --color-link: var(--vscode-textLink-foreground);
  --color-border: var(--vscode-widget-border, #ddd);
  --color-code-bg: var(--vscode-textCodeBlock-background, #f8f8f8);
  --color-code-lang-bg: #e0e0e0;
  --color-note-bg: var(--vscode-editor-background);
  --color-note-border: var(--vscode-textLink-foreground);
  --color-table-header-bg: #e8e8e8;
  --color-table-border: #ccc;
  --color-blockquote-border: #ddd;
  --color-related-links-bg: #f5f5f5;
}
```

To override, just set the variable in your CSS:

```css
:root {
  --color-code-bg: #1e1e1e;
  --color-link: #0078d4;
}
```

### Practical examples

#### Minimal: just font and color tweaks

```css
body { font-family: 'Noto Sans SC', sans-serif; }
a { color: #1a73e8; }
pre.codeblock { background: #f5f5f5; border-radius: 6px; }
```

#### Complete page theme

Create a full documentation-style theme by overriding most elements. See the example files in `test-dita-file/`:

| File | Style |
|---|---|
| `custom.css` | Bright documentation (Oxygen WebHelp style) |
| `custom-doc-web.css` | Full-width web publication theme |
| `custom-doc-modern.css` | Modern dev docs with gradient header |
| `custom-doc-corporate.css` | Corporate intranet with branding |
| `custom-rose-pine.css` | Dark Rosé Pine theme |
| `custom-rose-dawn.css` | Light Rosé Pine Dawn theme |

Open a DITA preview, then use the **Theme dropdown** to cycle through these and see how they look.

#### Dark mode overrides

Your CSS can also provide `.vscode-dark` overrides that activate when VS Code's color theme is dark:

```css
.vscode-dark {
  --color-code-bg: #2d2d2d;
  --color-note-bg: #1e1e1e;
}
.vscode-dark table th { background: #45475a; }
```

### How CSS is injected

1. The default `media/styles.css` is always loaded first
2. Then the custom CSS file content replaces the previous custom style (switching themes is instantaneous — no page reload needed)
3. CSS specificity works normally: rules in your file override the defaults if they have equal or higher specificity

> **Note:** Custom CSS is not subject to the WebView's Content Security Policy, so you can use `@font-face`, custom fonts, background images, etc. External images in CSS must still resolve to accessible paths on disk.

## DITA-OT Transform

Transform your DITA maps to HTML5 (or other formats) using a local DITA-OT installation.

### Prerequisites

- Install [DITA-OT](https://www.dita-ot.org/documentation/installing) (requires Java Runtime Environment)
- The extension does **not** bundle DITA-OT — it detects your existing installation

### Detection priority

1. **Setting** — `dita-viewer.ditaOtPath` configured in VS Code settings (absolute path to DITA-OT directory)
2. **Environment** — `DITA_HOME` environment variable pointing to the DITA-OT root
3. **PATH** — `dita` (or `dita.bat` on Windows) found in system PATH

### Usage

Open a `.ditamap` file (or a `.dita` topic inside a map project), then:

1. Press `Ctrl+Shift+P` and run **DITA-OT: Transform Map…**
2. Select a **transtype** (`html5`, `pdf`, `xhtml`, `markdown`)
3. (Optional) Select a **CSS file** to pass to DITA-OT via `args.css` — the extension scans the map directory and workspace root for `.css` files
4. (Optional) Select a **DITAVAL filter file** to apply conditional processing
5. Select which **site-chrome enhancements** to inject into the output (all enabled by default):
   - **Nav toolbar** — prev/next page navigation + section collapse/expand + back-to-home button
   - **Sidebar TOC** — fixed left sidebar with the full topic tree (highlights current page)
   - **On-page TOC** — right-side floating heading navigation with smooth-scroll
   - **Code language labels** — language label at top-right of code blocks; click to copy code
   - **Back to top** — floating back-to-top button at bottom-right
   - **Dark mode** — light/dark toggle with `prefers-color-scheme` auto-detection
6. The transform runs with a cancellable progress notification and live log output in the **DITA-OT Transform** output channel
7. On completion:
   - `html5` / `xhtml` output is enhanced with all selected site-chrome features and opened in your browser
   - `pdf` / `markdown` output opens in the file manager

Output is written to `out/<transtype>/` alongside your map file. If the directory already contains files, you'll be prompted before overwriting.

#### CSS support

When transforming to `html5` or `xhtml`, you can select a CSS file that gets passed to DITA-OT via `args.css`, `args.cssroot`, `args.copycss`, and `args.csspath`. The extension scans the map's directory and the workspace root for `.css` files and presents them in a QuickPick. This lets you control the formal published output's appearance without manually editing DITA-OT configuration.

#### DITAVAL filter support

You can optionally select a `.ditaval` filter file during the transform flow. When chosen, it's passed to DITA-OT via `--filter`, enabling conditional content filtering (profiling) during the formal publish.

#### Site-chrome enhancements

For `html5` / `xhtml` output, the extension automatically injects a **navigation toolbar**, **sidebar TOC**, **on-page heading navigation**, **code language labels with click-to-copy**, **back-to-top button**, and a **dark mode toggle**. All features are opt-out — deselect any you don't need during the QuickPick step, or re-enable them on subsequent transforms. The enhancements are written directly into the DITA-OT output directory as `dita-viewer-chrome.js`, `dita-viewer-chrome.css`, and (if dark mode is enabled) `dita-viewer-dark.css`, then linked into every HTML file.

## Installation

### From VSIX

1. Download the latest `.vsix` from the [releases page](https://github.com/aREversez/VS-Code-DITA-Viewer/releases)
2. In VS Code, press `Ctrl+Shift+P` → **Extensions: Install from VSIX...**
3. Select the `.vsix` file

### From source

```bash
git clone https://github.com/aREversez/VS-Code-DITA-Viewer.git
cd VS-Code-DITA-Viewer
npm install
npm run build
```

Then press `F5` in VS Code to launch the Extension Development Host.

## Development

```bash
npm run build          # Build (production)
npm run build:dev      # Build (development, with source maps)
npm run watch          # Watch mode
npm test               # Run unit tests
npm run test:e2e       # Run end-to-end tests
npm run lint           # Lint source
npm run format         # Format with Prettier
```

### Packaging

```bash
npx @vscode/vsce package --out output/
```

The `.vsix` file name is derived from the `name` and `version` fields in `package.json` (e.g. `output/dita-viewer-1.0.5.vsix`).

## Project Structure

```
src/
├── extension.ts              # Extension entry point, command registration, DITA-OT transform flow
├── editor/
│   ├── DitaViewerProvider.ts # CustomTextEditorProvider for .dita files (scroll sync, key map)
│   ├── MapViewerProvider.ts  # CustomTextEditorProvider for .ditamap files (outline + book mode)
│   ├── ditaRenderUtils.ts    # Shared pure rendering utilities (no vscode dependency)
│   └── ditaOtUtils.ts        # DITA-OT detection, argument building, log classification
├── parser/
│   ├── ditaParser.ts         # SAX-based DITA XML parser (parseXml/parseDita/parseDitamap)
│   ├── domTypes.ts           # DitaNode, DitaElement, DitaDocument types
│   ├── standardTagMap.ts     # Tag → DITA type mapping for topics
│   └── mapTagMap.ts          # Tag → DITA type mapping for maps
├── render/
│   ├── renderer.ts           # Recursive DitaNode → HTML engine
│   ├── baseTypeMap.ts        # Rendering functions per DITA base type
│   └── mapTypeMap.ts         # Map tree renderer (renderMapDocument, collectMapEntries)
├── test/                     # Unit tests (parser, render, editor utilities)
└── test-e2e/                 # End-to-end tests (@vscode/test-electron)
media/
├── styles.css                # Default preview stylesheet (included in VSIX)
├── icons/                    # Editor title bar + extension icons
└── transform-assets/         # Site-chrome JS/CSS injected into DITA-OT output
l10n/                         # Runtime translations (en + zh-cn)
test-dita-file/               # Sample DITA project used for manual testing and e2e fixtures
```

## License

MIT
