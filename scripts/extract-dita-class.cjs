// Extracts every DITA element's @class default value from the DITA-OT DTD
// module files, derives the base type (first module/tag pair in the class
// chain), and produces an auditable three-way diff against the hand-maintained
// tag→baseType maps, which live in @dita-viewer/core (parser/standardTagMap
// and mapTagMap); the installed package's dist/ is what is read.
//
// Re-run this whenever DITA-OT is upgraded or a new specialization plugin is
// installed:  node scripts/extract-dita-class.cjs
//
// Use --diff-only to recompute the diff against the existing
// dita-class-extracted.json without rescanning the DTD (e.g. on a machine
// without the DITA-OT install) after the maps in @dita-viewer/core changed
// and a new version is installed:  node scripts/extract-dita-class.cjs --diff-only
//
// It writes two artifacts next to itself for review:
//   - dita-class-extracted.json   (full table with source file:line evidence)
//   - dita-class-diff.md          (new entries + conflicts + missing renderers)
//
// The same scan also writes the runtime table the completeness checks use:
//   node scripts/extract-dita-class.cjs --emit-module
//     -> src/parser/ditaClassDefaults.ts (plus the two JSON artifacts above)
//
// and verifies it without the DTDs, so `npm run verify` never needs DITA-OT:
//   node scripts/extract-dita-class.cjs --check-module
//     -> compares the committed module with the committed JSON, exit 1 on drift
//        (read-only: no DTD rescan, no file is written)
// A DTD rescan under --emit-module is the only step that needs the DTDs; it is
// manual and deliberately outside `npm run verify`.
//
// The DTD root is resolved in this order (no machine-specific path is baked in):
//   1. --dita-root <dir>  (DITA-OT install root; the v1.3 plugin lives under <dir>/plugins)
//   2. DITA_DTD_ROOT env var (points directly at the dtd directory)
//   3. auto-discovery: the `dita` launcher found on PATH, walked up to its
//      install root (Windows resolves the .bat shim; symlinked bins resolve too)
// If none works, the script fails with instructions rather than guessing.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DITA13_PLUGIN = path.join('org.oasis-open.dita.v1_3', 'dtd');
// Machine-independent identity written into the committed artifacts instead of
// the resolved absolute root, so the file doesn't churn per developer machine.
const DITA13_PLUGIN_ID = 'org.oasis-open.dita.v1_3/dtd';

function resolveDtdRoot() {
  // 1. --dita-root flag
  const flagIndex = process.argv.indexOf('--dita-root');
  if (flagIndex !== -1) {
    const root = process.argv[flagIndex + 1];
    if (!root) fail('--dita-root requires a directory argument');
    return path.join(root, 'plugins', DITA13_PLUGIN);
  }
  // 2. DITA_DTD_ROOT env var
  if (process.env.DITA_DTD_ROOT) return process.env.DITA_DTD_ROOT;
  // 3. discover the `dita` launcher on PATH
  const launcher = whichLauncher();
  if (launcher) {
    // <install>/bin/dita[.bat] -> two levels up is the install root
    const binDir = path.dirname(launcher);
    const installRoot = path.dirname(binDir);
    const candidate = path.join(installRoot, 'plugins', DITA13_PLUGIN);
    if (fs.existsSync(candidate)) return candidate;
  }
  fail(
    'Cannot locate the DITA 1.3 DTDs. Pass --dita-root <DITA-OT install dir>,\n' +
      'set DITA_DTD_ROOT to the dtd directory, or put the `dita` launcher on PATH.\n' +
      '(Running without the DTDs? Use --diff-only to recompute the diff against the\n' +
      ' cached extraction, or --check-module to verify the runtime table against it.)'
  );
}

