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
- **Fabricated probe targets.** `maps/a-absolute-drive.ditamap` and
  `maps/a-absolute-fileurl.ditamap` need a literal absolute href, so they use the drive
  this corpus made up, `Z:`, with the folder `/probe`. That line carries the marker
  `probe-absolute-path`: `noAbsolutePaths.test.ts` exempts exactly that line, and
  `sanitizeOxygenReport` folds the same prefix in a report, so neither a committed probe
  nor a sanitized report can leak a real machine path. The other probes that
  resolve outside the corpus (`/probe/x.dita` and the three `file:` URLs to
  `topics/ok.dita`) are folded the same way: Oxygen quotes the machine-resolved target
  (a UNC share for the authority form, a path on its own start drive for the rest), and
  every such form becomes `probe-absolute-path` in the report.

## Platform-dependent probes

Four probe files give a different result off Windows: `topics/a-win-seps-pos.dita` and
`topics/a-win-seps-edge.dita` (a backslash is a separator only on Windows) and
`topics/a-case-pos.dita` and `topics/a-case-edge.dita` (a path that differs from the
real file only in case resolves only on a case-insensitive file system). Their Oxygen
report comes from a Windows run, so on macOS and Linux the baseline and parity tests leave
those four files out of **both** sides and still lock everything else
(`PLATFORM_DEPENDENT_FILES` in `src/test/editor/completenessHarness.ts`). The two refresh
commands below must be run on Windows; elsewhere they refuse for this corpus, because they
would write the other platform's answer for those four files. A new probe whose result
depends on the file system or the OS goes into that list.

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
(must not) and `edge` (the boundary). The rules are implemented in `mapCrawl.ts` /
`mapChecks.ts` and locked by `baseline.extension.json` (65 findings); the eleven
categories they share are in `../completeness-corpus/BATCH-1.md` and in the ledger
(`../completeness-corpus/RULES.md`, R026-R036). The corpus keeps one file per rule so
that two rules of one category stay distinguishable by `(file, category)`.

| Rule | Probes | Extension now |
| --- | --- | --- |
| `dmv.win.seps.ref` | `topics/a-win-seps-{pos,neg,edge}.dita` | `reference-syntax` error (matched) |
| `dmv.absolute.ref` | `maps/a-absolute-{posix,drive,neg,fileurl}.ditamap` | `reference-syntax` warning on the POSIX and `file:` probes (matched, except the POSIX row: extension-only, see below); `Z:` is a drive-letter URL to the crawler, so that probe stays remote (treated like `file:`) |
| `dmv.extra.slash.ref` | `topics/a-extra-slash-{pos,neg,edge}.dita` | `reference-syntax` warning (matched) |
| `dmv.ref.extra.slash` | `topics/a-ref-extra-slash-{pos,neg,edge}.dita` | `reference-syntax` warning; the two `topics/` probes are also `folder-reference` (matched) |
| `dmv.file.url.two.slashes` | `topics/a-fileurl-{pos,neg,edge}.dita` | `reference-syntax` warning on the `file:/` and `file:///` forms, as absolute paths; the report raised `dmv.absolute.ref` there instead, so this id itself has no incident (mapped, not exercised) |
| `dmv.unencoded.ref` | `topics/a-unencoded-{space,chinese,brackets,hash,percent,encoded}.dita` | `reference-syntax` error on space, brackets and `%` (matched); non-ASCII is not reported, and the `#` probe is `missing-resource` (the href splits at the `#`), as the report agrees |
| `dmv.incorect.capit.ref` | `topics/a-case-{pos,neg,edge}.dita` | `incorrect-case-reference` error (matched) |
| `dmv.folder.ref` | `topics/a-folder-{pos,neg,edge}.dita` | `folder-reference` error (matched) |
| `dmv.recursive.ref` | `maps/a-recursive-{loopa,loopb,self,neg,child}.ditamap` | `recursive-reference` error at the closing reference only (matched) |
| `dmv.invalid.keyref.syntax.1` | `topics/b-keyref1-{pos,neg,edge}.dita` | `invalid-key-syntax` error on `pos` (matched) |
| `dmv.invalid.keyref.syntax.2` | `topics/b-keyref2-{pos,neg,edge}.dita` | the report produced no incident for this id; the extension checks only `/` and whitespace |
| `dmv.invalid.keyref.syntax.3` | `topics/b-keyref3-{pos,neg,edge}.dita` | `invalid-key-syntax` error on `pos` (matched; the value also cannot name a key) |
| `dmv.invalid.id.syntax.2` | `topics/b-id2-{colon,digit,valid}.dita` | `invalid-id-syntax` error (matched) |
| `dmv.invalid.id.syntax.3` | `topics/b-id3-{space,neg}.dita`, `maps/b-id3-map.ditamap` | `invalid-id-syntax` error, topics and map alike (matched) |
| `dmv.topicref.no.format` | `maps/c-topicref-no-format-{pos,neg,edge}.ditamap`, `maps/c-guess-{dita,xml,html,noext}.ditamap` | `format-missing` on `pos`; `format-mismatch` where a wrong `@format` is present (matched) |
| `dmv.topicref.map.no.format` | `maps/c-map-no-format-{pos,neg,edge}.ditamap` + `-sub-` targets | `format-mismatch` error on `pos` and `edge` (matched); a bare `mapref` is left alone because its default format is `ditamap` |
| `dmv.topicref.topic.no.format` | `maps/c-topic-no-format-{pos,neg,edge}.ditamap` + `topics/c-topic-no-format-target-*.dita` | `format-mismatch` error on `pos`, warning on `edge` (matched) |
| `dmv.ref.map.no.proper.format` | `maps/c-mapref-format-{pos,neg,edge}.ditamap` + `-sub` | `format-mismatch` error on `format="dita"` (matched) |
| `dmv.ref.res.as.dita` | `maps/c-res-as-dita-{pos,neg,edge}.ditamap` + `topics/c-res-as-dita-*` | `format-mismatch` error (matched) |
| `dmv.ref.res.as.map` | `maps/c-res-as-map-{pos,neg,edge}.ditamap` + `topics/c-res-as-map-*` | `format-mismatch` error (matched) |
| `dmv.ref.topic.as.map` | `topics/c-topic-as-map-{pos,neg,edge}.dita` + `topics/c-topic-as-map-target.dita` | `format-mismatch` error (matched) |
| `dmv.no.format.non.dita.ref` | `topics/c-no-format-nondita-{pos,neg,edge}.dita` + `topics/c-nondita-*.{pdf,bin}` | `format-missing` error (matched); Oxygen's `edge` incident carries `dmv.invalid.parse.dita.content` instead, because it tried to parse the `.bin` |
| `dmv.topicref.remote` | `maps/c-remote-{pos,neg,edge}.ditamap` | the report produced no incident for this id; the extension's `extNoFormat` covers the same shape |
| `dmv.topicref.remote.no.external.scope` | `maps/c-remote-no-external-{pos,neg,edge}.ditamap` | `external-reference` warning (matched) |
| `dmv.topicref.remote.local.scope` | `maps/c-remote-local-{pos,neg,edge}.ditamap` | `external-reference` warning (matched) |
| `dmv.topicref.ext.scope.no.format` | `maps/c-ext-scope-{pos,neg,edge}.ditamap` | `format-missing` warning (matched) |
| `dmv.ref.topic.inside.mapref` | `maps/c-mapref-children-{pos,neg,edge}.ditamap` + `-sub` + `topics/c-mapref-{parent,child}.dita` | `ignored-mapref-content` error (matched) |
| `dmv.topichead.no.navtitle` | `maps/d-topichead-{pos,neg,edge}.ditamap` | `missing-navtitle` warning (matched) |
| `dmv.topicref.no.navtitle` | `maps/d-topicref-{pos,neg,edge}.ditamap` | `missing-navtitle` warning on `edge` (matched; `pos` stays silent, as Oxygen does) |

