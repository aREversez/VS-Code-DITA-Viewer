// The checks behind "Validate and Check for Completeness". Each option in the
// dialog maps to one function below; semantics follow Oxygen's DITA Map
// Completeness Check (https://www.oxygenxml.com/doc/versions/28.1/ug-editor/topics/dita-map-validate.html),
// with two honest differences:
//   - "Batch validate" is XML well-formedness plus DITA structure checks (root
//     element, topic @id, <title>); there is no DTD/RNG validation here.
//   - Profiling preferences come from the dita-viewer.completenessCheck.*
//     settings rather than Oxygen's preferences page.

import { dirname, isAbsolute, relative, resolve } from 'path';
import { normalizePathForCompare } from './mapReferenceTools';
import { CrawlHost, CrawlResult, Location, Reference } from './mapCrawl';
import { Msg, MsgCode, formatMessage, msg } from './mapCheckMessages';

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

export type IssueCategory =
  | 'validation'
  | 'missing-reference'
  | 'missing-resource'
  | 'remote-resource'
  | 'outside-folder'
  | 'unreferenced-link'
  | 'multiple-reference'
  | 'duplicate-id'
  | 'duplicate-key'
  | 'unreferenced-key'
  | 'unreferenced-reusable'
  | 'table-layout'
  | 'profiling-conflict'
  | 'profiling-preference';

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

