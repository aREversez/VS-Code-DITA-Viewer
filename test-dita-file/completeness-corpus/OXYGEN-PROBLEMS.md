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
- **gap** — Oxygen reports it; the extension does not. No row is *gap* after batch 4;
  the scope note under the structure table says which family stays outside the table's reach
  on purpose.
- **n/a** — the extension deliberately diverges (documented below), or Oxygen reports nothing
  for the probes and the extension is silent too, so there is nothing to match (the row says
  which of the two it is).

Descriptions are paraphrases; the exact wording legitimately differs and is
ignored by the `(file, category)` diff.

Eighteen of the 75 *ok* rows say **mapped only**: the check exists and the id is mapped in
`PROBLEM_ID_CATEGORY`, but no incident of that exact id has ever been seen in the six reports.
The reason comes in three shapes. Five rows are a spelling difference: a live report emits
`dmv.key.undef` where the catalog lists `dmv.undef.key`, `dmv.invalid.keyref.syntax` where it
lists the `.1` and `.3` variants, and the Xerces `IDInvalidWithNamespaces` where it lists
`dmv.invalid.id.syntax.2` and `.3`; `PROBLEM_ID_CATEGORY` answers the observed spelling beside
the catalog one. One row, `dmv.dup.cond.filter`, is an incident no report gives a `problemID` to,
so parity matches it on wording. The other twelve are the finding arriving under a different
catalog id (`dmv.file.not.found` for a dangling reference the catalog calls
`dmv.reference.not.exist`) or not arriving for these probes at all — no corpus writes a
`<reltable>`, and this Oxygen defines the attributes the profiling probes use.

Twenty-one incidents across the six reports carry no `problemID` at all: the five "There is no
schema or DTD associated with the document" errors (three in corpus 2, two in corpus 5), the
twelve HTML-validator messages on corpus 2's `.html` resources, the two duplicate filter
conditions of corpus 4, and two of corpus 3 (`Empty reference value`, `Invalid anchor`). The
sanitizer writes no such element for them and `oxygen-diff` prints them as `(no id)`.

## Files, hrefs and reference hygiene

