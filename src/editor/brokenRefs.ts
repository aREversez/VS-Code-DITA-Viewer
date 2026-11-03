// The rule that decides whether a path-valued attribute points at a file that
// is not there, and the pure planning that turns such references into repair
// proposals. Two callers need the rule and must agree: the broken-reference
// diagnostics (which report a reference) and "Fix Broken References…" (which
// repairs one). It lives here, as a pure function over text + an `exists`
// callback, so both sides read the same rule instead of keeping a copy each.
//
// No vscode dependency — Node path + the core reference scanner only.

import * as pathWin32 from 'path/win32';
import * as pathPosix from 'path/posix';
import { collectRefEntries, decodeHrefPart, isExternalRef } from '@dita-viewer/core';
import { normalizePathForCompare } from './mapReferenceTools';

/**
 * Attributes whose value names a file that already exists. `copy-to` is
 * deliberately absent: it names a file *to be generated*, so every map with a
 * `copy-to` would otherwise be reported as broken.
 */
export const FILE_REF_ATTRS: ReadonlySet<string> = new Set([
  'href',
  'conref',
  'conrefend',
  'data',
  'longdescref',
]);

/** How many files one scan reads; the same cap the rename participant uses. */
export const MAX_SCANNED_FILES = 5000;

export interface SourceFile {
  /** Absolute path of the file that holds the reference. */
  path: string;
  text: string;
}

/** Where a reference value points, after decoding and resolving. */
export interface RefTarget {
  /** The path part exactly as written (before `#`, before decoding). */
  filePart: string;
  /** The fragment including its leading `#`, or ''. */
  fragment: string;
  /** Absolute path of the referenced file. */
  targetPath: string;
}

/**
 * The file a reference attribute value points at, or undefined when the value
 * is not a reference to a nearby file: empty, an external / peer / absolute
 * reference, or one built from an entity, which cannot be resolved from the
 * text alone. A bare `#fragment` points at the file that holds it, which is
 * what `filePart === ''` and `targetPath === fromFile` mean.
 */
export function refTargetOf(
  value: string,
  scope: string | undefined,
  fromFile: string,
  platform: NodeJS.Platform,
): RefTarget | undefined {
  if (!value) return undefined;
  if (isExternalRef(value, scope)) return undefined;
  if (value.includes('&')) return undefined;

  const hashIdx = value.indexOf('#');
  const filePart = hashIdx >= 0 ? value.slice(0, hashIdx) : value;
  const fragment = hashIdx >= 0 ? value.slice(hashIdx) : '';

  // Pick the path flavour by the target platform, not the host, so the result
  // is deterministic (and testable) on any machine.
  const pImpl = (platform === 'win32' ? pathWin32 : pathPosix) as typeof import('path');
  if (!filePart) return { filePart, fragment, targetPath: pImpl.normalize(fromFile) };

  const decodedPath = decodeHrefPart(filePart);
  if (!decodedPath) return undefined;

  const targetPath = pImpl.resolve(pImpl.dirname(fromFile), decodedPath);
  return { filePart, fragment, targetPath };
}

/** A reference whose target file does not exist. */
export interface BrokenRef extends RefTarget {
  /** The file that holds the reference. */
  file: string;
  /** Attribute that carries it (href / conref / conrefend / data / longdescref). */
  attr: string;
  /** The attribute value as written, fragment included. */
  value: string;
  /** Offsets of the value inside the holding file's text. */
  valueStart: number;
  valueEnd: number;
}

/**
 * Every reference in `file` that points at a file which is not there.
 * `exists` is the caller's file-system probe: diagnostics pass `existsSync`,
 * the scan passes a memoized one, and neither changes what counts as broken.
 */
export function findBrokenRefs(opts: {
  file: SourceFile;
  exists: (p: string) => boolean;
  platform: NodeJS.Platform;
}): BrokenRef[] {
  const { file, exists, platform } = opts;
  const broken: BrokenRef[] = [];
  for (const entry of collectRefEntries(file.text, FILE_REF_ATTRS)) {
    const target = refTargetOf(entry.value, entry.scope, file.path, platform);
    if (!target) continue;
    // A same-file reference names no file of its own, so it cannot be missing.
    if (!target.filePart) continue;
    if (exists(target.targetPath)) continue;
    broken.push({
      file: file.path,
      attr: entry.attr,
      value: entry.value,
      valueStart: entry.valueStart,
      valueEnd: entry.valueEnd,
      ...target,
    });
  }
  return broken;
}