export async function runChecks(
  crawl: CrawlResult,
  opts: CompletenessOptions,
  env: CheckEnv,
): Promise<Issue[]> {
  const norm = (p: string) => normalizePathForCompare(p, env.host.platform);
  const issues: Array<Omit<Issue, 'message'>> = [];
  const rootDir = crawl.rootMaps.length > 0 ? dirname(crawl.rootMaps[0]) : '';

  // Existence probes are cached: one image is usually referenced many times.
  const existsCache = new Map<string, Promise<boolean>>();
  const exists = (p: string): Promise<boolean> => {
    const k = norm(p);
    let v = existsCache.get(k);
    if (!v) existsCache.set(k, (v = env.host.exists(p)));
    return v;
  };

  // 1. Always: references that don't resolve; opt-in: non-DITA and remote ones.
  for (const ref of crawl.refs) {
    if (env.host.cancelled?.()) break;
    if (ref.remote) continue;
    if (!ref.target) continue;
    if (ref.dita) {
      if (!(await exists(ref.target))) {
        issues.push({
          category: 'missing-reference', severity: 'error', file: ref.file, line: ref.line,
          msg: msg(missingCode(ref), ref.href),
        });
      }
    } else if (opts.checkNonDita && ref.kind !== 'conref') {
      if (!(await exists(ref.target))) {
        issues.push({
          category: 'missing-resource', severity: 'error', file: ref.file, line: ref.line,
          msg: msg('ref.missingResource', ref.href),
        });
      }
    }
  }

  if (opts.checkNonDita && opts.includeRemote && env.checkRemote) {
    const remote = crawl.refs.filter(
      (r) => r.remote && /^https?:/i.test(r.href) && ['image', 'object', 'data', 'other'].includes(r.kind),
    );
    const cache = new Map<string, Promise<boolean>>();
    await mapLimit(remote, 8, async (ref) => {
      if (env.host.cancelled?.()) return;
      let p = cache.get(ref.href);
      if (!p) cache.set(ref.href, (p = env.checkRemote!(ref.href)));
      if (!(await p)) {
        issues.push({
          category: 'remote-resource', severity: 'warning', file: ref.file, line: ref.line,
          msg: msg('ref.remoteUnreachable', ref.href),
        });
      }
    });
  }

  // 2. Batch validation of referenced DITA files.
  for (const fi of crawl.fileIssues) {
    if (fi.structural && !opts.batchValidate) continue;
    issues.push({ category: 'validation', severity: fi.severity, file: fi.file, line: fi.line, msg: fi.msg });
  }

  // 3. References outside the map folder.
  if (opts.reportOutsideMapFolder && rootDir) {
    const prefix = norm(rootDir).replace(/\/+$/, '') + '/';
    for (const ref of crawl.refs) {
      if (!ref.target || ref.remote) continue;
      if (!norm(ref.target).startsWith(prefix)) {
        issues.push({
          category: 'outside-folder', severity: 'warning', file: ref.file, line: ref.line,
          msg: msg('ref.outsideFolder', ref.href),
        });
      }
    }
  }

  // 4. Links to topics that no map references.
  if (opts.reportUnreferencedLinks) {
    const inMap = new Set<string>();
    for (const ref of crawl.refs) {
      if (ref.target && ref.dita && !ref.inReltable && (ref.kind === 'topicref' || ref.kind === 'keydef')) {
        inMap.add(norm(ref.target));
      }
    }
    for (const ref of crawl.refs) {
      const isLink = ref.kind === 'xref' || ref.kind === 'link' || (ref.inReltable && ref.kind === 'topicref');
      if (!isLink || !ref.dita || !ref.target || ref.remote) continue;
      if (!inMap.has(norm(ref.target))) {
        issues.push({
          category: 'unreferenced-link', severity: 'warning', file: ref.file, line: ref.line,
          msg: msg('ref.linkNotInMap', ref.href),
        });
      }
    }
  }

  // 5. Same topic referenced more than once (a unique @copy-to makes it a different topic).
  if (opts.reportMultipleRefs) {
    const groups = new Map<string, Reference[]>();
    for (const ref of crawl.refs) {
      if (ref.kind !== 'topicref' || ref.inReltable || !ref.dita || !ref.target) continue;
      const identity = ref.copyTo ? copyToKey(ref) : norm(ref.target);
      const list = groups.get(identity);
      if (list) list.push(ref);
      else groups.set(identity, [ref]);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const first = list[0];
      for (const dup of list.slice(1)) {
        issues.push({
          category: 'multiple-reference', severity: 'warning', file: dup.file, line: dup.line,
          msg: msg('ref.multiple', dup.href, list.length),
          related: [{ file: first.file, line: first.line }],
        });
      }
    }
  }

  // 6. Duplicate topic ids across the map context.
  if (opts.checkDuplicateTopicIds) {
    const byId = new Map<string, typeof crawl.topicIds>();
    for (const t of crawl.topicIds) {
      const list = byId.get(t.id);
      if (list) list.push(t);
      else byId.set(t.id, [t]);
    }
    for (const [id, list] of byId) {
      if (list.length < 2) continue;
      for (const dup of list.slice(1)) {
        issues.push({
          category: 'duplicate-id', severity: 'error', file: dup.file, line: dup.line,
          msg: msg('id.duplicate', id, list.length),
          related: [{ file: list[0].file, line: list[0].line }],
        });
      }
    }
  }

  // 7. Duplicate key definitions (same key, same key scope; the first wins).
  if (opts.reportDuplicateKeys) {
    // A key listed under several scope names ("a b") occupies every one of them.
    const byKey = new Map<string, typeof crawl.keyDefs>();
    for (const k of crawl.keyDefs) {
      for (const scopeId of k.scopeIds) {
        const id = `${scopeId}\u0000${k.key}`;
        const list = byKey.get(id);
        if (list) list.push(k);
        else byKey.set(id, [k]);
      }
    }
    const reported = new Set<(typeof crawl.keyDefs)[number]>();
    for (const list of byKey.values()) {
      if (list.length < 2) continue;
      for (const dup of list.slice(1)) {
        if (reported.has(dup)) continue;
        reported.add(dup);
        issues.push({
          category: 'duplicate-key', severity: 'warning', file: dup.file, line: dup.line,
          msg: msg('key.duplicate', dup.key),
          related: [{ file: list[0].file, line: list[0].line }],
        });
      }
    }
  }

  // 8. Key definitions nothing refers to.
  if (opts.reportUnreferencedKeys) {
    const used = new Set(crawl.keyUses.map((u) => u.key));
    for (const def of crawl.keyDefs) {
      if (!def.qualified.some((q) => used.has(q))) {
        issues.push({
          category: 'unreferenced-key', severity: 'warning', file: def.file, line: def.line,
          msg: msg('key.unreferenced', def.key),
        });
      }
    }
  }

  // 9. Reusable elements nothing conrefs.
  if (opts.reportUnreferencedReusable) issues.push(...unreferencedReusable(crawl, norm));

  // 10. Table layout.
  if (opts.reportTableProblems) {
    for (const t of crawl.tables) {
      for (const p of t.problems) {
        issues.push({
          category: 'table-layout', severity: 'warning', file: t.file, line: p.line,
          msg: p.msg,
        });
      }
    }
  }

  // 11. Profiling values that can never show.
  if (opts.identifyProfilingConflicts) {
    for (const c of crawl.profilingConflicts) {
      issues.push({
        category: 'profiling-conflict', severity: 'warning', file: c.file, line: c.line,
        msg: msg('prof.conflict', c.attribute, c.values.join(' '), c.tag, c.ancestorValues.join(' ')),
      });
    }
  }

  // 12. Profiling values that the configured preferences don't define.
  if (opts.reportProfilingPreferences) {
    const prefs = env.preferences;
    if (!prefs || Object.keys(prefs.attributes).length === 0) {
      issues.push({
        category: 'profiling-preference', severity: 'info', file: crawl.rootMaps[0] ?? '', line: 1,
        msg: msg('prof.notConfigured'),
      });
    } else {
      for (const u of crawl.profilingValues) {
        const allowed = prefs.attributes[u.attribute];
        if (!allowed) {
          issues.push({
            category: 'profiling-preference', severity: 'warning', file: u.file, line: u.line,
            msg: msg('prof.attrUndefined', u.attribute, u.tag),
          });
          continue;
        }
        if (allowed.length > 0) {
          const bad = u.values.filter((v) => !allowed.includes(v));
          if (bad.length > 0) {
            issues.push({
              category: 'profiling-preference', severity: 'warning', file: u.file, line: u.line,
              msg: msg('prof.valueUndefined', u.attribute, bad.join('", "')),
            });
          }
        }
        if (prefs.singleValue.includes(u.attribute) && u.values.length > 1) {
          issues.push({
            category: 'profiling-preference', severity: 'warning', file: u.file, line: u.line,
            msg: msg('prof.singleValue', u.attribute, u.values.length, u.values.join(' ')),
          });
        }
      }
    }
  }

  return dedupeIssues(issues.map((i) => ({ ...i, message: formatMessage(i.msg) })));
}

