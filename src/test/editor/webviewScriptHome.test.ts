import * as assert from 'assert';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// dist-test/test/editor -> repo root is three levels up.
const repoRoot = join(__dirname, '..', '..', '..');
const read = (rel: string): string => readFileSync(join(repoRoot, rel), 'utf8');

/**
 * The two previews' webview scripts used to be ~650 and ~570 line template
 * strings inside the providers, where every host-side edit scrolled past them
 * and the host/webview message spellings shared a file only by accident. They
 * live in webview/topicScript.ts and webview/mapScript.ts now, and the map's
 * message types in mapMessages.ts. These tests keep that split from decaying:
 * no script body creeping back into a provider, and one spelling per message.
 */
describe('webview scripts live outside the providers', () => {
  const cases = [
    { provider: 'src/editor/DitaViewerProvider.ts', script: 'src/editor/webview/topicScript.ts', fn: 'getWebviewScript' },
    { provider: 'src/editor/MapViewerProvider.ts', script: 'src/editor/webview/mapScript.ts', fn: 'getMapWebviewScript' },
  ];

  for (const { provider, script, fn } of cases) {
    it(`${script} exports ${fn}, and ${provider} only imports and calls it`, () => {
      assert.ok(existsSync(join(repoRoot, script)), `${script} is missing`);
      assert.ok(read(script).includes(`export function ${fn}(`), `${script} must export ${fn}`);
      const host = read(provider);
      assert.ok(host.includes(`import { ${fn} } from './webview/`), `${provider} must import ${fn}`);
      assert.ok(!host.includes(`function ${fn}(`), `${provider} must not define ${fn} itself`);
      // A script body is recognisable by its IIFE wrapper over the webview API.
      assert.ok(!host.includes('acquireVsCodeApi()'), `${provider} must not carry webview script text`);
    });
  }
});

describe('map message types have one home', () => {
  it('mapMessages.ts defines every MSG_* constant, each spelled once', () => {
    assert.ok(existsSync(join(repoRoot, 'src/editor/mapMessages.ts')), 'src/editor/mapMessages.ts is missing');
    const names = [...read('src/editor/mapMessages.ts').matchAll(/^export const (MSG_\w+) = '([^']+)';$/gm)];
    assert.ok(names.length >= 15, `expected the full set, found ${names.length}`);
    const values = names.map((m) => m[2]);
    assert.strictEqual(new Set(values).size, values.length, 'two constants share one spelling');
  });

  for (const file of ['src/editor/MapViewerProvider.ts', 'src/editor/webview/mapScript.ts']) {
    it(`${file} declares no MSG_* constant of its own`, () => {
      assert.ok(!/^const MSG_\w+ =/m.test(read(file)), 'a local MSG_* would fork the spelling');
    });
  }
});