function whichLauncher() {
  try {
    const out =
      process.platform === 'win32'
        ? execFileSync('where.exe', ['dita'], { encoding: 'utf8' })
        : execFileSync('which', ['dita'], { encoding: 'utf8' });
    const first = out.split(/\r?\n/).find((l) => l.trim());
    if (!first) return null;
    return fs.realpathSync(first.trim());
  } catch {
    return null;
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// Resolved lazily in main(): --diff-only never touches the DTDs and must work
// on a machine without a DITA-OT install.
let DITA_DTD_ROOT = null;

// Specialization modules to scan. learning/ and machineryIndustry/ are skipped
// for now (cold modules); they can be added later without code changes.
const SCAN_DIRS = ['base', 'technicalContent', 'bookmap'];
const SCAN_EXT = new Set(['.mod', '.ent', '.dtd']);
// Foreign-namespace subdirectories that aren't DITA elements (MathML/SVG).
const SKIP_DIR_NAMES = new Set(['mathml', 'svg']);

const REPO_ROOT = path.join(__dirname, '..');
// The maps and renderer tables are @dita-viewer/core's. Its package exports do
// not reach the private renderer tables, and the regexes below read text anyway,
// so read the published dist/*.js files (identical text for these literals).
const CORE_DIST = path.join(REPO_ROOT, 'node_modules', '@dita-viewer', 'core', 'dist');
const STANDARD_MAP_SRC = path.join(CORE_DIST, 'parser', 'standardTagMap.js');
const MAP_MAP_SRC = path.join(CORE_DIST, 'parser', 'mapTagMap.js');
const BASE_RENDERER_SRC = path.join(CORE_DIST, 'render', 'baseTypeMap.js');
const MAP_RENDERER_SRC = path.join(CORE_DIST, 'render', 'mapTypeMap.js');

const EXTRACTED_JSON = path.join(__dirname, 'dita-class-extracted.json');
const DIFF_MD = path.join(__dirname, 'dita-class-diff.md');
const CLASS_MODULE = path.join(REPO_ROOT, 'src', 'parser', 'ditaClassDefaults.ts');

// ── 1. Walk DTD files ────────────────────────────────────────────────

function listDtdFiles(root) {
  const out = [];
  for (const sub of SCAN_DIRS) {
    const dir = path.join(root, sub);
    if (!fs.existsSync(dir)) continue;
    walk(dir, out);
  }
  return out;
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.isFile() && SCAN_EXT.has(path.extname(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
}

// ── 2. Parse DTD: parameter-entity symbol table + ATTLIST class values ─

/**
 * Two-pass scan. Pass 1 collects every `<!ENTITY % NAME "VALUE">` into a
 * symbol table (used to resolve `%NAME;` references inside class defaults —
 * DITA 1.3 ships inline class values, but older/specialized DTDs may use the
 * `%xxx-class;` indirection form). Pass 2 reads `<!ATTLIST name … class
 * CDATA "VALUE">` and resolves any `%…;` reference against the table.
 */
function parseDtdFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);

  // Pass 1: parameter-entity symbol table.
  const entities = {};
  const entRe = /<!ENTITY\s+%\s+([A-Za-z0-9_.\-]+)\s+"((?:[^"\\]|\\.)*)"\s*>/g;
  let m;
  while ((m = entRe.exec(text)) !== null) {
    entities[m[1]] = m[2];
  }

  // Pass 2: ATTLIST declarations. An ATTLIST may declare attributes for a
  // single element or a group `<!ATTLIST (a|b) …>`. A declaration can span
  // multiple lines and ends at the first `>` (attribute default values never
  // contain a bare `>`).
  const attlistRe = /<!ATTLIST\s+([^\s>]+)([\s\S]*?)>/g;
  const classInBodyRe = /\bclass\s+CDATA\s+"([^"]*)"/;
  // References like %name; inside a class default value.
  const peRefRe = /%([A-Za-z0-9_.\-]+);/g;

  const results = [];
  while ((m = attlistRe.exec(text)) !== null) {
    const nameTok = m[1];
    const body = m[2];
    const cm = classInBodyRe.exec(body);
    if (!cm) continue;

    let classValue = cm[1];
    // Resolve any %name; parameter-entity references against the symbol table.
    if (classValue.indexOf('%') !== -1) {
      classValue = classValue.replace(peRefRe, (full, name) =>
        entities.hasOwnProperty(name) ? entities[name] : full,
      );
    }

    // Compute the 1-based line of the `<!ATTLIST` start.
    const attlistStart = m.index;
    const lineNo =
      text.slice(0, attlistStart).split(/\r?\n/).length;

    // Split grouped element names `(a|b|c)` into individual tags.
    let names;
    const grp = nameTok.match(/^\(([^)]+)\)$/);
    if (grp) {
      names = grp[1].split('|').map((s) => s.trim()).filter(Boolean);
    } else {
      names = [nameTok];
    }

    for (const name of names) {
      results.push({ tagName: name, classValue, file, line: lineNo });
    }
  }
  return results;
}

