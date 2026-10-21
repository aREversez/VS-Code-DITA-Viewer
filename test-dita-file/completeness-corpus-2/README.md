# Completeness corpus 2: reference spelling and `@format`/`@scope`

The second differential corpus, kept apart from `../completeness-corpus/` so that
line numbers, the baseline and the parity lock of the first one stay untouched. It
has its own root map, `corpus.ditamap`, its own `baseline.extension.json` and, once
Oxygen has been run on it, its own `oxygen-report.xml` and
`oxygen-parity.expected.json`. The work plan is `../completeness-corpus/BATCH-1.md`.

## Conventions

- **One probe per file or map entry, named for the rule:** `topics/<group>-<id>-<pos|neg|edge>.dita`
  (for example `topics/a-win-seps-pos.dita`), or a topicref in `corpus.ditamap` when
  the probe is the reference itself. A comment on the probe names the rule and its
  `RULES.md` row.
- **Positive, negative and boundary** for every rule: something the check must report,
  something close to it that it must not, and the edge in between.
- **Controls stay.** `topics/control-missing.dita` does not exist on purpose: both
  the extension and Oxygen report it. A report without it was not a run of this map.
- **Oxygen decides.** Where the specification does not settle a case, write the probe
  and let the next real report say what Oxygen does; do not guess.
- **Root map:** run Oxygen with `corpus.ditamap` of this folder as the only open root
  map (`Keys are gathered from:` in a report must name it).

## Running it

```
node scripts/completeness-baseline.cjs --corpus completeness-corpus-2          # extension findings
node scripts/oxygen-diff.cjs --corpus completeness-corpus-2 <report.xml>        # against Oxygen
node scripts/sanitize-oxygen-report.cjs --corpus completeness-corpus-2 <raw.xml> # writes oxygen-report.xml here
```

`npm run check:completeness -- --update` and `UPDATE_COMPLETENESS_BASELINE=1 npm test`
refresh the baselines; `UPDATE_OXYGEN_PARITY=1 npm test` refreshes the parity lock
once `oxygen-report.xml` exists (until then its test is skipped).

## What the corpus probes

| Probe | File | Expected extension finding |
| --- | --- | --- |
| control: reference to a file that does not exist | `topics/control-missing.dita` (absent) | `missing-reference` |
| neutral target | `topics/ok.dita` | *(none — control)* |
