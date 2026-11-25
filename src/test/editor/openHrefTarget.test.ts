import * as assert from 'assert';
import { resolve } from 'path';
import { openHrefTarget } from '../../editor/openHrefTarget';

// A stand-in for the vscode API: it records what would have been opened. The
// function takes the API as an argument precisely so this is possible.
function fakeVscode(folders: string[] = [resolve('/docs')]) {
  const calls: string[] = [];
  const api = {
    Uri: {
      parse: (s: string) => ({ kind: 'parse', value: s }),
      file: (s: string) => ({ kind: 'file', value: s }),
    },
    env: {
      openExternal: (uri: { kind: string; value: string }) => {
        calls.push(`external ${uri.kind}:${uri.value}`);
        return Promise.resolve(true);
      },
    },
    commands: {
      executeCommand: (cmd: string, uri: { value: string }, viewType?: string) => {
        calls.push(viewType ? `${cmd} ${uri.value} ${viewType}` : `${cmd} ${uri.value}`);
        return Promise.resolve();
      },
    },
    workspace: { workspaceFolders: folders.map((f) => ({ uri: { fsPath: f } })) },
    window: {
      showWarningMessage: (m: string) => {
        calls.push(`warn ${m}`);
        return Promise.resolve(undefined);
      },
    },
    l10n: { t: (m: string, ...a: string[]) => m.replace(/\{(\d)\}/g, (_x, i) => a[Number(i)]) },
  };
  return { api: api as unknown as typeof import('vscode'), calls };
}

describe('openHrefTarget', () => {
  const base = resolve('/docs/topics');

  it('sends http(s) URLs to the system handler', () => {
    const { api, calls } = fakeVscode();
    openHrefTarget(api, 'https://example.com/a', base);
    openHrefTarget(api, 'HTTP://example.com/b', base);
    assert.deepStrictEqual(calls, ['external parse:https://example.com/a', 'external parse:HTTP://example.com/b']);
  });

  it('opens a .ditamap in the map preview and .dita / .xml in the topic preview', () => {
    const { api, calls } = fakeVscode();
    openHrefTarget(api, '../maps/book.ditamap', base);
    openHrefTarget(api, 'other.dita', base);
    openHrefTarget(api, 'data.XML', base);
    assert.deepStrictEqual(calls, [
      `vscode.openWith ${resolve(base, '../maps/book.ditamap')} ditaViewer.mapPreview`,
      `vscode.openWith ${resolve(base, 'other.dita')} ditaViewer.preview`,
      `vscode.openWith ${resolve(base, 'data.XML')} ditaViewer.preview`,
    ]);
  });

  it('ignores the #fragment and decodes the path before resolving it', () => {
    const { api, calls } = fakeVscode();
    openHrefTarget(api, 'my%20topic.dita#id/child', base);
    assert.deepStrictEqual(calls, [`vscode.openWith ${resolve(base, 'my topic.dita')} ditaViewer.preview`]);
  });

  it('hands a display-safe file (pdf, raster images, text) to the system handler', () => {
    const { api, calls } = fakeVscode();
    for (const f of ['guide.pdf', 'pic.PNG', 'notes.txt', 'README.md']) openHrefTarget(api, f, base);
    assert.deepStrictEqual(
      calls,
      ['guide.pdf', 'pic.PNG', 'notes.txt', 'README.md'].map((f) => `external file:${resolve(base, f)}`),
    );
  });

  // One click on a hotspot must not be able to run a program: anything that is
  // not display-safe is revealed in the file manager, never openExternal'd.
  it('reveals, and never executes, a file type the OS would run or a browser would script', () => {
    const { api, calls } = fakeVscode();
    for (const f of ['tool.exe', 'run.bat', 'x.lnk', 'script.sh', 'noext', 'page.html', 'old.HTM', 'logo.svg']) {
      openHrefTarget(api, f, base);
    }
    assert.deepStrictEqual(
      calls,
      ['tool.exe', 'run.bat', 'x.lnk', 'script.sh', 'noext', 'page.html', 'old.HTM', 'logo.svg'].map((f) => `revealFileInOS ${resolve(base, f)}`),
    );
  });

  it('refuses a target outside the workspace, for every branch, with a warning', () => {
    const { api, calls } = fakeVscode();
    for (const href of ['../../secret.pdf', '../../x.dita', '../../m.ditamap', '../../tool.exe', '/etc/hosts']) {
      openHrefTarget(api, href, base);
    }
    assert.strictEqual(calls.length, 5);
    assert.ok(calls.every((c) => c.startsWith('warn Not opened: ') && c.endsWith('is outside the workspace.')), calls.join('\n'));
  });

  it('with no workspace folder, the document folder is the boundary', () => {
    const { api, calls } = fakeVscode([]);
    openHrefTarget(api, 'sub/a.dita', base);
    openHrefTarget(api, '../a.dita', base);
    assert.strictEqual(calls.length, 2);
    assert.ok(calls[0].startsWith('vscode.openWith'), calls[0]);
    assert.ok(calls[1].startsWith('warn '), calls[1]);
  });

  it('does nothing for an empty href, a same-page anchor or only a fragment', () => {
    const { api, calls } = fakeVscode();
    for (const href of ['', '   ', '#top', '#']) openHrefTarget(api, href, base);
    assert.deepStrictEqual(calls, []);
  });
});
