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
- **n/a** — the extension deliberately diverges (documented below), or Oxygen reports nothing
  for the probes and the extension is silent too, so there is nothing to match (the row says
  which of the two it is).

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
| `dmv.topicref.to.element` | topicref points at an element ID, not a topic ID | ok (`topicref-to-element`) — the corpus-3 report carries it on `maps/f-topicref-to-element-pos.ditamap` |
| `dmv.topichead.no.navtitle` | `topichead` has no navigation title | ok (`missing-navtitle`) |
| `dmv.topicref.no.navtitle` | non-local topicref has no navigation title | ok (`missing-navtitle`) |
| `dmv.bad.id.ref` | bad ID reference | ok (`invalid-id-reference`) — the corpus-3 report carries it on `topics/f-bad-id-ref-pos.dita` (a trailing slash) |
| `dmv.invalid.ref.id` | referenced ID not found | ok (`invalid-id-reference`) — mapped only: the corpus-3 report files its probes under `dmv.invalid.ref.id.path` |
| `dmv.invalid.ref.id.path` | referenced ID path not found | ok (`invalid-id-reference`) — the corpus-3 report carries it for both the missing-element and the deeper-path probes |
| `dmv.invalid.ref.id.path.keyref.elemid` | key-target element ID not found under the key | ok (`invalid-id-reference`) — mapped only: the corpus-3 report files both positive probes under `dmv.invalid.ref.id.path`, so no incident carries this id |
| `dmv.invalid.ref.topic.id` | referenced topic ID not found | ok (`invalid-ref-topic-id`) |
| `dmv.link.no.target` | link/xref has neither `@href` nor `@keyref` | ok (`link-no-target`) — the corpus-3 report carries it on `topics/g-link-no-target-pos.dita` |
| `dmv.link.topic.to.map` | topic-to-map reference is not resolved in output | ok (`format-mismatch`) — same file and fix as `dmv.ref.topic.as.map` in the corpus-2 probe |
| `dmv.ref.to.resource.only` | cross-reference to a resource-only topic breaks | ok (`resource-only-target`) — the corpus-3 report carries it for a direct xref and for the two key-element boundaries |
| `dmv.ref.filtered` | target is excluded by profiling filters | ok (`filtered-reference`) — the corpus-4 report carries it on both filtered-range probes, reported on the referrer |
| `dmv.empty.link.peer.target` | peer-map reference needs explicit link text | n/a — the corpus-3 report produced no incident for the peer xref without text, the one with text, or the local edge, so no shape has been observed to implement; see the batch 2 run below |

## Conref / conkeyref / reuse

| Problem ID | Oxygen reports | Extension status |
| --- | --- | --- |
| `dmv.id.miss.conref` | conref missing the `#id` part | ok (`invalid-conref-form`) — the corpus-3 report carries it on `topics/e-id-miss-conref-pos.dita`; a conref that names a whole topic is `dmv.invalid.class.generalization` instead |
| `dmv.conref.proper.order` | `conref` comes after `conrefend` | ok (`invalid-conref-form`) — the report also uses it for the two one-element edges, where neither end precedes the other |
| `dmv.conref.siblings` | `conref`/`conrefend` are not siblings | ok (`invalid-conref-form`) — the report also uses it for a range that crosses two topics of one file |
| `dmv.conrefend.confl.conref` | `conrefend` targets a different topic than `conref` | ok (`invalid-conref-form`) — the report carries it only on the empty-`@conref` edge, so the file comparison, not the topic comparison, is what it checks |
| `dmv.conrefend.no.conref` | `conrefend` without `conref` | ok (`invalid-conref-form`) — the corpus-3 report carries it on `topics/e-conrefend-no-conref-pos.dita` |
| `dmv.ref.filtered.conref` | conref target is dropped by content-ref processing | ok (`filtered-reference`) — warning; the corpus-4 report has it for a link into the content an enclosing `@conref` replaces, and nothing for a link at the `@conref` element itself |
| `dmv.conkeyref.peer.map` | conkeyref into a peer map | ok (`undefined-key`) — mapped only: the report files it as `dmv.key.undef`, because a peer map is not part of this build's key space (the probe sets no keyscope) |
| `dmv.no.conref.has.target.attr.value` | non-conref element carries a conref-target attribute | ok (`invalid-conref-form`) — warning; the corpus-3 report carries it on `topics/e-target-attr-pos.dita` |
| `dmv.not.used.reusable.component` | reusable element never conref'd | ok (`unreferenced-reusable`) |

