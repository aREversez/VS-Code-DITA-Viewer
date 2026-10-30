# Completeness corpus 6: key scope resolution

The sixth differential corpus, kept apart from the other five so each keeps its own line
numbers, baseline and parity lock. It has its own root map, `corpus.ditamap`, its own
`baseline.extension.json`, and since its first run a sanitized `oxygen-report.xml` and an
`oxygen-parity.expected.json`. The rules it feeds are R066 (key scope), R011 (an unused key
definition) and the scope half of R008 (duplicates) in `../completeness-corpus/RULES.md`.

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

## The runs: 25 incidents, full parity

`node scripts/oxygen-diff.cjs --corpus completeness-corpus-6 oxygen-report.xml` reports
**18 matched, 0 extension-only, 0 Oxygen-only**. No incident was an accepted difference, so
parity compares all eighteen signatures; the 25 incidents collapse into them because each
duplicate probe files one incident per reference.

Six reports were taken from this corpus, and the last one is the committed
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

The fourth report (**20 incidents**) added the three probes that ask what a scope's identity
is:

| Oxygen | Where | Extension |
| --- | --- | --- |
| `dmv.dup.topic` ×2 | `maps/p-dup-l-two-groups.ditamap:11`, `:14` | `multiple-reference` on the second reference, matched |
| `dmv.dup.topic` ×2 | `maps/p-dup-n-name-spacing.ditamap:11`, `:14` | `multiple-reference` on the second reference, matched |

`p-dup-m` drew nothing, and every earlier incident came back the same, so the extension needed
no change: the lock's two extension-only rows (`l` and `n`) became matches, and it reads zero in
both directions again.

The fifth report (**23 incidents**) added the four key-scope tail probes and answered all three
of their questions — one in Oxygen's direction, one in the extension's, one confirming a rule
that only unit tests had covered. It is the section below that records it, because it moved the
extension for the first time since the key-scope half of R066 was written.

The sixth report (**25 incidents**) added the multi-name probe and confirmed R066 as it stood:
`a.k-mn` and `b.k-mn` both resolve from outside the `keyscope="a b"` group, `ab.k-mn` and the
bare `k-mn` do not, and the topic published inside the group resolves bare. Both controls were
filed, every earlier incident came back the same, and the extension **needed no change**: its two
extension-only rows became matches.

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
`keyscope` group, two scopes, and `keyscope` on the `topicref`s themselves — and the seven scope
shapes below.

## The scope shapes (R008): all eight observed

The six probes above count by scope for siblings (`s1` against `s2`); the maps below ask the
shapes those leave open, each with its own topic, referenced after the six and before the
control.

| Map | Layout | Report | What it settles |
| --- | --- | --- | --- |
| `maps/p-dup-g-root-vs-scope.ditamap` | once at the root, once inside `keyscope="s1"` | 3rd: *(nothing)* | the root is a scope like any other |
| `maps/p-dup-h-nested-scope.ditamap` | once in `s1`, once in `s2` nested in `s1` | 3rd: *(nothing)* | the whole chain counts, not only the outermost name |
| `maps/p-dup-i-multi-vs-single.ditamap` | once in `keyscope="a b"`, once in `keyscope="a"` | 3rd: *(nothing)* | the names are compared as a whole, not any one they share |
| `maps/p-dup-j-multi-reordered.ditamap` | once in `"a b"`, once in `"b a"` | 3rd: *(nothing)* | the names count **in the order written**: a set would have called these one scope |
| `maps/p-dup-l-two-groups.ditamap` | once in each of two independent `keyscope="a b"` groups | 4th: `dmv.dup.topic` ×2 | the names are the identity, not the element that declares them |
| `maps/p-dup-m-nested-same-inner.ditamap` | once in `s1 > x`, once in `s2 > x` | 4th: *(nothing)* | the whole chain counts, not its innermost name |
| `maps/p-dup-n-name-spacing.ditamap` | once in `keyscope="a b"`, once in `keyscope="a  b"` | 4th: `dmv.dup.topic` ×2 | the names are split on whitespace, not compared as attribute text |
| `maps/p-dup-k-control.ditamap` | twice inside one `keyscope="s1"` group (the control) | 3rd and 4th: ×2 | the run read the tail of the map, so the silence above is an answer |

