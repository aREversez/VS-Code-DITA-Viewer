import { readFileSync } from 'fs';
import { join } from 'path';

/** Shared by the static stylesheet tripwires: read a repo file, drop comments, find rules by exact selector. */
export const repoRoot = join(__dirname, '..', '..', '..');
export const readRepo = (rel: string): string => readFileSync(join(repoRoot, rel), 'utf8');
export const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The declaration block of every (non-nested) rule whose selector list contains `selector` exactly. */
export function blocksFor(css: string, selector: string): string[] {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const selectors = m[1].split(',').map((s) => s.replace(/\s+/g, ' ').trim());
    if (selectors.includes(selector)) out.push(m[2]);
  }
  return out;
}