function missingCode(ref: Reference): MsgCode {
  switch (ref.kind) {
    case 'mapref': return 'ref.missingMap';
    case 'conref': return 'ref.missingConref';
    default: return 'ref.missingTopic';
  }
}

function copyToKey(ref: Reference): string {
  return `copy-to\u0000${dirname(ref.file)}\u0000${ref.copyTo}`;
}

function unreferencedReusable(crawl: CrawlResult, norm: (p: string) => string): Array<Omit<Issue, 'message'>> {
  // Topics to look in: those a resource-only topicref points at, and those
  // some conref/conkeyref already draws from.
  const candidates = new Set<string>();
  for (const ref of crawl.refs) {
    if (ref.kind === 'topicref' && ref.resourceOnly && ref.dita && ref.target) candidates.add(norm(ref.target));
  }
  const keyTarget = new Map<string, string>();
  for (const def of crawl.keyDefs) {
    if (!def.target) continue;
    for (const q of def.qualified) if (!keyTarget.has(q)) keyTarget.set(q, def.target);
  }
  const used = new Set<string>(); // "<norm file>#<id>"
  for (const use of crawl.conrefUses) {
    const file = use.targetFile ?? (use.key ? keyTarget.get(use.key) : undefined);
    if (!file) continue;
    candidates.add(norm(file));
    if (use.targetId) used.add(`${norm(file)}#${use.targetId}`);
  }
  const out: Array<Omit<Issue, 'message'>> = [];
  for (const el of crawl.reusable) {
    if (!candidates.has(norm(el.topicFile))) continue;
    if (used.has(`${norm(el.topicFile)}#${el.id}`)) continue;
    out.push({
      category: 'unreferenced-reusable', severity: 'warning', file: el.file, line: el.line,
      msg: msg('reuse.unreferenced', el.tag, el.id),
    });
  }
  return out;
}

/** Same finding reached twice (a topic reached by two paths, several DITAVAL runs) is reported once. */
export function dedupeIssues(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  const out: Issue[] = [];
  for (const i of issues) {
    const key = `${i.category}\u0000${i.file}\u0000${i.line}\u0000${i.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(i);
  }
  return out;
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}
