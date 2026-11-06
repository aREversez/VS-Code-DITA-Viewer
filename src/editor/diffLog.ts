import * as vscode from 'vscode';
import { formatDiffLogEntry } from './diffLogFormat';

let channel: vscode.OutputChannel | undefined;

// An error in the diff flow used to go to console.error, which is the extension
// host's console and invisible to a user; the toast carries only the message.
// This channel keeps the detail (stack, file, ref) where a bug report can reach it.
export function logDiffError(what: string, err: unknown): void {
  channel ??= vscode.window.createOutputChannel('DITA Diff');
  channel.appendLine(formatDiffLogEntry(what, err, new Date()));
}