So R008 counts a reference by `(target, scope chain)` with the names **in the order the
`keyscope` lists them**: `scopeKey` (`mapChecks.ts`) joins the chains without sorting, so
`"a b"` and `"b a"` are two scopes and the pair of `p-dup-j` stops being a duplicate, while two
groups that both say `keyscope="a b"` are one — which the fourth report filed (`p-dup-l`). The
same run answered the two neighbours: a chain is its whole list of names, not its innermost one
(`p-dup-m` silent), and the names are parsed, not read as attribute text (`p-dup-n` filed). No
shape is left to extrapolate; nothing in `mapChecks.ts` changed for any of the three.

`src/test/editor/mapCompleteness.test.ts` pins all seven answers, so a change after a later run
is deliberate. Rerun with `corpus.ditamap` as the only root map, sanitize, refresh this folder's
parity lock, and change R008 only where Oxygen disagrees.

### The scope identity (R008): the fourth report

The three maps asked what the **identity** of a scope is, which the first nine probes leave
open. Both readings of each were registered here **before** the run, so the reading was not
chosen after seeing it; all three landed on the reading the rule already took, and no code
changed.

| Map | Registered reading | Fourth report |
| --- | --- | --- |
| `maps/p-dup-l-two-groups.ditamap` | reported = the names are the identity; silent = each `keyscope` element is its own context, so the group key must name the declaring element | reported ×2, so the names are the identity |
| `maps/p-dup-m-nested-same-inner.ditamap` | reported = only the innermost name counts; silent = the whole chain is the identity | *(nothing)*, so the whole chain is the identity |
| `maps/p-dup-n-name-spacing.ditamap` | reported = the names are parsed on whitespace; silent = the attribute text is compared, recorded as a known difference | reported ×2, so the names are parsed |

While the shapes were unknown, the baseline and the parity lock carried `l` and `n` as
extension-only rows, and `oxygen-diff` returned non-zero on them for that reason. The fourth
report turned both into matches, so the lock reads zero in both directions again and no unknown
row is left in this corpus.

### The control: telling silence from a stale map

A first look at g to j came back identical to the report before it, and a report cannot tell
"Oxygen answered *not a duplicate*" from "Oxygen ran on a cached copy of `corpus.ditamap` that
lacked them" (the DITA Maps Manager keeps an open root map, and a file changed outside the
editor is not always reloaded). The only control then was the missing topic at the top of the
map, which says the root was read, not the tail.

`maps/p-dup-k-control.ditamap` is the same-scope pair of `p-dup-d`, which Oxygen files, and it is
referenced **last**. Every report from the third on carries its two `dmv.dup.topic` rows, on
lines 11 and 12, so the run read the whole tail and the silence on the probes above is an answer.

A report without them is a stale map: close the root map in the DITA Maps Manager, reopen
`corpus.ditamap` from disk and run again — none of g to n is answered then. Before reading
anything into a report, check that the Maps Manager tree shows the nodes the run should cover
(`p-dup-g` to `p-dup-n`, `q-twice`, `q-unused-pos`, `q-unused-neg`, `q-conkeyref`,
`q-multiname`, and the control `p-dup-k`) under the root map.

## The key-scope tail (R066 and R011): the fifth report

Four maps under `maps/`, referenced from `corpus.ditamap` before the control (still last, so the
lines earlier reports cite did not move). Each has its own topics, targets and keys, so one
probe's finding never lands on another's file. Both readings of each row were registered here
**before** the run; the fifth report answered all four:

