import * as assert from 'assert';
import {
  BrokenRef,
  FILE_REF_ATTRS,
  FixProposal,
  buildFileIndex,
  findBrokenRefs,
  preselectedFixes,
  proposeFixes,
  refTargetOf,
  toRenames,
} from '../../editor/brokenRefs';
import { FileEdit, computeRefEdits } from '../../editor/refRenameEdits';

// One rule, two callers: the diagnostics in ditaLanguageFeatures.ts report what
// this finds, and "Fix Broken References…" repairs what this finds. Every
// exclusion below is a reference that must NOT be reported, because the repair
// command would then try to rewrite it.

const DOC = '/project/topics/a.dita';
const never = () => false;
const always = () => true;

function find(
  text: string,
  exists: (p: string) => boolean = never,
  platform: NodeJS.Platform = 'linux',
  path = DOC,
) {
  return findBrokenRefs({ file: { path, text }, exists, platform });
}

describe('brokenRefs — what counts as a broken reference', () => {
  it('reports an href whose file is not there, with the target it resolves to', () => {
    const hits = find('<topic><body><p><xref href="missing.dita"/></p></body></topic>');
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(hits[0].attr, 'href');
    assert.strictEqual(hits[0].filePart, 'missing.dita');
    assert.strictEqual(hits[0].fragment, '');
    assert.strictEqual(hits[0].targetPath, '/project/topics/missing.dita');
    assert.strictEqual(hits[0].file, DOC);
  });

  it('stays quiet when the file exists', () => {
    assert.deepStrictEqual(find('<xref href="there.dita"/>', always), []);
  });

  it('keeps the fragment apart from the path, and decodes the path it resolves', () => {
    const [hit] = find('<ph conref="my%20file.dita#t/x"/>');
    assert.strictEqual(hit.filePart, 'my%20file.dita');
    assert.strictEqual(hit.fragment, '#t/x');
    assert.strictEqual(hit.targetPath, '/project/topics/my file.dita');
    assert.strictEqual(hit.value, 'my%20file.dita#t/x');
  });

  it('reports an href relative to the file that holds it, not the workspace root', () => {
    const [hit] = find('<image href="../images/x.png"/>', never, 'linux', '/project/topics/sub/b.dita');
    assert.strictEqual(hit.targetPath, '/project/topics/images/x.png');
  });

  it('resolves a Windows path with the Windows flavour', () => {
    const [hit] = find('<image href="../images/x.png"/>', never, 'win32', 'C:\\work\\topics\\a.dita');
    assert.strictEqual(hit.targetPath, 'C:\\work\\images\\x.png');
  });

  it('reports conrefend, data and longdescref too — the attributes a rename follows', () => {
    const text =
      '<conrefend conrefend="end.dita"/><object data="clip.mp4"/><image longdescref="full.png"/>';
    const attrs = find(text).map((h) => h.attr);
    assert.deepStrictEqual(attrs, ['conrefend', 'data', 'longdescref']);
  });

  it('never reports copy-to: it names a file that will be generated', () => {
    assert.deepStrictEqual(find('<topicref href="a.dita" copy-to="generated/a.dita"/>', (p) => p.endsWith('a.dita')), []);
    assert.ok(!FILE_REF_ATTRS.has('copy-to'));
  });

  it('leaves a same-file reference, an external one and an entity-built one alone', () => {
    const text =
      '<xref href="#t/x"/>' +
      '<xref href="https://example.com/a.dita"/>' +
      '<xref href="sibling.dita" scope="external"/>' +
      '<xref href="sibling.dita" scope="peer"/>' +
      '<xref href="a&amp;b.dita"/>' +
      '<xref href=""/>';
    assert.deepStrictEqual(find(text), []);
  });

  it('does not look inside a comment, a CDATA section or a processing instruction', () => {
    const text =
      '<!-- <xref href="gone.dita"/> -->' +
      '<codeblock><![CDATA[<xref href="gone.dita"/>]]></codeblock>' +
      '<?pi href="gone.dita"?>' +
      '<xref href="gone.dita"/>';
    const hits = find(text);
    assert.strictEqual(hits.length, 1, 'only the live reference counts');
    assert.ok(text.slice(hits[0].valueStart, hits[0].valueEnd) === 'gone.dita');
  });

  it('points its offsets at the value inside the attribute', () => {
    const text = '<topicref\n  href="gone.dita"/>';
    const [hit] = find(text);
    assert.strictEqual(text.slice(hit.valueStart, hit.valueEnd), 'gone.dita');
  });
});

