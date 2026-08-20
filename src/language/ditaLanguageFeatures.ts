// VS Code glue for the DITA language features: go-to-definition,
// completion, document symbols and broken-reference diagnostics.
// The text/offset logic lives in ditaLanguageUtils.ts (unit-tested).

import * as vscode from 'vscode';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { dirname, isAbsolute, join, relative, resolve } from 'path';
import { formatLocalizedRole } from './bookRoleL10n';
import {
  collectIds,
  collectMapSymbols,
  collectRefEntries,
  collectTopicSymbols,
  DocSymbolSpec,
  findConrefTargetOffset,
  findKeyDefinitionOffset,
  findRefAttrAt,
  findUnclosedTag,
  getAttributesForTag,
  getAutoCloseTag,
  getCloseTagCompletion,
  getCompletionContext,
  isExternalRef,
  offsetToLineCol,
} from './ditaLanguageUtils';
import { buildKeyMap, findDitamapFiles } from '../editor/DitaViewerProvider';
import { decodeHrefPart } from '../editor/ditaRenderUtils';
import { parseDita, parseDitamap, preprocessEntities } from '../parser/ditaParser';
import { STANDARD_TAG_TO_BASETYPE } from '../parser/standardTagMap';
import { MAP_STANDARD_TAG_TO_BASETYPE } from '../parser/mapTagMap';

const DITA_SELECTOR: vscode.DocumentSelector = [
  { language: 'dita' },
  { language: 'ditamap' },
  { pattern: '**/*.dita' },
  { pattern: '**/*.ditamap' },
];

function isMapDocument(document: vscode.TextDocument): boolean {
  return document.languageId === 'ditamap' || document.uri.fsPath.toLowerCase().endsWith('.ditamap');
}

// ── Definition provider ──

const MAP_SCAN_LIMIT = 50;

/**
 * Finds the location of the keydef that defines a key: scans ancestor-folder
 * ditamaps first, then follows ditamap references from those maps (the same
 * key space buildKeyMap uses, but yielding a source location).
 */
function findKeyDefinitionLocation(docUri: vscode.Uri, key: string): vscode.Location | undefined {
  const queue = findDitamapFiles(docUri, false);
  const visited = new Set<string>();
  while (queue.length > 0 && visited.size < MAP_SCAN_LIMIT) {
    const mf = resolve(queue.shift()!);
    if (visited.has(mf)) continue;
    visited.add(mf);
    let text: string;
    try {
      text = readFileSync(mf, 'utf-8');
    } catch {
      continue;
    }
    const off = findKeyDefinitionOffset(text, key);
    if (off >= 0) {
      const { line, col } = offsetToLineCol(text, off);
      return new vscode.Location(vscode.Uri.file(mf), new vscode.Position(line, col));
    }
    // Follow referenced ditamaps so keydefs in included maps are found too
    const refRe = /href\s*=\s*"([^"]+\.ditamap)"/gi;
    let m: RegExpExecArray | null;
    while ((m = refRe.exec(text)) !== null) {
      const p = m[1];
      if (!isExternalRef(p) && !isAbsolute(p)) queue.push(resolve(dirname(mf), p));
    }
  }
  return undefined;
}

class DitaDefinitionProvider implements vscode.DefinitionProvider {
  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Definition | undefined {
    const text = document.getText();
    const offset = document.offsetAt(position);
    const hit = findRefAttrAt(text, offset);
    if (!hit || !hit.value) return undefined;

    // keyref / conkeyref: jump to the keydef in the defining ditamap.
    // conkeyref is "key/elementId" — the key part locates the map entry.
    if (hit.attr === 'keyref' || hit.attr === 'conkeyref') {
      const key = hit.value.split('/')[0];
      if (!key) return undefined;
      return findKeyDefinitionLocation(document.uri, key);
    }

    // conref / href: "file.dita#topicId/elementId", "file.dita" or "#topicId"
    if (isExternalRef(hit.value, hit.scope)) return undefined;
    const hashIdx = hit.value.indexOf('#');
    const filePart = hashIdx >= 0 ? hit.value.substring(0, hashIdx) : hit.value;
    const fragment = hashIdx >= 0 ? hit.value.substring(hashIdx + 1) : '';

    const docDir = dirname(document.uri.fsPath);
    const targetPath = filePart ? resolve(docDir, decodeHrefPart(filePart)) : document.uri.fsPath;
    if (!existsSync(targetPath)) return undefined;

    if (!fragment) {
      return new vscode.Location(vscode.Uri.file(targetPath), new vscode.Position(0, 0));
    }
    let targetText: string;
    try {
      targetText = filePart ? readFileSync(targetPath, 'utf-8') : text;
    } catch {
      return undefined;
    }
    const targetOff = findConrefTargetOffset(targetText, fragment);
    if (targetOff < 0) {
      // Fragment unresolved: still land at the top of the file
      return new vscode.Location(vscode.Uri.file(targetPath), new vscode.Position(0, 0));
    }
    const { line, col } = offsetToLineCol(targetText, targetOff);
    return new vscode.Location(vscode.Uri.file(targetPath), new vscode.Position(line, col));
  }
}

