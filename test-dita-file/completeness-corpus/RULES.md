# Rule ledger — where every completeness check comes from

One row per rule the completeness check implements. A rule without a row, or with
an unacceptable source, fails `ruleLedger.test.ts`. The ledger is how this project
keeps the check aligned with Oxygen **without** reading or reproducing Oxygen's
compiled code: every rule must say what it rests on.

## Sources a rule may cite

| Source | Meaning | Reference column holds |
| --- | --- | --- |
| `spec` | the published DITA 1.3 specification | the spec page or element/attribute, e.g. `archSpec/base/using-keys-for-addressing` |
| `dita-ot` | behaviour of the open-source DITA-OT (Apache-2.0) | the DITA-OT message id or source file, e.g. `DOTJ047I`, `KeyrefReader.java` |
| `oxygen-report` | an actual Oxygen report for a corpus probe | the probe, e.g. `topics/idspace.dita` |
| `catalog` | a problem id and message from Oxygen's message catalog (a data file, not code) | the id, e.g. `dmv.undef.key` |
| `own` | the project's own product decision, not an Oxygen behaviour | one line of reasoning |
| `legacy` | written before this ledger existed; the source is still to be established | `—` |

All fifteen grandfathered rows now have a source, so no row below is `legacy`;
the value is kept only so `ruleLedger.test.ts` still guards the rule. Where a row
cites `catalog` or names an Oxygen finding, that citation comes from the working
notes in [OXYGEN-PROBLEMS.md](OXYGEN-PROBLEMS.md), not from the current install.