| Problem ID | Oxygen reports | Extension status |
| --- | --- | --- |
| `dmv.file.not.found` | a referenced file does not exist | ok (`missing-reference`) — 19 incidents across the six reports, including (corpus 3, R019) a `@conref` at an absent file and, for the `@conkeyref` that reaches such a key, both the broken keydef and the referring element, which the extension reports the same way |
| `dmv.reference.not.exist` | a reference cannot be resolved | ok (`missing-reference`) — mapped only: no report carries this id, every dangling reference arriving as `dmv.file.not.found`. The corpus-3 probes added for R019 put a `@conref` at an absent file and a `@conkeyref` through a key whose file is absent, and their run also filed both as `dmv.file.not.found`, so the catalog id stays unobserved (a `@conref` whose topic id or element id does not resolve is `dmv.id.miss.conref` or `dmv.invalid.ref.id.path`) |
| `dmv.invalid.DITA.reference` | reference is invalid DITA | n/a — no incident in six runs: the batch-4 probe (`maps/m-dita-ref-pos.ditamap`, `format="dita"` on a well-formed non-DITA XML file) drew `dmv.ref.res.as.dita`, and the non-XML boundary drew `dmv.invalid.parse.dita.content`; the extension answers both probes as `format-mismatch` / `dita-parse`, so an equivalent exists but no incident of this id |
| `dmv.invalid.DITA.uri.target` | URI does not resolve to a DITA target | n/a — same run: the three `maps/m-uri-target-*.ditamap` probes produced `dmv.topicref.remote.no.external.scope` and, on the no-`@scope` edge, `dmv.invalid.parse.dita.content`, never this id; the extension answers `external-reference` there |
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
| `dmv.ref.type.class.mismatch` | `@type` does not match the target's class | ok (`type-class-mismatch`) — the corpus-5 report carries it on `topics/l-ref-type-mismatch-pos.dita` and on the map `topicref` probe |
| `dmv.ref.type.class.mismatch.specific` | `@type` less specific than the target's class | ok (`type-class-specific`) — the corpus-5 report carries it on `topics/l-ref-type-specific-pos.dita` |
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
| `dmv.ref.to.resource.only` | cross-reference to a resource-only topic breaks | ok (`resource-only-target`) — the corpus-3 report carries it for a direct xref and for the two key-element boundaries, and the corpus-6 report for the three xrefs into the topic the map publishes only through a `<keydef>`: DITA makes a keydef resource-only unless it says otherwise, so a keydef publication counts (R049) |
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
| `dmv.undef.key` | keyref cannot be mapped to a target topic | ok (`undefined-key`) — mapped only: the live reports spell this finding `dmv.key.undef` (eight incidents, corpora 1, 3, 4 and 6), which is mapped beside this catalog form that no report carries |
| `duplicate.key.definition` | the same key is defined twice | ok (`duplicate-key`) |
| `dmv.not.used.key.defs` | key defined but never referenced | ok (`unreferenced-key`) — the corpus-3 rerun also fires it on a key whose target file is missing (`maps/e-conref-missing-key.ditamap`) although the conkeyref names that key: Oxygen counts a definition it cannot use, the extension counts the use |
| `dmv.circular.keyref` | circular key reference | n/a — the corpus-3 report produced no incident for the two-key loop, the self-redirect or the linear chain; the extension does not follow redirect chains and stays silent on the same probes, including the chain's link use |
| `dmv.no.link.keyref` | target key definition has no reference | ok (`link-key-without-target`) — the corpus-3 report carries it on the xref and the `link` element probes; the seven corpus-2 incidents now match too |
| `dmv.invalid.keyref.syntax.1` | keyref has more than one `/` | ok (`invalid-key-syntax`) — mapped only: the report carries the family as `dmv.invalid.keyref.syntax`, without the suffix, so no incident carries this id |
| `dmv.invalid.keyref.syntax.2` | invalid character in a keyref | n/a — the corpus-2 report produced no incident for it; the extension checks only `/` and whitespace |
| `dmv.invalid.keyref.syntax.3` | keyref contains whitespace | ok (`invalid-key-syntax`) — mapped only: the report carries the family as `dmv.invalid.keyref.syntax`, without the suffix, so no incident carries this id |

## Duplicates

| Problem ID | Oxygen reports | Extension status |
| --- | --- | --- |
| `dmv.dup.topic` | the same topic referenced more than once | ok (`multiple-reference`) — six incidents in the corpus-1 report, and corpus 6's six duplicate probes settled the counting: Oxygen files it per (target, scope chain), so a container changes nothing and only a reference in a different `keyscope` is no duplicate (R008); matched in both corpora |
| `dmv.dup.topic.id` | duplicate topic ID in the map context | ok (`duplicate-id`) — the extension reports every topic that shares the id, as Oxygen does |
| `dmv.dup.el.id` | duplicate element ID inside one topic | ok (`duplicate-element-id`) — the corpus-3 report carries it on `topics/h-dup-el-id-pos.dita` |
| `dmv.dup.cond.filter` | duplicate condition in a filter file | ok (`duplicate-filter-condition`) — mapped only: the corpus-4 report carries its two incidents **without** a `<problemID>`, so no incident carries this id and parity maps them on the message wording |

## Unreferenced / not in map

| Problem ID | Oxygen reports | Extension status |
| --- | --- | --- |
| `dmv.not.topic.ref.in.map` | topic referenced elsewhere but not in the map | ok (`unreferenced-link`) |
| `dmv.not.topic.ref.reltable.in.map` | topic referenced in a reltable but not in the map | ok (`unreferenced-link`) — mapped only: no report carries this id, because no corpus writes a `<reltable>` at all; the family arrives as `dmv.not.topic.ref.in.map` |

## Profiling

