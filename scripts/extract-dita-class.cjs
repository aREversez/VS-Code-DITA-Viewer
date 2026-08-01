// Extracts every DITA element's @class default value from the DITA-OT DTD
// module files, derives the base type (first module/tag pair in the class
// chain), and produces an auditable three-way diff against the hand-maintained
// tag→baseType maps in src/parser/standardTagMap.ts and mapTagMap.ts.
//
// Re-run this whenever DITA-OT is upgraded or a new specialization plugin is
// installed:  node scripts/extract-dita-class.cjs
//
// Use --diff-only to recompute the diff against the existing
// dita-class-extracted.json without rescanning the DTD (e.g. on a machine
// without the DITA-OT install) after hand-editing standardTagMap.ts /
// mapTagMap.ts:  node scripts/extract-dita-class.cjs --diff-only
//
// It writes two artifacts next to itself for review:
//   - dita-class-extracted.json   (full table with source file:line evidence)
//   - dita-class-diff.md          (new entries + conflicts + missing renderers)
//
// The DTD root can be overridden via the DITA_DTD_ROOT env var; it defaults to
// the local DITA-OT v1.3 install.
const fs = require('fs');
const path = require('path');

const DITA_DTD_ROOT =
  process.env.DITA_DTD_ROOT ||
  String.raw`E:\Software\dita-ot\plugins\org.oasis-open.dita.v1_3\dtd`;

// Specialization modules to scan. learning/ and machineryIndustry/ are skipped
// for now (cold modules); they can be added later without code changes.
const SCAN_DIRS = ['base', 'technicalContent', 'bookmap'];
const SCAN_EXT = new Set(['.mod', '.ent', '.dtd']);
// Foreign-namespace subdirectories that aren't DITA elements (MathML/SVG).
const SKIP_DIR_NAMES = new Set(['mathml', 'svg']);

const REPO_ROOT = path.join(__dirname, '..');
const STANDARD_MAP_SRC = path.join(REPO_ROOT, 'src', 'parser', 'standardTagMap.ts');
const MAP_MAP_SRC = path.join(REPO_ROOT, 'src', 'parser', 'mapTagMap.ts');
const BASE_RENDERER_SRC = path.join(REPO_ROOT, 'src', 'render', 'baseTypeMap.ts');
const MAP_RENDERER_SRC = path.join(REPO_ROOT, 'src', 'render', 'mapTypeMap.ts');

const EXTRACTED_JSON = path.join(__dirname, 'dita-class-extracted.json');
const DIFF_MD = path.join(__dirname, 'dita-class-diff.md');

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

function bucketOf(baseType) {
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

function loadCachedCandidates() {
  if (!fs.existsSync(EXTRACTED_JSON)) {
    console.error(`--diff-only requires an existing ${path.relative(REPO_ROOT, EXTRACTED_JSON)}. Run without --diff-only once first.`);
    process.exit(1);
  }
  const cached = JSON.parse(fs.readFileSync(EXTRACTED_JSON, 'utf8'));
  return {
    topicCandidates: cached.topicEntries || {},
    mapCandidates: cached.mapEntries || {},
    dupConflicts: cached.duplicateConflicts || [],
    cachedGeneratedAt: cached.generatedAt,
    cachedDtdRoot: cached.ditaDtdRoot,
  };
}

function main() {
  let topicCandidates, mapCandidates, dupConflicts, filesScanned = 0;
  let cachedProvenance = null;

  if (DIFF_ONLY) {
    const cached = loadCachedCandidates();
    topicCandidates = cached.topicCandidates;
    mapCandidates = cached.mapCandidates;
    dupConflicts = cached.dupConflicts;
    cachedProvenance = { generatedAt: cached.cachedGeneratedAt, dtdRoot: cached.cachedDtdRoot };
  } else {
    const files = listDtdFiles(DITA_DTD_ROOT);
    if (files.length === 0) {
      console.error(`No DTD files under ${DITA_DTD_ROOT}. Set DITA_DTD_ROOT.`);
      process.exit(1);
    }
    filesScanned = files.length;

    // extracted[tagName] = array of { baseType, bucket, file, line, classValue }
    const extracted = {};
    dupConflicts = [];

    for (const file of files) {
      const rows = parseDtdFile(file);
      for (const row of rows) {
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

  // ── Write JSON (skipped in --diff-only: no fresh DTD data was read) ──
  if (!DIFF_ONLY) {
    const jsonPayload = {
      generatedAt: new Date().toISOString(),
      ditaDtdRoot: DITA_DTD_ROOT,
      scannedDirs: SCAN_DIRS,
      topicEntries: sortObj(topicCandidates),
      mapEntries: sortObj(mapCandidates),
      duplicateConflicts: dupConflicts,
    };
    fs.writeFileSync(EXTRACTED_JSON, JSON.stringify(jsonPayload, null, 2) + '\n');
  }

  // ── Write diff markdown ──
  const md = [];
  md.push('# DITA @class → baseType extraction diff\n');
  if (DIFF_ONLY) {
    md.push(`Diff recomputed: ${new Date().toISOString()} (--diff-only: no DTD rescan)`);
    md.push(`Candidates from cached extraction: ${cachedProvenance.generatedAt} (\`${cachedProvenance.dtdRoot}\`)\n`);
  } else {
    md.push(`Generated: ${new Date().toISOString()}`);
    md.push(`DTD root: \`${DITA_DTD_ROOT}\`\n`);
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

  fs.writeFileSync(DIFF_MD, md.join('\n'));

  // ── Stdout summary ──
  if (DIFF_ONLY) {
    console.log(`--diff-only: using cached extraction from ${cachedProvenance.generatedAt}`);
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
  if (!DIFF_ONLY) console.log(`\nWrote ${path.relative(REPO_ROOT, EXTRACTED_JSON)}`);
  console.log(`Wrote ${path.relative(REPO_ROOT, DIFF_MD)}`);
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
