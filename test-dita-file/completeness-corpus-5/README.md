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

| Probe | File | Expected extension finding |
| --- | --- | --- |
| control: reference to a file that does not exist | `topics/control-missing.dita` (absent) | `missing-reference` |
| neutral target | `topics/ok.dita` | *(none — control)* |