// ── Repair planning ──────────────────────────────────────────────────────
//
// A problem is a *target*, not a reference: one file that went missing and the
// many references that point at it. Everything below is per target, so asking
// the user once covers every reference to it.

/** File name (lower-cased) → the workspace's files with that name. */
export interface FileIndex {
  byName: Map<string, string[]>;
}

/**
 * Indexes the workspace by file name, case-insensitively: `TOPIC.dita` and
 * `topic.dita` land under the same key, which is what makes a name that only
 * changed case findable at all. The caller decides which files to pass (the
 * command leaves out node_modules and .git).
 */
export function buildFileIndex(paths: string[], platform: NodeJS.Platform): FileIndex {
  const pImpl = (platform === 'win32' ? pathWin32 : pathPosix) as typeof import('path');
  const byName = new Map<string, string[]>();
  for (const p of paths) {
    const key = pImpl.basename(p).toLowerCase();
    const list = byName.get(key);
    if (list) list.push(p);
    else byName.set(key, [p]);
  }
  return { byName };
}

/** One missing file, with every reference that points at it. */
export interface BrokenTarget {
  /** Absolute path the references resolve to. */
  targetPath: string;
  /** Its last segment -- what the index is searched by. */
  fileName: string;
  refs: BrokenRef[];
  /** Distinct files holding one of the references, in first-seen order. */
  files: string[];
}

/** Groups references by the file they point at. */
export function groupBrokenRefs(refs: BrokenRef[], platform: NodeJS.Platform): BrokenTarget[] {
  const pImpl = (platform === 'win32' ? pathWin32 : pathPosix) as typeof import('path');
  const byTarget = new Map<string, BrokenTarget>();
  for (const ref of refs) {
    const key = normalizePathForCompare(ref.targetPath, platform);
    let target = byTarget.get(key);
    if (!target) {
      target = {
        targetPath: ref.targetPath,
        fileName: pImpl.basename(ref.targetPath),
        refs: [],
        files: [],
      };
      byTarget.set(key, target);
    }
    target.refs.push(ref);
    if (!target.files.includes(ref.file)) target.files.push(ref.file);
  }
  return [...byTarget.values()];
}

export type FixKind =
  /** Exactly one file of that name: applied without asking. */
  | 'unique'
  /** Exactly one, but its name differs in case only: listed, never preselected. */
  | 'case'
  /** Several files of that name: the user picks. */
  | 'multiple'
  /** Nothing of that name in the workspace: reported, never repaired. */
  | 'none';

export interface FixCandidate {
  path: string;
  /** Trailing directory segments shared with the path the references spell. */
  sharedTail: number;
  /** Sits in the same workspace folder as a file that holds a reference. */
  sameRoot: boolean;
  /** Directory segments between the candidate and the nearest referencing file. */
  distance: number;
  /** Ranked first inside a folder move this plan inferred. */
  suggested: boolean;
}

export interface FixProposal {
  target: BrokenTarget;
  kind: FixKind;
  /** Best first; empty for `none`. */
  candidates: FixCandidate[];
  /**
   * The one file to use without asking. Only `unique` sets it: a name that
   * differs in case is a different file on a case-sensitive file system, so
   * that decision stays with the user.
   */
  preselect?: string;
  /** Key of the folder move this proposal is part of, when the scan inferred one. */
  move?: string;
}

/** A folder the whole project seems to have moved, inferred from the targets it strands. */
export interface FolderMove {
  key: string;
  /** Directory the broken references spell. */
  oldDir: string;
  /** Directory the candidates sit in. */
  newDir: string;
  /** Targets this move covers (at least two; one is not evidence of a move). */
  targets: number;
  /** References it covers. */
  references: number;
}

export interface FixPlan {
  /** Sorted for display: fixable first, biggest groups first. */
  proposals: FixProposal[];
  moves: FolderMove[];
}

