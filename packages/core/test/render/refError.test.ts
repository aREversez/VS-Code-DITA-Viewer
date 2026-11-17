import * as assert from 'assert';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { renderDocument, RenderContext } from '../../src/render/renderer';
import { DEFAULT_REF_ERROR_TEXTS, RefErrorTexts, fillRefErrorTemplate } from '../../src/render/refErrorTexts';
import { makeFileCache, makeRefErrorResolver } from '../../src/editor/refResolvers';
import { buildRenderContext } from '../../src/editor/renderContext';
import { renderTopicCached, renderTopicXml, clearTopicRenderCache } from '../../src/editor/topicRender';
import { buildKeySpace } from '../../src/editor/keySpace';
import { parseDita } from '../../src/parser/ditaParser';
import { DitaNode, SourceRange } from '../../src/parser/domTypes';

/**
 * Broken-reference hints (RenderContext.refError): a conref that pulled
 * nothing renders as a placeholder chip, an EMPTY xref with a broken target
 * as a dashed marker -- instead of the silent-empty shapes a review cannot
 * see. The renderer only presents; the diagnosis is the host's callback and
 * the wording is the host's locale (refErrorTexts.ts). These tests pin both
 * presentations, the three diagnosis states of makeRefErrorResolver, the
 * opt-in wiring in buildRenderContext and the per-locale cache key of
 * renderTopicCached.
 */

function makeText(text: string): DitaNode {
  return { type: 'text', text, children: [], sourceRange: { startLine: 0, startCol: 0, endLine: 0, endCol: 0 } };
}

