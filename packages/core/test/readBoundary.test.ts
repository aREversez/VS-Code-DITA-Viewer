import * as assert from 'assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { setReadRoots } from '../src/pathContainment';
import { makeConrefResolver, makeRefErrorResolver } from '../src/editor/refResolvers';
import { DEFAULT_REF_ERROR_TEXTS } from '../src/render/refErrorTexts';

describe('read boundary on the reference resolvers', () => {
  let base: string;
  before(() => {
    base = mkdtempSync(join(tmpdir(), 'readroots-'));
    mkdirSync(join(base, 'ws'));
    mkdirSync(join(base, 'outside'));
    writeFileSync(join(base, 'ws', 'in.dita'), '<topic id="a"><title>A</title><body><p id="p">inside</p></body></topic>');
    writeFileSync(join(base, 'outside', 'out.dita'), '<topic id="b"><title>B</title><body><p id="p">outside</p></body></topic>');
  });
  afterEach(() => setReadRoots(undefined));
  after(() => rmSync(base, { recursive: true, force: true }));

  it('unset: a conref that leaves the folder still resolves (hosts without a workspace)', () => {
    const r = makeConrefResolver(join(base, 'ws'));
    assert.ok(r('../outside/out.dita#b/p'));
  });

  it('set: the same conref resolves to nothing, an in-boundary one still works', () => {
    setReadRoots([join(base, 'ws')]);
    const r = makeConrefResolver(join(base, 'ws'));
    assert.strictEqual(r('../outside/out.dita#b/p'), undefined);
    assert.ok(r('in.dita#a/p'));
  });

  it('set: an outside target is reported as a missing file, not a parse error', () => {
    setReadRoots([join(base, 'ws')]);
    const diagnose = makeRefErrorResolver(join(base, 'ws'));
    assert.strictEqual(diagnose('../outside/out.dita#b/p'), DEFAULT_REF_ERROR_TEXTS.missingFile);
  });

  it('an empty list lifts the boundary', () => {
    setReadRoots([join(base, 'ws')]);
    setReadRoots([]);
    const r = makeConrefResolver(join(base, 'ws'));
    assert.ok(r('../outside/out.dita#b/p'));
  });
});
