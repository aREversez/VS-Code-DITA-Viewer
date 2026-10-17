# How to run the Oxygen side (step by step)

This gets Oxygen's own findings for `corpus.ditamap` so they can be diffed
against the extension's. There are two ways to get them:

- **The GUI** (sections 0 and below) — works with the plain Windows editor, and
  is what produced the real reports so far.
- **Oxygen Scripting** (sections 1–3) — the same *Validate and Check for
  Completeness* action run headlessly from the command line, but it needs the
  paid *All Platforms* distribution plus a scripting license that this machine
  does not have. Use it when you want the run to be reproducible in CI.

## 0. The Windows editor: run it from the GUI

This checkout is paired with **Oxygen XML Editor 27** (Windows installer), which
has no `scripts\` folder and no scripting license, so sections 1–3 do not apply
here. The identical check is a GUI action:

1. Open `corpus.ditamap` in the **DITA Maps Manager**, not the text editor.
   Oxygen recognises a DITA map only through its **DOCTYPE**, which is why every
   corpus file now carries a `<!DOCTYPE …PUBLIC "-//OASIS//DTD DITA …">`. Without
   it Maps Manager says "does not appear to be a DITA map" and the completeness
   check builds no topicref graph — it crawls nothing and reports only map-level
   `dmv.invalid.class.format` (confirmed by two real runs).
2. Menu **DITA Maps → Validate and Check for Completeness…**. Tick **every**
   option except *Include remote resources* (to match `CORPUS_OPTIONS` in
   `src/test/editor/completenessHarness.ts`).
3. In the **Results** view, right-click → **Save Results as XML…** and save to
   `test-dita-file\completeness-corpus\oxygen-report.xml`. Commit it.
4. Diff from the repo root:
   `node scripts/oxygen-diff.cjs test-dita-file/completeness-corpus/oxygen-report.xml`.

The GUI report does **not** read `corpus.settings.xml`: profiling preferences are
whatever this Oxygen is configured with, so match them to `CORPUS_PREFERENCES`
(audience = novice, expert) before a clean compare, or the diff will be full of
`dmv.prof.attr.prefs.undef` on values the extension considers defined. The report
records absolute paths on this machine, so `--corpus-root` (section 4) is not
needed while it runs on this checkout.

## 1. What you need (scripting route only)

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
real Oxygen output**. It exists so the parser and the diff can be tested without
any Oxygen at all. A real `oxygen-report.xml` can already be produced from the
GUI (section 0); treat it as the authority once it exists and update
`PROBLEM_ID_CATEGORY` from the IDs it actually contains. The scripted route
(section 3) only adds CI reproducibility.

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
in **[OXYGEN-PROBLEMS.md](OXYGEN-PROBLEMS.md)**, which stands in as the parity
spec until a full GUI report (with the completeness crawl, once the map is
recognised) is committed as `oxygen-report.xml`.
