import * as assert from 'assert';
import { resolve } from 'path';
import { openHrefTarget } from '../../editor/openHrefTarget';

// A stand-in for the vscode API: it records what would have been opened. The
// function takes the API as an argument precisely so this is possible.
function fakeVscode() {
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
      executeCommand: (cmd: string, uri: { value: string }, viewType: string) => {
        calls.push(`${cmd} ${uri.value} ${viewType}`);
        return Promise.resolve();
      },
    },
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

  it('hands any other file (html, pdf, images) to the system handler', () => {
    const { api, calls } = fakeVscode();
    openHrefTarget(api, 'guide.pdf', base);
    assert.deepStrictEqual(calls, [`external file:${resolve(base, 'guide.pdf')}`]);
  });

  it('does nothing for an empty href, a same-page anchor or only a fragment', () => {
    const { api, calls } = fakeVscode();
    for (const href of ['', '   ', '#top', '#']) openHrefTarget(api, href, base);
    assert.deepStrictEqual(calls, []);
  });
});
