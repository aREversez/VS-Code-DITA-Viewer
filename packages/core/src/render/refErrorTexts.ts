// Wording for the broken-reference hints (RenderContext.refError).
//
// A LEAF module: no imports, so both the renderer (render/renderer.ts,
// render/baseTypeMap.ts) and the editor-layer resolver factory
// (editor/refResolvers.ts) can read it without a cycle -- the same reason
// FALLBACK_NOTE_LABELS is duplicated in baseTypeMap rather than imported
// from the editor layer, solved here by putting the shared strings below
// both instead.
//
// The renderer only PRESENTS: it asks RenderContext.refError whether a
// reference is broken and composes the answer with the templates below.
// The diagnosis itself is the host's (the callback), and so is the
// localization -- a host fills these from its own string catalog (the VS
// Code extension does, via vscode.l10n.t); the defaults here are English.
//
// Templates use {0}/{1} placeholders rather than concatenation so a
// locale controls the whole shape, punctuation included: zh-cn wraps the
// reason in full-width parentheses（…）where English uses (…) .

export interface RefErrorTexts {
  /**
   * Placeholder chip replacing a conref that pulled nothing.
   * {0} = the reason refError returned.
   */
  content: string;
  /**
   * Marker replacing an EMPTY xref whose target is broken.
   * {0} = the raw href, {1} = the reason refError returned.
   */
  xref: string;
  /** Reason (conkeyref only): the key is not defined, or has no resource target. */
  missingKey: string;
  /** Reason: the referenced file is not in the repository closure. */
  missingFile: string;
  /** Reason: the file exists but is not well-formed XML. */
  parseError: string;
  /** Reason: the file parses but #topicId/elementId names no id in it. */
  missingId: string;
  /**
   * Reason: the file exists but lies outside the folders the host allows
   * references to read (see setReadRoots). Optional so a host built against an
   * earlier RefErrorTexts keeps compiling; the English default fills it in.
   */
  outsideWorkspace?: string;
}

export const DEFAULT_REF_ERROR_TEXTS: RefErrorTexts = {
  content: 'Referenced content could not be resolved ({0})',
  xref: '→ {0} ({1})',
  missingKey: 'key is not defined or has no target',
  missingFile: 'target file does not exist',
  parseError: 'target file cannot be parsed as XML',
  missingId: 'target ID does not exist',
  outsideWorkspace: 'target file is outside the workspace',
};

/**
 * Fills {0}, {1}, ... in a template. split/join rather than
 * String.replace: the substituted values are arbitrary reference text
 * (an href, a reason) and must not be read for $-patterns.
 */
export function fillRefErrorTemplate(template: string, ...values: string[]): string {
  let out = template;
  for (let i = 0; i < values.length; i++) {
    out = out.split(`{${i}}`).join(values[i]);
  }
  return out;
}