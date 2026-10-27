# Completeness corpus 4: profiling values, subject schemes and filters

The fourth differential corpus, kept apart from the other three so each keeps its own line
numbers, baseline and parity lock. It has its own root map, `corpus.ditamap`, its own
`baseline.extension.json` and, once Oxygen has been run on it, its own `oxygen-report.xml`
and `oxygen-parity.expected.json`. The work plan is `../completeness-corpus/BATCH-3.md`.

## Oxygen setup for this corpus

Unlike the other corpora, this one depends on settings in Oxygen itself. The run is only
comparable if Oxygen has exactly the state below; the same state is mirrored in
`CORPUS_SETTINGS['completeness-corpus-4']` in `src/test/editor/completenessHarness.ts`.
The page names and controls below are the ones the maintainer recorded in Oxygen XML
Editor 27.1, not guessed.

| What | State to reach | Where the state lives |
| --- | --- | --- |
| DITAVAL filter | exactly `filters/probe.ditaval` of this folder, and no second filter | DITA Map Completeness Check > `Use DITAVAL filters` > `Other:` > `DITAVAL files` (`Add`/`Remove`) |
| `audience` | allowed values `expert`, `novice` | Preferences > Editor > Edit Modes > Author > Profiling/Conditional Text > Attributes and Condition Sets, `Profiling Attributes` |
| `platform` | allowed values `linux`, `windows`; **single value** | same; `Profiling Attribute` dialog, radio `Single value` |
| `product` | allowed values `desktop`, `mobile` | same |
| `otherprops` | allowed values `alpha`, `beta`, `gamma` | same |
| `deliveryTarget` | allowed values `pdf`, `html` | same; a new `*DITA*` row |
| `props` | the group value `audience(novice)` | same; one value, the page has no group field |
| conflicts option | on | DITA Map Completeness Check > `Report attributes and values that conflict with profiling preferences` |
| remote resources | off | DITA Map Completeness Check > `Include remote resources` |
| invalid-value option | on from the third run on | Preferences > Editor > Edit Modes > Author > Profiling/Conditional Text > `Report invalid profiling attribute values (DITA only)` |

### The page as recorded (Oxygen XML Editor 27.1)

- The table is `Profiling Attributes` with the columns Document type, Attribute, Values and
  the buttons New, Edit, Delete, Up, Down. The per-attribute dialog is `Profiling
  Attribute`: Attribute name, Display name, a Value/Label/Description table, and the radio
  pair `Single value` / `Multiple values separated by: <space>`. The value tree opened from
  the editor is `Edit Profiling Attributes`; a single-valued attribute's values show there
  as radio buttons (Revision does).
- The value lists keep values no document uses, so `expert`, `pdf` and `html` can be
  defined before any document uses them.
- `Profiling Condition Sets` is empty, so the check dialog uses `Other:` with a file rather
  than a named condition set.
