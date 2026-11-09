// Checks on how a reference is written: spelling, case, encoding, key and id syntax, scope, and target format.
// Split out of mapChecks.ts; pure functions over a crawl result, no vscode dependency.

import { dirname, isAbsolute, join, relative } from 'path';
import { CrawlHost, CrawlResult, FileRoot, Reference } from '../mapCrawl';
import { msg, MsgCode } from '../mapCheckMessages';
import { Issue } from './checkTypes';

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function pathPartOf(href: string): string {
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
export function referenceSyntaxIssues(crawl: CrawlResult): Array<Omit<Issue, 'message'>> {
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
export async function incorrectCaseIssues(crawl: CrawlResult, host: CrawlHost): Promise<Array<Omit<Issue, 'message'>>> {
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
export async function folderReferenceIssues(crawl: CrawlResult, host: CrawlHost): Promise<Array<Omit<Issue, 'message'>>> {
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
export function invalidKeySyntaxIssues(crawl: CrawlResult): Array<Omit<Issue, 'message'>> {
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

/** A name token is XML's NMTOKEN: one or more NameChars, so a digit or a colon may open it. */
const DITA_NMTOKEN = /^[A-Za-z_0-9:\p{L}\p{Nd}.\-\u00B7\p{Mn}\p{Mc}]+$/u;

/**
 * XML 1.0 §3.3.3 normalizes every attribute that is not CDATA before it is judged: whitespace
 * runs collapse to one space and the ends are trimmed. Oxygen does that -- corpus 6's u-id drew
 * nothing for a trailing space, on a topic id as much as on a `<p>`.
 */
const normalizeIdValue = (value: string): string => value.replace(/[ \t\n\r]+/g, ' ').trim();

export function invalidIdSyntaxIssues(crawl: CrawlResult): Array<Omit<Issue, 'message'>> {
  const out: Array<Omit<Issue, 'message'>> = [];
  for (const id of crawl.ids) {
    // Which grammar applies is the element's declared type, not the value: a topic or map
    // element's @id is an XML ID, every other element's a name token (archSpec/base/id).
    // Corpus 6's u-id held that reading -- a digit-first or colon id on a `<p>` drew nothing,
    // a space or a plus drew Oxygen's `NMTOKENInvalid`, and a nested `<topic id="9n">` was an
    // ID error, as a topic id always was.
    const value = normalizeIdValue(id.id);
    const valid = id.idType === 'ID' ? DITA_ID.test(value) : DITA_NMTOKEN.test(value);
    if (valid) continue;
    out.push({
      category: 'invalid-id-syntax', severity: 'error', file: id.file, line: id.line,
      msg: msg(id.idType === 'ID' ? 'id.invalid' : 'id.invalidToken', id.id),
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
export function formatIssues(crawl: CrawlResult): Array<Omit<Issue, 'message'>> {
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
export function referenceDocumentIssues(crawl: CrawlResult, norm: (p: string) => string): Array<Omit<Issue, 'message'>> {
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

/** `scope="external"` needs a `@format`; a URL needs `scope="external"` (Oxygen's dmv.topicref.remote.*). */
export function externalScopeIssues(crawl: CrawlResult): Array<Omit<Issue, 'message'>> {
  const out: Array<Omit<Issue, 'message'>> = [];
  for (const ref of crawl.refs) {
    if (ref.viaKeyref) continue;
    const external = ref.scope === 'external' || ref.scope === 'peer';
    if (!external) {
      // A URL is remote wherever it is written: a topic's xref needs the same scope as a map's
      // topicref.
      const namesTarget =
        ref.kind === 'topicref' || ref.kind === 'mapref' || ref.kind === 'keydef' ||
        ref.kind === 'xref' || ref.kind === 'link';
      if (namesTarget && /^https?:/i.test(ref.href)) {
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

/** An xref/link with no @href, @keyref, @conref or @conkeyref to follow. */
export function linkTargetIssues(crawl: CrawlResult): Array<Omit<Issue, 'message'>> {
  return crawl.linksWithoutTarget.map((l) => ({
    category: 'link-no-target' as const, severity: 'warning' as const, file: l.file, line: l.line,
    msg: msg('link.noTarget', l.tag),
  }));
}
