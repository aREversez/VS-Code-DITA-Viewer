# A second map for the real-map comparison

A stand-in for the map `REAL-MAP.md` asks for after a first real map comes back clean: a
different **structure**, so the comparison touches categories the first one never used. Its
content is invented (Aurora WS-2, a field service manual), so unlike a customer map it can be
committed and every run starts from the same files.

Not a parity corpus: there is no `baseline.extension.json`, no `oxygen-parity.expected.json`,
and no test reads this folder. `../completeness-corpus/REAL-MAP.md` still applies — only the
text `scripts/real-map-diff.cjs` prints leaves the machine, and a finding here changes a rule
only by becoming a sanitized probe in a corpus.

## What makes it different

| Shape | Where | Why |
| --- | --- | --- |
| bookmap with parts, frontmatter, backmatter | `aurora-bookmap.ditamap` | four chapter maps instead of one flat map |
| chapter maps reached with `href`+`format="ditamap"` | `chapters/*.ditamap` | keys and keyscopes cross a map boundary |
| key map as a resource-only `topicref` | `aurora-bookmap.ditamap`, `chapters/ops.ditamap` | keys arrive without a chapter of their own |
| a second key map that redefines a shared key | `keys/variant-keys.ditamap` | the R010 clash across files, on a book structure |
| `keyscope` group with its own key and topics | `chapters/ops.ditamap` | a key that exists only inside the scope |
| a reltable naming keyscoped topics | `aurora-bookmap.ditamap` | a topic reached twice, once inside the scope |
| conref library with three ids, one of them unused | `shared/common-text.dita` | conref density plus an orphan |
| a key publishing a topic as resource-only | `keys/product-keys.ditamap` | an `xref` to a topic that is never content |
| DITAVAL-driven run | `pref/field.ditaval` | a reference into filtered content |
| profiling preferences given as data | `pref/aurora-prefs.json` | the profiling categories compared instead of excluded |

## Run it

Oxygen: open `aurora-bookmap.ditamap` in the **DITA Maps Manager**, *DITA Maps → Validate and
Check for Completeness…* with every option ticked except *Include remote resources*. In
*Profiling/Conditional Text*, configure what `pref/aurora-prefs.json` holds — `audience`
(`novice`, `expert`), `product` (`aurora`, `aurora-pro`) and `deliveryTarget` (`web`, `pdf`) —
all left on *Multiple values*, since nothing in the set is single-valued. **Leave every other
attribute as your own Oxygen has it**, `props` included: the fixture writes `props="ws1-legacy"`
on `topics/sensor-check.dita`, a value no real list carries, so Oxygen files it as a value
outside the preferences and the extension — which is told nothing about `props` — files the
attribute as unknown. Both land on `profiling-preference` on that file, which is what the run
compares; if your list happens to hold that value, the finding simply disappears from both sides.
Extra values in the dialog (`internal`, `webhelp`) are harmless as long as no document writes
them. The reverse is not: every value a document writes must be in the local list, and
`topics/specifications.dita` writes `deliveryTarget="pdf"`. In the Results view, *Save Results as
XML…* outside the repository.

Then, from the repository root:

```sh
node scripts/real-map-diff.cjs --map test-dita-file/real-map-sample/aurora-bookmap.ditamap \
  --report <report.xml> --prefs test-dita-file/real-map-sample/pref/aurora-prefs.json \
  --private <outside-the-repo>/aurora-labels.private.json
```

Second run, to compare the DITAVAL path as well — in Oxygen choose `pref/field.ditaval` in the
completeness dialog's filter field, and add it here:

```sh
node scripts/real-map-diff.cjs --map test-dita-file/real-map-sample/aurora-bookmap.ditamap \
  --report <report-filtered.xml> --prefs test-dita-file/real-map-sample/pref/aurora-prefs.json \
  --ditaval test-dita-file/real-map-sample/pref/field.ditaval \
  --private <outside-the-repo>/aurora-labels-filtered.private.json
```

## What the extension files today

Twenty findings over sixteen categories without the filter; with the filter the last row replaces
`profiling-conflict`, so the counts stay the same. The extension side of both runs was measured, the
Oxygen side is what the run is for.

