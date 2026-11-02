// The crawl's data model: the host it reads files through, and everything a crawl records (references, keys, ids, conrefs, profiling, table and class findings).
// Split out of mapCrawl.ts, which re-exports every name here. No vscode dependency.

import { DitavalFilter } from './ditaval';
import { Msg } from './mapCheckMessages';
import { ClassSide, ClassSyntaxProblem } from './ditaClass';

export interface CrawlHost {
  /** Text of a file (unsaved editor text if any). Rejects when unreadable. */
  readFile(absPath: string): Promise<string>;
  exists(absPath: string): Promise<boolean>;
  platform: NodeJS.Platform;
  /** Whether an existing path is a folder (folder-reference check). */
  isDirectory?(absPath: string): Promise<boolean>;
  /** Entry names of a folder, or undefined when it cannot be listed (capitalization check). */
  readDir?(absPath: string): Promise<string[] | undefined>;
  /** Polled between files; returning true stops the crawl early. */
  cancelled?(): boolean;
}

export type RefKind =
  | 'topicref'
  | 'mapref'
  | 'keydef'
  | 'image'
  | 'xref'
  | 'link'
  | 'conref'
  | 'object'
  | 'data'
  | 'other';

export interface Location {
  file: string; // absolute path
  line: number; // 1-based
}

export interface Reference extends Location {
  kind: RefKind;
  /** The href/conref/data value as written. */
  href: string;
  /** Absolute target path (fragment stripped); undefined for URLs. */
  target?: string;
  /** External/peer scope or an absolute URL. */
  remote: boolean;
  /** Whether the target is a DITA file (topic or map) rather than a binary/other resource. */
  dita: boolean;
  /** True for a topicref that is resource-only (or inside a resource-only branch). */
  resourceOnly: boolean;
  copyTo?: string;
  /** Where the reference sits: inside a relationship table. */
  inReltable: boolean;
  /** The element that carries the reference. */
  tag: string;
  /** The @scope attribute as written, if any. */
  scope?: string;
  /** The @format attribute as written, if any. */
  format?: string;
  /** The @type attribute as written, if any (the @type-vs-class check). */
  type?: string;
  /** True when the reference was written in a map (topicref, mapref, keydef). */
  inMap: boolean;
  /**
   * Key scopes the reference sits in (map references only), outermost name first; more
   * than one when a `keyscope` lists several names. Undefined outside a map reference.
   */
  scopeChains?: string[][];
  /** True for a reference made by resolving a @keyref: its @format is not the element's own. */
  viaKeyref?: boolean;
}

export interface KeyDef extends Location {
  key: string; // bare key name
  /** Fully-qualified names this definition answers to (scope prefixes). */
  qualified: string[];
  /** The key scope chain this definition lives in ('' = root scope); the first of `scopeIds`. */
  scopeId: string;
  /**
   * Every scope chain this definition lives in. More than one when a `keyscope`
   * lists several names ("a b") on it or an ancestor: the key then belongs to all of them.
   */
  scopeIds: string[];
  href?: string;
  target?: string;
  /**
   * A key definition that redirects to another key (`<keydef keyref=...>`). The
   * crawl does not follow redirect chains, so such a definition has no target.
   */
  keyref?: string;
  /** The @format attribute on the defining element, if any. */
  format?: string;
}

export interface KeyUse extends Location {
  /** Bare key name (the part before any `/`). */
  key: string;
  /** The attribute value as written (a keyref may carry a `/elementid`). */
  value?: string;
  /** Which attribute used the key. Only `keyref` is resolved to a target. */
  attribute?: 'keyref' | 'conkeyref';
  /** The element that used the key. */
  tag?: string;
  /** For a keyref on a resource reference: the kind the element implies. */
  kind?: RefKind;
  /** Key scopes in effect where the key was used (map keyrefs only). */
  scopeChains?: string[][];
  /** Why the key name cannot be parsed, when it cannot (Oxygen's invalid.keyref.syntax.1/.3). */
  keySyntax?: 'slash' | 'whitespace';
  resourceOnly?: boolean;
  inReltable?: boolean;
  copyTo?: string;
  /**
   * The reference made from the element's own @href. DITA uses it as a fallback
   * only when the key is undefined, so it is dropped once the key resolves.
   */
  fallbackRef?: Reference;
}

/** A keyref that matches no key definition (Oxygen's `dmv.undef.key`). */
export interface UndefinedKey extends Location {
  key: string;
  value: string;
}

export interface TopicId extends Location {
  id: string;
  topicFile: string;
}

