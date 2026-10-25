# Completeness corpus 5: class-dependent rules, DITA validity, structure

The fifth differential corpus, kept apart from the other four so each keeps its own line
numbers, baseline and parity lock. It has its own root map, `corpus.ditamap`, its own
`baseline.extension.json` and, once Oxygen has been run on it, its own `oxygen-report.xml`
and `oxygen-parity.expected.json`. The work plan is `../completeness-corpus/BATCH-4.md`.

## Why a corpus of its own

The rules of this batch read an element's `@class`. DITA 1.x gives it as a DTD default, and
every file here has a DOCTYPE, so Oxygen applies the default and sees the class the extension
has to take from its class table (`scripts/dita-class-extracted.json`, taken from the DITA-OT
DTDs). Keep the DOCTYPEs: a probe without one is a different question (a probe for that case
says so in its comment).

## Oxygen setup for this corpus

Nothing beyond the other corpora: the `audience` preferences of corpus 1, no filter. The run
recorded below was **Oxygen XML Editor 27.1**, `corpus.ditamap` as the only open root map, every
option on, remote off.

## Conventions

- **One rule per file.** Parity compares `(file, category)`, so two rules of one category in
  one file collapse into a single signature. A map-level probe goes into its own small map
  under `maps/`, referenced from `corpus.ditamap`.
- **One probe per file, named for the rule:** `topics/<group>-<id>-<pos|neg|edge>.dita`. A
  comment on the probe names the rule and its `RULES.md` row.
- **Positive, negative and boundary** for every rule.
- **Controls stay.** `topics/control-missing.dita` does not exist on purpose; a report without
  it was not a run of this map. A probe whose only expected report is something Oxygen may keep
  silent about needs a control Oxygen is known to report, so silence means Oxygen looked.
- **Several rules can hit one file.** An unparsable or non-DITA file draws a class finding
  and a parse finding together (corpus 2 showed this): list what each file is expected to
  raise, and write each rule's probes so the others are not mistaken for it.
- **Oxygen decides.** Where the specification does not settle a case, write the probe and let
  the next real report say what Oxygen does.
- **Root map:** `corpus.ditamap` of this folder as the only open root map
  (`Keys are gathered from:` in a report must name it).
- **Platform:** a probe whose result depends on the OS or the file system goes into
  `PLATFORM_DEPENDENT_FILES` (see corpus 2).

## Running it

```
node scripts/completeness-baseline.cjs --corpus completeness-corpus-5          # extension findings
node scripts/oxygen-diff.cjs --corpus completeness-corpus-5 <report.xml>        # against Oxygen
node scripts/sanitize-oxygen-report.cjs --corpus completeness-corpus-5 <raw.xml> # writes oxygen-report.xml here
```

`UPDATE_COMPLETENESS_BASELINE=1 npm test` and `UPDATE_OXYGEN_PARITY=1 npm test` refresh the
baseline and the parity lock; the parity test is skipped until `oxygen-report.xml` exists.

## What the corpus probes

The 11 Oxygen problem ids of batch 4 (`../completeness-corpus/BATCH-4.md`), one rule per
file, each with `pos` (must report), `neg` (must not) and `edge` (the boundary). None of the
rules is implemented when the probes were written, so this table is what each probe asks and
the run below records what Oxygen answered.