- The invalid-value preference and the check dialog's `Report attributes and values that conflict with profiling
  preferences` are two different switches. The conflicts one is on in every run; the invalid-value one was off for
  the first two runs and on from the third on, and the saved reports of a run with it off and a run with it on are
  identical, so it changes nothing for this corpus.
- `props` does keep a group value entered as one literal: the page accepted `audience(novice)`, and a document's
  `props="audience(novice)"` counts as defined (no incident on `i-prof-group-neg`). The comparison is on the literal
  token, which is why `props="audience(nobody)"`, `props="color(red)"` and `props="audience()"` are each reported
  with the whole group, brackets included, in the message.

### State found before configuration

Recorded from the page on 2026-10-23, before the settings above were reached: the `*DITA*`
rows were `audience` `expert novice`, `platform` `linux mac solaris windows` (not single
valued), `product` `product1 product2`, `props` `prop1 prop2`, `otherprops` `prop1 prop2`,
`rev` `1.0 2.0`, and no `deliveryTarget` row. The check dialog's DITAVAL list held
`test-dita-file/manual/ditavals/develop.ditaval`. The runs reached the rows above with the values added,
`platform` single-valued, a `deliveryTarget` row, and this folder's filter in place of the manual one. Values that
no probe uses were left in the lists; `CORPUS_SETTINGS` mirrors that final table, and a report from any other
preference state is not a run of this corpus.

### The filter file is also a probe

`filters/probe.ditaval` contains the global `audience="expert"` exclusion, a duplicate of
that condition (`dmv.dup.cond.filter`, positive), and a `platform="solaris"` rule with
`exclude` then `include` (edge: the same rule, different actions). `solaris` appears in no
probe, so the conflict cannot change which content is filtered. A filter without duplicates
(the negative case) cannot coexist with the positive in one file; Oxygen takes one filter
per run, so the negative is recorded here and in the ledger row as not separately observable. The real report
decided the shape: one incident per duplicated condition, error, on the filter file, with no `<problemID>`.

## Conventions

- **One rule per file.** Parity compares `(file, category)`, so two rules of one category in
  one file collapse into a single signature. A map-level probe goes into its own small map
  under `maps/`, referenced from `corpus.ditamap`; a subject scheme is its own map.
- **One probe per file, named for the rule:** `topics/<group>-<id>-<pos|neg|edge>.dita`. A
  comment on the probe names the Oxygen id and `pos`/`neg`/`edge`; the ledger row is written
  with the implementation, once the category exists.
- **Positive, negative and boundary** for every rule.
- **The filter is global to the run.** `filters/probe.ditaval` applies to every file, so a
  probe outside the filter group must not use an audience value the filter excludes.
- **Controls stay.** `topics/control-missing.dita` does not exist on purpose; a report
  without it was not a run of this map. `topics/ok.dita` is the neutral target.
- **Oxygen decides.** Where the specification does not settle a case, write the probe and let
  the next real report say what Oxygen does.
- **Root map:** `corpus.ditamap` of this folder as the only open root map
  (`Keys are gathered from:` in a report must name it).
- **Platform:** a probe whose result depends on the OS or the file system goes into
  `PLATFORM_DEPENDENT_FILES` (see corpus 2). This corpus has none.

## Running it

```
node scripts/completeness-baseline.cjs --corpus completeness-corpus-4                  # extension findings
node scripts/sanitize-oxygen-report.cjs <raw.xml> --corpus completeness-corpus-4       # writes oxygen-report.xml here
node scripts/oxygen-diff.cjs oxygen-report.xml --corpus completeness-corpus-4           # against Oxygen
```

The report is the positional argument in both of the last two; `--corpus` picks the folder (`--corpus-root` only
overrides the Oxygen side of a comparison, which is what the `Keys are gathered from:` check is for).

`node scripts/completeness-baseline.cjs --corpus completeness-corpus-4 --update` rewrites
`baseline.extension.json`; `UPDATE_OXYGEN_PARITY=1 npm test` refreshes the parity lock once
`oxygen-report.xml` exists (until then the parity test is skipped for this folder).

## What the corpus probes

The nine Oxygen problem ids of batch 3 (`../completeness-corpus/BATCH-3.md`), one rule per
file, each with `pos` (must report), `neg` (must not) and `edge` (the boundary):

| Rule | Probes | What the probes hold |
| --- | --- | --- |
| `dmv.prof.attr.empty.value` | `topics/i-prof-empty-{pos,neg,edge}.dita` | `audience=""`; `audience="novice"`; whitespace only and `props="audience()"` |
| `dmv.prof.attr.val.prefs.confl` | `topics/i-prof-single-{pos,neg,edge}.dita` | `platform="linux windows"` under a single-value preference; one value; empty value |
| `dmv.prof.group.val.prefs.undef` | `topics/i-prof-group-{pos,neg,edge}.dita` | `props="audience(nobody)"`; `audience(novice)`; `color(red)` with no such group |
| `dmv.prof.sbj.attr.mult.val.confl` | `topics/j-sbj-mult-{pos,neg,edge}.dita` | `product="desktop desktop"`; one `desktop`; `desktop mobile` |
| `dmv.prof.sbj.attr.val.rej` | `topics/j-sbj-rej-{pos,neg,edge}.dita` | `otherprops="gamma"`; `alpha`; `alpha gamma` |
| `dmv.prof.sbj.attr.val.rej.all` | `topics/j-sbj-rej-all-{pos,neg,edge}.dita` | `deliveryTarget="pdf"` under an enumeration with no allowed values; `platform="linux"` accepted; `deliveryTarget="pdf html"` |
| `dmv.ref.filtered` | `topics/k-conref-filtered-{pos,neg,edge}.dita` + `k-conref-target-{pos,neg,edge}.dita` | conref to an `audience="expert"` element; to a `novice` element; a range ending at an `expert` element |
| `dmv.ref.filtered.conref` | `topics/k-conref-ignored-{pos,neg,edge}.dita` + `k-conref-ignored-src.dita` | an xref at a paragraph inside an element that carries its own `@conref`; at the same paragraph with no `@conref`; at the `@conref` element itself |
| `dmv.dup.cond.filter` | `filters/probe.ditaval` | a duplicate `audience="expert"` rule; the same rule with two actions; a filter without duplicates cannot coexist |

### The subject scheme

`maps/j-scheme.ditamap` is a `subjectScheme` map pulled into `corpus.ditamap` with
`<topicref href="maps/j-scheme.ditamap" format="ditamap"/>`.
It defines `platform` as `linux` and `windows`, `otherprops` as `alpha` and `beta`,
`product` as the single value `desktop` (the scheme's single-value case), and a
`deliveryTarget` enumeration with an empty set of allowed values. The DTD requires a
`subjectdef` inside `enumerationdef`, so the empty set is spelled as a category without
children (`j-target`) rather than as an `enumerationdef` with no `subjectdef`; the set of
allowed values is empty either way. The extension has no subject-scheme reader yet, so on
the extension side the scheme contributes only its five leaf subject keys as
`unreferenced-key` findings; parity collapses those five into one
`maps/j-scheme.ditamap unreferenced-key` extension-only row.

### Two probes answered by a different rule

- `topics/k-ref-filtered-{pos,neg,edge}.dita` ask what an xref at a topic whose **map branch** the filter drops
  reports. It is not `dmv.ref.filtered`: Oxygen answers `dmv.not.topic.ref.in.map` on the positive only, the same
  id it uses for a link to a topic no map references, which the extension already files as `unreferenced-link`. The
  negative and the partly filtered edge are silent, because their topicrefs survive the filter.
- `dmv.ref.filtered.conref` is not about a filtered target at all. The first run reported `dmv.ref.filtered` for a
  conref at an excluded element, so the probes were rewritten: `k-conref-ignored-{pos,neg,edge}` now ask about a
  reference into content that **content reference processing** drops, and the positive produced the id.

### K depends on the filter

The target topicrefs `k-filtered-target-pos` (`audience="expert"`), `k-filtered-target-neg`
(`novice`) and `k-filtered-target-edge` (`novice expert`) are part of the probe: the filter
removes the whole positive target branch, keeps the negative target, and keeps the edge
target because one of its two values survives. The conref target elements `gone` and `last`
carry `audience="expert"` on purpose; `kept` and `first` do not.

## What the extension reports today

`baseline.extension.json` holds the 10 findings the extension produces before this batch is implemented:

- the control `missing-reference` at `corpus.ditamap` line 16;
- five `unreferenced-key` findings on the scheme map's leaf subjects
  (`linux`, `windows`, `alpha`, `beta`, `desktop`);
- `profiling-preference` on `i-prof-single-pos` (existing single-value check) and on
  `i-prof-group-pos` and `i-prof-group-edge` (the existing value check sees the group's bare
  value);
- `unreferenced-link` on `k-ref-filtered-pos`, because the filtered target is not in the
  map the extension crawls.

The empty-value probes, the `props="audience()"` group and every K conref probe stay silent: no
`invalid-id-reference`, `invalid-conref-form` or `unreferenced-reusable` fires on them either, because a filtered
element leaves no id set for the existing checks to resolve against, and the filter file itself is never looked at.
That is what this batch has to add.

## The Oxygen runs and what they showed

Oxygen XML Editor 27.1, `corpus.ditamap` as the only root map, the setup table above. Five runs; four reports
survive on disk (`.raw.xml` files are ignored, only the sanitized `oxygen-report.xml` is committed):

| Run | Corpus spelling | Report | Incidents |
| --- | --- | --- | --- |
| 1 | scheme in with `mapref`, `k-conref-ignored-*` not written yet | `oxygen-report.run1-mapref.raw.xml` | 18 |
| 2 | scheme in with `<topicref format="ditamap">`, the `k-conref-ignored-*` probes added | `oxygen-report.raw.xml` | 19 |
| 3 | as 2, plus `Report invalid profiling attribute values (DITA only)` on | not kept | — |
| 4 | as 3, after a search through the UI for anywhere a scheme could be registered | `oxygen-report.run4.raw.xml` | 19 |
| 5 | `corpus.ditamap` itself is the `subjectScheme` root | `oxygen-report.run5.raw.xml` | 24 |

Run 4 is the committed report: the plain map root keeps the shape the other corpora have, and runs 2 and 4 have
identical incident sets, so neither the extra preference switch nor the search for a scheme registration changed
anything.

What the reports answer:

- **The scheme never loads.** All four spellings leave the scheme unevaluated. The J-group ids
  (`dmv.prof.sbj.attr.mult.val.confl`, `.val.rej`, `.val.rej.all`) produce no incident in any run, and the four
  `subjectdef` keys the probes need are reported `dmv.key.undef` — from `corpus.ditamap`'s key space in runs 1 to 4
  (`Keys are gathered from: corpus.ditamap`), and in run 5 even from the map whose own root is the scheme.
  A subject scheme is therefore not evaluated by this check at all, which is why the J group is recorded as `n/a`
  rather than implemented against a guess.
- **Run 5 costs, it does not inform.** Making the root a `subjectScheme` added two `dmv.ref.to.resource.only`
  incidents (`k-ref-filtered-neg/edge`) and three `dmv.not.used.reusable.component` incidents
  (`k-conref-ignored-{pos,neg,edge}`) that the plain map root does not produce, and kept the four
  `dmv.key.undef`. That is corpus pollution, not behaviour, and is the reason the corpus went back to run 4's
  spelling.
- **Empty and grouped values.** `audience=""`, `audience="   "` and `platform=""` are
  `dmv.prof.attr.empty.value` (whitespace counts as empty; `platform=""` is an empty value, not a single-value
  violation); `props="audience()"` is *not* an empty value but `dmv.prof.group.val.prefs.undef`, reported as the
  literal group `audience()`; `props="audience(novice)"` is silent because the preference holds that literal.
  `platform="linux windows"` under a single-value preference is `dmv.prof.attr.val.prefs.confl`.
- **Filtered and replaced targets.** A conref at an excluded element and a range ending at one are both
  `dmv.ref.filtered` (severity error, reported on the referrer). A reference into content an enclosing `@conref`
  replaces is `dmv.ref.filtered.conref` (warning), and only for the content *inside*: a reference at the
  `@conref` element itself is silent. The filtered range endpoint is also `dmv.not.used.reusable.component` —
  a range end that cannot be pulled in does not count as a use of it — while the plain conref at the excluded
  `kctp/gone` produces no such finding; the two runs give no rule that explains the difference, so it is recorded
  as a documented difference instead of being implemented.
- **The filter file.** Both `dmv.dup.cond.filter` incidents are severity error on `filters/probe.ditaval`, one per
  duplicated condition, and **carry no `<problemID>`**, so parity maps them on the message wording.

`node scripts/oxygen-diff.cjs test-dita-file/completeness-corpus-4/oxygen-report.xml --corpus completeness-corpus-4`
against the implementation as it stands:

```
extension findings: 19   Oxygen incidents: 19
signatures matched: 13

