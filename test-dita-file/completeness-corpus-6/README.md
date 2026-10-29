# Completeness corpus 6: key scope resolution

The sixth differential corpus, kept apart from the other five so each keeps its own line
numbers, baseline and parity lock. It has its own root map, `corpus.ditamap`, its own
`baseline.extension.json`, and since its first run a sanitized `oxygen-report.xml` and an
`oxygen-parity.expected.json`. The rules it feeds are R066 (key scope) and the scope half of
R008 (duplicates) in `../completeness-corpus/RULES.md`.

## Why a corpus of its own

Key scope is a property of the whole build, not of one file: a key is visible where its
scope is, so answering R066 needs one map that defines a key inside `keyscope="s1"`, publishes
a topic inside it, publishes another outside, and publishes a third in two scopes at once.
That layout cannot be dropped into corpus 1 without changing what its own probes mean, so it
gets a folder of its own. The duplicate probes below need the same thing for R008: the
question is which publications of one topic Oxygen counts as duplicates, so each answer needs
a map of its own with the two references laid out one way.

## Oxygen setup for this corpus

Nothing beyond the other corpora: the `audience` preferences of corpus 1, no filter. The runs
recorded below were **Oxygen XML Editor 27.1**, `corpus.ditamap` as the only open root map,
every option on, remote off.

## What the corpus probes

| Probe | File | What it asks |
| --- | --- | --- |
| bare key defined only inside `keyscope="s1"`, used by a topic published outside it | `topics/o-scope-outside-pos.dita` | `undefined-key` |
| the same bare key, topic published inside `s1` | `topics/o-scope-inside-neg.dita` | *(no key finding)* |
| qualified name `s1.k-scoped` from outside | `topics/o-scope-qualified-neg.dita` | *(no key finding)* |
| topic published in `s1` (key defined) and in `s2` (not) | `topics/o-scope-shared-edge.dita` | `undefined-key` for the `s2` publication only |
| missing topic | `topics/control-missing.dita` (absent) | `missing-reference` (control, so silence means Oxygen did not look) |

Every probe topic holds one `<xref>`: `keyref="k-scoped"`, except the qualified
`s1.k-scoped`. The key resolves to `topics/t-target.dita`, which the map reaches only through a
`<keydef>`, and that is what produced the second finding family of the first run.

## The runs: 14 incidents, full parity

`node scripts/oxygen-diff.cjs --corpus completeness-corpus-6 oxygen-report.xml` reports
**10 matched, 0 extension-only, 0 Oxygen-only** — the first corpus with neither row. No
incident was an accepted difference, so parity compares all ten signatures; the 14 incidents
collapse into them because each duplicate probe files one incident per reference.

The first run carried **6 incidents**, before the duplicate probes existed, and settled R066
and the keydef half of R049:

| Oxygen | Where | Extension |
| --- | --- | --- |
| `dmv.key.undef` ×2 | `topics/o-scope-outside-pos.dita:7`; `topics/o-scope-shared-edge.dita:7`, whose message names the scope that lacks the key (`Key Scopes:[[s2]]`) | `undefined-key` on both — the shared topic is checked per publication scope (R066) |
| `dmv.ref.to.resource.only` ×3 | `topics/o-scope-inside-neg.dita:7`, `topics/o-scope-qualified-neg.dita:7`, `topics/o-scope-shared-edge.dita:7` | `resource-only-target` on all three, after the fix below |
| `dmv.file.not.found` ×1 | `corpus.ditamap:11` | `missing-reference` (control) |

What that run settled beyond R066:

- **A `<keydef>` publishes its topic resource-only** (R049). `topics/t-target.dita` is reached
  only through the keydef, which DITA makes resource-only unless it says otherwise, so every
  xref to it breaks. The extension had read a publication only from a `topicref`, so these were
  a gap in the ordinary sense — Oxygen filed it and we did not. `resourceOnlyTargetIssues` now
  takes a keydef as a publication, which turned all three rows from Oxygen-only into matched;
  an explicit `processing-role="normal"` on a keydef still publishes normally, and
  `src/test/editor/mapCompleteness.test.ts` covers both shapes. The fourth probe, whose bare key
  resolves to nothing, draws no such warning: with no key definition there is no target to call
  resource-only, and its `<xref>` writes no `@href` of its own (R003).
- **The same topic in two key scopes was not a duplicate to Oxygen** (R008).
  `topics/o-scope-shared-edge.dita` is referenced twice, once per scope; the extension filed
  `multiple-reference` on the second reference and Oxygen filed nothing. That pair could not
  tell "different scope, so intentional" from "duplicates are simply not counted inside a
  `topicgroup`", so it stayed locked extension-only until a run of the duplicate probes below
  decided it.

The rerun added the six duplicate probes and answered the question:

