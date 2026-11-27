/**
 * A string for comparing two results that may hold Sets and Maps, which
 * JSON.stringify would turn into `{}` and so make any two of them look equal.
 * Sets list their members in sorted order and Maps their entries in insertion order.
 */
export function stable(value: unknown): string {
  return JSON.stringify(value, (_k, x) => (x instanceof Set ? { set: [...x].sort() } : x instanceof Map ? { map: [...x.entries()] } : x));
}
