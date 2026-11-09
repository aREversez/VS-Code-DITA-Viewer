// The checks behind "Validate and Check for Completeness". Each option in the
// dialog maps to one function below; semantics follow Oxygen's DITA Map
// Completeness Check (https://www.oxygenxml.com/doc/versions/28.1/ug-editor/topics/dita-map-validate.html),
// with two honest differences:
//   - "Batch validate" is XML well-formedness plus DITA structure checks (root
//     element, topic @id, <title>); there is no DTD/RNG validation here.
//   - Profiling preferences come from the dita-viewer.completenessCheck.*
//     settings rather than Oxygen's preferences page.

// The checks themselves live in ./mapChecks/ (types and settings, reference syntax, document
// structure, ids and targets). This file keeps the orchestrator, runChecks, plus issue de-duplication,
// and re-exports every name it has always exported, so importers of this path are unaffected.

import { dirname } from 'path';
import { normalizePathForCompare } from './mapReferenceTools';
import { CrawlResult, Reference } from './mapCrawl';
import { formatMessage, msg } from './mapCheckMessages';
import { CheckEnv, CompletenessOptions, Issue } from './mapChecks/checkTypes';
import { conrefFormIssues, duplicateElementIdIssues, duplicateFilterConditionIssues, filteredReferenceIssues, idReferenceIssues, invalidRefTopicIds, keyLinkIssues, namesElement, resourceOnlyTargetIssues, topicrefToElementIssues, unreferencedReusable } from './mapChecks/idChecks';
import { classFormatIssues, conrefClassIssues, copyToKey, ditaParseIssues, domainsFormatIssues, missingCode, missingNavTitleIssues, scopeKey, sectionStructureIssues, typeClassIssues } from './mapChecks/structureChecks';
import { externalScopeIssues, folderReferenceIssues, formatIssues, incorrectCaseIssues, invalidIdSyntaxIssues, invalidKeySyntaxIssues, linkTargetIssues, referenceDocumentIssues, referenceSyntaxIssues } from './mapChecks/syntaxChecks';

export type { CheckEnv, CheckId, CompletenessOptions, Issue, IssueCategory, ProfilingPreferences } from './mapChecks/checkTypes';
export { CHECK_IDS, DEFAULT_COMPLETENESS_OPTIONS, DEFAULT_ENABLED_CHECKS, ISSUE_CATEGORIES, normalizeEnabled, optionsFromSettings, resolveStoredPath, toStoredPath } from './mapChecks/checkTypes';

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
      // The clash belongs to the whole group: every definition that takes part is filed,
      // the first included, each related to the others (as duplicate ids are). Oxygen does
      // that -- corpus 6's r-dk2 and r-dk3 asked it, and corpus 1's two lines in one file
      // said the same, invisible there because both lines share one signature.
      for (const dup of list) {
        if (reported.has(dup)) continue;
        reported.add(dup);
        issues.push({
          category: 'duplicate-key', severity: 'warning', file: dup.file, line: dup.line,
          msg: msg('key.duplicate', dup.key, list.length),
          related: list.filter((o) => o !== dup).map((o) => ({ file: o.file, line: o.line })),
        });
      }
    }
  }

  // 8. Key definitions nothing refers to. A use counts only when it resolves to the
  // definition: a bare keyref that fails in its scope (R066) leaves the definition unused,
  // which is what Oxygen's `dmv.not.used.key.defs` reports for corpus 6's q-unused-pos.
  // A definition answers to every name it is qualified by, so one resolved use is enough.
  // An unused name is filed once, on the definition that wins: the first of two that bind
  // one name in one scope, which is the one resolution reaches. Oxygen does that -- corpus
  // 6's t-udup asked it, and the real map drew the same one-row-per-name shape.
  if (opts.reportUnreferencedKeys) {
    const firstOf = new Map<string, (typeof crawl.keyDefs)[number]>();
    for (const def of crawl.keyDefs) {
      if (def.qualified.some((q) => crawl.usedKeyNames.has(q))) continue;
      for (const scopeId of def.scopeIds) {
        const id = `${scopeId}\u0000${def.key}`;
        if (!firstOf.has(id)) firstOf.set(id, def);
      }
    }
    const filed = new Set<(typeof crawl.keyDefs)[number]>();
    for (const def of firstOf.values()) {
      if (filed.has(def)) continue;
      filed.add(def);
      issues.push({
        category: 'unreferenced-key', severity: 'warning', file: def.file, line: def.line,
        msg: msg('key.unreferenced', def.key),
      });
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