| Problem ID | Oxygen reports | Extension status |
| --- | --- | --- |
| `dmv.prof.attr.innef.cond` | attribute value can never show (ancestor conditions) | ok (`profiling-conflict`) |
| `dmv.prof.attr.group.innef.cond` | condition group can never show | ok (`profiling-conflict`) — mapped only: no report carries this id; the three conflicts corpus 1 files are the attribute form `dmv.prof.attr.innef.cond`, and no probe puts a whole condition group out of reach |
| `dmv.prof.attr.prefs.undef` | attribute not defined in profiling preferences | ok (`profiling-preference`) — mapped only: no report carries this id, because this Oxygen defines the attributes the probes use; only the value-level forms fire (`dmv.prof.attr.val.prefs.undef`, `dmv.prof.group.val.prefs.undef`) |
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
| `dmv.invalid.class.format` | malformed `@class` | ok (`class-format`) — the corpus-5 report carries all four message forms (not specified, no leading `-`/`+`, empty, no trailing space); a written value is checked as written, so a copy of the DTD default that lacks its trailing space is reported too; the two probes that declare a RELAX NG or XML Schema grammar instead of a DOCTYPE are not reported for an unwritten class (R065) |
| `dmv.invalid.class.generalization` | `@class` is not a generalization | ok (`conref-class`) — the corpus-5 report files four conref pairs here: unrelated classes, a more specific source (`step`→`li`), and both specialization directions; a source on the general end is not filed, which is the `source-general` probe of R064, silent in the same report; the id also covers the `conref` that names a whole topic (corpus 3) |
| `dmv.invalid.class.specialization` | `@class` is not a specialization | n/a — Oxygen never emitted it: the `l-class-specialization-{pos,neg}` probes are both `dmv.invalid.class.generalization`, and the id appears in none of the six reports; the mapped category answers both directions |
| `dmv.invalid.domains.format` | `@domains` missing/malformed | ok (`domains-format`) — the corpus-5 report carries it on the empty-`@domains` edge only; an absent `@domains` is not a finding, and the DOCTYPE-less probe drew the schema differences instead |
| `dmv.invalid.id.syntax.2` | invalid character in an ID | ok (`invalid-id-syntax`) — mapped only: the corpus-2 report files both probes as `IDInvalidWithNamespaces`, so no incident carries this id |
| `dmv.invalid.id.syntax.3` | ID contains whitespace | ok (`invalid-id-syntax`) — mapped only: `IDInvalidWithNamespaces` in the corpus-2 report, so no incident carries this id |
| `dmv.invalid.parse.dita.content` | problem parsing DITA content | ok (`dita-parse`) — reported on the map that references the broken file, which is Oxygen's own attribution (corpus 1 and corpus 5); the only row left Oxygen-only is a remote target, which the extension never fetches |
| `dmv.section.first.title` | `<section>` title is not the first element | ok (`section-title-order`) — the corpus-5 report carries it on the positive probe; a section nested in a section is not checked, because the DTD rejects the nesting before the order matters |
| `dmv.section.no.dup.title` | `<section>` has more than one title | ok (`section-title-duplicate`) — the corpus-5 report carries it on the positive probe; every title after the first is its own finding |

### Outside the table on purpose: schema validation

No row above is a gap any more. What stays out of reach is the DTD validation family, and that
is a maintenance decision, not unfinished work (`BATCH-4.md`, option 3):

- **Not covered:** whether elements and attributes are declared, and whether an element may
  appear where it does (content model). Oxygen answers those from the DTD it associates with
  the file and, with none, with Xerces' own statements. The three `MSG_*` ids carry no `dmv.*`
  id at all, so they can only be matched by wording, and a DTD-less answer would either miss a
  specialization or call it undeclared.
- **Kept instead of shipping a 1.7 MB DTD subset and a validating parser.** The three ids and
  the no-schema text are listed in `ACCEPTED_PROBLEM_IDS` / `ACCEPTED_DESCRIPTIONS`
  (`src/test/editor/oxygenReport.ts`), so `scripts/oxygen-diff.cjs` prints them as "accepted
  differences" and leaves them out of both the diff and the exit code (6 in the corpus-5
  report, 3 in corpus 1, 3 in corpus 2).
