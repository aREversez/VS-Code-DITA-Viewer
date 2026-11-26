// Path arithmetic for the rest of core: the same names as Node's `path`, each
// one delegating to the active runtime's PathOps (DESIGN.md 3.4). Converting a
// file off Node is then a one-line change of its import.

import { rt } from '../runtime';

export const resolve = (...segments: string[]): string => rt().platform.path.resolve(...segments);
export const join = (...segments: string[]): string => rt().platform.path.join(...segments);
export const dirname = (path: string): string => rt().platform.path.dirname(path);
export const relative = (from: string, to: string): string => rt().platform.path.relative(from, to);
export const isAbsolute = (path: string): boolean => rt().platform.path.isAbsolute(path);
export const normalize = (path: string): string => rt().platform.path.normalize(path);
export const extname = (path: string): string => rt().platform.path.extname(path);
/** A function, not a constant: the separator belongs to whichever platform is active at the call. */
export const getSep = (): string => rt().platform.path.sep;
/** False when path keys must be lower-cased to name the same file (Windows). */
export const isCaseSensitive = (): boolean => rt().platform.path.caseSensitive;
