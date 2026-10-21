# Oxygen's DITA problem catalog — the parity spec

This is the specification for parity with Oxygen's **Validate and Check for
Completeness**. It is not an Oxygen report; it is the enum of findings the check
can produce, read straight out of the editor you already have installed:

```
<Oxygen install>/lib/oxygen.jar
  builtin/dita-validation/messages_en_US.properties   # problem ID -> message
  builtin/dita-validation/links.properties            # problem ID -> spec anchor
```

No Oxygen Scripting license and no headless run are needed to read these files.
They are the authority for *what Oxygen checks*; `OXYGEN.md` is only needed if a
real report is ever compared empirically.

The **Status** column says where the extension stands:

- **ok** — the extension has an equivalent check and it is mapped in
  `PROBLEM_ID_CATEGORY` (`src/test/editor/oxygenReport.ts`). That does not mean a real
  report was seen to carry this exact id: a row says so when it did not ("mapped only"),
  and only the rows without that note are backed by an incident of that id.
- **gap** — Oxygen reports it; the extension does not.
- **n/a** — the extension deliberately diverges (documented below).

Descriptions are paraphrases; the exact wording legitimately differs and is
ignored by the `(file, category)` diff.

## Files, hrefs and reference hygiene

| Problem ID | Oxygen reports | Extension status |
| --- | --- | --- |
| `dmv.file.not.found` | a referenced file does not exist | ok (`missing-reference`) |
| `dmv.reference.not.exist` | a reference cannot be resolved | ok (`missing-reference`) |
| `dmv.invalid.DITA.reference` | reference is invalid DITA | gap |
| `dmv.invalid.DITA.uri.target` | URI does not resolve to a DITA target | gap |
| `dmv.folder.ref` | a reference points at a folder, not a file | ok (`folder-reference`) |
| `dmv.absolute.ref` | an absolute reference (not portable) | ok (`reference-syntax`) |
| `dmv.recursive.ref` | a map recursively references itself | ok (`recursive-reference`) |
| `dmv.win.seps.ref` | reference uses `\` separators | ok (`reference-syntax`) |
| `dmv.unencoded.ref` | reference has characters that need URI-encoding | ok (`reference-syntax`) |
| `dmv.extra.slash.ref` | reference contains `//` | ok (`reference-syntax`) |
| `dmv.ref.extra.slash` | extra trailing slash after the topic file | ok (`reference-syntax`) |
| `dmv.file.url.two.slashes` | `file:` URL with a wrong number of slashes | ok (`reference-syntax`) — mapped only: the corpus-2 report raised `dmv.absolute.ref` for these probes instead, so no incident carries this id |
| `dmv.incorect.capit.ref` | reference capitalization differs from the real file name | ok (`incorrect-case-reference`) |
| `dmv.external.references.map` | reference outside the main map folder | ok (`outside-folder`) |

## Reference type, format and scope