describe('brokenRefs — refTargetOf', () => {
  it('points a bare fragment at the file that holds it', () => {
    assert.deepStrictEqual(refTargetOf('#t/x', undefined, DOC, 'linux'), {
      filePart: '',
      fragment: '#t/x',
      targetPath: DOC,
    });
  });

  it('has no target for an empty or external value', () => {
    assert.strictEqual(refTargetOf('', undefined, DOC, 'linux'), undefined);
    assert.strictEqual(refTargetOf('https://example.com/x.dita', undefined, DOC, 'linux'), undefined);
    assert.strictEqual(refTargetOf('C:\\abs\\x.dita', undefined, DOC, 'win32'), undefined);
  });
});

// ── Planning ──

function brokenIn(file: string, text: string): BrokenRef[] {
  return findBrokenRefs({ file: { path: file, text }, exists: never, platform: 'linux' });
}

function plan(text: string, index: string[], file = '/ws/topics/a.dita', roots?: string[]) {
  return proposeFixes({
    broken: brokenIn(file, text),
    index: buildFileIndex(index, 'linux'),
    platform: 'linux',
    roots,
  });
}

/** Applies the edits computeRefEdits returns, so a test can read the result. */
function rewritten(files: Array<{ path: string; text: string }>, index: string[]): string[] {
  const broken = files.flatMap((f) => brokenIn(f.path, f.text));
  const fixPlan = proposeFixes({ broken, index: buildFileIndex(index, 'linux'), platform: 'linux' });
  const fileEdits = computeRefEdits({
    renames: toRenames(preselectedFixes(fixPlan)),
    files,
    platform: 'linux',
  });
  return files.map((f) => {
    const hit = fileEdits.find((e) => e.sourcePath === f.path);
    return !hit ? f.text : applyEdits(f.text, hit.edits);
  });
}

function applyEdits(text: string, edits: FileEdit['edits']): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.newText + out.slice(e.end);
  }
  return out;
}

/** The proposals ordered as the quick pick shows them. */
const kinds = (p: { proposals: FixProposal[] }) => p.proposals.map((x) => `${x.kind}:${x.target.fileName}`);

describe('brokenRefs — one file of that name, several, or none', () => {
  it('preselects the only file of that name', () => {
    const p = plan('<xref href="../old/intro.dita"/>', ['/ws/new/intro.dita']);
    assert.strictEqual(p.proposals.length, 1);
    assert.strictEqual(p.proposals[0].kind, 'unique');
    assert.strictEqual(p.proposals[0].preselect, '/ws/new/intro.dita');
    assert.deepStrictEqual(preselectedFixes(p), [
      { targetPath: '/ws/old/intro.dita', newPath: '/ws/new/intro.dita' },
    ]);
  });

  it('makes two files of that name a question, not a guess', () => {
    const p = plan('<xref href="../old/intro.dita"/>', ['/ws/new/intro.dita', '/ws/archive/intro.dita']);
    assert.strictEqual(p.proposals[0].kind, 'multiple');
    assert.strictEqual(p.proposals[0].preselect, undefined);
    assert.deepStrictEqual(preselectedFixes(p), []);
    assert.strictEqual(p.proposals[0].candidates.length, 2);
  });

  it('lists a file that differs in case only, without preselecting it', () => {
    const p = plan('<xref href="intro.dita"/>', ['/ws/topics/INTRO.dita']);
    assert.strictEqual(p.proposals[0].kind, 'case');
    assert.strictEqual(p.proposals[0].preselect, undefined);
    assert.deepStrictEqual(preselectedFixes(p), [], 'only a name that matches exactly is safe to apply silently');
  });

  it('does not offer a file whose extension differs', () => {
    const p = plan('<xref href="intro.dita"/>', ['/ws/topics/intro.ditamap']);
    assert.strictEqual(p.proposals[0].kind, 'none');
    assert.deepStrictEqual(p.proposals[0].candidates, []);
  });
});