| Category | Where | The shape |
| --- | --- | --- |
| `duplicate-key` (2) | `keys/product-keys.ditamap:19`, `keys/variant-keys.ditamap:7` | `support-phone` defined twice: both definitions filed |
| `undefined-key` (2) | `topics/sensor-check.dita:15`, `topics/alerts.dita:9` | `runbook`, defined inside `keyscope="ops"`, used by topics the reltable also names |
| `undefined-key` (1) | `topics/maintenance.dita:8` | `runbook` used from outside the scope: correct in every reading |
| `unreferenced-key` | `keys/product-keys.ditamap:30` | `legacy-diagram`, left from the previous product |
| `unreferenced-reusable` | `shared/common-text.dita:15` | `unused-note` never conref'd |
| `resource-only-target` | `topics/overview.dita:16` | an `xref` to `spec-key`'s resource-only topic |
| `external-reference` | `topics/link.dita:8` | an http `xref` without `scope="external"` |
| `multiple-reference` | `aurora-bookmap.ditamap:38` | `shared/legal.dita` in the chapter and in the backmatter |
| `duplicate-id` (2) | `topics/mount.dita:3`, `topics/power.dita:3` | copy-paste: both tasks are `id="mount"` |
| `invalid-id-reference` | `topics/mount.dita:27` | `power.dita#mount/step-4`, a task with three steps |
| `missing-reference` | `chapters/reference.ditamap:9` | `sensor-history.dita` was deleted, the chapter line stayed |
| `missing-resource` | `topics/power.dita:22` | `images/wiring.svg`, the file is `wiring-diagram.svg` |
| `missing-navtitle` | `chapters/reference.ditamap:5` | a `topichead` without `@navtitle` |
| `table-layout` | `topics/specifications.dita:10` | `@cols="3"` with two `colspec`s |
| `profiling-conflict` | `topics/link.dita:25` | `audience="expert"` note inside a `novice` `div` |
| `empty-profiling-value` | `topics/maintenance.dita:9` | `audience=""` |
| `profiling-preference` | `topics/sensor-check.dita:18` | `props="ws1-legacy"` on a `postreq`: a value no real preference list carries |
| `filtered-reference` | `topics/troubleshooting.dita:21` | only with the filter: an `xref` into the filtered `expert` note |

With `field.ditaval` the run drops `profiling-conflict` (the note it names is filtered out) and
adds `filtered-reference`: twenty findings again.

## What the runs showed

Two runs, the second with `pref/field.ditaval`, both made before R034 was widened: 18 of the
extension's 19 signatures matched (Oxygen filed 21 and 22), one row was extension-only and three
(four with the filter) Oxygen-only. The widened rule makes the extension file that `xref` too, so
the next run should match on 19. What was left, by cause:

| Row | Cause | State |
| --- | --- | --- |
| `external-reference`, on a `.dita` | `topics/link.dita:8` writes an http `xref` without `scope="external"`. R034 used to cover a **map** reference only, so the extension said nothing. | fixed: R034 now checks a topic's `xref`/`link`, with this run's `.dita` report as its evidence; the extension files it at `link.dita:8` |
| `multiple-reference`, on a second `.ditamap` | the reltable names `sensor-check` and `alerts` again, and Oxygen files that as a topic referenced twice (`dmv.dup.topic`) | accepted: the extension counts content references, not relationship rows |
| `profiling-preference`, Oxygen's second row | `topics/specifications.dita:32` writes `deliveryTarget="pdf"`; the fixture declares `pdf` for that attribute, the Oxygen dialog on this desk does not carry it | configuration, not a rule: add `pdf` to `deliveryTarget` |
| `table-layout`, extension only | `@cols="3"` with two `colspec`s; Oxygen's completeness check has no matching rule | accepted: extension-only |
| `profiling-conflict`, second run only | with a DITAVAL the extension runs the filtered set only, so the `expert` note the conflict sits on is gone; Oxygen keeps the row (`dmv.prof.attr.innef.cond`) | accepted: filtered content is checked by Oxygen and not by the extension |

Three rows from the first run were not rule differences and are now gone: `class-format` and
`MSG_CONTENT_INCOMPLETE` were the fixture's own DTD breaks (fixed; `dita --format=html5` accepts
the set), and `missing-resource` beside `missing-reference` was one dangling image that
`summarizeRealMapDiff` now folds the way the corpus parity does.

## What the labels said

`undefined-key` matched 3 for 3: **Oxygen also resolves `runbook` in the reltable's scope** and
calls it undefined, so the shape this section used to watch is a shared reading, not a defect.
