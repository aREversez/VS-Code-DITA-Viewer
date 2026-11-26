# @dita-viewer/core — Design: toward a host-agnostic DITA engine

Status: draft 1 · 2026-11-26 · measured at `e739149` (core 0.3.0)
Phase 1 is designed in full (section 3). Phases 2 and 3 are roadmap only (section 1) and are meant to be designed later, one at a time.

## 0. How to use this document

For the maintainer: section 1 is the plan, section 3 is what to build first.

For an agent asked to **plan Phase N (N = 2 or 3)**:

1. Read section 1 (roadmap, principles, decisions) and section 2 (working agreements) in full.
2. Re-measure the "Current state" facts with the commands in Appendix A. The numbers in this file were true on the date above and will have drifted.
3. Read the inputs listed in the Phase N brief (1.4 or 1.5).
4. Append a `## Phase N design` section to this file, following the structure of section 3: goals and non-goals, interfaces, mechanism, patch sequence (one patch per step), acceptance tests, risks and open questions. Update the status table in 1.3.
5. Do not start Phase N until Phase N−1's exit criteria are verified, and do not start implementing before the maintainer has accepted the design section.

For an agent asked to **implement Phase 1**: follow section 3.6 step by step. One step is one patch.

## 1. Roadmap

### 1.1 Where we are going

Today `@dita-viewer/core` is the shared rendering dependency of two products (the VS Code DITA Viewer extension and obsidian-dita). The direction is:

> A reusable, host-agnostic DITA processing engine for building DITA-powered applications.

Precise scope, to be used in the README and the npm description once Phase 1 is done: DITA parsing, key and reference resolution, conditional processing (profiling and DITAVAL), diagnostics, and HTML rendering for preview and in-app display.

Explicit non-goal: core is **not a DITA-OT replacement**. It does not aim at publishing-grade output (full specialization handling, chunking, PDF, etc.). Every capability claim must be backed by a coverage table (Phase 2) so users can tell what is and is not supported.

### 1.2 Principles

1. **No big-bang refactor.** Every step is a minimal patch on the live `dev` HEAD. After every step both consumers (the extension through the workspace, obsidian-dita through a pinned npm version) keep working with no source change on their side.
2. **Claims follow capabilities.** Do not change the npm description, README tagline or announcements to "host-agnostic" until the Phase 1 exit criteria are verified.
3. **Additive and backward compatible.** Existing exports keep their names and signatures. New surface is added next to them; tiering and removal are a Phase 3 decision.
4. **Synchronous I/O stays.** The render pipeline is synchronous end to end. Browser hosts preload files into memory instead of core going async (see 3.8 for why).
5. **Stay in the monorepo** until the triggers in 1.6 are met.
6. **Every phase ends with a release** (minor bump while on 0.x) and verifiable exit criteria. A phase is not done on "looks right".

### 1.3 Phases at a glance

| Phase | Goal | Status | Exit criteria (summary) |
| --- | --- | --- | --- |
| 1. Decouple | Core runs with no Node built-ins and no process-wide state, behind injected I/O | Designed, not started | Portable entry bundles for the browser; Node and in-memory platforms render byte-identical HTML; two engines in one process do not interact; both consumers unchanged. Details in 3.7. |
| 2. Capabilities | Fill in the DITA semantics hosts need, as host-neutral functions that return structured data | Roadmap only | Each capability is an engine function with fixture tests; a coverage table says supported / partial / unsupported; host features (e.g. the VS Code map checks) contain no DITA logic of their own. |
| 3. Ecosystem | An outside developer can use core without reading the extension's source | Roadmap only | Consumer-facing README and API reference; stable API tier separated from internals; three examples run in CI; semver policy written down. |

Order matters: Phase 2 features are written against the engine interfaces from Phase 1, and Phase 3 documents an API that Phase 2 has finished changing.

### 1.4 Phase 2 brief (capabilities)

Goal: close the gaps between "renders what the extension needs" and "a reliable DITA library", exposing results as data (diagnostics, graphs, lists), never as UI.

Inputs to read before designing: section 3 of this file (the engine and platform interfaces); `src/diagnostics.ts`, `src/profiling.ts`, `src/editor/keySpace.ts`, `src/editor/refResolvers.ts`, `src/render/mapTypeMap.ts`; `CHANGELOG.md` of the extension for the recent rendering history; the maintainer's open feature requests in the extension (below).

Candidate work items (not a commitment; the design must triage them):

