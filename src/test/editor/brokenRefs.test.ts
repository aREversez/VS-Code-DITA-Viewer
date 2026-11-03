import * as assert from 'assert';
import { FILE_REF_ATTRS, findBrokenRefs, refTargetOf } from '../../editor/brokenRefs';

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
