import * as assert from 'assert';
import { renderTopicXml } from '../../editor/ditaRenderUtils';
import { blocksFor, readRepo, stripComments } from './cssBlocks';

// M2 review: the content now carries org.dita.html5 class names, and two of
// them touch rules that were not written with content in mind.
//
// 1. A table row is `<tr class="row">`. The compat sheet's Bootstrap subset
//    defines `.row` as a flex container with negative margins, which would
//    turn every table row of a webhelp page into one.
// 2. A note's text now sits in `<div class="note__body">`. A div is a block,
//    the label before it is inline, so in the own-DOM templates the text
//    dropped to a line of its own although only the webhelp css wants the
//    wrapper. The own shell keeps it inline.
//
// No browser here, so these pin the contract in text: what the renderer
// emits against what the stylesheets do with it.

const render = (xml: string): string =>
  renderTopicXml({ xml, docDir: process.cwd(), keyMap: new Map(), asWebviewUri: (p) => p, headingLevel: 1, uiLanguage: 'en' }).html;

const RICH = `<topic id="t"><title>T</title><body>
<p>p</p><note type="tip">n</note><ul><li>a</li></ul><ol><li>b</li></ol>
<section><title>S</title><p>x</p></section>
<fig><title>F</title><image href="a.png"/></fig>
<table><tgroup cols="1"><thead><row><entry>h</entry></row></thead><tbody><row><entry>c</entry></row></tbody></tgroup></table>
<codeblock>c</codeblock><pre>p</pre><screen>s</screen><lines>l</lines>
</body></topic>`;

const classTokens = (html: string): Set<string> => {
  const out = new Set<string>();
  for (const m of html.matchAll(/class="([^"]*)"/g)) for (const t of m[1].split(/\s+/)) if (t) out.add(t);
  return out;
};

describe('content classes against the compat sheet (webhelp)', () => {
  const compat = stripComments(readRepo('media/webhelp-compat.css'));

  it('a table row really is tr.row (the premise of the next test)', () => {
    assert.ok(/<tr\b[^>]*\bclass="row"/.test(render(RICH)));
  });

  it('the Bootstrap subset\'s .row leaves table rows alone', () => {
    const rowRules = [...compat.matchAll(/([^{}]*\.row\b[^{}]*)\{/g)].map((m) => m[1].trim());
    assert.ok(rowRules.length > 0);
    for (const sel of rowRules) assert.ok(/\.row:not\(tr\)/.test(sel), `unguarded: ${sel}`);
  });

  it('the only class the content shares with the Bootstrap subset is row (so a new clash is noticed)', () => {
    // Class names the subset defines as layout (not theming): .row .col* .container-fluid .navbar* .collapse .d-* .sr-only
    const subset = new Set<string>();
    for (const m of compat.matchAll(/\.(row|col(?:-[\w-]+)?|container-fluid|navbar(?:-[\w-]+)?|collapse|show|d-[\w-]+|sr-only)\b/g)) subset.add(m[1]);
    const shared = [...classTokens(render(RICH))].filter((t) => subset.has(t));
    assert.deepStrictEqual(shared, ['row']);
  });
});

describe('note body in the own DOM', () => {
  const styles = stripComments(readRepo('media/styles.css'));

  it('the renderer wraps the note text in note__body', () => {
    assert.ok(/<span\b[^>]*\bclass="note__label note__title"[^>]*>Tip:<\/span> <div\b[^>]*\bclass="note__body"[^>]*>n<\/div>/.test(render(RICH)));
  });

  it('styles.css keeps that wrapper inline outside the webhelp page, so label and text share a line', () => {
    const blocks = blocksFor(styles, 'body:not(.wh_topic_page) .note__body');
    assert.ok(blocks.some((b) => /display:\s*inline\b/.test(b)), blocks.join('|'));
  });

  it('and does not touch it on a webhelp page', () => {
    assert.deepStrictEqual(blocksFor(styles, '.note__body'), []);
  });
});
