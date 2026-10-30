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
Check for Completeness…* with every option ticked except *Include remote resources*, and set
**Profiling/Conditional Text** to the values in `pref/aurora-prefs.json`. In the Results view,
*Save Results as XML…* outside the repository.

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

Nineteen findings over sixteen categories without the filter; the extension side of both runs
was measured, the Oxygen side is what the run is for.

| Category | Where | The shape |
| --- | --- | --- |
| `duplicate-key` (2) | `keys/product-keys.ditamap:19`, `keys/variant-keys.ditamap:7` | `support-phone` defined twice: both definitions filed |
| `undefined-key` (2) | `topics/sensor-check.dita:15`, `topics/alerts.dita:9` | `runbook`, defined inside `keyscope="ops"`, used by topics the reltable also names |
| `undefined-key` (1) | `topics/maintenance.dita:8` | `runbook` used from outside the scope: correct in every reading |
| `unreferenced-key` | `keys/product-keys.ditamap:30` | `legacy-diagram`, left from the previous product |
| `unreferenced-reusable` | `shared/common-text.dita:15` | `unused-note` never conref'd |
| `resource-only-target` | `topics/overview.dita:16` | an `xref` to `spec-key`'s resource-only topic |
| `multiple-reference` | `aurora-bookmap.ditamap:40` | `shared/legal.dita` in the chapter and in the backmatter |
| `duplicate-id` (2) | `topics/mount.dita:3`, `topics/power.dita:3` | copy-paste: both tasks are `id="mount"` |
| `invalid-id-reference` | `topics/mount.dita:25` | `power.dita#mount/step-4`, a task with three steps |
| `missing-reference` | `chapters/reference.ditamap:9` | `sensor-history.dita` was deleted, the chapter line stayed |
| `missing-resource` | `topics/power.dita:22` | `images/wiring.svg`, the file is `wiring-diagram.svg` |
| `missing-navtitle` | `chapters/reference.ditamap:5` | a `topichead` without `@navtitle` |
| `table-layout` | `topics/specifications.dita:10` | `@cols="3"` with two `colspec`s |
| `profiling-conflict` | `topics/link.dita:25` | `audience="expert"` note inside a `novice` section |
| `empty-profiling-value` | `topics/maintenance.dita:9` | `audience=""` |
| `profiling-preference` | `topics/sensor-check.dita:19` | `props="beta"`, an attribute the preferences do not list |
| `filtered-reference` | `topics/troubleshooting.dita:18` | only with the filter: an `xref` into the filtered `expert` note |

With `field.ditaval` the run drops `profiling-conflict` (the note it names is filtered out) and
adds `filtered-reference`: nineteen findings again.

## The two labels to watch

The three `runbook` uses are not the same question. `maintenance.dita` sits outside the
keyscope, so a bare use has to be undefined. `sensor-check.dita` and `alerts.dita` sit **inside**
it, and only reach the root scope because the bookmap's reltable names them there; the extension
resolves their use in the reltable's scope and calls the key undefined. If Oxygen stays silent on
those two, the topic is being resolved in a scope it does not belong to — a real defect, and the
cheapest probe in this set.