- **If it is ever wanted,** start from option 1 of `BATCH-4.md` (element and attribute
  declarations only) and gate it on a known OASIS DOCTYPE. Without that gate a custom
  specialization is reported as an undeclared element, which is the false positive the class
  table avoids today. Content models need option 2 and its cost.
- **Where schema validation belongs now:** a VS Code XML language server that knows DTDs and
  catalogs, running beside this extension, not inside it (the README says so).

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

1. `topics/invalid.dita` — well-formed but schema-invalid. Its three `MSG_*` incidents are the
   accepted schema differences of the scope note above; the remaining
   `dmv.invalid.class.format` sits on `<notanelement>`, an element no DTD declares, so the class
   table has no entry for it and the rule skips it. The extension is silent there and Oxygen is
   not, deliberately — the same boundary as `l-class-format-pos-undeclared.dita` below.
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

- `dmv.invalid.class.format` **was a gap at that run** — the extension emitted nothing for a
  missing/malformed `@class`, and the 29 map-level incidents were the missing-DTD default seen
  by the map's own parse. Batch 4 implements it (`class-format`): the DOCTYPE-less corpus-5
  probe reproduces four of those incidents per file, `m-not-dita.xml` adds two, and the one
  left on `topics/invalid.dita` is an undeclared element the class table skips by design.
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
**15 matched, 4 extension-only, 5 Oxygen-only**; every row of that set has since been resolved
or explained, and the second run below added the R023-R025 probes. What the file locks today is
**22 matched, 2 extension-only, 1 Oxygen-only**: batch 4 turned the map-level parse incident into
a match (R063), and the row left is the undeclared element of `topics/invalid.dita`, an accepted
scope boundary. An earlier run had 7 Oxygen-only
rows; once `outside.dita` carried a DOCTYPE and the report was regenerated, its
two stale rows matched and the lone `oxygen:unknown` id disappeared. Every
Oxygen-only row this corpus produced, and how it is handled:

| Oxygen-only row | Report evidence | Handling |
| --- | --- | --- |
| `resources.dita` `missing-reference` | `dmv.file.not.found` ×2 (lines 7, 8) | **Matched by category equivalence.** Oxygen has no resource/reference split, so the same dangling href is its `missing-reference` and the extension's `missing-resource`. `CATEGORY_EQUIVALENCES` (`completenessHarness.ts`) folds the two in the parity signature only — the extension UI keeps the distinction. Locked by `oxygenParity.test.ts`. |
| `twoidsa.dita` `duplicate-id` | `dmv.dup.topic.id` (line 3) | **Fixed.** `mapChecks` used to report one participant of a duplicate group; it now flags every topic that shares the id (as Oxygen does), each related to the others. |
| ~~`outside.dita` no-schema (`oxygen:unknown`) + `dmv.invalid.class.format`~~ | *(gone on re-run)* | **Resolved.** With the DOCTYPE in place the regenerated report carries neither row; `outside.dita` now matches on `outside-folder` and `unreferenced-link`, and the `oxygen:unknown` id is no longer present. |
| `corpus.ditamap` `dmv.invalid.parse.dita.content` | line 64, message names `topics/malformed.dita` | **Implemented — now matched (R063).** Batch 4 reports a reference to unparsable DITA on the referring element, so the map-level incident and `dita-parse` line up; the broken file keeps its own `validation` finding, which stays one extension-only signature. |
| `linker2.dita` `dmv.invalid.ref.topic.id` ×2 | referenced topic ID not found (lines 9, 10) | **Implemented — now matched.** New `invalid-ref-topic-id` check (`mapChecks`) fires when a `@conref` resolves to a file that exists but its topic-id segment (the part after `#`) names no topic in it. Ledger R020. |
| `ok.dita` `unreferenced-reusable` | `dmv.not.used.reusable.component` (line 6) | **Implemented — now matched.** `unreferencedReusable` is now strict: a broken conref (its topic id does not resolve, R020) no longer counts as consuming its target, so `ok.dita`'s `p#used` (and `reuse.dita`'s `p#shared`) stay unreferenced, as Oxygen reports. |
| `invalid.dita` `MSG_*` ×3 + `dmv.invalid.class.format` | schema/DTD + malformed `@class` | **Accepted difference (option 3) plus the table boundary.** The three `MSG_*` are the schema differences of the scope note; the `class-format` row sits on `<notanelement>`, which no DTD declares, so the class table has no entry and the rule skips it — the same row as `l-class-format-pos-undeclared.dita` in corpus 5. |

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
With the alignment below, `oxygen-parity.expected.json` locked **21 matched, 2 extension-only,
5 Oxygen-only** at that run. It now holds **22 matched, 2 extension-only, 1 Oxygen-only**
(`scripts/oxygen-diff.cjs` agrees: `signatures matched: 22`), because batch 4 matches the
map-level parse incident and the one row left is the accepted scope boundary above. The fourth
extension-only row of the first run is the R022 probe the latest report confirmed Oxygen-silent
(see the profiling note below).

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
map as the only open root map, every option on, remote off — produced **30 incidents** on its
first run. The report says `Keys are gathered from: corpus.ditamap`, and the control
`topics/control-missing.dita` (line 11 of the map) is present, so it is a run of this map.
`scripts/oxygen-diff.cjs` reported **27 extension findings, 30 incidents, 27 matched,
0 extension-only, 3 Oxygen-only** there. The map was then rerun for the two R019 probes of a
conref and a conkeyref to a file that does not exist; that run, the one committed as
`../completeness-corpus-3/oxygen-report.xml`, produced **34 incidents** and
**30 extension findings, 34 incidents, 30 matched, 0 extension-only, 4 Oxygen-only**, which
`oxygen-parity.expected.json` locks. The 18 batch-2 ids:

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
- A conref or conkeyref to a file that does not exist is `dmv.file.not.found`, the id of an
  ordinary dangling reference: the rerun's three new incidents, so R019's catalog id
  `dmv.reference.not.exist` is still unobserved.

