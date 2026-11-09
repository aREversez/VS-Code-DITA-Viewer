// Pure helpers behind the "Compare with Git Version" flow. No `vscode` import,
// so the rules can be tested directly instead of through a QuickPick.

// The title of the diff tab. A WebviewPanel title is plain text: unlike a
// QuickPick label it does not resolve `$(codicon)` tokens, so a prefix such as
// `$(diff)` shows up literally in the tab.
export function diffPanelTitle(fileName: string, leftLabel: string, rightLabel: string): string {
  return `${fileName} — ${leftLabel} ↔ ${rightLabel}`;
}

// What a version choice produced. Backing out of a nested picker is a decision,
// not a failure: only `failed` earns an error message.
export type VersionOutcome<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'cancelled' }
  | { kind: 'failed' };

export function shouldReportFailure<T>(outcome: VersionOutcome<T>): boolean {
  return outcome.kind === 'failed';
}

// The choices offered for the second pick: everything except the one already
// taken as the first version, but a choice that opens a further picker stays,
// because picking a different commit through it is a different comparison.
// Without that, "any history vs any history" had no route through the UI.
export function secondPickChoices<T>(
  choices: readonly T[],
  firstPick: T,
  opensPicker: (choice: T) => boolean,
): T[] {
  return choices.filter((c) => c !== firstPick || opensPicker(c));
}

// What the reader has set in the diff panel: the Aa and Flags toggles and which change
// they are on (-1 = none yet). The page is replaced wholesale on every render,
// so the host keeps this and writes it back into the next page.
export interface DiffViewState {
  inline: boolean;
  // The Flags toggle: whether conditional-content highlighting is shown.
  profiling: boolean;
  idx: number;
}

export function initialViewState(): DiffViewState {
  return { inline: true, profiling: true, idx: -1 };
}

// Swap shows the same changes the other way round, so the position stays.
// A new comparison has different changes, so only the Aa choice, a reading
// preference, carries over.
export function carryViewState(prev: DiffViewState | undefined, kind: 'swap' | 'recompare'): DiffViewState {
  if (!prev) return initialViewState();
  return kind === 'swap' ? { ...prev } : { inline: prev.inline, profiling: prev.profiling, idx: -1 };
}

// Two picks that landed on the same commit compare a file with itself and show
// an empty diff. The working copy has no hash and never counts as the same.
export function sameVersion(a: string | undefined, b: string | undefined): boolean {
  return a !== undefined && b !== undefined && a === b;
}
