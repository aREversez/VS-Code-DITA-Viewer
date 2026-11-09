import * as assert from 'assert';
import * as esbuild from 'esbuild';
import { rmSync } from 'fs';
import Module = require('module');
import { tmpdir } from 'os';
import { join, resolve } from 'path';

// What activate() registers, and in what order, with the vscode API replaced by a
// recording stub. extension.ts holds nearly every command, and its one very large piece
// (the DITA-OT transform command) has no automated test of its own, because running it
// needs a DITA-OT install; the e2e suite only checks that the command exists. This pins
// the part a refactor of activate() can break silently: which commands and output
// channels it creates, and that they come in the same order.
//
// The stub answers every property and call with another stub, records the calls that
// matter, and returns the argument it was given for l10n.t (so messages stay text).

type Log = { commands: string[]; channels: string[]; calls: string[] };

// API calls that register something with the host: providers, listeners, watchers, views.
const REGISTRATION = /^vscode\.(window|languages|workspace|commands)\.(register\w+|create\w+|on\w+)$/;

// Properties that code iterates or reads as plain data; everything else is a stub.
const PLAIN_VALUES: Record<string, unknown> = {
  'vscode.workspace.textDocuments': [],
  'vscode.workspace.workspaceFolders': undefined,
  'vscode.window.visibleTextEditors': [],
  'vscode.window.activeTextEditor': undefined,
};

function makeVscodeStub(log: Log): unknown {
  const answer = (path: string, prop: string | symbol): unknown => {
    if (prop === 'then') return undefined;
    if (typeof prop === 'string' && `${path}.${prop}` in PLAIN_VALUES) return PLAIN_VALUES[`${path}.${prop}`];
    if (prop === Symbol.toPrimitive) return () => path;
    if (typeof prop === 'symbol') return undefined;
    if (path === 'vscode.l10n' && prop === 't') return (m: unknown) => String(m);
    return make(`${path}.${prop}`);
  };
  const make = (path: string): unknown =>
    new Proxy(function () {}, {
      get: (_t, prop) => answer(path, prop),
      apply(_t, _this, args: unknown[]): object {
        const first = typeof args[0] === 'string' ? (args[0] as string) : '';
        if (path === 'vscode.commands.registerCommand') log.commands.push(first);
        if (path === 'vscode.window.createOutputChannel') log.channels.push(first);
        log.calls.push(path);
        return make(`${path}()`) as object;
      },
      construct(_t, args: unknown[]): object {
        log.calls.push(`new ${path}`);
        void args;
        return make(`${path}#`) as object;
      },
    });
  // esbuild's interop copies a required module's own keys onto a new object whose
  // prototype is the module's prototype. A stub with no own keys would copy nothing, so
  // its prototype answers every name instead and the copy still reads through to it.
  const everything = new Proxy(Object.create(null) as object, { get: (_t, prop) => answer('vscode', prop) });
  return new Proxy(function () {}, {
    get: (_t, prop) => (prop === '__esModule' ? true : answer('vscode', prop)),
    getPrototypeOf: () => everything,
  });
}

// The extension is not part of the unit-test compile (it imports vscode all over), so
// bundle it the way the real build does, with vscode left external, and load that.
async function activateWithStub(): Promise<Log> {
  const log: Log = { commands: [], channels: [], calls: [] };
  const stub = makeVscodeStub(log);
  const out = join(tmpdir(), `dita-activation-${process.pid}.cjs`);
  await esbuild.build({
    entryPoints: [resolve(__dirname, '..', '..', '..', 'src', 'extension.ts')],
    outfile: out,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    external: ['vscode'],
    logLevel: 'silent',
  });
  const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
  const realLoad = loader._load;
  loader._load = (request: string, ...rest: unknown[]) => (request === 'vscode' ? stub : realLoad.call(Module, request, ...rest));
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ext = require(out) as { activate: (c: unknown) => unknown };
    const context = {
      subscriptions: [] as unknown[],
      extensionPath: '/ext',
      extensionUri: { fsPath: '/ext' },
      globalState: { get: (_k: string, d?: unknown) => d, update: () => Promise.resolve(), keys: () => [] },
      workspaceState: { get: (_k: string, d?: unknown) => d, update: () => Promise.resolve() },
    };
    ext.activate(context);
  } finally {
    loader._load = realLoad;
    rmSync(out, { force: true });
  }
  return log;
}

