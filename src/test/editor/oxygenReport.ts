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

import { isAbsolute, relative, resolve, sep } from 'path';
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

function toLine(
  fields: Record<string, string>,
  attrs: Record<string, string>,
): number {
  const loc = fields.startLocation ?? fields.location ?? fields.start;
  if (loc) {
    const m = /(\d+)/.exec(loc);
    if (m) return Number(m[1]);
  }
  const n = Number(fields.line ?? attrs.line);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function toIncident(filePath: string, node: XNode): OxygenIncident {
  const fields: Record<string, string> = {};
  for (const child of node.children) fields[child.tag] = child.text.trim();
  // Attributes can carry the same data on some report versions.
  for (const [k, v] of Object.entries(node.attrs))
    if (!(k in fields)) fields[k] = v;
  return {
    filePath,
    line: toLine(fields, node.attrs),
    severity: fields.severity ?? '',
    problemID: fields.problemID ?? fields.problemId ?? '',
    engine: fields.engine ?? '',
    description: fields.description ?? fields.message ?? '',
    fields,
  };
}

/** Every incident in an Oxygen completeness/validation report. */
export function parseOxygenReport(xml: string): OxygenIncident[] {
  const root = parseTree(xml);
  if (!root) return [];
  const out: OxygenIncident[] = [];
  for (const fileNode of findAll(root, 'file')) {
    const filePath =
      fileNode.attrs.filePath ??
      fileNode.attrs.filepath ??
      fileNode.attrs.path ??
      '';
    const incidentsNode = fileNode.children.find(
      (c) => c.tag.toLowerCase() === 'incidents',
    );
    const candidates = (
      incidentsNode ? incidentsNode.children : fileNode.children
    ).filter((c) => c.tag.toLowerCase() === 'incident');
    for (const inc of candidates) out.push(toIncident(filePath, inc));
  }
  return out;
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
  // keys
  'dmv.undef.key': 'undefined-key',
  'duplicate.key.definition': 'duplicate-key',
  'dmv.not.used.key.defs': 'unreferenced-key',
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
    p = p
      .replace(/^file:\/\/\//i, '')
      .replace(/^file:\/\//i, '')
      .replace(/^file:/i, '');
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

/** Maps parsed incidents to the harness shape, with paths relative to the corpus. */
export function normalizeOxygenFindings(
  corpusDir: string,
  incidents: readonly OxygenIncident[],
): NormalizedFinding[] {
  const absCorpus = resolve(corpusDir);
  return incidents
    .map((i) => {
      const local = oxygenPathToLocal(i.filePath);
      const file =
        local && isAbsolute(local)
          ? toPosix(relative(absCorpus, resolve(local)))
          : toPosix(local);
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
