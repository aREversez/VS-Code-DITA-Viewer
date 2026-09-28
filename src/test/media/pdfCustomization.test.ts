import * as assert from 'assert';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import sax from 'sax';

// dist-test/test/media/pdfCustomization.test.js -> repo root is three levels up.
const customizationRoot = join(__dirname, '..', '..', '..', 'media', 'pdf-customization');

/**
 * Parses `xml` with the same strict sax parser src/parser/ditaParser.ts uses,
 * throwing on any error instead of recovering. Every file DITA-OT loads for
 * the `pdf` customization is plain XML: it has to parse, not just look
 * roughly right in a regex. A comment containing the two-character sequence
 * `--` (e.g. an ASCII dash used as an em-dash in prose) is well-formed to a
 * casual eye and to a text matcher, but is an XML spec violation that makes
 * the whole file unparseable -- which, for a customization file, means
 * DITA-OT silently skips it and the default, un-fixed styling is used with no
 * error surfaced to the user.
 */
function parseStrictXml(xml: string, label: string): void {
  const parser = sax.parser(true, { trim: false, normalize: false });
  parser.onerror = (err) => {
    throw new Error(`${label}: SAX parse error at line ${parser.line}:${parser.column}: ${err.message}`);
  };
  parser.write(xml).close();
}

/**
 * media/pdf-customization/ is a static asset consumed by DITA-OT itself, not
 * by any code in this repo: nothing compiles it, nothing exercises it, and
 * every way it can be wrong is silent — a missing/renamed file, or an
 * attribute-set whose name doesn't match what org.dita.pdf2 actually declares,
 * means the customization is quietly ignored and the PDF comes out with the
 * old, un-fixed styling rather than failing the transform. These are tripwires
 * on the three shapes that have to hold for the `customization.dir` option to
 * do anything at all.
 *
 * They match on file text, so a legitimate rewording (a comment edit, an
 * attribute added to an existing set) won't fail them; only losing the
 * structural piece that makes the override work will.
 */
describe('media/pdf-customization: every file is well-formed XML', () => {
  const files = [
    'catalog.xml',
    join('fo', 'attrs', 'custom.xsl'),
    join('fo', 'xsl', 'custom.xsl'),
  ];
  for (const rel of files) {
    it(`${rel} parses with a strict XML parser`, () => {
      // Tripwire against the `--` -in-a-comment class of mistake (see
      // parseStrictXml's doc comment) and anything else that only a real
      // parser catches, not a text match.
      parseStrictXml(readFileSync(join(customizationRoot, rel), 'utf-8'), rel);
    });
  }
});

describe('media/pdf-customization: catalog.xml wiring', () => {
  const catalogPath = join(customizationRoot, 'catalog.xml');
  const catalog = readFileSync(catalogPath, 'utf-8');

  /** Every `uri name="..." uri="..."` pair declared in the catalog. */
  function uriEntries(): { name: string; uri: string }[] {
    const entries: { name: string; uri: string }[] = [];
    const re = /<uri\s+name="([^"]+)"\s+uri="([^"]+)"\s*\/>/g;
    for (const m of catalog.matchAll(re)) entries.push({ name: m[1], uri: m[2] });
    return entries;
  }

  it('maps both org.dita.pdf2 customization hooks (fo/attrs/custom.xsl and fo/xsl/custom.xsl)', () => {
    const names = uriEntries().map((e) => e.name).sort();
    assert.deepStrictEqual(names, ['cfg:fo/attrs/custom.xsl', 'cfg:fo/xsl/custom.xsl']);
  });

  it('points every uri at a file that actually exists, relative to the catalog', () => {
    // A drift here (file renamed, or moved a level up/down) is not an error
    // DITA-OT reports -- the catalog lookup just misses and the default,
    // un-customized stylesheet is used instead.
    for (const e of uriEntries()) {
      const target = join(customizationRoot, e.uri);
      assert.ok(existsSync(target), `catalog.xml maps "${e.name}" to "${e.uri}", which is not on disk at ${target}`);
    }
  });
});