// ── Completion provider ──

/** Lists referenceable files under a directory (recursive, depth-limited). */
function listReferenceableFiles(baseDir: string, maxDepth = 3): string[] {
  const results: string[] = [];
  function walk(dir: string, depth: number) {
    if (depth > maxDepth || results.length >= 200) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (e) {
      console.warn(`Failed to read directory ${dir}:`, e instanceof Error ? e.message : e);
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules' || entry === 'out') continue;
      const full = join(dir, entry);
      try {
        if (statSync(full).isDirectory()) {
          walk(full, depth + 1);
        } else if (/\.(dita|ditamap|xml)$/i.test(entry)) {
          results.push(relative(baseDir, full).replace(/\\/g, '/'));
        }
      } catch (e) {
        console.warn(`Failed to process file ${full}:`, e instanceof Error ? e.message : e);
      }
    }
  }
  walk(baseDir, 0);
  return results;
}

class DitaCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] | undefined {
    const text = document.getText();
    const offset = document.offsetAt(position);
    const ctx = getCompletionContext(text, offset);
    if (ctx.kind === 'none') return undefined;

    if (ctx.kind === 'tag') {
      // "</" → offer the closing tag for the innermost unclosed element
      if (ctx.closing) {
        const ltOffset = offset - (ctx.prefix?.length || 0) - 2;
        const open = findUnclosedTag(text.substring(0, Math.max(ltOffset, 0)));
        if (!open) return undefined;
        const item = new vscode.CompletionItem(`/${open}`, vscode.CompletionItemKind.Class);
        item.insertText = `${open}>`;
        item.range = new vscode.Range(document.positionAt(offset - (ctx.prefix?.length || 0)), position);
        return [item];
      }
      const tagMap = isMapDocument(document) ? MAP_STANDARD_TAG_TO_BASETYPE : STANDARD_TAG_TO_BASETYPE;
      return Object.keys(tagMap).map((tag) => {
        const item = new vscode.CompletionItem(tag, vscode.CompletionItemKind.Class);
        item.detail = tagMap[tag];
        // Only the name is inserted (attributes may follow); the closing tag
        // is added by the auto-close handler the moment '>' is typed
        return item;
      });
    }

    if (ctx.kind === 'attrName') {
      return getAttributesForTag(ctx.tagName).map((attr) => {
        const item = new vscode.CompletionItem(attr, vscode.CompletionItemKind.Property);
        item.insertText = new vscode.SnippetString(`${attr}="$1"`);
        return item;
      });
    }

