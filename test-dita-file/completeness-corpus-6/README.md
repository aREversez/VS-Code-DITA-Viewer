# Completeness corpus 6: key scope resolution

The sixth differential corpus, kept apart from the other five so each keeps its own line
numbers, baseline and parity lock. It has its own root map, `corpus.ditamap`, its own
`baseline.extension.json`, and since its first run a sanitized `oxygen-report.xml` and an
`oxygen-parity.expected.json`. The rule it feeds is R066 in `../completeness-corpus/RULES.md`.

## Why a corpus of its own

Key scope is a property of the whole build, not of one file: a key is visible where its
scope is, so answering R066 needs one map that defines a key inside `keyscope="s1"`, publishes
a topic inside it, publishes another outside, and publishes a third in two scopes at once.
That layout cannot be dropped into corpus 1 without changing what its own probes mean, so it
gets a folder of its own.

## Oxygen setup for this corpus

Nothing beyond the other corpora: the `audience` preferences of corpus 1, no filter. The run
recorded below was **Oxygen XML Editor 27.1**, `corpus.ditamap` as the only open root map,
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
`<keydef>`, and that is what produced the second finding family of the run.

## The run: 6 incidents, 6 signatures matched

`node scripts/oxygen-diff.cjs --corpus completeness-corpus-6 oxygen-report.xml` reports
**6 matched, 1 extension-only, 0 Oxygen-only**: the first corpus with no Oxygen-only row. No
incident was an accepted difference, so parity compares all six.

| Oxygen | Where | Extension |
| --- | --- | --- |
| `dmv.key.undef` ×2 | `topics/o-scope-outside-pos.dita:7`; `topics/o-scope-shared-edge.dita:7`, whose message names the scope that lacks the key (`Key Scopes:[[s2]]`) | `undefined-key` on both — the shared topic is checked per publication scope (R066) |
| `dmv.ref.to.resource.only` ×3 | `topics/o-scope-inside-neg.dita:7`, `topics/o-scope-qualified-neg.dita:7`, `topics/o-scope-shared-edge.dita:7` | `resource-only-target` on all three, after the fix below |
| `dmv.file.not.found` ×1 | `corpus.ditamap:11` | `missing-reference` (control) |

What the run settled beyond R066:

- **A `<keydef>` publishes its topic resource-only** (R049). `topics/t-target.dita` is reached
  only through the keydef, which DITA makes resource-only unless it says otherwise, so every
  xref to it breaks. The extension had read a publication only from a `topicref`, so these were
  a gap in the ordinary sense — Oxygen filed it and we did not. `resourceOnlyTargetIssues` now
  takes a keydef as a publication, which turned all three rows from Oxygen-only into matched;
  an explicit `processing-role="normal"` on a keydef still publishes normally, and
  `src/test/editor/mapCompleteness.test.ts` covers both shapes. The fourth probe, whose bare key
  resolves to nothing, draws no such warning: with no key definition there is no target to call
  resource-only, and its `<xref>` writes no `@href` of its own (R003).
- **The same topic in two key scopes is not a duplicate to Oxygen** (R008).
  `topics/o-scope-shared-edge.dita` is referenced twice, once per scope; the extension files
  `multiple-reference` on the second reference and Oxygen files nothing, so the row is locked
  extension-only. That pair could not tell "different scope, so intentional" from "duplicates are
  simply not counted inside a `topicgroup`", so R008 keeps the spec's answer until a run of the
  duplicate probes below decides it.

## The duplicate probes (R008) — not yet run in Oxygen

Six maps under `maps/`, each referencing its own topic twice, added to settle the open row
above. They are referenced from the end of `corpus.ditamap` (so the lines the report cites
did not move) and each sits on a map of its own, because parity compares `(file, category)` and
every probe files its `multiple-reference` on the map that holds the pair.

| Map | Layout | Asks |
| --- | --- | --- |
| `maps/p-dup-a-root.ditamap` | two sibling `topicref`s at the root | control: corpus 1 already shows `dmv.dup.topic` here |
| `maps/p-dup-b-group.ditamap` | both inside one `topicgroup`, no keyscope | does a container stop duplicates counting? |
| `maps/p-dup-c-two-groups.ditamap` | one in each of two `topicgroup`s, no keyscope | does a different parent stop them counting? |
| `maps/p-dup-d-same-scope.ditamap` | both inside one `keyscope="s1"` group | is a duplicate within one scope counted? |
| `maps/p-dup-e-two-scopes.ditamap` | one in `s1`, one in `s2` (the shared-edge shape, isolated) | reproduces the open row on its own map |
| `maps/p-dup-f-topicref-scope.ditamap` | `keyscope` on the two `topicref`s, no container | separates the scope from the container |

The extension files `multiple-reference` on all six today. **No Oxygen answer exists yet**, so
until a rerun the parity lock carries six extension-only rows that are *unknown*, not
disagreements. After the rerun, read it so:

- B, C and D reported, E not: the scope decides. Count a reference by `(target, scope chain)` in R008, in step with R066.
- B and C not reported: Oxygen does not count duplicates inside a `topicgroup`, whatever the scope; narrow R008 to references that share one container level, and E is a by-product.
- B reported, C not: duplicates count only between siblings of one parent.
- D not reported while B is: a `keyscope` by itself ends the count, even inside one scope.

Rerun with `corpus.ditamap` as the only open root map, then `sanitize-oxygen-report.cjs` and
`UPDATE_OXYGEN_PARITY=1` for this folder. Do not change R008 before that.

## Running it

```
node scripts/completeness-baseline.cjs --corpus completeness-corpus-6           # extension findings
node scripts/oxygen-diff.cjs --corpus completeness-corpus-6 <report.xml>        # against Oxygen
node scripts/sanitize-oxygen-report.cjs --corpus completeness-corpus-6 <raw.xml> # writes oxygen-report.xml here
```

`UPDATE_COMPLETENESS_BASELINE=1 npm test` and `UPDATE_OXYGEN_PARITY=1 npm test` refresh the
baseline and the parity lock. Keep the line numbers of `corpus.ditamap` stable when editing the
comment at its top: the report cites them.

Known limit: a map reached twice with different `keyscope`s is crawled once (first scope).