function makeEl(
  baseType: string,
  children: DitaNode[],
  attrs?: Record<string, string>,
  tagName?: string,
  sourceRange?: SourceRange,
): DitaNode {
  return {
    type: 'element',
    tagName: tagName || baseType.replace('topic/', ''),
    baseType,
    attributes: attrs,
    children,
    sourceRange: sourceRange || { startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
  };
}

const defaultCtx: RenderContext = {
  headingLevel: 1,
  asWebviewUri: (p: string) => `vscode-resource:${p}`,
  documentDir: '/test',
};

/** A topic whose single body child is the element under test. */
function topicWith(child: DitaNode): DitaNode {
  return makeEl('topic/topic', [makeEl('topic/body', [child])], { id: 't' });
}

const zhTexts: RefErrorTexts = {
  content: '引用内容无法解析（{0}）',
  xref: '→ {0}（{1}）',
  missingKey: '键未定义或没有资源目标',
  missingFile: '目标文件不存在',
  parseError: '目标文件 XML 解析失败',
  missingId: '目标 ID 不存在',
};

describe('fillRefErrorTemplate', () => {
  it('fills {0}/{1} placeholders', () => {
    assert.strictEqual(fillRefErrorTemplate('→ {0} ({1})', 'a.dita#t/p', 'gone'), '→ a.dita#t/p (gone)');
  });

  it('substitutes values verbatim -- $-patterns in an href must not be read', () => {
    assert.strictEqual(fillRefErrorTemplate('{0}', "$& $' $1"), "$& $' $1");
  });

  it('fills every occurrence of a placeholder', () => {
    assert.strictEqual(fillRefErrorTemplate('{0} and {0}', 'x'), 'x and x');
  });
});

describe('conref placeholder chip', () => {
  const conref = 'gone.dita#gone/step2';
  const range: SourceRange = { startLine: 7, startCol: 4, endLine: 7, endCol: 40 };
  const brokenP = makeEl('topic/p', [], { conref }, undefined, range);
  const brokenCtx: RenderContext = {
    ...defaultCtx,
    resolveConref: () => undefined,
    refError: () => DEFAULT_REF_ERROR_TEXTS.missingFile,
  };

  it('replaces the silent-empty element with a chip carrying reason, raw ref and source range', () => {
    const html = renderDocument(topicWith(brokenP), brokenCtx);
    assert.ok(html.includes('class="ref-error"'), `got: ${html}`);
    assert.ok(html.includes(`title="${conref}"`), 'tooltip carries the raw conref for copy-to-fix');
    assert.ok(html.includes('data-line="7" data-end-line="7" data-start-col="4" data-end-col="40"'), 'chip keeps click-to-source / diff highlighting');
    assert.ok(html.includes('Referenced content could not be resolved (target file does not exist)'), 'default English wording');
  });

  it('uses the host wording when refErrorTexts is supplied (zh full-width parentheses)', () => {
    const html = renderDocument(topicWith(brokenP), { ...brokenCtx, refErrorTexts: zhTexts, refError: () => zhTexts.missingFile });
    assert.ok(html.includes('引用内容无法解析（目标文件不存在）'), `got: ${html}`);
  });

  it('escapes the raw reference in the title attribute', () => {
    const nasty = 'a.dita#t/p"onmouseover="alert(1)';
    const html = renderDocument(topicWith(makeEl('topic/p', [], { conref: nasty })), { ...brokenCtx, refError: () => 'x' });
    assert.ok(!html.includes('onmouseover="alert'), 'attribute must stay escaped');
  });

  it('keeps the legacy bytes when refError is absent or reports nothing broken', () => {
    const plain = renderDocument(topicWith(brokenP), { ...defaultCtx, resolveConref: () => undefined });
    const silent = renderDocument(topicWith(brokenP), { ...defaultCtx, resolveConref: () => undefined, refError: () => undefined });
    assert.strictEqual(silent, plain, 'refError returning undefined changes nothing');
    assert.ok(!plain.includes('ref-error'));
  });

  it('never chips a conref cycle -- the loop renders its literal content', () => {
    const html = renderDocument(topicWith(makeEl('topic/p', [makeText('literal')], { conref: '#loop' })), {
      ...defaultCtx,
      resolveConref: () => undefined,
      refError: () => DEFAULT_REF_ERROR_TEXTS.missingFile,
      conrefChain: new Set(['#loop']),
    });
    assert.ok(!html.includes('ref-error'), 'a cycle is a different class of problem');
    assert.ok(html.includes('literal'));
  });

  it('chips a failed conrefend range via the single-conref fallback', () => {
    const node = makeEl('topic/p', [], { conref, conrefend: 'gone.dita#gone/step4' });
    const html = renderDocument(topicWith(node), { ...brokenCtx, resolveConrefRange: () => undefined });
    assert.ok(html.includes('class="ref-error"'), 'range failure falls through to the chip path');
  });

  it('does not chip when the conrefend range resolves', () => {
    const node = makeEl('topic/p', [], { conref, conrefend: 'gone.dita#gone/step4' });
    const ranged = makeEl('topic/p', [makeText('ranged content')], { id: 'step2' });
    const html = renderDocument(topicWith(node), { ...brokenCtx, resolveConrefRange: () => [ranged] });
    assert.ok(!html.includes('ref-error'));
    assert.ok(html.includes('ranged content'));
  });
});

describe('empty xref broken marker', () => {
  const href = 'gone.dita#gone/step2';
  const brokenCtx: RenderContext = { ...defaultCtx, refError: () => DEFAULT_REF_ERROR_TEXTS.missingFile };

  it('marks an empty xref with the dashed broken shape, href and reason', () => {
    const html = renderDocument(topicWith(makeEl('topic/xref', [], { href })), brokenCtx);
    assert.ok(html.includes('class="xref-broken"'), `got: ${html}`);
    assert.ok(html.includes(`title="${href}"`));
    assert.ok(html.includes(`→ ${href} (target file does not exist)`));
  });

  it('uses the host xref template (zh)', () => {
    const html = renderDocument(topicWith(makeEl('topic/xref', [], { href })), { ...brokenCtx, refErrorTexts: zhTexts, refError: () => zhTexts.missingFile });
    assert.ok(html.includes(`→ ${href}（目标文件不存在）`), `got: ${html}`);
  });

  it('keeps author text -- content wins over the diagnosis', () => {
    const html = renderDocument(topicWith(makeEl('topic/xref', [makeText('click here')], { href })), brokenCtx);
    assert.ok(!html.includes('xref-broken'));
    assert.ok(html.includes('click here'));
  });

  it('never diagnoses scope=external or scope=peer references', () => {
    for (const scope of ['external', 'peer']) {
      const html = renderDocument(topicWith(makeEl('topic/xref', [], { href: 'https://example.com/x', scope })), brokenCtx);
      assert.ok(!html.includes('xref-broken'), `scope=${scope} must not be diagnosed`);
    }
  });

  it('keeps the legacy bytes when refError is absent or reports nothing broken', () => {
    const node = makeEl('topic/xref', [], { href });
    const plain = renderDocument(topicWith(node), defaultCtx);
    const silent = renderDocument(topicWith(node), { ...defaultCtx, refError: () => undefined });
    assert.strictEqual(silent, plain);
    assert.ok(!plain.includes('xref-broken'));
  });
});

describe('makeRefErrorResolver (three diagnosis states)', () => {
  let dir: string;
  const goodXml = '<topic id="good"><body><p id="reuse-p">ok</p></body></topic>';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ref-error-'));
    writeFileSync(join(dir, 'good.dita'), goodXml);
    writeFileSync(join(dir, 'bad.dita'), '<topic id="bad"><body><p>unclosed');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('distinguishes missing file, unparseable file and missing id', () => {
    const diagnose = makeRefErrorResolver(dir);
    assert.strictEqual(diagnose('gone.dita#gone/step2'), DEFAULT_REF_ERROR_TEXTS.missingFile);
    assert.strictEqual(diagnose('bad.dita#bad/p'), DEFAULT_REF_ERROR_TEXTS.parseError);
    assert.strictEqual(diagnose('good.dita#good/nope'), DEFAULT_REF_ERROR_TEXTS.missingId);
  });

  it('returns undefined for a reference that resolves', () => {
    const diagnose = makeRefErrorResolver(dir);
    assert.strictEqual(diagnose('good.dita#good/reuse-p'), undefined);
    assert.strictEqual(diagnose('good.dita'), undefined, 'file-level reference to a parseable file');
  });

  it('checks same-document fragments against ownRoot, including the #./ shorthand', () => {
    const ownRoot = parseDita(goodXml).root;
    const diagnose = makeRefErrorResolver(dir, ownRoot);
    assert.strictEqual(diagnose('#reuse-p'), undefined);
    assert.strictEqual(diagnose('#nope'), DEFAULT_REF_ERROR_TEXTS.missingId);
    assert.strictEqual(diagnose('#./good/nope'), DEFAULT_REF_ERROR_TEXTS.missingId);
    assert.strictEqual(diagnose('#'), undefined, 'no id to check');
  });

  it('does not probe external URLs, absolute paths or bare words', () => {
    const diagnose = makeRefErrorResolver(dir);
    assert.strictEqual(diagnose('https://example.com/gone.dita#g/x'), undefined);
    assert.strictEqual(diagnose(resolve(dir, 'gone.dita') + '#g/x'), undefined, 'absolute path');
    assert.strictEqual(diagnose('bareword'), undefined, 'not a DITA-shaped filename');
    assert.strictEqual(diagnose(''), undefined);
  });

  it('probes a fragment-less .dita/.xml/.ditamap path as a file reference', () => {
    const diagnose = makeRefErrorResolver(dir);
    assert.strictEqual(diagnose('gone.dita'), DEFAULT_REF_ERROR_TEXTS.missingFile);
    assert.strictEqual(diagnose('bad.dita'), DEFAULT_REF_ERROR_TEXTS.parseError);
  });

  it('uses the supplied texts for its reasons', () => {
    const diagnose = makeRefErrorResolver(dir, undefined, undefined, zhTexts);
    assert.strictEqual(diagnose('gone.dita#g/x'), '目标文件不存在');
    assert.strictEqual(diagnose('bad.dita#g/x'), '目标文件 XML 解析失败');
    assert.strictEqual(diagnose('good.dita#good/nope'), '目标 ID 不存在');
  });

  it('rides the shared file cache: probes (missing files included) join touchedFiles', () => {
    const cache = makeFileCache(dir);
    const diagnose = makeRefErrorResolver(dir, undefined, cache);
    diagnose('gone.dita#g/x');
    diagnose('good.dita#good/reuse-p');
    const touched = cache.touchedFiles();
    assert.ok(touched.includes(resolve(dir, 'gone.dita')), 'missing target must enter the dependency set');
    assert.ok(touched.includes(resolve(dir, 'good.dita')));
  });
});

describe('buildRenderContext refErrors wiring', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ref-error-ctx-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function baseInput(over: Record<string, unknown> = {}) {
    return {
      docDir: dir,
      ownRoot: parseDita('<topic id="t"><body><p id="p1">hi</p></body></topic>').root,
      titleMap: new Map<string, string>(),
      keyMap: new Map<string, string>(),
      asWebviewUri: (p: string) => p,
      headingLevel: 1,
      uiLanguage: 'en',
      ...over,
    };
  }

  it('is opt-in: absent flag leaves refError unwired (export keeps its bytes)', () => {
    const { ctx } = buildRenderContext(baseInput());
    assert.strictEqual(ctx.refError, undefined);
    assert.strictEqual(ctx.refErrorTexts, undefined);
  });

  it('wires the diagnosis and merges partial texts over the English defaults', () => {
    const { ctx } = buildRenderContext(baseInput({ refErrors: true, refErrorTexts: { missingFile: '目标文件不存在' } }));
    assert.strictEqual(ctx.refError!('gone.dita#g/x'), '目标文件不存在');
    assert.strictEqual(ctx.refErrorTexts!.content, DEFAULT_REF_ERROR_TEXTS.content, 'unspecified fields fall back');
    assert.strictEqual(ctx.refError!('#p1'), undefined, 'same-document id exists');
    assert.strictEqual(ctx.refError!('#nope'), DEFAULT_REF_ERROR_TEXTS.missingId);
  });
});