| Oxygen | Where | Extension |
| --- | --- | --- |
| `dmv.dup.topic` ×8 | `maps/p-dup-a-root.ditamap:8`, `:9`; `p-dup-b-group.ditamap:9`, `:10`; `p-dup-c-two-groups.ditamap:9`, `:12`; `p-dup-d-same-scope.ditamap:9`, `:10` | `multiple-reference` on the second reference of each map, matched on all four |

Nothing else moved: the six incidents of the first run came back the same, and the shared-edge
pair in `corpus.ditamap` drew nothing again — under the tightened rule the extension no longer
files it either, so that row closed instead of staying extension-only.

## The duplicate probes (R008): the answer is the scope

Six maps under `maps/`, each referencing its own topic twice, added to settle the open row
above. They are referenced from the end of `corpus.ditamap` (so the lines the report cites did
not move) and each sits on a map of its own, because parity compares `(file, category)` and
every probe files its `multiple-reference` on the map that holds the pair.

| Map | Layout | Oxygen |
| --- | --- | --- |
| `maps/p-dup-a-root.ditamap` | two sibling `topicref`s at the root | `dmv.dup.topic` ×2 — control: corpus 1 already files it here |
| `maps/p-dup-b-group.ditamap` | both inside one `topicgroup`, no keyscope | `dmv.dup.topic` ×2 — a container does not stop the count |
| `maps/p-dup-c-two-groups.ditamap` | one in each of two `topicgroup`s, no keyscope | `dmv.dup.topic` ×2 — a different parent does not stop it either |
| `maps/p-dup-d-same-scope.ditamap` | both inside one `keyscope="s1"` group | `dmv.dup.topic` ×2 — a `keyscope` by itself does not end the count |
| `maps/p-dup-e-two-scopes.ditamap` | one in `s1`, one in `s2` (the shared-edge shape, isolated) | *(nothing)* |
| `maps/p-dup-f-topicref-scope.ditamap` | `keyscope` on the two `topicref`s, no container | *(nothing)* |

B and C rule out the container, D rules out "a `keyscope` ends the count", and F shows the
container is not what silences E: the only difference between the reported D and the silent E
and F is that the two references sit in **different** scopes. **The scope decides**, so R008
counts a reference by `(target, scope chain)`, in step with R066: `mapChecks.ts` keys its
duplicate groups on the target plus `Reference.scopeChains`, which `mapCrawl.ts` records for
every map element (the element's own `keyscope` included) and hands to a `<topicref keyref>`
as well. The shared-edge pair of `corpus.ditamap` is that same shape, which is why it stopped
being an extension-only row without a change of its own.

`src/test/editor/mapCompleteness.test.ts` covers the four shapes: two `topicgroup`s, one
`keyscope` group, two scopes, and `keyscope` on the `topicref`s themselves.

## The scope shapes Oxygen has not been asked (R008) — not yet run

The six probes above show Oxygen counting by scope for siblings (`s1` against `s2`), but the
rule as written answers three more shapes by extrapolation. Four more maps ask, each with its
own topic and referenced after the six, at the end of `corpus.ditamap`. The extension is silent
on the first three and reports the last, so until a rerun only the last is a lock row, and
an *unknown* one.

| Map | Layout | Extension today | What Oxygen's answer would mean |
| --- | --- | --- | --- |
| `maps/p-dup-g-root-vs-scope.ditamap` | once at the root, once inside `keyscope="s1"` | silent | reported: the root scope is the same publication as a scope below it; silent: it is a scope like any other |
| `maps/p-dup-h-nested-scope.ditamap` | once in `s1`, once in `s2` nested in `s1` | silent | reported: only the outermost scope name counts; silent: the whole chain does |
| `maps/p-dup-i-multi-vs-single.ditamap` | once in `keyscope="a b"`, once in `keyscope="a"` | silent | reported: the two share a scope name; silent: the set of names is the identity |
| `maps/p-dup-j-multi-reordered.ditamap` | once in `"a b"`, once in `"b a"` | reported | silent: order of the names matters (unlikely; the DITA scope is a set) |

`src/test/editor/mapCompleteness.test.ts` pins today's answer for each, so a change after that
run is deliberate. Rerun with `corpus.ditamap` as the only root map, sanitize, refresh this
folder's parity lock, and change R008 only where Oxygen disagrees.

## Running it

```
node scripts/completeness-baseline.cjs --corpus completeness-corpus-6           # extension findings
node scripts/oxygen-diff.cjs --corpus completeness-corpus-6 <report.xml>        # against Oxygen
node scripts/sanitize-oxygen-report.cjs --corpus completeness-corpus-6 <raw.xml> # writes oxygen-report.xml here
```

`UPDATE_COMPLETENESS_BASELINE=1 npm test` and `UPDATE_OXYGEN_PARITY=1 npm test` refresh the
baseline and the parity lock; `node scripts/completeness-baseline.cjs --corpus
completeness-corpus-6 --update` rewrites the baseline alone. Keep the line numbers of
`corpus.ditamap` stable when editing the comment at its top: the report cites them.

Known limit: a map reached twice with different `keyscope`s is crawled once (first scope).