| Rule | Probes | What the probes hold |
| --- | --- | --- |
| `dmv.invalid.class.format` | `topics/l-class-format-{pos-undeclared,neg,edge-badvalue,edge-empty}.dita` | an element the DTD does not declare; declared elements only, one with the class written as the DTD defaults it; class without the scope prefix (`topic/p`); empty class |
| `dmv.invalid.class.generalization` | `topics/l-class-generalization-{pos,neg,edge}.dita` | `p` to `ul` (unrelated classes); `p` to `p`; `step` to `li` (the target is the general end of the source's own chain, so the source is the more specific one) |
| `dmv.invalid.class.specialization` | `topics/l-class-specialization-{pos,neg,edge}.dita` | `step` to `substep` (target more specific than source); `substep` to `step`; authored class spelled exactly as the default |
| `dmv.ref.type.class.mismatch` | `topics/l-ref-type-mismatch-{pos,neg}.dita`, `maps/l-ref-type-mismatch-map.ditamap` | `type="concept"` to a task; `type="task"` to a task; the same mismatch on a map `topicref` |
| `dmv.ref.type.class.mismatch.specific` | `topics/l-ref-type-specific-{pos,neg,edge}.dita` | `type="topic"` to a task; `type="topic"` to a topic; `type="concept"` to a concept |
| `dmv.invalid.domains.format` | `topics/l-domains-format-{pos,neg,edge}.dita` | no DOCTYPE at all; `@domains` from the DOCTYPE; `domains=""` |
| `dmv.invalid.DITA.reference` | `maps/m-dita-ref-{pos,neg,edge}.ditamap` | `format="dita"` on well-formed XML that is not DITA; on a DITA topic; on a plain text file |
| `dmv.invalid.DITA.uri.target` | `maps/m-uri-target-{pos,neg,edge}.ditamap` | `format="dita"` on a remote URI with `scope="external"`; on a local DITA topic; on a remote URI without `@scope` |
| `dmv.invalid.parse.dita.content` | `maps/n-parse-content-{pos,neg,edge}.ditamap` | a `topicref` to an unparsable topic; to a topic that parses; to an unparsable one through `@copy-to` |
| `dmv.section.first.title` | `topics/n-section-first-title-{pos,neg,edge}.dita` | title after a paragraph; title first; only the nested section out of order |
| `dmv.section.no.dup.title` | `topics/n-section-no-dup-title-{pos,neg,edge}.dita` | two titles in one section; one title; one title per nested section |

`topics/l-class-target-base.dita`, `topics/l-class-target-task.dita` and
`topics/l-class-target-ph.dita` are the shared conref targets of the class-compatibility
probes. All three are `processing-role="resource-only"`, and every element with an `@id` in
them is drawn in by a probe, so the corpus raises no `unreferenced-reusable` of its own. The
third one is there for the direction the other probes leave out: a `ph` drawing in its
`uicontrol` makes the source the general end of the target's chain (R064), and neither tool
reports it. The `@type` targets are published normally instead, and
each of them is named by one `topicref` only: a second `topicref` to one file would be
`multiple-reference`, and an `xref` to a resource-only topic would be `resource-only-target`.

`topics/m-plain.txt` and the two unparsable topics are reached from a map of their own, so
the positive maps do not turn into a `multiple-reference`, and every target the M group
names is used by one map only, for the same reason.

**Several rules can hit one file.** The two positive section probes write a `<title>` where
the content model does not allow one, so a schema-checking Oxygen also reports
`MSG_CONTENT_INVALID_UNEXPECTED_ELEMENT` on them, beside the section id. The file
`topics/m-not-dita.xml`, `topics/m-plain.txt` and the two unparsable topics draw a parse
finding on the file itself, while corpus 1 showed Oxygen putting
`dmv.invalid.parse.dita.content` on the map that references the file: that attribution is
the open question of the `unparsable-dita` category (`BATCH-4.md`), not a mistake in the
probe.

The three `MSG_*` ids are deliberately **not** probed here: corpus 1's `topics/invalid.dita`
already draws all three (element not declared, attribute not declared, content model), and the
maintenance decision on DTD validation landed on option 3 of `BATCH-4.md` — keep the difference
and record it. The run below carries four `MSG_*` incidents of its own anyway: one on the
undeclared `<widget>` (element not declared and unexpected there) and one on each of the two
probes that write a second `<section>` where the content model forbids it.

## The run: 34 incidents, 21 signatures matched

`oxygen-report.xml` carries 34 incidents. Six are the schema differences the maintenance
decision accepts (`../completeness-corpus/BATCH-4.md`, option 3):
`MSG_ELEMENT_NOT_DECLARED` ×1 and `MSG_CONTENT_INVALID_UNEXPECTED_ELEMENT` ×3 on the probes that
write an element where the content model does not allow one, and two id-less "There is no schema
or DTD associated with the document" errors on the DOCTYPE-less files. They are listed in
`ACCEPTED_PROBLEM_IDS` / `ACCEPTED_DESCRIPTIONS` (`src/test/editor/oxygenReport.ts`), and
`scripts/oxygen-diff.cjs` prints them as "accepted differences (not counted)".

Of the other 28, parity locks **21 matched, 6 extension-only, 3 Oxygen-only**
(`oxygen-parity.expected.json`). The report was rerun once, after the source-general probe and
its target were added: Oxygen files nothing for either, so every number here is unchanged, and
the only line that moved is the `corpus.ditamap` reference below (38 to 40). What Oxygen
answered, probe family by probe family:

| Rule | Oxygen's answer | Extension |
| --- | --- | --- |
| `dmv.invalid.class.format` | 11 incidents: four on the DOCTYPE-less `topics/l-domains-format-pos.dita` (lines 1, 6, 7, 8), two on `topics/m-not-dita.xml` (lines 1, 7), and one each on the badvalue, empty and no-trailing-space edges. The two probes that spell `class="- topic/p"` by hand are reported too, which settles that an authored value is checked as written even when it equals the DTD default | `class-format` on all of those; the undeclared element of the positive probe is the one row left to Oxygen (below) |
| `dmv.invalid.class.generalization` | 4 incidents: `p`→`ul`, `step`→`li` (a more specific source), `step`→`substep`, `substep`→`step`; the source-general probe draws nothing | `conref-class` on all four, `step`→`li` included; a general source is allowed, so that probe is silent here too (R064) |
| `dmv.invalid.class.specialization` | none — the specialization probes came back as `.generalization`, the same id as the other direction | nothing to match; the mapped category covers both directions |
| `dmv.invalid.domains.format` | 1 incident, on the empty-`@domains` edge (`l-domains-format-edge.dita:6`) | `domains-format`; an absent `@domains` produced only the schema differences, which is the documented boundary |
| `dmv.ref.type.class.mismatch` | 2 incidents: the `xref` probe and the map `topicref` probe | `type-class-mismatch` on both |
| `dmv.ref.type.class.mismatch.specific` | 1 incident: `type="topic"` against `- topic/topic task/task` | `type-class-specific` |
| `dmv.invalid.DITA.reference` | none — `format="dita"` on well-formed non-DITA XML is `dmv.ref.res.as.dita`, and the plain-text edge is `dmv.invalid.parse.dita.content` | `format-mismatch` on the positive map (matched), plus `dita-parse` on the plain-text edge |
| `dmv.invalid.DITA.uri.target` | none — the remote probes are `dmv.topicref.remote.no.external.scope` (scope declared) and `dmv.invalid.parse.dita.content` (no scope), both from the `@href`, not from `@format` | `external-reference` on the no-`@scope` edge |
| `dmv.invalid.parse.dita.content` | 4 incidents, always on the referring map: `m-dita-ref-edge:9`, `m-uri-target-edge:10`, `n-parse-content-pos:9`, `n-parse-content-edge:9` | `dita-parse` on the three local ones; the remote target is never fetched |
| `dmv.section.first.title` | 1 incident, on the positive probe | `section-title-order`; the nested-section edge stayed silent on both sides |
| `dmv.section.no.dup.title` | 1 incident, on the positive probe | `section-title-duplicate`; the nested-section edge stayed silent on both sides |

Three rows stay Oxygen-only, each for a recorded reason:

| Oxygen-only row | Report evidence | Handling |
| --- | --- | --- |
| `corpus.ditamap` `format-mismatch` | `dmv.ref.res.as.dita` at line 40, on the `topicref` to the DOCTYPE-less `topics/l-domains-format-pos.dita` | **Documented boundary.** Oxygen decides "is this a DITA resource" by the DOCTYPE association, and this probe has none on purpose (it asks about `@domains`); the extension reads the root `<topic>` and reports nothing. The probe's own four `class-format` incidents do match. |
| `maps/m-uri-target-edge.ditamap` `dita-parse` | `dmv.invalid.parse.dita.content` at line 10, on the remote URL | **Documented boundary.** A remote target is never fetched (R063), so there is no parse error to report; the extension reports `external-reference` on the same line, which is extension-only for the corpus-2 reason. |
| `topics/l-class-format-pos-undeclared.dita` `class-format` | `dmv.invalid.class.format` at line 12, on `<widget>` | **Accepted scope boundary.** No DTD declares `<widget>`, so the generated class table has no entry and every class rule skips the element; whether it is declared at all is schema validation's question (option 1 of `BATCH-4.md`). Same row as `topics/invalid.dita` in corpus 1. |

And the six extension-only rows are the rules that already existed: `format-mismatch` on
`m-dita-ref-edge.ditamap` (the plain-text edge is both "claims DITA" and "does not parse"; Oxygen
files only the parse error), `external-reference` on `m-uri-target-edge.ditamap`, and the four
`validation` findings on `topics/m-not-dita.xml`, `topics/m-plain.txt` and the two unparsable
topics.

## What the class table covers

`src/parser/ditaClassDefaults.ts` is generated from the DITA-OT 1.3 DTDs of **base**,
**technicalContent** and **bookmap**: 333 topic entries and 49 map entries, kept per side because
`title`, `shortdesc`, `linktext` and `searchtitle` carry different classes in a map and in a
topic. `learning/`, `machineryIndustry/` and the foreign-namespace modules were not extracted,
and no custom specialization is known here: an element outside the table is skipped by every
class-dependent rule instead of being given a guessed class. `npm run check:dita-class`
re-renders the module offline and fails when it and the committed
`scripts/dita-class-extracted.json` disagree; regenerating either file from the DTDs is a manual
step and is not part of `npm run verify`.

The coverage is the reason every probe here carries a DOCTYPE: without one the table has nothing
to fall back on and each element would be reported as class-less, as the DOCTYPE-less `@domains`
probe shows.

## Before the Oxygen run: 7 findings

`node scripts/completeness-baseline.cjs --corpus completeness-corpus-5` reports:

```
corpus.ditamap                 11  missing-reference  error    Referenced topic not found: topics/control-missing.dita
maps/m-dita-ref-edge.ditamap    9  format-mismatch    error    Non-DITA resource is referenced as a DITA topic: ../topics/m-plain.txt
maps/m-uri-target-edge.ditamap 10  external-reference warning  Reference to a URL must declare scope="external": ...
topics/m-not-dita.xml           6  validation         warning  Root element <config> is not a DITA topic
topics/m-plain.txt              1  validation         error    XML error: Non-whitespace before first tag.
topics/n-broken-edge.dita      12  validation         error    XML error: Unexpected close tag
topics/n-broken-pos.dita       11  validation         error    XML error: Unexpected close tag
```

One is the control (both sides report it), three are parse findings on the files themselves,
and two are existing rules of the ledger firing on a probe of this batch: `format-mismatch`
on the boundary of `dmv.invalid.DITA.reference` and `external-reference` on the boundary of
`dmv.invalid.DITA.uri.target`. Every other probe was silent when the probes were written, because
no class, `@domains`, `@type` or section rule existed yet; the 31 findings of the current
baseline are that list plus the rules the report above says to implement.
