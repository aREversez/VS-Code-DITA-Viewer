// Adapter: Oxygen's "Validate and Check for Completeness" report -> the same
// normalized findings the extension harness emits, so the two can be diffed.
//
// Oxygen produces the report from its scripting entry point (see OXYGEN.md):
//   sh scripts/validateCheckDITA.sh -i corpus.ditamap -s corpus.settings.xml -r report.xml
//
// The report is an XML document (the JSON/text report variants carry the same
// fields):
//   <report>
//     <summary>...</summary>
//     <filesWithValidationProblems>
//       <file filePath="..." numberOfProblems="N">
//         <incidents>
//           <incident>
//             <engine>DITA Validation</engine>
//             <severity>error</severity>
//             <problemID>dmv.file.not.found</problemID>
//             <description>...</description>
//             <startLocation>12:24</startLocation>
//           </incident>
//         </incidents>
//       </file>
//     </filesWithValidationProblems>
//   </report>
//
// The parser is deliberately tolerant: it accepts attributes as well as child
// elements and keeps every field it sees, because the exact element names can
// only be confirmed against a real report.

import { isAbsolute, relative, resolve, sep, win32 } from 'path';
import sax from 'sax';
import { NormalizedFinding } from './completenessHarness';

export interface OxygenIncident {
  /** Raw file path exactly as it appeared in the report. */
  filePath: string;
  /** 1-based line, or 0 when the report did not carry a location. */
  line: number;
  severity: string;
  problemID: string;
  engine: string;
  description: string;
  /** Every direct child element of the incident, so an unexpected schema still round-trips. */
  fields: Record<string, string>;
}

interface XNode {
  tag: string;
  attrs: Record<string, string>;
  children: XNode[];
  text: string;
  parent?: XNode;
}

function parseTree(xml: string): XNode | undefined {
  const parser = sax.parser(true, { trim: true, normalize: false });
  let root: XNode | undefined;
  let cur: XNode | undefined;
  parser.onopentag = (node) => {
    const n: XNode = {
      tag: node.name,
      attrs: node.attributes as Record<string, string>,
      children: [],
      text: '',
      parent: cur,
    };
    if (cur) cur.children.push(n);
    else root = n;
    cur = n;
  };
  parser.onclosetag = () => {
    cur = cur?.parent;
  };
  parser.ontext = (t) => {
    if (cur) cur.text += t;
  };
  parser.oncdata = (t) => {
    if (cur) cur.text += t;
  };
  try {
    parser.write(xml).close();
  } catch {
    // Tolerate a truncated/garbled report: return whatever was parsed.
  }
  return root;
}

