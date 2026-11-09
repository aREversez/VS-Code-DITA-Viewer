// Checks on a document's own structure: @class / @domains, root and section shape, conref class, parse errors, nav titles.
// Split out of mapChecks.ts; pure functions over a crawl result, no vscode dependency.

import { dirname } from 'path';
import { CrawlResult, FileRoot, Reference } from '../mapCrawl';
import { classChain, classPairTag } from '../ditaClass';
import { msg, MsgCode } from '../mapCheckMessages';
import { Issue, IssueCategory } from './checkTypes';

/** The class-dependent rules read the @class the crawl resolved, per finding kind. */
export function classFormatIssues(crawl: CrawlResult): Array<Omit<Issue, 'message'>> {
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
export function domainsFormatIssues(crawl: CrawlResult): Array<Omit<Issue, 'message'>> {
  return crawl.domainsIssues.map((d) => ({
    category: 'domains-format' as const, severity: 'error' as const, file: d.file, line: d.line,
    msg: msg('domains.missing', d.tag),
  }));
}

/** A section title that does not come first, or is not the only one (Oxygen's dmv.section.*). */
export function sectionStructureIssues(crawl: CrawlResult): Array<Omit<Issue, 'message'>> {
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
export function conrefClassIssues(crawl: CrawlResult, norm: (p: string) => string): Array<Omit<Issue, 'message'>> {
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
export function typeClassIssues(crawl: CrawlResult, norm: (p: string) => string): Array<Omit<Issue, 'message'>> {
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
export function ditaParseIssues(crawl: CrawlResult, norm: (p: string) => string): Array<Omit<Issue, 'message'>> {
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

/** topichead, and an explicitly external topicref, need a navigation title. */
export function missingNavTitleIssues(crawl: CrawlResult): Array<Omit<Issue, 'message'>> {
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

export function missingCode(ref: Reference): MsgCode {
  switch (ref.kind) {
    case 'mapref': return 'ref.missingMap';
    case 'conref': return 'ref.missingConref';
    default: return 'ref.missingTopic';
  }
}

export function copyToKey(ref: Reference): string {
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
export function scopeKey(ref: Reference): string {
  return (ref.scopeChains ?? [[]]).map((chain) => chain.join('/')).join('\u0000');
}