/** One decision: this missing target is really that existing file. */
export interface ChosenFix {
  targetPath: string;
  newPath: string;
}

/**
 * Classifies every missing target against the workspace's files, ranks the
 * candidates, and infers a folder move where several targets under one old
 * directory all landed in the same new one.
 *
 * The inference only changes what is *shown*: a move groups its members and
 * marks one candidate of a `multiple` target as suggested. It never decides
 * what gets preselected -- uniqueness alone does that.
 */
export function proposeFixes(opts: {
  broken: BrokenRef[];
  index: FileIndex;
  platform: NodeJS.Platform;
  /** Workspace folders, for the "same folder" tie-break. */
  roots?: string[];
}): FixPlan {
  const { broken, index, platform, roots } = opts;
  const pImpl = (platform === 'win32' ? pathWin32 : pathPosix) as typeof import('path');

  const proposals: FixProposal[] = [];
  for (const target of groupBrokenRefs(broken, platform)) {
    const found = index.byName.get(target.fileName.toLowerCase()) ?? [];
    if (found.length === 0) {
      proposals.push({ target, kind: 'none', candidates: [] });
      continue;
    }
    const spelledExactly = found.filter((p) => pImpl.basename(p) === target.fileName).length;
    const kind: FixKind = found.length > 1 ? 'multiple' : spelledExactly === 1 ? 'unique' : 'case';
    const candidates = found
      .map((p) => rankCandidate(p, target, platform, roots))
      .sort(compareCandidates);
    proposals.push({
      target,
      kind,
      candidates,
      preselect: kind === 'unique' ? candidates[0].path : undefined,
    });
  }

  const moves = inferMoves(proposals, platform);
  markSuggestions(proposals, moves, platform);
  proposals.sort(compareProposals);
  return { proposals, moves };
}

/**
 * The renames a `WorkspaceEdit` is computed from: one virtual rename per fixed target.
 * Two targets are the same target only where the file system says so (`A.dita` and
 * `a.dita` are two missing files on Linux, one on Windows), the way the missing targets
 * were grouped in the first place.
 */
export function toRenames(
  chosen: ChosenFix[],
  platform: NodeJS.Platform = process.platform,
): Array<{ oldPath: string; newPath: string }> {
  const seen = new Set<string>();
  const renames: Array<{ oldPath: string; newPath: string }> = [];
  for (const fix of chosen) {
    const key = normalizePathForCompare(fix.targetPath, platform);
    if (seen.has(key)) continue;
    seen.add(key);
    renames.push({ oldPath: fix.targetPath, newPath: fix.newPath });
  }
  return renames;
}

/** What Enter alone would repair. */
export function preselectedFixes(plan: FixPlan): ChosenFix[] {
  const fixes: ChosenFix[] = [];
  for (const p of plan.proposals) {
    if (p.preselect) fixes.push({ targetPath: p.target.targetPath, newPath: p.preselect });
  }
  return fixes;
}

// ── ranking and grouping helpers ──