// ── 3. Derive base type from a class string ──────────────────────────

/**
 * class value format:  "- topic/li task/step "  (most generic ancestor first)
 * base type = the FIRST `module/tag` token after the leading `-`/`+`.
 * Base-module elements that self-reference a single pair (e.g. "- topic/topic ")
 * are the base type themselves and are excluded from the mapping.
 */
function deriveBaseType(classValue) {
  const tokens = classValue.trim().split(/\s+/).filter(Boolean);
  // tokens[0] is the `-`/`+` specialization marker.
  const pairs = tokens.filter((t) => t !== '-' && t !== '+');
  if (pairs.length === 0) return undefined;
  const first = pairs[0];
  if (!/^[a-z][a-z0-9]*\/[a-z]/.test(first)) return undefined;
  // Self-referencing single-pair base element (e.g. topic/topic, map/map):
  // it IS the base type — no mapping entry needed.
  if (pairs.length === 1) return undefined;
  return first;
}

// ── 4. Bucket by map vs topic side ────────────────────────────────────

/**
 * The side a class value belongs to, taken from the FIRST pair (the most
 * generic ancestor). A tag declared on both sides (shortdesc, linktext,
 * searchtitle) therefore lands in both tables, each with its own value.
 */
function classSideOf(classValue) {
  const pairs = classValue
    .trim()
    .split(/\s+/)
    .filter((t) => t !== '-' && t !== '+' && t.indexOf('/') !== -1);
  if (pairs.length === 0) return undefined;
  if (pairs[0].startsWith('topic/')) return 'topic';
  if (pairs[0].startsWith('map/')) return 'map';
  return undefined;
}

/**
 * Records the element's DTD-default class value (trimmed) on its side. The same
 * tag may be declared in several modules; a second declaration with a different
 * value on the same side would make the runtime table ambiguous, so it is
 * recorded and --emit-module refuses to write a table containing it.
 */
function collectClassDefault(classDefaults, conflicts, row) {
  const side = classSideOf(row.classValue);
  if (!side) return;
  const classValue = row.classValue.trim();
  const prev = classDefaults[side][row.tagName];
  if (prev === undefined) {
    classDefaults[side][row.tagName] = classValue;
  } else if (prev !== classValue) {
    conflicts.push({ side, tagName: row.tagName, a: prev, b: classValue, sourceFile: path.relative(DITA_DTD_ROOT, row.file).replace(/\\/g, '/'), sourceLine: row.line });
  }
}

function bucketOf(baseType) {
  // Note: bucketOf() classifies a *base type*; classSideOf() classifies a whole
  // class chain. They agree for every element the runtime table needs.
  if (baseType.startsWith('topic/')) return 'topic';
  if (baseType.startsWith('map/')) return 'map';
  return 'other';
}

// ── 5. Read the hand-maintained TS maps via regex ─────────────────────

function readTsMap(file) {
  const text = fs.readFileSync(file, 'utf8');
  const out = {};
  // Matches  tagName: 'base/type',  or  'tag-name': 'base/type',
  const re = /^\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z][\w-]*))\s*:\s*'([^']+)'/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1] || m[2] || m[3];
    out[name] = m[4];
  }
  return out;
}