- **Project analysis in core.** Find unreferenced resources (start from chosen maps, default the active one; target folders; include/exclude filters; images are the main case), and validate-and-check-completeness (duplicate topic IDs, references outside the map folder, broken keyref/conref/href, map cycles). These are pending features of the VS Code extension; the logic belongs here, the host only chooses how to show the findings (the maintainer wants native places such as the Problems panel, not a new sidebar view, and not a copy of Oxygen's dialogs). Output should be compatible with `DitaDiagnostic`.
- **Reference-resolution gaps.** Known: the renderer has no keyref-to-href fallback for `topic/xref` and `topic/image`, so a key that only defines an href renders nothing. Verify against the current code, then audit conref ranges, mapref, conkeyref and key scopes against the DITA 1.3 spec and record the result in the coverage table.
- **Profiling and DITAVAL.** `renderBookXml` and `renderSiteXml` accept a `filter`; check whether single-topic rendering should as well, and whether DITAVAL `flag` and `rev` handling is complete.
- **Reference graph.** Expose the resolved key space and the file-to-file reference graph as data, so other applications (search index, link checker, publishing pipelines) can build on it.
- **Validation scope decision.** Decide explicitly whether structural validation (DTD/RNG-level) is in scope. The likely answer is no: keep the lightweight checks that exist and say so in the coverage table.
- **Library hygiene.** Replace the `console.warn` in `collectDitamapFilesRecursive` with an injected warning sink; settle the determinism question about imagemap ids (3.8).

Exit criteria: each capability has an engine-level function, tests on fixtures, and a row in the coverage table; the extension's corresponding feature calls core and holds no duplicate logic; release as a minor version.

### 1.5 Phase 3 brief (ecosystem)

Goal: make core usable by people who never open the extension's source.

Inputs to read before designing: the Phase 1 and Phase 2 designs and their final APIs; `src/index.ts` and `test/publicApi.test.ts`; `packages/core/README.md`; `scripts/check-core-pack.mjs`; the obsidian-dita repository as the reference consumer.

Candidate work items:

- **API tiering.** `index.ts` exports about 125 runtime symbols, shaped by what the extension imports (it includes internals such as `BASE_TYPE_RENDERERS`, `HOST_TOKENS`, `setTopicRenderCacheBudgetForTesting`). Split into a small stable tier (render, parse, profiling, diagnostics, engine) and an `/internal` subpath. Do it while the version is still 0.x. Write the semver policy and the criteria for 1.0.
- **Documentation.** Rewrite `packages/core/README.md` for consumers (quickstart first). Move the provenance material (which files were copied from which commit) into `ARCHITECTURE.md` for maintainers. Generate an API reference. Publish the coverage table from Phase 2.
- **Examples** in `examples/`, as workspace packages built and run in CI so they cannot rot:
  1. Node.js CLI that renders and checks a local DITA project (Node platform).
  2. Web application that renders DITA in the browser (portable entry plus an in-memory file system preloaded from the user's files). Phase 1 only proves the bundle builds; this example proves the whole flow.
  3. Custom plugin: obsidian-dita is the real reference integration, linked from the docs; add a minimal non-editor integration (for example a small HTTP server) so the docs show a host that is neither VS Code nor Obsidian.
- **Decisions to take at the start of Phase 3, not before:** the package name and scope (`@dita-viewer/core` carries a product name that may not fit a general engine; renaming costs more than splitting the repository, so decide before promoting it), whether the triggers for a separate repository are met (1.6), and readiness for 1.0.

Exit criteria: a developer can follow the README to render a map in Node and in a browser; the examples run in CI; the stable tier and the semver policy are documented.

### 1.6 Decisions

Made:

- Direction and three-phase structure as in 1.1–1.3 (maintainer, 2026-11-26).
- Core stays in this repository for now. Revisit when **two or more** of these hold: a third-party consumer or contributor exists; the API is tiered and near 1.0; core changes no longer need paired extension changes (on 2026-11-26, 20 of the last 200 commits touched both and 20 touched core alone; core has lived in this repository since 2026-10-25); the docs and examples need their own site. If it is split later: `git filter-repo --subdirectory-filter packages/core` to keep history, update `repository`/`homepage`/`bugs` in `package.json`, redo the npm trusted-publisher setup (owner, repository and workflow filename must match exactly), switch the extension from the workspace `*` to a real version range, and have the extension take `dita-content.css` from core instead of keeping its own copy (which removes the need for the `hostTokens` drift test).
- I/O stays synchronous (see 3.8).
- The release that ends Phase 1 is `core-0.4.0` (additive public API grows; the repository's convention is that a growing API is a minor bump).

Deferred: package name and scope (Phase 3); async I/O (only if a real host cannot preload files; would need its own design); validation scope (Phase 2).

## 2. Working agreements (all phases)

These come from how the maintainer works; they apply to anyone implementing a step.

- Deliver each step as a `git format-patch` / `git am`-compatible patch, author `aREversez` (the GitHub noreply address already used by the repository's commits), with a thorough explanatory commit message. One step, one patch; when two things are requested, two patches that apply cleanly in order.
- Verify on a **fresh clone of the actual remote `dev` HEAD**, not a local working copy. The live HEAD moves between rounds: fetch before every step.
- Verification before handoff: `npm run verify` (it covers typecheck, lint, build, the extension tests and `test:core`), `npm run check:core-pack`, and a `git am --check` dry run of the patch.
- Touch only the files a step needs. Do not modify unrelated code. If a step cannot be done without touching something else, say so and split it.
- Do not trade one problem for another: a step that fixes X and breaks Y is rejected and redone.
- A change to core reaches the extension at its next build through the workspace; it reaches obsidian-dita only after a release. Releases follow `.github/workflows/release-core.yml` (tag `core-<version>` after the version in `packages/core/package.json` is raised; the tag must match it).

## 3. Phase 1 design — Decouple

### 3.1 Goals and non-goals

Goals:

- **G1.** Everything in `packages/core/src` except `src/node/` is free of Node built-in imports (`fs`, `path`, `os`, ...) and of `Buffer` and `process`.
- **G2.** All file access goes through one injected `FileSystem`, and all path arithmetic through one injected `PathOps`.
- **G3.** All process-wide mutable state (source overlays, render caches, read roots, counters) belongs to an engine instance. Two engines in one process do not see each other.
- **G4.** Zero breaking change. The existing top-level API keeps working with the same behaviour. The extension builds with no change under `src/`; obsidian-dita can move to the next core release with no source change.
- **G5.** Ship the pieces needed to use core off Node: a portable entry point, a Node platform, an in-memory file system and a portable (POSIX) path implementation.

Non-goals: async I/O; Windows drive-letter handling in the portable path; API tiering or removal of exports (Phase 3); new features (Phase 2); moving the repository.

### 3.2 Current coupling (measured, see Appendix A)

- **14 direct `fs` calls in 6 files.** `existsSync` (topicRender, renderContext, refResolvers ×2, pathContainment), `readFileSync` (sourceText), `statSync` (refResolvers, sourceText, siteRender; only `mtimeMs` and `size` are used), `readdirSync` with entry types (topicRender), `realpathSync` (pathContainment), and `openSync`/`readSync`/`closeSync` to read the first 64 KB of an image (refResolvers). A seventh file, `diagnostics.ts`, imports `existsSync` only as the default of its already injectable `fileExists` option.
- **`path` is used throughout**: about 95 call sites (`join` 43, `resolve` 26, `dirname` 9, `isAbsolute` 8, `relative` 4, `normalize` 4, `extname` 1, plus `sep` once) in 13 files.
- **`Buffer`**: the image-header readers use `Buffer` methods (`readUInt32BE`, `toString('ascii')`, ...); `topicRender` uses `Buffer.byteLength`. **`process.platform`** is used twice to decide whether to lower-case paths (win32 only).
- **Process-wide state**: source overlays, the overlay revision counter and the read-tracking recorder (`sourceText.ts`); the topic render cache and its byte budget (`topicRender.ts`); the image-dimension cache (`refResolvers.ts`); the read roots (`pathContainment.ts`); and `imagemapSequence`, a counter that makes imagemap ids depend on how many imagemaps were rendered earlier in the process (`baseTypeMap.ts`). Two `WeakMap`s in `keySpace.ts` are keyed by `Map` identity and are harmless; leave them.
- **Existing injection seams**: `fileExists` (`diagnostics.ts`), `FileReader` (`refResolvers.ts`, used by `expandDitamapRefs` and friends, defaulting to `readSourceText`) and `ReadDir` (`referenceableFiles.ts`, **allowed to be async**; the extension passes `vscode.workspace.fs`). Both are kept as they are. `ReadDir` is the completion walk's own concern and stays outside the new `FileSystem`.
- The language and completion modules, the parser and the renderer proper are already free of host dependencies, except for the sites listed above.

### 3.3 Interfaces

New file `src/platform.ts`; all types are exported from both entry points.

```ts
import type { WalkEntry } from './language/referenceableFiles';

export interface FileStat {
  readonly size: number;
  readonly mtimeMs: number;
}

/** Synchronous, read-only. Core never writes. */
export interface FileSystem {
  /** UTF-8 text. Throws when missing or unreadable (the readFileSync contract callers already handle). */
  readText(path: string): string;
  /** At most `maxBytes` from the start of the file; used only to read image headers. Throws when unreadable. */
  readHead(path: string, maxBytes: number): Uint8Array;
  exists(path: string): boolean;
  /** undefined when the path cannot be statted. */
  stat(path: string): FileStat | undefined;
  /** Throws when the directory is unreadable. */
  readDir(path: string): WalkEntry[];
  /** Symlink resolution for isPathInside. Optional: when absent a path is its own real path. */
  realPath?(path: string): string;
}

export interface PathOps {
  readonly sep: string;
  /** Replaces `process.platform === 'win32'` lower-casing: false means keys are lower-cased. */
  readonly caseSensitive: boolean;
  resolve(...segments: string[]): string;
  join(...segments: string[]): string;
  dirname(path: string): string;
  relative(from: string, to: string): string;
  isAbsolute(path: string): boolean;
  normalize(path: string): string;
  extname(path: string): string;
}

export interface Platform {
  readonly fs: FileSystem;
  readonly path: PathOps;
}
```

Provided implementations:

| Name | Where | Notes |
| --- | --- | --- |
| `nodePlatform` | `@dita-viewer/core/node` | Wraps `fs` and `path` (platform flavour of `path`). `caseSensitive` is `process.platform !== 'win32'`, which preserves today's behaviour exactly. |
| `posixPath` | portable entry | Pure TypeScript, `/` only. `resolve` with no absolute segment resolves against `/`. Must agree with `path.posix` on a table of cases (see 3.7). |
| `createMemoryFileSystem(files)` | portable entry | `files: Record<string, string \| Uint8Array>` with absolute POSIX paths. `stat.mtimeMs` is a per-file version counter, so cache invalidation works the same way as on disk. `realPath` is omitted. |

The engine:

```ts
export function createEngine(platform: Platform): Engine;
```

`Engine` is a flat object: `engine.platform` plus one method per runtime-dependent export (`renderTopicXml`, `renderMapXml`, `renderBookXml`, `renderSiteXml`, `buildKeyMapForDocument`, `buildKeySpace`, `collectDiagnostics`, `setReadRoots`, `setSourceOverlay`, `sourceStamp`, `trackSourceReads`, ...), with the same signature as the existing top-level function. Which exports are runtime-dependent is an explicit list (`RUNTIME_DEPENDENT`) and is checked by the tripwire test in 3.7.

### 3.4 Mechanism: an ambient runtime, scoped per call

Threading a `platform` argument through every function signature would touch nearly every file and every call site, which contradicts principle 1. Instead:

- `src/runtime.ts` (internal, not exported from either entry) defines `Runtime = { platform, state }`, where `state` holds everything listed under "process-wide state" in 3.2.
- A module-level `current` points at the active runtime. `withRuntime(runtime, fn)` sets it, runs `fn`, and restores the previous value in a `finally`, so calls nest correctly (a host callback such as `asWebviewUri` may re-enter another engine).
- `rt()` returns `current`, or the default runtime if one was installed, and throws a clear error otherwise ("no platform: call this through an engine").
- Two thin internal modules replace the Node imports: `src/runtime/path.ts` exports `join`, `resolve`, `dirname`, ... that delegate to `rt().platform.path`, and `src/runtime/fs.ts` exports `readText`, `exists`, ... that delegate to `rt().platform.fs`. Converting a file is then mostly changing one import line (`from 'path'` to `from '../runtime/path'`).
- `engine.x(...args)` is `withRuntime(runtime, () => x(...args))`, generated from the `RUNTIME_DEPENDENT` list rather than hand-written.
- Legacy behaviour: the existing entry point installs `nodePlatform` as the default runtime when it is loaded, so every existing top-level function behaves as before, using one shared default engine. The portable entry installs nothing and does not export the runtime-dependent functions at top level; they exist only on an engine.

**Invariant:** this is safe only because the whole pipeline is synchronous, so calls cannot interleave. Any future async API must thread the runtime explicitly. Record this as a comment at `withRuntime`.

Rejected alternatives: threading a `platform` parameter through every signature (right in the end if core ever goes async, but a large diff now); a class `Engine` whose methods reimplement the functions (duplicates the code); making `fs` an optional input on each `render*` call (does not reach the readers buried in key-space and reference resolution).

### 3.5 Entry points and package layout

- `@dita-viewer/core` (existing): unchanged behaviour. Installs the Node default runtime. Its README entry says it targets Node-compatible hosts.
- `@dita-viewer/core/portable` (new): no Node imports at all. Exports the pure functions (`parseDita`, `parseDitamap`, `renderDocument`, profiling, completion, the language utilities, ...), the types, `createEngine`, `posixPath` and `createMemoryFileSystem`.
- `@dita-viewer/core/node` (new): `nodePlatform` and `createNodeEngine()` (shorthand for `createEngine(nodePlatform)`).
- Each new subpath gets `types`, `module` (`dist-esm`) and `default` (`dist`) conditions in `exports`, like the root. `src/node/` is the only directory allowed to import Node built-ins.
- The default-runtime installation must not defeat tree shaking: `check:core-pack` already asserts that a bundler drops unused modules (the site and book renderers, diagnostics, completion), and that assertion must stay green.

### 3.6 Patch sequence

Five patches, in order. After each one `npm run verify` and `npm run check:core-pack` pass, `publicApi.test.ts` is unchanged, and nothing under the extension's `src/` changes.

1. **Add the interfaces, platforms and runtime.** `src/platform.ts`, `src/runtime.ts`, `src/node/` (`nodePlatform`), `posixPath`, `createMemoryFileSystem`. Nothing calls them yet, so there is no behaviour change. Tests: `posixPath` against `path.posix` on a table of cases (including `..`, trailing slashes, empty segments, absolute segments in the middle of `resolve`); the memory file system's contract, including `stat` versions and the throwing behaviour of `readText`, `readHead` and `readDir`.
2. **Route path arithmetic through `runtime/path`.** Mechanical: the `from 'path'` imports in the 13 files change; no other edits. Tests unchanged. Add the default-runtime installation to the existing entry here so everything keeps resolving to the Node `path`.
3. **Route file access through `runtime/fs`.** The 14 call sites, plus the default of `fileExists` in `diagnostics.ts`; rewrite the image-header readers over `Uint8Array` and `DataView` instead of `Buffer`; replace `Buffer.byteLength` with a small UTF-8 length helper; replace both `process.platform` checks with `path.caseSensitive`; `isPathInside` uses `fs.realPath` when present. Reconcile `readDir` entries with `WalkEntry`. The image-dimension tests must pass unmodified.
4. **Move process-wide state into the runtime.** Overlays, revision, recorder, topic cache and budget, image-dimension cache, read roots, imagemap counter. The existing top-level functions (`setSourceOverlay`, `setReadRoots`, `clearTopicRenderCache`, ...) now act on the default runtime's state. Add the isolation test (3.7).
5. **Entry points, enforcement and release prep.** `src/portable.ts`, `createEngine`, `RUNTIME_DEPENDENT`, the `exports` map, `check:core-portable` (below), the conformance and tripwire tests, a lint rule restricting Node built-ins, `Buffer` and `process` outside `src/node/`, README section on the new subpaths, and the status table in this file. Then the maintainer tags `core-0.4.0`.

### 3.7 Acceptance tests and exit criteria

Phase 1 is done when all of these hold:

1. **No Node leakage.** The lint rule passes, and `check:core-portable` passes: it bundles the portable entry with esbuild using `platform: 'browser'` and no externals, and fails on any unresolved built-in. (Extend the existing bundler check in `scripts/check-core-pack.mjs` rather than adding a parallel mechanism.)
2. **Conformance.** For every fixture under `test-dita-file/` that the existing tests render (topics, maps, book and site renders, with and without profiling), rendering through `createEngine(nodePlatform)` and through `createEngine({ fs: createMemoryFileSystem(sameFiles), path: posixPath })` gives byte-identical HTML and equal diagnostics. A test helper loads a directory into memory. This runs on POSIX; Windows path flavours are covered by the existing suite.
3. **Isolation.** Two engines over different memory file systems with the same paths and different contents, rendered interleaved, each return their own content; an overlay, a read root or a cache entry set on one is invisible to the other; the default runtime is untouched by either.
4. **Tripwire.** With a platform whose every method throws, every export classified as pure still works on fixtures, and no export outside `RUNTIME_DEPENDENT` reaches `rt()`.
5. **Compatibility.** `publicApi.test.ts` is unchanged and green. `npm run verify` in the extension is green with no change under `src/`. `npm run check:core-pack` is green and covers the new subpaths (Node `require`, ES module `import`, bundler, TypeScript resolution).
6. **Released** as `core-0.4.0`, and obsidian-dita can adopt it with no source change.

### 3.8 Risks and open questions

- **Sync versus async.** A browser host with an asynchronous file API (File System Access API, fetch) must preload the project into a `Map` and hand it to `createMemoryFileSystem`. Large projects pay a one-time load cost and memory. This is acceptable for the first hosts; if a host cannot preload, an async variant needs its own design (the ambient runtime would then have to be replaced by explicit threading).
- **Imagemap ids.** `imagemapSequence` makes ids depend on earlier renders in the process. Per-engine state fixes isolation but not determinism within one engine. A book or site page that joins many topics needs ids unique across the whole page, so a per-topic counter would collide. Recommended default: one counter per engine, reset at the start of each top-level `render*` call (one call is one page); verify that book and site renders go through one top-level call before relying on this, and check whether the extension's panels render topics separately into one page.
- **Parity between file systems.** `sourceStamp` and the image cache depend on `mtimeMs` and `size`. The memory file system's counter-based `mtimeMs` must change whenever content changes (the tests in step 1 and the isolation test cover it).
- **`console.warn` in `collectDitamapFilesRecursive`.** A library writing to the console; deferred to Phase 2 (injected warning sink). Do not widen Phase 1 to fix it.
- **`ReadDir` stays async-capable.** The two I/O worlds (the synchronous render pipeline, and the asynchronous-capable completion walk) are intentionally not unified in Phase 1. Revisit only if a Phase 2 feature walks directories (for example unreferenced-resource search); decide there which one it uses.
- **Windows.** `nodePlatform` keeps the platform's own `path`. The portable path does not handle drive letters, and a Windows host that wants a virtual file system must supply its own `PathOps`.

## Appendix A — Re-measuring the facts

Run from `packages/core`:

```bash
# Node built-ins in core (should be empty outside src/node/ once Phase 1 is done)
grep -rnE "from ['\"](fs|node:fs|path|node:path|os|url|child_process|vscode|obsidian)(/promises)?['\"]" src
grep -rnE "\b(Buffer|process)\." src

# direct fs calls
grep -rnE "\b(existsSync|readFileSync|readdirSync|statSync|openSync|readSync|closeSync|realpathSync)\(" src

# path function usage
grep -rhoE "\b(resolve|relative|isAbsolute|dirname|join|normalize|extname|sep|basename)\(" src | sort | uniq -c | sort -rn

# module-level mutable state
grep -rnE "^let |^const [A-Za-z_]+ *(:[^=]+)?= *new (Map|Set|WeakMap)" src

# public surface
npm run check:core-pack                # prints the runtime export count (125 on 2026-11-26)

# consumers (from the repository root)
grep -rhoE "import (type )?\{[^}]*\} from '@dita-viewer/core'" src | tr ',' '\n' | sort -u | wc -l

# how often core and extension change together (last 200 commits)
git log -200 --name-only --format=%h
```

Facts on 2026-11-26 at `e739149`: 14 `fs` calls in 6 files (7 files import `fs`); 13 files import `path`; about 95 path call sites; 125 runtime exports; the extension imports about 48 distinct names from core; obsidian-dita (pinned to 0.2.3) imports 29 names (18 values, 11 types): `buildKeyMapForDocument`, `collectDiagnostics`, `collectIds`, `collectRefEntries`, `complete`, `decodeHrefPart`, `ditavalAction`, `getKeyDefs`, `isExcluded`, `offsetToLineCol`, `parseDitaval`, `profileGroups`, `profileValuesOfKeys`, `renderBookXml`, `renderMapXml`, `renderSiteXml`, `renderTopicXml`, `splitRefFragment`, plus the types `CompletionEnv`, `DitaDiagnostic`, `DitaNode`, `Ditaval`, `DocSymbolSpec`, `ProfileFilter`, `ProfileGroup`, `RoleLabelFormatter`, `SiteNavEntry`, `Suggestion`, `SuggestionKind`. Those 29 names are the minimum compatibility surface for step-by-step verification.