describe('media/pdf-customization: fo/attrs/custom.xsl attribute-set overrides', () => {
  const attrsPath = join(customizationRoot, 'fo', 'attrs', 'custom.xsl');
  const attrs = readFileSync(attrsPath, 'utf-8');

  function attributeSetBody(name: string): string | undefined {
    const re = new RegExp(`<xsl:attribute-set\\s+name="${name}"[^>]*>([\\s\\S]*?)</xsl:attribute-set>`);
    const m = re.exec(attrs);
    return m ? m[1] : undefined;
  }

  it('scales a too-wide image down to the column instead of letting it run off the page', () => {
    const body = attributeSetBody('image');
    assert.ok(body !== undefined, 'expected an `image` attribute-set override');
    // FOP's own keywords, not core XSL-FO: this is what makes "only shrink,
    // never enlarge" work; `uniform` is what keeps the aspect ratio while it
    // does. Losing any one of the three silently falls back to drawing the
    // image at its intrinsic size.
    assert.ok(/content-width">\s*scale-down-to-fit\s*<\//.test(body), 'image must set content-width="scale-down-to-fit"');
    assert.ok(/content-height">\s*scale-down-to-fit\s*<\//.test(body), 'image must set content-height="scale-down-to-fit"');
    assert.ok(/scaling">\s*uniform\s*<\//.test(body), 'image must set scaling="uniform"');
    // `width` is the reference rectangle content-width/content-height scale
    // down *to* -- without it the two keywords above have nothing to fit into.
    assert.ok(/<xsl:attribute\s+name="width">\s*100%\s*<\/xsl:attribute>/.test(body), 'image must set width="100%"');
  });

  it('keeps codeph monospace while adding the background/padding that make it readable', () => {
    // Overriding an attribute-set replaces it wholesale rather than merging,
    // so dropping font-family here would silently un-monospace every codeph
    // in a PDF instead of just losing the new background.
    const body = attributeSetBody('codeph');
    assert.ok(body !== undefined, 'expected a `codeph` attribute-set override');
    assert.ok(/font-family">\s*monospace\s*</.test(body), 'codeph must keep font-family="monospace"');
    assert.ok(/background-color">/.test(body), 'codeph must set a background-color');
  });

  it('suppresses the plain-map blank page the body reset would otherwise force, without touching bookmaps', () => {
    // The startPageNumbering reset makes the body start on an odd page, which
    // would drive a plain map's TOC to pad itself with a blank page (recto
    // alignment). __force__page__count is overridden so the non-bookmap branch
    // is no-force (no pad) while the bookmap branch stays "even" (real books
    // keep duplex recto layout). If either branch drifts, the fix is silently
    // undone: a stray blank page reappears, or bookmaps lose their padding.
    const body = attributeSetBody('__force__page__count');
    assert.ok(body !== undefined, 'expected a `__force__page__count` attribute-set override');
    assert.ok(/bookmap\/bookmap/.test(body), 'override must keep the bookmap branch');
    assert.ok(/'even'/.test(body), 'bookmap branch must stay force-page-count="even"');
    assert.ok(/'no-force'/.test(body), 'non-bookmap branch must be force-page-count="no-force"');
  });

  it('numbers the cover page in lowercase roman so the front matter reads i, ii, iii', () => {
    // org.dita.pdf2's page-sequence.cover ships with no `format`, so FOP renders
    // the cover as arabic "1" even though the TOC after it is already roman -
    // the front matter read "1, ii, iii". The override adds format="i" (and
    // repeats the inherited __force__page__count, since an override replaces the
    // set wholesale) so the cover reads "i".
    const body = attributeSetBody('page-sequence.cover');
    assert.ok(body !== undefined, 'expected a `page-sequence.cover` attribute-set override');
    assert.ok(/<xsl:attribute\s+name="format">\s*i\s*</.test(body), 'cover must set format="i" (lowercase roman)');
    // use-attribute-sets lives on the opening tag, not in the body, so match the
    // whole file: the override must still inherit __force__page__count (an
    // attribute-set override replaces the default wholesale).
    assert.ok(
      /<xsl:attribute-set\s+name="page-sequence\.cover"[^>]*use-attribute-sets="__force__page__count"/.test(attrs),
      'cover override must keep the inherited __force__page__count',
    );
  });
});

describe('media/pdf-customization: fo/xsl/custom.xsl template overrides', () => {
  const xslPath = join(customizationRoot, 'fo', 'xsl', 'custom.xsl');
  const xsl = readFileSync(xslPath, 'utf-8');

  it('restarts body page numbering at 1 via a startPageNumbering override', () => {
    // org.dita.pdf2's own startPageNumbering (xsl/fo/commons.xsl) is empty, so
    // the body page-sequence inherits no starting number and its arabic counter
    // runs on from the roman front matter (first body page reads 4, not 1).
    // This file is imported last, so a template of this name here replaces that
    // empty one; if the name drifts or the reset disappears, the override
    // silently does nothing and the numbering bug is back.
    assert.ok(
      /<xsl:template\s+name="startPageNumbering"/.test(xsl),
      'expected a startPageNumbering template override',
    );
    // The attribute MUST be initial-page-number, not the XSL-FO name
    // initial-value: FOP silently ignores initial-value (verified against a real
    // 2.11 run), so a future "cleanup" to the spec name would quietly undo the
    // whole fix while still passing every other check.
    assert.ok(
      /<xsl:attribute\s+name="initial-page-number">\s*1\s*<\/xsl:attribute>/.test(xsl),
      'startPageNumbering must emit initial-page-number="1" (not initial-value, which FOP ignores)',
    );
    assert.ok(
      !/name="initial-value"/.test(xsl),
      'must not use initial-value: FOP ignores it and the body would not restart',
    );
    // Guard against regressing into "every chapter restarts": the reset must
    // stay conditional, not emit unconditionally.
    assert.ok(
      /<xsl:if\b[\s\S]*initial-page-number/.test(xsl),
      'the reset must be behind a conditional guard (only the first body sequence restarts)',
    );
  });

  it('numbers chapters, appendices and parts by the entries that render, not every element', () => {
    // org.dita.pdf2 numbers a bookmap chapter with <xsl:number count=chapter>
    // over the map, so a key-only <chapter keys="..."> (no @href, no topic, no
    // page) still consumes a number: the first real chapter reads "Chapter 2"
    // in the TOC and in its own title. All three numbering templates live in
    // the topicTitleNumber mode; if any of them stops overriding the default,
    // or stops filtering by "has a topic", the skew silently returns.
    const templates = xsl.match(/<xsl:template\b[^>]*mode="topicTitleNumber"[^>]*>/g) ?? [];
    for (const cls of ['bookmap/chapter', 'bookmap/appendix', 'bookmap/part']) {
      assert.ok(
        templates.some((t) => t.includes(`' ${cls} '`)),
        `expected a topicTitleNumber override matching ${cls}`,
      );
    }
    assert.ok(
      /<xsl:function\s+name="vdv:renders-topic"/.test(xsl),
      'expected the vdv:renders-topic predicate that tells a rendered entry from a key-only one',
    );
    assert.ok(
      /key\(\s*'topic-id'/.test(xsl),
      "the predicate must ask whether a topic with the entry's id exists (topic-id key)",
    );
    // Every number must go through the predicate; a bare count over all
    // chapters/appendices/parts is the bug itself.
    const code = xsl.replace(/<!--[\s\S]*?-->/g, ''); // comments quote the default <xsl:number>
    const numberings = code.match(/<xsl:number\b[\s\S]*?\/>/g) ?? [];
    assert.strictEqual(numberings.length, 3, 'expected exactly the chapter, appendix and part numberings');
    for (const n of numberings) {
      assert.ok(n.includes('vdv:renders-topic'), `numbering must filter by vdv:renders-topic: ${n}`);
    }
  });
});

describe('media/pdf-customization: backmatter booklist page numbers', () => {
  const attrs = readFileSync(join(customizationRoot, 'fo', 'attrs', 'custom.xsl'), 'utf-8');
  const code = attrs.replace(/<!--[\s\S]*?-->/g, '');

  it('overrides page-sequence.toc so a booklist in <backmatter> is not numbered in roman', () => {
    // org.dita.pdf2 gives page-sequence.toc (and lot/lof, which inherit it)
    // format="i" via page-sequence.frontmatter. A List of Figures/Tables in
    // <backmatter> comes after the body, so its counter runs on from the body
    // and a roman format printed page 895 as "dcccxcv" in the TOC.
    const m = /<xsl:attribute-set\s+name="page-sequence\.toc"[^>]*>([\s\S]*?)<\/xsl:attribute-set>/.exec(code);
    assert.ok(m, 'expected a page-sequence.toc attribute-set override');
    assert.ok(/name="format"/.test(m[1]), 'the override must set format itself (own members beat used sets)');
    assert.ok(/bookmap\/backmatter/.test(m[1]), 'format must depend on whether the entry is inside bookmap/backmatter');
    assert.ok(/then\s+'1'\s+else\s+'i'/.test(m[1]), "backmatter -> arabic '1', everything else keeps roman 'i'");
    // The composed sets must survive the wholesale replacement.
    assert.ok(/use-attribute-sets="[^"]*__force__page__count[^"]*page-sequence\.frontmatter[^"]*"/.test(m[0]),
      'must keep the default __force__page__count and page-sequence.frontmatter members');
  });
});