describe('extension activation (vscode stubbed)', () => {
  let log: Log;
  before(async function () {
    this.timeout(30000);
    log = await activateWithStub();
  });

  it('registers the DITA-OT transform command and creates its output channel', () => {
    assert.ok(log.commands.includes('ditaViewer.transformWithDitaOt'), log.commands.join(', '));
    assert.ok(log.channels.includes('DITA-OT Transform'), log.channels.join(', '));
  });

  it('registers the same commands, in the same order, as the recorded run', () => {
    assert.deepStrictEqual(log.commands, EXPECTED_COMMANDS);
    assert.deepStrictEqual(log.channels, EXPECTED_CHANNELS);
  });

  it('makes the same registrations with the host, in the same order', () => {
    assert.deepStrictEqual(log.calls.filter((c) => REGISTRATION.test(c)), EXPECTED_REGISTRATIONS);
  });
});

// Recorded from activate() as it stood before the transform command moved to its own module.
const EXPECTED_COMMANDS: string[] = [
  'ditaViewer.selectContextMap',
  'ditaViewer.fixBrokenReferences',
  'ditaViewer.mapExplorer.refresh',
  'ditaViewer.mapExplorer.selectMap',
  'ditaViewer.mapExplorer.pin',
  'ditaViewer.mapExplorer.unpin',
  'ditaViewer.mapExplorer.expandAll',
  'ditaViewer.mapExplorer.collapseAll',
  'ditaViewer.mapExplorer.openWithOxygen',
  'ditaViewer.mapExplorer.revealInExplorer',
  'ditaViewer.mapExplorer.exportHtml',
  'ditaViewer.mapExplorer.copyHref',
  'ditaViewer.mapExplorer.copyTitle',
  'ditaViewer.mapExplorer.findUnreferenced',
  'ditaViewer.mapExplorer.validateCompleteness',
  'ditaViewer.findUnreferencedResources',
  'ditaViewer.clearMapCheckResults',
  'ditaViewer.validateMapCompleteness',
  'ditaViewer.exportHtml',
  'ditaViewer.compareWithGit',
  'ditaViewer.showRenderedDiffFromSource',
  'ditaViewer.openWithOxygen',
  'ditaViewer.findReferencingMaps',
  'ditaViewer.revealInMapExplorer',
  'ditaViewer.showRendered',
  'ditaViewer.showMapRendered',
  'ditaViewer.showSource',
  'ditaViewer.showMapSource',
  'ditaViewer.transformWithDitaOt',
];
const EXPECTED_CHANNELS: string[] = [
  'DITA-OT Transform',
];
const EXPECTED_REGISTRATIONS: string[] = [
  'vscode.workspace.onDidOpenTextDocument',
  'vscode.workspace.onDidChangeTextDocument',
  'vscode.workspace.onDidSaveTextDocument',
  'vscode.workspace.onDidCloseTextDocument',
  'vscode.window.createStatusBarItem',
  'vscode.window.onDidChangeActiveTextEditor',
  'vscode.commands.registerCommand',
  'vscode.languages.registerDefinitionProvider',
  'vscode.languages.registerReferenceProvider',
  'vscode.languages.registerCompletionItemProvider',
  'vscode.languages.registerDocumentSymbolProvider',
  'vscode.workspace.onDidChangeTextDocument',
  'vscode.languages.createDiagnosticCollection',
  'vscode.workspace.onDidOpenTextDocument',
  'vscode.workspace.onDidSaveTextDocument',
  'vscode.workspace.onDidChangeTextDocument',
  'vscode.workspace.onDidCloseTextDocument',
  'vscode.workspace.onWillRenameFiles',
  'vscode.workspace.onDidRenameFiles',
  'vscode.commands.registerCommand',
  'vscode.languages.registerCodeActionsProvider',
  'vscode.window.createTreeView',
  'vscode.commands.registerCommand',
  'vscode.commands.registerCommand',
  'vscode.commands.registerCommand',
  'vscode.commands.registerCommand',
  'vscode.commands.registerCommand',
  'vscode.commands.registerCommand',
  'vscode.commands.registerCommand',
  'vscode.commands.registerCommand',
  'vscode.commands.registerCommand',
  'vscode.commands.registerCommand',
  'vscode.commands.registerCommand',
  'vscode.commands.registerCommand',
  'vscode.commands.registerCommand',
  'vscode.window.onDidChangeActiveTextEditor',
  'vscode.workspace.onDidSaveTextDocument',
  'vscode.commands.registerCommand',
  'vscode.commands.registerCommand',
  'vscode.commands.registerCommand',
  'vscode.commands.registerCommand',
  'vscode.commands.registerCommand',
  'vscode.commands.registerCommand',
  'vscode.commands.registerTextEditorCommand',
  'vscode.commands.registerCommand',
  'vscode.commands.registerCommand',
  'vscode.commands.registerCommand',
  'vscode.window.registerCustomEditorProvider',
  'vscode.window.registerCustomEditorProvider',
  'vscode.commands.registerCommand',
  'vscode.commands.registerCommand',
  'vscode.commands.registerCommand',
  'vscode.commands.registerCommand',
  'vscode.window.createOutputChannel',
  'vscode.commands.registerCommand',
];
