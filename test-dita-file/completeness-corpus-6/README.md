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
  extension-only. This corpus has no probe that separates "different scope, so intentional" from
  "duplicates are simply not counted inside a `topicgroup`", so R008 keeps the spec's answer
  until a run with such a pair decides it.

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
