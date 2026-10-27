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

The 18 Oxygen problem ids of batch 2 (`../completeness-corpus/BATCH-2.md`), one rule per
file, each with `pos` (must report), `neg` (must not) and `edge` (the boundary). The run
below covers all of them: 15 ids are implemented as seven new categories, one more through
the existing `undefined-key` (a key from a peer map is undefined in this build), and two are
*n/a* because Oxygen stayed silent on their probes. Every id and its status is recorded in
`../completeness-corpus/OXYGEN-PROBLEMS.md`.

| Rule | Probes | What the probes hold |
| --- | --- | --- |
| `dmv.id.miss.conref` | `topics/e-id-miss-conref-{pos,neg,edge}.dita` | file without a fragment; full `#topic/element`; fragment naming only the topic |
| `dmv.conref.siblings` | `topics/e-conref-siblings-{pos,neg,edge}.dita` | `conrefend` in another parent (body vs section); sibling paragraphs; range that starts and ends at one `p` |
| `dmv.conref.proper.order` | `topics/e-conref-order-{pos,neg,edge}.dita` | forward range; reversed range; single element |
| `dmv.conrefend.no.conref` | `topics/e-conrefend-no-conref-{pos,neg,edge}.dita` | `conrefend` alone; with `conref`; `conref=""` |
| `dmv.conrefend.confl.conref` | `topics/e-conrefend-confl-{pos,neg,edge}.dita` | root topic to nested topic; both in one topic; both in the nested topic |
| `dmv.no.conref.has.target.attr.value` | `topics/e-target-attr-{pos,neg,edge}.dita`, `maps/e-target-attr.ditamap` | value without `conref`; with `conref`; with `conkeyref` |
| `dmv.conkeyref.peer.map` | `topics/e-conkeyref-peer-{pos,neg,edge}.dita`, `maps/e-conkeyref-peer{,-keys,-sub}.ditamap` | key in a `scope="peer"` map; in the same map; in a local submap |
| (R019) a conref or conkeyref to a file that does not exist | `topics/e-conref-missing-file-{pos,edge}.dita`, `maps/e-conref-missing-key.ditamap` | a conref to an absent file; a conkeyref through a key whose file is absent | `missing-reference` on the topic (pos) and on the map that defines the key (edge); the run below files both as `dmv.file.not.found`, and adds a third incident on the conkeyref's own element (Oxygen-only) |
| `dmv.invalid.ref.id` | `topics/f-invalid-ref-id-{pos,neg,edge}.dita` | missing element via conref; existing; missing element via xref |
| `dmv.invalid.ref.id.path` | `topics/f-ref-id-path-{pos,neg,edge}.dita` | missing id path; single element id; existing two-segment path (section then paragraph) |
| `dmv.invalid.ref.id.path.keyref.elemid` | `topics/f-keyref-elemid-{pos,neg,edge}.dita`, `maps/f-keyref-elemid.ditamap` | conkeyref to a missing element; existing; xref keyref with the same suffix |
| `dmv.bad.id.ref` | `topics/f-bad-id-ref-{pos,neg,edge,empty-topic}.dita` | trailing slash; well-formed; `#./element` same-topic form; empty topic segment `#/element` |
| `dmv.topicref.to.element` | `maps/f-topicref-to-element-{pos,neg}.ditamap`, `topics/f-topicref-to-element-edge.dita`, `topics/lib2-{pos,neg}.dita` | topicref to an element id; to the topic id; the same element through an xref |
| `dmv.circular.keyref` | `maps/g-circular-keyref-{loop,self,chain}.ditamap`, `topics/g-circular-keyref-chain.dita` | `a` and `b` to each other; a self-redirect; `a` to `b` to `c` ending at a topic |
| `dmv.no.link.keyref` | `topics/g-link-keyref-{pos,neg,edge}.dita`, `maps/g-link-keyref.ditamap` | xref to a text-only key; to a key with `href`; a `link` through the text-only key |
| `dmv.link.no.target` | `topics/g-link-no-target-{pos,neg,edge}.dita` | xref with neither `href` nor `keyref`; xref with `href`; xref fed by `conref` (known pitfall) |
| `dmv.empty.link.peer.target` | `topics/g-empty-peer-link-{pos,neg,edge}.dita` | peer xref without text; with text; local xref without text |
| `dmv.ref.to.resource.only` | `topics/g-resource-only-{pos,neg,edge}.dita`, `topics/{resource-only,published,resource-only-shared}.dita`, `maps/g-resource-only-edge.ditamap` | xref to a resource-only topic; to a normally published one; link to a topic published both ways (known pitfall) |
| `dmv.dup.el.id` | `topics/h-dup-el-id-{pos,neg,edge}.dita` | two elements with one id; nested topics reusing an id; element id equal to the topic id |

