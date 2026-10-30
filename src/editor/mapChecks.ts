// The checks behind "Validate and Check for Completeness". Each option in the
// dialog maps to one function below; semantics follow Oxygen's DITA Map
// Completeness Check (https://www.oxygenxml.com/doc/versions/28.1/ug-editor/topics/dita-map-validate.html),
// with two honest differences:
//   - "Batch validate" is XML well-formedness plus DITA structure checks (root
//     element, topic @id, <title>); there is no DTD/RNG validation here.
//   - Profiling preferences come from the dita-viewer.completenessCheck.*
//     settings rather than Oxygen's preferences page.

import { dirname, isAbsolute, join, relative, resolve } from 'path';
import { normalizePathForCompare } from './mapReferenceTools';
import { CrawlHost, CrawlResult, FileRoot, Location, Reference } from './mapCrawl';
import { classChain, classPairTag } from './ditaClass';
import { parseDitavalRules } from './ditaval';
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

  // 1b. Key references that match no key definition.
  for (const u of crawl.undefinedKeys) {
    if (env.host.cancelled?.()) break;
    issues.push({
      category: 'undefined-key', severity: 'error', file: u.file, line: u.line,
      msg: msg('key.undefined', u.value),
    });
  }

  // 1c. A conkeyref whose key resolves to a file that does not exist. The keydef's
  // own href is reported in step 1; Oxygen files the reference twice, once there and
  // once on the element that reaches the file through the key.
  for (const c of crawl.conkeyrefTargets) {
    if (env.host.cancelled?.()) break;
    if (!c.dita) continue;
    if (!(await exists(c.target))) {
      issues.push({
        category: 'missing-reference', severity: 'error', file: c.file, line: c.line,
        msg: msg('ref.missingConkeyref', c.href),
      });
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

  // 2a. The class-dependent rules of the DITA structure: a written @class the syntax
  // rejects, an element no DTD gives a class, an @domains that claims nothing, and a
  // section whose title is not first or not alone. They read the DTD defaults of the
  // crawled files, so they belong to batch validation.
  if (opts.batchValidate) {
    issues.push(...classFormatIssues(crawl));
    issues.push(...domainsFormatIssues(crawl));
    issues.push(...sectionStructureIssues(crawl));
    issues.push(...ditaParseIssues(crawl, norm));
  }

  // 2b. A content reference (conref) that resolves to a file that exists, but whose
  // topic-id segment names no topic element there. Oxygen files this as
  // dmv.invalid.ref.topic.id; it is part of validating references, so it runs with batch validation.
  if (opts.batchValidate) issues.push(...invalidRefTopicIds(crawl, norm));

  // 2c. The filter file the run itself uses: a condition written twice can only ever
  // take effect once (Oxygen's dmv.dup.cond.filter, an error on the filter file).
  if (opts.batchValidate && opts.ditavalFiles.length > 0) {
    issues.push(...(await duplicateFilterConditionIssues(crawl, opts, env)));
  }

  // 3. References outside the map folder. A target that does not exist at all is
  // already a missing reference; only an existing one can be "outside the folder".
  if (opts.reportOutsideMapFolder && rootDir) {
    const prefix = norm(rootDir).replace(/\/+$/, '') + '/';
    for (const ref of crawl.refs) {
      if (!ref.target || ref.remote) continue;
      if (!norm(ref.target).startsWith(prefix)) {
        if (!(await exists(ref.target))) continue;
        issues.push({
          category: 'outside-folder', severity: 'warning', file: ref.file, line: ref.line,
          msg: msg('ref.outsideFolder', ref.href),
        });
      }
    }
  }

  // 3b. Reference spelling, capitalization, folder targets, cycles, key and id
  // syntax, @format/@scope and navigation titles (Oxygen's reference families).
  // They ride the existing "check non-DITA references" option, except the id
  // syntax, which belongs to batch validation.
  if (opts.checkNonDita) {
    issues.push(...referenceSyntaxIssues(crawl));
    issues.push(...(await incorrectCaseIssues(crawl, env.host)));
    issues.push(...(await folderReferenceIssues(crawl, env.host)));
    for (const r of crawl.recursiveRefs) {
      issues.push({
        category: 'recursive-reference', severity: 'error', file: r.file, line: r.line,
        msg: msg('ref.recursiveMap', r.href),
      });
    }
    issues.push(...invalidKeySyntaxIssues(crawl));
    issues.push(...formatIssues(crawl));
    issues.push(...referenceDocumentIssues(crawl, norm));
    issues.push(...conrefClassIssues(crawl, norm));
    issues.push(...typeClassIssues(crawl, norm));
    issues.push(...externalScopeIssues(crawl));
    for (const c of crawl.ignoredMaprefContent) {
      issues.push({
        category: 'ignored-mapref-content', severity: 'error', file: c.file, line: c.line,
        msg: msg('ref.maprefContent'),
      });
    }
    issues.push(...missingNavTitleIssues(crawl));
    issues.push(...conrefFormIssues(crawl, norm));
    issues.push(...idReferenceIssues(crawl, norm));
    issues.push(...filteredReferenceIssues(crawl, norm));
    issues.push(...topicrefToElementIssues(crawl));
    issues.push(...keyLinkIssues(crawl));
    issues.push(...linkTargetIssues(crawl));
    issues.push(...resourceOnlyTargetIssues(crawl, norm));
  }
  if (opts.batchValidate) issues.push(...invalidIdSyntaxIssues(crawl));

  // 4. Links to topics that no map references.
  if (opts.reportUnreferencedLinks) {
    const inMap = new Set<string>();
    for (const ref of crawl.refs) {
      // A topicref that names an element id publishes no topic (Oxygen's
      // dmv.topicref.to.element): the file stays out of the map for link checks.
      if (ref.target && ref.dita && !ref.inReltable && (ref.kind === 'topicref' || ref.kind === 'keydef') && !namesElement(ref.href)) {
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

  // 5. Same topic referenced more than once. A unique @copy-to makes it a different
  // topic, and so does a different key scope (R008). Corpus 6's probes settled every
  // shape Oxygen was asked about, over four runs: reported at the root, in one container,
  // across containers, inside one keyscope (p-dup-k, the control, is that last shape) and
  // for two separate keyscope="a b" groups (p-dup-l); silent for s1 against s2, the root
  // against s1, s2 nested in s1, "a b" against "a", "a b" against "b a" and s1 > x against
  // s2 > x. So the declaring element is not the identity and the innermost name alone is
  // not either: the whole chain counts, its names count in the order written, and they
  // split on whitespace (p-dup-n reports "a b" against "a  b").
  if (opts.reportMultipleRefs) {
    const groups = new Map<string, Reference[]>();
    for (const ref of crawl.refs) {
      if (ref.kind !== 'topicref' || ref.inReltable || !ref.dita || !ref.target) continue;
      const identity = `${ref.copyTo ? copyToKey(ref) : norm(ref.target)}\u0000${scopeKey(ref)}`;
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
      // A duplicate is a property of the whole group: report every topic that
      // shares the id (as Oxygen does), each related to the others, not just the
      // later arrivals. Reporting one side left the other file invisible.
      for (const dup of list) {
        issues.push({
          category: 'duplicate-id',
          severity: 'error',
          file: dup.file,
          line: dup.line,
          msg: msg('id.duplicate', id, list.length),
          related: list.filter((o) => o !== dup).map((o) => ({ file: o.file, line: o.line })),
        });
      }
    }
    issues.push(...duplicateElementIdIssues(crawl, norm));
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

  // 8. Key definitions nothing refers to. A use counts only when it resolves to the
  // definition: a bare keyref that fails in its scope (R066) leaves the definition unused,
  // which is what Oxygen's `dmv.not.used.key.defs` reports for corpus 6's q-unused-pos.
  // A definition answers to every name it is qualified by, so one resolved use is enough.
  if (opts.reportUnreferencedKeys) {
    for (const def of crawl.keyDefs) {
      if (!def.qualified.some((q) => crawl.usedKeyNames.has(q))) {
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
    for (const u of crawl.emptyProfilingValues) {
      issues.push({
        category: 'empty-profiling-value', severity: 'warning', file: u.file, line: u.line,
        msg: msg('prof.emptyValue', u.attribute, u.tag),
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

// ── Reference spelling and structure (batch 1) ──────────────────────────

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function pathPartOf(href: string): string {
  const i = href.indexOf('#');
  return i >= 0 ? href.slice(0, i) : href;
}

/**
 * An absolute path reference: `/x` (not protocol-relative `//x`), or a `file:`
 * URL whose path is absolute (`file:/x`, `file:///x`). A drive-letter form
 * (`Z:/x`) is left alone: it is a machine path, so the crawl treats it as
 * remote and the check never probes it.
 */
function isAbsoluteHrefPath(p: string): boolean {
  return /^\/(?!\/)/.test(p) || /^file:\/\/\//i.test(p) || /^file:\/[^/]/i.test(p);
}

/** Characters that RFC 3986 requires to be percent-encoded in a path. */
function hasUnencodedChars(p: string): boolean {
  if (/\s/.test(p) || p.includes('[') || p.includes(']')) return true;
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '%' && !/^[0-9A-Fa-f]{2}$/.test(p.slice(i + 1, i + 3))) return true;
  }
  return false;
}

/** Spelling problems in the href itself (Oxygen's dmv.*.ref family). */
function referenceSyntaxIssues(crawl: CrawlResult): Array<Omit<Issue, 'message'>> {
  const out: Array<Omit<Issue, 'message'>> = [];
  const push = (ref: Reference, severity: Issue['severity'], code: MsgCode, ...args: Array<string | number>): void => {
    out.push({ category: 'reference-syntax', severity, file: ref.file, line: ref.line, msg: msg(code, ...args) });
  };
  for (const ref of crawl.refs) {
    if (ref.viaKeyref) continue;
    const p = pathPartOf(ref.href);
    if (!p) continue;
    if (isAbsoluteHrefPath(p)) {
      // No arguments: the href may name a machine path, and findings are committed.
      push(ref, 'warning', 'ref.absolute');
      continue;
    }
    const url = URL_SCHEME.test(ref.href);
    if (!url) {
      // Windows separators and doubled/trailing slashes are local-path spelling.
      // A URL's `//` belongs to its authority and is not a doubled path slash.
      if (p.includes('\\')) {
        push(ref, 'error', 'ref.winSeparators', ref.href);
        continue;
      }
      if (p.includes('//')) {
        push(ref, 'warning', 'ref.doubleSlash', ref.href);
        continue;
      }
      if (p.endsWith('/')) {
        push(ref, 'warning', 'ref.trailingSlash', ref.href);
        continue;
      }
    }
    if (hasUnencodedChars(p)) push(ref, 'error', 'ref.unencoded', ref.href);
  }
  return out;
}

/**
 * A path segment whose spelling differs from the file on disk only in case. On
 * a case-insensitive file system the reference resolves anyway; on a case-
 * sensitive one it breaks, so the spelling is reported wherever it is seen.
 */
async function incorrectCaseIssues(crawl: CrawlResult, host: CrawlHost): Promise<Array<Omit<Issue, 'message'>>> {
  if (!host.readDir) return [];
  const cache = new Map<string, Promise<string[] | undefined>>();
  const list = (dir: string): Promise<string[] | undefined> => {
    let p = cache.get(dir);
    if (!p) cache.set(dir, (p = host.readDir!(dir)));
    return p;
  };
  const out: Array<Omit<Issue, 'message'>> = [];
  for (const ref of crawl.refs) {
    if (ref.viaKeyref || ref.remote || !ref.target) continue;
    // A folder target is the folder-reference check's finding, not a case one.
    if (host.isDirectory && (await host.isDirectory(ref.target))) continue;
    const rel = relative(dirname(ref.file), ref.target);
    if (!rel || isAbsolute(rel)) continue;
    let dir = dirname(ref.file);
    let wrong: { actual: string } | undefined;
    for (const segment of rel.split(/[\\/]+/)) {
      if (!segment || segment === '.') continue;
      if (segment === '..') {
        dir = dirname(dir);
        continue;
      }
      const entries = await list(dir);
      if (!entries) {
        wrong = undefined;
        break;
      }
      const actual = entries.find((e) => e.toLowerCase() === segment.toLowerCase());
      if (!actual) {
        wrong = undefined; // does not exist at all: a missing-reference finding
        break;
      }
      if (actual !== segment && !wrong) wrong = { actual };
      dir = join(dir, actual);
    }
    if (wrong) {
      out.push({
        category: 'incorrect-case-reference', severity: 'error', file: ref.file, line: ref.line,
        msg: msg('ref.wrongCase', ref.href, wrong.actual),
      });
    }
  }
  return out;
}

/** A reference whose target is an existing folder (Oxygen's dmv.folder.ref). */
async function folderReferenceIssues(crawl: CrawlResult, host: CrawlHost): Promise<Array<Omit<Issue, 'message'>>> {
  if (!host.isDirectory) return [];
  const out: Array<Omit<Issue, 'message'>> = [];
  for (const ref of crawl.refs) {
    if (ref.viaKeyref || ref.remote || !ref.target) continue;
    if (!(await host.isDirectory(ref.target))) continue;
    out.push({
      category: 'folder-reference', severity: 'error', file: ref.file, line: ref.line,
      msg: msg('ref.folder', ref.href),
    });
  }
  return out;
}

/** A keyref that cannot name a key: more than one `/`, or whitespace in it. */
function invalidKeySyntaxIssues(crawl: CrawlResult): Array<Omit<Issue, 'message'>> {
  const out: Array<Omit<Issue, 'message'>> = [];
  for (const use of crawl.keyUses) {
    if (!use.keySyntax) continue;
    out.push({
      category: 'invalid-key-syntax', severity: 'error', file: use.file, line: use.line,
      msg: msg(use.keySyntax === 'slash' ? 'key.invalidSlash' : 'key.invalidWhitespace', use.value ?? use.key),
    });
  }
  return out;
}

/** The DITA `@id` grammar is XML's NCName: a letter or `_` first, then letters, digits, `.`, `-`, `_`, `·` and combining marks. */
const DITA_ID = /^[A-Za-z_\p{L}][\p{L}\p{Nd}._\-\u00B7\p{Mn}\p{Mc}]*$/u;

function invalidIdSyntaxIssues(crawl: CrawlResult): Array<Omit<Issue, 'message'>> {
  const out: Array<Omit<Issue, 'message'>> = [];
  for (const id of crawl.ids) {
    if (DITA_ID.test(id.id)) continue;
    out.push({
      category: 'invalid-id-syntax', severity: 'error', file: id.file, line: id.line,
      msg: msg('id.invalid', id.id),
    });
  }
  return out;
}

/** What the file-name extension says the target is; `xml` and no extension say nothing. */
type TargetKind = 'topic' | 'map' | 'resource' | 'unknown';

function hrefTargetKind(pathPart: string): TargetKind {
  const m = /\.([A-Za-z0-9]+)$/.exec(pathPart);
  if (!m) return 'unknown';
  const ext = m[1].toLowerCase();
  if (ext === 'ditamap') return 'map';
  if (ext === 'dita') return 'topic';
  if (ext === 'xml') return 'unknown';
  return 'resource';
}

/** `@format` that is missing for the target kind, or contradicts it. */
function formatIssues(crawl: CrawlResult): Array<Omit<Issue, 'message'>> {
  const out: Array<Omit<Issue, 'message'>> = [];
  const push = (
    ref: Reference, category: 'format-missing' | 'format-mismatch', severity: Issue['severity'],
    code: MsgCode, ...args: Array<string | number>
  ): void => {
    out.push({ category, severity, file: ref.file, line: ref.line, msg: msg(code, ...args) });
  };
  for (const ref of crawl.refs) {
    if (ref.viaKeyref || ref.remote) continue;
    if (ref.kind !== 'topicref' && ref.kind !== 'mapref' && ref.kind !== 'xref' && ref.kind !== 'link') continue;
    // An explicit external scope is the external-reference check's business.
    if (ref.scope === 'external' || ref.scope === 'peer') continue;
    const p = pathPartOf(ref.href);
    if (!p) continue;
    const kind = hrefTargetKind(p);
    if (kind === 'unknown') continue;
    const fmt = ref.format;
    if (kind === 'topic') {
      if (fmt === 'ditamap') push(ref, 'format-mismatch', 'error', 'ref.topicAsMap', ref.href);
      else if (fmt === 'xml' && (ref.kind === 'topicref' || ref.kind === 'mapref')) {
        push(ref, 'format-mismatch', 'warning', 'ref.topicFormat', ref.href, fmt);
      }
    } else if (kind === 'map') {
      // A mapref defaults to format="ditamap"; a topicref (or link) does not, so an
      // undeclared format only contradicts the target outside a mapref.
      if (fmt === 'dita' || (fmt === undefined && ref.tag !== 'mapref')) {
        push(ref, 'format-mismatch', 'error', 'ref.mapFormat', ref.href);
      }
    } else if (fmt === 'dita') {
      push(ref, 'format-mismatch', 'error', 'ref.resAsDita', ref.href);
    } else if (fmt === 'ditamap') {
      push(ref, 'format-mismatch', 'error', 'ref.resAsMap', ref.href);
    } else if (fmt === undefined) {
      if (ref.kind === 'xref' || ref.kind === 'link') push(ref, 'format-missing', 'error', 'ref.noFormat', ref.href);
      else if (ref.kind === 'topicref') push(ref, 'format-mismatch', 'error', 'ref.resAsDita', ref.href);
    }
  }
  return out;
}

/**
 * A reference that claims DITA content whose target is not a DITA document: it parsed,
 * but its root element is neither a topic nor a map. Oxygen files this as
 * `dmv.ref.res.as.dita`; the target's own finding ("root element is not a DITA topic")
 * is a separate row. A target that is a topic or a map but writes no DOCTYPE is not
 * this rule's business: its elements get no class and the class check reports that.
 */
function referenceDocumentIssues(crawl: CrawlResult, norm: (p: string) => string): Array<Omit<Issue, 'message'>> {
  const out: Array<Omit<Issue, 'message'>> = [];
  const roots = new Map<string, FileRoot>(crawl.fileRoots.map((r) => [norm(r.file), r]));
  for (const ref of crawl.refs) {
    if (ref.viaKeyref || ref.remote || !ref.target || !ref.dita) continue;
    if (ref.kind !== 'topicref' && ref.kind !== 'mapref' && ref.kind !== 'xref' && ref.kind !== 'link') continue;
    if (ref.scope === 'external' || ref.scope === 'peer') continue;
    // A file name that says resource is the res-as-dita/res-as-map rule's business, and
    // that rule already reports it; only a name that says nothing or says DITA gets here.
    const p = pathPartOf(ref.href);
    if (p && hrefTargetKind(p) === 'resource') continue;
    const root = roots.get(norm(ref.target));
    // Never parsed here (not a DITA target of this crawl, or unreadable): nothing to say.
    if (!root) continue;
    if (root.dita) continue;
    out.push({
      category: 'format-mismatch', severity: 'error', file: ref.file, line: ref.line,
      msg: msg('ref.notDitaDoc', ref.href),
      related: [{ file: root.file, line: root.line }],
    });
  }
  return out;
}

/** The class-dependent rules read the @class the crawl resolved, per finding kind. */
function classFormatIssues(crawl: CrawlResult): Array<Omit<Issue, 'message'>> {
  const codes: Record<string, MsgCode> = {
    'not-specified': 'class.notSpecified',
    'empty': 'class.empty',
    'no-marker': 'class.noMarker',
    'no-trailing-space': 'class.noTrailingSpace',
  };
  return crawl.classIssues.map((c) => ({
    category: 'class-format' as const, severity: 'error' as const, file: c.file, line: c.line,
    msg: msg(codes[c.problem], c.tag),
  }));
}

/** An @domains written empty (Oxygen's dmv.invalid.domains.format). */
function domainsFormatIssues(crawl: CrawlResult): Array<Omit<Issue, 'message'>> {
  return crawl.domainsIssues.map((d) => ({
    category: 'domains-format' as const, severity: 'error' as const, file: d.file, line: d.line,
    msg: msg('domains.missing', d.tag),
  }));
}

/** A section title that does not come first, or is not the only one (Oxygen's dmv.section.*). */
function sectionStructureIssues(crawl: CrawlResult): Array<Omit<Issue, 'message'>> {
  return crawl.sectionIssues.map((s) => ({
    category: (s.kind === 'first-title' ? 'section-title-order' : 'section-title-duplicate') as IssueCategory,
    severity: 'error' as const, file: s.file, line: s.line,
    msg: msg(s.kind === 'first-title' ? 'section.titleFirst' : 'section.titleDuplicate'),
  }));
}

/**
 * A conref source whose class is neither the target's class nor an ancestor of it. Oxygen's
 * wording is "the source element ... is not a generalization of the target element", so a
 * source that is the general end of the target's chain (an item drawing in a step, a phrase
 * drawing in a ui control) is allowed, while a more specific source (a step drawing in an
 * item) and two sibling classes are reported; the four corpus-5 probes of the reported
 * shapes all answer with `dmv.invalid.class.generalization`, and Oxygen never used the
 * specialization id. The allowed direction is probed by
 * `l-class-generalization-source-general-neg.dita` and confirmed by the next real run.
 * A pair whose class cannot be known on either side is left alone.
 */
function conrefClassIssues(crawl: CrawlResult, norm: (p: string) => string): Array<Omit<Issue, 'message'>> {
  const out: Array<Omit<Issue, 'message'>> = [];
  const elements = new Map<string, { classValue?: string; file: string; line: number }>();
  for (const el of crawl.reusable) {
    if (el.topicId) elements.set(`${norm(el.topicFile)}\u0000${el.topicId}\u0000${el.id}`, el);
  }
  // The class chain lists the ancestors first, so a generalization is a prefix of it.
  const isGeneralization = (source: string, target: string): boolean => {
    const s = classChain(source);
    const t = classChain(target);
    return s.length > 0 && s.length <= t.length && s.every((pair, i) => pair === t[i]);
  };
  for (const s of crawl.conrefShapes) {
    if (!s.conref || s.classValue === undefined) continue;
    if (!s.targetFile || !s.targetTopicId || !s.targetElementId) continue;
    const target = elements.get(`${norm(s.targetFile)}\u0000${s.targetTopicId}\u0000${s.targetElementId}`);
    if (!target?.classValue) continue;
    if (isGeneralization(s.classValue, target.classValue)) continue;
    out.push({
      category: 'conref-class', severity: 'error', file: s.file, line: s.line,
      msg: msg('conref.classGeneralization', s.classValue, target.classValue),
      related: [{ file: target.file, line: target.line }],
    });
  }
  return out;
}

/**
 * `@type` names a DITA type; the target's own class chain says what it really is. The
 * name of the most specific pair is an exact match, an earlier pair is the "too general"
 * warning (Oxygen's dmv.ref.type.class.mismatch.specific), any other name is a mismatch.
 * The check needs the target's root class, so a target this crawl never parsed is left
 * alone.
 */
function typeClassIssues(crawl: CrawlResult, norm: (p: string) => string): Array<Omit<Issue, 'message'>> {
  const out: Array<Omit<Issue, 'message'>> = [];
  const roots = new Map<string, FileRoot>(crawl.fileRoots.map((r) => [norm(r.file), r]));
  for (const ref of crawl.refs) {
    if (!ref.type || ref.viaKeyref || ref.remote || !ref.target) continue;
    const root = roots.get(norm(ref.target));
    if (!root?.classValue) continue;
    const type = ref.type.trim();
    if (!type) continue;
    const chain = classChain(root.classValue);
    const own = chain.length ? classPairTag(chain[chain.length - 1]) : '';
    if (own === type) continue;
    const specific = chain.some((p) => classPairTag(p) === type);
    out.push({
      category: specific ? 'type-class-specific' : 'type-class-mismatch', severity: 'warning',
      file: ref.file, line: ref.line,
      msg: msg(specific ? 'ref.typeTooGeneral' : 'ref.typeMismatch', type, root.classValue),
    });
  }
  return out;
}

/**
 * A reference to DITA content that does not parse. Oxygen reports it on the map or topic
 * that makes the reference, not on the broken file (which keeps its own XML error), so
 * the finding names the referrer and points at the target. A remote target is never
 * fetched by this crawl and is left alone.
 */
function ditaParseIssues(crawl: CrawlResult, norm: (p: string) => string): Array<Omit<Issue, 'message'>> {
  const out: Array<Omit<Issue, 'message'>> = [];
  const broken = new Map<string, { line: number; cause: string }>();
  for (const fi of crawl.fileIssues) {
    if (fi.msg.code !== 'val.xml') continue;
    broken.set(norm(fi.file), { line: fi.line, cause: String(fi.msg.args[0] ?? '') });
  }
  if (broken.size === 0) return out;
  for (const ref of crawl.refs) {
    if (ref.remote || !ref.target || !ref.dita) continue;
    const target = broken.get(norm(ref.target));
    if (!target) continue;
    out.push({
      category: 'dita-parse', severity: 'error', file: ref.file, line: ref.line,
      msg: msg('ref.ditaParse', ref.href, target.cause),
      related: [{ file: ref.target, line: target.line }],
    });
  }
  return out;
}

/** `scope="external"` needs a `@format`; a URL needs `scope="external"` (Oxygen's dmv.topicref.remote.*). */
function externalScopeIssues(crawl: CrawlResult): Array<Omit<Issue, 'message'>> {
  const out: Array<Omit<Issue, 'message'>> = [];
  for (const ref of crawl.refs) {
    if (ref.viaKeyref) continue;
    const external = ref.scope === 'external' || ref.scope === 'peer';
    if (!external) {
      if (ref.inMap && /^https?:/i.test(ref.href)) {
        out.push({
          category: 'external-reference', severity: 'warning', file: ref.file, line: ref.line,
          msg: msg('ref.needsExternalScope', ref.href),
        });
      }
      continue;
    }
    if (ref.format) continue;
    const p = pathPartOf(ref.href);
    if (!p) continue;
    // A URL, or a local file that is not a DITA topic/map, needs a format too.
    if (URL_SCHEME.test(ref.href) || hrefTargetKind(p) === 'resource') {
      out.push({
        category: 'format-missing', severity: 'warning', file: ref.file, line: ref.line,
        msg: msg('ref.extNoFormat', ref.href),
      });
    }
  }
  return out;
}

/** topichead, and an explicitly external topicref, need a navigation title. */
function missingNavTitleIssues(crawl: CrawlResult): Array<Omit<Issue, 'message'>> {
  const out: Array<Omit<Issue, 'message'>> = [];
  for (const entry of crawl.mapEntries) {
    if (entry.navTitle) continue;
    if (entry.tag === 'topichead') {
      out.push({
        category: 'missing-navtitle', severity: 'warning', file: entry.file, line: entry.line,
        msg: msg('nav.topichead'),
      });
    } else if (entry.tag === 'topicref' && (entry.scope === 'external' || entry.scope === 'peer') && !entry.keyref) {
      out.push({
        category: 'missing-navtitle', severity: 'warning', file: entry.file, line: entry.line,
        msg: msg('nav.topicref', entry.href ?? ''),
      });
    }
  }
  return out;
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

/**
 * The key scopes a reference sits in, as one string (empty at the root scope). A
 * `keyscope` listing several names gives several chains, and the names are the identity
 * rather than the element that declares them: two separate `keyscope="a b"` groups are
 * one scope (corpus 6's p-dup-l) and the whole chain counts, not its innermost name
 * (p-dup-m). The order of the names is part of it -- Oxygen reports a pair inside one
 * `keyscope="s1"` group (p-dup-k) but stays silent on "a b" against "b a" (p-dup-j) --
 * so the names count as a list in the order written, not as a set, split on whitespace
 * (p-dup-n).
 */
function scopeKey(ref: Reference): string {
  return (ref.scopeChains ?? [[]]).map((chain) => chain.join('/')).join('\u0000');
}

/** Normalized target file -> the set of topic ids declared in it (root and nested). */
function topicIdsByFile(crawl: CrawlResult, norm: (p: string) => string): Map<string, Set<string>> {
  const byFile = new Map<string, Set<string>>();
  for (const t of crawl.topicIds) {
    const k = norm(t.topicFile);
    let s = byFile.get(k);
    if (!s) byFile.set(k, (s = new Set()));
    s.add(t.id);
  }
  return byFile;
}

/**
 * A `@conref` whose target file was found but whose topic-id segment (the part after
 * `#`) names no topic element in that file. The DITA addressing rule is
 * `file#topicID/elemID`: the topic-id segment must resolve. Oxygen reports this as
 * `dmv.invalid.ref.topic.id`. Files we never crawled are skipped (their reference
 * problem is already reported elsewhere), so this only fires on a confirmed mismatch.
 */
function invalidRefTopicIds(crawl: CrawlResult, norm: (p: string) => string): Array<Omit<Issue, 'message'>> {
  const byFile = topicIdsByFile(crawl, norm);
  const out: Array<Omit<Issue, 'message'>> = [];
  for (const use of crawl.conrefUses) {
    if (use.key || !use.targetFile || !use.topicId || !use.sourceFile) continue;
    const ids = byFile.get(norm(use.targetFile));
    if (!ids || ids.has(use.topicId)) continue;
    out.push({
      category: 'invalid-ref-topic-id', severity: 'error', file: use.sourceFile, line: use.sourceLine ?? 1,
      msg: msg('ref.invalidTopicId', use.topicId),
    });
  }
  return out;
}

/** Fragment segments of an href, or undefined when it has no `#` part. */
function fragmentSegments(href: string): string[] | undefined {
  const i = href.indexOf('#');
  return i < 0 ? undefined : href.slice(i + 1).split('/');
}

/** Whether an href's fragment names an element inside its topic (`topic/element`). */
function namesElement(href: string): boolean {
  const segs = fragmentSegments(href);
  return !!segs && segs.length > 1 && segs[1] !== '';
}

/**
 * The shape rules of `@conref`/`@conrefend` (Oxygen's dmv.conref.* family), and
 * `-dita-use-conref-target` on an element that is not a content reference. A range
 * is checked in three steps: both ends must name the same file, their elements must
 * be siblings, and the start must not follow the end. A conref naming a whole topic
 * is not a missing id here (Oxygen files that under dmv.invalid.class.generalization).
 */
function conrefFormIssues(crawl: CrawlResult, norm: (p: string) => string): Array<Omit<Issue, 'message'>> {
  const out: Array<Omit<Issue, 'message'>> = [];
  // (normalized file, topic id, element id) -> the reusable element, for the
  // sibling and order comparisons.
  const elements = new Map<string, { parentKey?: string; order?: number }>();
  for (const el of crawl.reusable) {
    if (el.topicId) elements.set(`${norm(el.topicFile)}\u0000${el.topicId}\u0000${el.id}`, el);
  }
  const find = (file: string | undefined, topicId: string | undefined, elementId: string | undefined) =>
    file && topicId && elementId ? elements.get(`${norm(file)}\u0000${topicId}\u0000${elementId}`) : undefined;
  for (const s of crawl.conrefShapes) {
    const conref = s.conref;
    const end = s.conrefend;
    if (conref !== undefined && conref !== '' && !conref.includes('#')) {
      out.push({
        category: 'invalid-conref-form', severity: 'error', file: s.file, line: s.line,
        msg: msg('conref.missingId', conref),
      });
    }
    if (end !== undefined && conref === undefined) {
      out.push({
        category: 'invalid-conref-form', severity: 'error', file: s.file, line: s.line,
        msg: msg('conref.endNoStart', end),
      });
      continue;
    }
    if (end === undefined || conref === undefined) continue;
    // conref="" counts as present: Oxygen reports the conflict, not a missing conref.
    const startFile = conref === '' ? undefined : s.targetFile;
    const endFile = end === '' ? undefined : s.endTargetFile;
    const differentFile = startFile === undefined || endFile === undefined
      ? startFile !== endFile
      : norm(startFile) !== norm(endFile);
    if (differentFile) {
      out.push({
        category: 'invalid-conref-form', severity: 'error', file: s.file, line: s.line,
        msg: msg('conref.endOtherFile', end, conref),
      });
      continue;
    }
    const start = find(s.targetFile, s.targetTopicId, s.targetElementId);
    const last = find(s.endTargetFile, s.endTopicId, s.endElementId);
    if (!start || !last) continue;
    if (start.parentKey !== last.parentKey) {
      out.push({
        category: 'invalid-conref-form', severity: 'error', file: s.file, line: s.line,
        msg: msg('conref.siblings', conref, end),
      });
    } else if (start.order !== undefined && last.order !== undefined && start.order >= last.order) {
      out.push({
        category: 'invalid-conref-form', severity: 'error', file: s.file, line: s.line,
        msg: msg('conref.order', conref, end),
      });
    }
  }
  for (const v of crawl.conrefTargetValues) {
    out.push({
      category: 'invalid-conref-form', severity: 'warning', file: v.file, line: v.line,
      msg: msg('conref.targetValue', v.tag, v.attribute, v.value),
    });
  }
  return out;
}

/**
 * An element-id part that does not resolve in the topic its reference names
 * (Oxygen's dmv.invalid.ref.id.path), a fragment that ends in a slash
 * (dmv.bad.id.ref), and paths deeper than DITA's `topic/element` form. The
 * topic-id part is invalidRefTopicIds' business; a file never crawled is left alone.
 */
function idReferenceIssues(crawl: CrawlResult, norm: (p: string) => string): Array<Omit<Issue, 'message'>> {
  const out: Array<Omit<Issue, 'message'>> = [];
  const topicIds = topicIdsByFile(crawl, norm);
  const excluded = excludedIndex(crawl, norm);
  const elements = new Map<string, Set<string>>();
  for (const el of crawl.reusable) {
    if (!el.topicId) continue;
    const k = `${norm(el.topicFile)}\u0000${el.topicId}`;
    let s = elements.get(k);
    if (!s) elements.set(k, (s = new Set()));
    s.add(el.id);
  }
  const check = (file: string, line: number, target: string | undefined, topicId: string | undefined, path: string): void => {
    if (!target || !topicId) return;
    const known = topicIds.get(norm(target));
    if (!known || !known.has(topicId)) return;
    const ids = elements.get(`${norm(target)}\u0000${topicId}`);
    if (!ids) return;
    // DITA addresses one element: a deeper path is invalid even when each id exists.
    if (path.includes('/') || !ids.has(path)) {
      // An element the filter drops is not a missing one: dmv.ref.filtered reports it.
      if (!path.includes('/') && isInIndex(excluded, norm, target, topicId, path)) return;
      out.push({
        category: 'invalid-id-reference', severity: 'error', file, line,
        msg: msg('id.pathNotFound', `${topicId}/${path}`),
      });
    }
  };
  for (const ref of crawl.refs) {
    if (ref.viaKeyref || ref.remote || !ref.target || !ref.dita) continue;
    if (ref.kind !== 'conref' && ref.kind !== 'xref' && ref.kind !== 'link') continue;
    const segs = fragmentSegments(ref.href);
    if (!segs || segs.length < 2) continue;
    const topicId = segs[0];
    if (!topicId || topicId === '.') continue;
    if (segs[segs.length - 1] === '') {
      out.push({
        category: 'invalid-id-reference', severity: 'error', file: ref.file, line: ref.line,
        msg: msg('id.badReference', segs.join('/')),
      });
      continue;
    }
    check(ref.file, ref.line, ref.target, topicId, segs.slice(1).join('/'));
  }
  // `key/element` appends an element id to whatever topic the key resolves to.
  for (const k of crawl.keyElementPaths) {
    check(k.file, k.line, k.targetFile, k.topicId, k.elementPath);
  }
  return out;
}

/**
 * Element ids of one file, keyed the way a fragment addresses them: `topic\0element`
 * when the element sits in a topic that carries an id, plain file otherwise.
 */
interface IdIndex {
  byTopic: Map<string, Set<string>>;
  byFile: Map<string, Set<string>>;
}

function addToIdIndex(index: IdIndex, norm: (p: string) => string, file: string, topicId: string | undefined, id: string): void {
  const key = norm(file);
  if (!topicId) {
    const s = index.byFile.get(key);
    if (s) s.add(id);
    else index.byFile.set(key, new Set([id]));
    return;
  }
  const k = `${key}\u0000${topicId}`;
  const s = index.byTopic.get(k);
  if (s) s.add(id);
  else index.byTopic.set(k, new Set([id]));
}

/** The index a `#topic/elem` address has to be looked up in: topic id when the reference names one. */
function isInIndex(index: IdIndex, norm: (p: string) => string, file: string | undefined, topicId: string | undefined, id: string): boolean {
  if (!file) return false;
  const key = norm(file);
  if (!topicId) return !!index.byFile.get(key)?.has(id);
  return !!index.byTopic.get(`${key}\u0000${topicId}`)?.has(id);
}

/** Elements the active DITAVAL filter drops (Oxygen's dmv.ref.filtered). */
function excludedIndex(crawl: CrawlResult, norm: (p: string) => string): IdIndex {
  const index: IdIndex = { byTopic: new Map(), byFile: new Map() };
  for (const el of crawl.excludedElements) addToIdIndex(index, norm, el.file, el.topicId, el.id);
  return index;
}

/** Elements whose own content a carrying ancestor's `@conref` replaces (dmv.ref.filtered.conref). */
function shadowedIndex(crawl: CrawlResult, norm: (p: string) => string): IdIndex {
  const index: IdIndex = { byTopic: new Map(), byFile: new Map() };
  for (const el of crawl.reusable) {
    if (el.replacedByConref) addToIdIndex(index, norm, el.file, el.topicId, el.id);
  }
  return index;
}

/**
 * A reference that addresses content the run takes out of the output: an element the
 * filter excludes (Oxygen's dmv.ref.filtered, an error on the referencing element) or
 * content that content reference processing replaces (dmv.ref.filtered.conref, a
 * warning). The element carrying a conref survives it, so a reference that names that
 * element itself is not a finding, and a path deeper than `topic/element` is
 * invalid-id-reference's business, not this check's.
 */
function filteredReferenceIssues(crawl: CrawlResult, norm: (p: string) => string): Array<Omit<Issue, 'message'>> {
  const out: Array<Omit<Issue, 'message'>> = [];
  const excluded = excludedIndex(crawl, norm);
  const shadowed = shadowedIndex(crawl, norm);
  const pathOf = (topicId: string | undefined, elemId: string) => (topicId ? `${topicId}/${elemId}` : elemId);
  const report = (file: string, line: number, target: string | undefined, topicId: string | undefined, elemId: string): void => {
    if (!target) return;
    if (isInIndex(excluded, norm, target, topicId, elemId)) {
      out.push({
        category: 'filtered-reference', severity: 'error', file, line,
        msg: msg('ref.filteredTarget', pathOf(topicId, elemId)),
      });
    } else if (isInIndex(shadowed, norm, target, topicId, elemId)) {
      out.push({
        category: 'filtered-reference', severity: 'warning', file, line,
        msg: msg('ref.filteredByConref', pathOf(topicId, elemId)),
      });
    }
  };
  // A content reference: either end of a range can name content that is gone.
  for (const s of crawl.conrefShapes) {
    if (s.conref !== undefined && s.targetElementId) report(s.file, s.line, s.targetFile, s.targetTopicId, s.targetElementId);
    if (s.conrefend !== undefined && s.endElementId) report(s.file, s.line, s.endTargetFile, s.endTopicId, s.endElementId);
  }
  // Links: an own-file fragment names no path, so the referencing file is the target.
  for (const ref of crawl.refs) {
    if (ref.remote || ref.viaKeyref || ref.kind !== 'xref' && ref.kind !== 'link') continue;
    const segs = fragmentSegments(ref.href);
    if (!segs || segs.length !== 2 || !segs[1]) continue;
    report(ref.file, ref.line, ref.target ?? ref.file, segs[0] || undefined, segs[1]);
  }
  for (const k of crawl.keyElementPaths) {
    if (k.elementPath.includes('/')) continue;
    report(k.file, k.line, k.targetFile, k.topicId, k.elementPath);
  }
  return out;
}

/**
 * A condition the filter file states more than once: only the first one can ever be
 * used, so each later one is dead (Oxygen reports it as an error on the filter file,
 * with no problem id in the report). An unreadable file stays silent, as in the UI.
 */
async function duplicateFilterConditionIssues(
  crawl: CrawlResult,
  opts: CompletenessOptions,
  env: CheckEnv,
): Promise<Array<Omit<Issue, 'message'>>> {
  const out: Array<Omit<Issue, 'message'>> = [];
  const mapDir = dirname(crawl.rootMaps[0] ?? '');
  for (const stored of opts.ditavalFiles) {
    const path = resolveStoredPath(mapDir, stored);
    let text: string;
    try {
      text = await env.host.readFile(path);
    } catch {
      continue;
    }
    const seen = new Set<string>();
    for (const rule of parseDitavalRules(text)) {
      // A rule with no @val is the attribute-level default; its condition is the attribute.
      const cond = rule.val === undefined ? rule.att : `${rule.att}=${rule.val}`;
      if (!seen.has(cond)) {
        seen.add(cond);
        continue;
      }
      out.push({
        category: 'duplicate-filter-condition', severity: 'error', file: path, line: rule.line,
        msg: msg('ditaval.duplicateCondition', cond),
      });
    }
  }
  return out;
}

/** A topicref whose fragment names an element id rather than a topic id. */
function topicrefToElementIssues(crawl: CrawlResult): Array<Omit<Issue, 'message'>> {
  const out: Array<Omit<Issue, 'message'>> = [];
  for (const ref of crawl.refs) {
    if (ref.kind !== 'topicref' || ref.viaKeyref || ref.remote || !ref.dita) continue;
    if (!namesElement(ref.href)) continue;
    out.push({
      category: 'topicref-to-element', severity: 'error', file: ref.file, line: ref.line,
      msg: msg('topicref.element', fragmentSegments(ref.href)!.join('/')),
    });
  }
  return out;
}

/** An xref/link whose keyref resolves to a key defined without a target (text only). */
function keyLinkIssues(crawl: CrawlResult): Array<Omit<Issue, 'message'>> {
  return crawl.keyLinksWithoutTarget.map((k) => ({
    category: 'link-key-without-target' as const, severity: 'warning' as const, file: k.file, line: k.line,
    msg: msg('key.linkNoTarget', k.key, k.value),
  }));
}

/** An xref/link with no @href, @keyref, @conref or @conkeyref to follow. */
function linkTargetIssues(crawl: CrawlResult): Array<Omit<Issue, 'message'>> {
  return crawl.linksWithoutTarget.map((l) => ({
    category: 'link-no-target' as const, severity: 'warning' as const, file: l.file, line: l.line,
    msg: msg('link.noTarget', l.tag),
  }));
}

/**
 * An xref/link to a topic that only resource-only map references publish: the topic is
 * not in the output, so the link breaks. A keydef counts as a publication — DITA gives it
 * `resource-only` by default — and a normal topicref or keydef for the same file (an
 * @copy-to instance included) keeps it published and silences the finding.
 */
function resourceOnlyTargetIssues(crawl: CrawlResult, norm: (p: string) => string): Array<Omit<Issue, 'message'>> {
  const resourceOnly = new Set<string>();
  const normal = new Set<string>();
  for (const ref of crawl.refs) {
    if (ref.kind !== 'topicref' && ref.kind !== 'keydef') continue;
    if (ref.inReltable || ref.remote || !ref.dita || !ref.target) continue;
    (ref.resourceOnly ? resourceOnly : normal).add(norm(ref.target));
  }
  const out: Array<Omit<Issue, 'message'>> = [];
  for (const ref of crawl.refs) {
    if (ref.kind !== 'xref' && ref.kind !== 'link') continue;
    if (ref.remote || !ref.dita || !ref.target) continue;
    const target = norm(ref.target);
    if (!resourceOnly.has(target) || normal.has(target)) continue;
    out.push({
      category: 'resource-only-target', severity: 'warning', file: ref.file, line: ref.line,
      msg: msg('link.resourceOnly', pathPartOf(ref.href)),
    });
  }
  return out;
}

/**
 * Two non-topic elements with the same @id in one topic. Each nested topic is its
 * own uniqueness scope, and an element may reuse the id of its enclosing topic;
 * the later duplicate is reported, related to the first.
 */
function duplicateElementIdIssues(crawl: CrawlResult, norm: (p: string) => string): Array<Omit<Issue, 'message'>> {
  const groups = new Map<string, typeof crawl.reusable>();
  for (const el of crawl.reusable) {
    if (!el.topicId) continue;
    const k = `${norm(el.topicFile)}\u0000${el.topicId}\u0000${el.id}`;
    const list = groups.get(k);
    if (list) list.push(el);
    else groups.set(k, [el]);
  }
  const out: Array<Omit<Issue, 'message'>> = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const first = list[0];
    for (const dup of list.slice(1)) {
      out.push({
        category: 'duplicate-element-id', severity: 'error', file: dup.file, line: dup.line,
        msg: msg('id.duplicateElement', dup.id),
        related: [{ file: first.file, line: first.line }],
      });
    }
  }
  return out;
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
  const byFile = topicIdsByFile(crawl, norm);
  const used = new Set<string>(); // "<norm file>#<id>"
  for (const use of crawl.conrefUses) {
    const file = use.targetFile ?? (use.key ? keyTarget.get(use.key) : undefined);
    if (!file) continue;
    candidates.add(norm(file));
    if (!use.targetId) continue;
    // A broken direct conref (its topic id names no topic in the target) never pulls the
    // element in, exactly as Oxygen treats it: the target stays unreferenced-reusable.
    const ids = byFile.get(norm(file));
    if (!use.key && use.topicId && ids && !ids.has(use.topicId)) continue;
    used.add(`${norm(file)}#${use.targetId}`);
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
