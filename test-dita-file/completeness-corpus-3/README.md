# Completeness corpus 3: conref shape, id references, keys and links

The third differential corpus, kept apart from `../completeness-corpus/` and
`../completeness-corpus-2/` so each one keeps its own line numbers, baseline and
parity lock. It has its own root map, `corpus.ditamap`, its own `baseline.extension.json`
and, once Oxygen has been run on it, its own `oxygen-report.xml` and
`oxygen-parity.expected.json`. The work plan is `../completeness-corpus/BATCH-2.md`.

## Conventions

- **One rule per file.** Parity compares `(file, category)`, so two rules of one category in
  one file collapse into a single signature. A probe about a map-level reference or a key
  definition goes into its own small map under `maps/`, referenced from `corpus.ditamap`.
- **One probe per file, named for the rule:** `topics/<group>-<id>-<pos|neg|edge>.dita` (for
  example `topics/e-conref-siblings-pos.dita`). A comment on the probe names the rule and its
  `RULES.md` row.
- **Positive, negative and boundary** for every rule: something the check must report,
  something close to it that it must not, and the edge in between.
- **Keys are named per probe** (`k-<rule>-<n>`) and defined in the probe's own map, so a key
  never leaks from one probe into another.
- **Conref sources are shared and used.** Probes that point a conref at a source topic use one
  neutral `topics/lib.dita` whose reusable elements are each consumed by a valid control
  conref, so `unreferenced-reusable` noise is not mistaken for a finding of the rule under test.
- **Controls stay.** `topics/control-missing.dita` does not exist on purpose: both the
  extension and Oxygen report it. A report without it was not a run of this map.
- **Oxygen decides.** Where the specification does not settle a case, write the probe and let
  the next real report say what Oxygen does; do not guess.
- **Root map:** run Oxygen with `corpus.ditamap` of this folder as the only open root map
  (`Keys are gathered from:` in a report must name it).
- **Platform:** a probe whose result depends on the OS or the file system goes into
  `PLATFORM_DEPENDENT_FILES` in `src/test/editor/completenessHarness.ts` (see corpus 2).

## Running it

```
node scripts/completeness-baseline.cjs --corpus completeness-corpus-3          # extension findings
node scripts/oxygen-diff.cjs --corpus completeness-corpus-3 <report.xml>        # against Oxygen
node scripts/sanitize-oxygen-report.cjs --corpus completeness-corpus-3 <raw.xml> # writes oxygen-report.xml here
```

`npm run check:completeness -- --update` and `UPDATE_COMPLETENESS_BASELINE=1 npm test`
refresh the baselines; `UPDATE_OXYGEN_PARITY=1 npm test` refreshes the parity lock once
`oxygen-report.xml` exists (until then its test is skipped).

## What the corpus probes

| Probe | File | Expected extension finding |
| --- | --- | --- |
| control: reference to a file that does not exist | `topics/control-missing.dita` (absent) | `missing-reference` |
| neutral target | `topics/ok.dita` | *(none — control)* |
