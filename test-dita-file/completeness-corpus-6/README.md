# Completeness corpus 6: key scope resolution

Sixth differential corpus (rule R066 in `../completeness-corpus/RULES.md`). It has its own
root map, `corpus.ditamap`, and its own `baseline.extension.json`. **No Oxygen report has been
run on it yet**, so there is no `oxygen-report.xml` and no parity lock: the parity test skips
this folder until one is committed, and the rule cites the DITA specification, not a report.

## What it probes

| Probe | File | Expected extension finding |
| --- | --- | --- |
| bare key defined only inside `keyscope="s1"`, used by a topic published outside it | `topics/o-scope-outside-pos.dita` | `undefined-key` |
| the same bare key, topic published inside `s1` | `topics/o-scope-inside-neg.dita` | *(none)* |
| qualified name `s1.k-scoped` from outside | `topics/o-scope-qualified-neg.dita` | *(none)* |
| topic published in `s1` (key defined) and in `s2` (not) | `topics/o-scope-shared-edge.dita` | `undefined-key` |
| missing topic | `topics/control-missing.dita` (absent) | `missing-reference` (control) |

## To do with Oxygen

Run *Validate and Check for Completeness* with `corpus.ditamap` as the only root map, every
option except remote, then `node scripts/sanitize-oxygen-report.cjs --corpus completeness-corpus-6 <raw.xml>`
and `node scripts/oxygen-diff.cjs --corpus completeness-corpus-6 <report>`. Until then the
outside and shared rows are the specification's answer, not an observed Oxygen behaviour.
Known limit: a map reached twice with different `keyscope`s is crawled once (first scope).
