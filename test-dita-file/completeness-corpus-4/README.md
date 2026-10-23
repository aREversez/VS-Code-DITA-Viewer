# Completeness corpus 4: profiling values, subject schemes and filters

The fourth differential corpus, kept apart from the other three so each keeps its own line
numbers, baseline and parity lock. It has its own root map, `corpus.ditamap`, its own
`baseline.extension.json` and, once Oxygen has been run on it, its own `oxygen-report.xml`
and `oxygen-parity.expected.json`. The work plan is `../completeness-corpus/BATCH-3.md`.

## Oxygen setup for this corpus

Unlike the other corpora, this one depends on settings in Oxygen itself, so the run is only
comparable if they are the ones recorded here (and mirrored in `CORPUS_SETTINGS` in
`src/test/editor/completenessHarness.ts`):

- **Filter:** the dialog of Validate and Check for Completeness is given
  `filters/probe.ditaval` of this folder.
- **Profiling preferences:** `audience` with the values `expert` and `novice`, as in the
  other corpora. The session that writes the probes adds what the batch needs (an attribute
  restricted to a single value, a group definition) and records the exact preference state
  **here**, in a table, so the maintainer can reproduce it; the same state goes into
  `CORPUS_SETTINGS['completeness-corpus-4'].preferences`.

Record in this README, after the run, which Oxygen product and version produced the report.

## Conventions

- **One rule per file.** Parity compares `(file, category)`, so two rules of one category in
  one file collapse into a single signature. A map-level probe goes into its own small map
  under `maps/`, referenced from `corpus.ditamap`; a subject scheme is its own map.
- **One probe per file, named for the rule:** `topics/<group>-<id>-<pos|neg|edge>.dita`. A
  comment on the probe names the rule and its `RULES.md` row.
- **Positive, negative and boundary** for every rule.
- **The filter is global to the run.** `filters/probe.ditaval` applies to every file, so a
  probe outside the filter group must not use an audience value the filter excludes.
- **Controls stay.** `topics/control-missing.dita` does not exist on purpose; a report
  without it was not a run of this map. Each probe group also needs a control Oxygen is known
  to report, so silence on a rule means Oxygen looked.
- **Oxygen decides.** Where the specification does not settle a case, write the probe and let
  the next real report say what Oxygen does.
- **Root map:** `corpus.ditamap` of this folder as the only open root map
  (`Keys are gathered from:` in a report must name it).
- **Platform:** a probe whose result depends on the OS or the file system goes into
  `PLATFORM_DEPENDENT_FILES` (see corpus 2).

## Running it

```
node scripts/completeness-baseline.cjs --corpus completeness-corpus-4          # extension findings
node scripts/oxygen-diff.cjs --corpus completeness-corpus-4 <report.xml>        # against Oxygen
node scripts/sanitize-oxygen-report.cjs --corpus completeness-corpus-4 <raw.xml> # writes oxygen-report.xml here
```

`UPDATE_COMPLETENESS_BASELINE=1 npm test` and `UPDATE_OXYGEN_PARITY=1 npm test` refresh the
baseline and the parity lock; the parity test is skipped until `oxygen-report.xml` exists.

## What the corpus probes

| Probe | File | Expected extension finding |
| --- | --- | --- |
| control: reference to a file that does not exist | `topics/control-missing.dita` (absent) | `missing-reference` |
| neutral target | `topics/ok.dita` | *(none — control)* |
| the shared filter | `filters/probe.ditaval` | *(none)* |
