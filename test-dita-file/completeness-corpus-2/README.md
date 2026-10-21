# Completeness corpus 2: reference spelling and `@format`/`@scope`

The second differential corpus, kept apart from `../completeness-corpus/` so that
line numbers, the baseline and the parity lock of the first one stay untouched. It
has its own root map, `corpus.ditamap`, its own `baseline.extension.json` and, once
Oxygen has been run on it, its own `oxygen-report.xml` and
`oxygen-parity.expected.json`. The work plan is `../completeness-corpus/BATCH-1.md`.

## Conventions

- **One rule per file.** Parity compares `(file, category)`, so two rules of one category in one
  file collapse into a single signature. A map-level probe goes into its own small map under
  `maps/`, referenced from `corpus.ditamap`.
- **One probe per file or map entry, named for the rule:** `topics/<group>-<id>-<pos|neg|edge>.dita`
  (for example `topics/a-win-seps-pos.dita`), or a topicref in `corpus.ditamap` when
  the probe is the reference itself. A comment on the probe names the rule; the ledger
  row is written with the implementation, once the category exists.
- **Positive, negative and boundary** for every rule: something the check must report,
  something close to it that it must not, and the edge in between.
- **Controls stay.** `topics/control-missing.dita` does not exist on purpose: both
  the extension and Oxygen report it. A report without it was not a run of this map.
- **Oxygen decides.** Where the specification does not settle a case, write the probe
  and let the next real report say what Oxygen does; do not guess.
- **Root map:** run Oxygen with `corpus.ditamap` of this folder as the only open root
  map (`Keys are gathered from:` in a report must name it).
- **Windows only.** The probes rely on Windows file-system behaviour: `topics\ok.dita`
  resolves, `topics/OK.dita` finds `ok.dita`, and a target that differs only in case is
  not a missing reference. On a case-sensitive file system the same lines would become
  missing references, so both the baseline and the parity lock describe one Windows run.
  `src/test/editor/completenessBaseline.test.ts` and `oxygenParity.test.ts` skip this
  folder elsewhere (`WINDOWS_ONLY_CORPORA`).
- **Fabricated absolute paths.** `maps/a-absolute-drive.ditamap` and
  `maps/a-absolute-fileurl.ditamap` need a literal absolute href, so they use the drive
  this corpus made up, `Z:`, with the folder `/probe`. That line carries the marker
  `probe-absolute-path`: `noAbsolutePaths.test.ts` exempts exactly that line, and
  `sanitizeOxygenReport` rewrites the same prefix in a report, so neither a committed
  probe nor a sanitized report can leak a real machine path.

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

The 29 rules of batch 1, one rule per file, each with `pos` (must report), `neg`
(must not) and `edge` (the boundary). "Extension now" is what
`baseline.extension.json` locks: `(none)` means the rule is not implemented yet, so
the first real report supplies both the finding and its severity. The eleven issue
categories those ids will share are in `../completeness-corpus/BATCH-1.md`; the
corpus keeps one file per rule so that two rules of one category stay
distinguishable by `(file, category)`.

