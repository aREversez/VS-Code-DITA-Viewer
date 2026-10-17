# Completeness-check differential corpus

This folder is the fixed input for Phase 0 of the "Validate and Check for
Completeness" parity effort: **run both tools over the same map and diff their
findings**, so a divergence is a test failure rather than a user report.

The parity *specification* (what Oxygen can report) is
**[OXYGEN-PROBLEMS.md](OXYGEN-PROBLEMS.md)** — read from the installed editor's
own DITA-validation resources, no license required.

- `corpus.ditamap` — the root map. Every child is a deliberate probe.
- `topics/` — the referenced topics.
- `../completeness-outside/outside.dita` — a sibling folder, to probe the
  "outside the map folder" check.
- `baseline.extension.json` — the extension's current findings, locked by
  `src/test/editor/completenessBaseline.test.ts`.

## Findings format

Both sides are normalized to a JSON array of:

```json
{ "category": "missing-reference", "severity": "error",
  "file": "corpus.ditamap", "line": 12,
  "message": "Referenced topic not found: topics/missing.dita" }
```

`file` is relative to this folder with `/` separators; `line` is 1-based. The
extension's `category` values are the `IssueCategory` union in
`src/editor/mapChecks.ts`. When normalizing Oxygen's output, map its messages to
those categories where they line up, and keep Oxygen's own wording in `message`
(then the diff is about *which* problems are found, not how they are phrased).

## Running the extension side

```sh
node scripts/completeness-baseline.cjs                 # list findings
node scripts/completeness-baseline.cjs --update        # rewrite the baseline
node scripts/completeness-baseline.cjs --diff oxygen.findings.json   # diff
```

or set `UPDATE_COMPLETENESS_BASELINE=1` and run the mocha test. The script
bundles the harness with esbuild, so it needs no build step.

## Producing the Oxygen side

See **[OXYGEN.md](OXYGEN.md)**. In short: Oxygen Scripting's `validateCheckDITA`
runs the same check headlessly and writes an XML report; the adapter
(`src/test/editor/oxygenReport.ts`) normalizes it and
`node scripts/oxygen-diff.cjs <report.xml>` prints the parity diff (non-zero exit
on any difference). `validateCheckDITA` needs the *all-platforms* Oxygen install
plus a scripting license — the Windows editor has neither. `oxygen-report.sample.xml`
is a hand-built stand-in for testing the parser until a real report exists.

## What the corpus probes

| Probe | File | Expected extension finding |
| --- | --- | --- |
| missing topic | `topics/missing.dita` (absent) | `missing-reference` |
| topic referenced twice | `topics/multi.dita` ×2 | `multiple-reference` |
| twice with unique `@copy-to` | `topics/multi2.dita` | *(none — control)* |
| duplicate topic id | `topics/twoidsa/b.dita` | `duplicate-id` |
| duplicate key | `keydef keys="dupkey"` ×2 | `duplicate-key` |
| unused key | `keydef keys="unusedkey"` | `unreferenced-key` |
| topic reached twice through a key | `keydef keys="kusekey"` + 2× `topicref keyref` | `multiple-reference` |
| keyref to an undefined key | `topicref keyref="nosuchkey"` | `undefined-key` |
| keyref to a key that is already referenced by `@href` | `<topicref keyref="dupkey"/>` (also `topics/ok.dita`) | `multiple-reference` |
| unreferenced reusable | `topics/reuse.dita#orphan` | `unreferenced-reusable` |
| CALS/simple table problems | `topics/tables.dita` | `table-layout` ×2 |
| profiling conflict | `topics/profiling.dita` | `profiling-conflict` |
| profiling preference | `topics/profiling.dita` | `profiling-preference` ×3 |
| missing local resource | `topics/resources.dita` → `img/no-such-image.png`, `media/no-such-video.mp4` | `missing-resource` ×2 |
| existing local resource | `topics/resources.dita` → `img/used.png` | *(none — control)* |
| unreachable remote resource | `topics/remote.dita` | *(none here; `remote-resource` only with "include remote" on, which the harness keeps off)* |
| outside the map folder | `topics/outside.dita` | `outside-folder` |
| link to a topic no map references | `topics/linker.dita` | `unreferenced-link` |
| in-map link | `topics/linker2.dita` | *(none — control)* |
| malformed XML | `topics/malformed.dita` | `validation` |

## Known divergence probes (confirm against Oxygen)

These files exist so the first Oxygen run *proves* each suspected gap. They are
expected to show up as `onlyInBaseline`/`onlyInRun` differences:

1. **DTD/schema validation** — `topics/invalid.dita` is well-formed but invalid
   (`bogus` attribute, `<notanelement>`). The extension has no DTD/RNG check and
   stays silent; Oxygen's validator should flag it.
2. **Key-based references** — *(fixed)* the crawler now resolves `@keyref` to
   the key definition after the maps are crawled, so a topic reached twice
   through a key is a `multiple-reference`, an unresolvable keyref is an
   `undefined-key`, and a keyref to a missing file is a `missing-reference`.
   Recursion into a submap reached *only* through a keyref is still not done.
3. **Partial profiling overlap** — `topics/profiling.dita`'s `audience="admin
   novice"` under a cascaded `novice` overlaps, so the extension reports no
   conflict; Oxygen's "values not found in parent" rule may treat it
   differently.
4. **Remote resources** — `topics/ok.dita` and `topics/remote.dita` reference
   `https://` images; the harness disables remote probing, so neither existence
   nor a `remote-resource` note appears. Enable `includeRemote` to exercise it
   (`remote.dita` is the ledger probe for rule R005).
5. **Non-DITA resources** — `topics/resources.dita` points at two files that do
   not exist; Oxygen's catalog has no id for this (the closest is the schema-level
   `dmv.file.not.found`), so the first Oxygen run should tell us whether it is
   extension-only.
6. **Table rules** — the extension emits `colspecCount`/simple-row findings; some
   Oxygen table complaints are schema-level and will only appear on the Oxygen
   side.

When a difference is a *legitimate* extension gap, fix the check; when it is an
intentional scope difference, record it here and in the accepted-divergence list
so the next diff is not re-litigated.