    // attrValue
    if (ctx.attrName === 'keyref' || ctx.attrName === 'conkeyref' || ctx.attrName === 'keys') {
      if (ctx.attrName === 'keys') return undefined; // keys defines, not references
      const keyMap = buildKeyMap(document.uri);
      const items: vscode.CompletionItem[] = [];
      for (const [key, value] of keyMap) {
        const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Constant);
        item.detail = value !== key ? value : undefined;
        items.push(item);
      }
      return items.length > 0 ? items : undefined;
    }

    if (ctx.attrName === 'href' || ctx.attrName === 'conref') {
      const docDir = dirname(document.uri.fsPath);
      const prefix = ctx.prefix || '';
      const hashIdx = prefix.indexOf('#');
      if (hashIdx >= 0) {
        // After '#': suggest ids from the target file (or this file when empty)
        const filePart = prefix.substring(0, hashIdx);
        const targetPath = filePart ? resolve(docDir, decodeHrefPart(filePart)) : document.uri.fsPath;
        let targetText: string;
        try {
          targetText = filePart ? readFileSync(targetPath, 'utf-8') : text;
        } catch {
          return undefined;
        }
        const fragTyped = prefix.substring(hashIdx + 1);
        const replaceFrom = (ctx.valueStart || offset) + hashIdx + 1 + fragTyped.lastIndexOf('/') + 1;
        return collectIds(targetText).map((id) => {
          const item = new vscode.CompletionItem(id, vscode.CompletionItemKind.Reference);
          item.range = new vscode.Range(document.positionAt(replaceFrom), position);
          return item;
        });
      }
      return listReferenceableFiles(docDir).map((rel) => {
        const item = new vscode.CompletionItem(rel, vscode.CompletionItemKind.File);
        if (ctx.valueStart !== undefined) {
          item.range = new vscode.Range(document.positionAt(ctx.valueStart), position);
        }
        return item;
      });
    }

    // A few enum-valued attributes worth offering
    if (ctx.attrName === 'type' && ctx.tagName === 'note') {
      return ['note', 'tip', 'important', 'caution', 'warning', 'danger', 'attention', 'remember', 'restriction'].map(
        (v) => new vscode.CompletionItem(v, vscode.CompletionItemKind.EnumMember),
      );
    }
    if (ctx.attrName === 'scope') {
      return ['local', 'peer', 'external'].map(
        (v) => new vscode.CompletionItem(v, vscode.CompletionItemKind.EnumMember),
      );
    }
    if (ctx.attrName === 'format') {
      return ['dita', 'ditamap', 'html', 'pdf'].map(
        (v) => new vscode.CompletionItem(v, vscode.CompletionItemKind.EnumMember),
      );
    }
    return undefined;
  }
}

// ── Document symbol provider ──

const SYMBOL_KINDS: Record<DocSymbolSpec['kind'], vscode.SymbolKind> = {
  topic: vscode.SymbolKind.Class,
  section: vscode.SymbolKind.String,
  ref: vscode.SymbolKind.File,
  head: vscode.SymbolKind.Namespace,
  structural: vscode.SymbolKind.Package,
  keydef: vscode.SymbolKind.Key,
};

class DitaDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] | undefined {
    try {
      const xml = preprocessEntities(document.getText());
      const isMap = isMapDocument(document);
      const doc = isMap ? parseDitamap(xml) : parseDita(xml);
      const specs = isMap ? collectMapSymbols(doc.root, formatLocalizedRole) : collectTopicSymbols(doc.root);
      const maxLine = Math.max(0, document.lineCount - 1);

      const toSymbol = (spec: DocSymbolSpec): vscode.DocumentSymbol => {
        const startLine = Math.min(Math.max(spec.range.startLine, 0), maxLine);
        const endLine = Math.min(Math.max(spec.range.endLine, startLine), maxLine);
        const range = new vscode.Range(
          new vscode.Position(startLine, 0),
          document.lineAt(endLine).range.end,
        );
        const symbol = new vscode.DocumentSymbol(
          spec.name,
          spec.detail || '',
          SYMBOL_KINDS[spec.kind],
          range,
          new vscode.Range(new vscode.Position(startLine, 0), new vscode.Position(startLine, 0)),
        );
        symbol.children = spec.children.map(toSymbol);
        return symbol;
      };
      return specs.map(toSymbol);
    } catch {
      // Malformed XML while typing — outline simply stays empty
      return undefined;
    }
  }
}

// ── Broken reference diagnostics ──

const DEBOUNCE_MS = 700;

