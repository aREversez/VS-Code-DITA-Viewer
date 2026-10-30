# Running the comparison on a real map

The six corpora are synthetic: every probe was written to ask one question. A real map asks
the questions nobody thought of. This is how to run the same extension-versus-Oxygen comparison
on a map that **must not leave the machine**, and what may be shared afterwards.

## What leaves the machine, and what does not

Never committed, never pasted, never sent: the map, its topics, the raw Oxygen report, the
extension's own findings, and the label table below. They name files and carry messages.

Shareable: the text `scripts/real-map-diff.cjs` prints. It holds counts per category and one line
per disagreement: an opaque label (`F001`), the file's extension, the category, which side found
it, how many findings that was, and Oxygen's problem id (a catalog constant). No path, file name,
line or message is ever written into it (`realMapDiff.test.ts` pins that). The label-to-file
table goes to a separate `*.private.json`, which `.gitignore` covers.

## Run it

1. **Oxygen.** Open the root map in the **DITA Maps Manager**, then *DITA Maps → Validate and
   Check for Completeness…* with **every** option ticked except *Include remote resources*
   (the corpus setting, `CORPUS_OPTIONS`). In the Results view: *Save Results as XML…* to a
   file outside the repository.
2. **Profiling preferences.** The GUI report uses whatever Profiling/Conditional Text preferences
   this Oxygen has; the extension knows none unless told. Write them down as a JSON file
   (`{"attributes":{"audience":["novice","expert"]},"singleValue":[]}`, the same shape as
   `CORPUS_PREFERENCES`: every attribute and value the dialog holds, `singleValue` naming the
   attributes it does not treat as multi-value) and pass `--prefs` — that is the only way
   `profiling-conflict`, `profiling-preference` and `empty-profiling-value` are compared at all.
   `--exclude profiling-preference` keeps a first run quick, but it also leaves a category
   unspoken, so say which categories a run left out when reporting it. If the map is filtered,
   pass the DITAVAL files chosen in Oxygen's dialog with `--ditaval`.
3. **Compare**, from the repository root (`npm run build:core` first on a fresh checkout):

   ```sh
   node scripts/real-map-diff.cjs --map <path>/root.ditamap --report <path>/report.xml \
     --exclude profiling-preference --private <somewhere-outside-the-repo>/labels.private.json
   ```

   The report's paths are read against the map's folder; if Oxygen ran from another location
   (another drive, a copy of the project), give that folder as `--oxygen-root`.
4. **Send back only the printed text.** Exit status is non-zero when any disagreement exists.
   After a rule changes, run the same map again: that second text is what says the difference is
   closed, not the argument that it should be.

## Reading the result

- A category with equal counts and every file matched needs nothing.
- **Oxygen only** on a category the extension implements: a gap in a rule. Report the label's
  extension, the category and the problem id; the owner looks the label up locally and writes a
  *sanitized* probe (invented names, same shape) into a corpus, which is what the clean-room
  rules ask for.
- **Extension only**: either a false positive or something Oxygen does not report. The same
  route, and the Oxygen report is the only authority for which one it is.
- **`oxygen:<id>` categories** are problem ids the adapter does not map yet. They are the list of
  work, not noise.
- `ACCEPTED_PROBLEM_IDS` (the DTD-validation ids) are left out of both sides, as in the corpus
  runs.

Nothing here changes a rule on its own. A rule changes only after a sanitized probe reproduces
the disagreement and an Oxygen run on that probe settles it (CLEAN-ROOM.md, working loop).

## What one run proves

One map touches the categories it happens to use and says nothing about the rest. A clean text
means "no gap among the categories it lists", never "the rules are right on real maps"; the
printed counts per category are the measure of how much of the rule set a map actually asked.

The first run on a map is the demonstration: every category agreed but one, `duplicate-key`,
where Oxygen filed a key map's own file twelve times and the extension not at all. No probe had
asked that shape — corpus 1's two definitions sat in one file, so both lines fell under one
signature and the rule could file the later one alone. Four sanitized probes, with a control
beside them, answered it (`../completeness-corpus-6/README.md`, "Duplicate keys across files");
the rule was fixed on them, and a re-run of the same map then matched on all thirteen of its
signatures with nothing in either direction. That is the loop working end to end: a real map
finds the question, a corpus answers it, the same map confirms it.

The cheapest next step is another map of a different **structure**, not more probing of a shape
that already agrees: a bookmap, a map whose keys come from several scopes, one whose content is
mostly `conref`/`conkeyref`, or one built with a DITAVAL filter. Each brings categories the first
map never touched, and with `--prefs` supplied the profiling categories come along.

When no second map is at hand, `../real-map-sample/` stands in for one: invented content, so it
can be committed, shaped as a bookmap of chapter maps with keyscopes, a conref library, a
resource-only key and a DITAVAL filter. Its first two runs matched 18 of 19 signatures and, once
R034 was widened and the fixture stopped writing `@deliveryTarget`, 19 of 20. The README separates
the rows that were the fixture's own DTD breaks (now fixed) from the boundaries the run exposed,
two of which are settled: `external-reference` on a topic's `xref` is now R034, with that run as
the evidence, and `@deliveryTarget` turned out not to be one of the profiling attributes Oxygen
defines for DITA at all, so the sample stopped writing it rather than carry a row one tool can
never file. `summarizeRealMapDiff` also now folds `missing-resource` into `missing-reference` the
way the corpus parity already did.