// Collect renderer baseType keys from a renderer module source file. Looks for
// quoted keys followed by `:` at the start of a property in a Record literal,
// e.g.  'topic/itemgroup': (node, ctx, ...) => { ... }
function readRendererKeys(file) {
  const text = fs.readFileSync(file, 'utf8');
  const out = new Set();
  const re = /^\s*'([^']+)'\s*:/gm;
  let m;
  while ((m = re.exec(text)) !== null) out.add(m[1]);
  return out;
}

// ── Main ─────────────────────────────────────────────────────────────

// ── 5b. --diff-only mode ────────────────────────────────────────────────
// Recomputes the diff against the *existing* dita-class-extracted.json
// instead of rescanning the DTD. Useful when you don't have the DITA-OT
// install on this machine but want an up-to-date diff after hand-editing
// standardTagMap.ts/mapTagMap.ts. Does NOT rewrite dita-class-extracted.json
// (that file only changes on a real DTD rescan) and clearly marks the
// diff.md header so nobody mistakes it for a fresh extraction.
const DIFF_ONLY = process.argv.includes('--diff-only');
// --check-module reads the same cached extraction and must work on a machine without
// a DITA-OT install: it never resolves the DTD root and never writes a file.
const CHECK_MODULE = process.argv.includes('--check-module');
const READ_ONLY = DIFF_ONLY || CHECK_MODULE;

function loadCachedCandidates() {
  if (!fs.existsSync(EXTRACTED_JSON)) {
    console.error(`--diff-only requires an existing ${path.relative(REPO_ROOT, EXTRACTED_JSON)}. Run without --diff-only once first.`);
    process.exit(1);
  }
  const cached = JSON.parse(fs.readFileSync(EXTRACTED_JSON, 'utf8'));
  if (!cached.classDefaults) {
    console.error(`--diff-only needs classDefaults in ${path.relative(REPO_ROOT, EXTRACTED_JSON)}. Rescan the DTDs once (see --dita-root) to add them.`);
    process.exit(1);
  }
  return {
    topicCandidates: cached.topicEntries || {},
    mapCandidates: cached.mapEntries || {},
    classDefaults: cached.classDefaults,
    dupConflicts: cached.duplicateConflicts || [],
    cachedGeneratedAt: cached.generatedAt,
    cachedDtdRoot: cached.ditaDtdPlugin || cached.ditaDtdRoot,
  };
}

// ── 5c. The runtime @class table ───────────────────────────────────────
//
// src/parser/ditaClassDefaults.ts is the only consumer: the completeness checks
// resolve an element's class from the file's own @class when it has one, and
// from this table when the DTD default is what applies. Everything in the file
// below the header is generated, in sorted order, so a rescan produces the same
// bytes for the same DTDs.

const EMIT_MODULE = process.argv.includes('--emit-module');

function renderClassModule(classDefaults) {
  const header = [
    '// AUTO-GENERATED by scripts/extract-dita-class.cjs --emit-module -- do not edit.',
    '//',
    '// The @class value the DITA 1.3 DTD gives each element when a file does not',
    '// write one, per side: a topic file resolves through TOPIC_CLASS_DEFAULTS, a map',
    '// file through MAP_CLASS_DEFAULTS (shortdesc, linktext and searchtitle are',
    '// declared on both sides with different values). Values are the class chain,',
    '// trimmed; comparisons split on whitespace.',
    '//',
    '// Vocabulary coverage: base, technicalContent and bookmap (SCAN_DIRS in the',
    '// generator). learning/, machineryIndustry/ and the foreign-namespace modules are',
    '// NOT scanned: an element outside these tables has no known class and the checks',
    '// skip it rather than guess one (see completeness-corpus/OXYGEN-PROBLEMS.md).',
    '//',
    '// Regenerate from the DTDs:  node scripts/extract-dita-class.cjs --emit-module',
    '// Verify, offline:           node scripts/extract-dita-class.cjs --check-module',
    '//                            (compares this file with scripts/dita-class-extracted.json)',
    '',
  ].join('\n');
  return `${header}\n${renderClassTable('TOPIC_CLASS_DEFAULTS', classDefaults.topic)}\n\n${renderClassTable('MAP_CLASS_DEFAULTS', classDefaults.map)}\n`;
}

