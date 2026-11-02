# What the completeness check does not do

The parity work stopped when six synthetic corpora, two real maps and one invented sample all
agreed with Oxygen's *Validate and Check for Completeness* on `(file, category)`, with no open row.
This page is the other half of that statement: what that agreement does not cover. Each entry is
either a deliberate boundary (a product decision, not a defect) or an area no run has reached.
Nothing here is a known wrong answer; a wrong answer would be a row in `OXYGEN-PROBLEMS.md`.

## Deliberate boundaries

| Boundary | What the extension does | Where it is recorded |
| --- | --- | --- |
| **No DTD / schema validation** | The three schema ids (`MSG_ELEMENT_NOT_DECLARED`, `MSG_ATTRIBUTE_NOT_DECLARED`, `MSG_CONTENT_INVALID_UNEXPECTED_ELEMENT`) and the "no schema or DTD associated" text are listed as accepted differences; `oxygen-diff` prints them and keeps them out of the exit code. A file that is well-formed but invalid against its grammar is clean here. | `ACCEPTED_PROBLEM_IDS` / `ACCEPTED_DESCRIPTIONS` in `src/test/editor/oxygenReport.ts`; `BATCH-4.md` option 3; `OXYGEN-PROBLEMS.md` |
| **No subject schemes** | Five corpus-4 runs never made Oxygen evaluate a scheme, so the three `dmv.prof.sbj.*` ids have no observed shape and no category exists for them. A scheme's `subjectdef` keys read as undefined keys, as they do in Oxygen. | `OXYGEN-PROBLEMS.md` (batch 3 notes); `completeness-corpus-4/README.md` |
| **Remote resources are probed on request only** | `remote-resource` runs only with the dialog option *Also check remote (http/https) resources*, by a HEAD request. Every comparison run left it off, so its parity with Oxygen is unmeasured. | `completenessCheckUi.ts`; `OXYGEN.md` |
| **Keyref redirect chains and peer maps are not followed** | A key that redirects to another key is not followed, so `dmv.circular.keyref` is silent (Oxygen filed nothing for the loop probes either). A key inside a peer map is undefined, which is how Oxygen files it (`dmv.key.undef`). | `OXYGEN-PROBLEMS.md`: `dmv.circular.keyref`, `dmv.conkeyref.peer.map` |
| **One root map per run** | The check crawls the map you pick; it does not merge several roots, and a key space defined by another root is not visible. | `completenessCheckUi.ts` (`crawlMaps([map], …)`) |
| **Profiling preferences are read from the extension's own settings** | Oxygen's Profiling/Conditional Text page is a setting of the installed editor and cannot be read from here. A comparison against a real Oxygen run must be given the same values (`--prefs`) or leave `profiling-preference` out. | `REAL-MAP.md` |

## Areas no comparison has reached

These are not known gaps. They are rules whose parity rests on synthetic probes only, because no
real map in the runs triggered them.

- **`profiling-preference`** was left out of both real-map comparisons (no `--prefs`). It is locked
  on the corpora, and the invented sample was compared with its preferences given.
- **A DITAVAL-filtered run against a real map** has not been compared with an Oxygen run that had
  the same DITAVAL chosen in its dialog; corpus 4 is the only evidence. A filtered extension run
  against an unfiltered Oxygen report makes every filtered-out key, id and reference one-sided
  (`REAL-MAP.md`).
- **Categories the real maps did not trigger.** The two real maps drew duplicate keys, unreferenced
  keys and reusables, multiple and invalid id references, profiling conflicts and id syntax. Format,
  scope, class, table, resource, outside-folder and navigation rules were exercised by the corpora
  and the sample, not by a customer map.
- **Class defaults** come from a built-in table. `scripts/dita-class-diff.md` records 61 entries
  where the OASIS DTD extraction and the table differ in base type, each marked as needing manual
  verification; no run has shown that to change a finding.
- **Ids "mapped only".** `OXYGEN-PROBLEMS.md` marks a problem id *mapped only* when the catalog
  names it and a category answers it, but no report has carried it (for instance
  `dmv.invalid.id.syntax.2` and `.3`, which Oxygen files under other ids). The category is
  exercised; the id itself has not been seen. The `@id` of the `<dita>` container is a related case:
  it is read as a name token, as the spec's table implies, until a real row says otherwise.
- **Platform-dependent probes** (`PLATFORM_DEPENDENT_FILES`) are compared on Windows only, because
  their reports come from a Windows Oxygen and the answer depends on the file system.

## Behaviour that is by design

- **Results are a snapshot.** The check reads the files when it runs; the Results list does not
  update when a file changes afterwards, and a re-run is how to refresh it.
- **Messages and severities are the extension's own.** Parity is on `(file, category)`; wording,
  line, column and severity are not compared, and severity is taken from real reports only where a
  rule's ledger row says so.
- **Oxygen version.** The reports were produced by Oxygen XML Editor 27.x on Windows. A different
  version may file different ids; `unmappedProblemIds` in `oxygen-diff` lists the ones the adapter
  does not know.

## If you want to move one of these

Use the loop in `CLEAN-ROOM.md`: write a probe for the shape, register what each possible Oxygen
answer would change, have Oxygen run it, and change the extension only when a report says so. For a
real map that cannot be committed, `REAL-MAP.md` runs the same comparison and prints a summary that
is safe to share. A boundary above becomes a rule only after a report gives it a shape.
