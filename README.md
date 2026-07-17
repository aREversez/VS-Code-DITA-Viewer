# DITA Viewer

A VS Code extension that renders **`.dita`** and **`.ditamap`** files as a formatted, read-only preview — similar to a WYSIWYG reading view. Built with [sax](https://github.com/isaacs/sax-js) XML parsing and a custom DITA-to-HTML rendering engine.

## Features

- **DITA topic preview** (`.dita`) — rendered view with bidirectional scroll sync
- **DITA Map preview** (`.ditamap`) — two modes:
  - **Tree view** — structured hierarchy of map entries with display names and navigation
  - **Book mode** — renders all referenced topics in sequence as a single reading flow
- **Full DITA element coverage** — topic, sections, notes (all types), lists, tables, figures, code blocks with language labels, images, cross-references (with title resolution), quotes, related links, inline formatting, keydef/keyword display
- **Reltable and topicgroup support** — reltables are skipped from the tree; topicgroups render children without adding their own entry
- **Theme-aware** — automatically adapts background and border colors to the current VS Code theme
- **Custom CSS support** — override or extend the default styling with an in-preview theme switcher
- **CSS theme switcher** — preview includes a dropdown in the top-right corner to switch between available `.css` files on the fly

## Usage

### Open a DITA Topic Preview

**Method 1 — Button:** Open a `.dita` file, then click the **preview icon** (book) in the editor title bar.

**Method 2 — Right-click:** Right-click a `.dita` file in the editor and select **Open DITA Reading View**.

**Method 3 — Command Palette:** With a `.dita` file open, press `Ctrl+Shift+P` and run **Open DITA Reading View**.

**Method 4 — Shortcut:** With a `.dita` file focused, press `Ctrl+Shift+Alt+D`.

The preview opens in a new column beside your source editor.

### Open a DITA Map Preview

**Method 1 — Button:** Open a `.ditamap` file, then click the **preview icon** (book) in the editor title bar.

**Method 2 — Right-click:** Right-click a `.ditamap` file and select **Open DITA Map Reading View**.

**Method 3 — Command Palette:** With a `.ditamap` file open, run **Open DITA Map Reading View**.

**Method 4 — Shortcut:** With a `.ditamap` file focused, press `Ctrl+Shift+Alt+M`.

#### Tree Mode vs Book Mode

The map preview opens in **Tree mode** by default, showing the map's hierarchical structure. Click the **"Switch to Book Mode"** button in the toolbar to render all referenced topics inline as a continuous document. Click **"Switch to Tree Mode"** to return to the tree view.

Duplicate topics (same file referenced multiple times) are shown with a skip message rather than being re-rendered.

## Custom CSS

You can customize the preview appearance with your own stylesheets.

### Theme switcher

When you open a DITA preview, a small toolbar appears in the **top-right corner** with:

- **Theme dropdown** — lists all `.css` files discovered in the project (auto-discovered `custom.css` directory + workspace root + configured paths). Select one to instantly switch styles.
- **Refresh button** (↻) — reloads the DITA content and re-renders the preview.

The default theme is always `custom.css` if it exists. All available CSS files are loaded into the dropdown so you can toggle between them without re-opening the preview.

### Auto-discovery (zero config)

Place a `custom.css` file anywhere in an ancestor directory of your DITA file. The extension walks up from the DITA file's directory toward the workspace root and loads the first `custom.css` it finds.

```
my-project/
├── custom.css              ← loaded automatically
├── docs/
│   ├── custom.css          ← also works (closest ancestor wins)
│   └── topics/
│       └── overview.dita
└── maps/
    └── project.ditamap
```

### Manual configuration

Set `dita-viewer.customCss` in your settings (Workspace or User):

```jsonc
{
  // Single file (workspace-relative)
  "dita-viewer.customCss": ["custom.css"],

  // Multiple files (applied in order)
  "dita-viewer.customCss": [
    "base.css",
    "theme.css",
    "overrides.css"
  ],

  // Mixed path types
  "dita-viewer.customCss": [
    "docs/styles/published.css",    // workspace relative
    "../shared/global.css",          // document relative
    "C:/team-styles/common.css"      // absolute path
  ]
}
```

You can also set it via the Settings UI: `Ctrl+Shift+P` → search "DITA Viewer".

### What you can override

Custom CSS is injected after the default stylesheet and can override any default rule. Common customizations:

```css
/* Override default CSS variables */
:root {
  --color-note-bg: #fff3cd;
  --color-note-border: #ffc107;
  --color-code-bg: #1e1e1e;
  --color-link: #0078d4;
}

/* Override element styles */
body { font-family: 'Noto Sans SC', sans-serif; }
table th { background: #2c3e50; color: #fff; }

/* Full document theme (see test-dita-file/custom.css for a complete example) */
```

> **Note:** Custom CSS is not subject to the WebView's Content Security Policy, so you can use custom fonts, background images, etc. External images in CSS must still resolve to accessible paths.

## Installation

### From VSIX

1. Download `dita-viewer-1.0.3.vsix`
2. In VS Code, press `Ctrl+Shift+P` → **Extensions: Install from VSIX...**
3. Select the `.vsix` file

### From source

```bash
git clone <repo-url>
cd dita-viewer
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
npx @vscode/vsce package --out output/dita-viewer-<version>.vsix
```

## Project Structure

```
src/
├── extension.ts              # Extension entry point, command registration
├── editor/
│   ├── DitaViewerProvider.ts # CustomTextEditorProvider for .dita files
│   ├── MapViewerProvider.ts  # CustomTextEditorProvider for .ditamap files (tree + book mode)
│   └── ditaRenderUtils.ts    # Shared pure rendering utilities (no vscode dependency)
├── parser/
│   ├── ditaParser.ts         # SAX-based DITA XML parser (parseXml/parseDita/parseDitamap)
│   ├── domTypes.ts           # DitaNode, DitaElement, DitaDocument types
│   ├── standardTagMap.ts     # Tag → DITA type mapping for topics
│   └── mapTagMap.ts          # Tag → DITA type mapping for maps
└── render/
    ├── renderer.ts           # Recursive DitaNode → HTML engine
    ├── baseTypeMap.ts        # Rendering functions per DITA base type
    └── mapTypeMap.ts         # Map tree renderer (renderMapDocument, collectMapEntries)
media/
├── styles.css                # Default preview stylesheet (included in VSIX)
└── icons/
    ├── preview.svg
    └── preview~dark.svg
test/
├── parser/                   # Parser unit tests (dita + map)
├── render/                   # Renderer unit tests (topic + map tree + map book)
└── verify-real-files.ts      # Integration tests with real .dita files
```

## License

MIT
