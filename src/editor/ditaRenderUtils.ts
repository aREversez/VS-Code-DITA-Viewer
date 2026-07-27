import { existsSync, readFileSync } from 'fs';
import { resolve, dirname, relative, isAbsolute } from 'path';
import { DitaNode } from '../parser/domTypes';
import { parseDita, parseDitamap, preprocessEntities } from '../parser/ditaParser';
import { renderDocument } from '../render/renderer';

// ── Text extraction ──

export function collectText(node: DitaNode): string {
  if (node.type === 'text') return node.text || '';
  return (node.children || []).map(collectText).join('');
}

// ── Title map (id → title text for xref) ──

export function buildTitleMap(root: DitaNode): Map<string, string> {
  const map = new Map<string, string>();
  function walk(node: DitaNode) {
    if (node.type === 'element') {
      const id = node.attributes?.id;
      if (id) {
        const titleChild = (node.children || []).find(
          (c) => c.type === 'element' && c.baseType === 'topic/title',
        );
        if (titleChild) {
          map.set(id, collectText(titleChild));
        }
      }
      for (const child of node.children || []) walk(child);
    }
  }
  walk(root);
  return map;
}

// ── Cross-file helpers (conref + title resolver share file cache) ──

export function makeFileCache(docDir: string) {
  const cache = new Map<string, DitaNode | undefined>();

  function loadFile(filePath: string): DitaNode | undefined {
    const absPath = resolve(docDir, filePath);
    if (cache.has(absPath)) return cache.get(absPath);
    if (!existsSync(absPath)) { cache.set(absPath, undefined); return undefined; }
    try {
      const content = readFileSync(absPath, 'utf-8');
      const doc = parseDita(preprocessEntities(content));
      cache.set(absPath, doc.root);
      return doc.root;
    } catch {
      cache.set(absPath, undefined);
      return undefined;
    }
  }

  function findElementById(root: DitaNode, targetId: string): DitaNode | undefined {
    if (root.attributes?.id === targetId) return root;
    for (const child of root.children || []) {
      const found = findElementById(child, targetId);
      if (found) return found;
    }
    return undefined;
  }

  function findTitleOfElement(root: DitaNode, elementId: string): string | undefined {
    const el = findElementById(root, elementId);
    if (!el) return undefined;
    const titleChild = (el.children || []).find(
      (c) => c.type === 'element' && c.baseType === 'topic/title',
    );
    if (!titleChild) return undefined;
    return collectText(titleChild);
  }

  return { loadFile, findElementById, findTitleOfElement };
}

export function makeConrefResolver(docDir: string): (conref: string) => string | undefined {
  const cache = makeFileCache(docDir);

  function extractText(node: DitaNode): string {
    let text = '';
    for (const child of node.children || []) {
      if (child.type === 'text') text += child.text || '';
      else text += extractText(child);
    }
    return text;
  }

  return (conref: string): string | undefined => {
    const hashIdx = conref.indexOf('#');
    if (hashIdx < 0) return undefined;
    const filePath = conref.substring(0, hashIdx);
    const idPart = conref.substring(hashIdx + 1);
    const parts = idPart.split('/');
    const elementId = parts.length > 1 ? parts[1] : parts[0];

    const root = cache.loadFile(filePath);
    if (!root) return undefined;
    const el = cache.findElementById(root, elementId);
    if (!el) return undefined;
    return extractText(el);
  };
}

export function makeFileTitleResolver(docDir: string): (href: string) => string | undefined {
  const cache = makeFileCache(docDir);

  return (href: string): string | undefined => {
    const hashIdx = href.indexOf('#');
    if (hashIdx < 0) return undefined;
    const filePath = href.substring(0, hashIdx);
    const idPart = href.substring(hashIdx + 1);
    const topicId = idPart.split('/')[0];

    const root = cache.loadFile(filePath);
    if (!root) return undefined;
    return cache.findTitleOfElement(root, topicId);
  };
}

// ── Default note labels ──

export const DEFAULT_NOTE_LABELS: Record<string, string> = {
  note: 'Note', notice: 'Notice', warning: 'Warning', danger: 'Danger',
  important: 'Important', tip: 'Tip', restriction: 'Restriction',
};

export const ZH_NOTE_LABELS: Record<string, string> = {
  note: '注', notice: '注意', warning: '警告', danger: '危险',
  important: '重要', tip: '提示', restriction: '限制',
};

export function detectNoteLabels(root: DitaNode): Record<string, string> {
  const lang = root.attributes?.['xml:lang'] || '';
  return lang.startsWith('zh') ? ZH_NOTE_LABELS : DEFAULT_NOTE_LABELS;
}

// ── Escaping (single source of truth for non-renderer code) ──

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Book rendering helpers (pure, no vscode dependency) ──

export function renderBookPlaceholder(displayName: string, depth: number): string {
  const level = Math.min(1 + depth, 6);
  return `<div class="book-entry book-entry--placeholder">
  <h${level} class="book-section-heading">${escapeAttr(displayName)}</h${level}>
</div>`;
}

export function renderBookError(displayName: string, errorMsg: string, depth: number): string {
  const level = Math.min(1 + depth, 6);
  return `<div class="book-entry book-entry--error">
  <h${level} class="book-entry-title">${escapeHtml(displayName)}</h${level}>
  <p class="book-error">${escapeHtml(errorMsg)}</p>
</div>`;
}

