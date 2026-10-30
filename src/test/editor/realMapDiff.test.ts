import * as assert from 'assert';
import { fileKind, summarizeRealMapDiff, SideFinding } from './realMapDiff';

const f = (file: string, category: string, problemID?: string): SideFinding => ({ file, category, problemID });

describe('real-map diff summary', () => {
  it('counts matches and lists each disagreement once, with the side that found it', () => {
    const s = summarizeRealMapDiff(
      [f('a/x.dita', 'missing-reference'), f('a/y.dita', 'undefined-key')],
      [f('a/x.dita', 'missing-reference', 'dmv.x'), f('a/z.dita', 'unreferenced-key', 'dmv.not.used.key.defs')],
    );
    assert.strictEqual(s.matched, 1);
    assert.strictEqual(s.extensionOnly, 1);
    assert.strictEqual(s.oxygenOnly, 1);
    assert.match(s.text, /undefined-key {2}extension only {2}x1/);
    assert.match(s.text, /unreferenced-key {2}Oxygen only {2}x1 {2}dmv\.not\.used\.key\.defs/);
  });

  it('matches a missing resource to the reference category Oxygen files it under', () => {
    const s = summarizeRealMapDiff(
      [f('a/power.dita', 'missing-resource')],
      [f('a/power.dita', 'missing-reference', 'dmv.file.not.found')],
    );
    assert.strictEqual(s.matched, 1);
    assert.strictEqual(s.extensionOnly, 0);
    assert.strictEqual(s.oxygenOnly, 0);
    assert.match(s.text, /\| missing-reference \| 1 \| 1 \| 1 \|/);
  });

  it('never writes a path, a file name or a folder into the shareable text', () => {
    const s = summarizeRealMapDiff(
      [f('secret-product/Projet Évasion.dita', 'undefined-key')],
      [f('secret-product/other-name.ditamap', 'missing-reference', 'dmv.ref')],
    );
    assert.doesNotMatch(s.text, /secret|Projet|other-name|Évasion/);
    assert.deepStrictEqual(Object.values(s.labels).sort(), ['secret-product/Projet Évasion.dita', 'secret-product/other-name.ditamap']);
  });

  it('keeps only the file extension, and only when it is a plain one', () => {
    assert.strictEqual(fileKind('a/b.DITA'), '.dita');
    assert.strictEqual(fileKind('a/readme'), '(none)');
    assert.strictEqual(fileKind('a/.hidden'), '(none)');
    assert.strictEqual(fileKind('a/x.my secret'), '(none)');
  });

  it('drops a problem id that is not a plain catalog constant', () => {
    const s = summarizeRealMapDiff([], [f('a.dita', 'validation', 'C:\\Users\\me\\x')]);
    assert.doesNotMatch(s.text, /Users/);
  });

  it('gives one label to a file that disagrees in two categories', () => {
    const s = summarizeRealMapDiff([f('a.dita', 'undefined-key'), f('a.dita', 'duplicate-key')], []);
    assert.deepStrictEqual(Object.keys(s.labels), ['F001']);
  });

  it('leaves excluded categories out of both sides', () => {
    const s = summarizeRealMapDiff([f('a.dita', 'profiling-preference')], [f('b.dita', 'profiling-preference')], ['profiling-preference']);
    assert.strictEqual(s.extensionOnly + s.oxygenOnly + s.matched, 0);
    assert.match(s.text, /left out of both sides: profiling-preference/);
  });
});