function fold(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

function segments(p: string): string[] {
  return fold(p).split('/').filter((s) => s.length > 0);
}

function sharedTail(a: string, b: string): number {
  const sa = segments(a);
  const sb = segments(b);
  let n = 0;
  while (n < sa.length && n < sb.length && sa[sa.length - 1 - n] === sb[sb.length - 1 - n]) n++;
  return n;
}

function dirDistance(a: string, b: string): number {
  const sa = segments(a);
  const sb = segments(b);
  let common = 0;
  while (common < sa.length && common < sb.length && sa[common] === sb[common]) common++;
  return sa.length + sb.length - 2 * common;
}

/** The workspace folder a path sits in, or undefined when it sits in none. */
function rootOf(p: string, roots: string[] | undefined, platform: NodeJS.Platform): string | undefined {
  if (!roots || roots.length === 0) return undefined;
  const np = normalizePathForCompare(p, platform).replace(/\/$/, '');
  let best: string | undefined;
  for (const root of roots) {
    const nr = normalizePathForCompare(root, platform).replace(/\/$/, '');
    if (np !== nr && !np.startsWith(nr + '/')) continue;
    if (best === undefined || nr.length > best.length) best = nr;
  }
  return best;
}

function rankCandidate(
  candidatePath: string,
  target: BrokenTarget,
  platform: NodeJS.Platform,
  roots: string[] | undefined,
): FixCandidate {
  const pImpl = (platform === 'win32' ? pathWin32 : pathPosix) as typeof import('path');
  const candDir = pImpl.dirname(candidatePath);
  const refDirs = target.files.map((f) => pImpl.dirname(f));
  const candRoot = rootOf(candDir, roots, platform);
  return {
    path: candidatePath,
    sharedTail: sharedTail(candDir, pImpl.dirname(target.targetPath)),
    sameRoot: refDirs.some((d) => rootOf(d, roots, platform) === candRoot),
    distance: refDirs.length ? Math.min(...refDirs.map((d) => dirDistance(candDir, d))) : 0,
    suggested: false,
  };
}

function compareCandidates(a: FixCandidate, b: FixCandidate): number {
  return (
    Number(b.suggested) - Number(a.suggested) ||
    b.sharedTail - a.sharedTail ||
    Number(b.sameRoot) - Number(a.sameRoot) ||
    a.distance - b.distance ||
    a.path.localeCompare(b.path)
  );
}

/** The file a proposal would use when nothing has to be asked. */
function silentChoice(p: FixProposal): string | undefined {
  if (p.preselect) return p.preselect;
  return p.kind === 'case' ? p.candidates[0]?.path : undefined;
}

function inferMoves(proposals: FixProposal[], platform: NodeJS.Platform): FolderMove[] {
  const pImpl = (platform === 'win32' ? pathWin32 : pathPosix) as typeof import('path');
  const groups = new Map<string, { oldDir: string; newDir: string; members: FixProposal[] }>();
  for (const p of proposals) {
    const choice = silentChoice(p);
    if (!choice) continue;
    const oldDir = pImpl.dirname(p.target.targetPath);
    const newDir = pImpl.dirname(choice);
    if (fold(oldDir) === fold(newDir)) continue;
    const key = `${fold(oldDir)}\u0000${fold(newDir)}`;
    const group = groups.get(key) ?? { oldDir, newDir, members: [] };
    group.members.push(p);
    groups.set(key, group);
  }

  const moves: FolderMove[] = [];
  for (const [key, group] of groups) {
    // One stranded target is a renamed file; two or more under one directory
    // are what a moved folder leaves behind.
    if (group.members.length < 2) continue;
    for (const m of group.members) m.move = key;
    moves.push({
      key,
      oldDir: group.oldDir,
      newDir: group.newDir,
      targets: group.members.length,
      references: group.members.reduce((n, m) => n + m.target.refs.length, 0),
    });
  }
  return moves.sort((a, b) => b.targets - a.targets || a.key.localeCompare(b.key));
}

/**
 * Points a `multiple` target at the move's new directory when one of its
 * candidates landed there: ranked first and marked "suggested", still not
 * preselected -- which file was meant is the user's call.
 */
function markSuggestions(proposals: FixProposal[], moves: FolderMove[], platform: NodeJS.Platform): void {
  const pImpl = (platform === 'win32' ? pathWin32 : pathPosix) as typeof import('path');
  const moveByOldDir = new Map(moves.map((m) => [fold(m.oldDir), m]));
  for (const p of proposals) {
    if (p.kind !== 'multiple') continue;
    const move = moveByOldDir.get(fold(pImpl.dirname(p.target.targetPath)));
    if (!move) continue;
    const hit = p.candidates.find((c) => fold(pImpl.dirname(c.path)) === fold(move.newDir));
    if (!hit) continue;
    hit.suggested = true;
    p.candidates.sort(compareCandidates);
    p.move = move.key;
  }
}

const KIND_ORDER: Record<FixKind, number> = { unique: 0, case: 1, multiple: 2, none: 3 };

function compareProposals(a: FixProposal, b: FixProposal): number {
  return (
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    (a.move ?? '').localeCompare(b.move ?? '') ||
    b.target.refs.length - a.target.refs.length ||
    a.target.targetPath.localeCompare(b.target.targetPath)
  );
}
