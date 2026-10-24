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

Nothing beyond the other corpora: the `audience` preferences of corpus 1, no filter. Record in
this README, after the run, which Oxygen product and version produced the report.

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
| `dmv.invalid.class.generalization` | `topics/l-class-generalization-{pos,neg,edge}.dita` | `p` to `ul` (unrelated classes); `p` to `p`; `step` to `li` (the general end of the source's own chain) |
| `dmv.invalid.class.specialization` | `topics/l-class-specialization-{pos,neg,edge}.dita` | `step` to `substep` (target more specific than source); `substep` to `step`; authored class spelled exactly as the default |
| `dmv.ref.type.class.mismatch` | `topics/l-ref-type-mismatch-{pos,neg}.dita`, `maps/l-ref-type-mismatch-map.ditamap` | `type="concept"` to a task; `type="task"` to a task; the same mismatch on a map `topicref` |
| `dmv.ref.type.class.mismatch.specific` | `topics/l-ref-type-specific-{pos,neg,edge}.dita` | `type="topic"` to a task; `type="topic"` to a topic; `type="concept"` to a concept |
| `dmv.invalid.domains.format` | `topics/l-domains-format-{pos,neg,edge}.dita` | no DOCTYPE at all; `@domains` from the DOCTYPE; `domains=""` |
| `dmv.invalid.DITA.reference` | `maps/m-dita-ref-{pos,neg,edge}.ditamap` | `format="dita"` on well-formed XML that is not DITA; on a DITA topic; on a plain text file |
| `dmv.invalid.DITA.uri.target` | `maps/m-uri-target-{pos,neg,edge}.ditamap` | `format="dita"` on a remote URI with `scope="external"`; on a local DITA topic; on a remote URI without `@scope` |
| `dmv.invalid.parse.dita.content` | `maps/n-parse-content-{pos,neg,edge}.ditamap` | a `topicref` to an unparsable topic; to a topic that parses; to an unparsable one through `@copy-to` |
| `dmv.section.first.title` | `topics/n-section-first-title-{pos,neg,edge}.dita` | title after a paragraph; title first; only the nested section out of order |
| `dmv.section.no.dup.title` | `topics/n-section-no-dup-title-{pos,neg,edge}.dita` | two titles in one section; one title; one title per nested section |

`topics/l-class-target-base.dita` and `topics/l-class-target-task.dita` are the shared conref
targets of the class-compatibility probes. Both are `processing-role="resource-only"`, and
every element with an `@id` in them is drawn in by a probe, so the corpus raises no
`unreferenced-reusable` of its own. The `@type` targets are published normally instead, and
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
already draws all three (element not declared, attribute not declared, content model), and
whether the extension validates against a DTD at all is still the maintenance decision
written up in `BATCH-4.md`.

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
`dmv.invalid.DITA.uri.target`. Every other probe is silent in the extension today, because no
class, `@domains`, `@type` or section rule exists yet: for the negative and boundary probes
that silence is already the right answer, and for the positive ones it is what the batch is
about.
