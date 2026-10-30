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
   this Oxygen has; the extension knows none unless told. Either write them down as a JSON file
   (`{"attributes":{"audience":["novice","expert"]},"singleValue":[]}`, the same shape as
   `CORPUS_PREFERENCES`) and pass `--prefs`, or leave profiling out of both sides with
   `--exclude profiling-preference`. If the map is filtered, pass the DITAVAL files chosen in
   Oxygen's dialog with `--ditaval`.
3. **Compare**, from the repository root (`npm run build:core` first on a fresh checkout):

   ```sh
   node scripts/real-map-diff.cjs --map <path>/root.ditamap --report <path>/report.xml \
     --exclude profiling-preference --private <somewhere-outside-the-repo>/labels.private.json
   ```

   The report's paths are read against the map's folder; if Oxygen ran from another location
   (another drive, a copy of the project), give that folder as `--oxygen-root`.
4. **Send back only the printed text.** Exit status is non-zero when any disagreement exists.

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