| Problem ID | Oxygen reports | Extension status |
| --- | --- | --- |
| `dmv.topicref.no.format` | referenced resource does not look like DITA; needs `@format` | ok (`format-missing`) |
| `dmv.topicref.map.no.format` | looks like a map but `@format` is not `ditamap` | ok (`format-mismatch`) — mapped only: the corpus-2 report has no incident with this id |
| `dmv.topicref.topic.no.format` | looks like a topic but `@format` is not `dita` | ok (`format-mismatch`) |
| `dmv.ref.map.no.proper.format` | DITA map whose `@format` is not `ditamap` | ok (`format-mismatch`) |
| `dmv.ref.res.as.dita` | non-DITA resource referenced as DITA | ok (`format-mismatch`) |
| `dmv.ref.res.as.map` | non-DITA resource with `@format="ditamap"` | ok (`format-mismatch`) |
| `dmv.ref.topic.as.map` | topic marked as a map | ok (`format-mismatch`) |
| `dmv.ref.topic.inside.mapref` | topicref/keydef inside a map reference is ignored | ok (`ignored-mapref-content`) |
| `dmv.no.format.non.dita.ref` | non-DITA reference missing `@format` | ok (`format-missing`) — mapped only: the corpus-2 report has no incident with this id |
| `dmv.topicref.remote` | external reference missing `@format` | ok (`external-reference`) — mapped only: the corpus-2 report produced no incident for this id (its `ext scope` probes carry `dmv.topicref.ext.scope.no.format`) |
| `dmv.topicref.remote.no.external.scope` | external reference should set `@scope="external"` | ok (`external-reference`) |
| `dmv.topicref.remote.local.scope` | external reference needs `@format` and `@scope` | ok (`external-reference`) — mapped only: the corpus-2 report has no incident with this id |
| `dmv.topicref.ext.scope.no.format` | external-scope non-DITA ref missing `@format` | ok (`format-missing`) |
| `dmv.ref.type.class.mismatch` | `@type` does not match the target's class | gap |
| `dmv.ref.type.class.mismatch.specific` | `@type` less specific than the target's class | gap |
| `dmv.topicref.to.element` | topicref points at an element ID, not a topic ID | gap |
| `dmv.topichead.no.navtitle` | `topichead` has no navigation title | ok (`missing-navtitle`) |
| `dmv.topicref.no.navtitle` | non-local topicref has no navigation title | ok (`missing-navtitle`) |
| `dmv.bad.id.ref` | bad ID reference | gap |
| `dmv.invalid.ref.id` | referenced ID not found | gap |
| `dmv.invalid.ref.id.path` | referenced ID path not found | gap |
| `dmv.invalid.ref.id.path.keyref.elemid` | key-target element ID not found under the key | gap |
| `dmv.invalid.ref.topic.id` | referenced topic ID not found | ok (`invalid-ref-topic-id`) |
| `dmv.link.no.target` | link/xref has neither `@href` nor `@keyref` | gap |
| `dmv.link.topic.to.map` | topic-to-map reference is not resolved in output | ok (`format-mismatch`) — same file and fix as `dmv.ref.topic.as.map` in the corpus-2 probe |
| `dmv.ref.to.resource.only` | cross-reference to a resource-only topic breaks | gap |
| `dmv.ref.filtered` | target is excluded by profiling filters | gap |
| `dmv.empty.link.peer.target` | peer-map reference needs explicit link text | gap |

## Conref / conkeyref / reuse

| Problem ID | Oxygen reports | Extension status |
| --- | --- | --- |
| `dmv.id.miss.conref` | conref missing the `#id` part | gap |
| `dmv.conref.proper.order` | `conref` comes after `conrefend` | gap |
| `dmv.conref.siblings` | `conref`/`conrefend` are not siblings | gap |
| `dmv.conrefend.confl.conref` | `conrefend` targets a different topic than `conref` | gap |
| `dmv.conrefend.no.conref` | `conrefend` without `conref` | gap |
| `dmv.ref.filtered.conref` | conref target is dropped by content-ref processing | gap |
| `dmv.conkeyref.peer.map` | conkeyref into a peer map | gap |
| `dmv.no.conref.has.target.attr.value` | non-conref element carries a conref-target attribute | gap |
| `dmv.not.used.reusable.component` | reusable element never conref'd | ok (`unreferenced-reusable`) |

## Keys

| Problem ID | Oxygen reports | Extension status |
| --- | --- | --- |
| `dmv.undef.key` | keyref cannot be mapped to a target topic | ok (`undefined-key`) |
| `duplicate.key.definition` | the same key is defined twice | ok (`duplicate-key`) |
| `dmv.not.used.key.defs` | key defined but never referenced | ok (`unreferenced-key`) |
| `dmv.circular.keyref` | circular key reference | gap |
| `dmv.no.link.keyref` | target key definition has no reference | gap |
| `dmv.invalid.keyref.syntax.1` | keyref has more than one `/` | ok (`invalid-key-syntax`) — the report carries the family as `dmv.invalid.keyref.syntax`, without the suffix |
| `dmv.invalid.keyref.syntax.2` | invalid character in a keyref | n/a — the corpus-2 report produced no incident for it; the extension checks only `/` and whitespace |
| `dmv.invalid.keyref.syntax.3` | keyref contains whitespace | ok (`invalid-key-syntax`) — the report carries the family as `dmv.invalid.keyref.syntax`, without the suffix |

## Duplicates

| Problem ID | Oxygen reports | Extension status |
| --- | --- | --- |
| `dmv.dup.topic` | the same topic referenced more than once | ok (`multiple-reference`) |
| `dmv.dup.topic.id` | duplicate topic ID in the map context | ok (`duplicate-id`) — the extension reports every topic that shares the id, as Oxygen does |
| `dmv.dup.el.id` | duplicate element ID inside one topic | gap |
| `dmv.dup.cond.filter` | duplicate condition in a filter file | gap |

