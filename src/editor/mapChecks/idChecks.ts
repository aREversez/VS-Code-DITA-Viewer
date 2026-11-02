// Checks on ids and targets: id references, conref forms, filtering, duplicate ids, resource-only and unreferenced reusable content.
// Split out of mapChecks.ts; pure functions over a crawl result, no vscode dependency.

import { dirname } from 'path';
import { CrawlResult } from '../mapCrawl';
import { parseDitavalRules } from '../ditaval';
import { msg } from '../mapCheckMessages';
import { CheckEnv, CompletenessOptions, Issue, resolveStoredPath } from './checkTypes';
import { pathPartOf } from './syntaxChecks';

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
export function invalidRefTopicIds(crawl: CrawlResult, norm: (p: string) => string): Array<Omit<Issue, 'message'>> {
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
export function namesElement(href: string): boolean {
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
export function conrefFormIssues(crawl: CrawlResult, norm: (p: string) => string): Array<Omit<Issue, 'message'>> {
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
export function idReferenceIssues(crawl: CrawlResult, norm: (p: string) => string): Array<Omit<Issue, 'message'>> {
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
export function filteredReferenceIssues(crawl: CrawlResult, norm: (p: string) => string): Array<Omit<Issue, 'message'>> {
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
export async function duplicateFilterConditionIssues(
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
export function topicrefToElementIssues(crawl: CrawlResult): Array<Omit<Issue, 'message'>> {
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
export function keyLinkIssues(crawl: CrawlResult): Array<Omit<Issue, 'message'>> {
  return crawl.keyLinksWithoutTarget.map((k) => ({
    category: 'link-key-without-target' as const, severity: 'warning' as const, file: k.file, line: k.line,
    msg: msg('key.linkNoTarget', k.key, k.value),
  }));
}

/**
 * An xref/link to a topic that only resource-only map references publish: the topic is
 * not in the output, so the link breaks. A keydef counts as a publication — DITA gives it
 * `resource-only` by default — and a normal topicref or keydef for the same file (an
 * @copy-to instance included) keeps it published and silences the finding.
 */
export function resourceOnlyTargetIssues(crawl: CrawlResult, norm: (p: string) => string): Array<Omit<Issue, 'message'>> {
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
export function duplicateElementIdIssues(crawl: CrawlResult, norm: (p: string) => string): Array<Omit<Issue, 'message'>> {
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

export function unreferencedReusable(crawl: CrawlResult, norm: (p: string) => string): Array<Omit<Issue, 'message'>> {
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
