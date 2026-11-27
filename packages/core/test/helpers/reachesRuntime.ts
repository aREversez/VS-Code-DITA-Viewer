// Static call-graph analysis of core's own sources: which declarations can reach
// the ambient runtime (rt(), the runtime/path and runtime/fs wrappers, and every
// stateSlot accessor)?
//
// It is deliberately conservative. A function counts as reaching the runtime if
// anything it mentions does, whether or not the call happens on a given input,
// and an object of functions (BASE_TYPE_RENDERERS) reaches it if any member
// does. So "does not reach" is a guarantee, and "reaches" may be an
// over-estimate. The export classification (src/exportKinds.ts) is checked
// against it: nothing classified as pure may reach the runtime.

import * as path from 'path';
import * as ts from 'typescript';

export interface ReachResult {
  /** Export names of the entry file whose declaration can reach the runtime. */
  reaching: Set<string>;
  /** Export names of the entry file that do not. */
  notReaching: Set<string>;
}

const isUnit = (n: ts.Node): n is ts.FunctionDeclaration | ts.VariableDeclaration | ts.ClassDeclaration =>
  ts.isFunctionDeclaration(n) || ts.isVariableDeclaration(n) || ts.isClassDeclaration(n);

// TypeScript reports file names with forward slashes on every platform, so the
// prefixes compared against them must be posix too (path.join would give
// backslashes on Windows and every startsWith would fail).
const toPosix = (p: string) => p.replace(/\\/g, '/');

export function analyseRuntimeReach(coreRoot: string, entryRel: string): ReachResult {
  const cfgPath = path.join(coreRoot, 'tsconfig.json');
  const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, coreRoot);
  const srcRoot = toPosix(path.join(coreRoot, 'src')) + '/';
  const entry = toPosix(path.join(coreRoot, entryRel));
  const program = ts.createProgram({ rootNames: [entry, ...parsed.fileNames.filter((f) => f.startsWith(srcRoot))], options: { ...parsed.options, noEmit: true } });
  const checker = program.getTypeChecker();
  const inSrc = (f: ts.SourceFile) => f.fileName.startsWith(srcRoot) && !f.fileName.endsWith('.d.ts');
  const isRuntimeFile = (f: string) => f.startsWith(toPosix(path.join(coreRoot, 'src', 'runtime')) + '/') || f === toPosix(path.join(coreRoot, 'src', 'runtime.ts'));

  // The unit (top-level function / variable / class) a declaration belongs to.
  const unitOf = (decl: ts.Node): ts.Node | undefined => {
    let n: ts.Node | undefined = decl;
    let found: ts.Node | undefined;
    while (n && !ts.isSourceFile(n)) {
      if (isUnit(n) && ts.isSourceFile(n.parent) || (ts.isVariableDeclaration(n) && ts.isVariableDeclarationList(n.parent) && ts.isVariableStatement(n.parent.parent) && ts.isSourceFile(n.parent.parent.parent))) found = n;
      n = n.parent;
    }
    return found;
  };

  const edges = new Map<ts.Node, Set<ts.Node>>();
  const seeds = new Set<ts.Node>();
  const resolveDecl = (id: ts.Identifier): ts.Declaration | undefined => {
    let sym = checker.getSymbolAtLocation(id);
    if (!sym) return undefined;
    if (sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    return sym.valueDeclaration ?? sym.declarations?.[0];
  };

  for (const file of program.getSourceFiles().filter(inSrc)) {
    const visitUnit = (unit: ts.Node) => {
      const out = new Set<ts.Node>();
      edges.set(unit, out);
      const walk = (n: ts.Node) => {
        if (ts.isIdentifier(n)) {
          const decl = resolveDecl(n);
          if (decl) {
            const df = decl.getSourceFile();
            if (isRuntimeFile(df.fileName)) seeds.add(unit);
            else if (inSrc(df)) {
              const u = unitOf(decl);
              if (u && u !== unit) out.add(u);
            }
          }
        }
        ts.forEachChild(n, walk);
      };
      ts.forEachChild(unit, walk);
    };
    for (const st of file.statements) {
      if (isRuntimeFile(file.fileName)) continue;
      if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) visitUnit(st);
      else if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) visitUnit(d);
    }
  }

  // Everything that can reach a seed.
  const reaching = new Set<ts.Node>(seeds);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [u, outs] of edges) {
      if (reaching.has(u)) continue;
      for (const o of outs) if (reaching.has(o)) { reaching.add(u); changed = true; break; }
    }
  }

  const entrySf = program.getSourceFile(entry);
  if (!entrySf) throw new Error(`no such entry: ${entry}`);
  const entrySym = checker.getSymbolAtLocation(entrySf);
  const result: ReachResult = { reaching: new Set(), notReaching: new Set() };
  for (const exp of entrySym ? checker.getExportsOfModule(entrySym) : []) {
    let sym = exp;
    if (sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    // Types and interfaces have no run-time value.
    if (!(sym.flags & ts.SymbolFlags.Value)) continue;
    const decl = sym.valueDeclaration;
    const u = decl && unitOf(decl);
    (u && reaching.has(u) ? result.reaching : result.notReaching).add(exp.getName());
  }
  return result;
}
