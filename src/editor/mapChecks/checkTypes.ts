// The completeness check's settings, ids, issue categories and the shapes shared by every check module.
// Split out of mapChecks.ts; pure functions over a crawl result, no vscode dependency.

import { isAbsolute, relative, resolve } from 'path';
import { CrawlHost, Location } from '../mapCrawl';
import { Msg } from '../mapCheckMessages';

export interface CompletenessOptions {
  batchValidate: boolean;
  checkNonDita: boolean;
  includeRemote: boolean;
  /** DITAVAL files to filter by; each one runs the whole check separately. Empty = unfiltered. */
  ditavalFiles: string[];
  reportOutsideMapFolder: boolean;
  reportUnreferencedLinks: boolean;
  reportMultipleRefs: boolean;
  checkDuplicateTopicIds: boolean;
  reportDuplicateKeys: boolean;
  reportUnreferencedKeys: boolean;
  reportUnreferencedReusable: boolean;
  reportTableProblems: boolean;
  identifyProfilingConflicts: boolean;
  reportProfilingPreferences: boolean;
}

export const DEFAULT_COMPLETENESS_OPTIONS: CompletenessOptions = {
  batchValidate: true,
  checkNonDita: true,
  includeRemote: false,
  ditavalFiles: [],
  reportOutsideMapFolder: false,
  reportUnreferencedLinks: true,
  reportMultipleRefs: false,
  checkDuplicateTopicIds: false,
  reportDuplicateKeys: false,
  reportUnreferencedKeys: false,
  reportUnreferencedReusable: false,
  reportTableProblems: true,
  identifyProfilingConflicts: false,
  reportProfilingPreferences: false,
};

/** Boolean checks, in the order the picker lists them. */
export const CHECK_IDS = [
  'batchValidate',
  'checkNonDita',
  'includeRemote',
  'useDitaval',
  'reportOutsideMapFolder',
  'reportUnreferencedLinks',
  'reportMultipleRefs',
  'checkDuplicateTopicIds',
  'reportDuplicateKeys',
  'reportUnreferencedKeys',
  'reportUnreferencedReusable',
  'reportTableProblems',
  'identifyProfilingConflicts',
  'reportProfilingPreferences',
] as const;

export type CheckId = (typeof CHECK_IDS)[number];

/** Oxygen's defaults, as the ids the `enabledChecks` setting stores. */
export const DEFAULT_ENABLED_CHECKS: CheckId[] = ['batchValidate', 'checkNonDita', 'reportUnreferencedLinks', 'reportTableProblems'];

/**
 * Options from the `enabledChecks` setting: unknown ids are ignored, and the
 * DITAVAL files only count while "useDitaval" is enabled. "includeRemote" is
 * only meaningful together with "checkNonDita".
 */
export function optionsFromSettings(enabled: readonly string[] | undefined, ditavalFiles: readonly string[] | undefined): CompletenessOptions {
  const on = new Set(enabled ?? DEFAULT_ENABLED_CHECKS);
  const o: CompletenessOptions = { ...DEFAULT_COMPLETENESS_OPTIONS, ditavalFiles: [] };
  const flags = o as unknown as Record<string, unknown>;
  for (const id of CHECK_IDS) if (id !== 'useDitaval') flags[id] = on.has(id);
  o.includeRemote = o.includeRemote && o.checkNonDita;
  o.ditavalFiles = on.has('useDitaval') ? [...(ditavalFiles ?? [])] : [];
  return o;
}

/** Ids to store in the `enabledChecks` setting for a set of picked ids (known ids only, in list order). */
export function normalizeEnabled(picked: readonly string[]): CheckId[] {
  return CHECK_IDS.filter((id) => picked.includes(id));
}

/** A DITAVAL path as stored in settings: relative to the map's folder when inside it, else absolute. */
export function toStoredPath(mapDir: string, abs: string): string {
  const rel = relative(mapDir, abs);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) ? rel.replace(/\\/g, '/') : abs;
}

export function resolveStoredPath(mapDir: string, stored: string): string {
  return isAbsolute(stored) ? stored : resolve(mapDir, stored);
}

/** Every kind of finding the completeness check can report (also the ledger's row keys). */
export const ISSUE_CATEGORIES = [
  'validation',
  'missing-reference',
  'invalid-ref-topic-id',
  'undefined-key',
  'missing-resource',
  'remote-resource',
  'outside-folder',
  'reference-syntax',
  'incorrect-case-reference',
  'folder-reference',
  'recursive-reference',
  'invalid-key-syntax',
  'invalid-id-syntax',
  'format-missing',
  'format-mismatch',
  'external-reference',
  'ignored-mapref-content',
  'missing-navtitle',
  'unreferenced-link',
  'multiple-reference',
  'duplicate-id',
  'duplicate-key',
  'unreferenced-key',
  'unreferenced-reusable',
  'table-layout',
  'profiling-conflict',
  'profiling-preference',
  'invalid-conref-form',
  'invalid-id-reference',
  'topicref-to-element',
  'link-key-without-target',
  'link-no-target',
  'resource-only-target',
  'duplicate-element-id',
  'empty-profiling-value',
  'filtered-reference',
  'duplicate-filter-condition',
  // batch 4: the class-dependent, @domains and section rules
  'class-format',
  'domains-format',
  'conref-class',
  'type-class-mismatch',
  'type-class-specific',
  'section-title-order',
  'section-title-duplicate',
  'dita-parse',
] as const;

export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

export interface Issue extends Location {
  category: IssueCategory;
  severity: 'error' | 'warning' | 'info';
  /** Code + arguments, localized by the UI layer. */
  msg: Msg;
  /** English rendering of msg (what tests, dedupe and plain-text export use). */
  message: string;
  /** Other places involved (the first definition of a duplicate, …). */
  related?: Location[];
}

export interface ProfilingPreferences {
  /** attribute name -> allowed values (empty list = any value). */
  attributes: Record<string, string[]>;
  /** Attributes that may carry only one value. */
  singleValue: string[];
}

export interface CheckEnv {
  host: CrawlHost;
  /** HEAD-style existence probe for remote URLs; only called when includeRemote is on. */
  checkRemote?: (url: string) => Promise<boolean>;
  preferences?: ProfilingPreferences;
}
