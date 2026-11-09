// Formatting for the diff log, free of `vscode` so it can be tested.
export function formatDiffLogEntry(what: string, err: unknown, at: Date): string {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  // Error.stack starts with "Name: message"; keep it whole so the stack follows,
  // but do not repeat the message when it is already the first line.
  const body = err instanceof Error && err.stack ? err.stack.replace(/^[^\n]*?: /, '') : detail;
  return `[${at.toISOString()}] ${what}: ${body}`;
}