## Unreferenced / not in map

| Problem ID | Oxygen reports | Extension status |
| --- | --- | --- |
| `dmv.not.topic.ref.in.map` | topic referenced elsewhere but not in the map | ok (`unreferenced-link`) |
| `dmv.not.topic.ref.reltable.in.map` | topic referenced in a reltable but not in the map | ok (`unreferenced-link`) |

## Profiling

| Problem ID | Oxygen reports | Extension status |
| --- | --- | --- |
| `dmv.prof.attr.innef.cond` | attribute value can never show (ancestor conditions) | ok (`profiling-conflict`) |
| `dmv.prof.attr.group.innef.cond` | condition group can never show | ok (`profiling-conflict`) |
| `dmv.prof.attr.prefs.undef` | attribute not defined in profiling preferences | ok (`profiling-preference`) |
| `dmv.prof.attr.val.prefs.undef` | value not defined in profiling preferences | ok (`profiling-preference`) |
| `dmv.prof.attr.empty.value` | profiling attribute has an empty value | gap |
| `dmv.prof.attr.val.prefs.confl` | multi-value attribute defined as single-value | gap |
| `dmv.prof.group.val.prefs.undef` | group value not defined in profiling preferences | gap |
| `dmv.prof.sbj.attr.mult.val.confl` | multi-value attribute single-valued in the subject scheme | gap |
| `dmv.prof.sbj.attr.val.rej` | value rejected by the subject scheme | gap |
| `dmv.prof.sbj.attr.val.rej.all` | subject scheme rejects every value of an attribute | gap |

## DITA structure, class and domains

| Problem ID | Oxygen reports | Extension status |
| --- | --- | --- |
| `dmv.invalid.class.format` | malformed `@class` | gap |
| `dmv.invalid.class.generalization` | `@class` is not a generalization | gap |
| `dmv.invalid.class.specialization` | `@class` is not a specialization | gap |
| `dmv.invalid.domains.format` | `@domains` missing/malformed | gap |
| `dmv.invalid.id.syntax.2` | invalid character in an ID | ok (`invalid-id-syntax`) — the corpus-2 report files it as `IDInvalidWithNamespaces` |
| `dmv.invalid.id.syntax.3` | ID contains whitespace | ok (`invalid-id-syntax`) — `IDInvalidWithNamespaces` in the corpus-2 report |
| `dmv.invalid.parse.dita.content` | problem parsing DITA content | gap |
| `dmv.section.first.title` | `<section>` title is not the first element | gap |
| `dmv.section.no.dup.title` | `<section>` has more than one title | gap |

Everything marked **gap** is produced by Oxygen's DITA validation engine (the
"batch validate" step) or by checks the extension has not implemented yet. The
extension's `batchValidate` is only well-formedness plus root/`@id`/`<title>`
structure, so it will not match the ~40 structure/class/conref IDs without a real
DITA validator.

## Extension-only findings (not in Oxygen's catalog)

- `missing-resource` — non-DITA (image/object/…) files that do not exist. Oxygen
  has no separate category: it reports the same dangling href as
  `dmv.file.not.found` (`missing-reference`). Parity folds the two through
  `CATEGORY_EQUIVALENCES` so the same file counts as matched; the extension UI
  keeps the resource/reference distinction.
- `reference-syntax` — mostly Oxygen's `dmv.*.ref` family (see the table), but the
  extension also reports a POSIX root-absolute href (`/topics/x.dita`), which Oxygen
  resolves and files only as `dmv.file.not.found`. The extension keeps the spelling
  finding because the path cannot be portable; locked as extension-only in the
  corpus-2 parity.
- `remote-resource` — HTTP(S) resources that do not respond to a HEAD probe.
- `table-layout` — CALS/simple table layout heuristics.

## Confirmed corpus gaps

Two corroborated divergences from `baseline.extension.json`:

1. `topics/invalid.dita` — well-formed but schema-invalid; the extension is
   silent, Oxygen's validator is not (`dmv.*` structure/attribute problems).
2. ~~`keydef keys="kusekey"` + two `topicref keyref="kusekey"`~~ — **fixed**:
   the crawler now resolves `@keyref` after the maps are crawled, so this is a
   `multiple-reference` (and an unresolvable key is `undefined-key`).

## Observed in real Oxygen reports

