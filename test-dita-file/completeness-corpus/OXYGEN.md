# How to run the Oxygen side (step by step)

This gets Oxygen's own findings for `corpus.ditamap` so they can be diffed
against the extension's. It uses **Oxygen Scripting**, which is the same
*Validate and Check for Completeness* action, run from the command line.

## 1. What you need

- The **Oxygen XML Editor All Platforms distribution** (this is Oxygen
  Scripting): download `oxygen.tar.gz` from
  <https://www.oxygenxml.com/xml_scripting/download.html>, extract it to a
  folder of its own (e.g. `C:\OxygenAll`). It is the only distribution that has
  a `scripts\` folder — the Windows editor install does **not**.
- A **scripting license key**: save it as `scriptinglicensekey.txt` in that
  folder (the parent of `scripts\`).
- **Java 11 or 17** on `PATH`.

Quick check that it's the right folder:

```
C:\OxygenAll\scripts\validateCheckDITA.bat      <- must exist (Windows)
C:\OxygenAll\scriptinglicensekey.txt            <- your license key
```

## 2. Export the options once (in the Oxygen GUI)

The script takes its checks from a settings file that only the GUI can produce:

1. Open the DITA map (`test-dita-file\completeness-corpus\corpus.ditamap`) in
   Oxygen.
2. *DITA Maps Manager → Validation → Validate and Check for Completeness*.
3. Tick **every** option except *Include remote resources* (so it matches
   `CORPUS_OPTIONS` in `src/test/editor/completenessHarness.ts`).
4. Click *Export settings* and save as
   `test-dita-file\completeness-corpus\corpus.settings.xml`. Commit it.

Without this file the diff still runs, but it compares *options* instead of
algorithms, which is not what we want.

## 3. Run it — one command

From the repo root (PowerShell or cmd):

```powershell
npm run check:completeness:run -- "C:\OxygenAll"
```

That wrapper (`scripts/run-oxygen-completeness.cjs`):

1. finds `validateCheckDITA.bat` in that folder,
2. runs it on `corpus.ditamap` with `corpus.settings.xml`,
3. writes `test-dita-file\completeness-corpus\oxygen-report.xml`,
4. runs the diff and prints the parity result.

You can also set `OXYGEN_SCRIPTING_HOME` instead of passing the path.

### Manual equivalent (if you prefer)

```bat
cd C:\OxygenAll\scripts
validateCheckDITA.bat ^
  -i <repo>\test-dita-file\completeness-corpus\corpus.ditamap ^
  -s <repo>\test-dita-file\completeness-corpus\corpus.settings.xml ^
  -r <repo>\test-dita-file\completeness-corpus\oxygen-report.xml
```

(replace `<repo>` with the path to your checkout)

then, from the repo root:

```powershell
node scripts/oxygen-diff.cjs test-dita-file/completeness-corpus/oxygen-report.xml
```

On Linux/macOS run `scripts/validateCheckDITA.sh` the same way.

## 4. Running it on another machine

The report records absolute file paths. If Oxygen runs somewhere other than this
checkout (or on a copy of the corpus), tell the diff what root those paths are
relative to:

```powershell
node scripts/oxygen-diff.cjs <report> --corpus-root "<that machine's>/test-dita-file/completeness-corpus"
```

## Reading the result

`node scripts/oxygen-diff.cjs` prints, and exits non-zero if anything differs:

- **Oxygen problem IDs not yet mapped** — copy the confirmed ones into
  `PROBLEM_ID_CATEGORY` in `src/test/editor/oxygenReport.ts`, so the next run
  compares categories like-for-like.
- **extension only** / **Oxygen only** — signatures of `file` + `category`. This
  is the parity result. Wording and line numbers are ignored on purpose.

The report may be XML or JSON; the parser auto-detects both.

## The sample file

`oxygen-report.sample.xml` is **hand-built from the documented structure, not
real Oxygen output**. It exists so the parser and the diff can be tested before
a real report is available. Once step 3 succeeds, treat the real
`oxygen-report.xml` as the authority (you can commit it too, since it is now
reproducible) and update `PROBLEM_ID_CATEGORY` from it.

## Probes to look for in the diff

These corpus files are expected to differ, confirming the suspected gaps (full
list in `README.md`):

- `topics/invalid.dita` — schema-invalid but well-formed → expect **Oxygen only**
  (the extension has no DTD/RNG validation).
- `keydef keys="kusekey"` + two `topicref keyref="kusekey"` in `corpus.ditamap`
  → *(fixed)* the extension now resolves keyrefs; the two references produce a
  `multiple-reference`, matching Oxygen.
- `topicref keyref="nosuchkey"` → the extension reports `undefined-key`
  (`dmv.undef.key`).

The full list of Oxygen problem IDs and the extension's status against each is
in **[OXYGEN-PROBLEMS.md](OXYGEN-PROBLEMS.md)**, which is the parity spec now
that a real report needs a license we do not have.
