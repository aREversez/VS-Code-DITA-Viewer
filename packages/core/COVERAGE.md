# DITA coverage

What `@dita-viewer/core` does with each DITA feature, and the test that shows it. The table is part of the
Phase 2 exit criteria (`DESIGN.md` 4.8, item 5): a row without a status, or a `partial` / `unsupported` row that
does not say what is missing, is a defect in this file.

Statuses: **supported** (a passing test pins it), **partial** (works for the common case, the gap is stated),
**unsupported** (not done; stated whether it is planned), **unverified** (not yet probed; the step that will probe it),
**out of scope** (decided not to do).

Measured at core 0.4.0. Tests are under `packages/core/test/`; the probes written for this table are in
`coverage/referenceResolution.test.ts`, where a skipped test states the behaviour DITA 1.3 asks for and the step
that switches it on.

## References and reuse

| Feature | Status | What is missing / notes | Evidence |
| --- | --- | --- | --- |
| `xref` with `keyref` to a key that defines an `href` | supported | | `coverage/referenceResolution`: "makes the xref a real link" |
| `xref` + `keyref`: link text from the key's `linktext` | supported | | `coverage/referenceResolution`: "takes the link text from the key's linktext" |
| `xref` + `keyref`, no content, no `linktext` | partial | The link text is the key name; a direct `href` gives the target's title. Planned (Phase 2, step 2). | skipped probe "link text is the target topic's title" |
| `xref` + `keyref` to a key with no `href` and no `linktext` | supported | Rendered as an unresolved keyref, marked. | `coverage/referenceResolution` |
| `image` + `keyref` to a key that defines an `href` | **unsupported** | `src` is empty, so the image is blank; a direct `href` works. Planned (Phase 2, step 2). | skipped probe "gives the image its src" |
| `conref` (element, same or other file) | supported | | `render/renderer.test.ts`, `editor/renderContext.test.ts` |
| `conref` + `conrefend` (range of siblings) | supported | Same parent only (the restriction is documented in `editor/refResolvers.ts`). | `coverage/referenceResolution` |
| `conkeyref` | supported | A resolvable `conkeyref` wins over a co-located `conref`; cycles terminate. | `editor/conkeyrefRender.test.ts` |
| `conref` / `conkeyref` chains | supported | Followed hop by hop, each hop's own file deciding its relative paths; cycles terminate. | `editor/conkeyrefRender.test.ts` ("cycles") |
| Key scopes: qualified and bare names | supported | | `coverage/referenceResolution`, `editor/keyScopeRender.test.ts` |
| Key scopes: a topic published in several scopes | partial | The preview takes the first scope that publishes the topic; book and site take the scope of the position. | `editor/keyScopeRender.test.ts` ("published in two scopes takes the first", "explicit scope wins") |
| `mapref` (nested, with rebasing of hrefs) | supported | | `mapRender.test.ts`, `coverage/referenceResolution` |
| `mapref` cycle | supported | Expansion stops at the repeat. | `coverage/referenceResolution` |
| Keys inside content pulled in by `conref` | unverified | The CHANGELOG and README disagree. Probed in the fix-and-optimize plan (F3). | none yet |

## Filtering and flagging

| Feature | Status | What is missing / notes | Evidence |
| --- | --- | --- | --- |
| DITAVAL `include` / `exclude` on `props`, `platform`, `product`, `audience`, `otherprops`, `deliveryTarget` | supported | | `profiling.test.ts` |
| DITAVAL `flag` and `passthrough` | **unsupported** | Parsed, never rendered; they never remove content. Audited in Phase 2, step 8. | `profiling.ts` header comment |
| DITAVAL `<revprop>` and `<style-conflict>` | **unsupported** | Read and ignored. Step 8. | `profiling.test.ts`: "ignores revprop, style-conflict ..." |
| Single-topic preview with a profile / DITAVAL filter | unverified | Book and site rendering take a filter; whether the topic render does is settled in step 8. | none yet |

## Not in scope

| Feature | Status | Notes |
| --- | --- | --- |
| Structural validation (DTD, RELAX NG, Schematron) | out of scope | The engine reports well-formedness and tag balance, and the completeness checks; it does not validate against a grammar (`DESIGN.md` 4.1, decision 3 in 4.9). |
| Reproducible `imagemap` ids | out of scope | `DESIGN.md` 3.8 stays valid; revisit only if a host needs it. |