Four rows stay Oxygen-only:

| Oxygen-only row | Report evidence | Handling |
| --- | --- | --- |
| `topics/e-conrefend-no-conref-edge.dita` `oxygen:unknown` | "Empty reference value." — no `problemID` in the raw report | **Understood.** The same element also carries `dmv.conrefend.confl.conref`, which matches as `invalid-conref-form`; the id-less row names no category to map. The extension reports the element once, not twice. |
| `topics/e-id-miss-conref-edge.dita` `dmv.invalid.class.generalization` | the `<p>` conref names a whole topic (`lib.dita#lib`) | **Batch 4.** Oxygen calls that an element-class mismatch; the extension reports only a conref with no `#` at all (`e-id-miss-conref-pos.dita`). Whole-topic conref stays the documented boundary of `dmv.id.miss.conref`. |
| `topics/f-bad-id-ref-empty-topic.dita` `oxygen:unknown` | "Invalid anchor `lib.dita#/p1`." — no `problemID` | **Understood.** The empty topic segment is the one `dmv.bad.id.ref` shape the catalog does not id; the trailing-slash probe matches on `f-bad-id-ref-pos.dita`. A finding for the empty segment would be extension-only. |
| `maps/e-conref-missing-key.ditamap` `unreferenced-key` | `dmv.not.used.key.defs` at line 7 for `k-conref-missing-file`, whose `@href` names an absent file | **Documented difference.** The conkeyref `k-conref-missing-file/x` names the key, so the extension counts it as used; Oxygen treats a definition with no retrievable target as nothing usable and reports it as unreferenced. The extension keeps its reading. |

One difference closed after the rerun: a `@conkeyref` whose key names an absent file is now
reported at both ends. A content reference never becomes a `Reference` in the crawl, so the file
its key resolves to is recorded on its own (`conkeyrefTargets`) and probed like any other
reference; the finding lands on the keydef, where the href is written, and on the element that
reaches it, which is where the report puts its second incident. That is why the count above is
30 extension findings with four rows Oxygen-only.

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
- **The subject scheme never loads.** Five corpus-4 runs (`../completeness-corpus-4/README.md`)
  tried all four spellings that register a scheme, including making the root map the scheme itself.
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

