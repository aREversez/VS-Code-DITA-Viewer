// The @class attribute: where its value comes from and what it means.
//
// DITA elements get their class from the DTD's default unless the file writes
// one. The defaults live in a generated table (src/parser/ditaClassDefaults.ts,
// produced by scripts/extract-dita-class.cjs from the DITA 1.3 DTDs; the JSON
// next to that script keeps the provenance and the offline cross-check).
//
// Two things follow from that, and both are load-bearing for the checks:
//
//   - An explicit @class always wins: a hand-written specialization, or a file
//     that spells out the default itself, is taken at its word. The table only
//     fills in what the file leaves out.
//   - The DTD defaults only exist when the file declares a DITA DOCTYPE. A file
//     without one has no class values at all, which is exactly what Oxygen
//     reports (dmv.invalid.class.format: "Class attribute not specified").
//
// Topic and map vocabularies are looked up separately: shortdesc, linktext and
// searchtitle are declared on both sides with different chains. An element that
// is in neither table has no known class and the checks skip it rather than
// guess one (learning/, machineryIndustry/ and the foreign-namespace modules are
// not scanned; see the header of the generated table).

import { MAP_CLASS_DEFAULTS, TOPIC_CLASS_DEFAULTS } from '../parser/ditaClassDefaults';

export type ClassSide = 'topic' | 'map';

const TABLES: Readonly<Record<ClassSide, Readonly<Record<string, string>>>> = {
  topic: TOPIC_CLASS_DEFAULTS,
  map: MAP_CLASS_DEFAULTS,
};

/** The DTD default class value of an element, or undefined when the scan does not know it. */
export function defaultClassOf(tag: string, side: ClassSide): string | undefined {
  return TABLES[side][tag];
}

/** `module/tag` pairs of a class value, most general ancestor first. */
export function classChain(classValue: string | undefined): string[] {
  if (classValue === undefined) return [];
  return classValue
    .trim()
    .split(/\s+/)
    .filter((t) => t !== '' && t !== '-' && t !== '+' && t.includes('/'));
}

/** The tag part of a class pair: `task/step` -> `step`. */
export function classPairTag(pair: string): string {
  const i = pair.indexOf('/');
  return i < 0 ? pair : pair.slice(i + 1);
}

/**
 * The element's own name as its class chain spells it (the last pair, the most
 * specific one): `- topic/li task/step ` -> `step`. Undefined when the chain is
 * empty or unreadable, so a caller can ask "is this element a section?" without
 * depending on the written tag.
 */
export function classElementTag(classValue: string | undefined): string | undefined {
  const chain = classChain(classValue);
  return chain.length > 0 ? classPairTag(chain[chain.length - 1]) : undefined;
}

/** Whether the chain ends with (or contains) the pair for `tag` of `module`. */
export function chainHas(classValue: string | undefined, pair: string): boolean {
  return classChain(classValue).includes(pair);
}

/**
 * The class value an element effectively carries: what the file writes, else the
 * DTD default for its side. Undefined when neither is available.
 */
export function effectiveClassOf(
  tag: string,
  explicit: string | undefined,
  side: ClassSide,
): string | undefined {
  return explicit !== undefined ? explicit : defaultClassOf(tag, side);
}

/**
 * The side a file's vocabulary belongs to, from its root element. A root that is
 * only declared on one side settles it; every other case is a topic (a map root
 * always resolves to `map/*`, and a file whose root the table does not know is
 * not a map vocabulary).
 */
export function sideOfRoot(tag: string, rootClass: string | undefined): ClassSide {
  const chain = classChain(rootClass);
  if (chain.length > 0) {
    const pairs = ` ${chain.join(' ')} `;
    if (pairs.includes(' map/map ')) return 'map';
    if (pairs.includes(' topic/topic ')) return 'topic';
  }
  const inTopic = tag in TOPIC_CLASS_DEFAULTS;
  const inMap = tag in MAP_CLASS_DEFAULTS;
  return inMap && !inTopic ? 'map' : 'topic';
}

