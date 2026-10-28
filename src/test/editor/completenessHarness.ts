// Phase-0 differential harness for "Validate and Check for Completeness".
//
// It runs the extension's own crawl + check pipeline over a fixed corpus on
// disk and emits normalized findings, so the result can be (a) locked with a
// committed baseline and (b) diffed against Oxygen's completeness check.
//
// It deliberately imports no `vscode`: the host is backed by `fs`, and the
// corpus directory is passed in (never derived from `__dirname`), so the module
// works both compiled under mocha and bundled by scripts/completeness-baseline.cjs.

import { access, readFile, readdir, stat } from 'fs/promises';
import { basename, relative, resolve, sep } from 'path';
import { DitavalFilter, parseDitaval } from '../../editor/ditaval';
import { CrawlHost, crawlMaps } from '../../editor/mapCrawl';
import {
  CompletenessOptions,
  Issue,
  ProfilingPreferences,
  runChecks,
} from '../../editor/mapChecks';

/** Every check enabled; remote probing off so the harness never touches the network. */
export const CORPUS_OPTIONS: CompletenessOptions = {
  batchValidate: true,
  checkNonDita: true,
  includeRemote: false,
  ditavalFiles: [],
  reportOutsideMapFolder: true,
  reportUnreferencedLinks: true,
  reportMultipleRefs: true,
  checkDuplicateTopicIds: true,
  reportDuplicateKeys: true,
  reportUnreferencedKeys: true,
  reportUnreferencedReusable: true,
  reportTableProblems: true,
  identifyProfilingConflicts: true,
  reportProfilingPreferences: true,
};

/** A tiny profiling preference set, so value/attribute checks have something to compare against. */
export const CORPUS_PREFERENCES: ProfilingPreferences = {
  attributes: { audience: ['novice', 'expert'] },
  singleValue: [],
};

/** Profiling attributes the crawl knows without the preferences; the UI adds the rest per corpus.
 *  Mirrors mapCrawl.ts's PROFILING_ATTRS and completenessCheckUi.ts's filter list. */
const BUILT_IN_PROFILING_ATTRIBUTES = [
  'audience', 'platform', 'product', 'otherprops', 'deliveryTarget', 'props', 'rev',
] as const;

export const CORPUS_ROOT_MAP = 'corpus.ditamap';

/**
 * The corpus folders under test-dita-file/, each with its own corpus.ditamap,
 * baseline.extension.json and, once Oxygen has been run on it, oxygen-report.xml
 * and oxygen-parity.expected.json. The first is the original; the second holds the
 * reference-spelling and @format/@scope probes (completeness-corpus/BATCH-1.md); the
 * third the conref, id-reference, key and link probes (completeness-corpus/BATCH-2.md);
 * the fourth the profiling-value, subject-scheme and filter probes (BATCH-3.md); the
 * fifth the class-dependent, DITA-validity and structure probes (BATCH-4.md).
 */
export const CORPUS_FOLDERS = [
  'completeness-corpus',
  'completeness-corpus-2',
  'completeness-corpus-3',
  'completeness-corpus-4',
  'completeness-corpus-5',
  'completeness-corpus-6',
] as const;

/**
 * Settings a corpus needs on top of CORPUS_OPTIONS and CORPUS_PREFERENCES. Whatever is set
 * here must also be what Oxygen had during the run that produced the corpus's report: the
 * same DITAVAL chosen in its dialog, the same Profiling/Conditional Text preferences.
 */
export interface CorpusSettings {
  /** DITAVAL files, relative to the corpus folder. */
  ditavalFiles?: readonly string[];
  /** Replaces CORPUS_PREFERENCES for this corpus. */
  preferences?: ProfilingPreferences;
}

export const CORPUS_SETTINGS: Readonly<Record<string, CorpusSettings>> = {
  'completeness-corpus-4': {
    ditavalFiles: ['filters/probe.ditaval'],
    // The Oxygen page's group value audience(novice) is mirrored by its bare value:
    // this model keeps one flat value list per attribute (see the corpus README).
    preferences: {
      attributes: {
        audience: ['expert', 'novice'],
        platform: ['linux', 'windows'],
        product: ['desktop', 'mobile'],
        otherprops: ['alpha', 'beta', 'gamma'],
        deliveryTarget: ['pdf', 'html'],
        props: ['novice'],
      },
      singleValue: ['platform'],
    },
  },
};