### The batch 4 run (fifth corpus)

*Validate and Check for Completeness* over `../completeness-corpus-5/corpus.ditamap` — that
map as the only open root map, every option on, remote off, Oxygen XML Editor 27.1 — produced
**34 incidents** (`../completeness-corpus-5/oxygen-report.xml`). The report has been rerun twice
since, once for the `source-general` probe of R064 and once for the two grammar probes of R065:
every one of those three files stays out of it, the count never moved, and the only line that
ever changed is the `corpus.ditamap` reference below, now at 42. Six of the incidents are accepted
schema differences, so parity compares 28 and locks **21 matched, 6 extension-only, 3
Oxygen-only** (`scripts/oxygen-diff.cjs` agrees).
The eleven batch-4 ids, grouped as their `RULES.md` rows group them:

| Group | Oxygen ids seen | Extension | Where the report puts it |
| --- | --- | --- | --- |
| L class format | `dmv.invalid.class.format` ×11 | `class-format` (R056) | all four message forms: the DOCTYPE-less `l-domains-format-pos.dita` (lines 1, 6, 7, 8), `m-not-dita.xml` (1, 7), and the badvalue / empty / no-trailing-space edges |
| L conref class | `dmv.invalid.class.generalization` ×4 | `conref-class` (R058) | `p`→`ul`, `step`→`li` (a more specific source), `step`→`substep`, `substep`→`step`; `.specialization` never fires, and the general-source probe draws nothing (R064) |
| L `@type` | `dmv.ref.type.class.mismatch` ×2, `.specific` ×1 | `type-class-mismatch` / `type-class-specific` (R059/R060) | the xref probe, the map `topicref` probe, and `type="topic"` against a task |
| L `@domains` | `dmv.invalid.domains.format` ×1 | `domains-format` (R057) | the empty-`@domains` edge only |
| M DITA reference | `dmv.ref.res.as.dita` ×2 | `format-mismatch` | `maps/m-dita-ref-pos.ditamap:9` matched; `corpus.ditamap:42` stays Oxygen-only (below) |
| M URI target | `dmv.topicref.remote.no.external.scope`, `dmv.invalid.parse.dita.content` | `external-reference`, `dita-parse` | no `dmv.invalid.DITA.uri.target` anywhere in the report |
| N parse | `dmv.invalid.parse.dita.content` ×4 | `dita-parse` (R063) | three matched on the referring map, the remote edge Oxygen-only |
| N structure | `dmv.section.first.title`, `dmv.section.no.dup.title` | `section-title-order` / `section-title-duplicate` (R061/R062) | the two positive probes; the nested-section edges are silent on both sides |

What the run settled:

- **Oxygen decides "is this DITA" by the DOCTYPE, not by the root element.** `corpus.ditamap:42`
  references `topics/l-domains-format-pos.dita`, the probe that deliberately has no DOCTYPE to
  ask about `@domains`; Oxygen answers `dmv.ref.res.as.dita` ("not a DITA resource") for that
  reference, while the extension reads the root `<topic>` and says nothing. The probe's own
  `class-format` findings *are* matched (four of them), so the row is one Oxygen-only
  `format-mismatch` and a documented boundary, not a missing rule.
- **A written `@class` is checked as written.** The negative probe spells `class="- topic/p"`,
  exactly what the DTD would default, and still draws "At least one trailing space should be
  present" (`l-class-format-neg.dita:9`, `l-class-specialization-edge.dita:9`): Oxygen accepts
  the missing space from the DTD but not from the author, and the extension does the same.
- **A more specific source is reported, a source on the general end is not.** Oxygen files
  `l-class-generalization-edge.dita`, where a `step` draws in an `li`, as
  `dmv.invalid.class.generalization`; the `source-general` probe added after the first run — a
  `ph` drawing in a `uicontrol` — draws nothing at all. One category therefore serves every
  reported direction, and R064 records the one that is allowed (the id also carries the
  `conref`-names-a-topic shape of corpus 3).