/** An @id attribute, on any element of a crawled map or topic (id-syntax check). */
export interface IdUse extends Location {
  id: string;
  tag: string;
  /**
   * The XML attribute type the DITA grammar declares for this element's @id: `ID` on a topic
   * or map element, a name token on everything else (archSpec/base/id, and the table it
   * carries). Oxygen validates by that type rather than by one grammar for every @id --
   * corpus 6's u-id asked it.
   */
  idType: 'ID' | 'NMTOKEN';
  /** The nearest enclosing topic element's id (topic files only). */
  topicId?: string;
}

/** A map reference whose target is already being crawled: a cycle (Oxygen's dmv.recursive.ref). */
export interface RecursiveRef extends Location {
  /** The map reference as written. */
  href: string;
}

/** A topicref/keydef that sits inside a reference to a map, where DITA ignores it. */
export interface IgnoredMaprefContent extends Location {
  tag: string;
}

/** A map element that carries, or needs, a navigation title. */
export interface MapEntry extends Location {
  tag: string;
  href?: string;
  keyref?: string;
  scope?: string;
  navTitle: boolean;
}

export interface ReusableCandidate extends Location {
  id: string;
  tag: string;
  topicFile: string;
  /** The nearest enclosing topic element's id. */
  topicId?: string;
  /** Stable path of the parent element, compared by conref sibling checks. */
  parentKey?: string;
  /** Position among the parent's children, compared by conref order checks. */
  order?: number;
  /** The element's effective @class, compared with the conref target's by the class check. */
  classValue?: string;
  /**
   * True when a strict ancestor carries `@conref`: resolving it replaces this
   * element, so a reference that addresses it points at content that is gone.
   */
  replacedByConref?: boolean;
}

export interface ConrefUse {
  /** Absolute path of the conref target file (own file for `#…`), if resolvable. */
  targetFile?: string;
  /** Last fragment segment: the element id for `#topic/elem`, the topic id for a bare `#topic`. */
  targetId?: string;
  /** The topic-id segment (the part right after `#`), if the value carried a fragment. */
  topicId?: string;
  /** The element-id segment after the topic id (`#topic/elem`), if any. */
  elemId?: string;
  /** Where the conref is written, so an unresolvable topic id can be reported on it. */
  sourceFile?: string;
  sourceLine?: number;
  /** Key name for a conkeyref. */
  key?: string;
}

/** The conref/conrefend/conkeyref attributes of one element, with their resolved ends. */
export interface ConrefShape extends Location {
  tag: string;
  /** The attribute as written; undefined when it is absent (an empty value stays ""). */
  conref?: string;
  conrefend?: string;
  conkeyref?: string;
  /** Absolute local file @conref names (own file for `#elem`), if it names one. */
  targetFile?: string;
  endTargetFile?: string;
  /** Fragment parts of @conref / @conrefend. */
  targetTopicId?: string;
  targetElementId?: string;
  endTopicId?: string;
  endElementId?: string;
  /** The element's effective @class, compared with its target's by the conref class check. */
  classValue?: string;
}

/** An element that carries `-dita-use-conref-target` without being a content reference. */
export interface ConrefTargetValue extends Location {
  tag: string;
  attribute: string;
  value: string;
}

/** An xref/link with no @href, @keyref, @conref or @conkeyref (Oxygen's dmv.link.no.target). */
export interface LinkWithoutTarget extends Location {
  tag: string;
}

/** An xref/link whose keyref names a key that is defined without a target. */
export interface KeyLinkWithoutTarget extends Location {
  key: string;
  value: string;
  tag?: string;
}

/**
 * A `@conkeyref` whose key resolves to a file: the content reference that reaches it.
 * A content reference replaces content instead of linking, so it never becomes a
 * `Reference`; the file behind its key still has to exist, and Oxygen files that at
 * both ends (the keydef and the element that reaches it through the key).
 */
export interface ConkeyrefTarget extends Location {
  /** The key definition's @href as written. */
  href: string;
  /** Absolute local file that @href resolves to. */
  target: string;
  /** Whether the target is a DITA file; a resource key is not a content reference. */
  dita: boolean;
}

/** The element-id part a keyref/conkeyref appends to its key, with the key's own target. */
export interface KeyElementPath extends Location {
  /** The attribute value as written. */
  value: string;
  /** The path after the key: `elem` or `elem/child`. */
  elementPath: string;
  /** Absolute file the key definition's @href resolves to, if it has one. */
  targetFile?: string;
  /** Topic id from the key definition's @href fragment, if any. */
  topicId?: string;
}

export interface TableInfo extends Location {
  kind: 'cals' | 'simple';
  /** Human-readable problems found in this table's layout. */
  problems: Array<{ line: number; msg: Msg }>;
}