describe('renderTopicCached: hint wording is part of the cache key', () => {
  let dir: string;
  const xml = '<topic id="t"><title>T</title><body><p conref="gone.dita#g/x"/></body></topic>';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ref-error-cache-'));
    writeFileSync(join(dir, 'topic.dita'), xml);
    clearTopicRenderCache();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    clearTopicRenderCache();
  });

  function input(over: Record<string, unknown> = {}) {
    return {
      filePath: join(dir, 'topic.dita'),
      keyMap: new Map<string, string>(),
      asWebviewUri: (p: string) => p,
      headingLevel: 1,
      uiLanguage: 'en',
      ...over,
    };
  }

  it('forces refErrors on for previews even when the input leaves it off', () => {
    const result = renderTopicCached(input({ refErrors: false }));
    assert.ok(result.html.includes('class="ref-error"'), 'preview always shows broken refs');
  });

  it('does not serve one locale\'s chip text from the other locale\'s cache entry', () => {
    const en = renderTopicCached(input());
    assert.ok(en.html.includes('Referenced content could not be resolved (target file does not exist)'));
    const zh = renderTopicCached(input({ refErrorTexts: zhTexts }));
    assert.ok(zh.html.includes('引用内容无法解析（目标文件不存在）'), `got: ${zh.html}`);
    const enAgain = renderTopicCached(input());
    assert.ok(enAgain.html.includes('Referenced content could not be resolved'), 'English entry must survive the zh render');
    assert.ok(!enAgain.html.includes('引用内容'));
  });

  it('renderTopicXml without refErrors keeps the legacy silent-empty shape (export path)', () => {
    const result = renderTopicXml({
      xml,
      docDir: dir,
      keyMap: new Map<string, string>(),
      asWebviewUri: (p: string) => p,
      headingLevel: 1,
      uiLanguage: 'en',
    });
    assert.ok(!result.html.includes('ref-error'));
  });
});

