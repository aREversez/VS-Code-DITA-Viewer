// "Format and Indent" for .dita / .ditamap source (Oxygen's command of the same
// name). The layout engine is the pure src/language/xmlFormat.ts; this file is
// the VS Code glue: one command (Command Palette, DITA submenu). It is
// deliberately NOT registered as a formatting provider: that would add VS
// Code's own "Format Document" / "Format Document With..." entries to the
// editor context menu next to the DITA one.

import * as vscode from 'vscode';
import { FormatOptions, formatXml, formatXmlRange, minimalEdit, detectLineWidth, FormatEdit } from '../language/xmlFormat';

function readOptions(document: vscode.TextDocument, editorOptions: { tabSize: number; insertSpaces: boolean }): Partial<FormatOptions> {
  const cfg = vscode.workspace.getConfiguration('dita-viewer.format', document.uri);
  const configuredWidth = Math.max(0, cfg.get<number>('lineWidth', 80));
  // Mirror Oxygen's "Detect line width on open": when enabled, adopt the width
  // the document was already wrapped to so re-formatting is a no-op rather than
  // a reflow (a lone unwrapped source line, or no clear width signal, keeps the
  // configured value). A configured width of 0 means "never wrap" and wins.
  let lineWidth = configuredWidth;
  if (configuredWidth > 0 && cfg.get<boolean>('detectLineWidth', true)) {
    const detected = detectLineWidth(document.getText());
    if (detected !== null) lineWidth = detected;
  }
  return {
    indentSize: Math.max(1, editorOptions.tabSize),
    useTabs: !editorOptions.insertSpaces,
    lineWidth,
    expandEmptyElements: cfg.get<boolean>('expandEmptyElements', false),
    breakLineBeforeAttribute: cfg.get<boolean>('breakLineBeforeAttribute', false),
    breakLongAttributes: cfg.get<boolean>('breakLongAttributes', true),
    preserveSpaceElements: cfg.get<string[]>('preserveSpaceElements', []),
    mixedContentElements: cfg.get<string[]>('mixedContentElements', []),
    breakLineElements: cfg.get<string[]>('breakLineElements', []),
  };
}

export type ComputedEdits =
  | { ok: true; edits: vscode.TextEdit[] }
  | { ok: false; message: string; offset: number };

function toTextEdits(document: vscode.TextDocument, edits: FormatEdit[]): vscode.TextEdit[] {
  return edits.map((e) =>
    vscode.TextEdit.replace(
      new vscode.Range(document.positionAt(e.start), document.positionAt(e.end)),
      e.newText,
    ),
  );
}

/** Edits that format the whole document, or only `range` when it is non-empty. */
export function computeFormatEdits(
  document: vscode.TextDocument,
  editorOptions: { tabSize: number; insertSpaces: boolean },
  range?: vscode.Range,
): ComputedEdits {
  const text = document.getText();
  const options = readOptions(document, editorOptions);
  const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';

  if (range && !range.isEmpty) {
    const r = formatXmlRange(text, document.offsetAt(range.start), document.offsetAt(range.end), options, eol);
    return r.ok ? { ok: true, edits: toTextEdits(document, r.edits) } : r;
  }
  const r = formatXml(text, options, eol);
  if (!r.ok) return r;
  const edit = minimalEdit(text, r.text);
  return { ok: true, edits: edit ? toTextEdits(document, [edit]) : [] };
}

function warnNotWellFormed(document: vscode.TextDocument, message: string, offset: number): void {
  const pos = document.positionAt(offset);
  vscode.window.showWarningMessage(
    vscode.l10n.t(
      'Cannot format: the document is not well-formed ({0}, line {1}). Fix it first; nothing was changed.',
      message,
      pos.line + 1,
    ),
  );
}

export function registerFormatAndIndent(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand('ditaViewer.formatAndIndent', async (editor) => {
      const sel = editor.selection;
      const r = computeFormatEdits(
        editor.document,
        { tabSize: Number(editor.options.tabSize ?? 2), insertSpaces: editor.options.insertSpaces !== false },
        sel.isEmpty ? undefined : sel,
      );
      if (!r.ok) {
        warnNotWellFormed(editor.document, r.message, r.offset);
        return;
      }
      if (r.edits.length === 0) return;
      await editor.edit((builder) => {
        for (const e of r.edits) builder.replace(e.range, e.newText);
      });
    }),
  );
}