/**
 * Probe files whose result depends on the operating system, per corpus folder: a
 * backslash is a separator only on Windows, and a path that differs from the real
 * file only in case resolves only on a case-insensitive file system. Their reports
 * come from a Windows Oxygen run, so off Windows their findings are left out of both
 * sides of a comparison; every other file in the corpus is locked on every platform.
 * The three `ok.dita` spellings are one file on Windows, where the id is unique; on a
 * case-sensitive file system the `OK.dita` and `Ok.dita` href spellings (the `a-case-*`
 * probes) crawl as further topics, so the shared id reads as a duplicate there -- the
 * same file-system dependency, listed for the findings it produces as well.
 */
export const PLATFORM_DEPENDENT_FILES: Readonly<Record<string, readonly string[]>> = {
  'completeness-corpus-2': [
    'topics/a-case-edge.dita',
    'topics/a-case-pos.dita',
    'topics/a-win-seps-edge.dita',
    'topics/a-win-seps-pos.dita',
    'topics/OK.dita',
    'topics/Ok.dita',
    'topics/ok.dita',
  ],
};

const platformDependent = (folder: string, file: string, platform: string): boolean =>
  platform !== 'win32' && (PLATFORM_DEPENDENT_FILES[folder] ?? []).includes(file);

/** Drops the findings of platform-dependent probe files unless the platform is Windows. */
export function dropPlatformDependent<T extends { file: string }>(
  folder: string,
  findings: readonly T[],
  platform: string = process.platform,
): T[] {
  return findings.filter((f) => !platformDependent(folder, f.file, platform));
}

/** The same for signatures written as "file<TAB or two spaces>category". */
export function dropPlatformDependentSignatures(
  folder: string,
  signatures: readonly string[],
  platform: string = process.platform,
): string[] {
  return signatures.filter((sig) => !platformDependent(folder, sig.split(/\t|  /)[0], platform));
}

/** One finding, reduced to what both tools can express and normalized for stable diffs. */
export interface NormalizedFinding {
  category: string;
  severity: string;
  /** Path relative to the corpus directory, with forward slashes. */
  file: string;
  line: number;
  message: string;
}

function makeDiskHost(): CrawlHost {
  return {
    platform: process.platform,
    readFile: (p: string) => readFile(p, 'utf8'),
    exists: async (p: string) => {
      try {
        await access(p);
        return true;
      } catch {
        return false;
      }
    },
    isDirectory: async (p: string) => {
      try {
        return (await stat(p)).isDirectory();
      } catch {
        return false;
      }
    },
    readDir: async (p: string) => {
      try {
        return await readdir(p);
      } catch {
        return undefined;
      }
    },
  };
}

function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}

export function normalizeFinding(
  corpusDir: string,
  issue: Issue,
): NormalizedFinding {
  return {
    category: issue.category,
    severity: issue.severity,
    file: toPosix(relative(corpusDir, issue.file)),
    line: issue.line,
    message: issue.message,
  };
}

