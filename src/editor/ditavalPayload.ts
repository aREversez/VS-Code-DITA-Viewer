// What the Filter panel needs to know about a .ditaval: its name and its rules.
//
// Pure of the vscode module, so it is unit-tested in plain mocha. The host reads
// the file and parses it with the core's parseDitaval (the one the Obsidian
// plugin uses too), then hands the webview this plain, JSON-safe shape; the
// webview decides per attribute value, with the same rules as the core's
// ditavalAction (see profilingFilterScript.ts).

import { readFileSync } from 'fs';
import { basename } from 'path';
import { parseDitaval } from '@dita-viewer/core';
import type { DitavalAction } from '@dita-viewer/core';

export interface DitavalRulePayload {
  att: string;
  /** Absent for the attribute-wide default. */
  val?: string;
  action: DitavalAction;
}

/** Why a chosen .ditaval is not in force. */
export type DitavalProblem =
  | { kind: 'missing' }
  | { kind: 'unreadable'; detail: string }
  | { kind: 'malformed'; detail: string };

export interface DitavalPayload {
  /** Absolute path, kept by the host; the webview only displays the name. */
  path: string;
  name: string;
  /** Empty when the file did not read cleanly: a broken filter is not applied. */
  rules: DitavalRulePayload[];
  problem?: DitavalProblem;
}

/** Read and parse a .ditaval. Never throws. */
export function readDitaval(absPath: string): DitavalPayload {
  const name = basename(absPath);
  let text: string;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { path: absPath, name, rules: [], problem: { kind: 'missing' } };
    return { path: absPath, name, rules: [], problem: { kind: 'unreadable', detail: e instanceof Error ? e.message : String(e) } };
  }
  const parsed = parseDitaval(text.replace(/^﻿/, ''));
  if (parsed.error !== undefined) {
    return { path: absPath, name, rules: [], problem: { kind: 'malformed', detail: parsed.error } };
  }
  return {
    path: absPath,
    name,
    rules: parsed.rules.map((r) => (r.val === undefined ? { att: r.att, action: r.action } : { att: r.att, val: r.val, action: r.action })),
  };
}
