// Quoting an argument for `cmd.exe /d /s /c "..."`, in one place.
//
// Two launchers hand a command line to cmd.exe (the DITA-OT dita.bat and an
// Oxygen batch launcher) and used to carry their own rules, which disagreed:
// one refused a `%` in a path, the other let it through, and cmd expands
// %NAME% even inside double quotes -- so a folder called `%COMSPEC%` changed
// the command that ran. Both now go through here.

/**
 * Characters that still act on a command line INSIDE a double-quoted argument:
 * `%` (variable expansion) and a line break (ends the command). `"` is not on
 * the list because quoteCmdArg doubles it; `& | < > ^` are inert in quotes, so
 * a folder called "R&D" is fine.
 */
export const CMD_ACTIVE_IN_QUOTES = /[%\r\n]/;

/**
 * The stricter set the Oxygen batch launcher refuses outright (it builds its
 * own `""script" "file""` line and does no escaping at all).
 */
export const CMD_UNSAFE = /[%"^&|<>!\r\n]/;

/** An argument cmd.exe would act on even quoted; `arg` is the offender. */
export class CmdUnsafeArgumentError extends Error {
  constructor(readonly arg: string) {
    super(`Unsafe argument for cmd.exe: ${arg}`);
    this.name = 'CmdUnsafeArgumentError';
  }
}

/** `"arg"` with embedded quotes doubled; throws for a `%` or line break. */
export function quoteCmdArg(arg: string): string {
  if (CMD_ACTIVE_IN_QUOTES.test(arg)) throw new CmdUnsafeArgumentError(arg);
  return `"${arg.replace(/"/g, '""')}"`;
}
