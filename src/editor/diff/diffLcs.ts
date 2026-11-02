// Longest-common-subsequence alignment of two block lists, and the order-preserving pairs it yields.
// Split out of ditaDiffEngine.ts; a pure function module, no vscode dependency.


// ── LCS alignment ──

export interface LcsOp<T> {
  op: 'same' | 'removed' | 'added';
  left?: T;
  right?: T;
}

const LCS_CELL_LIMIT = 4_000_000;

export function lcsAlign<T>(
  a: T[],
  b: T[],
  equals: (x: T, y: T) => boolean,
  keyOf: (item: T) => string,
): LcsOp<T>[] {
  // Trim the common prefix and suffix first: most real diffs touch a small
  // part of a long, mostly identical sequence, and this keeps the DP table
  // (and the idOnlyAlign fallback below) off the unchanged bulk.
  let lo = 0;
  while (lo < a.length && lo < b.length && equals(a[lo], b[lo])) lo++;
  let ea = a.length;
  let eb = b.length;
  while (ea > lo && eb > lo && equals(a[ea - 1], b[eb - 1])) {
    ea--;
    eb--;
  }
  const ops: LcsOp<T>[] = [];
  for (let k = 0; k < lo; k++) ops.push({ op: 'same', left: a[k], right: b[k] });
  for (const op of lcsCore(a.slice(lo, ea), b.slice(lo, eb), equals, keyOf)) ops.push(op);
  for (let k = 0; k < a.length - ea; k++) {
    ops.push({ op: 'same', left: a[ea + k], right: b[eb + k] });
  }
  return ops;
}

function lcsCore<T>(
  a: T[],
  b: T[],
  equals: (x: T, y: T) => boolean,
  keyOf: (item: T) => string,
): LcsOp<T>[] {
  const m = a.length;
  const n = b.length;

  if (m * n > LCS_CELL_LIMIT) {
    return idOnlyAlign(a, b, equals, keyOf);
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (equals(a[i - 1], b[j - 1])) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const ops: LcsOp<T>[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && equals(a[i - 1], b[j - 1])) {
      ops.push({ op: 'same', left: a[i - 1], right: b[j - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ op: 'added', right: b[j - 1] });
      j--;
    } else {
      ops.push({ op: 'removed', left: a[i - 1] });
      i--;
    }
  }
  ops.reverse();
  return ops;
}

/** Longest strictly increasing subsequence of `pairs` by second element
 *  (`pairs` is already sorted by first element). Returns the kept pairs. */
export function increasingPairs(pairs: Array<[number, number]>): Array<[number, number]> {
  const tails: number[] = []; // index into pairs of the best tail per length
  const prev = new Array<number>(pairs.length).fill(-1);
  for (let k = 0; k < pairs.length; k++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]][1] < pairs[k][1]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[k] = tails[lo - 1];
    tails[lo] = k;
  }
  const out: Array<[number, number]> = [];
  let k = tails.length > 0 ? tails[tails.length - 1] : -1;
  while (k >= 0) {
    out.push(pairs[k]);
    k = prev[k];
  }
  return out.reverse();
}

/**
 * Fallback for when the full O(mn) DP table would exceed LCS_CELL_LIMIT:
 * matches items by an identity key instead of a full alignment.
 *
 * The matches are reduced to the longest order-preserving subset, and the
 * stretch between two consecutive matches is emitted as its removed items then
 * its added items. The old version emitted every unmatched removed item first
 * and every unmatched added item last, which threw away all position
 * information -- the pairing pass then matched unrelated blocks by index.
 *
 * Takes an explicit keyOf function rather than requiring T to structurally
 * have a .key field: lcsAlign is called with RenderedBlock[] AND with plain
 * string[] token arrays from diffTokens.
 */
function idOnlyAlign<T>(
  a: T[],
  b: T[],
  equals: (x: T, y: T) => boolean,
  keyOf: (item: T) => string,
): LcsOp<T>[] {
  const bByKey = new Map<string, number[]>();
  b.forEach((item, j) => {
    const k = keyOf(item);
    const list = bByKey.get(k);
    if (list) list.push(j);
    else bByKey.set(k, [j]);
  });
  const nextFree = new Map<string, number>();
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < a.length; i++) {
    const k = keyOf(a[i]);
    const list = bByKey.get(k);
    if (!list) continue;
    let at = nextFree.get(k) || 0;
    while (at < list.length && !equals(a[i], b[list[at]])) at++;
    if (at < list.length) {
      pairs.push([i, list[at]]);
      nextFree.set(k, at + 1);
    }
  }

  const ops: LcsOp<T>[] = [];
  let ai = 0;
  let bj = 0;
  const flush = (ae: number, be: number): void => {
    for (; ai < ae; ai++) ops.push({ op: 'removed', left: a[ai] });
    for (; bj < be; bj++) ops.push({ op: 'added', right: b[bj] });
  };
  for (const [i, j] of increasingPairs(pairs)) {
    flush(i, j);
    ops.push({ op: 'same', left: a[i], right: b[j] });
    ai = i + 1;
    bj = j + 1;
  }
  flush(a.length, b.length);
  return ops;
}