export interface ProfilingConflict extends Location {
  attribute: string;
  values: string[];
  ancestorValues: string[];
  tag: string;
}

export interface ProfilingValueUse extends Location {
  attribute: string;
  values: string[];
  tag: string;
}

/** A profiling attribute present with no value at all (Oxygen's dmv.prof.attr.empty.value). */
export interface EmptyProfilingValue extends Location {
  attribute: string;
  tag: string;
}

/**
 * An element the active DITAVAL filter drops (Oxygen's dmv.ref.filtered): its id is
 * gone from the output, while the topic that holds it stays.
 */
export interface ExcludedElement extends Location {
  id: string;
  tag: string;
  /** The nearest enclosing topic element's id, as `#topic/elem` addresses it. */
  topicId?: string;
}

export interface FileIssue extends Location {
  severity: 'error' | 'warning';
  msg: Msg;
  /** True for DITA-structure findings (root element, id, title); false for XML errors. */
  structural: boolean;
}

/** A written @class value the DITA class syntax rejects, or an element no DTD gives a class. */
export interface ClassIssue extends Location {
  tag: string;
  problem: 'not-specified' | ClassSyntaxProblem;
}

/** A root element whose @domains is written empty (Oxygen's dmv.invalid.domains.format). */
export interface DomainsIssue extends Location {
  tag: string;
}

/** A section whose title does not come first, or is not its only one (Oxygen's dmv.section.*). */
export interface SectionIssue extends Location {
  tag: string;
  kind: 'first-title' | 'duplicate-title';
}

/** The root element of a file that parsed, with the class it actually carries. */
export interface FileRoot extends Location {
  tag: string;
  /** Effective @class (written, else the DTD default); undefined when neither gives one. */
  classValue?: string;
  /** The vocabulary table the file was read against. */
  side: ClassSide;
  /** True when the root element is a DITA topic or map. */
  dita: boolean;
}

export interface CrawlOptions {
  /** DITAVAL filters to apply; content excluded by them is not crawled. */
  filter?: DitavalFilter;
  /** Attribute names treated as profiling attributes (in addition to the DITA built-ins). */
  extraProfilingAttributes?: string[];
}

export interface CrawlResult {
  rootMaps: string[];
  maps: Set<string>; // every map file reached (incl. root maps)
  topics: Set<string>; // every DITA topic file reached
  refs: Reference[];
  keyDefs: KeyDef[];
  /**
   * Names a @keyref / @conkeyref actually resolved through. R011 asks whether a definition's
   * name was used and resolved, not merely written: a bare keyref that fails in its scope
   * leaves its name here absent (Oxygen's `dmv.not.used.key.defs` on corpus 6's q-unused-pos).
   */
  usedKeyNames: Set<string>;
  keyUses: KeyUse[];
  undefinedKeys: UndefinedKey[];
  topicIds: TopicId[];
  /** Every @id attribute seen, in maps and topics. */
  ids: IdUse[];
  recursiveRefs: RecursiveRef[];
  ignoredMaprefContent: IgnoredMaprefContent[];
  mapEntries: MapEntry[];
  reusable: ReusableCandidate[];
  conrefUses: ConrefUse[];
  conrefShapes: ConrefShape[];
  conrefTargetValues: ConrefTargetValue[];
  linksWithoutTarget: LinkWithoutTarget[];
  keyLinksWithoutTarget: KeyLinkWithoutTarget[];
  conkeyrefTargets: ConkeyrefTarget[];
  keyElementPaths: KeyElementPath[];
  tables: TableInfo[];
  profilingConflicts: ProfilingConflict[];
  profilingValues: ProfilingValueUse[];
  /** Profiling attributes whose value is empty or whitespace only. */
  emptyProfilingValues: EmptyProfilingValue[];
  /** Elements dropped from the crawled tree by the DITAVAL filter. */
  excludedElements: ExcludedElement[];
  fileIssues: FileIssue[];
  /** Written @class values the class syntax rejects, and elements no DTD gives a class. */
  classIssues: ClassIssue[];
  /** Root elements whose @domains is written empty. */
  domainsIssues: DomainsIssue[];
  /** Sections whose title is not first or not alone. */
  sectionIssues: SectionIssue[];
  /** Root element of every file that parsed, for the checks that compare against a target. */
  fileRoots: FileRoot[];
  /** Normalized path -> original path, for every file the crawl opened. */
  visited: Map<string, string>;
  cancelled: boolean;
}

// ── XML scan ────────────────────────────────────────────────────────────