function validateDocument(document: vscode.TextDocument, collection: vscode.DiagnosticCollection): void {
  if (!vscode.languages.match(DITA_SELECTOR, document)) return;
  const text = document.getText();
  const docDir = dirname(document.uri.fsPath);
  const diagnostics: vscode.Diagnostic[] = [];

  let keySpace: Map<string, string> | undefined;
  const getKeySpace = () => {
    if (!keySpace) keySpace = buildKeyMap(document.uri);
    return keySpace;
  };

  for (const entry of collectRefEntries(text)) {
    if (!entry.value) continue;
    const range = new vscode.Range(
      document.positionAt(entry.valueStart),
      document.positionAt(entry.valueEnd),
    );

    if (entry.attr === 'keyref' || entry.attr === 'conkeyref') {
      const key = entry.value.split('/')[0];
      if (key && !getKeySpace().has(key)) {
        const d = new vscode.Diagnostic(
          range,
          vscode.l10n.t('Key "{0}" is not defined in any DITA map.', key),
          vscode.DiagnosticSeverity.Warning,
        );
        d.source = 'dita';
        d.code = 'undefined-key';
        diagnostics.push(d);
      }
      continue;
    }

    // href / conref
    if (isExternalRef(entry.value, entry.scope)) continue;
    const hashIdx = entry.value.indexOf('#');
    const filePart = hashIdx >= 0 ? entry.value.substring(0, hashIdx) : entry.value;
    const fragment = hashIdx >= 0 ? entry.value.substring(hashIdx + 1) : '';

    const targetPath = filePart ? resolve(docDir, decodeHrefPart(filePart)) : document.uri.fsPath;
    if (!existsSync(targetPath)) {
      const d = new vscode.Diagnostic(
        range,
        vscode.l10n.t('Referenced file not found: {0}', filePart),
        vscode.DiagnosticSeverity.Error,
      );
      d.source = 'dita';
      d.code = 'missing-file';
      diagnostics.push(d);
      continue;
    }

    if (fragment && /\.(dita|xml)$/i.test(filePart || document.uri.fsPath)) {
      let targetText: string;
      try {
        targetText = filePart ? readFileSync(targetPath, 'utf-8') : text;
      } catch {
        continue;
      }
      if (findConrefTargetOffset(targetText, fragment) < 0) {
        const d = new vscode.Diagnostic(
          range,
          vscode.l10n.t('Target id "{0}" not found in {1}.', fragment, filePart || vscode.l10n.t('this file')),
          vscode.DiagnosticSeverity.Warning,
        );
        d.source = 'dita';
        d.code = 'missing-id';
        diagnostics.push(d);
      }
    }
  }

  collection.set(document.uri, diagnostics);
}

// ── Tag auto-closing (mirrors VS Code's built-in HTML behaviour) ──

function registerAutoCloseTag(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document !== e.document) return;
      if (!vscode.languages.match(DITA_SELECTOR, e.document)) return;
      if (e.contentChanges.length !== 1) return;
      const change = e.contentChanges[0];
      if (change.text !== '>' && change.text !== '/') return;

      const text = e.document.getText();
      const offset = e.document.offsetAt(change.range.start) + change.text.length;

      if (change.text === '>') {
        // "<note>" just completed → insert "</note>" and keep the cursor inside
        const tag = getAutoCloseTag(text, offset);
        if (!tag || text.startsWith(`</${tag}>`, offset)) return;
        editor.insertSnippet(new vscode.SnippetString(`$0</${tag}>`), e.document.positionAt(offset));
      } else {
        // "</" just typed → complete the innermost unclosed tag
        const tag = getCloseTagCompletion(text, offset);
        if (!tag || text.startsWith(`${tag}>`, offset)) return;
        editor.insertSnippet(new vscode.SnippetString(`${tag}>`), e.document.positionAt(offset));
      }
    }),
  );
}

// ── Registration ──

export function registerLanguageFeatures(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(DITA_SELECTOR, new DitaDefinitionProvider()),
    vscode.languages.registerCompletionItemProvider(
      DITA_SELECTOR,
      new DitaCompletionProvider(),
      '<',
      '"',
      ' ',
      '#',
    ),
    vscode.languages.registerDocumentSymbolProvider(DITA_SELECTOR, new DitaDocumentSymbolProvider()),
  );

  registerAutoCloseTag(context);

  const collection = vscode.languages.createDiagnosticCollection('dita');
  context.subscriptions.push(collection);

  const timers = new Map<string, NodeJS.Timeout>();
  const scheduleValidation = (document: vscode.TextDocument) => {
    if (!vscode.languages.match(DITA_SELECTOR, document)) return;
    const key = document.uri.toString();
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        validateDocument(document, collection);
      }, DEBOUNCE_MS),
    );
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((d) => validateDocument(d, collection)),
    vscode.workspace.onDidSaveTextDocument((d) => validateDocument(d, collection)),
    vscode.workspace.onDidChangeTextDocument((e) => scheduleValidation(e.document)),
    vscode.workspace.onDidCloseTextDocument((d) => {
      const key = d.uri.toString();
      const timer = timers.get(key);
      if (timer) {
        clearTimeout(timer);
        timers.delete(key);
      }
      collection.delete(d.uri);
    }),
    { dispose: () => timers.forEach((t) => clearTimeout(t)) },
  );

  // Validate whatever is already open at activation time
  for (const doc of vscode.workspace.textDocuments) {
    validateDocument(doc, collection);
  }
}