# extension only (found here, not by Oxygen) [1]
  - maps/j-scheme.ditamap  unreferenced-key

# Oxygen only (found by Oxygen, not here) [2]
  + maps/j-scheme.ditamap  undefined-key
  + topics/k-conref-target-edge.dita  unreferenced-reusable
```

Everything the run was probing for now matches: the three empty values, the three group findings,
the single-value clash, both `dmv.ref.filtered` probes, `dmv.ref.filtered.conref` and the two
id-less filter-file rows (mapped on the message wording, since the report gives them no
`problemID`). What is left is the scheme difference and the one reuse row:
`maps/j-scheme.ditamap undefined-key` against `maps/j-scheme.ditamap unreferenced-key` is
the same finding seen from two sides — per the DTD a `subjectdef` defines a key, so Oxygen's
four `dmv.key.undef` are its refusal to load the scheme, and our five `unreferenced-key`
findings are the leaf subjects of a scheme we do read as a map. Both rows are recorded in
`../completeness-corpus/OXYGEN-PROBLEMS.md`, together with `topics/k-conref-target-edge.dita`.

## Baseline and parity

`baseline.extension.json` is refreshed with `--update` as shown under "Running it". The parity lock
(`oxygen-parity.expected.json`) holds the state above and is refreshed with `UPDATE_OXYGEN_PARITY=1 npm test`
whenever parity changes on purpose.