function findAll(node: XNode, tag: string): XNode[] {
  const out: XNode[] = [];
  const walk = (n: XNode): void => {
    if (n.tag.toLowerCase() === tag) out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(node);
  return out;
}

/** The line inside `<location><start><line>` of a real Oxygen incident. */
function findStartLine(node: XNode): number {
  const loc = node.children.find((c) => c.tag.toLowerCase() === 'location');
  if (!loc) return 0;
  const start = loc.children.find((c) => c.tag.toLowerCase() === 'start') ?? loc;
  const lineEl = start.children.find((c) => c.tag.toLowerCase() === 'line');
  const n = Number((lineEl?.text ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Older/`-rft` reports group incidents under `<file filePath=...>`; climb to it. */
function ancestorFilePath(node: XNode): string {
  for (let p = node.parent; p; p = p.parent) {
    if (p.tag.toLowerCase() === 'file') {
      const fp = p.attrs.filePath ?? p.attrs.filepath ?? p.attrs.path;
      if (fp) return fp;
    }
  }
  return '';
}

function toLine(
  fields: Record<string, string>,
  attrs: Record<string, string>,
  node?: XNode,
): number {
  const loc = fields.startLocation;
  if (loc) {
    const m = /(\d+)/.exec(loc);
    if (m) return Number(m[1]);
  }
  if (node) {
    const nested = findStartLine(node);
    if (nested) return nested;
  }
  const n = Number(fields.line ?? attrs.line);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function toIncident(node: XNode): OxygenIncident {
  const fields: Record<string, string> = {};
  for (const child of node.children) fields[child.tag] = child.text.trim();
  // Attributes can carry the same data on some report versions.
  for (const [k, v] of Object.entries(node.attrs))
    if (!(k in fields)) fields[k] = v;
  // The real report names the file per incident (`<systemID>`); the grouped
  // variant only carries it on the enclosing `<file>`.
  const filePath =
    fields.systemID ?? fields.systemId ?? ancestorFilePath(node) ?? '';
  return {
    filePath,
    line: toLine(fields, node.attrs, node),
    severity: fields.severity ?? '',
    problemID: fields.problemID ?? fields.problemId ?? '',
    engine: fields.engine ?? '',
    description: fields.description ?? fields.message ?? '',
    fields,
  };
}

/**
 * Every incident in an Oxygen completeness/validation report.
 *
 * The live "Save Results as XML" report puts `<incident>` elements directly
 * under `<report>` and names the file in a per-incident `<systemID>`; the
 * documented grouped form nests them under `<file>`/`<incidents>`. Both are
 * handled: incidents are collected by tag wherever they sit, and the file
 * falls back from `<systemID>` to the enclosing `<file>`.
 */
export function parseOxygenReport(xml: string): OxygenIncident[] {
  const root = parseTree(xml);
  if (!root) return [];
  return findAll(root, 'incident').map(toIncident);
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object'
    ? (v as Record<string, unknown>)
    : {};
}

function jsonIncident(filePath: string, inc: unknown): OxygenIncident {
  const rec = asRecord(inc);
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) {
    fields[k] = typeof v === 'string' ? v : v == null ? '' : String(v);
  }
  return {
    filePath,
    line: toLine(fields, {}),
    severity: fields.severity ?? '',
    problemID: fields.problemID ?? fields.problemId ?? '',
    engine: fields.engine ?? '',
    description: fields.description ?? fields.message ?? '',
    fields,
  };
}

/** Every incident in an Oxygen report in JSON format (`-rft json`). */
export function parseOxygenReportJson(json: string): OxygenIncident[] {
  const data = asRecord(JSON.parse(json));
  const report = 'report' in data ? asRecord(data.report) : data;
  const files = report.filesWithValidationProblems;
  const out: OxygenIncident[] = [];
  if (Array.isArray(files)) {
    for (const f of files) {
      const file = asRecord(f);
      const filePath = String(
        file.filePath ?? file.filepath ?? file.path ?? '',
      );
      if (Array.isArray(file.incidents)) {
        for (const inc of file.incidents) out.push(jsonIncident(filePath, inc));
      }
    }
  }
  return out;
}

/** Picks the XML or JSON parser from the report's first non-space character. */
export function parseOxygenReportAuto(text: string): OxygenIncident[] {
  const t = text.trimStart();
  return t.startsWith('{') || t.startsWith('[')
    ? parseOxygenReportJson(text)
    : parseOxygenReport(text);
}

/**
 * Oxygen problem-ID -> extension category. Every ID the extension implements is
 * listed here, so a report diffs category-for-category. IDs the extension does
 * not implement yet stay unmapped and show up with an `oxygen:` prefix (see
 * OXYGEN-PROBLEMS.md for the full catalog and which ones are still gaps).
 */
export const PROBLEM_ID_CATEGORY: Record<string, string> = {
  // references
  'dmv.file.not.found': 'missing-reference',
  'dmv.reference.not.exist': 'missing-reference',
  'dmv.invalid.ref.topic.id': 'invalid-ref-topic-id',
  // reference spelling
  'dmv.win.seps.ref': 'reference-syntax',
  'dmv.absolute.ref': 'reference-syntax',
  'dmv.extra.slash.ref': 'reference-syntax',
  'dmv.ref.extra.slash': 'reference-syntax',
  'dmv.file.url.two.slashes': 'reference-syntax',
  'dmv.unencoded.ref': 'reference-syntax',
  'dmv.incorect.capit.ref': 'incorrect-case-reference',
  'dmv.folder.ref': 'folder-reference',
  'dmv.recursive.ref': 'recursive-reference',
  // keys
  'dmv.undef.key': 'undefined-key',
  // the live report emits dmv.key.undef for the same finding (confirmed empirically)
  'dmv.key.undef': 'undefined-key',
  'duplicate.key.definition': 'duplicate-key',
  'dmv.not.used.key.defs': 'unreferenced-key',
  'dmv.invalid.keyref.syntax': 'invalid-key-syntax',
  'dmv.invalid.keyref.syntax.1': 'invalid-key-syntax',
  'dmv.invalid.keyref.syntax.2': 'invalid-key-syntax',
  'dmv.invalid.keyref.syntax.3': 'invalid-key-syntax',
  // ids
  'IDInvalidWithNamespaces': 'invalid-id-syntax',
  'dmv.invalid.id.syntax.2': 'invalid-id-syntax',
  'dmv.invalid.id.syntax.3': 'invalid-id-syntax',
  // duplicates
  'dmv.dup.topic': 'multiple-reference',
  'dmv.dup.topic.id': 'duplicate-id',
  // not in map
  'dmv.not.topic.ref.in.map': 'unreferenced-link',
  'dmv.not.topic.ref.reltable.in.map': 'unreferenced-link',
  // reuse
  'dmv.not.used.reusable.component': 'unreferenced-reusable',
  // folders
  'dmv.external.references.map': 'outside-folder',
  // @format presence and agreement with the target
  'dmv.topicref.no.format': 'format-missing',
  'dmv.no.format.non.dita.ref': 'format-missing',
  'dmv.topicref.ext.scope.no.format': 'format-missing',
  'dmv.topicref.map.no.format': 'format-mismatch',
  'dmv.topicref.topic.no.format': 'format-mismatch',
  'dmv.ref.map.no.proper.format': 'format-mismatch',
  'dmv.ref.res.as.dita': 'format-mismatch',
  'dmv.ref.res.as.map': 'format-mismatch',
  'dmv.ref.topic.as.map': 'format-mismatch',
  'dmv.link.topic.to.map': 'format-mismatch',
  // @scope against the target
  'dmv.topicref.remote': 'external-reference',
  'dmv.topicref.remote.no.external.scope': 'external-reference',
  'dmv.topicref.remote.local.scope': 'external-reference',
  // map structure
  'dmv.ref.topic.inside.mapref': 'ignored-mapref-content',
  'dmv.topichead.no.navtitle': 'missing-navtitle',
  'dmv.topicref.no.navtitle': 'missing-navtitle',
  // profiling
  'dmv.prof.attr.innef.cond': 'profiling-conflict',
  'dmv.prof.attr.group.innef.cond': 'profiling-conflict',
  'dmv.prof.attr.prefs.undef': 'profiling-preference',
  'dmv.prof.attr.val.prefs.undef': 'profiling-preference',
};

export function categoryForProblemId(problemID: string): string {
  const mapped = PROBLEM_ID_CATEGORY[problemID];
  return mapped ?? (problemID ? `oxygen:${problemID}` : 'oxygen:unknown');
}

/** Strips a `file:` URL scheme and URI escapes, leaving a local filesystem path. */
export function oxygenPathToLocal(filePath: string): string {
  let p = filePath.trim();
  if (/^file:/i.test(p)) {
    // `file:///tmp/x` -> `/tmp/x` (keep the root slash); `file:///C:/x` -> `C:/x`.
    p = p.replace(/^file:(?:\/\/)?/i, '');
    if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
    try {
      p = decodeURIComponent(p);
    } catch {
      // leave the raw text; an undecodable path simply will not match
    }
  }
  return p;
}

function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}

const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\)/;

/**
 * The folder the report's corpus lived in when Oxygen ran, taken from the
 * incident that names the root map. Undefined when no incident does.
 */
export function corpusRootFromReport(incidents: readonly OxygenIncident[]): string | undefined {
  for (const i of incidents) {
    const local = oxygenPathToLocal(i.filePath);
    const m = /^(.*)[\\/]corpus\.ditamap$/.exec(local);
    if (m) return m[1];
  }
  return undefined;
}

/** Maps parsed incidents to the harness shape, with paths relative to the corpus. */
export function normalizeOxygenFindings(
  corpusDir: string,
  incidents: readonly OxygenIncident[],
): NormalizedFinding[] {
  const absCorpus = resolve(corpusDir);
  return incidents
    .map((i) => {
      const local = oxygenPathToLocal(i.filePath);
      let file: string;
      if (WINDOWS_ABSOLUTE.test(local) && WINDOWS_ABSOLUTE.test(corpusDir)) {
        // A report produced on Windows, read on any host: relate the two with
        // Windows path rules, not the host's.
        file = win32.relative(win32.resolve(corpusDir), win32.resolve(local)).replace(/\\/g, '/');
      } else {
        file = local && isAbsolute(local) ? toPosix(relative(absCorpus, resolve(local))) : toPosix(local);
      }
      return {
        category: categoryForProblemId(i.problemID),
        severity: i.severity || 'warning',
        file,
        line: i.line,
        message: i.description || i.problemID || i.engine,
      };
    })
    .sort((a, b) =>
      `${a.file}\t${a.category}` < `${b.file}\t${b.category}`
        ? -1
        : `${a.file}\t${a.category}` > `${b.file}\t${b.category}`
          ? 1
          : 0,
    );
}

/** Problem IDs seen in a report that are not yet in PROBLEM_ID_CATEGORY. */
export function unmappedProblemIds(
  incidents: readonly OxygenIncident[],
): string[] {
  const ids = new Set<string>();
  for (const i of incidents)
    if (i.problemID && !PROBLEM_ID_CATEGORY[i.problemID]) ids.add(i.problemID);
  return [...ids].sort();
}

/** Machine-specific absolute paths: a drive letter, a home directory or a UNC share. */
const MACHINE_PATH_IN_TEXT =
  /(?<![A-Za-z])[A-Za-z]:[\\/][^\s"'<>&]*|(?:^|[\s"'=(>])\/(?:Users|home)\/[^\s"'<>&]+|\\\\[A-Za-z0-9_.-]+\\[A-Za-z0-9_.$-][^\s"'<>&]*/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The only root map a corpus report may gather keys from. */
const CORPUS_KEY_SOURCE = 'corpus.ditamap';

/**
 * Oxygen resolves keys from whichever root map is active, and says so in each
 * undefined-key message ("Keys are gathered from: <map>"). A report whose keys came
 * from any map but the corpus was run in the wrong context: its key findings
 * (undefined, unreferenced, duplicate topic references) do not describe the corpus.
 */
export function foreignKeySources(xml: string): string[] {
  const found = new Set<string>();
  for (const m of xml.matchAll(/Keys are gathered from:\s*([^<]*)/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().replace(/\.$/, '').split(/[\\/]/).pop() ?? '';
      if (name && name !== CORPUS_KEY_SOURCE) found.add(`keys gathered from ${name}, not ${CORPUS_KEY_SOURCE}`);
    }
  }
  return [...found];
}

/**
 * Makes a real Oxygen report safe to commit: every path under the corpus folder
 * becomes relative to it, paths under the folder above it become `../...`, and
 * what is left of a machine-specific absolute path (an install folder in a
 * message, say) is returned in `leftovers` so the caller can refuse to write it.
 */
export function sanitizeOxygenReport(xml: string, corpusRoot: string): { xml: string; leftovers: string[] } {
  const fwd = corpusRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const slash = fwd.lastIndexOf('/');
  const parent = slash > 0 ? fwd.slice(0, slash) : '';
  // One regex per root spelling: plain, backslashed, and file: URLs (plain or %-encoded).
  const spellings = (dir: string): string[] => {
    const bs = dir.replace(/\//g, '\\');
    const out = [dir, bs, encodeURI(dir)];
    const noLead = dir.replace(/^\//, '');
    for (const prefix of ['file:///', 'file://', 'file:/']) out.push(prefix + noLead, prefix + encodeURI(noLead));
    return [...new Set(out)].sort((a, b) => b.length - a.length);
  };
  const replaceDir = (text: string, dir: string, replacement: string, bare: string): string => {
    let out = text;
    for (const sp of spellings(dir)) {
      const sepAfter = sp.includes('\\') ? '\\\\' : '/';
      // The rest of the path after the folder is kept, with its separators made forward slashes.
      out = out.replace(
        new RegExp(`${escapeRegExp(sp)}${sepAfter}([^\\s"'<>&:*?|]*)`, 'gi'),
        (_m, rest: string) => replacement + rest.replace(/\\/g, '/'),
      );
      out = out.replace(new RegExp(`${escapeRegExp(sp)}(?![\\w/\\\\.-])`, 'gi'), bare);
    }
    return out;
  };
  let out = replaceDir(xml, fwd, '', '.');
  if (parent) out = replaceDir(out, parent, '../', '..');
  out = out.replace(/<systemID>([^<]*)<\/systemID>/g, (_m, p: string) => `<systemID>${p.replace(/\\/g, '/')}</systemID>`);
  // Xerces incidents carry `<operationDescription><schemas><schema>` pointing at
  // Oxygen's own DTD (e.g. `C:\Program Files\Oxygen XML Author 28\...\topic.dtd`).
  // Only the basename is meaningful for parity; the prefix is both machine- and
  // version-specific, so reduce it here instead of failing the whole report.
  out = out.replace(/<schema>([^<]*)<\/schema>/g, (_m, p: string) => {
    const trimmed = p.trim();
    const base = trimmed.split(/[\\/]/).pop() ?? trimmed;
    return `<schema>${base}</schema>`;
  });
  // The second corpus probes references that resolve outside the corpus on
  // purpose, and Oxygen quotes the machine-resolved target, not the href: a
  // file: URL with an authority becomes a UNC share, and a root-absolute path
  // or a file: URL with an empty authority becomes a path on the drive Oxygen
  // was started from. Both target names are fabricated for the probe, so fold
  // every such form to the marker the corpus files use. Any other absolute
  // path is still a leftover and still blocks the commit.
  out = out.replace(/\\\\topics\\ok\.dita/gi, 'probe-absolute-path');
  out = out.replace(
    /(?<![A-Za-z])[A-Za-z]:[\\/](?:topics[\\/]ok\.dita|probe[\\/]x\.dita)/gi,
    'probe-absolute-path',
  );
  // The drive form of the same probe, for a report that quotes only the folder.
  out = out.replace(/Z:[\\/]probe(?![\w$.-])/gi, 'probe-absolute-path');
  out = out.replace(/(probe-absolute-path)\\+/g, '$1/');
  const leftovers = [...new Set((out.match(MACHINE_PATH_IN_TEXT) ?? []).map((s) => s.trim()))];
  leftovers.push(...foreignKeySources(out));
  return { xml: out, leftovers };
}