| Rule | Probes | Extension now |
| --- | --- | --- |
| `dmv.win.seps.ref` | `topics/a-win-seps-{pos,neg,edge}.dita` | *(none)* — backslashes resolve on Windows |
| `dmv.absolute.ref` | `maps/a-absolute-{posix,drive,neg,fileurl}.ditamap` | the POSIX probe is also `missing-reference` + `outside-folder`; `Z:` and `file:` look remote |
| `dmv.extra.slash.ref` | `topics/a-extra-slash-{pos,neg,edge}.dita` | *(none)* |
| `dmv.ref.extra.slash` | `topics/a-ref-extra-slash-{pos,neg,edge}.dita` | *(none)* |
| `dmv.file.url.two.slashes` | `topics/a-fileurl-{pos,neg,edge}.dita` | *(none)* |
| `dmv.unencoded.ref` | `topics/a-unencoded-{space,chinese,brackets,hash,percent,encoded}.dita` | the `#` probe is also `missing-resource`: the href splits at the `#` |
| `dmv.incorect.capit.ref` | `topics/a-case-{pos,neg,edge}.dita` | *(none)* — Windows lookup is case-insensitive |
| `dmv.folder.ref` | `topics/a-folder-{pos,neg,edge}.dita` | *(none)* |
| `dmv.recursive.ref` | `maps/a-recursive-{loopa,loopb,self,neg,child}.ditamap` | *(none)* |
| `dmv.invalid.keyref.syntax.1` | `topics/b-keyref1-{pos,neg,edge}.dita` | *(none)* |
| `dmv.invalid.keyref.syntax.2` | `topics/b-keyref2-{pos,neg,edge}.dita` | *(none)* |
| `dmv.invalid.keyref.syntax.3` | `topics/b-keyref3-{pos,neg,edge}.dita` | `undefined-key` on `pos` and `edge` — no key can carry whitespace |
| `dmv.invalid.id.syntax.2` | `topics/b-id2-{colon,digit,valid}.dita` | *(none)* |
| `dmv.invalid.id.syntax.3` | `topics/b-id3-{space,neg}.dita`, `maps/b-id3-map.ditamap` | *(none)* |
| `dmv.topicref.no.format` | `maps/c-topicref-no-format-{pos,neg,edge}.ditamap`, `maps/c-guess-{dita,xml,html,noext}.ditamap` | *(none)* |
| `dmv.topicref.map.no.format` | `maps/c-map-no-format-{pos,neg,edge}.ditamap` + `-sub-` targets | `validation` on `edge`: `format="dita"` makes the map be read as a topic |
| `dmv.topicref.topic.no.format` | `maps/c-topic-no-format-{pos,neg,edge}.ditamap` + `topics/c-topic-no-format-target-*.dita` | `validation` on the `pos` target: `format="ditamap"` makes it be read as a map |
| `dmv.ref.map.no.proper.format` | `maps/c-mapref-format-{pos,neg,edge}.ditamap` + `-sub` | *(none)* |
| `dmv.ref.res.as.dita` | `maps/c-res-as-dita-{pos,neg,edge}.ditamap` + `topics/c-res-as-dita-*` | `validation` on `pos.txt` and `edge.html`: parsed as DITA, root rejected |
| `dmv.ref.res.as.map` | `maps/c-res-as-map-{pos,neg,edge}.ditamap` + `topics/c-res-as-map-*` | `validation` on `pos.txt` and `edge.html`: parsed as a map, root rejected |
| `dmv.ref.topic.as.map` | `topics/c-topic-as-map-{pos,neg,edge}.dita` + `topics/c-topic-as-map-target.dita` | *(none)* |
| `dmv.no.format.non.dita.ref` | `topics/c-no-format-nondita-{pos,neg,edge}.dita` + `topics/c-nondita-*.{pdf,bin}` | *(none)* |
| `dmv.topicref.remote` | `maps/c-remote-{pos,neg,edge}.ditamap` | *(none)* |
| `dmv.topicref.remote.no.external.scope` | `maps/c-remote-no-external-{pos,neg,edge}.ditamap` | *(none)* |
| `dmv.topicref.remote.local.scope` | `maps/c-remote-local-{pos,neg,edge}.ditamap` | *(none)* |
| `dmv.topicref.ext.scope.no.format` | `maps/c-ext-scope-{pos,neg,edge}.ditamap` | *(none)* |
| `dmv.ref.topic.inside.mapref` | `maps/c-mapref-children-{pos,neg,edge}.ditamap` + `-sub` + `topics/c-mapref-{parent,child}.dita` | *(none)* |
| `dmv.topichead.no.navtitle` | `maps/d-topichead-{pos,neg,edge}.ditamap` | *(none)* |
| `dmv.topicref.no.navtitle` | `maps/d-topicref-{pos,neg,edge}.ditamap` | *(none)* |

Supporting files are not probes of their own. `topics/ok.dita` is the neutral target;
`topics/control-missing.dita` is absent on purpose (`missing-reference` on line 17 of the
root map, present in every run); the five files with reserved characters in their names
(`ok file.dita`, `中文.dita`, `ok[1].dita`, `ok#1.dita`, `100%.dita`) are published under
encoded hrefs so the raw-href probes have something that resolves; `topics/c-resource.*`
and the remaining `topics/c-*` files are the targets of the map-level probes.