## Keys

| Problem ID | Oxygen reports | Extension status |
| --- | --- | --- |
| `dmv.undef.key` | keyref cannot be mapped to a target topic | ok (`undefined-key`) |
| `duplicate.key.definition` | the same key is defined twice | ok (`duplicate-key`) |
| `dmv.not.used.key.defs` | key defined but never referenced | ok (`unreferenced-key`) |
| `dmv.circular.keyref` | circular key reference | n/a — the corpus-3 report produced no incident for the two-key loop, the self-redirect or the linear chain; the extension does not follow redirect chains and stays silent on the same probes, including the chain's link use |
| `dmv.no.link.keyref` | target key definition has no reference | ok (`link-key-without-target`) — the corpus-3 report carries it on the xref and the `link` element probes; the seven corpus-2 incidents now match too |
| `dmv.invalid.keyref.syntax.1` | keyref has more than one `/` | ok (`invalid-key-syntax`) — the report carries the family as `dmv.invalid.keyref.syntax`, without the suffix |
| `dmv.invalid.keyref.syntax.2` | invalid character in a keyref | n/a — the corpus-2 report produced no incident for it; the extension checks only `/` and whitespace |
| `dmv.invalid.keyref.syntax.3` | keyref contains whitespace | ok (`invalid-key-syntax`) — the report carries the family as `dmv.invalid.keyref.syntax`, without the suffix |

## Duplicates

| Problem ID | Oxygen reports | Extension status |
| --- | --- | --- |
| `dmv.dup.topic` | the same topic referenced more than once | ok (`multiple-reference`) |
| `dmv.dup.topic.id` | duplicate topic ID in the map context | ok (`duplicate-id`) — the extension reports every topic that shares the id, as Oxygen does |
| `dmv.dup.el.id` | duplicate element ID inside one topic | ok (`duplicate-element-id`) — the corpus-3 report carries it on `topics/h-dup-el-id-pos.dita` |
| `dmv.dup.cond.filter` | duplicate condition in a filter file | ok (`duplicate-filter-condition`) — the corpus-4 report carries its two incidents **without** a `<problemID>`, so parity maps them on the message wording |

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
| `dmv.prof.attr.empty.value` | profiling attribute has an empty value | ok (`empty-profiling-value`) — warning; the corpus-4 report fires it on `audience=""`, `audience="   "` and `platform=""`, but not on the empty group `props="audience()"` |
| `dmv.prof.attr.val.prefs.confl` | multi-value attribute defined as single-value | ok (`profiling-preference`) — the corpus-4 report files `platform="linux windows"` here, not as an empty value |
| `dmv.prof.group.val.prefs.undef` | group value not defined in profiling preferences | ok (`profiling-preference`) — the corpus-4 report names the group text (`audience()`) for an empty group and the member value otherwise |
| `dmv.prof.sbj.attr.mult.val.confl` | multi-value attribute single-valued in the subject scheme | n/a — no run of the corpus-4 probes made Oxygen evaluate a subject scheme, so no shape has been observed; see the batch 3 run below |
| `dmv.prof.sbj.attr.val.rej` | value rejected by the subject scheme | n/a — same run, no incident on any of the four scheme spellings |
| `dmv.prof.sbj.attr.val.rej.all` | subject scheme rejects every value of an attribute | n/a — same run, no incident on any of the four scheme spellings |

## DITA structure, class and domains

| Problem ID | Oxygen reports | Extension status |
| --- | --- | --- |
| `dmv.invalid.class.format` | malformed `@class` | gap |
| `dmv.invalid.class.generalization` | `@class` is not a generalization | gap — also the id the corpus-3 report used for a `conref` that names a whole topic (batch 4 checks classes) |
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

### The batch 2 run (third corpus)

*Validate and Check for Completeness* over `../completeness-corpus-3/corpus.ditamap` — that
map as the only open root map, every option on, remote off — produced **30 incidents**
(`../completeness-corpus-3/oxygen-report.xml`). The report says
`Keys are gathered from: corpus.ditamap`, and the control `topics/control-missing.dita`
(line 11 of the map) is present, so it is a run of this map. `scripts/oxygen-diff.cjs`
reports **27 extension findings, 30 incidents, 27 matched, 0 extension-only, 3 Oxygen-only**;
`oxygen-parity.expected.json` locks that. The 18 batch-2 ids:

