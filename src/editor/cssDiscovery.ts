// ── CSS file discovery ──
//
// Extracted verbatim from DitaViewerProvider.ts (which had grown to ~1700
// lines) as a self-contained cluster: nothing outside this file calls
// findCustomCssDir/resolveCssFilePath/resolveDirectoryPath, and
// discoverCssFiles() itself is only ever called from
// DitaViewerProvider.ts's own resolveCustomTextEditor(). No behavior
// change -- see the patch that introduced this file for the byte-for-byte
// diff against the code's previous location.

import * as vscode from 'vscode';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { dirname, isAbsolute, join, resolve, basename } from 'path';
import { parseDocRoot } from './docPaths';

export function discoverCssFiles(docUri: vscode.Uri): { files: Record<string, string>; defaultName: string } {
  const files: Record<string, string> = {};
  const loadedNames = new Set<string>();

  const addFile = (filePath: string) => {
    const name = basename(filePath);
    if (!loadedNames.has(name) && existsSync(filePath)) {
      try {
        files[name] = readFileSync(filePath, 'utf-8');
        loadedNames.add(name);
      } catch (e) {
        console.warn(`Failed to load file ${filePath}:`, e instanceof Error ? e.message : e);
      }
    }
  };

  const docDir = dirname(docUri.fsPath);
  const root = parseDocRoot(docDir);
  const cssDir = findCustomCssDir(docDir);

  // Scan directories for .css files
  const scanDirs = new Set<string>();
  scanDirs.add(cssDir);
  if (root !== cssDir) scanDirs.add(root);
  // Add configured CSS directories
  try {
    const config = vscode.workspace.getConfiguration('dita-viewer');
    const cssDirConfigs: string[] | undefined = config.get('cssDirectory');
    if (cssDirConfigs) {
      for (const dir of cssDirConfigs) {
        const resolvedDir = resolveDirectoryPath(dir, docDir);
        if (resolvedDir && existsSync(resolvedDir) && !scanDirs.has(resolvedDir)) {
          scanDirs.add(resolvedDir);
        }
      }
    }
  } catch (e) {
    console.warn('Failed to read CSS directory configuration:', e instanceof Error ? e.message : e);
  }

  for (const sd of scanDirs) {
    try {
      for (const entry of readdirSync(sd)) {
        if (entry.toLowerCase().endsWith('.css')) addFile(join(sd, entry));
      }
    } catch (e) {
      console.warn(`Failed to read CSS directory ${sd}:`, e instanceof Error ? e.message : e);
    }
  }

  // Add explicitly configured CSS files
  try {
    const config = vscode.workspace.getConfiguration('dita-viewer');
    const paths: string[] | undefined = config.get('customCss');
    if (paths) {
      for (const p of paths) {
        const resolvedPath = resolveCssFilePath(p, docDir);
        if (resolvedPath) addFile(resolvedPath);
      }
    }
  } catch (e) {
    console.warn('Failed to read custom CSS configuration:', e instanceof Error ? e.message : e);
  }

  const defaultName = files['custom.css'] ? 'custom.css' : (Object.keys(files)[0] || '');
  return { files, defaultName };
}

function findCustomCssDir(docDir: string): string {
  const root = parseDocRoot(docDir);
  let dir = docDir;
  while (dir.length >= root.length) {
    if (existsSync(join(dir, 'custom.css'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return docDir;
}

function resolveCssFilePath(cssPath: string, docDir: string): string | undefined {
  if (isAbsolute(cssPath) && existsSync(cssPath)) {
    return cssPath;
  }
  const resolved = resolve(docDir, cssPath);
  if (existsSync(resolved)) return resolved;
  const folders = vscode.workspace.workspaceFolders;
  if (folders) {
    for (const f of folders) {
      const wsPath = resolve(f.uri.fsPath, cssPath);
      if (existsSync(wsPath)) return wsPath;
    }
  }
  return undefined;
}

function resolveDirectoryPath(dirPath: string, docDir: string): string | undefined {
  // Absolute path
  if (isAbsolute(dirPath)) {
    return existsSync(dirPath) ? dirPath : undefined;
  }
  // Relative to doc directory
  const fromDoc = resolve(docDir, dirPath);
  if (existsSync(fromDoc)) return fromDoc;
  // Relative to workspace root
  const folders = vscode.workspace.workspaceFolders;
  if (folders) {
    for (const f of folders) {
      const wsPath = resolve(f.uri.fsPath, dirPath);
      if (existsSync(wsPath)) return wsPath;
    }
  }
  return undefined;
}
