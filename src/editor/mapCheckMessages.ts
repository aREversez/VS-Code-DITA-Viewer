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
  'ref.invalidTopicId': 'Referenced topic id "{0}" not found',
  'ref.filteredTarget': 'Referenced ID path "{0}" is located in content excluded by the profiling filters',
  'ref.filteredByConref': 'Referenced ID path "{0}" is located in content a content reference replaces',
  // conref/conrefend shape
  'conref.missingId': 'Content reference has no "#id" part: {0}',
  'conref.endNoStart': 'conrefend is used without conref: {0}',
  'conref.endOtherFile': 'conrefend "{0}" points to a different file than conref "{1}"',
  'conref.siblings': 'conref and conrefend do not refer to sibling elements: {0} → {1}',
  'conref.order': 'The conref target must come before the conrefend target: {0} → {1}',
  'conref.targetValue': 'Element <{0}> has no conref or conkeyref but @{1} is "{2}"',
  // id references and links
  'id.badReference': 'Bad ID reference (trailing slash): {0}',
  'id.pathNotFound': 'Referenced ID path "{0}" not found',
  'topicref.element': 'Topic reference names an element id, not a topic id: {0}',
  'key.linkNoTarget': 'Key "{0}" defines no target, so the reference will not appear as a link: {1}',
  'link.noTarget': '<{0}> has neither @href nor @keyref',
  'link.resourceOnly': 'Topic "{0}" is published only as resource-only; the cross-reference will break',
  // reference spelling and structure
  'ref.winSeparators': 'Reference uses backslashes instead of forward slashes: {0}',
  'ref.absolute': 'Reference is an absolute path; DITA references should be relative to the map',
  'ref.doubleSlash': 'Reference contains a doubled path separator ("//"): {0}',
  'ref.trailingSlash': 'Reference ends with a slash: {0}',
  'ref.unencoded': 'Reference contains characters that must be percent-encoded: {0}',
  'ref.wrongCase': 'File name capitalization does not match the file on disk ("{1}"): {0}',
  'ref.folder': 'Reference points to a folder, not a file: {0}',
  'ref.recursiveMap': 'Map reference closes a cycle; this map is already being processed: {0}',
  // key and id syntax
  'key.invalidSlash': 'Key reference has more than one "/" (expected key/element): {0}',
  'key.invalidWhitespace': 'Key reference contains whitespace: {0}',
  'id.invalid': 'ID "{0}" is not a valid DITA ID (XML NCName)',
  // @format and @scope
  'ref.noFormat': 'Reference to a non-DITA resource has no @format: {0}',
  'ref.extNoFormat': 'External reference has no @format: {0}',
  'ref.resAsDita': 'Non-DITA resource is referenced as a DITA topic: {0}',
  'ref.resAsMap': 'Non-DITA resource is referenced as a DITA map: {0}',
  'ref.mapFormat': 'Map reference is not declared as format="ditamap": {0}',
  'ref.topicFormat': 'Topic is referenced with format="{1}": {0}',
  'ref.topicAsMap': 'Topic is referenced with format="ditamap": {0}',
  'ref.needsExternalScope': 'Reference to a URL must declare scope="external": {0}',
  'ref.maprefContent': 'Content inside a map reference is ignored',
  // navigation titles
  'nav.topichead': 'Topichead has no navigation title',
  'nav.topicref': 'External reference has no navigation title: {0}',
  // ids, keys, reuse
  'id.duplicate': 'Duplicate topic id "{0}" ({1} topics share it)',
  'id.duplicateElement': 'Duplicate element id "{0}" in the same topic',
  'key.undefined': 'Key reference "{0}" does not match any key definition',
  'key.duplicate': 'Key "{0}" is already defined; this definition is ignored',
  'key.unreferenced': 'Key "{0}" is defined but never referenced',
  'reuse.unreferenced': 'Reusable element <{0} id="{1}"> is never referenced by a conref or conkeyref',
  // profiling
  'prof.conflict': '@{0}="{1}" on <{2}> shares no value with the enclosing "{3}"; the content is overshadowed in profiled output',
  'prof.notConfigured': 'No profiling preferences are configured (dita-viewer.completenessCheck.profilingAttributes)',
  'prof.attrUndefined': 'Profiling attribute @{0} on <{1}> is not defined in the profiling preferences',
  'prof.valueUndefined': '@{0} value "{1}" is not defined in the profiling preferences',
  'prof.singleValue': '@{0} is single-value but has {1} values ("{2}")',
  'prof.emptyValue': 'Profiling attribute @{0} on <{1}> has an empty value',
  // filter (DITAVAL) file
  'ditaval.duplicateCondition': 'Duplicate condition in the filter file for "{0}"; only the first encountered condition is used',
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