export function renderBookSkipMessage(href: string): string {
  return `<p class="book-skip">(Skipped: ${escapeHtml(href)} already included above)</p>`;
}

// ── Shared: render a single .dita file to an HTML fragment ──

export interface TopicRenderInput {
  filePath: string;
  keyMap: Map<string, string>;
  asWebviewUri: (relPath: string) => string;
  headingLevel: number;
}

export interface TopicRenderResult {
  html: string;
  title?: string;
  error?: string;
}

// ── Ditamap reference expansion ──
// Walks the map tree and inlines children from referenced .ditamap files
// so key-value pairs appear inline in tree/book view.

export type FileReader = (path: string, encoding: 'utf-8') => string;

const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

function isLocalHref(href: string, scope?: string): boolean {
  if (!href || href.startsWith('#')) return false;
  if (scope === 'external' || scope === 'peer') return false;
  if (URL_SCHEME_RE.test(href)) return false;
  if (isAbsolute(href)) return false;
  return true;
}

/** True when the node is a topicref/keydef/mapref pointing at another local .ditamap. */
export function isDitamapRef(node: DitaNode): boolean {
  if (node.type !== 'element') return false;
  const baseType = node.baseType;
  if (baseType !== 'map/topicref' && baseType !== 'map/keydef' && baseType !== 'map/mapref') return false;
  const href = node.attributes?.href;
  if (!href || !isLocalHref(href, node.attributes?.scope)) return false;
  const pathPart = href.split('#')[0].toLowerCase();
  return pathPart.endsWith('.ditamap') || node.attributes?.format === 'ditamap';
}

// Hrefs inside a referenced map are relative to that map's own folder.
// When its children are inlined into the root map's tree, rewrite them so
// they stay valid relative to the root map's folder — otherwise nested
// keydef maps, sub-map topics and navigation all resolve to wrong paths.
function rebaseHrefs(node: DitaNode, fromDir: string, toDir: string): void {
  if (node.type !== 'element') return;
  const href = node.attributes?.href;
  if (href && node.attributes && isLocalHref(href, node.attributes.scope)) {
    const hashIdx = href.indexOf('#');
    const pathPart = hashIdx >= 0 ? href.substring(0, hashIdx) : href;
    const fragment = hashIdx >= 0 ? href.substring(hashIdx) : '';
    if (pathPart) {
      const abs = resolve(fromDir, pathPart);
      node.attributes.href = relative(toDir, abs).replace(/\\/g, '/') + fragment;
    }
  }
  for (const child of node.children || []) rebaseHrefs(child, fromDir, toDir);
}

export function expandDitamapRefs(
  node: DitaNode,
  docDir: string,
  readFile: FileReader = readFileSync as unknown as FileReader,
  visited?: Set<string>,
): void {
  if (node.type !== 'element') return;

  if (isDitamapRef(node)) {
    const href = node.attributes!.href!;
    const targetPath = resolve(docDir, href.split('#')[0]);
    if (!visited) visited = new Set();
    if (visited.has(targetPath)) return;
    visited.add(targetPath);
    try {
      const content = readFile(targetPath, 'utf-8');
      const doc = parseDitamap(preprocessEntities(content));
      const refChildren = (doc.root.children || []).filter(
        (c) => c.type === 'element',
      );
      if (refChildren.length > 0) {
        const refDir = dirname(targetPath);
        if (refDir !== resolve(docDir)) {
          for (const rc of refChildren) rebaseHrefs(rc, refDir, docDir);
        }
        if (!node.children) node.children = [];
        node.children.push(...refChildren);
      }
    } catch {
      // file not found or parse error — skip silently
    }
  }

  for (const child of node.children || []) {
    expandDitamapRefs(child, docDir, readFile, visited);
  }
}

export function renderTopicToHtml(input: TopicRenderInput): TopicRenderResult {
  const { filePath, keyMap, asWebviewUri, headingLevel } = input;
  try {
    if (!existsSync(filePath)) {
      return { html: '', error: `File not found: ${filePath}` };
    }
    const rawXml = readFileSync(filePath, 'utf-8');
    const preprocessedXml = preprocessEntities(rawXml);
    const ditaDoc = parseDita(preprocessedXml);
    const titleMap = buildTitleMap(ditaDoc.root);
    const noteLabels = detectNoteLabels(ditaDoc.root);
    const docDir = dirname(filePath);

    const conrefResolver = makeConrefResolver(docDir);
    const fileTitleResolver = makeFileTitleResolver(docDir);

    const resolveTitle = (id: string): string | undefined => {
      const local = titleMap.get(id);
      if (local) return local;
      if (id.includes('#')) return fileTitleResolver(id);
      return undefined;
    };

    const html = renderDocument(ditaDoc.root, {
      headingLevel,
      asWebviewUri,
      documentDir: docDir,
      resolveTitle,
      resolveKey: (key: string) => keyMap.get(key),
      resolveConref: (conref: string) => conrefResolver(conref),
      noteLabels,
    });

    const titleNode = (ditaDoc.root.children || []).find(
      (c) => c.type === 'element' && c.baseType === 'topic/title',
    );
    const title = titleNode ? collectText(titleNode) : undefined;
    return { html, title };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { html: '', error: `Error rendering ${filePath}: ${message}` };
  }
}
