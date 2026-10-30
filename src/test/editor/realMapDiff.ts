// The shareable summary of a real-map differential run (test-dita-file/completeness-corpus/REAL-MAP.md).
//
// A real map cannot be committed, so the run happens on the owner's machine and only this
// summary leaves it: counts per category and, for every disagreement, an opaque label, the
// file's extension, the category, which side found it and Oxygen's problem id (a catalog id,
// not user data). No path, file name, line or message is ever written into the summary; the
// label-to-file table is returned separately and stays on the machine.

import { canonicalCategory } from './completenessHarness';

export interface SideFinding {
  /** Path relative to the root map's folder, posix separators. */
  file: string;
  category: string;
  /** Oxygen's problem id; only the Oxygen side has one. */
  problemID?: string;
}

export interface RealMapSummary {
  /** The text to share. */
  text: string;
  /** Label -> file, for the owner only. */
  labels: Record<string, string>;
  /** Signature counts, for tests and callers. */
  matched: number;
  extensionOnly: number;
  oxygenOnly: number;
}

const sig = (f: SideFinding): string => `${f.file}\t${canonicalCategory(f.category)}`;

/** The file's extension reduced to letters and digits, so a name can never ride along in it. */
export function fileKind(file: string): string {
  const base = file.slice(file.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  return /^[a-z0-9]{1,8}$/.test(ext) ? `.${ext}` : '(none)';
}

function tally(list: readonly SideFinding[]): Map<string, { n: number; ids: Set<string> }> {
  const m = new Map<string, { n: number; ids: Set<string> }>();
  for (const f of list) {
    const e = m.get(sig(f)) ?? { n: 0, ids: new Set<string>() };
    e.n++;
    if (f.problemID) e.ids.add(f.problemID);
    m.set(sig(f), e);
  }
  return m;
}

/** A problem id is a catalog constant; anything else in that slot is left out of the summary. */
const SAFE_ID = /^[A-Za-z0-9_.-]{1,80}$/;

export function summarizeRealMapDiff(
  extension: readonly SideFinding[],
  oxygen: readonly SideFinding[],
  exclude: readonly string[] = [],
): RealMapSummary {
  const keep = (f: SideFinding) => !exclude.includes(f.category);
  const ext = tally(extension.filter(keep));
  const oxy = tally(oxygen.filter(keep));
  const all = [...new Set([...ext.keys(), ...oxy.keys()])];
  const category = (s: string) => s.slice(s.indexOf('\t') + 1);
  const cats = [...new Set(all.map(category))].sort();

  const rows = cats.map((c) => {
    const keys = all.filter((s) => category(s) === c);
    const both = keys.filter((s) => ext.has(s) && oxy.has(s)).length;
    return {
      c,
      ext: keys.filter((s) => ext.has(s)).length,
      oxy: keys.filter((s) => oxy.has(s)).length,
      both,
    };
  });

  // Labels go to the disagreeing files only, in category/side/file order, so the numbering
  // says nothing about where a file lives.
  const diff = all
    .filter((s) => ext.has(s) !== oxy.has(s))
    .map((s) => ({ s, file: s.slice(0, s.indexOf('\t')), c: category(s), side: ext.has(s) ? 'extension' : 'Oxygen' }))
    .sort((a, b) => `${a.c}\t${a.side}\t${a.file}`.localeCompare(`${b.c}\t${b.side}\t${b.file}`));
  const labels: Record<string, string> = {};
  const labelOf = (file: string): string => {
    const known = Object.keys(labels).find((l) => labels[l] === file);
    if (known) return known;
    const l = `F${String(Object.keys(labels).length + 1).padStart(3, '0')}`;
    labels[l] = file;
    return l;
  };

  const lines: string[] = [];
  lines.push('# Real-map completeness diff (no paths, file names, lines or messages)');
  lines.push('');
  lines.push(`signatures (file + category): extension ${[...ext.keys()].length}, Oxygen ${[...oxy.keys()].length}`);
  lines.push(`matched ${rows.reduce((n, r) => n + r.both, 0)}, extension only ${diff.filter((d) => d.side === 'extension').length}, Oxygen only ${diff.filter((d) => d.side === 'Oxygen').length}`);
  if (exclude.length) lines.push(`left out of both sides: ${exclude.join(', ')}`);
  lines.push('');
  lines.push('| category | extension | Oxygen | matched |');
  lines.push('| --- | ---: | ---: | ---: |');
  for (const r of rows) lines.push(`| ${r.c} | ${r.ext} | ${r.oxy} | ${r.both} |`);
  lines.push('');
  lines.push('## Disagreements');
  lines.push('');
  if (diff.length === 0) lines.push('none');
  for (const d of diff) {
    const e = (d.side === 'extension' ? ext : oxy).get(d.s)!;
    const ids = [...e.ids].filter((i) => SAFE_ID.test(i)).sort().join(', ');
    lines.push(`${labelOf(d.file)}  ${fileKind(d.file)}  ${d.c}  ${d.side} only  x${e.n}${ids ? `  ${ids}` : ''}`);
  }
  lines.push('');
  return {
    text: lines.join('\n'),
    labels,
    matched: rows.reduce((n, r) => n + r.both, 0),
    extensionOnly: diff.filter((d) => d.side === 'extension').length,
    oxygenOnly: diff.filter((d) => d.side === 'Oxygen').length,
  };
}