Two GUI *Validate and Check for Completeness* runs on the corpus (before it
carried a DOCTYPE) returned **only** `corpus.ditamap` findings:
`dmv.invalid.class.format` ×29 (one per map element), a single
`dmv.prof.attr.prefs.undef` on the map's `audience` topicref, and one
"There is no schema or DTD associated with the document" error. Nothing reached
the topics.

Root cause: Oxygen recognises a DITA map through its DOCTYPE. Without one, the
Maps Manager does not build the topicref graph, so the *completeness* half of
the check is a no-op and only map-level `dmv.*` structure errors fire. Every
corpus file now carries a DITA 1.3 DOCTYPE so the next run is the first genuine
parity test of the completeness categories.

What the two runs did settle:

- `dmv.invalid.class.format` is **confirmed as a gap** — the extension emits
  nothing for a missing/malformed `@class`. Once the corpus has a DOCTYPE the DTD
  supplies the default `@class`, so this noise should disappear and stop masking
  the completeness findings.
- `profiling-preference` parity is decided by the **configured preference set**,
  not by a rule difference. Oxygen flagged the map's `audience="novice"` only
  because this Oxygen had empty profiling preferences; the extension checks map
  topicrefs too (`mapCrawl`) and stays silent because its harness allows
  `novice`. Align the two preference sets before comparing.

### The first genuine run (corpus carrying DITA 1.3 DOCTYPEs)

*Validate and Check for Completeness* over the corpus (every option on, remote
off; Oxygen's `audience` profiling preference already matched the harness's
`expert novice`, so no preference change was needed) produced **30 incidents**
(`oxygen-report.xml`). At this run the parity set (`oxygen-parity.expected.json`) locked
**15 matched, 4 extension-only, 5 Oxygen-only** — the second run below supersedes it with
21 matched (the 4th extension-only row, `topics/profiling-defined.dita` `profiling-conflict`, is the R022 probe the latest report confirmed Oxygen-silent — see the profiling note below). An earlier run had 7 Oxygen-only
rows; once `outside.dita` carried a DOCTYPE and the report was regenerated, its
two stale rows matched and the lone `oxygen:unknown` id disappeared. Every
remaining Oxygen-only row and how it is handled:

| Oxygen-only row | Report evidence | Handling |
| --- | --- | --- |
| `resources.dita` `missing-reference` | `dmv.file.not.found` ×2 (lines 7, 8) | **Matched by category equivalence.** Oxygen has no resource/reference split, so the same dangling href is its `missing-reference` and the extension's `missing-resource`. `CATEGORY_EQUIVALENCES` (`completenessHarness.ts`) folds the two in the parity signature only — the extension UI keeps the distinction. Locked by `oxygenParity.test.ts`. |
| `twoidsa.dita` `duplicate-id` | `dmv.dup.topic.id` (line 3) | **Fixed.** `mapChecks` used to report one participant of a duplicate group; it now flags every topic that shares the id (as Oxygen does), each related to the others. |
| ~~`outside.dita` no-schema (`oxygen:unknown`) + `dmv.invalid.class.format`~~ | *(gone on re-run)* | **Resolved.** With the DOCTYPE in place the regenerated report carries neither row; `outside.dita` now matches on `outside-folder` and `unreferenced-link`, and the `oxygen:unknown` id is no longer present. |
| `corpus.ditamap` `dmv.invalid.parse.dita.content` | line 64, message names `topics/malformed.dita` | **B — attribution, not a gap.** The same malformed-topic finding the extension reports as `topics/malformed.dita validation`; Oxygen reports it on the referencing map. Kept as an understood divergence: the `(file, category)` signature cannot fold a *different* file, so it stays one extension-only + one Oxygen-only until we decide whether to redirect map-level parse errors to the target. |
| `linker2.dita` `dmv.invalid.ref.topic.id` ×2 | referenced topic ID not found (lines 9, 10) | **Implemented — now matched.** New `invalid-ref-topic-id` check (`mapChecks`) fires when a `@conref` resolves to a file that exists but its topic-id segment (the part after `#`) names no topic in it. Ledger R020. |
| `ok.dita` `unreferenced-reusable` | `dmv.not.used.reusable.component` (line 6) | **Implemented — now matched.** `unreferencedReusable` is now strict: a broken conref (its topic id does not resolve, R020) no longer counts as consuming its target, so `ok.dita`'s `p#used` (and `reuse.dita`'s `p#shared`) stay unreferenced, as Oxygen reports. |
| `invalid.dita` `MSG_*` ×3 + `dmv.invalid.class.format` | schema/DTD + malformed `@class` | **A-class — schema validation (Phase 5).** Needs real DTD/schema validation; deferred to the DITA-OT-preprocess-reuse evaluation, not built here on guesses. |