describe('brokenRefs — one problem per missing target, not per reference', () => {
  it('counts 5 references in 3 files as one problem', () => {
    const broken = [
      ...brokenIn('/ws/a.dita', '<xref href="t/x.dita"/><xref href="t/x.dita"/>'),
      ...brokenIn('/ws/b.dita', '<xref href="t/x.dita"/><xref href="t/x.dita"/>'),
      ...brokenIn('/ws/c.dita', '<xref href="t/x.dita"/>'),
    ];
    const p = proposeFixes({ broken, index: buildFileIndex([], 'linux'), platform: 'linux' });
    assert.strictEqual(p.proposals.length, 1);
    assert.strictEqual(p.proposals[0].target.refs.length, 5);
    assert.strictEqual(p.proposals[0].target.files.length, 3);
  });
});

describe('brokenRefs — inferring a moved folder', () => {
  const three = '<xref href="old/one.dita"/><xref href="old/two.dita"/><xref href="old/three.dita"/>';

  it('groups three targets that all landed under one new directory', () => {
    const p = plan(three, [
      '/ws/topics/new/one.dita',
      '/ws/topics/new/two.dita',
      '/ws/topics/new/three.dita',
    ]);
    assert.strictEqual(p.moves.length, 1);
    assert.strictEqual(p.moves[0].targets, 3);
    assert.strictEqual(p.moves[0].references, 3);
    assert.strictEqual(p.moves[0].oldDir, '/ws/topics/old');
    assert.strictEqual(p.moves[0].newDir, '/ws/topics/new');
    assert.ok(p.proposals.every((x) => x.move === p.moves[0].key));
  });

  it('does not call one stranded target a folder move', () => {
    const p = plan('<xref href="old/one.dita"/>', ['/ws/topics/new/one.dita']);
    assert.deepStrictEqual(p.moves, []);
    assert.strictEqual(p.proposals[0].move, undefined);
  });

  it('ranks the move\u2019s own candidate first for a target it cannot decide, without preselecting it', () => {
    const p = plan(three, [
      '/ws/topics/new/one.dita',
      '/ws/topics/new/two.dita',
      '/ws/topics/new/three.dita',
      '/ws/elsewhere/three.dita',
    ]);
    const undecided = p.proposals.find((x) => x.kind === 'multiple');
    assert.ok(undecided, kinds(p).join(', '));
    assert.strictEqual(undecided.candidates[0].path, '/ws/topics/new/three.dita');
    assert.strictEqual(undecided.candidates[0].suggested, true);
    assert.strictEqual(undecided.preselect, undefined);
    assert.deepStrictEqual(
      preselectedFixes(p).map((f) => f.newPath).sort(),
      ['/ws/topics/new/one.dita', '/ws/topics/new/two.dita'],
      'the suggestion is a hint, not a decision',
    );
  });
});