/** What can be wrong with a written @class value (the forms Oxygen names). */
export type ClassSyntaxProblem = 'empty' | 'no-marker' | 'no-trailing-space';

/**
 * The observed @class value rules: a value is required, starts with `-` or `+`,
 * and ends with a space ("- topic/p "). Oxygen reports each of these separately
 * (dmv.invalid.class.format) and the corpus probes pin all three; other
 * malformations (a token that is not `module/tag`) are not checked.
 */
export function classSyntaxProblem(value: string): ClassSyntaxProblem | undefined {
  if (value.trim() === '') return 'empty';
  if (!/^[-+]/.test(value)) return 'no-marker';
  if (!value.endsWith(' ')) return 'no-trailing-space';
  return undefined;
}

/** The external identifier of a file's DOCTYPE declaration. */
export interface Doctype {
  publicId?: string;
  systemId?: string;
}

/**
 * The DOCTYPE declaration of a file, if it has one. The internal subset is
 * skipped, quotes are honoured, and only the external identifier is kept: that
 * is all a class default depends on.
 */
export function readDoctype(raw: string): Doctype | undefined {
  const start = raw.search(/<!DOCTYPE\s/i);
  if (start < 0) return undefined;
  let i = raw.indexOf('>', start);
  if (i < 0) return undefined;
  let quote = '';
  let depth = 0;
  for (let j = raw.indexOf('<!DOCTYPE', start) + '<!DOCTYPE'.length; j < raw.length; j++) {
    const ch = raw[j];
    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[') depth++;
    else if (ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === '>' && depth === 0) {
      i = j;
      break;
    }
  }
  const decl = raw.slice(start, i + 1);
  const pub = /\bPUBLIC\s+(?:"([^"]*)"|'([^']*)')\s+(?:"([^"]*)"|'([^']*)')/i.exec(decl);
  if (pub) return { publicId: pub[1] ?? pub[2] ?? '', systemId: pub[3] ?? pub[4] ?? '' };
  const sys = /\bSYSTEM\s+(?:"([^"]*)"|'([^']*)')/i.exec(decl);
  if (sys) return { systemId: sys[1] ?? sys[2] ?? '' };
  return {};
}

/** The OASIS DITA vocabularies whose root DTDs a DOCTYPE can name. */
/**
 * Whether the file points at a grammar of its own that could supply class defaults other than a
 * DOCTYPE: a RELAX NG or Schematron association (`<?xml-model ...?>`) or an XML Schema location on
 * the root element. DITA's RNG and XSD vocabularies define `@class` defaults the way the DTDs do,
 * so a file that declares one is not "a file nothing gives a class to".
 */
export function declaresGrammar(raw: string, rootAttrs: Readonly<Record<string, string>>): boolean {
  if (/<\?xml-model\b/.test(raw)) return true;
  return Object.keys(rootAttrs).some((name) => /(^|:)(?:noNamespaceSchemaLocation|schemaLocation)$/.test(name));
}

const DITA_ROOT_DTDS = new Set([
  'topic.dtd', 'concept.dtd', 'task.dtd', 'reference.dtd', 'ditabase.dtd',
  'glossary.dtd', 'troubleshooting.dtd', 'map.dtd', 'bookmap.dtd',
]);

/**
 * Whether the DOCTYPE names a DITA vocabulary, i.e. whether the DTD supplies the
 * element's @class. Every OASIS DITA DTD has a public identifier starting with
 * `-//OASIS//DTD DITA`, which also covers the vocabularies whose modules this
 * generator does not scan; the root-DTD list is the fallback for a DOCTYPE that
 * carries only a system identifier.
 */
export function isDitaDoctype(d: Doctype | undefined): boolean {
  if (!d) return false;
  if (d.publicId && /^-\/\/OASIS\/\/DTD DITA\b/i.test(d.publicId)) return true;
  const base = (d.systemId ?? '').split(/[\\/]/).pop() ?? '';
  return DITA_ROOT_DTDS.has(base.toLowerCase());
}