`topics/lib.dita` is the shared conref source; `topics/e-conref-control.dita` consumes every
reusable element in it, so probes against it do not also report `unreferenced-reusable`.
`topics/lib2-{pos,neg}.dita` are separate targets so the two `topicref.to.element` maps do
not turn into a `multiple-reference` finding. The resource-only edge keeps its two
references to one file apart with a `@copy-to` for the same reason. None of the probes
depends on the OS or the file system, so this corpus needs no `PLATFORM_DEPENDENT_FILES`
entry.

## The Oxygen run and its outcome

*Validate and Check for Completeness* ran with `corpus.ditamap` as the only open root map
(every option on, remote off). The report says `Keys are gathered from: corpus.ditamap`, and
the control `topics/control-missing.dita` at line 11 is present, so it is a run of this map.
It was then rerun once, for the two R019 probes of a conref and a conkeyref to a file that does
not exist; the rerun produced 34 incidents, saved as `oxygen-report.raw.xml` and sanitized to
`oxygen-report.xml`. `node scripts/oxygen-diff.cjs --corpus completeness-corpus-3
test-dita-file/completeness-corpus-3/oxygen-report.xml` reports:

```
29 extension findings, 34 incidents, 29 matched, 0 extension-only, 5 Oxygen-only
```

The three Oxygen-only rows of the first run are unchanged, each with its reason in
`../completeness-corpus/OXYGEN-PROBLEMS.md`:

- `topics/e-conrefend-no-conref-edge.dita` `oxygen:unknown` — "Empty reference value." has
  no problem id; the same element's `dmv.conrefend.confl.conref` is matched.
- `topics/e-id-miss-conref-edge.dita` `dmv.invalid.class.generalization` — a conref that
  names a whole topic; class checking is batch 4.
- `topics/f-bad-id-ref-empty-topic.dita` `oxygen:unknown` — "Invalid anchor" has no problem
  id; the trailing-slash probe matches.

The rerun answers R019 and adds two rows:

- A conref or conkeyref to a file that does not exist is `dmv.file.not.found` — the id of an
  ordinary dangling reference, never the `dmv.reference.not.exist` the catalog lists. That is
  what moves both new extension findings into the matched set.
- `topics/e-conref-missing-file-edge.dita` `missing-reference` — the edge probe draws a second
  incident, on the conkeyref's own element, beside the matching one on the keydef
  (`maps/e-conref-missing-key.ditamap:7`). The extension keeps a broken href at the element
  that writes it, so a key-based reference to an absent file is one finding, not two; this row
  is the open parity work.
- `maps/e-conref-missing-key.ditamap` `unreferenced-key` — Oxygen also calls the key whose
  target file is missing an unreferenced definition, although
  `topics/e-conref-missing-file-edge.dita` names it; the extension counts that use, so the key
  is referenced.

The same file records two ids as *n/a*: `dmv.circular.keyref` and
`dmv.empty.link.peer.target` produced no incident on their probes, and the extension is
silent on the same files.

## Baseline and parity

`baseline.extension.json` holds the 29 findings the extension produces on this corpus (the
control plus the 28 probe findings). `oxygen-parity.expected.json` locks the parity state
above. Refresh them with `--update` and `UPDATE_OXYGEN_PARITY=1` as described under
"Running it".