describe('brokenRefs — ordering the candidates', () => {
  it('puts the candidate that shares more of the path\u2019s tail first', () => {
    const p = plan('<xref href="../z/docs/intro.dita"/>', [
      '/ws/y/other/intro.dita',
      '/ws/x/docs/intro.dita',
    ]);
    assert.deepStrictEqual(
      p.proposals[0].candidates.map((c) => c.path),
      ['/ws/x/docs/intro.dita', '/ws/y/other/intro.dita'],
    );
    assert.strictEqual(p.proposals[0].candidates[0].sharedTail, 1);
  });

  it('prefers the candidate in the same workspace folder when the tail is equal', () => {
    const p = proposeFixes({
      broken: brokenIn('/ws/a/t.dita', '<xref href="../z/intro.dita"/>'),
      index: buildFileIndex(['/other/a/intro.dita', '/ws/a/intro.dita'], 'linux'),
      platform: 'linux',
      roots: ['/ws/a'],
    });
    assert.deepStrictEqual(
      p.proposals[0].candidates.map((c) => c.path),
      ['/ws/a/intro.dita', '/other/a/intro.dita'],
    );
  });

  it('then prefers the candidate nearest the file that references it', () => {
    const p = proposeFixes({
      broken: brokenIn('/ws/x/t.dita', '<xref href="../z/deep/intro.dita"/>'),
      index: buildFileIndex(['/ws/y/intro.dita', '/ws/x/a/intro.dita'], 'linux'),
      platform: 'linux',
    });
    assert.deepStrictEqual(
      p.proposals[0].candidates.map((c) => c.path),
      ['/ws/x/a/intro.dita', '/ws/y/intro.dita'],
    );
  });
});

describe('brokenRefs — the rewrite is computeRefEdits\u2019s, so every rule comes along', () => {
  const map = '/ws/a/map.ditamap';

  it('keeps the fragment and the ./ prefix, in one edit per reference', () => {
    const text = '<map><topicref href="./old.dita"/><ph conref="old.dita#t/x"/></map>';
    assert.deepStrictEqual(rewritten([{ path: map, text }], ['/ws/a/sub/old.dita']), [
      '<map><topicref href="./sub/old.dita"/><ph conref="sub/old.dita#t/x"/></map>',
    ]);
  });

  it('keeps a percent-encoded reference encoded, and a raw one raw', () => {
    const encoded = '<map><topicref href="my%20file.dita"/></map>';
    assert.deepStrictEqual(rewritten([{ path: map, text: encoded }], ['/ws/b/my file.dita']), [
      '<map><topicref href="../b/my%20file.dita"/></map>',
    ]);
    const raw = '<map><topicref href="my file.dita"/></map>';
    assert.deepStrictEqual(
      rewritten([{ path: map, text: raw }], ['/ws/b/my file.dita']),
      ['<map><topicref href="../b/my%20file.dita"/></map>'],
      'a space in the new path is written as %20, never raw',
    );
  });

  it('escapes a # in the file name of the candidate', () => {
    const text = '<map><topicref href="b%231.dita"/></map>';
    assert.deepStrictEqual(rewritten([{ path: map, text }], ['/ws/b/b#1.dita']), [
      '<map><topicref href="../b/b%231.dita"/></map>',
    ]);
  });

  it('writes the relative path each referencing file needs', () => {
    const files = [
      { path: '/ws/a.dita', text: '<xref href="old/x.dita"/>' },
      { path: '/ws/sub/b.dita', text: '<xref href="../old/x.dita"/>' },
      { path: '/ws/sub/deep/c.dita', text: '<xref href="../../old/x.dita"/>' },
    ];
    assert.deepStrictEqual(rewritten(files, ['/ws/new/x.dita']), [
      '<xref href="new/x.dita"/>',
      '<xref href="../new/x.dita"/>',
      '<xref href="../../new/x.dita"/>',
    ]);
  });

  it('fixes two missing targets in one file without one disturbing the other', () => {
    const text = '<map><topicref href="old/a.dita"/><topicref href="old/b.dita"/></map>';
    assert.deepStrictEqual(rewritten([{ path: map, text }], ['/ws/a/new/a.dita', '/ws/a/new/b.dita']), [
      '<map><topicref href="new/a.dita"/><topicref href="new/b.dita"/></map>',
    ]);
  });

  it('applies a case-only fix as a real change of the written name', () => {
    const fileEdits = computeRefEdits({
      renames: toRenames([{ targetPath: '/ws/a/Intro.dita', newPath: '/ws/a/intro.dita' }]),
      files: [{ path: map, text: '<map><topicref href="Intro.dita"/></map>' }],
      platform: 'linux',
    });
    assert.strictEqual(applyEdits('<map><topicref href="Intro.dita"/></map>', fileEdits[0].edits), '<map><topicref href="intro.dita"/></map>');
  });
});