function renderClassTable(name, table) {
  const lines = [`export const ${name}: Readonly<Record<string, string>> = {`];
  for (const tag of Object.keys(table).sort()) {
    lines.push(`  '${escapeTs(tag)}': '${escapeTs(table[tag])}',`);
  }
  lines.push('};');
  return lines.join('\n');
}

function escapeTs(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function unescapeTs(s) {
  return s.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

/** Reads the two tables back out of the generated module (no TS compiler needed). */
function parseClassModule(text) {
  const table = (name) => {
    const body = new RegExp(`export const ${name}: Readonly<Record<string, string>> = \\{([\\s\\S]*?)\\n\\};`).exec(text);
    if (!body) return undefined;
    const out = {};
    const entry = /^\s*'((?:[^'\\]|\\.)+)': '((?:[^'\\]|\\.)*)',$/gm;
    let m;
    while ((m = entry.exec(body[1])) !== null) out[unescapeTs(m[1])] = unescapeTs(m[2]);
    return out;
  };
  return { topic: table('TOPIC_CLASS_DEFAULTS'), map: table('MAP_CLASS_DEFAULTS') };
}

/** Per-side differences between two tag -> class tables. */
function diffClassTables(expected, actual) {
  const out = [];
  for (const side of ['topic', 'map']) {
    const e = expected[side] ?? {};
    const a = actual[side] ?? {};
    for (const tag of Object.keys(e)) {
      if (!(tag in a)) out.push(`${side}: missing <${tag}> (JSON: "${e[tag]}")`);
      else if (a[tag] !== e[tag]) out.push(`${side}: <${tag}> is "${a[tag]}" in the module, "${e[tag]}" in the JSON`);
    }
    for (const tag of Object.keys(a)) {
      if (!(tag in e)) out.push(`${side}: <${tag}> is in the module but not in the JSON ("${a[tag]}")`);
    }
  }
  return out;
}

/**
 * --emit-module writes src/parser/ditaClassDefaults.ts from the table;
 * --check-module only reports. Either way the comparison is module <-> JSON, so
 * neither mode reads the DTDs and both run offline.
 */
function syncClassModule(classDefaults, conflicts) {
  if (!classDefaults) return { ok: false, lines: ['no class table available: rescan the DTDs once'] };
  if (conflicts.length) {
    return {
      ok: false,
      lines: conflicts.map((c) => `${c.side}: <${c.tagName}> is declared as "${c.a}" and "${c.b}" (${c.sourceFile}:${c.sourceLine}); resolve before emitting`),
    };
  }
  const text = renderClassModule(classDefaults);
  if (CHECK_MODULE) {
    if (!fs.existsSync(CLASS_MODULE)) return { ok: false, lines: [`${path.relative(REPO_ROOT, CLASS_MODULE)} does not exist; run --emit-module`] };
    const actual = fs.readFileSync(CLASS_MODULE, 'utf8');
    if (actual === text) return { ok: true, lines: [`${path.relative(REPO_ROOT, CLASS_MODULE)} matches the JSON (${Object.keys(classDefaults.topic).length} topic + ${Object.keys(classDefaults.map).length} map entries)`] };
    // Report table drift when there is any; otherwise the difference is in the
    // generated header or the entry order, so say that instead of printing nothing.
    const diffs = diffClassTables(classDefaults, parseClassModule(actual));
    if (diffs.length === 0) diffs.push('table contents match; the header or the entry order differs from a fresh --emit-module');
    return { ok: false, lines: diffs };
  }
  fs.writeFileSync(CLASS_MODULE, text);
  return { ok: true, lines: [`Wrote ${path.relative(REPO_ROOT, CLASS_MODULE)} (${Object.keys(classDefaults.topic).length} topic + ${Object.keys(classDefaults.map).length} map entries)`] };
}

function main() {
  let topicCandidates, mapCandidates, dupConflicts, filesScanned = 0;
  let cachedProvenance = null;
  let classDefaults = null;
  let classDefaultConflicts = [];

  if (READ_ONLY) {
    const cached = loadCachedCandidates();
    topicCandidates = cached.topicCandidates;
    mapCandidates = cached.mapCandidates;
    dupConflicts = cached.dupConflicts;
    classDefaults = cached.classDefaults;
    cachedProvenance = { generatedAt: cached.cachedGeneratedAt, dtdRoot: cached.cachedDtdRoot };
  } else {
    DITA_DTD_ROOT = resolveDtdRoot();
    const files = listDtdFiles(DITA_DTD_ROOT);
    if (files.length === 0) {
      console.error(`No DTD files under ${DITA_DTD_ROOT}. Set DITA_DTD_ROOT.`);
      process.exit(1);
    }
    filesScanned = files.length;

    // extracted[tagName] = array of { baseType, bucket, file, line, classValue }
    const extracted = {};
    dupConflicts = [];
    // Every element's DTD-default class value, base elements included: this is
    // the table src/parser/ditaClassDefaults.ts is generated from.
    classDefaults = { topic: {}, map: {} };
    classDefaultConflicts = [];

    for (const file of files) {
      const rows = parseDtdFile(file);
      for (const row of rows) {
        collectClassDefault(classDefaults, classDefaultConflicts, row);
        const baseType = deriveBaseType(row.classValue);
        if (!baseType) continue; // base element or unparseable
        const bucket = bucketOf(baseType);
        if (bucket === 'other') continue;

        const entry = {
          tagName: row.tagName,
          baseType,
          bucket,
          sourceFile: path.relative(DITA_DTD_ROOT, row.file).replace(/\\/g, '/'),
          sourceLine: row.line,
          classValue: row.classValue.trim(),
        };

        const prev = extracted[row.tagName];
        if (prev) {
          // Same tag declared in multiple modules. Keep them all for the diff
          // report; the first declaration wins for the "extracted" table only
          // when the base types agree, otherwise record a duplicate conflict.
          const sameBucket = prev.bucket === entry.bucket;
          if (sameBucket && prev.baseType !== entry.baseType) {
            dupConflicts.push({ tagName: row.tagName, a: prev, b: entry });
          }
          // Prefer the topic-side declaration for the topic bucket and the
          // map-side declaration for the map bucket: later same-bucket entry
          // overwrites only if it refines (it shouldn't here).
          if (sameBucket) extracted[row.tagName] = entry;
          else if (!extracted[row.tagName + '$$alt']) {
            // keep the alternate bucket visible in the JSON via a synthetic key
            extracted[row.tagName + '$$alt'] = entry;
          }
        } else {
          extracted[row.tagName] = entry;
        }
      }
    }

    // Build clean per-bucket candidate tables.
    topicCandidates = {};
    mapCandidates = {};
    for (const [tag, e] of Object.entries(extracted)) {
      if (tag.endsWith('$$alt')) {
        if (e.bucket === 'topic') topicCandidates[tag.slice(0, -5)] = e;
        else mapCandidates[tag.slice(0, -5)] = e;
        continue;
      }
      if (e.bucket === 'topic') topicCandidates[tag] = e;
      else mapCandidates[tag] = e;
    }
  }

  const existingTopic = readTsMap(STANDARD_MAP_SRC);
  const existingMap = readTsMap(MAP_MAP_SRC);

  const diff = makeDiff(topicCandidates, existingTopic, 'STANDARD_TAG_TO_BASETYPE');
  const diffMap = makeDiff(mapCandidates, existingMap, 'MAP_STANDARD_TAG_TO_BASETYPE');

  // Renderer coverage for newly introduced base types. A base type is only
  // "newly introduced" by a new tag entry if it isn't already referenced by
  // ANY existing tag entry (topic or map) — e.g. topic/data is already in
  // use via the existing `data` tag, so adding more tags that resolve to it
  // doesn't introduce a renderer gap (it already falls through to children).
  const baseRenderers = readRendererKeys(BASE_RENDERER_SRC);
  const mapRenderers = readRendererKeys(MAP_RENDERER_SRC);
  const existingBaseTypes = new Set([
    ...Object.values(existingTopic),
    ...Object.values(existingMap),
  ]);

  const newTopicBaseTypes = collectNewBaseTypes(diff, baseRenderers, existingBaseTypes);
  const newMapBaseTypes = collectNewBaseTypes(diffMap, mapRenderers, existingBaseTypes);

  // ── Write JSON (skipped when no fresh DTD data was read) ──
  if (!READ_ONLY) {
    const jsonPayload = {
      generatedAt: new Date().toISOString(),
      ditaDtdPlugin: DITA13_PLUGIN_ID,
      scannedDirs: SCAN_DIRS,
      topicEntries: sortObj(topicCandidates),
      mapEntries: sortObj(mapCandidates),
      // The runtime class table (base elements included), by side.
      classDefaults: { topic: sortObj(classDefaults.topic), map: sortObj(classDefaults.map) },
      classDefaultConflicts,
      duplicateConflicts: dupConflicts,
    };
    fs.writeFileSync(EXTRACTED_JSON, JSON.stringify(jsonPayload, null, 2) + '\n');
  }

  // ── The runtime table (--emit-module / --check-module) ──
  const moduleStatus = EMIT_MODULE || CHECK_MODULE ? syncClassModule(classDefaults, classDefaultConflicts) : null;

  // ── Write diff markdown ──
  const md = [];
  md.push('# DITA @class → baseType extraction diff\n');
  if (DIFF_ONLY) {
    md.push(`Diff recomputed: ${new Date().toISOString()} (--diff-only: no DTD rescan)`);
    md.push(`Candidates from cached extraction: ${cachedProvenance.generatedAt} (\`${cachedProvenance.dtdRoot}\`)\n`);
  } else {
    md.push(`Generated: ${new Date().toISOString()}`);
    md.push(`DTD source: \`${DITA13_PLUGIN_ID}\` (resolved at runtime via --dita-root / DITA_DTD_ROOT / PATH; recorded as the plugin id, not a machine path)\n`);
  }
  md.push('## Topic-side (`STANDARD_TAG_TO_BASETYPE`)\n');
  writeDiffSection(md, diff, 'topic');
  md.push('## Map-side (`MAP_STANDARD_TAG_TO_BASETYPE`)\n');
  writeDiffSection(md, diffMap, 'map');

  md.push('## New base types lacking a renderer\n');
  if (newTopicBaseTypes.length === 0 && newMapBaseTypes.length === 0) {
    md.push('_None — every newly introduced base type already has a renderer._\n');
  }
  for (const bt of newTopicBaseTypes) {
    md.push(`- \`topic\` side new base type \`${bt.baseType}\` (from <${bt.tagName}>) — no branch in \`baseTypeMap.ts\``);
  }
  for (const bt of newMapBaseTypes) {
    md.push(`- \`map\` side new base type \`${bt.baseType}\` (from <${bt.tagName}>) — no branch in \`mapTypeMap.ts\``);
  }
  md.push('');

  if (dupConflicts.length) {
    md.push('## Duplicate declarations (same tag, different baseType)\n');
    for (const c of dupConflicts) {
      md.push(`- \`${c.tagName}\`: \`${c.a.baseType}\` (${c.a.sourceFile}:${c.a.sourceLine}) vs \`${c.b.baseType}\` (${c.b.sourceFile}:${c.b.sourceLine})`);
    }
    md.push('');
  }

  // --check-module is read-only: it writes neither the JSON nor the diff report.
  if (!CHECK_MODULE) fs.writeFileSync(DIFF_MD, md.join('\n'));

  // ── Stdout summary ──
  if (READ_ONLY) {
    console.log(`${DIFF_ONLY ? '--diff-only' : '--check-module'}: using cached extraction from ${cachedProvenance.generatedAt}`);
  } else {
    console.log(`Scanned ${filesScanned} DTD files under ${DITA_DTD_ROOT}`);
  }
  console.log(`Extracted ${Object.keys(topicCandidates).length} topic-side + ${Object.keys(mapCandidates).length} map-side entries.`);
  console.log(`\nTopic-side diff:`);
  console.log(`  new:       ${diff.onlyNew.length}`);
  console.log(`  conflicts: ${diff.conflicts.length}`);
  console.log(`  matched:   ${diff.matched.length}`);
  console.log(`\nMap-side diff:`);
  console.log(`  new:       ${diffMap.onlyNew.length}`);
  console.log(`  conflicts: ${diffMap.conflicts.length}`);
  console.log(`  matched:   ${diffMap.matched.length}`);
  console.log(`\nNew base types without renderer: ${newTopicBaseTypes.length + newMapBaseTypes.length}`);
  if (dupConflicts.length) console.log(`Duplicate declarations: ${dupConflicts.length}`);
  if (!READ_ONLY) console.log(`\nWrote ${path.relative(REPO_ROOT, EXTRACTED_JSON)}`);
  if (!CHECK_MODULE) console.log(`Wrote ${path.relative(REPO_ROOT, DIFF_MD)}`);
  if (moduleStatus) {
    console.log('');
    for (const line of moduleStatus.lines) console.log(line);
    if (!moduleStatus.ok) process.exit(1);
  }
}

function makeDiff(candidates, existing, mapName) {
  const onlyNew = [];
  const conflicts = [];
  const matched = [];
  for (const [tag, e] of Object.entries(candidates)) {
    if (!existing[tag]) {
      onlyNew.push(e);
    } else if (existing[tag] !== e.baseType) {
      conflicts.push({ ...e, existingBaseType: existing[tag] });
    } else {
      matched.push(e);
    }
  }
  // Tags present in code but absent from DTD (stale/hand-added).
  const onlyInCode = Object.keys(existing).filter((t) => !candidates[t]);
  return { onlyNew, conflicts, matched, onlyInCode, mapName };
}

function collectNewBaseTypes(diff, rendererKeys, existingBaseTypes) {
  const out = [];
  for (const e of diff.onlyNew) {
    // Skip base types already in use by an existing entry — their (lack of a)
    // renderer is a pre-existing condition, not introduced by these new tags.
    if (existingBaseTypes && existingBaseTypes.has(e.baseType)) continue;
    if (!rendererKeys.has(e.baseType)) out.push(e);
  }
  return out;
}

function writeDiffSection(md, diff, side) {
  md.push(`### New entries (in DTD, missing from ${diff.mapName}) — ${diff.onlyNew.length}\n`);
  if (diff.onlyNew.length === 0) md.push('_None_\n');
  for (const e of diff.onlyNew) {
    md.push(`- \`${e.tagName}\` → \`${e.baseType}\`  (src: \`${e.sourceFile}:${e.sourceLine}\`, class: \`"${e.classValue}"\`)`);
  }
  md.push('');
  md.push(`### Conflicts (both present, baseType differs) — ${diff.conflicts.length}\n`);
  if (diff.conflicts.length === 0) md.push('_None_\n');
  for (const e of diff.conflicts) {
    md.push(`- \`${e.tagName}\`: DTD says \`${e.baseType}\` (${e.sourceFile}:${e.sourceLine}) vs code \`${e.existingBaseType}\`  — _needs manual verification_`);
  }
  md.push('');
  md.push(`### Matched (code agrees with DTD) — ${diff.matched.length}\n`);
  md.push(`_Verified; no change needed._\n`);
  md.push(`### Only in code (hand-added, no DTD evidence) — ${diff.onlyInCode.length}\n`);
  for (const t of diff.onlyInCode) md.push(`- \`${t}\` → \`${side === 'topic' ? '' : ''}${t}\``);
  md.push('');
}

function sortObj(o) {
  const out = {};
  for (const k of Object.keys(o).sort()) out[k] = o[k];
  return out;
}

main();
