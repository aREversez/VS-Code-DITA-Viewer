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

## The runs: 16 incidents, full parity

`node scripts/oxygen-diff.cjs --corpus completeness-corpus-6 oxygen-report.xml` reports
**11 matched, 0 extension-only, 0 Oxygen-only**. No incident was an accepted difference, so
parity compares all eleven signatures; the 16 incidents collapse into them because each
duplicate probe files one incident per reference.

Three reports were taken from this corpus, and the last one is the committed
`oxygen-report.xml`. The first carried **6 incidents**, before the duplicate probes existed,
and settled R066 and the keydef half of R049:

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

The second report (**14 incidents**) added the six duplicate probes and answered the question:

| Oxygen | Where | Extension |
| --- | --- | --- |
| `dmv.dup.topic` ×8 | `maps/p-dup-a-root.ditamap:8`, `:9`; `p-dup-b-group.ditamap:9`, `:10`; `p-dup-c-two-groups.ditamap:9`, `:12`; `p-dup-d-same-scope.ditamap:9`, `:10` | `multiple-reference` on the second reference of each map, matched on all four |

Nothing else moved: the six incidents of the first run came back the same, and the shared-edge
pair in `corpus.ditamap` drew nothing again — under the tightened rule the extension no longer
files it either, so that row closed instead of staying extension-only. That report read
**10 matched, 0 extension-only, 0 Oxygen-only**.

The third report (**16 incidents**) added the four scope shapes and their control:

| Oxygen | Where | Extension |
| --- | --- | --- |
| `dmv.dup.topic` ×2 | `maps/p-dup-k-control.ditamap:11`, `:12` | `multiple-reference` on the second reference, matched |

g to j drew nothing at all, so the extension's silence on g, h and i stands and its finding on
j had to go: the only signature that moved was the control's, out of the lock's extension-only
row and into the matched set.

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
counts a reference by `(target, scope chain)`. `mapChecks.ts` keys its duplicate groups on the
target plus `Reference.scopeChains`, which `mapCrawl.ts` records for every map element (the
element's own `keyscope` included) and hands to a `<topicref keyref>` as well. The shared-edge
pair of `corpus.ditamap` is that same shape, which is why it stopped being an extension-only
row without a change of its own. These six probes say nothing about the order of the names
inside a chain; the next section does.

`src/test/editor/mapCompleteness.test.ts` covers the four shapes here — two `topicgroup`s, one
`keyscope` group, two scopes, and `keyscope` on the `topicref`s themselves — and the four scope
shapes below.

## The scope shapes (R008): observed, and the order of the names counts

The six probes above count by scope for siblings (`s1` against `s2`), but three more shapes
were the rule's extrapolation of them, and a fifth map exists only to make the answers
readable. Each has its own topic and is referenced after the six, at the end of `corpus.ditamap`.

| Map | Layout | Third report | What it settles |
| --- | --- | --- | --- |
| `maps/p-dup-g-root-vs-scope.ditamap` | once at the root, once inside `keyscope="s1"` | *(nothing)* | the root is a scope like any other |
| `maps/p-dup-h-nested-scope.ditamap` | once in `s1`, once in `s2` nested in `s1` | *(nothing)* | the whole chain counts, not only the outermost name |
| `maps/p-dup-i-multi-vs-single.ditamap` | once in `keyscope="a b"`, once in `keyscope="a"` | *(nothing)* | the names are compared as a whole, not any one they share |
| `maps/p-dup-j-multi-reordered.ditamap` | once in `"a b"`, once in `"b a"` | *(nothing)* | the names count **in the order written**: a set would have called these one scope |
| `maps/p-dup-k-control.ditamap` | twice inside one `keyscope="s1"` group (the control) | `dmv.dup.topic` ×2 | the run read the tail of the map, so the silence above is an answer |

So R008 counts a reference by `(target, scope chain)` with the names **in the order the
`keyscope` lists them**: `scopeKey` (`mapChecks.ts`) joins the chains without sorting, so
`"a b"` and `"b a"` are two scopes and the pair of `p-dup-j` stops being a duplicate, while two
groups that both say `keyscope="a b"` are one. The extension reported `p-dup-j` until this
report; that row was the lock's only extension-only signature, and it is gone.

Three shapes are still unasked, and a test says so for each; "The shapes still unasked" below
registers the probes and both readings of each before the next run.

`src/test/editor/mapCompleteness.test.ts` pins all four answers, so a change after a later run
is deliberate. Rerun with `corpus.ditamap` as the only root map, sanitize, refresh this folder's
parity lock, and change R008 only where Oxygen disagrees.

### The shapes still unasked (R008) — not yet run

Three more maps, each with its own topic, referenced between `p-dup-j` and the control (so the
control is still last and the lines the third report cites did not move). They ask what the
**identity** of a scope is, which the first nine probes leave open. The extension's answer today
is below; each probe has two possible Oxygen answers, registered here **before** the run so the
reading is not chosen after seeing it.

| Map | Layout | Extension today | If Oxygen reports `dmv.dup.topic` | If Oxygen stays silent |
| --- | --- | --- | --- | --- |
| `maps/p-dup-l-two-groups.ditamap` | once in each of two independent `keyscope="a b"` groups (same names, same order) | reported | the names are the identity: R008 as written, and the last extrapolation is observed — no code change | every `keyscope` element is its own context: key the duplicate group on the declaring element (an instance id per scope in `Reference.scopeChains`, so `p-dup-d`, one group, still reports and `l` stops), and rewrite R008 |
| `maps/p-dup-m-nested-same-inner.ditamap` | once in `s1 > x`, once in `s2 > x` (same innermost name, different outer) | silent | only the innermost name counts: `scopeKey` takes the last name of each chain; `h` (`s1` against `s1 > s2`) and `e` stay silent either way | the whole chain is the identity: R008 as written, no code change |
| `maps/p-dup-n-name-spacing.ditamap` | once in `keyscope="a b"`, once in `keyscope="a  b"` (two spaces) | reported | the names are parsed, not compared as text: R008 as written, no code change | Oxygen compares the attribute text. Record it as a documented difference first: a keyscope written with different spacing is rare, so follow it only if cheap |

Until the run, the baseline and the parity lock carry `l` and `n` as extension-only rows: they are
*unknown*, not disagreements, and `oxygen-diff` exits non-zero on them for that reason.

`src/test/editor/mapCompleteness.test.ts` pins today's answer for all three. After the run,
change the extension only for the "silent" column of `l` and the "reports" column of `m`;
every other outcome confirms the rule as it stands. If the report lacks the control, the run
was on a stale map (below) and none of `l` to `n` is answered.

### The control: telling silence from a stale map

A first look at g to j came back identical to the report before it, and a report cannot tell
"Oxygen answered *not a duplicate*" from "Oxygen ran on a cached copy of `corpus.ditamap` that
lacked them" (the DITA Maps Manager keeps an open root map, and a file changed outside the
editor is not always reloaded). The only control then was the missing topic at the top of the
map, which says the root was read, not the tail.

`maps/p-dup-k-control.ditamap` is the same-scope pair of `p-dup-d`, which Oxygen files, and it is
referenced **last**. The third report carries its two `dmv.dup.topic` rows, on lines 11 and 12,
so the run read the whole tail and the silence on g to j is an answer.

A report without them is a stale map: close the root map in the DITA Maps Manager, reopen
`corpus.ditamap` from disk and run again — none of g to k is answered then. Before reading
anything into a report, check that the Maps Manager tree shows the new nodes (`p-dup-g` to
`p-dup-n`, and the control `p-dup-k`) under the root map.

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
