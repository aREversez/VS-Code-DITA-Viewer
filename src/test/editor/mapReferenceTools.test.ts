import * as assert from 'assert';
import { resolve } from 'path';
import {
  resolveLocalHrefPath,
  normalizePathForCompare,
  hrefMatchesTarget,
  computeUnreferencedFiles,
} from '../../editor/mapReferenceTools';

describe('resolveLocalHrefPath', () => {
  it('resolves a relative href against the map directory', () => {
    const abs = resolveLocalHrefPath('/repo/maps', 'topics/intro.dita');
    assert.strictEqual(abs, resolve('/repo/maps', 'topics/intro.dita'));
  });

  it('strips a fragment before resolving', () => {
    const abs = resolveLocalHrefPath('/repo/maps', 'topics/intro.dita#section2');
    assert.strictEqual(abs, resolve('/repo/maps', 'topics/intro.dita'));
  });

  it('returns undefined for an absolute URL', () => {
    assert.strictEqual(resolveLocalHrefPath('/repo/maps', 'https://example.com/x.dita'), undefined);
  });

  it('returns undefined for a mailto: href', () => {
    assert.strictEqual(resolveLocalHrefPath('/repo/maps', 'mailto:a@b.com'), undefined);
  });

  it('returns undefined for a bare fragment (internal cross-reference)', () => {
    assert.strictEqual(resolveLocalHrefPath('/repo/maps', '#section2'), undefined);
  });

  it('returns undefined for an empty/missing href', () => {
    assert.strictEqual(resolveLocalHrefPath('/repo/maps', undefined), undefined);
    assert.strictEqual(resolveLocalHrefPath('/repo/maps', ''), undefined);
  });

  it('decodes percent-escaped characters in the href', () => {
    const abs = resolveLocalHrefPath('/repo/maps', 'topics/intro%20page.dita');
    assert.strictEqual(abs, resolve('/repo/maps', 'topics/intro page.dita'));
  });
});

describe('normalizePathForCompare', () => {
  it('lowercases on win32 only', () => {
    assert.strictEqual(normalizePathForCompare('C:\\Repo\\Topic.dita', 'win32'), 'c:/repo/topic.dita');
    assert.strictEqual(normalizePathForCompare('/Repo/Topic.dita', 'linux'), '/Repo/Topic.dita');
    assert.strictEqual(normalizePathForCompare('/Repo/Topic.dita', 'darwin'), '/Repo/Topic.dita');
  });

  it('normalizes backslashes to forward slashes on every platform', () => {
    assert.strictEqual(normalizePathForCompare('a\\b\\c', 'linux'), 'a/b/c');
  });
});

describe('hrefMatchesTarget', () => {
  const target = resolve('/repo/maps', 'topics/intro.dita');

  it('matches when the href resolves to the target path', () => {
    assert.ok(hrefMatchesTarget('/repo/maps', 'topics/intro.dita', target, 'linux'));
  });

  it('matches case-insensitively on win32 but not on linux', () => {
    assert.ok(hrefMatchesTarget('/repo/maps', 'Topics/Intro.dita', target, 'win32'));
    assert.ok(!hrefMatchesTarget('/repo/maps', 'Topics/Intro.dita', target, 'linux'));
  });

  it('does not match an unrelated file', () => {
    assert.ok(!hrefMatchesTarget('/repo/maps', 'topics/other.dita', target, 'linux'));
  });

  it('does not match an external href', () => {
    assert.ok(!hrefMatchesTarget('/repo/maps', 'https://example.com/intro.dita', target, 'linux'));
  });
});

describe('computeUnreferencedFiles', () => {
  it('keeps only the candidates absent from the referenced set', () => {
    const result = computeUnreferencedFiles(
      ['/repo/topics/a.dita', '/repo/topics/b.dita', '/repo/topics/c.dita'],
      ['/repo/topics/b.dita'],
      'linux',
    );
    assert.deepStrictEqual(result, ['/repo/topics/a.dita', '/repo/topics/c.dita']);
  });

  it('is case-insensitive on win32', () => {
    const result = computeUnreferencedFiles(
      ['C:\\repo\\topics\\A.dita'],
      ['c:\\repo\\topics\\a.dita'],
      'win32',
    );
    assert.deepStrictEqual(result, []);
  });

  it('is case-sensitive on linux', () => {
    const result = computeUnreferencedFiles(
      ['/repo/topics/A.dita'],
      ['/repo/topics/a.dita'],
      'linux',
    );
    assert.deepStrictEqual(result, ['/repo/topics/A.dita']);
  });

  it('returns everything when nothing is referenced', () => {
    const result = computeUnreferencedFiles(['/a.dita', '/b.dita'], [], 'linux');
    assert.deepStrictEqual(result, ['/a.dita', '/b.dita']);
  });

  it('returns nothing when every candidate is referenced', () => {
    const result = computeUnreferencedFiles(['/a.dita'], ['/a.dita'], 'linux');
    assert.deepStrictEqual(result, []);
  });
});
