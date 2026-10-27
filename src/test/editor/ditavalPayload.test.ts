import * as assert from 'assert';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readDitaval } from '../../editor/ditavalPayload';

describe('readDitaval', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dita-ditaval-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (name: string, text: string): string => {
    const p = join(dir, name);
    writeFileSync(p, text, 'utf8');
    return p;
  };

  it('reads the rules in document order, with the attribute-wide default having no val', () => {
    const p = write(
      'release.ditaval',
      '<val><prop att="audience" val="admin" action="exclude"/><prop att="platform" action="exclude"/><prop att="platform" val="linux" action="include"/></val>',
    );
    assert.deepStrictEqual(readDitaval(p), {
      path: p,
      name: 'release.ditaval',
      rules: [
        { att: 'audience', val: 'admin', action: 'exclude' },
        { att: 'platform', action: 'exclude' },
        { att: 'platform', val: 'linux', action: 'include' },
      ],
    });
  });

  it('is JSON-safe: a rule with no val carries no val key at all', () => {
    const p = write('a.ditaval', '<val><prop att="platform" action="exclude"/></val>');
    assert.strictEqual(JSON.stringify(readDitaval(p).rules), '[{"att":"platform","action":"exclude"}]');
  });

  it('reads a file that starts with a byte-order mark', () => {
    const p = write('bom.ditaval', '﻿<?xml version="1.0"?><val><prop att="audience" val="a" action="exclude"/></val>');
    const read = readDitaval(p);
    assert.strictEqual(read.problem, undefined);
    assert.strictEqual(read.rules.length, 1);
  });

  it('reports a file that does not exist, with no rules', () => {
    const read = readDitaval(join(dir, 'nope.ditaval'));
    assert.deepStrictEqual(read.problem, { kind: 'missing' });
    assert.deepStrictEqual(read.rules, []);
    assert.strictEqual(read.name, 'nope.ditaval');
  });

  it('reports a path that cannot be read as a file', () => {
    // A directory opens but cannot be read as text.
    const read = readDitaval(dir);
    assert.strictEqual(read.problem?.kind, 'unreadable');
    assert.deepStrictEqual(read.rules, []);
  });

  it('applies nothing from a file that is not well-formed, even the rules before the break', () => {
    const p = write('bad.ditaval', '<val><prop att="audience" val="admin" action="exclude"/><prop att="x"');
    const read = readDitaval(p);
    assert.strictEqual(read.problem?.kind, 'malformed');
    assert.ok((read.problem as { detail: string }).detail.length > 0);
    assert.deepStrictEqual(read.rules, [], 'a half-read filter would hide a half-chosen set');
  });

  it('skips a <prop> that has no att or an unknown action', () => {
    const p = write('odd.ditaval', '<val><prop val="a" action="exclude"/><prop att="audience" val="a" action="remove"/><prop att="audience" val="b" action="exclude"/></val>');
    assert.deepStrictEqual(readDitaval(p).rules, [{ att: 'audience', val: 'b', action: 'exclude' }]);
  });
});
