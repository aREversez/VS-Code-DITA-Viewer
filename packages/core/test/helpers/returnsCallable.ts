// Which exports of an entry file return something that carries a function?
//
// A function handed out of an engine call (a resolver, a render context) is
// called later, when the engine's runtime is no longer the active one. Core
// binds such functions to their runtime when it makes them (bindRuntime in
// src/runtime.ts), and this analysis finds every export that needs that, so a
// new one cannot be added without being noticed: test/closureEscape.test.ts
// compares its answer with the list of exports it exercises.
//
// It reads the declared return type, looking through properties, unions and
// type arguments (arrays, maps, promises) a few levels deep. Members of the
// built-in collection types are not "functions the export hands out", so types
// declared in the default library are only looked through, never listed.

import * as path from 'path';
import * as ts from 'typescript';

const MAX_DEPTH = 4;

export function analyseCallableReturns(coreRoot: string, entryRel: string): Set<string> {
  const cfg = ts.readConfigFile(path.join(coreRoot, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, coreRoot);
  // TypeScript reports file names with forward slashes on every platform, so
  // the prefix compared against them must be posix too.
  const srcRoot = path.join(coreRoot, 'src').replace(/\\/g, '/') + '/';
  const entry = path.join(coreRoot, entryRel);
  const program = ts.createProgram({ rootNames: [entry, ...parsed.fileNames.filter((f) => f.startsWith(srcRoot))], options: { ...parsed.options, noEmit: true } });
  const checker = program.getTypeChecker();
  const entrySf = program.getSourceFile(entry);
  if (!entrySf) throw new Error(`no such entry: ${entry}`);
  const entrySym = checker.getSymbolAtLocation(entrySf);

  const isLibType = (t: ts.Type): boolean => (t.symbol?.declarations ?? []).some((d) => program.isSourceFileDefaultLibrary(d.getSourceFile()));

  const carriesCallable = (type: ts.Type, seen: Set<ts.Type>, depth: number): boolean => {
    if (depth > MAX_DEPTH) return false;
    if (type.isUnionOrIntersection()) return type.types.some((t) => carriesCallable(t, seen, depth));
    if (type.getCallSignatures().length > 0) return true;
    if (seen.has(type)) return false;
    seen.add(type);
    let found = false;
    if (type.flags & ts.TypeFlags.Object && (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) {
      for (const arg of checker.getTypeArguments(type as ts.TypeReference)) found = carriesCallable(arg, seen, depth + 1) || found;
    }
    if (isLibType(type)) return found;
    if (type.flags & ts.TypeFlags.Object) {
      for (const prop of type.getProperties()) {
        const decl = prop.valueDeclaration ?? prop.declarations?.[0];
        found = carriesCallable(checker.getTypeOfSymbolAtLocation(prop, decl ?? entrySf), seen, depth + 1) || found;
      }
    }
    return found;
  };

  const result = new Set<string>();
  for (const exp of entrySym ? checker.getExportsOfModule(entrySym) : []) {
    let sym = exp;
    if (sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    const decl = sym.valueDeclaration;
    if (!(sym.flags & ts.SymbolFlags.Value) || !decl) continue;
    for (const sig of checker.getTypeOfSymbolAtLocation(sym, decl).getCallSignatures()) {
      if (carriesCallable(checker.getReturnTypeOfSignature(sig), new Set(), 0)) result.add(exp.getName());
    }
  }
  return result;
}
