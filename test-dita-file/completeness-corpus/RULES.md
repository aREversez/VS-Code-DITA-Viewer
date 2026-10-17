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

Not allowed anywhere in a reference: Oxygen's compiled classes or anything read from
them. `legacy` is only for the grandfathered rows `R001`–`R015` below; every new rule
needs a real source and a corpus probe (a path under `completeness-corpus/`).

Severity is not a rule property here: it is taken from real Oxygen reports and is
provisional until then. It does not take part in the parity signature
(`(file, category)`).

## Rules

| ID | Category | Rule | Source | Reference | Probe |
| --- | --- | --- | --- | --- | --- |
| R001 | `validation` | file is not well-formed, or root/`@id`/`<title>` is missing | legacy | — | — |
| R002 | `missing-reference` | a reference (map, topic, keyref target, conref) points at a file that does not exist | legacy | — | — |
| R003 | `undefined-key` | a `@keyref` names no key definition | legacy | — | — |
| R004 | `missing-resource` | a referenced non-DITA file is missing | legacy | — | — |
| R005 | `remote-resource` | an HTTP(S) reference does not answer a HEAD request (extension-only) | legacy | — | — |
| R006 | `outside-folder` | a reference leaves the root map's folder | legacy | — | — |
| R007 | `unreferenced-link` | a link/xref target is not reachable from the map | legacy | — | — |
| R008 | `multiple-reference` | a topic is referenced more than once from the map | legacy | — | — |
| R009 | `duplicate-id` | two topics share an `@id` | legacy | — | — |
| R010 | `duplicate-key` | the same key is defined twice in one scope | legacy | — | — |
| R011 | `unreferenced-key` | a key is defined but never used | legacy | — | — |
| R012 | `unreferenced-reusable` | a reusable element is never the target of a conref | legacy | — | — |
| R013 | `table-layout` | CALS/simple table column or row inconsistencies (extension-only) | legacy | — | — |
| R014 | `profiling-conflict` | profiling attribute values conflict with the DITAVAL filter | legacy | — | — |
| R015 | `profiling-preference` | a profiling value is not in the allowed preferences | legacy | — | — |
