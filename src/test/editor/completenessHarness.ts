// Phase-0 differential harness for "Validate and Check for Completeness".
//
// It runs the extension's own crawl + check pipeline over a fixed corpus on
// disk and emits normalized findings, so the result can be (a) locked with a
// committed baseline and (b) diffed against Oxygen's completeness check.
//
// It deliberately imports no `vscode`: the host is backed by `fs`, and the
// corpus directory is passed in (never derived from `__dirname`), so the module
// works both compiled under mocha and bundled by scripts/completeness-baseline.cjs.

import { access, readFile } from 'fs/promises';
import { relative, resolve, sep } from 'path';
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

export const CORPUS_ROOT_MAP = 'corpus.ditamap';

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
  const crawl = await crawlMaps([rootMap], host);
  const issues = await runChecks(crawl, CORPUS_OPTIONS, {
    host,
    preferences: CORPUS_PREFERENCES,
  });
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
