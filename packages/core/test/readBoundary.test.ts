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

  // Neither "does not exist" nor "cannot be parsed" is true of a file the
  // boundary refused, and the author cannot fix either; say what it is.
  it('set: a file outside the boundary is reported as outside the workspace', () => {
    setReadRoots([join(base, 'ws')]);
    const diagnose = makeRefErrorResolver(join(base, 'ws'));
    assert.strictEqual(diagnose('../outside/out.dita#b/p'), DEFAULT_REF_ERROR_TEXTS.outsideWorkspace);
  });

  it('set: a file that is really missing is still reported as missing', () => {
    setReadRoots([join(base, 'ws')]);
    const diagnose = makeRefErrorResolver(join(base, 'ws'));
    assert.strictEqual(diagnose('../outside/nope.dita#b/p'), DEFAULT_REF_ERROR_TEXTS.missingFile);
    assert.strictEqual(diagnose('nope.dita#b/p'), DEFAULT_REF_ERROR_TEXTS.missingFile);
  });

  it('a host that supplies no outsideWorkspace text still gets the English default', () => {
    setReadRoots([join(base, 'ws')]);
    const { outsideWorkspace: _omit, ...older } = DEFAULT_REF_ERROR_TEXTS;
    void _omit;
    const diagnose = makeRefErrorResolver(join(base, 'ws'), undefined, undefined, older);
    assert.strictEqual(diagnose('../outside/out.dita#b/p'), 'target file is outside the workspace');
  });

  it('an empty list lifts the boundary', () => {
    setReadRoots([join(base, 'ws')]);
    setReadRoots([]);
    const r = makeConrefResolver(join(base, 'ws'));
    assert.ok(r('../outside/out.dita#b/p'));
  });
});
