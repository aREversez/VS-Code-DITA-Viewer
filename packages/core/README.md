# @dita-viewer/core

Host-neutral DITA parsing and HTML rendering. It lives in the
[VS Code DITA Viewer](https://github.com/aREversez/VS-Code-DITA-Viewer)
repository, under `packages/core`, and is shared with
[obsidian-dita](https://github.com/aREversez/obsidian-dita), which installs it
from npm.

## What is in it

| Path | Origin |
| --- | --- |
| `src/parser/`, `src/render/`, `src/editor/*.ts` | The extension's own parser, renderer and editor files. They were first copied from its `dev` at commit `596202d` into this package, and the extension deleted its copies when it switched to depend on it. Except `editor/topicRender.ts`, which is from the upstream change "move openHrefTarget out of topicRender" (it was identical before that, and the other files were checked identical to `dev` at `de5a237`). The 15 files in `parser/`, `render/` and `editor/` are exactly the transitive import closure of `renderTopicToHtml` and import nothing from `vscode`. |
| `src/language/ditaLanguageUtils.ts`, `src/language/referenceableFiles.ts` | The extension's files too (same commit): completion-context detection, tag-stack scanning, and the file walk behind `href` completion. Both are `vscode`-free. |
| `src/keyMapForDocument.ts`, `src/mapRender.ts`, `src/bookRender.ts`, `src/siteRender.ts`, `src/index.ts` | New here. The public API; the key-map lookup without the VS Code workspace features; `renderMapXml`, which sequences the copied map parser and renderer for a `.ditamap` outline; `renderBookXml` for the whole map on one page; and `renderSiteXml`, which renders one map topic at a time plus the sidebar manifest. |
| `src/profiling.ts` | New here. Conditional processing: read a `.ditaval`, read the profiling values of an element or of the renderer's `data-profile-keys`, decide whether an element stays (DITA-OT rules), list the values for a filter panel, and prune filtered entries from a parsed map. `renderBookXml` and `renderSiteXml` take it as `filter`. Informed by the VS Code viewer's `src/editor/ditaval.ts`, which only answers the exclusion question and is not a drop-in. |
| `src/index.ts` | New here. The public API. Besides the high-level `render*` functions it exports the parser and renderer entry points (`parseDita`, `parseDitamap`, `renderDocument`, ...) and the types they use, which is everything the VS Code viewer imports from the modules it copied; `test/publicApi.test.ts` pins that list. |
| `src/completion.ts`, `src/completionData.ts` | New here. Host-neutral completion engine (`complete(text, offset, env)`) and its tables: usual children per element (a ranking aid only, never a filter), enumerated attribute values, which attributes name files. |
| `styles/dita-content.css` | The topic-content, `.ditamap` outline-tree, and map page/site rules of the VS Code `media/styles.css`, with every `--vscode-*` replaced by a `--dita-*` host token. See the header comment for the complete list of differences. |
| `styles/TOKENS.md` | The contract between the stylesheet and a host. |
| `test/` | The upstream tests whose imports stay inside the 15 files (plus tests for completion, map rendering, book and site rendering), unchanged except for import paths. |

## Changing the shared files

This package is edited here. The extension imports it through the npm
workspace (`"@dita-viewer/core": "*"` links `packages/core`), so a change is in
the extension's next build with no release in between. obsidian-dita installs
a published version, so a change reaches it only after a release (see below).
The extension depends on the core as `*` on purpose: an exact version stops
matching the workspace after the first bump, and npm would then install the
published copy next to it.

The root scripts compile this package before anything that imports it
(`typecheck`, `build`, `test`, `test:visual`, `test:e2e`, `watch`), because the
extension reads its `dist/`. `npm run verify` also runs this package's own
tests. `npm run watch` compiles it once, at the start; after editing it while
watching, run `npm run build:core`.

The stylesheet is the same in both places apart from the host. The
extension's `media/styles.css` reads the same `--dita-*` tokens as
`styles/dita-content.css` in its content and outline rules, answered from VS
Code's theme in one `:root` block, and `src/test/media/hostTokens.test.ts`
fails when the set of tokens the two read drifts apart. What remains is that
the extension keeps its own copy of the rules; `dita-content.css` also holds the
Obsidian-only book and site rules the extension does not need.

## Two builds

`npm run build` writes `dist/` (CommonJS, with the type declarations) and
`dist-esm/` (the same modules as ES modules). `package.json` offers `dist-esm`
under the `module` condition of `exports`, which bundlers such as esbuild take
and Node ignores; Node, `require` and TypeScript get `dist/`. The point is size:
a bundler can leave out what the host does not import, which took about 43 KB
out of the extension's bundle (the site and book renderers, diagnostics and
completion, none of which it uses). `npm run check:core-pack` checks all three
paths: a Node `require`, a Node ES module `import`, and a bundler dropping the
modules it does not use. `dist-esm` is not meant for Node to load directly: its
relative imports have no file extensions.

## Publishing to npm

Releases are made by `.github/workflows/release-core.yml`, which publishes with
npm's OIDC trusted publishing: no npm token is stored anywhere.

```
# raise "version" in packages/core/package.json, commit, then:
git tag core-0.2.1                     # the tag must be core-<the version in package.json>
git push --follow-tags
```

One-time setup, on npmjs.com: open the package `@dita-viewer/core`, then
Settings, Trusted Publisher, GitHub Actions, and enter owner `aREversez`,
repository `VS-Code-DITA-Viewer`, workflow filename `release-core.yml`. It
must match exactly, and the `repository` field of `package.json` must name the
same repository, or npm refuses the provenance.

To publish by hand instead:

```
npm login                              # two-factor authentication is required
npm run verify
npm run check:core-pack                # packs, installs the tarball into an empty project, requires it, type-checks it
cd packages/core
npm publish                            # publishConfig makes it public; prepublishOnly builds first
```

A published version can never be reused, so run `check:core-pack` before every
release. Until the host-token and selector gaps are closed, keep the version at
`0.x`: the exported surface is allowed to change. obsidian-dita pins the exact
version it was built against.
