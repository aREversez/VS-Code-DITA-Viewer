// Every finding the completeness check can report, as a code plus arguments.
//
// The checks are pure (no vscode), so they can't call vscode.l10n.t; instead
// each finding carries a code and its arguments, and the UI layer
// (mapCheckUi.ts) turns that into localized text. The English templates
// below are the source of truth for both: tests use them directly, and a
// test asserts every one of them appears verbatim as a vscode.l10n.t(...)
// call in mapCheckUi.ts so no template can be added without a translation
// entry point.

export const MESSAGE_TEMPLATES = {
  // references
  'ref.missingTopic': 'Referenced topic not found: {0}',
  'ref.missingMap': 'Referenced map not found: {0}',
  'ref.missingConref': 'Referenced conref target not found: {0}',
  'ref.missingResource': 'Referenced resource not found: {0}',
  'ref.remoteUnreachable': 'Remote resource could not be reached: {0}',
  'ref.outsideFolder': 'Reference points outside the map folder: {0}',
  'ref.linkNotInMap': 'Link target is not referenced in any map: {0}',
  'ref.multiple': 'Topic referenced more than once ({1} times): {0}',
  // ids, keys, reuse
  'id.duplicate': 'Duplicate topic id "{0}" ({1} topics share it)',
  'key.duplicate': 'Key "{0}" is already defined; this definition is ignored',
  'key.unreferenced': 'Key "{0}" is defined but never referenced',
  'reuse.unreferenced': 'Reusable element <{0} id="{1}"> is never referenced by a conref or conkeyref',
  // profiling
  'prof.conflict': '@{0}="{1}" on <{2}> shares no value with the enclosing "{3}"; the content is overshadowed in profiled output',
  'prof.notConfigured': 'No profiling preferences are configured (dita-viewer.completenessCheck.profilingAttributes)',
  'prof.attrUndefined': 'Profiling attribute @{0} on <{1}> is not defined in the profiling preferences',
  'prof.valueUndefined': '@{0} value "{1}" is not defined in the profiling preferences',
  'prof.singleValue': '@{0} is single-value but has {1} values ("{2}")',
  // validation
  'val.unreadable': 'File could not be read',
  'val.xml': 'XML error: {0}',
  'val.notMap': 'Root element <{0}> is not a DITA map',
  'val.notTopic': 'Root element <{0}> is not a DITA topic',
  'val.noId': 'Topic <{0}> has no id attribute',
  'val.noTitle': 'Topic <{0}> has no <title>',
  // tables
  'tbl.cals.colsInvalid': 'CALS table: @cols "{0}" is not a valid column count',
  'tbl.cals.attrNotNumeric': 'CALS table: @{0} "{1}" is not numeric',
  'tbl.cals.colspecNotNumeric': 'CALS table: <colspec> @{0} "{1}" is not numeric',
  'tbl.cals.colspecCount': 'CALS table: {0} <colspec> element(s) but @cols is {1}',
  'tbl.cals.badName': 'CALS table: @{1} "{0}" does not match any <colspec> colname',
  'tbl.cals.nameOrder': 'CALS table: @nameend "{1}" comes before @namest "{0}"',
  'tbl.cals.overlap': 'CALS table: row {0}: entry overlaps a cell spanning down from a previous row (column {1})',
  'tbl.cals.morerows': 'CALS table: row {0}: @morerows="{1}" spans past the last row ({2} row(s) remain)',
  'tbl.cals.rowWidth': 'CALS table: row {0} has {1} column(s) of cells; the table has {2}',
  'tbl.cals.colsMismatch': 'CALS table: @cols is {0} but the table structure has {1} column(s)',
  'tbl.simple.short': 'Simple table: row {0} has {1} cell(s); expected {2}',
  'tbl.simple.long': 'Simple table: row {0} has {1} cell(s); the header row has {2}',
} as const;

export type MsgCode = keyof typeof MESSAGE_TEMPLATES;

export interface Msg {
  code: MsgCode;
  args: Array<string | number>;
}

export function msg(code: MsgCode, ...args: Array<string | number>): Msg {
  return { code, args };
}

/** Fills {0}, {1}, … of a template. */
export function fill(template: string, args: ReadonlyArray<string | number>): string {
  return template.replace(/\{(\d+)\}/g, (_m, i: string) => String(args[Number(i)] ?? ''));
}

/** English text of a finding. */
export function formatMessage(m: Msg): string {
  return fill(MESSAGE_TEMPLATES[m.code], m.args);
}
