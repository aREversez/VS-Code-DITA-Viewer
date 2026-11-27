// A pure TypeScript POSIX path, for hosts with no `path` module (a browser, or
// anything over an in-memory file system). `/` only: no drive letters and no
// backslashes. Each function follows the algorithm of Node's `path.posix`, and
// test/platform/posixPath.test.ts holds it to `path.posix` on a table of cases.

import type { PathOps } from './platform';

/** Drops empty and `.` segments and folds `..`. Keeps leading `..` only when allowAboveRoot is set. */
function normalizeParts(path: string, allowAboveRoot: boolean): string {
  const out: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (allowAboveRoot) out.push('..');
    } else {
      out.push(seg);
    }
  }
  return out.join('/');
}

function normalize(path: string): string {
  if (path.length === 0) return '.';
  const isAbs = path.charCodeAt(0) === 47;
  const trailing = path.charCodeAt(path.length - 1) === 47;
  let p = normalizeParts(path, !isAbs);
  if (p.length === 0 && !isAbs) p = '.';
  if (p.length > 0 && trailing) p += '/';
  return isAbs ? `/${p}` : p;
}

function join(...segments: string[]): string {
  const parts = segments.filter((s) => s.length > 0);
  if (parts.length === 0) return '.';
  return normalize(parts.join('/'));
}

/** With no absolute segment the result is anchored at `/`; there is no working directory to ask. */
function resolve(...segments: string[]): string {
  let resolved = '';
  let absolute = false;
  for (let i = segments.length - 1; i >= -1 && !absolute; i--) {
    const seg = i >= 0 ? segments[i] : '/';
    if (seg.length === 0) continue;
    resolved = `${seg}/${resolved}`;
    absolute = seg.charCodeAt(0) === 47;
  }
  return `/${normalizeParts(resolved, false)}`;
}

function isAbsolute(path: string): boolean {
  return path.length > 0 && path.charCodeAt(0) === 47;
}

function dirname(path: string): string {
  if (path.length === 0) return '.';
  const hasRoot = path.charCodeAt(0) === 47;
  let end = -1;
  let matchedSlash = true;
  for (let i = path.length - 1; i >= 1; --i) {
    if (path.charCodeAt(i) === 47) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }
  if (end === -1) return hasRoot ? '/' : '.';
  if (hasRoot && end === 1) return '//';
  return path.slice(0, end);
}

function extname(path: string): string {
  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  // 0: no dot seen yet; 1: the last dot is the first character of the name; -1: anything else.
  let preDotState = 0;
  for (let i = path.length - 1; i >= 0; --i) {
    const code = path.charCodeAt(i);
    if (code === 47) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
    if (code === 46) {
      if (startDot === -1) startDot = i;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) {
      preDotState = -1;
    }
  }
  if (startDot === -1 || end === -1 || preDotState === 0 || (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)) {
    return '';
  }
  return path.slice(startDot, end);
}

function relative(from: string, to: string): string {
  const a = resolve(from);
  const b = resolve(to);
  if (a === b) return '';
  const fromParts = a.split('/').filter(Boolean);
  const toParts = b.split('/').filter(Boolean);
  let common = 0;
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) common++;
  const out: string[] = [];
  for (let i = common; i < fromParts.length; i++) out.push('..');
  for (let i = common; i < toParts.length; i++) out.push(toParts[i]);
  return out.join('/');
}

export const posixPath: PathOps = {
  sep: '/',
  caseSensitive: true,
  resolve,
  join,
  dirname,
  relative,
  isAbsolute,
  normalize,
  extname,
};