## Parity after batch 1

`oxygen-parity.expected.json` locks **59 matched, 6 extension-only, 31 Oxygen-only**
(`scripts/oxygen-diff.cjs` agrees). Every row that does not match has a recorded reason:

**Extension-only (6).**

- `maps/a-absolute-posix.ditamap reference-syntax` — the extension reports a POSIX
  root-absolute href because it cannot be portable; Oxygen resolves it and files only
  `dmv.file.not.found`.
- `topics/c-res-as-{dita,map}-{pos.txt,edge.html} validation` — `@format="dita"` or
  `"ditamap"` makes the extraction read the non-DITA file as DITA, so its root is
  rejected. Oxygen reports the same files through `dmv.invalid.class.format` instead
  (batch validation, not implemented). The `format-mismatch` finding on the map that
  points at them is matched.

**Oxygen-only (31).**

- **`missing-reference` on a `file:` or drive-letter href (6):** `a-absolute-drive`,
  `a-absolute-fileurl`, the three `a-fileurl-*` probes and `a-unencoded-percent`. The
  crawler treats any `scheme:` URL (including `file:`) and a drive-letter path as
  remote and never probes the local file system for them; it still reports the
  spelling (`reference-syntax`) where the form is absolute. For `a-unencoded-percent`
  the extension resolves the literal `100%.dita` on disk, while Oxygen decodes the
  `%` escape and looks for a different name.
- **`unreferenced-link` (2):** `a-extra-slash-pos` — Oxygen compares the doubled-slash
  href with the map references literally, the extension normalizes it and sees
  `ok.dita` is in the map; `c-no-format-nondita-edge` — the extension only calls a
  link "not in map" when it targets a DITA topic, and this one targets a `.bin`.
- **`oxygen:dmv.no.link.keyref` (7):** a key definition whose target has no
  reference; not implemented and outside batch 1.
- **`oxygen:dmv.invalid.class.format` (7) and `oxygen:unknown` (7):** Oxygen's
  class/format validation on the non-DITA probe files (`c-guess.html`,
  `c-resource.*`, `c-res-as-*`), plus the incidents whose `problemID` is empty.
  Batch validation is out of scope (same handling as corpus 1).
- **`c-no-format-nondita-edge.dita oxygen:dmv.invalid.parse.dita.content` (1):**
  Oxygen parses the `.bin` because `@format` is missing; the extension reports the
  actionable finding (`format-missing`) on the same file, which is matched.
- **`topics/ok.dita duplicate-id` (1):** Oxygen instantiates one topic per `@copy-to`
  and sees the shared `@id` as a duplicate; the extension checks ids per file, so the
  reused topic has one.


Supporting files are not probes of their own. `topics/ok.dita` is the neutral target;
`topics/control-missing.dita` is absent on purpose (`missing-reference` on line 17 of the
root map, present in every run); the five files with reserved characters in their names
(`ok file.dita`, `中文.dita`, `ok[1].dita`, `ok#1.dita`, `100%.dita`) are published under
encoded hrefs so the raw-href probes have something that resolves; `topics/c-resource.*`
and the remaining `topics/c-*` files are the targets of the map-level probes.