| Map | Layout | Fifth report | What it settles |
| --- | --- | --- | --- |
| `maps/q-twice.ditamap` | `q-twice-keys.ditamap` (one `keydef`) referenced twice, with `keyscope="x"` and `keyscope="y"`; `q-twice-x` uses `x.k-twice`, `q-twice-y` uses `y.k-twice`, both published outside both scopes | *(nothing)* | a map reached under a second scope chain is a second instance of it: its keys are in effect in every scope that reaches it. The extension's `undefined-key` on `q-twice-y` was a **false positive** and is gone |
| `maps/q-unused-pos.ditamap` | `k-u-pos` defined inside `keyscope="s1"`; its only use (`q-unused-pos`, a bare `keyref`) published outside it | `dmv.key.undef` on the topic **and** `dmv.not.used.key.defs` on the keydef | a use counts for its name only when it resolves: the failed use leaves the definition unused, and the extension now files `unreferenced-key` there too |
| `maps/q-unused-neg.ditamap` | control: the same layout with the use inside `s1` | *(nothing)* | an in-scope use does count, so the new rule does not fire on a used key |
| `maps/q-conkeyref.ditamap` | `k-ck` defined inside `s1`; `conkeyref="k-ck/p1"` from outside (`q-ck-outside-pos`), from inside (`q-ck-inside-neg`) and by qualified name (`s1.k-ck/p1`, `q-ck-qualified-neg`) | `dmv.key.undef` on the outside topic only | R066 holds for `conkeyref`, which until this run only unit tests covered |

Two changes followed, both in the column registered as "differently":

- **A map reached twice is crawled once but defines its keys in each scope** (`mapCrawl.ts`).
  `seenMaps` now holds a set of scope signatures per map file; a second pass over a map already
  scanned runs in `replay` mode, which registers its `keydef`s under the new scope and collects
  nothing else — no reference, id, entry or finding is filed twice. `keyDefIndex` keeps one
  `KeyDef` per element (`file` plus the scan's `uid`, since a line can hold several), and a
  replay extends that definition's `scopeIds`/`qualified` instead of adding a second one, so
  R010 still sees one definition and cannot call it a duplicate.
- **R011 counts a use only when it resolves** (`mapChecks.ts`, step 8). A name a
  `@keyref`/`@conkeyref` wrote but never bound leaves its definition unreferenced — Oxygen's
  `dmv.not.used.key.defs`. Counting per definition instead broke corpus 1's `dupkey`, where
  resolution reaches the first of two definitions and Oxygen therefore calls the name used, so
  the count is per name (`usedKeyNames`): a name any context resolved counts once, for every
  definition that answers to it.

`src/test/editor/keyScopeResolution.test.ts` pins both answers — the twice-reached map resolves
`y.k-twice` and stays one definition, and the use that fails in its scope leaves a
`unreferenced-key` behind. The baseline carries one finding more (16), the parity lock none of the
three unknown rows the fourth one held: `q-twice-y` is gone, and `q-ck-outside-pos` and
`q-unused-pos` are matches, together with the new `unreferenced-key`. `oxygen-diff` reads zero in
both directions.

One limit stays next to that change: a *topic* published by a map reached twice is still checked
in the first scope only, because the second pass registers the map's keys, not the publications
of its `topicref`s. No probe asks about it — `q-twice` publishes its topics outside both scopes —
so it is recorded here rather than fixed by extension.

## The multi-name scope (R066): the sixth report

R066 reads `keyscope="a b"` as a set (a key in it answers to `a.k` and to `b.k`), while R008
compares the same names as an ordered list. The second is observed (`p-dup-i`, `p-dup-j`); the
first was the spec's reading with no Oxygen answer, which this probe asked for. One map,
`maps/q-multiname.ditamap` (before the control, which is still last): a `keyscope="a b"` group
holding `keydef k-mn`, and five topics, one use each, so every finding lands on its own file.
Both readings of each row were registered **before** the run:

| Topic | Use | Sixth report | What it settles |
| --- | --- | --- | --- |
| `q-mn-a` | `a.k-mn`, outside the group | *(nothing)* | the first name qualifies |
| `q-mn-b` | `b.k-mn`, outside | *(nothing)* | every name of the list qualifies: R066 reads it as a set, not only its first name |
| `q-mn-inside` | bare `k-mn`, published inside | *(nothing)* | a multi-name group is a scope for its own members |
| `q-mn-ab` | `ab.k-mn`, outside (control) | `dmv.key.undef` | the names are not concatenated |
| `q-mn-bare` | `k-mn`, outside (control) | `dmv.key.undef` | a multi-name group leaks no key out of itself |

All five landed on the answer the rule already gave — the same one `keyscopeMultiToken.test.ts`
pins — so no code changed and the parity lock's two extension-only rows (`q-mn-ab`, `q-mn-bare`)
became matches. The two readings now stand separately and both are observed: a `keyscope` is a
set of names for key resolution and an ordered list for duplicate counting (R008).

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
