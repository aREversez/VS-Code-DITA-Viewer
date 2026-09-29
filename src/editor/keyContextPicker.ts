// ── QuickPick items and status text for the key context map (vscode-free) ──

export interface ContextPickItem {
  label: string;
  description: string;
  /** The map to make the context; undefined for the "no context" entry. */
  path: string | undefined;
}

export function buildContextPickItems(
  maps: string[],
  current: string | undefined,
  noneLabel: string,
  relativize: (path: string) => string,
): ContextPickItem[] {
  const all = new Set(maps);
  // A context outside the workspace (or one the search missed) must still be
  // visible and selectable, or the picker could not show what is in force.
  if (current !== undefined) all.add(current);
  const sorted = [...all].sort((a, b) => baseName(a).localeCompare(baseName(b)) || a.localeCompare(b));
  const check = (on: boolean) => (on ? '$(check) ' : '');
  return [
    { label: `${check(current === undefined)}${noneLabel}`, description: '', path: undefined },
    ...sorted.map((p) => ({
      label: `${check(p === current)}${baseName(p)}`,
      description: relativize(p),
      path: p,
    })),
  ];
}

export function contextStatusText(current: string | undefined, autoLabel: string): string {
  return `$(key) ${current === undefined ? autoLabel : baseName(current)}`;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function isDitaPath(fsPath: string | undefined): boolean {
  if (!fsPath) return false;
  const lower = fsPath.toLowerCase();
  return lower.endsWith('.dita') || lower.endsWith('.ditamap');
}

/** The status item is for DITA work: shown while a DITA file is in front of
 *  the user, and always while a context is set so it can be seen and cleared. */
export function shouldShowContextStatus(activePath: string | undefined, contextSet: boolean): boolean {
  return contextSet || isDitaPath(activePath);
}
