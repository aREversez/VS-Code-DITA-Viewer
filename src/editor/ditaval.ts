// Minimal DITAVAL reader: just enough of the format to answer "would this
// element be filtered out of the output?" for the completeness check.
//
// Handles <prop att= val= action="include|exclude|flag|passthrough"/>,
// including the attribute-level default (a <prop> with no @val) and the
// `props="audience(admin) platform(linux)"` generalization syntax. Flagging
// and revision props never remove content, so they are ignored.

import sax from 'sax';

export interface DitavalFilter {
  /** True when an element carrying these attributes is filtered out. */
  excludes(attrs: Record<string, string>): boolean;
}

interface Rule {
  att: string;
  val?: string;
  action: string;
}

const NO_FILTER: DitavalFilter = { excludes: () => false };

export function parseDitaval(xml: string): DitavalFilter {
  const rules: Rule[] = [];
  const parser = sax.parser(true, { trim: true });
  parser.onopentag = (node) => {
    if (node.name !== 'prop') return;
    const a = node.attributes as Record<string, string>;
    if (!a.att || !a.action) return;
    rules.push({ att: a.att, val: a.val, action: a.action });
  };
  parser.onerror = () => {
    parser.error = null as unknown as Error;
  };
  try {
    parser.write(xml).close();
  } catch {
    // Keep whatever rules were read before the error.
  }
  if (rules.every((r) => r.action !== 'exclude')) return NO_FILTER;

  const actionFor = (att: string, value: string): string => {
    const explicit = rules.find((r) => r.att === att && r.val === value);
    if (explicit) return explicit.action;
    const dflt = rules.find((r) => r.att === att && r.val === undefined);
    return dflt ? dflt.action : 'include';
  };
  const attNames = [...new Set(rules.map((r) => r.att))];

  return {
    excludes(attrs) {
      for (const att of attNames) {
        const values = valuesFor(attrs, att);
        if (values.length > 0 && values.every((v) => actionFor(att, v) === 'exclude')) return true;
      }
      return false;
    },
  };
}

/** Values of a (possibly generalized) profiling attribute on an element. */
function valuesFor(attrs: Record<string, string>, att: string): string[] {
  const out: string[] = [];
  const direct = attrs[att];
  if (direct) out.push(...direct.trim().split(/\s+/).filter(Boolean));
  const props = attrs['props'];
  if (props) {
    const re = new RegExp(`(?:^|\\s)${att.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\(([^)]*)\\)`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(props)) !== null) out.push(...m[1].trim().split(/\s+/).filter(Boolean));
  }
  return out;
}