- **A grammar other than a DOCTYPE supplies the class.** `l-class-format-rng-neg.dita` (an
  `xml-model` association to the DITA RELAX NG grammar) and `l-class-format-xsd-neg.dita` (a
  schema location on the root element) write no `@class` on any element and draw no incident — the
  eleven `dmv.invalid.class.format` incidents are the same eleven as before the two files were
  added. Skipping such a file stays this project's own decision (no validating parser is being
  shipped); what the run removes is the assumption about Oxygen, so R065 cites the report.
- **An undeclared element stays a schema question.** `l-class-format-pos-undeclared.dita` writes
  `<widget>`, which no DTD declares: Oxygen reports `dmv.invalid.class.format` (no class, because
  no DTD default) plus the two `MSG_*`, and the extension is silent because the element is
  outside the class table. That is the one Oxygen-only `class-format` row, and the same boundary
  as `topics/invalid.dita` in corpus 1.
- **Remote targets are not fetched.** `maps/m-uri-target-edge.ditamap:10` draws
  `dmv.invalid.parse.dita.content` in Oxygen (the URL cannot be read) and `external-reference`
  from the extension — one row each way, for the two reasons corpus 2 recorded.
- **The class table covers three vocabularies.** `src/parser/ditaClassDefaults.ts` is generated
  from the DITA-OT 1.3 DTDs of base, technicalContent and bookmap (333 topic entries, 49 map
  entries, queried per side because `title` and friends differ between them). `learning/`,
  `machineryIndustry/` and the foreign-namespace modules were not extracted, and no custom
  specialization is known: an element outside the table is skipped by every class-dependent
  rule rather than given a guessed class. `npm run check:dita-class` re-renders the module
  offline and fails when it and the committed `scripts/dita-class-extracted.json` disagree.

### The key scope run and the R008 probe run (sixth corpus)

*Validate and Check for Completeness* over `../completeness-corpus-6/corpus.ditamap` — the
same settings as the runs above — was run three times: once on the key scope probes alone
(**6 incidents**), once after the six duplicate probes of R008 joined the map (**14
incidents**), and once after four scope-shape probes and their positive control joined it
(**16 incidents**, `../completeness-corpus-6/oxygen-report.xml`). No run carried an accepted
difference, and the last one locks **11 matched, 0 extension-only, 0 Oxygen-only**
(`scripts/oxygen-diff.cjs` agrees) — the first corpus with parity in both directions.

What the runs settled:

- **A bare key is looked up in its key scope** (R066). `k-scoped` is defined inside
  `keyscope="s1"`, and the report files `dmv.key.undef` on the topic published outside that
  scope (`topics/o-scope-outside-pos.dita:7`) and on the topic published in both
  (`topics/o-scope-shared-edge.dita:7`, whose message names the scope that lacks it:
  `Key Scopes:[[s2]]`). The two negatives came back with no key finding: the topic published
  inside `s1`, and the qualified `s1.k-scoped` used from outside.
- **A keydef publishes its topic resource-only** (R049). All three negatives, plus the shared
  edge, draw `dmv.ref.to.resource.only`: the map reaches `topics/t-target.dita` only through
  the `<keydef>`, which DITA makes resource-only unless it says otherwise. The extension had
  read a publication only from a `topicref`, so this was a gap in the ordinary sense — Oxygen
  files it and we did not — and `resourceOnlyTargetIssues` now takes a keydef as a
  publication, with an explicit `processing-role="normal"` on the keydef still publishing
  normally.
