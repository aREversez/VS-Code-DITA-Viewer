export interface SourceRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface DitaNode {
  type: 'element' | 'text' | 'comment';
  tagName?: string;
  classTokens?: string[];
  baseType?: string;
  attributes?: Record<string, string>;
  children: DitaNode[];
  text?: string;
  /**
   * Inner text of an XML comment (`<!--` … `-->` content, delimiters stripped),
   * set only when type === 'comment'. Deliberately NOT stored in `text`: every
   * text extraction in the codebase reads a text node's `text` as visible
   * content (titles, key values, xref fallbacks, search body), and a comment
   * is not content. Only the renderer shows it, and only where it was written.
   */
  comment?: string;
  sourceRange: SourceRange;
}

export interface DitaDocument {
  root: DitaNode;
  sourceRange: SourceRange;
}