describe('ref-error placeholder placement and xref diagnosis scope', () => {
  const dir = mkdtempSync(join(tmpdir(), 'referr-place-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'guide.html'), '<html><body><h1 id="a">x</h1></body></html>');

  const render = (body: string): string =>
    renderTopicXml({
      xml: `<?xml version="1.0"?><topic id="t"><title>T</title><body>${body}</body></topic>`,
      docDir: dir,
      keyMap: new Map(),
      asWebviewUri: (p: string) => p,
      headingLevel: 1,
      uiLanguage: 'en',
      refErrors: true,
    }).html;

  it('a broken <row conref> stays a table row (a bare span is foster-parented out of the table)', () => {
    const html = render(
      '<table><tgroup cols="1"><tbody><row conref="gone.dita#x/r"/><row><entry>ok</entry></row></tbody></tgroup></table>',
    );
    assert.ok(/<tbody[^>]*>\s*<tr class="ref-error-row"[^>]*><td class="ref-error"[^>]*colspan="\d+"/.test(html), html);
    assert.ok(!/<tbody[^>]*>\s*<span/.test(html), 'no bare span directly in tbody');
  });

  it('a broken <entry conref> is a table cell', () => {
    const html = render(
      '<table><tgroup cols="1"><tbody><row><entry conref="gone.dita#x/e"/></row></tbody></tgroup></table>',
    );
    assert.ok(/<tr[^>]*><td class="ref-error"/.test(html), html);
  });

  it('a broken <li conref> is a list item, not a span inside the list', () => {
    const html = render('<ul><li conref="gone.dita#x/l"/></ul>');
    assert.ok(/<ul[^>]*><li class="ref-error"/.test(html), html);
  });

  it('a broken block conref (<p>) is a block, an inline one (<ph>) stays a span', () => {
    assert.ok(/<div class="ref-error"/.test(render('<p conref="gone.dita#x/p"/>')));
    assert.ok(/<p[^>]*>a <span class="ref-error"/.test(render('<p>a <ph conref="gone.dita#x/q"/></p>')));
  });

  it('every wrapper keeps title, data-line and the localized text', () => {
    const html = render('<ul><li conref="gone.dita#x/l"/></ul>');
    assert.ok(/class="ref-error" title="gone\.dita#x\/l" data-line="\d+"/.test(html), html);
    assert.ok(html.includes('target file does not exist'));
  });

  it('an empty xref to an existing html file is not diagnosed (the fragment is not a DITA id)', () => {
    assert.ok(!render('<p><xref href="guide.html#a"/></p>').includes('xref-broken'));
    assert.ok(!render('<p><xref href="guide.html#nope" format="html"/></p>').includes('xref-broken'));
  });

  it('an xref with a non-DITA @format is never diagnosed, a missing .pdf included', () => {
    assert.ok(!render('<p><xref href="gone.pdf#page=3" format="pdf"/></p>').includes('xref-broken'));
  });

  it('an xref to a missing DITA topic is still diagnosed', () => {
    assert.ok(render('<p><xref href="gone.dita#t/p"/></p>').includes('xref-broken'));
    assert.ok(render('<p><xref href="gone.dita" format="dita"/></p>').includes('xref-broken'));
  });
});


describe('conkeyref and row-group hints', () => {
  const dir = mkdtempSync(join(tmpdir(), 'referr-ck-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'ok.dita'), '<topic id="o"><title>o</title><body><p id="here">x</p></body></topic>');
  writeFileSync(join(dir, 'bad.dita'), '<topic id="b"><body><p>');
  const mapFile = join(dir, 'm.ditamap');
  writeFileSync(
    mapFile,
    '<map><keydef keys="good" href="ok.dita"/><keydef keys="nofile" href="gone.dita"/>' +
      '<keydef keys="broken" href="bad.dita"/><keydef keys="notarget"/></map>',
  );
  const keys = buildKeySpace(mapFile, [], (p: string) => readFileSync(p, 'utf-8')).keys;

  const render = (body: string, keyMap: Map<string, string> = keys): string =>
    renderTopicXml({
      xml: `<?xml version="1.0"?><topic id="t"><title>T</title><body>${body}</body></topic>`,
      docDir: dir,
      keyMap,
      asWebviewUri: (p: string) => p,
      headingLevel: 1,
      uiLanguage: 'en',
      refErrors: true,
    }).html;

  it('an unresolved conkeyref renders the chip, with the failing reason', () => {
    const cases: Array<[string, string]> = [
      ['nokey/x', 'key is not defined or has no target'],
      ['notarget/x', 'key is not defined or has no target'],
      ['nofile/x', 'target file does not exist'],
      ['broken/x', 'target file cannot be parsed as XML'],
      ['good/absent', 'target ID does not exist'],
    ];
    for (const [ref, reason] of cases) {
      const html = render(`<p conkeyref="${ref}"/>`);
      assert.ok(html.includes(`class="ref-error" title="${ref}"`), `${ref}: ${html}`);
      assert.ok(html.includes(`(${reason})`), `${ref}: ${html}`);
    }
  });

  it('a resolving conkeyref, one rescued by @conref, and a keyless topic stay as before', () => {
    assert.ok(!render('<p conkeyref="good/here"/>').includes('ref-error'));
    writeFileSync(join(dir, 'c.dita'), '<topic id="c"><title>c</title><body><p id="p1">rescue</p></body></topic>');
    const rescued = render('<p conkeyref="nokey/x" conref="c.dita#c/p1"/>');
    assert.ok(rescued.includes('rescue') && !rescued.includes('ref-error'), rescued);
    assert.ok(!render('<p conkeyref="nokey/x"/>', new Map()).includes('ref-error'), 'no key space, no diagnosis');
  });

  it('a failed conkeyref is not diagnosed without the refErrors opt-in', () => {
    const html = renderTopicXml({
      xml: '<?xml version="1.0"?><topic id="t"><title>T</title><body><p conkeyref="nokey/x"/></body></topic>',
      docDir: dir, keyMap: keys, asWebviewUri: (p: string) => p, headingLevel: 1,
    }).html;
    assert.ok(!html.includes('ref-error'));
  });

  it('a broken <tbody conref> stays inside the table as a full-width row', () => {
    const html = render(
      '<table><tgroup cols="1"><tbody conref="gone.dita#x/tb"/></tgroup></table>',
    );
    assert.ok(/<table[^>]*>\s*<tbody class="ref-error-rows"><tr class="ref-error-row"><td class="ref-error"/.test(html), html);
  });
});