| Group | Oxygen ids seen | Extension |
| --- | --- | --- |
| E conref shape | `dmv.id.miss.conref`, `dmv.conref.siblings`, `dmv.conref.proper.order`, `dmv.conrefend.no.conref`, `dmv.conrefend.confl.conref`, `dmv.no.conref.has.target.attr.value` | `invalid-conref-form` (R037-R042) |
| E key in a peer map | `dmv.key.undef` | `undefined-key` — a peer map is not crawled, so the key is undefined without a keyscope |
| F id references | `dmv.invalid.ref.id.path` for all five probes, `dmv.bad.id.ref` | `invalid-id-reference` (R043-R045) |
| F topicref | `dmv.topicref.to.element` | `topicref-to-element` (R046) |
| G link through a key | `dmv.no.link.keyref` | `link-key-without-target` (R047) |
| G link without target | `dmv.link.no.target` | `link-no-target` (R048) |
| G resource-only | `dmv.ref.to.resource.only` | `resource-only-target` (R049) — also on the two key-element boundaries, whose key target is resource-only |
| H element ids | `dmv.dup.el.id` | `duplicate-element-id` (R050) |

The report does not always use the id the catalog suggests; the mapping still works because
parity is by category:

- `dmv.invalid.ref.id` and `dmv.invalid.ref.id.path.keyref.elemid` both appear as
  `dmv.invalid.ref.id.path`, so neither has an incident of its own.
- `dmv.conkeyref.peer.map` appears as `dmv.key.undef`.
- A one-element range is `dmv.conref.proper.order` on both edge probes, not `dmv.conref.siblings`.
- A range across two topics of one file is `dmv.conref.siblings`, not `dmv.conrefend.confl.conref`.
- `dmv.conrefend.confl.conref` fires on `conref=""` and nowhere else in this corpus.

Three rows stay Oxygen-only:

| Oxygen-only row | Report evidence | Handling |
| --- | --- | --- |
| `topics/e-conrefend-no-conref-edge.dita` `oxygen:unknown` | "Empty reference value." — no `problemID` in the raw report | **Understood.** The same element also carries `dmv.conrefend.confl.conref`, which matches as `invalid-conref-form`; the id-less row names no category to map. The extension reports the element once, not twice. |
| `topics/e-id-miss-conref-edge.dita` `dmv.invalid.class.generalization` | the `<p>` conref names a whole topic (`lib.dita#lib`) | **Batch 4.** Oxygen calls that an element-class mismatch; the extension reports only a conref with no `#` at all (`e-id-miss-conref-pos.dita`). Whole-topic conref stays the documented boundary of `dmv.id.miss.conref`. |
| `topics/f-bad-id-ref-empty-topic.dita` `oxygen:unknown` | "Invalid anchor `lib.dita#/p1`." — no `problemID` | **Understood.** The empty topic segment is the one `dmv.bad.id.ref` shape the catalog does not id; the trailing-slash probe matches on `f-bad-id-ref-pos.dita`. A finding for the empty segment would be extension-only. |

Two ids are *n/a* after this run: `dmv.circular.keyref` (no incident on the loop,
self-redirect or linear-chain probes) and `dmv.empty.link.peer.target` (no incident on the
peer-without-text, peer-with-text or local probes). In both cases the extension stays silent
on the same files, so the divergence is unprobed behaviour, not a known difference.

### The batch 3 run (fourth corpus)

*Validate and Check for Completeness* over `../completeness-corpus-4/corpus.ditamap` — that
map as the only open root map, every option on, remote off, the corpus's own
`filters/probe.ditaval` chosen in the dialog, and the Profiling/Conditional Text page filled
in — produced **19 incidents** (`../completeness-corpus-4/oxygen-report.xml`).
`scripts/oxygen-diff.cjs` reports **19 extension findings, 19 incidents, 13 signatures
matched, 1 extension-only, 2 Oxygen-only**; `oxygen-parity.expected.json` locks that. The
nine batch-3 ids:

| Group | Oxygen ids seen | Extension |
| --- | --- | --- |
| I empty values | `dmv.prof.attr.empty.value` ×3 (`i-prof-empty-pos`, `-edge`, `i-prof-single-edge`) | `empty-profiling-value` (R051) — warning, and whitespace counts as empty |
| I grouped values | `dmv.prof.group.val.prefs.undef` ×3 (`i-prof-empty-edge`, `i-prof-group-pos`, `i-prof-group-edge`) | `profiling-preference` (R052) — an empty group is compared as its group text, a group with members by those members |
| I single-value clash | `dmv.prof.attr.val.prefs.confl` (`i-prof-single-pos`) | `profiling-preference` (R015, which this report confirms) — the extension already had the multi-value-vs-preference finding |
| K filtered target | `dmv.ref.filtered` ×2 (`k-conref-filtered-pos`, `-edge`) | `filtered-reference` (R053) — error on the referrer, one per named end of a range |
| K replaced content | `dmv.ref.filtered.conref` (`k-conref-ignored-pos`) | `filtered-reference` (R054) — warning; a link at the `@conref` element itself is not a finding |
| K filter file | *no* `problemID`, description "Duplicate condition in filter file …" ×2 (`filters/probe.ditaval`) | `duplicate-filter-condition` (R055) — error on the filter file, one per repeated condition |
| J subject scheme | none | *n/a* — see below |

What the run settled, beyond which id fires where:

- **A filter file is not a DITA file, and Oxygen still reports on it.** Both incidents land
  on `filters/probe.ditaval` at the line of the repeated `<prop>`, one per duplicate, and the
  engine leaves `<problemID>` out — the only id-less rows in a report that parity has to map
  by wording (`DESCRIPTION_CATEGORY` in `src/test/editor/oxygenReport.ts`).
- **A filtered element is not a missing one.** Before batch 3 the extension reported a conref
  at a filtered-out element as `invalid-id-reference`, because pruning removes the id from the
  crawled tree; `idReferenceIssues` now defers to the filtered finding for exactly that case.
- **The subject scheme never loads.** Five runs (`../completeness-corpus-4/README.md`) tried
  all four spellings that register a scheme, including making the root map the scheme itself.
  Every one left the three `dmv.prof.sbj.*` ids silent and reported the probes' `subjectdef`
  keys as `dmv.key.undef`, so the group is recorded *n/a* rather than implemented against a
  guess. (Root-as-scheme also added unrelated incidents to files that are controls, which is
  why the corpus went back to the plain map root.)
- **Three new categories, not four.** `BATCH-3.md` proposed a `subject-scheme-violation`
  category for the J group on top of the three that landed here. With no observed incident to
  give it a shape, a severity or a finding site, the category is left out of
  `ISSUE_CATEGORIES` — an unreachable picker-less category is dead code, and the J group is
  recorded *n/a* above instead.

Two rows stay Oxygen-only, and one extension-only row is the same scheme story:

| Row | Report evidence | Handling |
| --- | --- | --- |
| `topics/k-conref-target-edge.dita` `unreferenced-reusable` | `dmv.not.used.reusable.component` on a range end the filter excludes | **Documented difference.** The plain conref at an excluded element (`k-conref-filtered-pos`) produces no such incident, so the two probes give no rule that explains why one unreferenced target counts and the other does not. `unreferencedReusable` keeps its existing rule. |
| `maps/j-scheme.ditamap` `undefined-key` | `dmv.key.undef` ×4 on the scheme's `subjectdef` keys | **Documented difference.** A `subjectdef` defines a key per the DITA 1.3 syntax, so Oxygen's four are its refusal to load the scheme; the extension reads the file as a map and reports the leaf subjects as defined-but-unused. |
| `maps/j-scheme.ditamap` `unreferenced-key` | — | The other half of the same row above: the extension's five `unreferenced-key` findings where Oxygen produced none, because it never reached the scheme's contents. |

## How to use this

1. Implement a check, pick the `dmv.*` ID it corresponds to, and add it to
   `PROBLEM_ID_CATEGORY` in `src/test/editor/oxygenReport.ts`.
2. Add a probe to `corpus.ditamap` (or to a topic) and lock the finding in
   `baseline.extension.json` via `npm run check:completeness -- --update`.
3. Keep the **Status** column honest: move a row from *gap* to *ok* only when the
   corpus proves it.
