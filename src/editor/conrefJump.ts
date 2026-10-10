// Host side of the conref jump button (see webview/conrefJumpScript.ts and
// the data-conref-* attributes renderer.ts emits).
//
// The webview is untrusted input for a path, so the message is validated here
// before anything is opened: an absolute path to a DITA source, and a
// non-negative position. Pure -- no vscode import -- so it is unit-tested
// directly; the vscode glue that acts on the result is in
// conrefJumpCommand.ts.
import { isAbsolute } from 'path';

export { MSG_OPEN_CONREF_TARGET } from './mapMessages';

export interface ConrefJumpTarget {
  file: string;
  /** 0-based, as the parser's sourceRange. */
  line: number;
  col: number;
}

// What a conref target can be: a topic, a map, or an .xml-named DITA file.
const DITA_SOURCE = /\.(dita|ditamap|xml)$/i;

export function parseConrefJumpMessage(message: { [key: string]: unknown }): ConrefJumpTarget | undefined {
  const { file, line, col } = message;
  if (typeof file !== 'string' || !isAbsolute(file) || !DITA_SOURCE.test(file)) return undefined;
  if (typeof line !== 'number' || !Number.isInteger(line) || line < 0) return undefined;
  const column = typeof col === 'number' && Number.isInteger(col) && col >= 0 ? col : 0;
  return { file, line, col: column };
}