Run-wide notes:

- `dmv.invalid.class.format` fell from 29 to a single incident once the DOCTYPEs
  landed, confirming the earlier diagnosis: most were map-level noise from the
  missing DTD default. The one left sits on `topics/invalid.dita` (the
  schema-invalid probe).
- Profiling: Oxygen's `audience` preference already carried `expert novice`, so
  `profiling-preference` matches on `profiling.dita`. For `profiling-conflict` the
  first two probes (`audience="admin"`, then `expert`, on a body paragraph under a
  `novice` topicref) drew no `dmv.prof.attr.innef.cond`. That alone did not say where
  Oxygen's rule applies, so R023-R025 probe the other shapes, each file carrying a
  control paragraph (`audience="novice admin"`) that Oxygen is known to report: the
  controls were all reported and the rule fired for map against map, element against
  element and topic root against map (see "The second run" below). The harness's
  `CORPUS_PREFERENCES` defines only `audience`, so
  the extension additionally flags `platform="linux"` as an undefined attribute
  while Oxygen (whose stock set defines `platform`) stays quiet — a
  preference-set artifact, invisible at `(file, category)` granularity.
- The `conref-forms.dita` probe (`#conrefforms/src` and `#./src`) produced **no**
  incident in Oxygen and none from the extension: **Oxygen agrees the same-topic
  `.` form resolves**, so R021 is confirmed against the real tool, not just the
  unit test.

### The second run — R023–R025 ineffective-condition shapes

*Validate and Check for Completeness* over the same corpus (every option on, remote
off), now carrying the three shape probes, produced **36 incidents** — the 30 from the
first run plus 3 control paragraphs and 3 `dmv.prof.attr.innef.cond` findings. Every
control was reported (`dmv.prof.attr.val.prefs.undef` on the `audience="admin"` paragraph
in each file), so the run reached all three probes and is usable as evidence.
With the alignment below, `oxygen-parity.expected.json` locks **21 matched, 2 extension-only,
5 Oxygen-only** (`scripts/oxygen-diff.cjs` agrees: `signatures matched: 21`).

| Shape | Where Oxygen put `dmv.prof.attr.innef.cond` | Outcome |
| --- | --- | --- |
| R023 map against map | `corpus.ditamap` — the `audience="expert"` topicref inside the `audience="novice"` topicgroup | **matched** — Oxygen cascades values across map elements |
| R024 element against element | `topics/profiling-shape-inner.dita` — the `audience="expert"` `<li>` inside the `audience="novice"` `<ul>` | **matched** — Oxygen does flag a body element against a body ancestor |
| R025 topic root against map | `topics/profiling-shape-root.dita` — the topic root's `audience="expert"` against the referencing topicref's `audience="novice"` | **matched** |

So Oxygen's ineffective-condition rule fires for map↔map, body↔body and root↔map, but not
for a body `<p>` against the value **cascaded from the map** topicref (`topics/profiling.dita`,
`topics/profiling-defined.dita`): there Oxygen reports the paragraph only as
`dmv.prof.attr.val.prefs.undef`, if at all.

**Aligned.** The extension used to carry the topicref value down to every element of the
topic. It now compares it with the topic **root** only and compares each element below the
root with its ancestors in the same file (R014, R022); the two extension-only
`profiling-conflict` rows are gone. What stays extension-only is `malformed.dita` `validation`
(the B-class attribution difference above) and `tables.dita` `table-layout` (the documented
extension-only check). One case was not probed: a root that overlaps the map value only
partly, with a child that conflicts with the part the map removed; the extension compares
that child with the root's own values.

## How to use this

1. Implement a check, pick the `dmv.*` ID it corresponds to, and add it to
   `PROBLEM_ID_CATEGORY` in `src/test/editor/oxygenReport.ts`.
2. Add a probe to `corpus.ditamap` (or to a topic) and lock the finding in
   `baseline.extension.json` via `npm run check:completeness -- --update`.
3. Keep the **Status** column honest: move a row from *gap* to *ok* only when the
   corpus proves it.
