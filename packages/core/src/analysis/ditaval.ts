// The completeness check's view of a DITAVAL file: "would this element be
// filtered out of the output?", and where each <prop> is written.
//
// The filter is the render-time reader of ../profiling (one implementation of
// include/exclude/default, the spec's attribute list and props groups) plus one
// rule: an attribute that a <prop> names and an element writes directly counts as
// a profiling value. `att` may name a specialization of props, which is an
// attribute of its own name (DITA 1.3, langRef/ditaval/ditaval-prop), and the
// render reader only knows the ten names in PROFILE_ATTRS. A rule is taken at its
// word: it filters whatever attribute it names. DESIGN.md 4.10 has the history.

import sax from 'sax';
import { PROFILE_ATTRS, isExcluded, parseDitaval, profileValuesOf } from '../profiling';

export interface DitavalFilter {
  /** True when an element carrying these attributes is filtered out. */
  excludes(attrs: Record<string, string>): boolean;
}

interface Rule {
  att: string;
  val?: string;
  action: string;
}

/** A `<prop>` of a filter file, with the line it is written on (1-based). */
export interface DitavalRule extends Rule {
  line: number;
}

const NO_FILTER: DitavalFilter = { excludes: () => false };

/** Every `<prop att= val= action=>` of a filter file, in document order. */
export function parseDitavalRules(xml: string): DitavalRule[] {
  const rules: DitavalRule[] = [];
  const parser = sax.parser(true, { trim: true });
  parser.onopentag = (node) => {
    if (node.name !== 'prop') return;
    const a = node.attributes as Record<string, string>;
    if (!a.att || !a.action) return;
    rules.push({ att: a.att, val: a.val, action: a.action, line: parser.line + 1 });
  };
  parser.onerror = () => {
    parser.error = null as unknown as Error;
  };
  try {
    parser.write(xml).close();
  } catch {
    // Keep whatever rules were read before the error.
  }
  return rules;
}

export function parseDitavalFilter(xml: string): DitavalFilter {
  const ditaval = parseDitaval(xml);
  if (!ditaval.rules.some((r) => r.action === 'exclude')) return NO_FILTER;
  const known = new Set<string>(PROFILE_ATTRS);
  const named = [...new Set(ditaval.rules.map((r) => r.att))].filter((att) => !known.has(att));
  const filter = { ditaval };
  return {
    excludes(attrs) {
      const values = profileValuesOf(attrs);
      for (const att of named) {
        const direct = attrs[att]?.split(/\s+/).filter(Boolean);
        if (direct && direct.length > 0) (values[att] ??= []).push(...direct);
      }
      return isExcluded(values, filter);
    },
  };
}