- **A duplicate is counted per (target, scope chain), with the names in the order written**
  (R008). Eleven maps each reference one topic twice
  (`../completeness-corpus-6/maps/p-dup-*.ditamap`): Oxygen files `dmv.dup.topic` on both
  references when they are siblings, when both sit in one `topicgroup`, when they sit in two
  `topicgroup`s, when both sit inside one `keyscope="s1"`, and when both sit inside one
  `keyscope="s1"` at the very end of the map (the positive control `p-dup-k`, which is what
  proves the third run read the tail of `corpus.ditamap`). It files nothing when one sits in
  `s1` and the other in `s2`, when one sits at the root and the other in `s1`, when one sits in
  `s1` and the other in `s2` nested inside `s1`, when one sits in `keyscope="a b"` and the
  other in `keyscope="a"`, and when one sits in `"a b"` and the other in `"b a"`. A container
  is therefore no boundary, and a `keyscope` is no boundary either: only a *different* scope
  is. The last pair makes the comparison a list rather than a set — the same two names in
  another order are two scopes — which is *not* how R066 reads them, since key resolution only
  asks whether a name is in effect. The first run's one extension-only row — `corpus.ditamap`'s
  shared-edge pair, the same shape as the two silent probes — closed with the rule instead of
  staying a difference, and the third run's silence on `p-dup-j` closed the last one.

### All six corpora at a glance

| Corpus | Written for | Incidents | Accepted differences | Parity: matched / extension-only / Oxygen-only |
| --- | --- | --- | --- | --- |
| `completeness-corpus` | batches 1 and the R020-R025 follow-ups | 36 | 3 `MSG_*` | 22 / 2 / 1 |
| `completeness-corpus-2` | batch 2, reference and key forms | 108 | 3 no-schema | 70 / 6 / 17 |
| `completeness-corpus-3` | batch 2, conref / id / link forms | 34 | – | 30 / 0 / 4 |
| `completeness-corpus-4` | batch 3, profiling and filters | 19 | – | 13 / 1 / 2 |
| `completeness-corpus-5` | batch 4, class / DITA validity / structure | 34 | 6 (4 `MSG_*`, 2 no-schema) | 21 / 6 / 3 |
| `completeness-corpus-6` | key scopes (R066), the keydef half of R049, duplicates by scope (R008) | 16 | – | 11 / 0 / 0 |
| **Total** | | **247** | **12** | **167 / 15 / 27** |

The 15 extension-only and 27 Oxygen-only signatures are each accounted for in the batch sections
above or in the corpus README that owns them; the largest group is corpus 2's 17, whose three
rows per family are listed in `../completeness-corpus-2/README.md`. The table is current as of
the last run: corpus 5 has been validated twice since its first report, once for the R064 probe
and once for the two R065 probes, and no number in it moved; corpus 3 was rerun for the two
R019 probes of batch 2, which moved it from 30 incidents and 27 / 0 / 3 to 30 / 0 / 4, and once
more when the conkeyref site joined the reference passes, which left the report alone and moved
one row from Oxygen-only into the matched set. The sixth corpus now has no row in either
direction: its three first-run misses were fixed before its lock was written, the R008
probes turned its one extension-only row into a match, and its third run made the control's
row a match while the rule stopped filing `p-dup-j` — the ordered comparison its silence
called for. With the batch-4 run the 11 ids of that
batch were closed, and this one did not reopen any: 84 ids, **no gap left**. Eighteen of the 75
*ok* rows are *mapped only* — no incident of that exact id in any of the six reports — and each of
them says in its own row which id the reports carry instead, so the number is worth re-checking
after any new run.

## How to use this

1. Implement a check, pick the `dmv.*` ID it corresponds to, and add it to
   `PROBLEM_ID_CATEGORY` in `src/test/editor/oxygenReport.ts`.
2. Add a probe to `corpus.ditamap` (or to a topic) and lock the finding in
   `baseline.extension.json` via `npm run check:completeness -- --update`.
3. Keep the **Status** column honest: move a row from *gap* to *ok* only when the
   corpus proves it, and when Oxygen never carries an id, say that instead of marking it *ok*.
4. When an id is a deliberate difference, list it in `ACCEPTED_PROBLEM_IDS` (or
   `ACCEPTED_DESCRIPTIONS` for the id-less text) so `oxygen-diff` prints it as accepted and
   keeps the two counts apart.