The `dita-ot` message ids are quoted from the DITA-OT install's
`config/messages_en_US.properties` and spot-checked there. Two were wrong and are
corrected: R018 cited `DOTX002W` (which is the map `@title` for Eclipse output, not
a topic's `<title>` — the authority there is `topicMod.xsd` alone), and R019 cited
`DOTJ013E`/`DOTJ043W` (parse-failure and conref-push, not "target not found") —
replaced with `DOTX010E`/`DOTJ046E`.

Not allowed anywhere in a reference: Oxygen's compiled classes or anything read from
them. `legacy` is only for the grandfathered rows `R001`–`R015`; every new rule
needs a real source and a corpus probe (a path under `completeness-corpus/`).

Severity is not a rule property here: it is taken from real Oxygen reports and is
provisional until then. It does not take part in the parity signature
(`(file, category)`).

## Rules

The rule text is what this extension's code actually does, written from
`src/editor/mapChecks.ts` and `src/editor/mapCrawl.ts`. None of it is final
Oxygen behaviour until a real Oxygen report covers the probe (round 2 of the
clean-room loop).

| ID | Category | Rule | Source | Reference | Probe |
| --- | --- | --- | --- | --- | --- |
| R001 | `validation` | a crawled file cannot be read, or is not well-formed XML | spec | XML 1.0 well-formedness; DITA-OT stops with `DOTJ012F`/`DOTJ034F` when a parse fails | `topics/malformed.dita` |
| R016 | `validation` | a map file's root is not a map, or a topic file's root is not a topic type | dita-ot | the v1.3 grammars ship with DITA-OT and fix the roots: `schema/base/xsd/topicMod.xsd`, `.../mapMod.xsd`; `DOTJ034F` | `topics/twoidsa.dita` |
| R017 | `validation` | a topic-type element has no `@id` | dita-ot | `topicMod.xsd` declares `@id` `use="required"` type `xs:ID` on `<topic>`; `DOTJ067E` "No @id attribute on topic type element" | `topics/twoidsa.dita` |
| R018 | `validation` | a topic element has no `<title>` child | dita-ot | `topicMod.xsd` `topic.content` lists `<title>` as the first child with no `minOccurs="0"`, so it is required; no DITA-OT message asserts this (`DOTX002W` is the map `@title` for Eclipse output, not a topic's `<title>`) | `topics/twoidsa.dita` |
| R002 | `missing-reference` | a local DITA reference (topicref, mapref, keyref target) resolves to a file that does not exist; the probe is the map carrying the dangling `topics/missing.dita` href | catalog | `dmv.file.not.found` | `corpus.ditamap` |
| R019 | `missing-reference` | `@conref` / `@conkeyref` resolves to no retrievable target | catalog | `dmv.reference.not.exist`; DITA-OT `DOTX010E` "Unable to find the @conref target ... see if the target resource exists" and `DOTJ046E` "@conkeyref ... cannot be resolved" | `topics/reuse.dita` |
| R020 | `invalid-ref-topic-id` | a `@conref` reaches a target file that exists, but its topic-id segment names no topic in it. The fragment forms checked: `file#topicID` and `file#topicID/elemID` (and the same-file `#topicID[…]`) look that id up; `#.` and `#./elemID` are the same-topic marker and name no topic id; a target file never crawled is skipped (its missing-file finding is R002/R019) | spec | `archSpec/base/uri-based-addressing`: the topic-id segment must match a topic element's `@id`, with `.` standing for the current topic; Oxygen files it as `dmv.invalid.ref.topic.id` | `topics/linker2.dita` |
| R021 | `invalid-ref-topic-id` | the same-topic conref forms `#./elemID` (and `#.`) are not reported: `.` stands for the topic that holds the reference, so there is no topic id to look up | spec | `archSpec/base/uri-based-addressing`: the same-topic fragment `.`; confirmed against a real Oxygen report — the `conref-forms.dita` probe (`#conrefforms/src` and `#./src`) produced no incident in Oxygen, matching the extension | `topics/conref-forms.dita` |
| R022 | `profiling-conflict` | the same conflict as R014, with values that are all in the preference list (`expert` inside a cascaded `novice`), so Oxygen's ineffective-condition rule can apply | spec | `archSpec/base/evaluating-conditional-processing-attributes`; the real report decides whether Oxygen agrees | `topics/profiling-defined.dita` |
| R003 | `undefined-key` | a `@keyref` matches no key definition in its key space; when the key is defined the element's `@href` is dropped, when it is not the `@href` stays and answers for the reference | catalog | `dmv.undef.key`; DITA-OT `DOTJ047I`/`DOTJ048I` say the fallback is used "if it exists"; spec `archSpec/base/using-keys-for-addressing` | `corpus.ditamap` |
| R004 | `missing-resource` | a non-DITA resource (`image`/`object`/`data`/phrase hrefs) names a local file that does not exist | dita-ot | `DOTJ023E` image not available, `DOTJ051E` coderef target; spec `archSpec/base/uri-based-addressing` | `topics/resources.dita` |
| R005 | `remote-resource` | with remote probing on, an HTTP(S) resource href does not answer a HEAD request | own | this extension's addition: Oxygen has no catalog id for it and DITA-OT never probes the network, so it is opt-in and warning-only | `topics/remote.dita` |
| R006 | `outside-folder` | a resolved local target lies outside the root map's folder | catalog | `dmv.external.references.map`; DITA-OT keeps this fatal by default: `DOTJ035F` with the `outer.control` parameter | `topics/outside.dita` |
| R007 | `unreferenced-link` | an `xref`/`link`, or a topicref inside a reltable, points at a topic no plain topicref or keydef in the crawled maps references | catalog | `dmv.not.topic.ref.in.map`, `dmv.not.topic.ref.reltable.in.map`; DITA-OT loses generated link text for such targets: `DOTX023W`/`DOTX026W` | `topics/linker.dita` |
| R008 | `multiple-reference` | the same DITA target is referenced by 2+ plain topicrefs; a distinct `@copy-to` per reference makes each a different topic. A `@keyref` on an element that cannot carry `@href` (`<ph>`, `<keyword>`, `<term>`) borrows the key's text and forms no link, so it never counts | catalog | `dmv.dup.topic`; spec `archSpec/base/processing-keyref-on-topicref` for key-resolved references, `archSpec/base/processing-keyref-for-text` rule 2 for text-only keyrefs | `topics/multi.dita` |
| R009 | `duplicate-id` | two topic-type elements (root or nested) share an `@id` inside the map context | spec | `archSpec/base/id`: IDs must be unique within a topic, and `@id` on topic/map elements is an XML ID, unique within the document | `topics/twoidsa.dita` |
| R010 | `duplicate-key` | two definitions bind the same key name inside one key scope; the first is kept, later ones reported | catalog | `duplicate.key.definition`; spec `archSpec/base/keys-core-concepts` (effective definition = first); DITA-OT `DOTJ045I` | `corpus.ditamap` |
| R011 | `unreferenced-key` | no `@keyref`/`@conkeyref` in the crawled maps uses a defined key | catalog | `dmv.not.used.key.defs`; the spec does not require keys to be used, which is why this is opt-in | `corpus.ditamap` |
| R012 | `unreferenced-reusable` | an element with an `@id`, in a topic reachable only as a resource-only target or as a conref source, is never a conref/conkeyref target; a direct conref whose topic id does not resolve (R020) does not count as a use | own | candidate set is this extension's heuristic; the reuse semantics it leans on are spec `archSpec/base/conref-overview` | `topics/reuse.dita` |
| R013 | `table-layout` | CALS and simple-table layout: `tgroup/@cols` required and matching the colspec count, row entries filling the columns, `namest`/`nameend` naming declared columns, simple-table rows the width of the head | dita-ot | `DOTJ063E` "@cols is set to X but the number of colspec elements was Y"; `schema/base/xsd/tblDeclMod.xsd` (`cols` `use="required"`) | `topics/tables.dita` |
| R014 | `profiling-conflict` | a descendant's values for a profiling attribute share no value with the cascaded ancestor set, so the element can never survive filtering | spec | `archSpec/base/conditional-processing-attributes` plus `archSpec/base/evaluating-conditional-processing-attributes` (ancestor and descendant conditions combine); the catalog maps it to `dmv.prof.attr.innef.cond`, not yet confirmed by a real report (see R022) | `topics/profiling.dita` |
| R015 | `profiling-preference` | a profiling attribute, or one of its values, is outside the configured preference list; a single-value preference carrying several values is reported too | catalog | `dmv.prof.attr.prefs.undef`, `dmv.prof.attr.val.prefs.undef` | `topics/profiling.dita` |