/** Stable text key for one finding; the baseline and the diff both use it. */
export function findingKey(f: NormalizedFinding): string {
  return `${f.file}\t${f.line}\t${f.category}\t${f.severity}\t${f.message}`;
}

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sorted, deterministic findings produced by the extension for the corpus. */
export async function collectExtensionFindings(
  corpusDir: string,
): Promise<NormalizedFinding[]> {
  const absCorpus = resolve(corpusDir);
  const rootMap = resolve(absCorpus, CORPUS_ROOT_MAP);
  const host = makeDiskHost();
  const settings = CORPUS_SETTINGS[basename(absCorpus)] ?? {};
  const preferences = settings.preferences ?? CORPUS_PREFERENCES;
  const ditavalFiles = (settings.ditavalFiles ?? []).map((f) => resolve(absCorpus, f));
  const options: CompletenessOptions = { ...CORPUS_OPTIONS, ditavalFiles };

  // Mirror the UI: no filter means one unfiltered run; each DITAVAL file adds a
  // separate whole-map run, and the findings of all runs are de-duplicated.
  const filters: Array<DitavalFilter | undefined> = [];
  if (ditavalFiles.length === 0) filters.push(undefined);
  for (const file of ditavalFiles) {
    try {
      filters.push(parseDitaval(await readFile(file, 'utf8')));
    } catch {
      // An unreadable DITAVAL is skipped, not fatal, as in the UI.
    }
  }

  // The UI also profiles attributes that exist only in the preferences (deliveryTarget).
  const extraProfilingAttributes = Object.keys(preferences.attributes).filter(
    (a) => !(BUILT_IN_PROFILING_ATTRIBUTES as readonly string[]).includes(a),
  );

  const issues: Issue[] = [];
  const seen = new Set<string>();
  for (const filter of filters) {
    const crawl = await crawlMaps([rootMap], host, { filter, extraProfilingAttributes });
    const found = await runChecks(crawl, options, { host, preferences });
    for (const i of found) {
      const key = `${i.category}\u0000${i.file}\u0000${i.line}\u0000${i.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        issues.push(i);
      }
    }
  }
  return issues
    .map((i) => normalizeFinding(absCorpus, i))
    .sort((a, b) => compareKeys(findingKey(a), findingKey(b)));
}

export interface FindingsDiff {
  onlyInBaseline: string[];
  onlyInRun: string[];
}

/** Symmetric difference of two finding lists, compared by findingKey. */
export function diffFindings(
  baseline: NormalizedFinding[],
  run: NormalizedFinding[],
): FindingsDiff {
  const d = diffKeys(baseline.map(findingKey), run.map(findingKey));
  return { onlyInBaseline: d.onlyInA, onlyInRun: d.onlyInB };
}

/**
 * Categories the two tools name differently for the *same* (file, kind) finding.
 * Parity is compared on canonical categories; the extension's own UI keeps the
 * finer split (only `findingSignature` collapses them, never `findingKey`).
 *
 * - `missing-resource` -> `missing-reference`: Oxygen reports a dangling non-DITA
 *   href as `dmv.file.not.found` (missing-reference); the extension keeps a
 *   dedicated `missing-resource` category. Same missing file, seen through the
 *   extension's resource/reference split. Documented in OXYGEN-PROBLEMS.md.
 */
export const CATEGORY_EQUIVALENCES: Readonly<Record<string, string>> = {
  'missing-resource': 'missing-reference',
};

/** The category a finding is compared under: its equivalence target, or itself. */
export function canonicalCategory(category: string): string {
  return CATEGORY_EQUIVALENCES[category] ?? category;
}

/**
 * Coarse "problem signature" (file + canonical category), for comparing the
 * extension against Oxygen, whose line numbers and wording legitimately differ.
 */
export function findingSignature(f: NormalizedFinding): string {
  return `${f.file}\t${canonicalCategory(f.category)}`;
}

/** Symmetric difference of two key lists, de-duplicated and sorted. */
export function diffKeys(
  a: readonly string[],
  b: readonly string[],
): { onlyInA: string[]; onlyInB: string[] } {
  const setA = new Set(a);
  const setB = new Set(b);
  return {
    onlyInA: [...setA].filter((k) => !setB.has(k)).sort(compareKeys),
    onlyInB: [...setB].filter((k) => !setA.has(k)).sort(compareKeys),
  };
}

/** Parses a findings JSON file: an array of NormalizedFinding. */
export function parseFindings(json: string): NormalizedFinding[] {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value)) throw new Error('findings JSON must be an array');
  return value.map((entry) => {
    const f = entry as Partial<NormalizedFinding>;
    if (
      typeof f.category !== 'string' ||
      typeof f.severity !== 'string' ||
      typeof f.file !== 'string' ||
      typeof f.line !== 'number' ||
      typeof f.message !== 'string'
    ) {
      throw new Error(`invalid finding: ${JSON.stringify(entry)}`);
    }
    return {
      category: f.category,
      severity: f.severity,
      file: f.file,
      line: f.line,
      message: f.message,
    };
  });
}

export function serializeFindings(
  findings: readonly NormalizedFinding[],
): string {
  return `${JSON.stringify(findings, null, 2)}\n`;
}
