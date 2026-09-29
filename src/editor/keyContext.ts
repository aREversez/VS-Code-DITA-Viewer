// ── the workspace's key context map (vscode-free state) ──
//
// Oxygen's DITA Maps Manager "context": one ditamap chosen so that every
// open map and topic resolves keyrefs against ITS key space (see keySpace.ts
// buildKeySpace). This module only holds the choice and tells listeners when
// it changes; persisting it and the UI to change it live in extension.ts.

import { resolve } from 'path';

let contextMap: string | undefined;
const changeListeners = new Set<() => void>();
const missingListeners = new Set<(path: string) => void>();
/** Paths already reported missing, so a hot path calling buildKeyMap does
 *  not repeat the same notice; cleared whenever the context is set. */
const reportedMissing = new Set<string>();

export function getKeyContextMap(): string | undefined {
  return contextMap;
}

/** Sets (or, with undefined, clears) the context. Returns whether it changed. */
export function setKeyContextMap(path: string | undefined): boolean {
  const next = path === undefined ? undefined : resolve(path);
  reportedMissing.clear();
  if (next === contextMap) return false;
  contextMap = next;
  for (const fn of [...changeListeners]) fn();
  return true;
}

export function onKeyContextChanged(fn: () => void): { dispose(): void } {
  changeListeners.add(fn);
  return { dispose: () => void changeListeners.delete(fn) };
}

/** Called by the key map when the chosen context file no longer exists. */
export function reportKeyContextMissing(path: string): void {
  if (reportedMissing.has(path)) return;
  reportedMissing.add(path);
  for (const fn of [...missingListeners]) fn(path);
}

export function onKeyContextMissing(fn: (path: string) => void): { dispose(): void } {
  missingListeners.add(fn);
  return { dispose: () => void missingListeners.delete(fn) };
}
